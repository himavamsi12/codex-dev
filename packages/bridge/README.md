# codex-dev-bridge

Local bridge for Codex Dev's **Edit in Browser**. Run it from your project root (a git repo):

```bash
npx codex-dev-bridge            # --port 17374  --rotate-token  --extension-id <id>
```

It prints a pairing token (stored 0600 in `~/.codex-dev-bridge/token`, so you paste it into the extension once; `--rotate-token` replaces it). Claude Code runs through the Agent SDK with **your existing login** (`claude login` or `ANTHROPIC_API_KEY`); no key is stored anywhere by Codex Dev.

## Security model
- Binds `127.0.0.1` only; WebSocket needs a `chrome-extension://` Origin, a loopback Host and a `hello` with the token (constant-time compare, lockout after repeated failures). The first extension to authenticate is pinned for the run, or pass `--extension-id`.
- Messages are validated (zod). No message carries a command; the only side effects are file edits made by Claude Code, limited to Read/Edit/Write/Glob/Grep inside the project and blocked for `.env*`, `.git`, `node_modules`.
- Page-derived text is placed in the prompt as marked data with an instruction not to follow it.

## Checkpoints
Before each edit the working tree (tracked + untracked, honouring `.gitignore`) is snapshotted as a git tree using a temporary index. The diff is `snapshot(before) → snapshot(after)`, so pre-existing uncommitted work never shows up. Reject/Undo write back only the files the edit touched, and refuse if you changed them again since.

## MCP
`http://127.0.0.1:<port>/mcp` (Streamable HTTP, `Authorization: Bearer <token>`) exposes `get_selected_element` and `get_preview_screenshot`.

## Develop
`npm run build`, `npm test`.
