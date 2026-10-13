# Codex Dev AI backend

The only AI path for the extension: users need no API key and get a free **daily limit**. Your Anthropic key lives only here, as a server secret. Never put it in the extension.

```
extension ──(POST /api/ai, X-Install-Id)──> this backend ──> Anthropic
                                             └─ daily counters (install, IP, global)
```

- `api/ai.js` - `POST`, `{ kind: 'edit' | 'animate', instruction, context, history?, image? }`
- `api/usage.js` - `GET`, remaining free requests for the caller
- The model, prompts, token limits and key are fixed on the server. A caller cannot change them.
- `lib/claude-service.js` is a generated copy of `../ai/claude-service.js` (`npm run sync`, runs before every build), so hosted and bring-your-own-key behave the same.

## Environment variables (Vercel > Project Settings > Environment Variables)

| Name | Required | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | yes | Your key. Mark it Sensitive. |
| `ALLOWED_ORIGINS` | yes in production | `chrome-extension://<EXTENSION_ID>` (comma separate several, e.g. dev + Web Store IDs). Without it production refuses every request. |
| `HOSTED_MODEL` | no | Default `claude-sonnet-5`. Confirm this is a model id your account can use. |
| `DAILY_LIMIT_INSTALL` | no | Default 20 per install per UTC day. |
| `DAILY_LIMIT_IP` | no | Default 60 per hashed IP per day. |
| `DAILY_LIMIT_GLOBAL` | no | Default 3000 for everyone per day. This is your worst-case daily spend ceiling. |
| `IP_SALT` | recommended | Long random string; IPs are hashed with it before counting. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | yes in production | Counter storage: add **Upstash Redis** from the Vercel Marketplace and it sets these. Without them counters are in memory and reset constantly (local dev only). |

If the counter store is unreachable the backend refuses requests rather than serving unmetered.

## Deploy (you run these; nothing is deployed for you)

1. `cd backend && npm install && npm test`
2. Create a Vercel project with **Root Directory = `backend`**, add Upstash Redis and the variables above.
3. Deploy, then set `url` in `ai/hosted-config.js` to the deployment URL (no trailing slash) and rebuild the extension zip.
4. Set a spend limit on the Anthropic key in the Anthropic console as a second safety net.

## Limits worth knowing

The install ID is a random value the extension generates, so someone who reinstalls or scripts requests can get a fresh daily allowance; the per-IP and global limits cap that. Real per-user limits need sign-in (not built). Rotate any key that was ever pasted into a chat or committed.
