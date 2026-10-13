// stdout belongs to the MCP stdio transport; everything human-readable goes to stderr.
// Never log page content, URLs with queries, tokens or screenshots.
export const log = {
  info: (msg: string) => process.stderr.write(`[codex-dev-mcp] ${msg}\n`),
  warn: (msg: string) => process.stderr.write(`[codex-dev-mcp] warn: ${msg}\n`),
  error: (msg: string) => process.stderr.write(`[codex-dev-mcp] error: ${msg}\n`),
};
