// Daily usage limits for hosted Codex AI.
//
// Three counters per UTC day, all of which must have room for a request:
//   - the install  (random ID the extension generates; easy to reset)
//   - the IP address (hashed, so it is not stored in the clear; harder to dodge)
//   - everyone together (a hard ceiling on what a bad day can cost)
// Counters expire on their own two days after they start.
import { createHash } from 'node:crypto';

const TTL_SECONDS = 2 * 24 * 60 * 60;

/** In-memory counters: local development and tests only (reset on every cold start). */
export function memoryStore() {
    const map = new Map();
    return {
        kind: 'memory',
        async incr(key) { const n = (map.get(key) || 0) + 1; map.set(key, n); return n; },
        async decr(key) { const n = Math.max(0, (map.get(key) || 0) - 1); map.set(key, n); return n; },
        async get(key) { return map.get(key) || 0; },
    };
}

/** Upstash Redis over REST (Vercel Marketplace "Upstash Redis" / KV). No extra dependency. */
export function restStore(url, token, fetchImpl = fetch) {
    async function run(commands) {
        const res = await fetchImpl(url.replace(/\/$/, '') + '/pipeline', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify(commands),
        });
        if (!res.ok) throw new Error('counter store returned ' + res.status);
        const out = await res.json();
        if (!Array.isArray(out) || out.some(r => r && r.error)) throw new Error('counter store error');
        return out.map(r => r.result);
    }
    return {
        kind: 'rest',
        async incr(key) { return Number((await run([['INCR', key], ['EXPIRE', key, TTL_SECONDS]]))[0]); },
        async decr(key) { return Number((await run([['DECR', key]]))[0]); },
        async get(key) { return Number((await run([['GET', key]]))[0] || 0); },
    };
}

export function storeFromEnv(env, fetchImpl) {
    const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
    const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
    return url && token ? restStore(url, token, fetchImpl) : memoryStore();
}

export function limitsFromEnv(env) {
    const n = (v, d) => { const x = parseInt(v, 10); return x > 0 ? x : d; };
    return { install: n(env.DAILY_LIMIT_INSTALL, 20), ip: n(env.DAILY_LIMIT_IP, 60), global: n(env.DAILY_LIMIT_GLOBAL, 3000) };
}

export function createQuota({ store, limits, salt = '', now = () => new Date() }) {
    const day = () => now().toISOString().slice(0, 10);
    const resetsAt = () => { const d = now(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString(); };
    const hashIp = ip => createHash('sha256').update(salt + '|' + ip).digest('hex').slice(0, 24);
    const keys = ({ installId, ip }) => ({
        install: `q:${day()}:i:${installId}`,
        ip: `q:${day()}:p:${hashIp(ip || 'unknown')}`,
        global: `q:${day()}:g`,
    });

    return {
        limits,
        /**
         * Takes one request from every counter. Returns { ok:true, used, limit, remaining, resetsAt, refund }
         * or { ok:false, scope, limit, resetsAt }. Throws if the store is unreachable
         * (the caller refuses the request: it never serves unmetered).
         */
        async consume(who) {
            const k = keys(who);
            const taken = [], counts = {};
            for (const scope of ['global', 'ip', 'install']) {
                const n = await store.incr(k[scope]);
                taken.push(k[scope]);
                counts[scope] = n;
                if (n > limits[scope]) {
                    await Promise.all(taken.map(key => store.decr(key).catch(() => {})));
                    return { ok: false, scope, limit: limits[scope], resetsAt: resetsAt() };
                }
            }
            const used = counts.install;
            return {
                ok: true, used, limit: limits.install, remaining: Math.max(0, limits.install - used), resetsAt: resetsAt(),
                refund: () => Promise.all(taken.map(key => store.decr(key).catch(() => {}))),
            };
        },
        async peek(who) {
            const used = await store.get(keys(who).install);
            return { used, limit: limits.install, remaining: Math.max(0, limits.install - used), resetsAt: resetsAt() };
        },
    };
}
