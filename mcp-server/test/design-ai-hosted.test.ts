// Hosted (free, daily-limit) Codex AI end to end: the real extension talks to
// the real backend handlers (fake AI behind them) with no API key set.
// Skipped unless CHROME_FOR_TESTING_PATH is set (see real-extension.test.ts).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page, type WebWorker } from "puppeteer-core";
import { serve, type Fixture } from "./helpers/fixtures.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cft = process.env.CHROME_FOR_TESTING_PATH;
const skip = cft && existsSync(cft) ? false : "set CHROME_FOR_TESTING_PATH to a Chrome for Testing binary";

describe("hosted Codex AI through the real extension", { skip }, () => {
  let browser: Browser, page: Page, worker: WebWorker, fixture: Fixture, backend: Server;
  const seen: { headers: any; body: any }[] = [];
  const env: Record<string, string> = { ANTHROPIC_API_KEY: "server-key" };

  before(async () => {
    const { createHandlers, send } = await import(join(ROOT, "backend/lib/handler.js"));
    const { createQuota, memoryStore } = await import(join(ROOT, "backend/lib/quota.js"));
    const animation = { scope: "edit", summary: "Links fade in.", trigger: "load", scroll: null, repeat: 0, yoyo: false, repeatDelay: 0, steps: [{ target: "children", selector: null, method: "from", from: [{ property: "opacity", value: "0" }], to: [], duration: 0.2, delay: 0, ease: "power2.out", stagger: 0.05, staggerFrom: "start", position: null }] };
    const handlers = createHandlers({
      env,
      quota: createQuota({ store: memoryStore(), limits: { install: 1, ip: 5, global: 5 }, salt: "t" }),
      ai: { requestEdit: async () => ({ ok: true, summary: "x", changes: [], css: null }), requestAnimation: async () => ({ ok: true, summary: "Links fade in.", animation }), describeError: () => ({ code: "x", message: "" }) },
    });
    backend = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = raw ? JSON.parse(raw) : undefined;
      if (req.method === "POST") seen.push({ headers: req.headers, body });
      const r = await (req.url!.startsWith("/api/usage") ? handlers.handleUsage : handlers.handleAi)({ method: req.method, headers: req.headers, body });
      send(res, r);
    });
    await new Promise<void>((r) => backend.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;

    // a copy of the extension pointed at the local backend
    const ext = mkdtempSync(join(tmpdir(), "hosted-ext-"));
    execFileSync("rsync", ["-a", "--exclude", "node_modules", "--exclude", ".git", "--exclude", "mcp-server", "--exclude", "backend", "--exclude", "tools", "--exclude", "*.zip", ROOT + "/", ext + "/"]);
    writeFileSync(join(ext, "ai/hosted-config.js"), `self.CODEX_HOSTED = { url: ${JSON.stringify(url)} };\n`);

    fixture = await serve();
    browser = await puppeteer.launch({ executablePath: cft, headless: true, pipe: true, enableExtensions: [ext], args: ["--no-sandbox"] });
    worker = (await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"))).worker())!;
    env.ALLOWED_ORIGINS = "chrome-extension://" + (await worker.evaluate("chrome.runtime.id"));
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(fixture.url, { waitUntil: "load" });
    const tabId = (await worker.evaluate(`chrome.tabs.query({ url: ${JSON.stringify(fixture.url + "*")} }).then(t => t[0].id)`)) as number;
    await worker.evaluate(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => { window.__codexDesignAiTest = true; } })`);
    await worker.evaluate(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['utils/icons.js', 'utils/codex-ui.js'] }).then(() => chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['vendor/gsap/gsap.min.js', 'vendor/gsap/ScrollTrigger.min.js', 'design-ai/core.js', 'design-ai/provider.js', 'design-ai/animation.js', 'design-ai/engine.js', 'design-ai/panel.js'] }))`);
    await page.waitForSelector("codex-design-ai-panel");
    await worker.evaluate(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => CodexDesignEngine.selectBySelector('#main-nav') })`);
  });
  after(async () => {
    await browser?.close();
    await fixture?.close();
    backend?.close();
  });

  const q = (sel: string) => page.$(`pierce/${sel}`).then((h) => h!);
  const text = (el: string) => page.evaluate((e) => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector(`[data-el="${e}"]`)!.textContent!, el);

  it("works with no API key, sends only the safe fields, then stops at the daily limit", async () => {
    assert.equal(await worker.evaluate(`chrome.storage.local.get('codexAi').then(r => r.codexAi || null)`), null, "no key stored");
    await (await q('[data-tab="design"]')).click();
    await (await q('[data-el="anim-prompt"]')).type("Fade the links in one by one");
    await (await q('[data-el="anim-generate"]')).click();
    await page.waitForFunction(() => /Animation playing/.test(document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="anim-result"]')!.textContent!));
    assert.equal(seen.length, 1);
    assert.match(seen[0].headers["x-install-id"], /^[0-9a-f-]{36}$/);
    assert.match(seen[0].headers.origin, /^chrome-extension:\/\//);
    assert.deepEqual(Object.keys(seen[0].body).sort(), ["context", "history", "instruction", "kind"]);
    assert.equal(JSON.stringify(seen[0].body).includes("server-key"), false);

    await (await q('[data-el="anim-generate"]')).click();
    await page.waitForFunction(() => /free Codex AI requests for today/.test(document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="anim-result"]')!.textContent!));
    assert.match(await text("anim-result"), /resets? at midnight UTC/);
  });
});
