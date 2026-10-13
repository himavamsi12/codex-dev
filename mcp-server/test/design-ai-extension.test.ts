// Design Inspector AI panel driven in the real extension (Chrome for Testing).
// Skipped unless CHROME_FOR_TESTING_PATH is set (see real-extension.test.ts).
import assert from "node:assert/strict";
import { existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page, type WebWorker } from "puppeteer-core";
import { PNG } from "pngjs";
import { BROKEN, type Fixture, serve } from "./helpers/fixtures.js";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cft = process.env.CHROME_FOR_TESTING_PATH;
const skip = cft && existsSync(cft) ? false : "set CHROME_FOR_TESTING_PATH to a Chrome for Testing binary";

describe("Design Inspector AI panel in the real extension", { skip }, () => {
  let browser: Browser, page: Page, worker: WebWorker, fixture: Fixture, tabId: number, pngPath: string, txtPath: string;
  const external: string[] = [];
  const S = (sel: string) => `codex-design-ai-panel >>> ${sel}`;

  before(async () => {
    fixture = await serve(BROKEN);
    const dir = mkdtempSync(join(tmpdir(), "dai-"));
    const png = new PNG({ width: 40, height: 30 });
    png.data.fill(200);
    pngPath = join(dir, "ref.png");
    writeFileSync(pngPath, PNG.sync.write(png));
    txtPath = join(dir, "fake.png");
    writeFileSync(txtPath, "<svg onload=alert(1)>");
    browser = await puppeteer.launch({ executablePath: cft, headless: true, pipe: true, enableExtensions: [EXT_DIR], args: ["--no-sandbox"] });
    worker = (await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"))).worker())!;
    page = await browser.newPage();
    page.on("request", (r) => !r.url().startsWith(fixture.url) && !r.url().startsWith("data:") && !r.url().startsWith("blob:") && external.push(r.url()));
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(fixture.url, { waitUntil: "load" });
    tabId = (await worker.evaluate(`chrome.tabs.query({ url: ${JSON.stringify(fixture.url + "*")} }).then(t => t[0].id)`)) as number;
    // open shadow root in this isolated world only, so the test can reach the panel's controls
    await worker.evaluate(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, func: () => { window.__codexDesignAiTest = true; } })`);
    await worker.evaluate(`chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['utils/icons.js', 'utils/codex-ui.js'] }).then(() => chrome.scripting.executeScript({ target: { tabId: ${tabId} }, files: ['vendor/gsap/gsap.min.js', 'vendor/gsap/ScrollTrigger.min.js', 'design-ai/core.js', 'design-ai/provider.js', 'design-ai/animation.js', 'design-ai/engine.js', 'design-ai/panel.js'] }))`);
    await page.waitForSelector("codex-design-ai-panel");
  });
  after(async () => {
    await browser?.close();
    await fixture?.close();
  });

  const q = async (sel: string) => {
    const h = (await page.$(`pierce/${sel}`))!;
    await h.evaluate((e) => (e as HTMLElement).scrollIntoView({ block: "center" }));
    return h;
  };
  const style = (sel: string, prop: string) => page.evaluate((s, p) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p), sel, prop);
  const tab = (name: string) => q(`[data-tab="${name}"]`).then((b) => b.click());

  it("rejects a disguised file and accepts a real PNG reference", async () => {
    const input = (await q('[data-el="file"]')) as any;
    await input.uploadFile(txtPath);
    await page.waitForFunction(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="ref-err"]')!.textContent!.length > 0);
    assert.match(await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="ref-err"]')!.textContent!), /not a valid/);
    await input.uploadFile(pngPath);
    await page.waitForFunction(() => !document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector<HTMLElement>('[data-el="ref-card"]')!.hidden);
    const meta = await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="ref-meta"]')!.textContent!);
    assert.match(meta, /ref\.png/);
    assert.match(meta, /40 × 30px/);
  });

  it("keeps the reference in session memory for other tabs, and clears it on request", async () => {
    const stored = await worker.evaluate(`chrome.storage.session.get('designAiReference').then(r => !!r.designAiReference && r.designAiReference.width)`);
    assert.equal(stored, 40);
    await (await q('[data-el="ref-remove"]')).click();
    await page.waitForFunction(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector<HTMLElement>('[data-el="ref-card"]')!.hidden);
    assert.equal(await worker.evaluate(`chrome.storage.session.get('designAiReference').then(r => r.designAiReference || null)`), null);
  });

  it("selects a real section, restyles it with the builder, and the page updates", async () => {
    await tab("target");
    await (await q('[data-el="pick"]')).click();
    // empty part of the nav bar, left of the panel (the links fill the left side)
    await page.mouse.move(840, 20);
    await page.mouse.click(840, 20);
    await page.waitForFunction(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector<HTMLElement>('[data-el="target-card"]')!.hidden === false);
    assert.match(await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="t-meta"]')!.textContent!), /main-nav/);
    // the panel hides itself for a moment while it captures the thumbnail; wait for it to come back
    await page.waitForFunction(() => (document.querySelector("codex-design-ai-panel") as HTMLElement).style.visibility === "");
    await new Promise((r) => setTimeout(r, 400));
    await tab("design");
    await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelectorAll("details.group").forEach((d) => ((d as HTMLDetailsElement).open = true)));
    const bg = await q("#c-background-color");
    await bg.evaluate((e) => { (e as HTMLInputElement).focus(); (e as HTMLInputElement).select(); });
    await page.keyboard.type("#123456");
    await page.keyboard.press("Tab");
    assert.equal(await style("#main-nav", "background-color"), "rgb(18, 52, 86)");
    const pad = await q("#c-padding");
    await pad.evaluate((e) => (e as HTMLElement).focus());
    await page.keyboard.type("20");
    await page.keyboard.press("Tab");
    assert.equal(await style("#main-nav", "padding-top"), "20px");
    // invalid input is refused and shown
    const w = await q("#c-width");
    await w.evaluate((e) => (e as HTMLElement).focus());
    await page.keyboard.type("wide");
    await page.keyboard.press("Tab");
    assert.match(await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-err="width"]')!.textContent!), /not a valid length/);
    assert.notEqual(await style("#main-nav", "width"), "wide");
  });

  it("applies tablet rules at narrow widths", async () => {
    await (await q('[data-bp="tablet"]')).evaluate((e) => (e as HTMLElement).click());
    const fs = await q("#c-font-size");
    await fs.evaluate((e) => (e as HTMLElement).focus());
    await page.keyboard.type("30px");
    await page.keyboard.press("Tab");
    await page.setViewport({ width: 900, height: 800 });
    assert.equal(await style("#main-nav", "font-size"), "30px");
    await page.setViewport({ width: 1280, height: 800 });
    assert.notEqual(await style("#main-nav", "font-size"), "30px");
  });

  it("undoes, redoes and resets from the panel footer", async () => {
    await (await q('[data-el="undo"]')).click();
    assert.notEqual(await style("#main-nav", "font-size"), "30px");
    await (await q('[data-el="reset"]')).click();
    assert.equal(await page.evaluate(() => document.getElementById("main-nav")!.hasAttribute("data-cx-design")), false);
    assert.notEqual(await style("#main-nav", "background-color"), "rgb(18, 52, 86)");
  });

  it("exports the CSS that was actually applied", async () => {
    const bg = await q("#c-background-color");
    await bg.evaluate((e) => { (e as HTMLInputElement).focus(); (e as HTMLInputElement).select(); });
    await page.keyboard.type("#abcdef");
    await page.keyboard.press("Tab");
    await tab("export");
    const css = await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="x-out"]')!.textContent!);
    assert.match(css, /background-color: #abcdef !important;/);
    assert.match(css, /Applies to: #main-nav/);
  });

  it("generates a design with the AI, applies only allowed changes, and can undo", async () => {
    await worker.evaluate(`globalThis.handleAiDesign = async () => ({ ok: true, summary: 'Dark card look.', model: 't', quota: { limit: 20, remaining: 19 }, patch: { operations: [
      { op: 'set', property: 'background-color', value: '#0b1220', breakpoint: 'base' },
      { op: 'set', property: 'position', value: 'fixed', breakpoint: 'base' },
      { op: 'set', property: 'border-radius', value: '16px', breakpoint: 'base' }] } })`);
    await tab("design");
    // empty description is refused before anything is sent
    await (await q('[data-el="generate"]')).click();
    await page.waitForFunction(() => /Describe the design/.test(document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="gen-result"]')!.textContent!));
    await (await q('[data-el="instructions"]')).type("make it a dark card");
    await (await q('[data-el="generate"]')).click();
    await page.waitForFunction(() => /Design applied/.test(document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="gen-result"]')!.textContent!));
    const msg = await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="gen-result"]')!.textContent!);
    assert.match(msg, /1 change was skipped/);
    assert.match(msg, /19 of 20 free requests/);
    assert.equal(await style("#main-nav", "background-color"), "rgb(11, 18, 32)");
    assert.equal(await style("#main-nav", "border-top-left-radius"), "16px");
    assert.notEqual(await style("#main-nav", "position"), "fixed", "position is not an allowed property");
    await (await q('[data-el="undo"]')).click();
    assert.notEqual(await style("#main-nav", "background-color"), "rgb(11, 18, 32)");
    assert.deepEqual(external, [], "no external requests were made");
  });

  it("plays a described animation with GSAP, shows its code, and stops cleanly", async () => {
    await worker.evaluate(`globalThis.handleAiAnimate = async () => ({ ok: true, summary: 'Children fade in.', model: 't', animation: { scope: 'edit', summary: 'Children fade in.', trigger: 'load', scroll: null, repeat: 0, yoyo: false, repeatDelay: 0, steps: [{ target: 'children', selector: null, method: 'from', from: [{ property: 'opacity', value: '0' }, { property: 'y', value: '20' }], to: [], duration: 0.3, delay: 0, ease: 'power2.out', stagger: 0.05, staggerFrom: 'start', position: null }, { target: 'self', selector: null, method: 'to', from: [], to: [{ property: 'onclick', value: 'alert(1)' }], duration: 1, delay: 0, ease: 'bogus', stagger: 0, staggerFrom: 'start', position: null }] } })`);
    await tab("design");
    await (await q('[data-el="anim-prompt"]')).type("Fade the links in one by one");
    await (await q('[data-el="anim-generate"]')).click();
    await page.waitForFunction(() => /Animation playing/.test(document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="anim-result"]')!.textContent!));
    const steps = await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="anim-steps"]')!.textContent!);
    assert.match(steps, /1\. from/);
    assert.doesNotMatch(steps, /onclick/, "the unsafe step was dropped");
    await (await q('[data-aview="code"]')).click();
    const code = await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector('[data-el="anim-out"]')!.textContent!);
    assert.match(code, /gsap\.timeline/);
    assert.match(code, /tl\.from\(el\.children/);
    assert.doesNotMatch(code, /alert/);
    await (await q('[data-el="anim-stop"]')).click();
    assert.deepEqual(external, [], "no external requests were made");
  });

  it("keeps typing in the panel away from the page's key handlers", async () => {
    await page.evaluate(() => { (window as any).__keys = 0; document.addEventListener("keydown", () => { (window as any).__keys++; }); window.addEventListener("keyup", () => { (window as any).__keys++; }); });
    await tab("design");
    const box = await q('[data-el="instructions"]');
    await box.evaluate((e) => ((e as HTMLTextAreaElement).value = ""));
    await box.click();
    await page.keyboard.type("night grid");
    assert.equal(await page.evaluate(() => (window as any).__keys), 0, "page saw no key events from the panel");
    assert.equal(await page.evaluate(() => document.querySelector("codex-design-ai-panel")!.shadowRoot!.querySelector<HTMLTextAreaElement>('[data-el="instructions"]')!.value), "night grid");
  });

  it("removes every trace when everything is reset", async () => {
    await (await q('[data-el="reset-all"]')).click();
    assert.equal(await page.evaluate(() => document.querySelectorAll("[data-cx-design], #codex-design-ai-style").length), 0);
  });
});
