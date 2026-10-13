// Loads the REAL Codex Dev extension (bridge/, background.js, manifest.json) into
// Chrome for Testing and drives it through the MCP server. This is the only
// test that exercises chrome.debugger, chrome.scripting and the service worker.
//
// Branded Google Chrome 137+ ignores --load-extension, so this needs Chrome for
// Testing / Chromium. Skipped unless CHROME_FOR_TESTING_PATH is set:
//   npx @puppeteer/browsers install chrome@stable --path /tmp/cft
//   CHROME_FOR_TESTING_PATH="/tmp/cft/chrome/<ver>/chrome-<platform>/<binary>" npm test
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type WebWorker } from "puppeteer-core";
import { BROKEN, FIXED, type Fixture, serve } from "./helpers/fixtures.js";
import { TOKEN, startServer } from "./helpers/harness.js";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cft = process.env.CHROME_FOR_TESTING_PATH;
const skip = cft && existsSync(cft) ? false : "set CHROME_FOR_TESTING_PATH to a Chrome for Testing binary";

describe("real extension in Chrome for Testing", { skip }, () => {
  let browser: Browser;
  let worker: WebWorker;
  let fixture: Fixture;
  let h: Awaited<ReturnType<typeof startServer>>;
  let tabId: number;
  let baselineId: string;

  const inWorker = <T>(fn: string): Promise<T> => worker.evaluate(fn) as Promise<T>;

  before(async () => {
    fixture = await serve(BROKEN);
    h = await startServer();
    browser = await puppeteer.launch({
      executablePath: cft,
      headless: true,
      pipe: true,
      enableExtensions: [EXT_DIR],
      args: ["--no-sandbox"],
    });
    const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"), { timeout: 15000 });
    worker = (await target.worker())!;

    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "load" });
    tabId = await inWorker<number>(`chrome.tabs.query({ url: ${JSON.stringify(fixture.url + "*")} }).then(t => t[0].id)`);

    // What the popup does after "Connect Codex Dev": pair with the one-time code,
    // keep the returned token, then connect with it.
    const { code } = h.bridge.armPairing();
    const token = await inWorker<string>(`CodexBridge.pairWith(${h.port}, ${JSON.stringify(code)})`);
    assert.equal(token, TOKEN, "the extension receives the token from the server, not from the user");
    await inWorker(`chrome.storage.local.set({ mcpBridge: { enabled: true, port: ${h.port}, token: ${JSON.stringify(token)} } }).then(() => CodexBridge.applyConfig())`);
    const end = Date.now() + 10000;
    while (!h.bridge.status().connected && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
    assert.equal(h.bridge.status().connected, true, "extension service worker should dial the bridge");
    const auth = await inWorker<{ diagnostics: boolean }>(`CodexBridge.authorizeTab(${tabId})`);
    assert.equal(auth.diagnostics, true, "debugger attached");
    await page.reload({ waitUntil: "networkidle0" });
  });

  after(async () => {
    await h?.close();
    await browser?.close();
    await fixture?.close();
  });

  it("connects, lists only the authorized tab, and selects it", async () => {
    const st = await h.call("codex_dev_status");
    assert.equal(st.data.ready, true);
    assert.equal(st.data.extension.extensionVersion.length > 0, true);
    const tabs = await h.call("list_browser_tabs");
    assert.deepEqual(tabs.data.tabs.map((t: any) => t.tabId), [tabId]);
    assert.equal((await h.call("select_browser_tab", { tabId })).data.selected, true);
  });

  it("refuses tabs the user has not allowed", async () => {
    const other = await browser.newPage();
    await other.goto(fixture.url + "?other", { waitUntil: "load" });
    const otherId = await inWorker<number>(`chrome.tabs.query({ url: ${JSON.stringify(fixture.url + "?other")} }).then(t => t[0].id)`);
    const r = await h.call("select_browser_tab", { tabId: otherId });
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, "tab_not_authorized");
    await other.close();
  });

  it("measures overflow with real device-metrics emulation and restores the viewport", async () => {
    const r = await h.call("get_layout_overflow", { width: 375, height: 812 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.horizontalScroll, true);
    assert.ok(r.data.overflowingElements.some((e: any) => e.selector.includes("main-nav")));
    assert.ok(!r.data.overflowingElements.some((e: any) => /carousel|inner/.test(e.selector)));
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs[0].emulation, null);
  });

  it("runs the multi-viewport audit with screenshots through the real extension", async () => {
    const r = await h.call("run_responsive_audit", { viewports: [{ width: 375, height: 812 }, { width: 1280, height: 800 }] });
    assert.equal(r.isError, false, r.text);
    baselineId = r.data.reportId;
    assert.equal(r.data.summary.viewportsTested, 2);
    const doc = r.data.issues.find((i: any) => i.id === "horizontal-overflow:document");
    assert.deepEqual(doc.viewportWidths, [375]);
    for (const v of r.data.viewports) assert.ok(v.screenshot?.path);
  });

  it("captures console errors and failed requests via the debugger", async () => {
    const c = await h.call("get_console_errors");
    assert.ok(c.data.entries.some((e: any) => /fixture console error/.test(e.message)), JSON.stringify(c.data));
    const n = await h.call("get_failed_requests");
    assert.ok(n.data.entries.some((e: any) => e.status === 404 && /missing\.json$/.test(e.url)), JSON.stringify(n.data));
  });

  it("inspects elements and previews/clears a CSS patch", async () => {
    const i = await h.call("inspect_element", { selector: "#main-nav", viewport: { width: 375 } });
    assert.equal(i.data.layout.flexContainer["flex-wrap"], "nowrap");
    assert.ok(i.data.matchedRules.some((m: any) => /nowrap/.test(m.declarations)));
    await h.call("preview_css_patch", { css: ".nav{flex-wrap:wrap}.banner{max-width:100%}", id: "fix" });
    assert.equal((await h.call("get_layout_overflow", { width: 375 })).data.horizontalScroll, false);
    await h.call("clear_css_patch", {});
    assert.equal((await h.call("get_layout_overflow", { width: 375 })).data.horizontalScroll, true);
  });

  it("verifies a real source change (reload through the extension)", async () => {
    fixture.setHtml(FIXED);
    const r = await h.call("verify_responsive_fix", { baselineReportId: baselineId, waitMs: 0 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.verdict, "improved");
    assert.ok(r.data.comparison.resolved.some((x: any) => x.id === "horizontal-overflow:document"));
  });

  it("previews, exports and resets a section through the design tools", async () => {
    fixture.setHtml(BROKEN);
    await h.call("run_responsive_audit", { viewports: [{ width: 1280, height: 800 }], reload: true, screenshots: false });
    const sel = await h.call("select_target_section", { selector: "#promo-banner" });
    assert.equal(sel.data.ok, true, sel.text);
    const ctx = await h.call("get_selected_element_context", {});
    assert.equal(ctx.data.context.tag, "div");
    const bad = await h.call("preview_section_patch", { operations: [{ op: "set", property: "position", value: "fixed" }] });
    assert.equal(bad.isError, true);
    const ok = await h.call("preview_section_patch", { operations: [{ op: "set", property: "background-color", value: "#102030" }, { op: "set", property: "max-width", value: "100%", breakpoint: "mobile" }], label: "banner" });
    assert.equal(ok.isError, false, ok.text);
    const exp = await h.call("export_section_patch", { framework: "react" });
    assert.match(exp.data.css, /background-color: #102030 !important;/);
    assert.match(exp.data.guidance, /not a generated component/);
    assert.equal((await h.call("generate_section_recreation")).data.error.code, "provider_not_configured");
    const reset = await h.call("reset_section_preview", { mode: "all" });
    assert.equal(reset.data.summary.active, 0);
  });

  it("shows pages that forbid framing inside the Responsive Viewer", async () => {
    // Tab-scoped header rules must be session rules: as dynamic rules Chrome
    // rejects them, and every X-Frame-Options site showed "refused to connect".
    const blocked = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" })
        .end("<!doctype html><title>Framed fixture</title><p>framed ok</p>");
    });
    await new Promise<void>((r) => blocked.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(blocked.address() as AddressInfo).port}/`;
    const extId = new URL(worker.url()).host;
    const viewer = await browser.newPage();
    try {
      const devices = [{ name: "iPhone 14 Pro", width: 393, height: 852 }];
      await viewer.goto(`chrome-extension://${extId}/viewer.html?devices=${encodeURIComponent(JSON.stringify(devices))}&url=${encodeURIComponent(url)}`);
      const frame = await viewer.waitForFrame((f) => f.url() === url, { timeout: 10000 });
      await frame.waitForSelector("p", { timeout: 10000 });
      assert.equal(await frame.evaluate(() => document.querySelector("p")?.textContent), "framed ok");
      assert.equal((await inWorker<unknown[]>("chrome.declarativeNetRequest.getDynamicRules()")).length, 0, "no global header rules");
    } finally {
      await viewer.close();
      await new Promise<void>((r) => blocked.close(() => r()));
    }
  });

  it("throttles network and CPU inside the viewer's device frames", async () => {
    // Frames on another site run in their own process; throttling only the
    // viewer tab used to leave them at full speed.
    const big = "x".repeat(100 * 1024);
    const site = createServer((req, res) => {
      if (req.url?.startsWith("/big")) res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" }).end(big);
      else res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>t</title><p>frame</p>");
    });
    await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
    const url = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
    const extId = new URL(worker.url()).host;
    const viewer = await browser.newPage();
    try {
      await viewer.goto(`chrome-extension://${extId}/viewer.html?devices=${encodeURIComponent(JSON.stringify([{ name: "iPhone 14 Pro" }]))}&url=${encodeURIComponent(url)}`);
      const frame = await viewer.waitForFrame((f) => f.url() === url, { timeout: 10000 });
      await frame.waitForSelector("p");
      const fetchMs = () => frame.evaluate(async () => { const t = performance.now(); await fetch("/big?" + Math.random()).then((r) => r.text()); return performance.now() - t; });
      assert.ok((await fetchMs()) < 1000, "unthrottled baseline");
      const [net] = await viewer.$$("select.perf-select");
      await net.select("slow3g");
      await new Promise((r) => setTimeout(r, 1000));
      assert.ok((await fetchMs()) > 1500, "Slow 3G (400 kbps) should take about 2 s for 100 KB");
      await net.select("online");
      await new Promise((r) => setTimeout(r, 1000));
      assert.ok((await fetchMs()) < 1000, "back to full speed");
    } finally {
      await viewer.close();
      await new Promise<void>((r) => site.close(() => r()));
    }
  });

  it("reads and edits the Popular Mix the popup uses", async () => {
    let r = await h.call("get_popular_mix", {});
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.isDefault, true);
    assert.deepEqual(r.data.devices.map((d: any) => d.name), ["iPhone 14 Pro", "iPad Air", "Desktop (1920x1080)"]);
    r = await h.call("set_popular_mix", { add: ["Galaxy S24 Ultra"], remove: ["iPad"] });
    assert.equal(r.isError, false, r.text);
    const stored = await inWorker<{ name: string }[]>("chrome.storage.local.get('popularMix').then(r => r.popularMix)");
    assert.deepEqual(stored.map((d) => d.name), ["iPhone 14 Pro", "Desktop (1920x1080)", "Samsung Galaxy S24 Ultra"]);
    r = await h.call("set_popular_mix", { reset: true });
    assert.equal(r.data.isDefault, true);
  });

  it("drops authorization when the tab moves to another origin", async () => {
    const page = (await browser.pages()).find((p) => p.url().startsWith(fixture.url))!;
    await page.goto("https://example.com/", { waitUntil: "domcontentloaded" }).catch(() => undefined);
    // example.com may be unreachable offline; use about:blank-equivalent data URL otherwise
    if (!page.url().startsWith("https://example.com")) await page.goto("data:text/html,<p>x</p>").catch(() => undefined);
    const r = await h.call("get_page_structure", {});
    assert.equal(r.isError, true);
    assert.match(r.data.error.code, /tab_not_authorized|page_inaccessible/);
  });
});
