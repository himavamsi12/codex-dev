#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeServer } from "./bridge.js";
import { loadConfig } from "./config.js";
import { log } from "./log.js";
import { createContext, createServer } from "./server.js";
import { SERVER_VERSION } from "./tools.js";

const HELP = `codex-dev-mcp ${SERVER_VERSION}

Usage:
  codex-dev-mcp          Run the MCP server on stdio (what Claude Code launches)
  codex-dev-mcp token    Print the pairing token and port to paste into the extension
  codex-dev-mcp install-skill [--project]
                         Install the "website-check" Claude Code skill into
                         ~/.claude/skills (or ./.claude/skills with --project)
  codex-dev-mcp --help

Environment:
  CODEX_DEV_MCP_PORT        Bridge port (default 17373)
  CODEX_DEV_MCP_TOKEN       Override the pairing token
  CODEX_DEV_MCP_HOME        Config directory (default ~/.codex-dev-mcp)
  CODEX_DEV_EXTENSION_ID    Only accept this extension ID
`;

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (arg === "--help" || arg === "-h") {
    process.stdout.write(HELP);
    return;
  }
  if (arg === "install-skill") {
    installSkill(process.argv.includes("--project"));
    return;
  }
  const config = loadConfig();
  if (arg === "token") {
    process.stdout.write(`Pairing token: ${config.token}\nPort:          ${config.port}\n\nIn Chrome: Codex Dev icon → Claude Code → paste the token → Connect.\n`);
    return;
  }
  if (arg) {
    process.stderr.write(`Unknown argument "${arg}".\n${HELP}`);
    process.exitCode = 2;
    return;
  }

  const bridge = new BridgeServer({ port: config.port, token: config.token, extensionId: config.extensionId });
  await bridge.start();
  const server = createServer(createContext(bridge));
  await server.connect(new StdioServerTransport());
  log.info(`MCP server ready (v${SERVER_VERSION})`);

  const shutdown = async () => {
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("close", shutdown);
}

/** Copies skills/website-check (shipped next to dist/) into a Claude Code skills folder. */
function installSkill(project: boolean): void {
  const source = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "website-check");
  if (!existsSync(join(source, "SKILL.md"))) throw new Error(`Skill files not found at ${source}.`);
  const base = project ? join(process.cwd(), ".claude", "skills") : join(homedir(), ".claude", "skills");
  const target = join(base, "website-check");
  mkdirSync(base, { recursive: true });
  cpSync(source, target, { recursive: true, force: true });
  process.stdout.write(`Installed the website-check skill to ${target}\nRestart Claude Code, then ask: "Check my site with Codex Dev".\n`);
}

main().catch((e) => {
  log.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
