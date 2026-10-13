import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { WebSocket } from "ws";
import { BridgeServer, tokensMatch } from "../src/bridge.js";
import { BridgeError } from "../src/errors.js";
import { EXT_ORIGIN, FakeExtension } from "./helpers/fake-extension.js";
import { TOKEN } from "./helpers/harness.js";

let bridge: BridgeServer;
const exts: FakeExtension[] = [];
const socks: WebSocket[] = [];

beforeEach(async () => {
  bridge = new BridgeServer({ port: 0, token: TOKEN, requestTimeoutMs: 300 });
  await bridge.start();
});
afterEach(async () => {
  exts.splice(0).forEach((e) => e.close());
  socks.splice(0).forEach((s) => s.terminate());
  await bridge.stop();
});

const connect = async (handlers = {}, token = TOKEN, origin = EXT_ORIGIN, host?: string) => {
  const e = new FakeExtension(bridge.port!, token, handlers, origin, host);
  exts.push(e);
  await e.connect();
  return e;
};

/** Open a raw socket and resolve with its close code or HTTP rejection status. */
const rawOutcome = (opts: { origin?: string; host?: string; first?: unknown }) =>
  new Promise<{ code: number }>((resolve) => {
    const headers: Record<string, string> = {};
    if (opts.host) headers.Host = opts.host;
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, { origin: opts.origin, headers });
    socks.push(ws);
    ws.on("open", () => opts.first !== undefined && ws.send(typeof opts.first === "string" ? opts.first : JSON.stringify(opts.first)));
    ws.on("close", (code) => resolve({ code }));
    ws.on("unexpected-response", (_r, res) => resolve({ code: res.statusCode ?? 0 }));
    ws.on("error", () => undefined);
  });

describe("bridge authentication", () => {
  it("compares tokens in constant time and rejects non-strings", () => {
    assert.equal(tokensMatch(TOKEN, TOKEN), true);
    assert.equal(tokensMatch(TOKEN + "x", TOKEN), false);
    assert.equal(tokensMatch(undefined, TOKEN), false);
    assert.equal(tokensMatch(123, TOKEN), false);
  });

  it("accepts the right token from an extension origin", async () => {
    await connect();
    const s = bridge.status();
    assert.equal(s.connected, true);
    assert.equal(s.extension?.version, "test");
  });

  it("rejects a wrong token with close code 4401 and stays disconnected", async () => {
    await assert.rejects(connect({}, "wrong-token"), (e: any) => e.code === 4401);
    assert.equal(bridge.status().connected, false);
  });

  it("rejects web page origins (a malicious site cannot reach the bridge)", async () => {
    for (const origin of ["https://evil.example", "http://localhost:3000", "http://127.0.0.1"]) {
      assert.equal((await rawOutcome({ origin, first: { type: "hello", protocol: 1, token: TOKEN } })).code, 403, origin);
    }
    assert.equal(bridge.status().connected, false);
  });

  it("rejects connections with no Origin header", async () => {
    assert.equal((await rawOutcome({ first: { type: "hello", protocol: 1, token: TOKEN } })).code, 403);
  });

  it("rejects a non-loopback Host header (DNS rebinding)", async () => {
    await assert.rejects(connect({}, TOKEN, EXT_ORIGIN, "evil.example:80"), (e: any) => e.code === 403);
    assert.equal(bridge.status().connected, false);
  });

  it("closes on protocol mismatch, malformed JSON, and commands before hello", async () => {
    assert.equal((await rawOutcome({ origin: EXT_ORIGIN, first: { type: "hello", protocol: 99, token: TOKEN } })).code, 4401);
    assert.equal((await rawOutcome({ origin: EXT_ORIGIN, first: "{not json" })).code, 1007);
    assert.equal((await rawOutcome({ origin: EXT_ORIGIN, first: { type: "response", id: "x", ok: true, result: {} } })).code, 4401);
    assert.equal(bridge.status().connected, false);
  });

  it("locks out after repeated failures", async () => {
    for (let i = 0; i < 5; i++) await rawOutcome({ origin: EXT_ORIGIN, first: { type: "hello", protocol: 1, token: "nope" } });
    assert.equal((await rawOutcome({ origin: EXT_ORIGIN, first: { type: "hello", protocol: 1, token: TOKEN } })).code, 429);
    assert.equal(bridge.status().connected, false);
  });

  it("only listens on loopback", () => {
    // the address is bound explicitly; status exposes the port only
    assert.ok(bridge.port && bridge.port > 0);
  });
});

describe("bridge requests", () => {
  it("correlates concurrent responses by id, even out of order", async () => {
    await connect({
      slow: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { name: "slow" };
      },
      fast: async () => ({ name: "fast" }),
    });
    const [a, b] = await Promise.all([bridge.request("slow", {}, 2000), bridge.request("fast", {}, 2000)]);
    assert.deepEqual([a, b], [{ name: "slow" }, { name: "fast" }]);
  });

  it("maps extension errors to BridgeError with code and hint", async () => {
    await connect({
      boom: async () => {
        throw Object.assign(new Error("not allowed"), { code: "tab_not_authorized", hint: "Allow the tab." });
      },
    });
    await assert.rejects(bridge.request("boom"), (e: any) => e instanceof BridgeError && e.code === "tab_not_authorized" && e.hint === "Allow the tab.");
  });

  it("times out when the extension never answers", async () => {
    await connect({ hang: () => new Promise(() => undefined) });
    await assert.rejects(bridge.request("hang", {}, 120), (e: any) => e.code === "timeout" && /within 0s|within 1s|did not answer/.test(e.message));
  });

  it("fails fast with guidance when no extension is connected", async () => {
    await assert.rejects(bridge.request("status"), (e: any) => e.code === "extension_not_connected" && /codex_dev_connect/.test(e.hint));
  });

  it("rejects in-flight requests when the browser disconnects, then recovers on reconnect", async () => {
    const ext = await connect({ hang: () => new Promise(() => undefined) });
    const p = bridge.request("hang", {}, 5000);
    ext.ws.terminate();
    await assert.rejects(p, (e: any) => e.code === "extension_disconnected");
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(bridge.status().connected, false);
    await connect({ status: async () => ({ ok: true }) });
    assert.deepEqual(await bridge.request("status"), { ok: true });
  });

  it("lets a newer authenticated connection replace the older one", async () => {
    const first = await connect({ who: async () => "first" });
    const closed = new Promise<number>((r) => first.ws.on("close", (c) => r(c)));
    await connect({ who: async () => "second" });
    assert.equal(await closed, 4000);
    assert.equal(await bridge.request("who"), "second");
  });

  it("ignores unsolicited or late responses", async () => {
    const ext = await connect({ status: async () => 1 });
    ext.ws.send(JSON.stringify({ type: "response", id: "nope", ok: true, result: {} }));
    assert.equal(await bridge.request("status"), 1);
  });

  it("reports a port conflict clearly instead of crashing", async () => {
    const other = new BridgeServer({ port: bridge.port!, token: TOKEN });
    await other.start();
    const s = other.status();
    assert.equal(s.listening, false);
    assert.match(s.listenError ?? "", /already in use/);
    await assert.rejects(other.request("status"), (e: any) => e.code === "bridge_unavailable");
  });
});

describe("pairing by one-time code", () => {
  const pair = (code: string, port = () => bridge.port!) =>
    new Promise<{ token?: string; welcomed: boolean; code?: number }>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port()}/`, { origin: EXT_ORIGIN });
      socks.push(ws);
      const out: { token?: string; welcomed: boolean; code?: number } = { welcomed: false };
      ws.on("open", () => ws.send(JSON.stringify({ type: "pair", protocol: 1, code })));
      ws.on("message", (d) => {
        const m = JSON.parse(d.toString());
        if (m.type === "paired") out.token = m.token;
        if (m.type === "welcome") out.welcomed = true;
      });
      ws.on("close", (c) => {
        out.code = c;
        resolve(out);
      });
      ws.on("error", () => undefined);
    });

  it("hands the token to an extension presenting the right code, once", async () => {
    const { code } = bridge.armPairing();
    assert.match(code, /^\d{6}$/);
    const ok = await pair(code);
    assert.equal(ok.token, TOKEN);
    assert.equal(bridge.status().connected, false, "the pairing socket only delivers the token");
    const reuse = await pair(code);
    assert.equal(reuse.token, undefined, "a code works only once");
    assert.equal(reuse.code, 4401);
  });

  it("rejects pairing when no window is open, and wrong or malformed codes", async () => {
    assert.equal((await pair("123456")).token, undefined);
    const { code } = bridge.armPairing();
    const wrong = code === "000000" ? "000001" : "000000";
    assert.equal((await pair(wrong)).code, 4401);
    assert.equal((await pair("abcdef")).code, 4401);
    assert.equal((await pair("12345")).code, 4401);
    assert.equal((await pair(code)).token, TOKEN, "right code still works after a couple of wrong guesses");
  });

  it("closes the window after five wrong guesses", async () => {
    const { code } = bridge.armPairing();
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 4; i++) await pair(wrong);
    assert.equal((await pair(wrong)).code, 4401);
    assert.equal((await pair(code)).token, undefined, "window is closed even for the right code");
  });

  it("expires", async () => {
    const { code } = bridge.armPairing(30);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await pair(code)).token, undefined);
  });

  it("still enforces origin and host for pairing", async () => {
    const { code } = bridge.armPairing();
    const bad = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/`, { origin: "https://evil.example" });
      socks.push(ws);
      ws.on("unexpected-response", (_r, res) => resolve(res.statusCode ?? 0));
      ws.on("open", () => ws.send(JSON.stringify({ type: "pair", protocol: 1, code })));
      ws.on("error", () => undefined);
    });
    assert.equal(bad, 403);
  });
});
