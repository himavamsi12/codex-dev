// Local test server: runs the same handlers as the Vercel functions on
// http://127.0.0.1:8787, with in-memory daily counters.
//
//   ANTHROPIC_API_KEY=... npm run dev
//
// The key is read from the environment only. Do not put it in a file.
// Point the extension at it with `url: 'http://127.0.0.1:8787'` in
// ai/hosted-config.js while testing (and put it back before publishing).
import { createServer } from 'node:http';
import { send } from './lib/handler.js';
import { runtime } from './lib/runtime.js';

process.env.DEBUG_ERRORS = '1'; // print the real reason for AI errors in this terminal
const PORT = Number(process.env.PORT) || 8787;
if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Set ANTHROPIC_API_KEY in the environment first.');
    process.exit(1);
}
const { handleAi, handleUsage } = runtime();

createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 5 * 1024 * 1024) { res.statusCode = 413; return res.end(); }
    }
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch (e) { body = undefined; }
    const path = (req.url || '').split('?')[0];
    const request = { method: req.method, headers: req.headers, body };
    if (path === '/api/ai') return send(res, await handleAi(request));
    if (path === '/api/usage') return send(res, await handleUsage(request));
    res.statusCode = 404;
    res.end('Not found');
}).listen(PORT, '127.0.0.1', () => console.log(`Codex AI dev server on http://127.0.0.1:${PORT} (model: ${process.env.HOSTED_MODEL || 'claude-sonnet-5'})`));
