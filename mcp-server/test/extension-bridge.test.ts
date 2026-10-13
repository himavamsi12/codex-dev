// Runs the extension's real bridge/bridge.js (service-worker side) against a
// mocked chrome.* API and the real BridgeServer. Covers the protocol, the
// authorization gate and message validation. It cannot cover Chrome itself
// (see "Manual verification" in README.md).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { WebSocket } from "ws";
import { BridgeServer } from "../src/bridge.js";
import { EXT_ORIGIN } from "./helpers/fake-extension.js";
import { TOKEN } from "./helpers/harness.js";

const BRIDGE_SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../bridge/bridge.js"), "utf8");
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const until = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await tick(20);
  assert.ok(fn(), "condition not met in time");
};

function makeChrome(port: number, token: string) {
  const mem = { local: {} as Record<string, any>, session: {} as Record<string, any> };
  const area = (store: Record<string, any>) => ({
    get: async (k: string) => (k in store ? { [k]: structuredClone(store[k]) } : {}),
    set: async (o: Record<string, any>) => void Object.assign(store, structuredClone(o)),
  });
  const tabs: Record<number, any> = {
    1: { id: 1, windowId: 1, title: "Dev app", url: "http://localhost:3000/dashboard?session=SECRET123", active: true },
    2: { id: 2, windowId: 1, title: "Bank", url: "https://bank.example/account", active: false },
    3: { id: 3, windowId: 1, title: "Settings", url: "chrome://settings", active: false },
  };
  const calls = { executeScript: [] as any[], sendCommand: [] as any[], attach: 0 };
  const listeners = { message: [] as Function[], debuggerEvent: [] as Function[] };
  const chrome: any = {
    runtime: {
      id: "a".repeat(32),
      lastError: undefined,
      getManifest: () => ({ version: "9.9.9" }),
      onMessage: { addListener: (f: Function) => listeners.message.push(f) },
      onStartup: { addListener: () => undefined },
      onInstalled: { addListener: () => undefined },
    },
    storage: { local: area(mem.local), session: area(mem.session) },
    alarms: { create: () => undefined, onAlarm: { addListener: () => undefined } },
    tabs: {
      get: async (id: number) => {
        if (!tabs[id]) throw new Error("No tab with id " + id);
        return structuredClone(tabs[id]);
      },
      reload: () => undefined,
      onRemoved: { addListener: () => undefined },
      onUpdated: { addListener: () => undefined, removeListener: () => undefined },
    },
    scripting: {
      executeScript: async (inj: any) => {
        calls.executeScript.push(inj);
        return [{ result: { ok: true, probe: inj.args[0] } }];
      },
    },
    debugger: {
      attach: (_t: any, _v: string, cb: Function) => (calls.attach++, cb()),
      detach: (_t: any, cb: Function) => cb(),
      sendCommand: (_t: any, method: string, params: any, cb: Function) => (calls.sendCommand.push({ method, params }), cb({})),
      onEvent: { addListener: (f: Function) => listeners.debuggerEvent.push(f) },
      onDetach: { addListener: () => undefined },
    },
  };
  mem.local.mcpBridge = { enabled: true, port, token };
  return { chrome, mem, tabs, calls, listeners };
}

function loadBridge(port: number, token = TOKEN) {
  const m = makeChrome(port, token);
  class Sock extends WebSocket {
    constructor(url: string) {
      super(url, { origin: EXT_ORIGIN });
    }
  }
  const self: any = { __codexBridgeNoAutoInit: true, CodexProbes: { run: function codexProbeStub() {} } };
  const sandbox: any = { self, chrome: m.chrome, WebSocket: Sock, setTimeout, clearTimeout, setInterval, clearInterval, TextEncoder, URL, JSON, Object, Promise, Date, Math, Number, String, Array, Set, Map, Error, console, structuredClone };
  vm.createContext(sandbox);
  vm.runInContext(BRIDGE_SRC, sandbox);
  return { ...m, api: self.CodexBridge, self };
}

describe("extension bridge (bridge/bridge.js) with a mocked Chrome", () => {
  let server: BridgeServer;
  let ext: ReturnType<typeof loadBridge>;

  beforeEach(async () => {
    server = new BridgeServer({ port: 0, token: TOKEN, requestTimeoutMs: 2000 });
    await server.start();
  });
  afterEach(async () => {
    ext?.api.shutdown();
    await server.stop();
  });

  async function connected(authorized: Record<number, { origin: string }> = { 1: { origin: "http://localhost:3000" } }) {
    ext = loadBridge(server.port!);
    ext.mem.session.mcpAuthorizedTabs = authorized;
    ext.api.init();
    await until(() => server.status().connected);
    return ext;
  }

  it("connects with the pairing token and reports status", async () => {
    await connected();
    const st = await server.request<any>("status");
    assert.equal(st.extensionVersion, "9.9.9");
    assert.equal(st.authorizedTabs, 1);
    assert.equal(server.status().extension?.version, "9.9.9");
  });

  it("is rejected with a wrong token and says why", async () => {
    ext = loadBridge(server.port!, "wrong-token-wrong-token-wrong");
    ext.api.init();
    await until(() => /rejected the pairing token/.test(ext.api._state().lastError));
    assert.equal(server.status().connected, false);
  });

  it("does not connect when the user has not enabled the bridge", async () => {
    ext = loadBridge(server.port!);
    ext.mem.local.mcpBridge.enabled = false;
    ext.api.init();
    await tick(300);
    assert.equal(server.status().connected, false);
  });

  it("lists only authorized tabs and strips query strings from URLs", async () => {
    await connected();
    const { tabs } = await server.request<any>("list_tabs");
    assert.deepEqual(tabs.map((t: any) => t.tabId), [1]);
    assert.equal(tabs[0].url, "http://localhost:3000/dashboard?…");
    assert.ok(!JSON.stringify(tabs).includes("SECRET123"));
  });

  it("refuses commands on tabs that are not authorized", async () => {
    await connected();
    for (const command of ["validate_tab", "set_viewport", "screenshot", "diagnostics", "reload", "clear_patch"]) {
      await assert.rejects(server.request(command, { tabId: 2, width: 375, height: 800 }), (e: any) => e.code === "tab_not_authorized", command);
    }
    await assert.rejects(server.request("probe", { tabId: 2, probe: "audit" }), (e: any) => e.code === "tab_not_authorized");
    assert.equal(ext.calls.executeScript.length, 0, "nothing ran in the unauthorized tab");
    assert.equal(ext.calls.sendCommand.length, 0, "no debugger commands for the unauthorized tab");
  });

  it("revokes authorization when the tab navigates to another site", async () => {
    await connected();
    ext.tabs[1].url = "https://bank.example/login";
    await assert.rejects(server.request("validate_tab", { tabId: 1 }), (e: any) => e.code === "tab_not_authorized" && /different site/.test(e.message));
    assert.deepEqual(ext.mem.session.mcpAuthorizedTabs, {});
    assert.equal(ext.calls.executeScript.length, 0);
  });

  it("refuses pages Chrome does not let extensions inspect", async () => {
    await connected({ 3: { origin: "null" } });
    await assert.rejects(server.request("validate_tab", { tabId: 3 }), (e: any) => e.code === "page_inaccessible");
  });

  it("reports a closed tab and drops its authorization", async () => {
    await connected({ 1: { origin: "http://localhost:3000" }, 9: { origin: "http://localhost:3000" } });
    await assert.rejects(server.request("validate_tab", { tabId: 9 }), (e: any) => e.code === "tab_closed");
    assert.deepEqual(Object.keys(ext.mem.session.mcpAuthorizedTabs), ["1"]);
  });

  it("rejects unknown, prototype and malformed commands", async () => {
    await connected();
    for (const command of ["navigate", "execute_script", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      await assert.rejects(server.request(command, {}), (e: any) => e.code === "bad_request", command);
    }
    await assert.rejects(server.request("probe", { tabId: 1, probe: "eval" }), (e: any) => e.code === "bad_request");
    assert.equal(ext.calls.executeScript.length, 0);
  });

  it("re-validates CSS patches in the extension even if the server is bypassed", async () => {
    await connected();
    for (const css of ["@import url(a.css);", "a{background:url(https://evil.example/x)}", "</style><script>x</script>", "", "x".repeat(21 * 1024)]) {
      await assert.rejects(server.request("apply_patch", { tabId: 1, id: "p", css }), (e: any) => e.code === "bad_request");
    }
    assert.equal(ext.calls.executeScript.length, 0);
    await server.request("apply_patch", { tabId: 1, id: "p", css: "a{color:red}" });
    assert.equal(ext.calls.executeScript.length, 1);
    assert.equal(ext.calls.executeScript[0].world, "MAIN");
    assert.equal(ext.calls.executeScript[0].args[0], "patch");
  });

  it("runs only the fixed probe set against the authorized tab", async () => {
    await connected();
    const r = await server.request<any>("probe", { tabId: 1, probe: "audit", params: { expectedWidth: 375 } });
    assert.equal(r.probe, "audit");
    assert.equal(ext.calls.executeScript[0].target.tabId, 1);
  });

  it("runs only whitelisted design actions, on authorized tabs", async () => {
    await connected();
    for (const action of ["eval", "navigate", "constructor", "__proto__"]) {
      await assert.rejects(server.request("design", { tabId: 1, action }), (e: any) => e.code === "bad_request", action);
    }
    await assert.rejects(server.request("design", { tabId: 2, action: "context" }), (e: any) => e.code === "tab_not_authorized");
    assert.equal(ext.calls.executeScript.length, 0);
    await server.request("design", { tabId: 1, action: "patch", params: { operations: [{ op: "set", property: "color", value: "red" }] } }).catch(() => undefined);
    const files = ext.calls.executeScript[0].files;
    assert.deepEqual(Array.from(files), ["design-ai/core.js", "design-ai/provider.js", "design-ai/engine.js"]);
    assert.equal(ext.calls.executeScript[0].world, undefined, "runs in the extension's isolated world");
  });

  it("explains missing diagnostics instead of returning empty data", async () => {
    await connected();
    await assert.rejects(server.request("diagnostics", { tabId: 1, kind: "console" }), (e: any) => e.code === "diagnostics_unavailable" && /Re-authorize/.test(e.hint));
  });

  it("authorizes a tab from the popup, attaches the debugger, and captures redacted console and network errors", async () => {
    await connected({});
    const reply = await new Promise<any>((resolve) => {
      const handled = ext.listeners.message[0]({ action: "MCP_AUTHORIZE_TAB", tabId: 1 }, { id: ext.chrome.runtime.id }, resolve);
      assert.equal(handled, true);
    });
    assert.equal(reply.ok, true);
    assert.equal(reply.diagnostics, true);
    assert.equal(ext.calls.attach, 1);
    assert.deepEqual(ext.mem.session.mcpAuthorizedTabs[1], { origin: "http://localhost:3000" });

    const ev = (m: string, p: any) => ext.listeners.debuggerEvent.forEach((f) => f({ tabId: 1 }, m, p));
    ev("Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught", url: "http://localhost:3000/app.js?v=SECRET", lineNumber: 4, columnNumber: 2, exception: { description: "TypeError: x is undefined, Authorization: Bearer abcdef1234567890" } } });
    ev("Network.requestWillBeSent", { requestId: "r1", request: { url: "http://localhost:3000/api/me?token=SECRET", method: "GET" }, type: "Fetch" });
    ev("Network.responseReceived", { requestId: "r1", type: "Fetch", response: { url: "http://localhost:3000/api/me?token=SECRET", status: 500, statusText: "Server Error" } });
    ev("Network.requestWillBeSent", { requestId: "r2", request: { url: "http://localhost:3000/ok", method: "GET" }, type: "Fetch" });
    ev("Network.responseReceived", { requestId: "r2", type: "Fetch", response: { url: "http://localhost:3000/ok", status: 200, statusText: "OK" } });
    ev("Network.requestWillBeSent", { requestId: "r3", request: { url: "https://cdn.example/lib.js", method: "GET" }, type: "Script" });
    ev("Network.loadingFailed", { requestId: "r3", type: "Script", errorText: "net::ERR_NAME_NOT_RESOLVED", canceled: false });
    ev("Network.requestWillBeSent", { requestId: "r4", request: { url: "http://localhost:3000/aborted", method: "GET" }, type: "XHR" });
    ev("Network.loadingFailed", { requestId: "r4", type: "XHR", errorText: "net::ERR_ABORTED", canceled: true });

    const con = await server.request<any>("diagnostics", { tabId: 1, kind: "console" });
    assert.equal(con.entries.length, 1);
    assert.match(con.entries[0].message, /TypeError/);
    assert.doesNotMatch(JSON.stringify(con), /abcdef1234567890|SECRET/);
    assert.equal(con.entries[0].source, "http://localhost:3000/app.js?…");

    const net = await server.request<any>("diagnostics", { tabId: 1, kind: "network" });
    assert.deepEqual(net.entries.map((e: any) => [e.status, e.url]), [[500, "http://localhost:3000/api/me?…"], [0, "https://cdn.example/lib.js"]]);
    assert.equal(net.entries[1].errorText, "net::ERR_NAME_NOT_RESOLVED");
    assert.ok(!JSON.stringify(net).includes("SECRET"));
  });

  it("only lets extension pages (not content scripts or other extensions) change bridge settings", async () => {
    await connected();
    const send = (msg: any, sender: any) => new Promise<any>((resolve) => (ext.listeners.message[0](msg, sender, resolve) ? undefined : resolve("ignored")));
    const attempt = { action: "MCP_SAVE_CONFIG", enabled: true, port: 17373, token: "x".repeat(32) };
    assert.equal((await send(attempt, { tab: { id: 5 }, id: ext.chrome.runtime.id })).ok, false);
    assert.equal((await send(attempt, { id: "b".repeat(32) })).ok, false);
    assert.equal((await send({ action: "MCP_AUTHORIZE_TAB", tabId: 2 }, { tab: { id: 5 }, id: ext.chrome.runtime.id })).ok, false);
    assert.equal(ext.mem.local.mcpBridge.token, TOKEN, "config unchanged");
    assert.equal(await send({ action: "SOMETHING_ELSE" }, { id: ext.chrome.runtime.id }), "ignored");
  });

  it("pairs from the popup with a one-time code, stores the token and connects", async () => {
    ext = loadBridge(server.port!, "");
    ext.mem.local.mcpBridge = { enabled: false, port: server.port, token: "" };
    ext.api.init();
    const { code } = server.armPairing();
    const reply = await new Promise<any>((resolve) => ext.listeners.message[0]({ action: "MCP_PAIR", port: server.port, code }, { id: ext.chrome.runtime.id }, resolve));
    assert.equal(reply.ok, true, JSON.stringify(reply));
    assert.deepEqual(ext.mem.local.mcpBridge, { enabled: true, port: server.port, token: TOKEN });
    await until(() => server.status().connected);
    assert.equal((await server.request<any>("status")).extensionVersion, "9.9.9");
  });

  it("reports a wrong or expired pairing code clearly and does not enable the bridge", async () => {
    ext = loadBridge(server.port!, "");
    ext.mem.local.mcpBridge = { enabled: false, port: server.port, token: "" };
    ext.api.init();
    server.armPairing();
    const bad = await new Promise<any>((resolve) => ext.listeners.message[0]({ action: "MCP_PAIR", port: server.port, code: "000000" }, { id: ext.chrome.runtime.id }, resolve));
    assert.equal(bad.ok, false);
    assert.match(bad.error, /wrong or expired/);
    assert.equal(ext.mem.local.mcpBridge.enabled, false);
    const malformed = await new Promise<any>((resolve) => ext.listeners.message[0]({ action: "MCP_PAIR", port: server.port, code: "12ab" }, { id: ext.chrome.runtime.id }, resolve));
    assert.match(malformed.error, /6-digit/);
    const fromTab = await new Promise<any>((resolve) => ext.listeners.message[0]({ action: "MCP_PAIR", port: server.port, code: "123456" }, { tab: { id: 3 }, id: ext.chrome.runtime.id }, resolve));
    assert.equal(fromTab.ok, false);
  });

  it("validates settings saved from the popup", async () => {
    await connected();
    const save = (m: any) => new Promise<any>((resolve) => ext.listeners.message[0]({ action: "MCP_SAVE_CONFIG", ...m }, { id: ext.chrome.runtime.id }, resolve));
    assert.match((await save({ enabled: true, port: 80, token: TOKEN })).error, /Port/);
    assert.match((await save({ enabled: true, port: 17373, token: "short" })).error, /token/);
  });

  it("redacts secrets and strips URL queries", () => {
    const { redact, safeUrl } = ext.api;
    assert.equal(redact("password=hunter2hunter2 ok"), "password=[redacted] ok");
    assert.match(redact("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghij"), /jwt-redacted/);
    assert.equal(safeUrl("https://a.example/p?x=1#y"), "https://a.example/p?…");
    assert.equal(redact("x".repeat(900)).length, 500);
  });
});
