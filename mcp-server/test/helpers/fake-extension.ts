// A stand-in for the Chrome extension: speaks the same bridge protocol as
// bridge/bridge.js and answers commands with real Chrome via puppeteer-core,
// running the real page probes from bridge/probes.js. It lets the server's
// tools be tested end to end against a real browser without loading the
// extension itself (which the manual procedure in README.md covers).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import puppeteer, { type Browser, type CDPSession, type Page } from "puppeteer-core";
import { WebSocket } from "ws";

const here = dirname(fileURLToPath(import.meta.url));
export const PROBES_PATH = join(here, "../../../bridge/probes.js");
export const EXT_ORIGIN = "chrome-extension://" + "a".repeat(32);

export function chromePath(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function loadProbeSource(): string {
  const sandbox: any = { self: {} };
  vm.runInNewContext(readFileSync(PROBES_PATH, "utf8"), sandbox);
  return sandbox.self.CodexProbes.run.toString();
}

export async function launch(): Promise<Browser> {
  const executablePath = chromePath()!;
  return puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--hide-scrollbars=false"] });
}

type Handler = (params: any) => Promise<unknown>;

export class FakeExtension {
  ws!: WebSocket;
  welcomed = false;
  rejected: number | null = null;
  constructor(
    private port: number,
    private token: string,
    private handlers: Record<string, Handler> = {},
    private origin = EXT_ORIGIN,
    private host?: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.host) headers.Host = this.host;
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/bridge`, { origin: this.origin, headers });
      this.ws.on("open", () => this.ws.send(JSON.stringify({ type: "hello", protocol: 1, token: this.token, extensionVersion: "test" })));
      this.ws.on("message", async (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "welcome") {
          this.welcomed = true;
          resolve();
        } else if (msg.type === "request") {
          const h = this.handlers[msg.command];
          try {
            if (!h) throw Object.assign(new Error("Unknown command"), { code: "bad_request" });
            const result = await h(msg.params);
            this.ws.send(JSON.stringify({ type: "response", id: msg.id, ok: true, result }));
          } catch (e: any) {
            this.ws.send(JSON.stringify({ type: "response", id: msg.id, ok: false, error: { code: e.code ?? "extension_error", message: e.message, hint: e.hint } }));
          }
        }
      });
      this.ws.on("close", (code) => {
        this.rejected = code;
        if (!this.welcomed) reject(Object.assign(new Error(`closed ${code}`), { code }));
      });
      this.ws.on("unexpected-response", (_req, res) => {
        this.rejected = res.statusCode ?? 0;
        reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { code: res.statusCode }));
      });
      this.ws.on("error", () => undefined);
    });
  }

  close(): void {
    this.ws?.close();
  }
}

/** Command handlers backed by one real Chrome page. Mirrors bridge/bridge.js. */
export function browserHandlers(page: Page, tabId = 1): Record<string, Handler> {
  const probeSrc = loadProbeSource();
  let cdp: CDPSession;
  let emulation: any = null;
  const diag = { console: [] as any[], network: [] as any[] };
  const patches = new Set<string>();

  const ready = (async () => {
    cdp = await page.createCDPSession();
    page.on("pageerror", (e) => diag.console.push({ ts: Date.now(), level: "error", kind: "exception", message: String((e as Error).message).slice(0, 500) }));
    page.on("console", (m) => m.type() === "error" && diag.console.push({ ts: Date.now(), level: "error", kind: "console.error", message: m.text().slice(0, 500) }));
    page.on("response", (r) => {
      if (r.status() >= 400) diag.network.push({ ts: Date.now(), url: r.url().split("?")[0], status: r.status(), method: r.request().method() });
    });
    page.on("requestfailed", (r) => diag.network.push({ ts: Date.now(), url: r.url().split("?")[0], status: 0, errorText: r.failure()?.errorText }));
  })();

  const runProbe = async (probe: string, params: any = {}) => {
    const out: any = await page.evaluate(`(${probeSrc})(${JSON.stringify(probe)}, ${JSON.stringify(params)})`);
    if (out?.error) throw Object.assign(new Error(out.error), { code: "probe_error" });
    return out;
  };

  const check = async (p: any) => {
    await ready;
    if (p.tabId !== tabId) throw Object.assign(new Error("This tab is not authorized for Claude Code."), { code: "tab_not_authorized" });
  };

  return {
    async status() {
      return { protocol: 1, extensionVersion: "test", authorizedTabs: 1, enabled: true };
    },
    async list_tabs() {
      await ready;
      return { tabs: [{ tabId, title: await page.title(), url: page.url().split("?")[0], active: true, windowId: 1, diagnostics: true, emulation }] };
    },
    async validate_tab(p) {
      await check(p);
      return { tabId, title: await page.title(), url: page.url().split("?")[0], diagnostics: true, emulation };
    },
    async set_viewport(p) {
      await check(p);
      if (p.reset) {
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        emulation = null;
        return { emulation: null };
      }
      const mobile = p.mobile === undefined ? p.width < 768 : !!p.mobile;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: p.width, height: p.height, deviceScaleFactor: p.deviceScaleFactor || 1, mobile, screenWidth: p.width, screenHeight: p.height });
      emulation = { width: p.width, height: p.height, deviceScaleFactor: p.deviceScaleFactor || 1, mobile };
      return { emulation };
    },
    async probe(p) {
      await check(p);
      return runProbe(p.probe, p.params);
    },
    async apply_patch(p) {
      await check(p);
      const r = await runProbe("patch", { id: p.id, css: p.css });
      patches.add(p.id);
      return r;
    },
    async clear_patch(p) {
      await check(p);
      return runProbe("clearPatch", { id: p.id });
    },
    async screenshot(p) {
      await check(p);
      const m = await cdp.send("Page.getLayoutMetrics");
      const vp = (m as any).cssVisualViewport;
      const content = (m as any).cssContentSize;
      const width = Math.round(p.fullPage ? Math.max(vp.clientWidth, Math.min(content.width, 4000)) : vp.clientWidth);
      const height = Math.round(p.fullPage ? Math.min(content.height, 8000) : vp.clientHeight);
      const params: any = { format: "png", captureBeyondViewport: !!p.fullPage };
      if (p.fullPage || p.scale) params.clip = { x: 0, y: 0, width, height, scale: p.scale || 1 };
      const shot = await cdp.send("Page.captureScreenshot", params);
      return { format: "png", base64: shot.data, width: Math.round(width * (p.scale || 1)), height: Math.round(height * (p.scale || 1)), cssWidth: width, cssHeight: height, fullPage: !!p.fullPage };
    },
    async diagnostics(p) {
      await check(p);
      const list = p.kind === "network" ? diag.network : diag.console;
      return { kind: p.kind, entries: list.slice(-(p.limit || 50)), total: list.length };
    },
    async reload(p) {
      await check(p);
      diag.console.length = 0;
      diag.network.length = 0;
      await page.reload({ waitUntil: "load" });
      return { reloaded: true };
    },
  };
}
