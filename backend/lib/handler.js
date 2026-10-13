// Request handling for hosted Codex AI, independent of the hosting platform so
// it can be tested with plain objects. api/*.js wires it to real services.
//
// Contract (JSON in, JSON out):
//   POST /api/ai    { kind:'edit'|'animate'|'design'|'fix'|'compare', instruction, context, history?, image? }
//                   headers: X-Install-Id (uuid)
//     200 -> the same result the extension gets from its own key: { ok, summary, ... } + quota
//     4xx/5xx -> { ok:false, error:{ code, message }, quota? }
//   GET  /api/usage -> { ok:true, quota }
//
// The caller never chooses the model, prompt, token limits or key: those are
// server-side only, which is what keeps the free tier from becoming a general chatbot.

const KINDS = ['edit', 'animate', 'design', 'fix', 'compare'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export const LIMITS = {
    instruction: 2000,
    context: 80000,
    historyItems: 20,
    historyChars: 120000,
    imageChars: 3 * 1024 * 1024,
};

const fail = (status, code, message, extra) => ({ status, body: { ok: false, error: { code, message }, ...(extra || {}) } });

function allowedOrigins(env) {
    return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}

/** CORS headers for an allowed origin; null when the origin is not allowed. */
export function corsFor(origin, env) {
    const list = allowedOrigins(env);
    if (!list.length) return env.VERCEL_ENV === 'production' ? null : { 'Access-Control-Allow-Origin': origin || '*' };
    if (origin && list.includes(origin)) return { 'Access-Control-Allow-Origin': origin };
    return null;
}

function clientIp(headers) {
    const fwd = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    return fwd || String(headers['x-real-ip'] || '').trim() || 'unknown';
}

function readBody(req) {
    let b = req.body;
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { return null; } }
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
}

function validate(body) {
    if (!KINDS.includes(body.kind)) return 'Unknown request type.';
    const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
    if (!instruction) return 'Describe what you want first.';
    if (instruction.length > LIMITS.instruction) return 'That request is too long. Describe it in a few sentences.';
    if (typeof body.context !== 'string' || body.context.length > LIMITS.context) return 'The selected section is too large to send. Select a smaller section.';
    if (body.history !== undefined) {
        if (!Array.isArray(body.history) || body.history.length > LIMITS.historyItems) return 'Conversation history is too long.';
        let total = 0;
        for (const h of body.history) {
            if (!h || (h.role !== 'user' && h.role !== 'assistant') || typeof h.content !== 'string') return 'Conversation history is malformed.';
            total += h.content.length;
        }
        if (total > LIMITS.historyChars) return 'Conversation history is too long.';
    }
    if (body.image !== undefined && body.image !== null) {
        if (body.kind !== 'edit' && body.kind !== 'design') return 'Images are only used for edits and designs.';
        if (typeof body.image !== 'string' || body.image.length > LIMITS.imageChars || !IMAGE.test(body.image)) return 'The screenshot is not a valid or small enough image.';
    }
    return null;
}

/**
 * deps: { env, quota, ai:{ requestEdit, requestAnimation, describeError }, log? }
 * Returns { handleAi(req), handleUsage(req) }, each resolving to { status, headers, body }.
 */
export function createHandlers({ env, quota, ai, log = () => {} }) {
    const quotaView = q => q && { limit: q.limit, remaining: q.remaining === undefined ? 0 : q.remaining, resetsAt: q.resetsAt };

    function prepare(req) {
        const origin = req.headers.origin;
        const cors = corsFor(origin, env);
        const base = { 'Cache-Control': 'no-store', Vary: 'Origin' };
        if (!cors) return { early: { status: 403, headers: base, body: { ok: false, error: { code: 'origin', message: 'This origin is not allowed.' } } } };
        const headers = { ...base, ...cors, 'Access-Control-Allow-Headers': 'Content-Type, X-Install-Id', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '86400' };
        if (req.method === 'OPTIONS') return { early: { status: 204, headers, body: null } };
        const installId = String(req.headers['x-install-id'] || '');
        if (!UUID.test(installId)) return { early: { status: 400, headers, ...fail(400, 'install', 'Missing or invalid install ID.') } };
        return { headers, who: { installId, ip: clientIp(req.headers) } };
    }

    async function handleUsage(req) {
        const p = prepare(req);
        if (p.early) return p.early;
        if (req.method !== 'GET') return { status: 405, headers: p.headers, ...fail(405, 'method', 'Use GET.') };
        try {
            return { status: 200, headers: p.headers, body: { ok: true, quota: quotaView(await quota.peek(p.who)) } };
        } catch (e) {
            return { status: 503, headers: p.headers, ...fail(503, 'unavailable', 'Codex AI is temporarily unavailable. Try again shortly.') };
        }
    }

    async function handleAi(req) {
        const p = prepare(req);
        if (p.early) return p.early;
        const { headers, who } = p;
        const out = (status, body) => ({ status, headers, body });
        if (req.method !== 'POST') return { headers, ...fail(405, 'method', 'Use POST.') };
        if (!env.ANTHROPIC_API_KEY) {
            log('misconfigured: no API key');
            return { headers, ...fail(503, 'unavailable', 'Codex AI is temporarily unavailable. Try again later.') };
        }
        const body = readBody(req);
        if (!body) return { headers, ...fail(400, 'bad_request', 'Send a JSON body.') };
        const problem = validate(body);
        if (problem) return { headers, ...fail(400, 'bad_request', problem) };

        let taken;
        try {
            taken = await quota.consume(who);
        } catch (e) {
            // Never serve unmetered: if the counters are unreachable, refuse.
            log('quota store error: ' + (e && e.message));
            return { headers, ...fail(503, 'unavailable', 'Codex AI is temporarily unavailable. Try again shortly.') };
        }
        if (!taken.ok) {
            const message = taken.scope === 'install'
                ? `You have used all ${taken.limit} free Codex AI requests for today. They reset at midnight UTC. Come back tomorrow.`
                : 'Codex AI is very busy right now. Try again later.';
            return { headers: { ...headers, 'Retry-After': '3600' }, ...fail(429, 'quota', message, { quota: { limit: taken.limit, remaining: 0, resetsAt: taken.resetsAt } }) };
        }

        const started = Date.now();
        const input = {
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.HOSTED_MODEL || 'claude-sonnet-5',
            history: body.history || [],
            context: body.context,
            instruction: body.instruction.trim(),
        };
        try {
            const result = body.kind === 'animate' ? await ai.requestAnimation(input)
                : body.kind === 'fix' ? await ai.requestFix(input)
                : body.kind === 'compare' ? await ai.requestCompare(input)
                : body.kind === 'design' ? await ai.requestDesign({ ...input, image: body.image || null })
                : await ai.requestEdit({ ...input, image: body.image || null });
            // A malformed or refused answer is not the user's fault: give the request back.
            if (!result || result.ok === false) await taken.refund();
            const q = quotaView(result && result.ok === false ? await quota.peek(who).catch(() => taken) : taken);
            log(`${body.kind} ${result && result.ok === false ? 'no-result' : 'ok'} ${Date.now() - started}ms`);
            return out(200, { ...(result || { ok: false, error: { code: 'empty', message: 'No answer. Try again.' } }), quota: q });
        } catch (e) {
            await taken.refund();
            const d = ai.describeError ? ai.describeError(e) : { code: 'unknown', message: '' };
            log(`${body.kind} error ${d.code} ${Date.now() - started}ms`);
            // Local debugging only (dev-server.mjs): the real reason, with anything key-shaped removed.
            if (env.DEBUG_ERRORS) log('detail: ' + String(d.message || (e && e.message) || '').replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***').slice(0, 300) + ' [model: ' + input.model + ']');
            // Our own key problems must not leak to users.
            const ours = d.code === 'auth' || d.code === 'permission' || d.code === 'not_found' || d.code === 'bad_request';
            if (ours) return { headers, ...fail(503, 'unavailable', 'Codex AI is temporarily unavailable. Try again later.') };
            const status = d.code === 'rate_limit' ? 503 : 502;
            return { headers, ...fail(status, d.code === 'rate_limit' ? 'busy' : d.code, d.code === 'rate_limit' ? 'Codex AI is busy right now. Try again in a moment.' : 'Codex AI could not finish this request. Try again.') };
        }
    }

    return { handleAi, handleUsage };
}

/** Adapts a { status, headers, body } result to a Node/Vercel response. */
export function send(res, r) {
    res.statusCode = r.status || 200;
    for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
    if (r.body === null || r.body === undefined) return res.end();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(r.body));
}
