// Codex AI on OpenAI (ChatGPT models), bring-your-own-key.
//
// Classic script loaded in the background service worker after
// vendor/claude-service.js; exposes self.CodexOpenAI. It reuses the exact same
// instructions, design rules, scope limits and edit format as the Claude
// engine (self.CodexAI), so both behave the same in the chat panel.
// The user's key lives in chrome.storage.local and is only used here.
(function () {
    'use strict';
    if (self.CodexOpenAI) return;

    const API = 'https://api.openai.com/v1';
    const DEFAULT_MODEL = 'gpt-5';
    // Shown until the user's own model list is loaded with "Test key"
    const MODELS = [
        { id: 'gpt-5', label: 'GPT-5 (recommended)' },
        { id: 'gpt-5-mini', label: 'GPT-5 mini (faster, lower cost)' },
        { id: 'gpt-4.1', label: 'GPT-4.1' },
    ];
    // Chat models that accept images and structured outputs
    const USABLE = /^(gpt-[45]|o[1-9])/;
    const NOT_CHAT = /(audio|realtime|tts|transcribe|search|image|embedding|instruct|moderation|codex|3\.5|-preview)/;

    class OpenAIError extends Error {
        constructor(status, body) {
            const err = (body && body.error) || {};
            super(err.message || ('HTTP ' + status));
            this.status = status;
            this.code = err.code || err.type || null;
        }
    }

    async function call(apiKey, path, init) {
        let res;
        try {
            res = await fetch(API + path, {
                ...init,
                headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
            });
        } catch (e) {
            const err = new Error('network');
            err.network = true;
            throw err;
        }
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new OpenAIError(res.status, body);
        return body;
    }

    function describeError(error) {
        if (error && error.network) return { code: 'network', message: 'Could not reach the OpenAI API. Check your connection.' };
        const status = error && error.status;
        if (status === 401) return { code: 'auth', message: 'Your OpenAI API key was rejected. Check it in Codex AI settings.' };
        if (status === 403) return { code: 'permission', message: 'This OpenAI key does not have access to the selected model.' };
        if (status === 404) return { code: 'not_found', message: 'The selected model is not available for this OpenAI key. Pick another in settings.' };
        if (status === 429 && error.code === 'insufficient_quota') {
            return { code: 'quota', message: 'Your OpenAI account has no API credit. Add billing at platform.openai.com (a ChatGPT subscription does not include API usage).' };
        }
        if (status === 429) return { code: 'rate_limit', message: 'Rate limit reached for this OpenAI key. Try again in a moment.' };
        if (status === 400) return { code: 'bad_request', message: 'The request was rejected: ' + error.message };
        if (status) return { code: 'api', message: 'OpenAI API error ' + status + ': ' + error.message };
        return { code: 'unknown', message: (error && error.message) || String(error) };
    }

    // The chat models this key can use (free call, also validates the key)
    async function listModels(apiKey) {
        const body = await call(apiKey, '/models', { method: 'GET' });
        return (body.data || []).map(m => m.id)
            .filter(id => USABLE.test(id) && !NOT_CHAT.test(id))
            .sort();
    }

    async function testKey({ apiKey, model }) {
        const models = await listModels(apiKey);
        if (model && !models.includes(model)) throw new OpenAIError(404, { error: { message: 'Model not available: ' + model } });
        return { ok: true, model: model || DEFAULT_MODEL, models };
    }

    const isReasoning = model => /^(gpt-5|o[1-9])/.test(model);

    async function requestEdit({ apiKey, model, history, context, instruction, image }) {
        const AI = self.CodexAI;
        model = model || DEFAULT_MODEL;
        const text = `${context}\n\nRequest: ${instruction}`;
        const content = /^data:image\/(jpeg|png|webp);base64,/.test(image || '')
            ? [
                { type: 'text', text: 'Screenshot of the selected area as it looks now:' },
                { type: 'image_url', image_url: { url: image, detail: 'high' } },
                { type: 'text', text },
            ]
            : text;
        const reasoning = isReasoning(model);
        const body = {
            model,
            messages: [
                { role: reasoning ? 'developer' : 'system', content: AI.SYSTEM_PROMPT },
                ...(history || []).map(h => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) })),
                { role: 'user', content },
            ],
            response_format: { type: 'json_schema', json_schema: { name: 'codex_edit', strict: true, schema: AI.EDIT_SCHEMA } },
            max_completion_tokens: 16000,
        };
        if (reasoning) body.reasoning_effort = AI.DESIGN_REQUEST.test(instruction) ? 'high' : 'medium';

        const result = await call(apiKey, '/chat/completions', { method: 'POST', body: JSON.stringify(body) });
        const choice = result.choices && result.choices[0];
        if (!choice) return { ok: false, error: { code: 'empty', message: 'OpenAI returned no answer. Try again.' } };
        if (choice.message && choice.message.refusal) return { ok: false, error: { code: 'refusal', message: 'The model declined this request.' } };
        if (choice.finish_reason === 'length') {
            return { ok: false, error: { code: 'max_tokens', message: 'The response was too long and got cut off. Try selecting a smaller element.' } };
        }
        return AI.finishEdit((choice.message && choice.message.content) || '', result.model || model);
    }

    self.CodexOpenAI = { DEFAULT_MODEL, MODELS, describeError, listModels, testKey, requestEdit };
})();
