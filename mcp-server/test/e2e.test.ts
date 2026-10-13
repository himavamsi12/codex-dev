// Real-browser tests: MCP client → MCP server → bridge → (fake extension) → Chrome.
// Skipped automatically when no Chrome is installed (set CHROME_PATH to point at one).
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "puppeteer-core";
import { FakeExtension, browserHandlers, chromePath, launch } from "./helpers/fake-extension.js";
import { BROKEN, FIXED, type Fixture, serve } from "./helpers/fixtures.js";
import { startServer } from "./helpers/harness.js";

const skip = chromePath() ? false : "Chrome not found (set CHROME_PATH)";

describe("end to end against real Chrome", { skip }, () => {
  let browser: Browser;
  let page: Page;
  let fixture: Fixture;
  let h: Awaited<ReturnType<typeof startServer>>;
  let ext: FakeExtension;
  let baselineId: string;

  before(async () => {
    fixture = await serve(BROKEN);
    browser = await launch();
    page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "load" });
    h = await startServer();
    ext = await h.connectExtension(browserHandlers(page, 7));
  });

  after(async () => {
    ext?.close();
    await h?.close();
    await browser?.close();
    await fixture?.close();
  });

  it("reports ready and lists the authorized tab", async () => {
    const st = await h.call("codex_dev_status");
    assert.equal(st.data.ready, true);
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs.length, 1);
    assert.equal(tabs.data.tabs[0].tabId, 7);
    const sel = await h.call("select_browser_tab", { tabId: 7 });
    assert.equal(sel.data.selected, true);
  });

  it("refuses a tab that is not authorized", async () => {
    const r = await h.call("select_browser_tab", { tabId: 99 });
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, "tab_not_authorized");
  });

  it("detects horizontal overflow and names the culprits at 375px, not the contained scroller", async () => {
    const r = await h.call("get_layout_overflow", { width: 375, height: 812 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.horizontalScroll, true);
    assert.ok(r.data.documentOverflowPx > 100);
    const selectors: string[] = r.data.overflowingElements.map((e: any) => e.selector);
    assert.ok(selectors.some((s) => s.includes("main-nav")), `nav missing: ${selectors}`);
    assert.ok(selectors.some((s) => s.includes("promo-banner")), `banner missing: ${selectors}`);
    assert.ok(!selectors.some((s) => s.includes("carousel") || s.includes("inner")), `contained scroller flagged: ${selectors}`);
    const nav = r.data.overflowingElements.find((e: any) => e.selector.includes("main-nav"));
    assert.equal(nav.confidence, "deterministic");
    assert.ok(nav.likelyCauses.some((c: string) => /nowrap|flex/i.test(c)), JSON.stringify(nav.likelyCauses));
    assert.equal(nav.computed["white-space"], "nowrap");
  });

  it("restores the viewport after a temporary measurement", async () => {
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs[0].emulation, null);
  });

  it("finds no overflow on desktop", async () => {
    const r = await h.call("get_layout_overflow", { width: 1280, height: 800 });
    assert.equal(r.data.horizontalScroll, false);
    assert.equal(r.data.overflowingElements.length, 0);
  });

  it("sets a named breakpoint with its device pixel ratio", async () => {
    const r = await h.call("set_breakpoint", { breakpoint: "tablet" });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.device, "iPad Air");
    assert.equal(r.data.measured.layoutWidth, 820);
    const tabs = await h.call("list_browser_tabs");
    assert.deepEqual(tabs.data.tabs[0].emulation, { width: 820, height: 1180, deviceScaleFactor: 2, mobile: true });
    await h.call("set_viewport", { reset: true });
  });

  it("captures mobile, tablet and desktop in one call and restores the viewport", async () => {
    const r = await h.call("capture_breakpoints", {});
    assert.equal(r.isError, false, r.text);
    assert.deepEqual(r.data.captures.map((c: any) => `${c.breakpoint}:${c.layoutWidth}`), ["mobile:393", "tablet:820", "desktop:1920"]);
    assert.equal(r.data.captures[0].horizontalScroll, true); // the broken fixture overflows on phones
    assert.equal(r.data.captures[2].horizontalScroll, false);
    assert.equal(r.content.filter((c: any) => c.type === "image").length, 3);
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs[0].emulation, null);
  });

  it("runs a multi-viewport audit with screenshots and stable ids", async () => {
    const r = await h.call("run_responsive_audit", {
      viewports: [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }],
    });
    assert.equal(r.isError, false, r.text);
    baselineId = r.data.reportId;
    assert.equal(r.data.summary.viewportsTested, 3);
    const byType = (t: string) => r.data.issues.filter((i: any) => i.type === t);
    const doc = byType("horizontal-overflow")[0];
    assert.ok(doc, "document overflow issue present");
    assert.equal(doc.id, "horizontal-overflow:document");
    assert.ok(doc.viewportWidths.includes(375));
    assert.ok(!doc.viewportWidths.includes(1280));
    const nav = byType("overflowing-element").find((i: any) => i.selector.includes("main-nav"));
    assert.ok(nav && /^overflowing-element:[0-9a-z]+$/.test(nav.id));
    for (const v of r.data.viewports) assert.ok(v.screenshot?.path, "screenshot saved");
    assert.ok(r.data.limitations.some((l: string) => /iframe viewer/.test(l)));
    // heuristics are labelled as such
    const tiny = r.data.issues.find((i: any) => i.type === "small-tap-target");
    assert.equal(tiny?.confidence, "heuristic");
    // viewport restored
    const tabs = await h.call("list_browser_tabs");
    assert.equal(tabs.data.tabs[0].emulation, null);
  });

  it("returns full occurrences with rects through get_audit_report", async () => {
    const r = await h.call("get_audit_report", { reportId: baselineId, detail: "full" });
    const nav = r.data.issues.find((i: any) => i.selector.includes("main-nav") && i.type === "overflowing-element");
    assert.ok(nav.occurrences[0].details.overflowingChildCount >= 2, "container reported once with its overflowing children");
    assert.ok(nav.occurrences[0].details.overflowingChildren.every((c: string) => c.startsWith("#main-nav")));
    assert.ok(nav.occurrences[0].viewport.width);
  });

  it("inspects an element: matched rules, flex context, hints", async () => {
    const r = await h.call("inspect_element", { selector: "#main-nav", viewport: { width: 375 } });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.layout.display, "flex");
    assert.equal(r.data.layout.flexContainer["flex-direction"], "row");
    assert.ok(r.data.matchedRules.some((m: any) => m.selector === ".nav" && /nowrap/.test(m.declarations)));
    assert.equal(r.data.rect.width, 375, JSON.stringify(r.data.viewport));
    assert.ok(r.data.scroll.scrollWidth > r.data.scroll.clientWidth, "content is wider than the box");
    assert.equal(r.data.viewport.layoutWidth, 375);
    assert.ok(r.data.ancestors.length >= 1);
  });

  it("reads computed styles and dimensions", async () => {
    const s = await h.call("get_computed_styles", { selector: "#promo-banner", properties: ["width", "max-width", "display"] });
    assert.deepEqual(Object.keys(s.data.styles).sort(), ["display", "max-width", "width"]);
    assert.equal(s.data.styles.width, "640px");
    const d = await h.call("get_element_dimensions", { selector: "#promo-banner", viewport: { width: 375 } });
    assert.equal(d.data.elements[0].extendsPastRight > 200, true);
    assert.equal(d.data.elements[0].inViewport, true);
  });

  it("rejects an invalid selector without crashing", async () => {
    const r = await h.call("inspect_element", { selector: "div[" });
    assert.equal(r.isError, true);
    assert.match(r.data.error.message, /Invalid CSS selector/);
  });

  it("returns a bounded page structure", async () => {
    const r = await h.call("get_page_structure", { selector: "body", depth: 2, maxNodes: 20 });
    assert.equal(r.data.root.tag, "body");
    assert.ok(r.data.nodes <= 21);
  });

  it("collects console errors and failed requests", async () => {
    await page.reload({ waitUntil: "networkidle0" });
    const c = await h.call("get_console_errors");
    assert.ok(c.data.entries.some((e: any) => /fixture console error/.test(e.message)), JSON.stringify(c.data));
    const n = await h.call("get_failed_requests");
    assert.ok(n.data.entries.some((e: any) => e.status === 404 && /missing\.json$/.test(e.url)), JSON.stringify(n.data));
  });

  it("previews a CSS patch, verifies it, and clears it", async () => {
    const patch = await h.call("preview_css_patch", { css: ".nav{flex-wrap:wrap}.banner{max-width:100%}", id: "fix" });
    assert.equal(patch.data.applied, true);
    assert.equal(patch.data.temporary, true);
    const r = await h.call("get_layout_overflow", { width: 375 });
    assert.equal(r.data.horizontalScroll, false, "patch removes the overflow");
    const shot = await h.call("take_screenshot", { viewport: { width: 375, height: 812 }, label: "patched" });
    assert.equal(shot.data.conditions.cssPreviewApplied, true);
    assert.ok(shot.content.some((c: any) => c.type === "image"));
    const cleared = await h.call("clear_css_patch", {});
    assert.deepEqual(cleared.data.removed, ["fix"]);
    const again = await h.call("get_layout_overflow", { width: 375 });
    assert.equal(again.data.horizontalScroll, true, "overflow is back once the patch is cleared");
  });

  it("verifies a source fix against the baseline", async () => {
    fixture.setHtml(FIXED);
    const r = await h.call("verify_responsive_fix", { baselineReportId: baselineId, waitMs: 0 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.verdict, "improved");
    const resolvedIds: string[] = r.data.comparison.resolved.map((x: any) => x.id);
    assert.ok(resolvedIds.includes("horizontal-overflow:document"));
    assert.equal(r.data.comparison.introduced.length, 0);
    assert.deepEqual(r.data.comparison.viewportsTested.sort((a: number, b: number) => a - b), [375, 768, 1280]);
    assert.ok(r.data.screenshotPairs.length >= 1);
  });

  it("diffs before/after screenshots", async () => {
    const pair = (await h.call("get_audit_report", { list: true })).data.reports.length;
    assert.ok(pair >= 2);
    fixture.setHtml(BROKEN);
    await page.reload({ waitUntil: "load" });
    const before = await h.call("take_screenshot", { viewport: { width: 375, height: 812 }, inline: false, label: "before" });
    fixture.setHtml(FIXED);
    await page.reload({ waitUntil: "load" });
    const after = await h.call("take_screenshot", { viewport: { width: 375, height: 812 }, inline: false, label: "after" });
    const same = await h.call("compare_screenshots", { before: after.data.screenshotId, after: after.data.screenshotId });
    assert.equal(same.data.identical, true);
    const diff = await h.call("compare_screenshots", { before: before.data.screenshotId, after: after.data.screenshotId });
    assert.equal(diff.data.comparable, true);
    assert.equal(diff.data.identical, false);
    assert.ok(diff.data.changedPixels > 0);
    assert.ok(diff.data.regions.length >= 1);
    assert.ok(diff.data.diffImage.path.endsWith(".png"));
    const mismatch = await h.call("take_screenshot", { viewport: { width: 500, height: 700 }, inline: false });
    const m = await h.call("compare_screenshots", { before: after.data.screenshotId, after: mismatch.data.screenshotId });
    assert.equal(m.data.comparable, false);
  });
});
