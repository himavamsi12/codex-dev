import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { WebSocket } from "ws";
import type { AgentRunner } from "../src/agent.js";
import { Bridge } from "../src/server.js";
import { EditSession } from "../src/session.js";
import type { Selection, ServerMessage } from "../src/protocol.js";

const ORIGIN = "chrome-extension://" + "a".repeat(32);
const sel: Selection = { selector: "div.card", tag: "div", html: "<div class=card></div>", text: "", classes: ["card"], styles: {}, device: { name: "iPhone 15", width: 393 } };

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "cdb-"));
  const g = (...a: string[]) => execFileSync("git", a, { cwd: dir });
  g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t");
  writeFileSync(join(dir, "a.css"), "a{}\n"); writeFileSync(join(dir, "dirty.txt"), "mine\n");
  g("add", "a.css"); g("commit", "-qm", "init");
  writeFileSync(join(dir, "dirty.txt"), "mine, uncommitted\n"); // pre-existing work must survive
  return dir;
}
const fake = (root: string): AgentRunner => ({
  name: "fake",
  async run() {
    writeFileSync(join(root, "a.css"), "a{display:grid}\n");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "src/new.tsx"), "x\n");
    return { summary: "done" };
  },
});

function collect(session: EditSession) {
  const out: ServerMessage[] = [];
  return { out, send: (m: ServerMessage) => out.push(m), session };
}

test("edit → reject restores only what the edit touched", async () => {
  const root = repo();
  const s = new EditSession(root, fake(root));
  const { out, send } = collect(s);
  await s.edit("1", "grid", sel, send);
  const result = out.find(m => m.type === "result") as any;
  assert.deepEqual(result.files.map((f: any) => f.path).sort(), ["a.css", "src/new.tsx"]);
  assert.ok(result.diff.includes("+a{display:grid}"));
  assert.ok(!result.diff.includes("dirty.txt"));
  await s.reject("1", send);
  assert.equal(readFileSync(join(root, "a.css"), "utf8"), "a{}\n");
  assert.ok(!existsSync(join(root, "src/new.tsx")));
  assert.equal(readFileSync(join(root, "dirty.txt"), "utf8"), "mine, uncommitted\n");
});

test("accept → undo restores, and refuses if the file changed again", async () => {
  const root = repo();
  const s = new EditSession(root, fake(root));
  const { out, send } = collect(s);
  await s.edit("1", "grid", sel, send);
  s.accept("1", send);
  assert.equal(s.undoDepth, 1);
  writeFileSync(join(root, "a.css"), "a{display:grid;gap:1px}\n"); // dev kept working
  await s.undo(send);
  assert.equal((out.at(-1) as any).code, "restore_conflict");
  assert.ok(readFileSync(join(root, "a.css"), "utf8").includes("gap"));
  writeFileSync(join(root, "a.css"), "a{display:grid}\n");
  await s.undo(send);
  assert.equal((out.at(-1) as any).action, "undone");
  assert.equal(readFileSync(join(root, "a.css"), "utf8"), "a{}\n");
});

test("a failing agent leaves no stray edits", async () => {
  const root = repo();
  const bad: AgentRunner = { name: "bad", async run() { writeFileSync(join(root, "a.css"), "broken\n"); throw new Error("boom"); } };
  const s = new EditSession(root, bad);
  const { out, send } = collect(s);
  await s.edit("1", "x", sel, send);
  assert.equal((out.at(-1) as any).code, "edit_failed");
  assert.equal(readFileSync(join(root, "a.css"), "utf8"), "a{}\n");
});

function open(port: number, origin: string | undefined, host?: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin, headers: host ? { host } : {} });
    ws.on("open", () => resolve(ws));
    ws.on("unexpected-response", (_r, res) => reject(new Error(String(res.statusCode))));
    ws.on("error", reject);
  });
}
const nextMsg = (ws: WebSocket) => new Promise<any>(r => ws.once("message", d => r(JSON.parse(d.toString()))));

test("websocket: origin, host and token are enforced; ping works", async () => {
  const root = repo();
  const b = new Bridge({ port: 0, token: "t".repeat(40), root, session: new EditSession(root, fake(root)) });
  await b.start();
  await assert.rejects(open(b.port, "https://evil.example"), /403/);
  await assert.rejects(open(b.port, undefined), /403/);
  await assert.rejects(open(b.port, ORIGIN, "evil.example"), /403/);

  const bad = await open(b.port, ORIGIN);
  bad.send(JSON.stringify({ type: "hello", protocol: 1, token: "wrong" }));
  assert.equal((await nextMsg(bad)).code, "bad_token");

  const ok = await open(b.port, ORIGIN);
  ok.send(JSON.stringify({ type: "hello", protocol: 1, token: "t".repeat(40) }));
  assert.equal((await nextMsg(ok)).type, "welcome");
  ok.send(JSON.stringify({ type: "ping" }));
  assert.equal((await nextMsg(ok)).type, "pong");

  // origin is now pinned: a different extension can't take over even with the token
  await assert.rejects(open(b.port, "chrome-extension://" + "b".repeat(32)), /403/);
  ok.close(); await b.stop();
});
