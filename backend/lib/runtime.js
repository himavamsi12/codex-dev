// Wires the platform-independent handlers to the real services. One instance
// per warm function; counters live in the shared store, not in memory.
import * as claude from './claude-service.js';
import { createHandlers } from './handler.js';
import { createQuota, limitsFromEnv, storeFromEnv } from './quota.js';

let cached;
export function runtime(env = process.env) {
    if (!cached) {
        const quota = createQuota({ store: storeFromEnv(env), limits: limitsFromEnv(env), salt: env.IP_SALT || '' });
        cached = createHandlers({
            env,
            quota,
            ai: { requestEdit: claude.requestEdit, requestAnimation: claude.requestAnimation, requestDesign: claude.requestDesign, requestFix: claude.requestFix, requestCompare: claude.requestCompare, describeError: claude.describeError },
            // Metadata only: never the request content.
            log: line => console.log('[codex-ai] ' + line),
        });
    }
    return cached;
}
