import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const digest = (s: string) => createHash("sha256").update(s).digest();

export function tokensMatch(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || given.length > 512) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

/**
 * The token is generated once and kept (0600) so you paste it into the
 * extension a single time instead of on every start. `rotate` replaces it.
 */
export function loadToken(opts: { rotate?: boolean; env?: string; home?: string }): string {
  if (opts.env) return opts.env;
  const dir = opts.home ?? join(homedir(), ".codex-dev-bridge");
  const file = join(dir, "token");
  if (!opts.rotate && existsSync(file)) {
    const t = readFileSync(file, "utf8").trim();
    if (t.length >= 32) return t;
  }
  const token = randomBytes(32).toString("base64url");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, token + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}
