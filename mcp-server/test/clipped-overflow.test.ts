// Real-browser regressions for two audit false positives seen on live sites:
// body { overflow-x: clip } reported as sideways scroll, and links inside a
// collapsed dropdown reported as covered controls.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "puppeteer-core";
import { FakeExtension, browserHandlers, chromePath, launch } from "./helpers/fake-extension.js";
import { type Fixture, serve } from "./helpers/fixtures.js";
import { startServer } from "./helpers/harness.js";

const skip = chromePath() ? false : "Chrome not found (set CHROME_PATH)";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Clipped page</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html{overflow:auto}
  body{margin:0;font:16px/1.4 sans-serif;overflow-x:clip}
  .glow{width:900px;height:40px;background:#cde}
  .menu{height:0;overflow:hidden}
  .menu a{display:block;padding:12px 16px}
  .hero{position:relative;height:400px;background:#eee}
  .panel{position:fixed;top:60px;left:0;right:0;pointer-events:none}
</style></head><body>
<div class="glow" id="glow"></div>
<nav><button id="toggle">Platform</button><div class="menu" id="menu"><a href="#a">Observability</a><a href="#b">Posture</a></div></nav>
<div class="panel"><button>Use Cases</button><button>Resources</button></div>
<section class="hero">Hero</section>
</body></html>`;

describe("audit ignores clipped overflow and closed menus", { skip }, () => {
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

  it("does not report sideways scroll when body clips the overflow", async () => {
    const r = await h.call("get_layout_overflow", { width: 393, height: 852 });
    assert.equal(r.isError, false, r.text);
    assert.equal(r.data.horizontalScroll, false);
    assert.equal(r.data.documentOverflowPx, 0);
    assert.equal(r.data.pageClipsHorizontalOverflow, true);
  });

  it("does not report links inside a collapsed menu as covered", async () => {
    const r = await h.call("run_responsive_audit", { viewports: [{ width: 393, height: 852 }], screenshots: false, detail: "full" });
    assert.equal(r.isError, false, r.text);
    const types: string[] = r.data.issues.map((i: any) => i.type);
    assert.ok(!types.includes("horizontal-overflow"), `false sideways scroll: ${types}`);
    assert.ok(!types.includes("overlapping-control"), `closed menu flagged: ${JSON.stringify(r.data.issues.filter((i: any) => i.type === "overlapping-control").map((i: any) => i.selector))}`);
  });
});
