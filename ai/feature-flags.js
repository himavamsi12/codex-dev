// One switch for every AI feature in the extension: the Design Inspector's AI
// button and panel, "Fix with AI" and "Explain differences" in the responsive
// audit, the viewer's Edit (Claude Code) button, and the Codex AI backend
// calls. false hides them all and the background refuses AI requests.
// Set to true to bring them back. Loaded by background.js and viewer.html.
self.CODEX_AI_ENABLED = false;
