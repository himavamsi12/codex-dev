// Spawns the server exactly as Claude Code does (a child process speaking MCP
// over stdio) and checks the real handshake, plus the pairing-token CLI.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = join(dirname(fileURLToPath(import.meta.url)), "../src/index.ts");
const run = (home: string, args: string[] = [], port = "0") =>
  execFileSync(process.execPath, ["--import", "tsx", entry, ...args], { env: { ...process.env, CODEX_DEV_MCP_HOME: home, CODEX_DEV_MCP_PORT: port, CODEX_DEV_MCP_TOKEN: "" }, encoding: "utf8" });

describe("stdio server process", () => {
  it("completes the MCP handshake and serves tools over stdio", async () => {
    const home = mkdtempSync(join(tmpdir(), "codex-mcp-home-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", entry],
      env: { ...(process.env as Record<string, string>), CODEX_DEV_MCP_HOME: home, CODEX_DEV_MCP_PORT: "17999" },
      stderr: "pipe",
    });
    const client = new Client({ name: "stdio-test", version: "0.0.0" });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      assert.equal(tools.length, 38);
      const res: any = await client.callTool({ name: "codex_dev_status", arguments: {} });
      const data = JSON.parse(res.content[0].text);
      assert.equal(data.ready, false);
      assert.equal(data.bridge.listening, true);
      assert.equal(data.bridge.port, 17999);
      assert.match(data.nextStep, /codex_dev_connect/);
      assert.match(client.getInstructions() ?? "", /untrusted/);
    } finally {
      await client.close();
    }
  });

  it("generates a private pairing token once and reprints the same one", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-mcp-home-"));
    const first = run(home, ["token"]);
    const token = /Pairing token: (\S+)/.exec(first)![1];
    assert.ok(token.length >= 24);
    assert.equal(/Pairing token: (\S+)/.exec(run(home, ["token"]))![1], token);
    if (process.platform !== "win32") assert.equal(statSync(join(home, "config.json")).mode & 0o777, 0o600);
  });

  it("lets the environment override the token", () => {
    const home = mkdtempSync(join(tmpdir(), "codex-mcp-home-"));
    const out = execFileSync(process.execPath, ["--import", "tsx", entry, "token"], { env: { ...process.env, CODEX_DEV_MCP_HOME: home, CODEX_DEV_MCP_TOKEN: "e".repeat(32) }, encoding: "utf8" });
    assert.match(out, /Pairing token: e{32}/);
  });
});
