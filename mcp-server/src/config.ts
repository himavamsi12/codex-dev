import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_PORT = 17373;

export interface Config {
  port: number;
  token: string;
  /** Optional: pin the extension ID that may connect (CODEX_DEV_EXTENSION_ID). */
  extensionId?: string;
  dir: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_DEV_MCP_HOME || join(homedir(), ".codex-dev-mcp");
}

/**
 * Loads the pairing token and port. The token is generated on first use and kept
 * in a 0600 file; CODEX_DEV_MCP_TOKEN / CODEX_DEV_MCP_PORT override it.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dir = configDir(env);
  const file = join(dir, "config.json");
  let stored: { token?: string; port?: number } = {};
  if (existsSync(file)) {
    try {
      stored = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      stored = {};
    }
  }

  let token = env.CODEX_DEV_MCP_TOKEN || stored.token;
  if (!token || token.length < 24) {
    token = randomBytes(24).toString("base64url");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ token, port: stored.port ?? DEFAULT_PORT }, null, 2), { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* not supported on this platform */
    }
  }

  const rawPort = Number(env.CODEX_DEV_MCP_PORT ?? stored.port ?? DEFAULT_PORT);
  const port = Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535 ? rawPort : DEFAULT_PORT;
  return { port, token, extensionId: env.CODEX_DEV_EXTENSION_ID || undefined, dir };
}
