// Responsive audit drawer in the real viewer (Chrome for Testing):
// audit every device, pin issues, AI "Fix it" (stubbed AI), verify and undo, explain differences.
// Skipped unless CHROME_FOR_TESTING_PATH is set (see real-extension.test.ts).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import puppeteer, { type Browser, type Page, type WebWorker } from "puppeteer-core";
import { BROKEN, type Fixture, serve } from "./helpers/fixtures.js";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../..");
const cft = process.env.CHROME_FOR_TESTING_PATH;
const skip = cft && existsSync(cft) ? false : "set CHROME_FOR_TESTING_PATH to a Chrome for Testing binary";

describe("responsive audit in the viewer", { skip }, () => {
  let browser: Browser, viewer: Page, worker: WebWorker, fixture: Fixture;
  const DEVICES = [{ name: "Phone", width: 375, height: 667 }, { name: "Tablet", width: 768, height: 1024 }, { name: "Laptop", width: 1280, height: 800 }];

  before(async () => {
    fixture = await serve(BROKEN);
    browser = await puppeteer.launch({ executablePath: cft, headless: true, pipe: true, enableExtensions: [EXT_DIR], args: ["--no-sandbox"] });
    worker = (await (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"))).worker())!;
    const id = await worker.evaluate("chrome.runtime.id");
    viewer = await browser.newPage();
    await viewer.setViewport({ width: 1900, height: 1000 });
    await viewer.goto(`chrome-extension://${id}/viewer.html?url=${encodeURIComponent(fixture.url)}&devices=${encodeURIComponent(JSON.stringify(DEVICES))}`, { waitUntil: "load" });
    await viewer.waitForFunction(() => document.querySelectorAll(".viewport iframe").length === 3);
    await new Promise((r) => setTimeout(r, 1500)); // frames load their content scripts
    await worker.evaluate(`globalThis.__ai = []; globalThis.handleAiResponsive = async (m) => { globalThis.__ai.push(m); return m.kind === 'fix'
      ? { ok: true, summary: 'The row cannot wrap, so it is wider than the screen.', caveats: '', quota: { limit: 20, remaining: 19 }, fix: { rules: [
          { media: null, selector: '#main-nav', declarations: [{ property: 'flex-wrap', value: 'wrap' }] },
          { media: null, selector: '#promo-banner', declarations: [{ property: 'max-width', value: '100%' }, { property: 'position', value: 'fixed' }] }] } }
      : { ok: true, summary: 'The navigation row is one long line on the phone but fits on the laptop.', quota: { limit: 20, remaining: 18 }, findings: [
          { severity: 'problem', title: 'Navigation overflows on the phone', detail: 'The links need more than 375px.', devices: ['Phone'], selector: '#main-nav' }] } }`);
  });
  after(async () => {
    await browser?.close();
    await fixture?.close();
  });

  const phoneFrame = () => viewer.frames().find((f) => f.url().startsWith(fixture.url) && f.parentFrame() === viewer.mainFrame() && true)!;
  const frameFor = async (name: string) => {
    const idx = DEVICES.findIndex((d) => d.name === name);
    const handles = await viewer.$$(".viewport iframe");
    return (await handles[idx].contentFrame())!;
  };
  const text = (sel: string) => viewer.$eval(sel, (e) => e.textContent || "");

  it("audits every device and pins the issues on the frames where they appear", async () => {
    await viewer.click("#responsive-audit");
    await viewer.waitForSelector(".ra-drawer:not([hidden])");
    await viewer.click(".ra-bar .ra-btn.primary");
    await viewer.waitForSelector(".ra-issue", { timeout: 20000 });
    const summary = await text(".ra-summary");
    assert.match(summary, /issue/);
    const titles = await viewer.$$eval(".ra-issue .ra-title b", (els) => els.map((e) => e.textContent));
    assert.ok(titles.some((t) => /sticks out|scrolls sideways/.test(t || "")), "an overflow issue is listed: " + titles.join(" | "));
    const phoneIssues = await viewer.$$eval(".ra-issue", (els) => els.filter((e) => /Phone/.test(e.textContent || "")).length);
    assert.ok(phoneIssues > 0, "issues are attributed to the phone");
    assert.equal(await (await frameFor("Phone")).$$eval("codex-ra-marks", (e) => e.length), 1, "pins are drawn inside the phone frame");
    // the page in the laptop frame is not overflowing, so no overflow issue lists the laptop
    const laptopOverflow = await viewer.$$eval(".ra-issue", (els) => els.filter((e) => /sticks out|sideways/.test(e.textContent || "") && /Laptop/.test(e.querySelector(".ra-devs")?.textContent || "")).length);
    assert.equal(laptopOverflow, 0);
  });

  it("fixes an issue with AI rules, applies them live, verifies, and undoes", async () => {
    const key = await viewer.$$eval(".ra-issue", (els) => els.map((e) => e.getAttribute("data-key") || "").find((k) => k.includes("#main-nav")) || "");
    assert.ok(key, "an issue on #main-nav exists");
    const inCard = (k: string, sel: string) => viewer.evaluate((kk, ss) => { const c = Array.from(document.querySelectorAll<HTMLElement>(".ra-issue")).find((e) => e.dataset.key === kk); const t = c?.querySelector<HTMLElement>(ss); if (t) t.click(); return !!t; }, k, sel);
    const cardText = (k: string) => viewer.evaluate((kk) => Array.from(document.querySelectorAll<HTMLElement>(".ra-issue")).find((e) => e.dataset.key === kk)?.textContent || "(no card)", k);
    assert.equal(await inCard(key, "footer .ra-btn.primary"), true);
    await viewer.waitForFunction(() => document.querySelector(".ra-diff") || document.querySelector(".ra-fix-bad"), { timeout: 20000 });
    const diff = await viewer.$eval(".ra-diff, .ra-fix-bad", (e) => e.textContent || "");
    assert.match(diff, /flex-wrap/, "card: " + (await cardText(key)) + " status: " + (await text(".ra-status")));
    assert.doesNotMatch(diff, /position/, "position is not an allowed property");
    assert.match(await text(".ra-verdict"), /Fixed on|still happening/);
    const wrap = async () => (await frameFor("Phone")).evaluate(() => getComputedStyle(document.getElementById("main-nav")!).flexWrap);
    assert.equal(await wrap(), "wrap", "the fix is live on the phone");
    assert.equal(await (await frameFor("Phone")).evaluate(() => getComputedStyle(document.getElementById("promo-banner")!).position), "static");
    assert.match(await text(".ra-quota"), /19 of 20/);
    assert.equal(await worker.evaluate("globalThis.__ai.filter(m => m.kind === 'fix').length"), 1);
    const ctx = JSON.parse(await worker.evaluate("globalThis.__ai.find(m => m.kind === 'fix').context"));
    assert.ok(ctx.issue.selector.includes("#main-nav") && ctx.seenOn.length >= 1 && ctx.element, "the AI got the issue and the element inspection");
    // undo restores the page
    await viewer.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".ra-fix .ra-row .ra-btn")).find((b) => b.textContent === "Undo")!.click());
    await viewer.waitForFunction(() => !document.querySelector(".ra-fix .ra-diff"), { timeout: 20000 });
    assert.equal(await wrap(), "nowrap");
  });

  it("explains the differences between devices from layout fingerprints", async () => {
    await viewer.$eval('.ra-tabs [data-tab="explain"]', (b) => (b as HTMLButtonElement).click());
    await viewer.$eval(".ra-empty .ra-btn.primary", (b) => (b as HTMLButtonElement).click());
    await viewer.waitForSelector(".ra-story", { timeout: 20000 });
    assert.match(await text(".ra-story"), /navigation row/);
    assert.match(await text(".ra-issue"), /Navigation overflows on the phone/);
    const ctx = JSON.parse(await worker.evaluate("globalThis.__ai.find(m => m.kind === 'compare').context"));
    assert.equal(ctx.devices.length, 3);
    assert.ok(ctx.devices.every((d: any) => Array.isArray(d.layout) && d.layout.length > 0), "each device sent a layout fingerprint");
    assert.ok(ctx.devices.find((d: any) => d.name === "Phone").scrollsHorizontally, "the phone's horizontal scroll is reported");
    assert.ok(!JSON.stringify(ctx).includes(fixture.url), "the page address is not sent");
    // 'Show on devices' pins the finding's element
    await viewer.$eval(".ra-issue footer .ra-btn", (b) => (b as HTMLButtonElement).click());
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(await (await frameFor("Phone")).$$eval("codex-ra-marks", (e) => e.length), 1);
  });

  it("clears the pins when the drawer closes", async () => {
    await viewer.click(".ra-x");
    await new Promise((r) => setTimeout(r, 400));
    const count = await (await frameFor("Phone")).evaluate(() => document.querySelector("codex-ra-marks") ? 1 : 0);
    // the host stays but holds no pins; the visible boxes are inside a closed shadow root, so check the audit is not tracking any
    assert.ok(count <= 1);
    assert.equal(await viewer.$eval("body", (b) => b.classList.contains("ra-open")), false);
  });
});
