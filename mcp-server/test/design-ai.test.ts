// Design Inspector AI: core logic, provider interface and the page engine.
// The engine runs in real Chrome (puppeteer) because it depends on layout,
// computed styles, events and CSP behaviour.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import type { Browser, Page } from "puppeteer-core";
import { chromePath, launch } from "./helpers/fake-extension.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../../design-ai");
const src = (f: string) => readFileSync(join(DIR, f), "utf8");

function loadNode() {
  const sandbox: any = { self: {} };
  sandbox.globalThis = sandbox.self;
  vm.createContext(sandbox);
  for (const f of ["core.js", "provider.js", "animation.js", "responsive-fix.js"]) vm.runInContext(src(f), sandbox, { filename: f });
  return sandbox.self as { DesignAICore: any; DesignAIProviders: any; DesignAIAnimation: any; ResponsiveFix: any };
}

describe("design-ai core: images", () => {
  const { DesignAICore: C } = loadNode();
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

  it("accepts PNG, JPEG and WebP whose bytes match their type", () => {
    assert.equal(C.validateImageBytes({ type: "image/png", size: 100 }, png).ok, true);
    assert.equal(C.validateImageBytes({ type: "image/jpeg", size: 100 }, jpg).ok, true);
    assert.equal(C.validateImageBytes({ type: "image/webp", size: 100 }, webp).ok, true);
  });

  it("rejects unsupported types, empty and oversized files", () => {
    for (const type of ["image/gif", "image/svg+xml", "application/pdf", "text/html", ""]) {
      const r = C.validateImageMeta({ type, size: 10 });
      assert.equal(r.ok, false, type);
      assert.match(r.error, /PNG, JPEG or WebP/);
    }
    assert.match(C.validateImageMeta({ type: "image/png", size: 0 }).error, /empty/);
    assert.match(C.validateImageMeta({ type: "image/png", size: 11 * 1024 * 1024 }).error, /limit is 10\.0 MB/);
    assert.equal(C.validateImageMeta(null).ok, false);
  });

  it("rejects corrupted or disguised files by their signature", () => {
    const text = new TextEncoder().encode("<svg onload=alert(1)>");
    assert.match(C.validateImageBytes({ type: "image/png", size: 20 }, text).error, /not a valid/);
    assert.match(C.validateImageBytes({ type: "image/png", size: 20 }, jpg).error, /says it is PNG but .* JPEG/);
    assert.match(C.validateImageBytes({ type: "image/png", size: 3 }, new Uint8Array(0)).error, /not a valid/);
  });

  it("rejects unreadable and gigantic dimensions", () => {
    assert.equal(C.validateImageDimensions(0, 10).ok, false);
    assert.equal(C.validateImageDimensions(9000, 9000).ok, false);
    assert.equal(C.validateImageDimensions(1920, 1080).ok, true);
  });
});

describe("design-ai core: patch validation", () => {
  const { DesignAICore: C } = loadNode();
  const set = (property: string, value: string, breakpoint?: string) => ({ op: "set", property, value, breakpoint });

  it("normalises values and applies defaults", () => {
    const r = C.validatePatch({ operations: [set("padding", "16 24"), set("color", "#fff"), set("opacity", "0.5"), set("display", "FLEX"), set("width", "50%"), set("font-weight", "700")] });
    assert.equal(r.ok, true, r.errors.join("|"));
    assert.deepEqual(Array.from(r.operations, (o: any) => o.value), ["16px 24px", "#fff", "0.5", "flex", "50%", "700"]);
    assert.ok(r.operations.every((o: any) => o.breakpoint === "base"));
  });

  it("rejects properties that are not on the allow-list", () => {
    for (const p of ["position", "z-index", "content", "pointer-events", "filter", "behavior", "__proto__", "background-position", "--x"]) {
      assert.equal(C.validatePatch({ operations: [set(p, "1")] }).ok, false, p);
    }
  });

  it("rejects values that could load resources or break out of the rule", () => {
    const bad = [
      ["background-image", "url(https://evil.example/x.png)"],
      ["background", "url(data:image/png;base64,AAAA)"],
      ["color", "red; position: fixed"],
      ["color", "red} body{display:none"],
      ["width", "expression(alert(1))"],
      ["font-family", "x;} @import 'a.css'"],
      ["background-image", "image-set(url(a.png) 1x)"],
      ["color", "javascript:alert(1)"],
      ["background-color", "red /* x */"],
      ["width", "calc(1px"],
      ["opacity", "2"],
      ["display", "none"],
      ["padding", "1px 2px 3px 4px 5px"],
      ["width", "wide"],
      ["color", ""],
      ["color", "x".repeat(400)],
      ["font-weight", "heavy"],
    ];
    for (const [p, v] of bad) assert.equal(C.validateDeclaration(p, v).ok, false, `${p}: ${v}`);
  });

  it("allows gradients and calc()", () => {
    assert.equal(C.validateDeclaration("background-image", "linear-gradient(135deg, #111 0%, #333 100%)").ok, true);
    assert.equal(C.validateDeclaration("background", "radial-gradient(circle at 20% 20%, rgba(255,0,0,.3), transparent)").ok, true);
    assert.equal(C.validateDeclaration("width", "calc(100% - 32px)").ok, true);
    assert.equal(C.validateDeclaration("box-shadow", "0 10px 30px rgba(0,0,0,.25)").ok, true);
  });

  it("is all-or-nothing and reports every problem", () => {
    const r = C.validatePatch({ operations: [set("color", "red"), set("position", "fixed"), { op: "run", code: "alert(1)" }, set("color", "red", "watch")] });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 3);
    assert.equal(C.validatePatch({}).ok, false);
    assert.equal(C.validatePatch({ operations: [] }).ok, false);
    assert.equal(C.validatePatch({ operations: Array(61).fill(set("color", "red")) }).ok, false);
    assert.equal(C.validatePatch({ operations: [{ op: "text", value: "" }] }).ok, false);
  });
});

describe("design-ai core: patch history and CSS", () => {
  const { DesignAICore: C } = loadNode();
  const patch = (...ops: any[]) => ({ operations: ops });
  const set = (property: string, value: string, breakpoint = "base") => ({ op: "set", property, value, breakpoint });

  it("applies, undoes, redoes and resets", () => {
    const s = new C.PatchStore();
    assert.equal(s.isEmpty(), true);
    assert.equal(s.apply(patch(set("color", "red")), "Colour").ok, true);
    assert.equal(s.apply(patch(set("padding", "8")), "Padding").ok, true);
    assert.deepEqual(Array.from(s.changes(), (c: any) => c.property), ["color", "padding"]);
    assert.equal(s.undo(), true);
    assert.deepEqual(Array.from(s.changes(), (c: any) => c.property), ["color"]);
    assert.equal(s.canRedo(), true);
    assert.equal(s.redo(), true);
    assert.equal(s.changes().length, 2);
    s.apply(patch(set("color", "blue")), "Colour 2");
    assert.equal(s.canRedo(), false, "a new change clears redo");
    assert.equal(s.undo() && s.undo() && s.undo(), true);
    assert.equal(s.undo(), false);
    assert.equal(s.isEmpty(), true);
    s.apply(patch(set("color", "red")));
    s.reset();
    assert.equal(s.isEmpty(), true);
    assert.equal(s.canUndo() || s.canRedo(), false);
  });

  it("removes an override with a remove operation and ignores no-op changes", () => {
    const s = new C.PatchStore();
    s.apply(patch(set("color", "red")));
    assert.equal(s.apply(patch(set("color", "red"))).changed, false);
    assert.equal(s.past.length, 1, "a no-op adds no history");
    s.apply(patch({ op: "remove", property: "color" }));
    assert.equal(s.isEmpty(), true);
  });

  it("does not change state when a patch is invalid", () => {
    const s = new C.PatchStore();
    s.apply(patch(set("color", "red")));
    const r = s.apply(patch(set("padding", "8"), set("position", "fixed")));
    assert.equal(r.ok, false);
    assert.deepEqual(Array.from(s.changes(), (c: any) => c.property), ["color"]);
  });

  it("emits desktop, tablet and mobile rules in cascade order", () => {
    const s = new C.PatchStore();
    s.apply(patch(set("font-size", "20px", "mobile"), set("font-size", "32px"), set("font-size", "26px", "tablet")));
    const css = s.toCss(".hero");
    const order = [css.indexOf(".hero {\n  font-size: 32px"), css.indexOf("max-width: 1024px"), css.indexOf("max-width: 640px")];
    assert.ok(order.every((n) => n >= 0) && order[0] < order[1] && order[1] < order[2], css);
    assert.match(css, /font-size: 32px !important;/);
    assert.doesNotMatch(s.toCss(".hero", { important: false }), /important/);
  });
});

describe("design-ai provider interface", () => {
  it("fails with an explicit error when no provider is configured", async () => {
    const { DesignAIProviders: P } = loadNode();
    assert.equal(P.isConfigured(), false);
    await assert.rejects(P.generateDesign({ targetContext: {}, instructions: "x" }), (e: any) => e.code === "provider_not_configured" && /manual builder/.test(e.message));
    await assert.rejects(P.current().analyzeReference({}), (e: any) => e.code === "provider_not_configured");
    await assert.rejects(P.current().generatePatch({}), (e: any) => e.code === "provider_not_configured");
  });

  it("rejects malformed providers", () => {
    const { DesignAIProviders: P } = loadNode();
    assert.throws(() => P.register({ id: "x" }), (e: any) => e.code === "invalid_provider");
    assert.throws(() => P.register(null), (e: any) => e.code === "invalid_provider");
    assert.equal(P.isConfigured(), false);
  });

  it("runs a registered provider through the same patch validation (test double, not shipped)", async () => {
    const { DesignAIProviders: P } = loadNode();
    const calls: string[] = [];
    P.register({
      id: "test-double",
      analyzeReference: async (i: any) => (calls.push("analyze:" + i.instructions), { summary: "double" }),
      generatePatch: async () => ({ operations: [{ op: "set", property: "padding", value: "12" }] }),
    });
    const r = await P.generateDesign({ targetContext: { tag: "div" }, instructions: "go", referenceImage: null });
    assert.deepEqual(calls, ["analyze:go"]);
    assert.equal(r.provider, "test-double");
    assert.equal(r.patch.operations[0].value, "12px", "provider output is normalised by the validator");

    P.register({ id: "bad", analyzeReference: async () => ({}), generatePatch: async () => ({ operations: [{ op: "set", property: "position", value: "fixed" }] }) });
    await assert.rejects(P.generateDesign({ targetContext: {} }), (e: any) => e.code === "invalid_patch");
    P.register({ id: "throws", analyzeReference: async () => { throw new Error("boom"); }, generatePatch: async () => ({}) });
    await assert.rejects(P.generateDesign({ targetContext: {} }), (e: any) => e.code === "provider_error" && /boom/.test(e.message));
    P.unregister();
    await assert.rejects(P.generateDesign({ targetContext: {} }), (e: any) => e.code === "provider_not_configured");
  });
});

// ── Engine in real Chrome ────────────────────────────────────────────
const skip = chromePath() ? false : "Chrome not found (set CHROME_PATH)";

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture</title>
<style id="site-style">
  body{margin:0;font:16px/1.4 sans-serif;background:#fff;color:#222}
  .hero{padding:10px;background:#eee;color:#333}
  .hero h1{margin:0;font-size:24px}
  .card{padding:4px;background:#ddd}
  #cta{display:inline-block;padding:6px 12px;background:#ccc}
</style></head><body>
<header id="top"><a id="nav-link" href="/navigated">Nav</a></header>
<section class="hero" id="hero"><h1 id="title">Welcome</h1><p id="copy">Hello there</p>
  <button id="cta" onclick="window.__clicks=(window.__clicks||0)+1">Buy</button>
  <script>window.__scriptRan = true</script></section>
<section class="card" id="card-1"><span id="leaf">Leaf text</span></section>
<form id="f" onsubmit="window.__submitted=true;return false"><input id="in" value="secret-value"><button id="submit">Go</button></form>
<a id="evil" href="javascript:alert(1)" onclick="alert(1)">x</a>
</body></html>`;

describe("design-ai engine in Chrome", { skip }, () => {
  let browser: Browser, page: Page, server: Server, base: string;
  const external: string[] = [];
  const core = skip ? "" : src("core.js"), prov = skip ? "" : src("provider.js"), engine = skip ? "" : src("engine.js");

  before(async () => {
    server = createServer((req, res) => {
      const csp = req.url?.startsWith("/csp") ? { "content-security-policy": "default-src 'self'; style-src 'none'; script-src 'unsafe-inline'" } : {};
      if (req.url === "/navigated") return void res.writeHead(200, { "content-type": "text/html" }).end("<p>navigated</p>");
      res.writeHead(200, { "content-type": "text/html", ...csp }).end(PAGE);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launch();
  });
  after(async () => {
    await browser?.close();
    server?.close();
  });

  async function fresh(path = "/") {
    page = await browser.newPage();
    external.length = 0;
    page.on("request", (r) => !r.url().startsWith(base) && !r.url().startsWith("data:") && external.push(r.url()));
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(base + path, { waitUntil: "load" });
    await page.evaluate(core);
    await page.evaluate(prov);
    await page.evaluate(engine);
  }
  const E = <T>(fn: string): Promise<T> => page.evaluate(`(() => { const E = CodexDesignEngine; return (${fn}); })()`) as Promise<T>;
  const style = (sel: string, prop: string) => page.evaluate((s, p) => getComputedStyle(document.querySelector(s)!).getPropertyValue(p), sel, prop);
  const ops = (...o: any[]) => JSON.stringify({ operations: o });

  it("picks an element without triggering the site's links, buttons or forms; Escape cancels", async () => {
    await fresh();
    await E(`E.startPicker({})`);
    assert.equal(await E(`E.isPicking()`), true);
    await page.mouse.move(100, 60);
    assert.equal(await page.evaluate(() => document.querySelectorAll("codex-design-ai-hl").length), 1, "highlight overlay shown");
    // clicks on a link, a button and a form control are swallowed while picking
    const cta = await (await page.$("#cta"))!.boundingBox();
    await page.mouse.click(cta!.x + 5, cta!.y + 5);
    assert.equal(await page.evaluate(() => (window as any).__clicks || 0), 0, "site button handler did not run");
    assert.equal(await E(`E.isPicking()`), false, "click picked and ended selection");
    assert.equal(await E(`E.context().tag`), "button");
    await E(`E.startPicker({})`);
    const link = await (await page.$("#nav-link"))!.boundingBox();
    await page.mouse.click(link!.x + 3, link!.y + 3);
    assert.ok(page.url().endsWith("/"), "link did not navigate");
    assert.equal(await E(`E.context().tag`), "a");
    // Escape
    await E(`E.startPicker({})`);
    await page.mouse.move(100, 120);
    await page.keyboard.press("Escape");
    assert.equal(await E(`E.isPicking()`), false);
    assert.equal(await E(`E.context().tag`), "a", "target unchanged by cancel");
    // clean up: no overlays, cursor restored, site handlers work again
    assert.equal(await page.evaluate(() => document.querySelectorAll("codex-design-ai-hl").length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.style.cursor), "");
    await page.click("#cta");
    assert.equal(await page.evaluate(() => (window as any).__clicks), 1, "site handlers are back to normal");
    await page.close();
  });

  it("does not pick its own panel or the whole document", async () => {
    await fresh();
    assert.deepEqual(await E(`E.selectBySelector('html')`), { ok: false, error: "Pick a section inside the page, not the whole document." });
    assert.equal((await E<any>(`E.selectBySelector('div[')`)).ok, false);
    assert.equal((await E<any>(`E.selectBySelector('#nope')`)).ok, false);
    await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", "<codex-design-ai-panel id='own'></codex-design-ai-panel>"));
    assert.equal((await E<any>(`E.selectBySelector('#own')`)).ok, false);
    await page.close();
  });

  it("previews real changes on the selected element only, and leaves the site's CSS alone", async () => {
    await fresh();
    const siteCssBefore = await page.evaluate(() => document.getElementById("site-style")!.textContent);
    const others = ["#card-1", "#cta", "#title"];
    const before = await Promise.all(others.map((s) => style(s, "background-color")));
    await E(`E.selectBySelector('#hero')`);
    const r = await E<any>(`E.apply(${ops({ op: "set", property: "background-color", value: "#102030" }, { op: "set", property: "padding", value: "40" }, { op: "set", property: "border-radius", value: "12" }, { op: "set", property: "font-size", value: "22px" })}, 'Manual')`);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(await style("#hero", "background-color"), "rgb(16, 32, 48)");
    assert.equal(await style("#hero", "padding-top"), "40px");
    assert.equal(await style("#hero", "border-top-left-radius"), "12px");
    assert.equal(await page.evaluate(() => document.getElementById("hero")!.getAttribute("data-cx-design")), "d1");
    assert.deepEqual(await Promise.all(others.map((s) => style(s, "background-color"))), before, "other elements unchanged");
    assert.equal(await page.evaluate(() => document.getElementById("site-style")!.textContent), siteCssBefore, "site stylesheet untouched");
    assert.equal(await page.evaluate(() => document.querySelectorAll("style#codex-design-ai-style").length), 1, "one extension-owned stylesheet");
    assert.deepEqual(external, [], "no network requests beyond the page itself");
    await page.close();
  });

  it("supports multiple iterations, undo, redo and reset, and cleans up after itself", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'one')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "blue" })}, 'two')`);
    assert.equal(await style("#hero", "color"), "rgb(0, 0, 255)");
    assert.equal(await E(`E.undo()`), true);
    assert.equal(await style("#hero", "color"), "rgb(255, 0, 0)");
    assert.equal(await E(`E.redo()`), true);
    assert.equal(await style("#hero", "color"), "rgb(0, 0, 255)");
    assert.equal(await E(`E.undo() && E.undo()`), true);
    assert.equal(await style("#hero", "color"), "rgb(51, 51, 51)", "back to the site's colour");
    await E(`E.apply(${ops({ op: "set", property: "color", value: "green" })}, 'three')`);
    assert.equal(await E(`E.reset()`), true);
    assert.equal(await style("#hero", "color"), "rgb(51, 51, 51)");
    assert.equal(await page.evaluate(() => document.getElementById("hero")!.hasAttribute("data-cx-design")), false, "attribute removed");
    assert.equal(await page.evaluate(() => !!document.getElementById("codex-design-ai-style")), false, "stylesheet removed");
    assert.equal((await E<any>(`E.summary()`)).canUndo, false);
    await page.close();
  });

  it("rejects invalid patches without touching the page", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const bad of [
      { op: "set", property: "background-image", value: "url(https://evil.example/t.png)" },
      { op: "set", property: "position", value: "fixed" },
      { op: "set", property: "color", value: "notacolour123" },
      { op: "set", property: "display", value: "flex; } body { display:none" },
      { op: "run", value: "alert(1)" },
    ]) {
      const r = await E<any>(`E.apply(${ops(bad)}, 'x')`);
      assert.equal(r.ok, false, JSON.stringify(bad));
      assert.equal(r.code, "invalid_patch");
    }
    assert.equal(await page.evaluate(() => document.documentElement.outerHTML), html, "page is byte-identical");
    assert.deepEqual(external, []);
    assert.equal((await E<any>(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'x')`)).ok, true);
    const noTarget = await E<any>(`(E.resetAll(), E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'x'))`);
    assert.equal(noTarget.code, "no_target");
    await page.close();
  });

  it("applies responsive rules per breakpoint as the viewport changes", async () => {
    await fresh();
    await E(`E.selectBySelector('#title')`);
    await E(`E.apply(${ops({ op: "set", property: "font-size", value: "48px" }, { op: "set", property: "font-size", value: "34px", breakpoint: "tablet" }, { op: "set", property: "font-size", value: "22px", breakpoint: "mobile" })}, 'Responsive')`);
    for (const [w, expected] of [[1280, "48px"], [900, "34px"], [390, "22px"], [1280, "48px"]] as const) {
      await page.setViewport({ width: w, height: 800 });
      assert.equal(await style("#title", "font-size"), expected, `${w}px`);
    }
    await page.close();
  });

  it("works under a Content-Security-Policy that blocks inline styles", async () => {
    await fresh("/csp");
    await E(`E.selectBySelector('#hero')`);
    const r = await E<any>(`E.apply(${ops({ op: "set", property: "background-color", value: "#abcdef" })}, 'csp')`);
    assert.equal(r.ok, true);
    assert.equal(await style("#hero", "background-color"), "rgb(171, 205, 239)");
    assert.equal(await E(`E.reset()`), true);
    assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0, "constructed sheet removed on reset");
    await page.close();
  });

  it("replaces text only on leaf elements and restores it", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    const bad = await E<any>(`E.apply(${ops({ op: "text", value: "New" })}, 'text')`);
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /no child elements/);
    await E(`E.selectBySelector('#leaf')`);
    assert.equal((await E<any>(`E.apply(${ops({ op: "text", value: "Changed text" })}, 'text')`)).ok, true);
    assert.equal(await page.evaluate(() => document.getElementById("leaf")!.textContent), "Changed text");
    await E(`E.undo()`);
    assert.equal(await page.evaluate(() => document.getElementById("leaf")!.textContent), "Leaf text");
    await E(`E.apply(${ops({ op: "text", value: "Again" })}, 'text')`);
    await E(`E.reset()`);
    assert.equal(await page.evaluate(() => document.getElementById("leaf")!.textContent), "Leaf text");
    await page.close();
  });

  it("survives the site re-rendering the element, and reports an element that is gone", async () => {
    await fresh();
    await E(`E.selectBySelector('#card-1')`);
    await E(`E.apply(${ops({ op: "set", property: "background-color", value: "#ff0000" })}, 'a')`);
    // framework-style re-render: same markup, new node
    await page.evaluate(() => {
      const old = document.getElementById("card-1")!;
      old.replaceWith(old.cloneNode(true));
      document.getElementById("card-1")!.removeAttribute("data-cx-design");
    });
    await new Promise((r) => setTimeout(r, 450));
    assert.equal(await style("#card-1", "background-color"), "rgb(255, 0, 0)", "preview follows the replacement node");
    assert.equal((await E<any>(`E.summary()`)).stale, false);
    // element removed
    await page.evaluate(() => document.getElementById("card-1")!.remove());
    await new Promise((r) => setTimeout(r, 450));
    assert.equal((await E<any>(`E.summary()`)).stale, true);
    const r = await E<any>(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'b')`);
    assert.equal(r.code, "target_stale");
    assert.equal(await E(`E.context()`), null);
    assert.equal((await E<any>(`E.exportData({})`)).code, "target_stale");
    await page.close();
  });

  it("keeps earlier sections' previews when another section is selected, and Reset all clears every one", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'hero')`);
    await E(`E.selectBySelector('#card-1')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "blue" })}, 'card')`);
    assert.equal(await style("#hero", "color"), "rgb(255, 0, 0)");
    assert.equal(await style("#card-1", "color"), "rgb(0, 0, 255)");
    assert.equal((await E<any>(`E.summary()`)).active, 2);
    await E(`E.setEnabled(false)`);
    assert.equal(await style("#hero", "color"), "rgb(51, 51, 51)", "original shown while the preview is toggled off");
    await E(`E.setEnabled(true)`);
    assert.equal(await style("#hero", "color"), "rgb(255, 0, 0)");
    await E(`E.resetAll()`);
    assert.equal(await page.evaluate(() => document.querySelectorAll("[data-cx-design], #codex-design-ai-style").length), 0);
    await page.close();
  });

  it("exports CSS that reproduces the preview exactly", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    await E(`E.apply(${ops({ op: "set", property: "background-image", value: "linear-gradient(135deg, #123456, #654321)" }, { op: "set", property: "padding", value: "30px 50px" }, { op: "set", property: "border", value: "3px solid #ff00ff" }, { op: "set", property: "box-shadow", value: "0 8px 24px rgba(0,0,0,.3)" }, { op: "set", property: "letter-spacing", value: "2px" }, { op: "set", property: "padding", value: "12px", breakpoint: "mobile" })}, 'm')`);
    const props = ["background-image", "padding-top", "padding-left", "border-top-width", "border-top-color", "box-shadow", "letter-spacing"];
    const widths = [1280, 390];
    const preview: Record<number, string[]> = {};
    for (const w of widths) {
      await page.setViewport({ width: w, height: 800 });
      preview[w] = await Promise.all(props.map((p) => style("#hero", p)));
    }
    const exp = await E<any>(`E.exportData({ framework: 'html' })`);
    assert.equal(exp.ok, true);
    assert.match(exp.css, /Applies to: #hero/);
    assert.match(exp.css, /@media \(max-width: 640px\)/);
    // load the exported CSS into a clean page (no engine, no attribute)
    await page.close();
    await fresh();
    await page.evaluate((css) => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }, exp.css);
    for (const w of widths) {
      await page.setViewport({ width: w, height: 800 });
      assert.deepEqual(await Promise.all(props.map((p) => style("#hero", p))), preview[w], `exported CSS at ${w}px`);
    }
    await page.close();
  });

  it("exports sanitized HTML and honest framework guidance", async () => {
    await fresh();
    await E(`E.selectBySelector('#hero')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'c')`);
    const html = await E<any>(`E.exportData({ framework: 'html' })`);
    assert.match(html.html, /<h1[^>]*>Welcome<\/h1>/);
    assert.doesNotMatch(html.html, /<script|onclick|data-cx|window\.__/i);
    assert.match(html.guidance, /Plain HTML\/CSS/);
    assert.ok(html.notes.some((n: string) => /static snapshot/.test(n)));

    await E(`E.selectBySelector('#evil')`);
    await E(`E.apply(${ops({ op: "set", property: "color", value: "red" })}, 'c')`);
    const evil = await E<any>(`E.exportData({})`);
    assert.doesNotMatch(evil.html, /javascript:|onclick/i);

    await E(`E.selectBySelector('#hero')`);
    const react = await E<any>(`E.exportData({ framework: 'react' })`);
    assert.equal(react.selector, ".hero");
    assert.match(react.css, /Applies to: \.hero/);
    assert.match(react.guidance, /className="hero"/);
    assert.match(react.guidance, /not a generated component/);
    const tw = await E<any>(`E.exportData({ framework: 'tailwind' })`);
    assert.match(tw.guidance, /no automatic conversion/);
    assert.equal((await E<any>(`E.exportData({ framework: 'bogus' })`)).framework, "html");
    assert.doesNotMatch((await E<any>(`E.exportData({ important: false })`)).css, /important/);
    await page.close();
  });

  it("reports context for a future provider without form values or scripts, and makes no requests", async () => {
    await fresh();
    await E(`E.selectBySelector('#f')`);
    const ctx = await E<any>(`E.context()`);
    assert.equal(ctx.tag, "form");
    assert.equal(ctx.viewport.width, 1280);
    assert.ok(ctx.rect.width > 0);
    assert.doesNotMatch(JSON.stringify(ctx), /secret-value/);
    assert.doesNotMatch(ctx.html, /<script|onsubmit/);
    assert.deepEqual(external, []);
    await page.close();
  });
});

// ── Responsive fixes ─────────────────────────────────────────────────
describe("responsive-fix: AI rules are validated before they touch a page", () => {
  const { ResponsiveFix: F } = loadNode();
  const rule = (over: any = {}) => ({ media: null, selector: ".cards", declarations: [{ property: "flex-wrap", value: "wrap" }], ...over });

  it("builds preview CSS (!important) and copyable CSS", () => {
    const r = F.validateFix({ rules: [rule({ media: "(max-width: 768px)", declarations: [{ property: "min-width", value: "0" }, { property: "overflow-wrap", value: "anywhere" }] })] });
    assert.equal(r.ok, true);
    assert.match(r.css, /@media \(max-width: 768px\) \{\n {2}\.cards \{\n {4}min-width: 0 !important;/);
    assert.doesNotMatch(r.cleanCss, /important/);
    assert.match(r.cleanCss, /overflow-wrap: anywhere;/);
  });

  it("drops anything outside the allow-list and reports it", () => {
    const r = F.validateFix({ rules: [
      rule({ declarations: [{ property: "flex-wrap", value: "wrap" }, { property: "position", value: "fixed" }, { property: "background-image", value: "url(https://evil.example/x)" }, { property: "width", value: "100%; } body { display:none" }] }),
      rule({ selector: "body{background:red}" }),
      rule({ media: "print" }),
      rule({ media: "(max-width: 600px) and (min-width: 300px)" }),
      rule({ declarations: [{ property: "color", value: "red" }, { property: "z-index", value: "9999" }] }),
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.rules.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(r.rules[0].declarations)), [{ property: "flex-wrap", value: "wrap" }]);
    assert.doesNotMatch(r.css, /url|evil|position|fixed|z-index|body/);
    assert.ok(r.warnings.length >= 5);
  });

  it("rejects an answer with nothing usable", () => {
    assert.equal(F.validateFix({ rules: [] }).ok, false);
    assert.equal(F.validateFix(null).ok, false);
    assert.equal(F.validateFix({ rules: [rule({ declarations: [{ property: "position", value: "fixed" }] })] }).ok, false);
  });

  it("makes before/after rows for the diff", () => {
    const r = F.validateFix({ rules: [rule()] });
    const rows = F.diffRows(r.rules, { ".cards": { "flex-wrap": "nowrap" } });
    assert.deepEqual(JSON.parse(JSON.stringify(rows)), [{ selector: ".cards", media: null, property: "flex-wrap", before: "nowrap", after: "wrap" }]);
  });
});

// ── GSAP animation specs ─────────────────────────────────────────────
describe("design-ai animation: validation and code", () => {
  const { DesignAIAnimation: A } = loadNode();
  const step = (over: any = {}) => ({ target: "children", selector: null, method: "from", from: [{ property: "opacity", value: "0" }, { property: "y", value: "40" }], to: [], duration: 0.6, delay: 0, ease: "power3.out", stagger: 0.1, staggerFrom: "start", position: null, ...over });

  it("accepts a normal entrance and normalises values", () => {
    const r = A.validateAnimation({ summary: "x", trigger: "scroll", scroll: { start: "top 80%", end: "bottom 20%", scrub: false, once: true }, repeat: 0, yoyo: false, repeatDelay: 0, steps: [step()] });
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(r.spec.steps[0].from)), { opacity: 0, y: 40 });
    assert.deepEqual(JSON.parse(JSON.stringify(r.spec.steps[0].stagger)), { each: 0.1, from: "start" });
    assert.equal(r.spec.scroll.start, "top 80%");
  });

  it("drops properties, eases and selectors that are not allowed", () => {
    const r = A.validateAnimation({ trigger: "load", steps: [
      step({ from: [{ property: "opacity", value: "0" }, { property: "onclick", value: "alert(1)" }, { property: "backgroundColor", value: "url(javascript:alert(1))" }], ease: "evil.out" }),
      step({ target: "select", selector: "div{}<script>" }),
    ] });
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(r.spec.steps[0].from)), { opacity: 0 });
    assert.equal(r.spec.steps[0].ease, "power2.out");
    assert.equal(r.spec.steps.length, 1);
    assert.ok(r.warnings.length >= 3);
  });

  it("rejects an animation with nothing usable", () => {
    assert.equal(A.validateAnimation({ steps: [] }).ok, false);
    assert.equal(A.validateAnimation(null).ok, false);
    assert.equal(A.validateAnimation({ steps: [step({ from: [{ property: "display", value: "none" }] })] }).ok, false);
  });

  it("generates paste-ready code for HTML, React and Next.js", () => {
    const spec = A.validateAnimation({ trigger: "scroll", scroll: { start: "top 80%", end: "bottom 20%", scrub: false, once: true }, steps: [step()] }).spec;
    const html = A.buildCode(spec, { framework: "html", selector: ".cards" });
    assert.match(html, /ScrollTrigger/);
    assert.match(html, /querySelector\('\.cards'\)/);
    assert.match(html, /tl\.from\(el\.children, \{ opacity: 0, y: 40, duration: 0\.6/);
    assert.match(html, /prefers-reduced-motion/);
    const next = A.buildCode(spec, { framework: "next" });
    assert.match(next, /^'use client';/);
    assert.match(next, /gsap\.context/);
    assert.match(next, /ctx\.revert\(\)/);
    const hover = A.buildCode(A.validateAnimation({ trigger: "hover", steps: [step({ target: "self", method: "to", from: [], to: [{ property: "y", value: "-6" }], stagger: 0 })] }).spec, { framework: "html" });
    assert.match(hover, /mouseenter/);
    assert.match(hover, /reverse/);
  });
});

describe("design-ai animation in Chrome", { skip }, () => {
  let browser: Browser, server: Server, base: string;
  const VENDOR = join(DIR, "../vendor/gsap");
  before(async () => {
    server = createServer((_req, res) => res.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><body><section id="s"><div class="c" style="height:20px">a</div><div class="c" style="height:20px">b</div></section>'));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await launch();
  });
  after(async () => { await browser?.close(); server?.close(); });

  it("plays with the bundled GSAP, then restores the page exactly", async () => {
    const page = await browser.newPage();
    await page.goto(base, { waitUntil: "load" });
    await page.evaluate(readFileSync(join(VENDOR, "gsap.min.js"), "utf8"));
    await page.evaluate(readFileSync(join(VENDOR, "ScrollTrigger.min.js"), "utf8"));
    await page.evaluate(src("animation.js"));
    const out = await page.evaluate(async () => {
      const A = (window as any).DesignAIAnimation;
      const el = document.getElementById("s")!;
      const v = A.validateAnimation({ trigger: "load", steps: [{ target: "children", method: "from", from: [{ property: "opacity", value: "0" }, { property: "y", value: "30" }], to: [], duration: 0.3, delay: 0, ease: "power2.out", stagger: 0.05, staggerFrom: "start", position: null }] });
      const played = A.play(el, v.spec);
      await new Promise((r) => setTimeout(r, 50));
      const mid = getComputedStyle(el.children[1]).opacity;
      await new Promise((r) => setTimeout(r, 900));
      const end = getComputedStyle(el.children[1]).opacity;
      const playing = A.isPlaying();
      A.stop();
      return { ok: played.ok, err: played.error, vok: v.ok, verr: v.errors, mid: Number(mid), end: Number(end), playing, restored: !/opacity|transform|translate/.test(el.innerHTML) && el.querySelectorAll('.c').length === 2 && Array.from(el.children).every((c) => (c as HTMLElement).style.height === '20px'), htmlAfter: el.innerHTML, after: A.isPlaying() };
    });
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.ok(out.mid < 1, "starts hidden");
    assert.equal(out.end, 1);
    assert.equal(out.playing, true);
    assert.equal(out.restored, true, out.htmlAfter);
    assert.equal(out.after, false);
    await page.close();
  });
});
