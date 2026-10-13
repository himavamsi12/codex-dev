#!/usr/bin/env node
import { claudeRunner } from "./agent.js";
import { loadToken } from "./auth.js";
import { repoRoot } from "./git.js";
import { Bridge } from "./server.js";
import { EditSession } from "./session.js";

const HELP = `codex-dev-bridge: apply Codex Dev "Edit in Browser" requests to this project with Claude Code

Run from your project root:
  npx codex-dev-bridge [--port 17374] [--rotate-token] [--extension-id <id>]

Auth: uses your existing Claude Code login (\`claude login\`, subscription or API key).
`;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) return void process.stdout.write(HELP);
  const root = await repoRoot(process.cwd());
  if (!root) {
    process.stderr.write("This folder is not inside a git repository. Edits are checkpointed with git, so run `git init` first (or start the bridge inside your project).\n");
    process.exit(1);
  }
  const token = loadToken({ rotate: process.argv.includes("--rotate-token"), env: process.env.CODEX_DEV_BRIDGE_TOKEN });
  const port = Number(arg("--port") ?? process.env.CODEX_DEV_BRIDGE_PORT ?? 17374);
  const bridge = new Bridge({ port, token, root, session: new EditSession(root, claudeRunner), extensionId: arg("--extension-id") ?? process.env.CODEX_DEV_EXTENSION_ID });
  await bridge.start().catch(e => {
    process.stderr.write(e?.code === "EADDRINUSE" ? `Port ${port} is in use. Another bridge is running? Try --port.\n` : `${e}\n`);
    process.exit(1);
  });
  process.stdout.write(
    `\nCodex Dev bridge ready\n  project : ${root}\n  listen  : ws://127.0.0.1:${bridge.port}/ws   (this machine only)\n  token   : ${token}\n\n` +
      `Paste the token into Codex Dev → Edit mode → Connect.\n` +
      `Optional, so Claude Code can ask what you selected:\n  claude mcp add --transport http codex-dev-edit http://127.0.0.1:${bridge.port}/mcp --header "Authorization: Bearer ${token}"\n\n`,
  );
  const stop = async () => { await bridge.stop(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main();
