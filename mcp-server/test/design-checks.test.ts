// Typography, accessibility and section-spacing checks against real Chrome.
// Skipped automatically when no Chrome is installed (set CHROME_PATH to point at one).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "puppeteer-core";
import { FakeExtension, browserHandlers, chromePath, launch } from "./helpers/fake-extension.js";
import { type Fixture, serve } from "./helpers/fixtures.js";
import { startServer } from "./helpers/harness.js";

const skip = chromePath() ? false : "Chrome not found (set CHROME_PATH)";

// Every problem here is planted on purpose; the tests check each one is found.
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Design checks</title>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<style>
  @font-face{font-family:"Brand Missing";src:url(/nope.woff2) format("woff2")}
  body{margin:0;font:16px/1.5 sans-serif;background:#fff;color:#111}
  section{padding:64px 24px}
  h1{font-size:40px} h2{font-size:28px} h3{font-size:34px}
  .brand{font-family:"Brand Missing",serif}
  .oddfont{font-family:Georgia,serif}
  .faint{color:#bbb}
  .tight{line-height:1}
  .cramped{padding:4px 24px 64px}
  .lopsided{padding:120px 24px 16px}
</style></head><body>
<main>
  <section id="hero"><h1>Welcome</h1><p class="brand">Brand text that should use the brand font.</p></section>
  <section id="features"><h3>Skipped level</h3><p class="faint">Low contrast copy on white.</p>
    <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="40" height="40">
    <button><svg width="16" height="16"></svg></button>
    <input type="email" placeholder="Email"></section>
  <section id="pricing" class="cramped"><h2>Pricing</h2><p class="tight">${"Long paragraph text with a tight line height. ".repeat(4)}</p><p class="oddfont">One odd font.</p></section>
  <section id="faq" class="lopsided"><h2>FAQ</h2><p>Answers.</p></section>
  <section id="contact"><h2>Contact</h2><p>Say hi.</p></section>
</main>
</body></html>`;

describe("design checks against real Chrome", { skip }, () => {
  let browser: Browser;
  let page: Page;
  let fixture: Fixture;
  let h: Awaited<ReturnType<typeof startServer>>;
  let ext: FakeExtension;

  before(async () => {
    fixture = await serve(PAGE);
    browser = await launch();
    page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    h = await startServer();
    ext = await h.connectExtension(browserHandlers(page, 7));
    await h.call("select_browser_tab", { tabId: 7 });
  });

  after(async () => {
    ext?.close();
    await h?.close();
    await browser?.close();
    await fixture?.close();
  });

  it("finds the font that failed to load, the one-off font, inverted headings and tight line-height", async () => {
    const r = await h.call("check_typography", { breakpoint: "desktop" });
    assert.equal(r.isError, false, r.text);
    const types = r.data.issues.map((i: any) => i.type);
    const missing = r.data.issues.find((i: any) => i.type === "font-not-loaded");
    assert.equal(missing?.family, "Brand Missing", JSON.stringify(r.data.issues));
    assert.ok(types.includes("heading-scale-inverted"), types.join());
    assert.ok(types.includes("tight-line-height"), types.join());
    assert.ok(r.data.families.some((f: any) => f.family === "Georgia"));
    assert.equal(r.data.breakpoint, "desktop");
  });

  it("reports accessibility problems with WCAG references", async () => {
    const r = await h.call("check_accessibility", { breakpoint: "mobile" });
    assert.equal(r.isError, false, r.text);
    const byType = (t: string) => r.data.issues.filter((i: any) => i.type === t);
    for (const t of ["html-lang-missing", "zoom-disabled", "image-alt-missing", "button-name-missing", "form-label-missing", "heading-level-skipped", "low-contrast"]) {
      assert.ok(byType(t).length, `${t} missing: ${r.data.issues.map((i: any) => i.type).join()}`);
    }
    const contrast = byType("low-contrast")[0];
    assert.ok(contrast.ratio < 4.5 && contrast.selector.includes("faint"), JSON.stringify(contrast));
    assert.equal(byType("form-label-missing")[0].wcag, "1.3.1");
    assert.ok(r.data.notChecked.length > 0);
  });

  it("measures the gaps between sections and flags the ones that break the rhythm", async () => {
    const r = await h.call("check_section_spacing", { breakpoint: "desktop" });
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.data.sections.map((s: any) => s.selector), ["#hero", "#features", "#pricing", "#faq", "#contact"]);
    assert.equal(r.data.gaps.length, 4);
    const flagged = r.data.issues.map((i: any) => `${i.type}:${(i.between || [i.selector]).join("|")}`);
    assert.ok(flagged.some((f: string) => f.startsWith("gap-too-small:#features|#pricing")), flagged.join());
    assert.ok(flagged.some((f: string) => f.startsWith("asymmetric-padding:#faq")), flagged.join());
    assert.ok(r.data.typicalWhitespace > 100);
  });

  it("restores the viewport after a breakpoint check", async () => {
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs[0].emulation, null);
  });
});
