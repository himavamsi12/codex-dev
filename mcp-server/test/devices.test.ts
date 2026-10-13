import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, describe, it } from "node:test";
import { type CatalogDevice, findDevice } from "../src/devices.js";
import { startServer } from "./helpers/harness.js";

// The real Responsive Viewer catalog, as bridge/bridge.js serves it.
const { getAllDevices } = createRequire(import.meta.url)("../../devices.js");
const CATALOG: CatalogDevice[] = getAllDevices().map((d: any) => ({ name: d.name, width: d.width, height: d.height, category: d.category, brand: d.brand }));

describe("findDevice", () => {
  it("matches exact names, ignoring case and punctuation", () => {
    assert.equal(findDevice(CATALOG, "iphone 14 pro").name, "iPhone 14 Pro");
    assert.equal(findDevice(CATALOG, "Pixel 7").name, "Pixel 7");
  });

  it("picks the shortest name containing the query", () => {
    assert.equal(findDevice(CATALOG, "Galaxy S24").name, "Samsung Galaxy S24");
    assert.equal(findDevice(CATALOG, "iPhone 15").name, "iPhone 15");
  });

  it("sets pixel ratio and mobile flag from the category", () => {
    const phone = findDevice(CATALOG, "iPhone SE");
    assert.deepEqual([phone.width, phone.height, phone.deviceScaleFactor, phone.mobile], [375, 667, 3, true]);
    const desk = findDevice(CATALOG, "Desktop (1920x1080)");
    assert.deepEqual([desk.deviceScaleFactor, desk.mobile], [1, false]);
  });

  it("accepts custom WIDTHxHEIGHT sizes within limits", () => {
    const d = findDevice(CATALOG, "412 × 915");
    assert.deepEqual([d.name, d.width, d.height, d.custom, d.mobile], ["Custom 412×915", 412, 915, true, true]);
    assert.throws(() => findDevice(CATALOG, "9000x800"), /between 200 and 4000/);
  });

  it("reports ambiguous and unknown names", () => {
    assert.throws(() => findDevice(CATALOG, "MacBook"), (e: any) => e.code === "ambiguous_device");
    assert.throws(() => findDevice(CATALOG, "Nokia 3310"), (e: any) => e.code === "unknown_device");
  });
});

describe("device tools", () => {
  let h: Awaited<ReturnType<typeof startServer>>;
  const calls: { command: string; params: any }[] = [];
  const pick = (n: string) => { const d = CATALOG.find((x) => x.name === n)!; return { name: d.name, width: d.width, height: d.height, category: d.category }; };
  const DEFAULT_MIX = ["iPhone 14 Pro", "iPad Air", "Desktop (1920x1080)"].map(pick);
  let mix: any[] = [];
  const record = (command: string, result: any = {}) => async (params: any) => { calls.push({ command, params }); return result; };

  before(async () => {
    h = await startServer();
    await h.connectExtension({
      devices: async () => ({ devices: CATALOG }),
      validate_tab: record("validate_tab", { tabId: 1, emulation: null }),
      set_viewport: record("set_viewport"),
      probe: async (p: any) => (p.probe === "waitStable" ? { stable: true } : { layoutWidth: 1 }),
      viewer_add_devices: record("viewer_add_devices", { viewerTabId: 9, opened: true }),
      viewer_audit: record("viewer_audit", { viewerTabId: 9, opened: false, added: [], devices: [{ name: "iPhone SE", width: 375 }], skipped: [], issues: [] }),
      // Same rules as popular-mix.js: an empty list means the default three.
      popular_mix_get: async () => (mix.length ? { devices: mix, isDefault: false } : { devices: DEFAULT_MIX, isDefault: true }),
      popular_mix_set: async (p: any) => { calls.push({ command: "popular_mix_set", params: p }); mix = p.devices; return mix.length ? { devices: mix, isDefault: false } : { devices: DEFAULT_MIX, isDefault: true }; },
    });
    h.ctx.selected.tabId = 1;
  });
  after(() => h.close());

  it("list_devices filters the catalog", async () => {
    const r = await h.call("list_devices", { query: "galaxy s2", category: "mobile" });
    assert.ok(!r.isError, r.text);
    assert.ok(r.data.count > 3);
    assert.ok(r.data.devices.every((d: any) => d.category === "mobile" && /Galaxy S2/.test(d.name)));
  });

  it("set_device emulates the named device, rotated for landscape", async () => {
    calls.length = 0;
    const r = await h.call("set_device", { device: "Galaxy S24", landscape: true });
    assert.ok(!r.isError, r.text);
    const vp = calls.find((c) => c.command === "set_viewport")!.params;
    const s24 = CATALOG.find((d) => d.name === "Samsung Galaxy S24")!;
    assert.deepEqual([vp.width, vp.height, vp.deviceScaleFactor, vp.mobile], [s24.height, s24.width, 3, true]);
  });

  it("show_in_viewer sends resolved devices to the extension", async () => {
    calls.length = 0;
    const r = await h.call("show_in_viewer", { devices: ["iPhone SE", "1366x768"] });
    assert.ok(!r.isError, r.text);
    assert.deepEqual(calls[0].params.devices, [
      { name: "iPhone SE", width: 375, height: 667, category: "mobile" },
      { name: "Custom 1366×768", width: 1366, height: 768, category: "custom" },
    ]);
  });

  it("audit_in_viewer resolves devices and returns the viewer's results", async () => {
    calls.length = 0;
    const r = await h.call("audit_in_viewer", { devices: ["Galaxy S24"] });
    assert.ok(!r.isError, r.text);
    assert.equal(calls[0].command, "viewer_audit");
    assert.equal(calls[0].params.devices[0].name, "Samsung Galaxy S24");
    assert.equal(r.data.method, "responsive-viewer-iframes");
    assert.ok(!calls.some((c) => c.command === "set_viewport"), "must not resize the user's tab");
  });

  it("audit_in_viewer and show_in_viewer use the Popular Mix when no devices are given", async () => {
    mix = [];
    calls.length = 0;
    assert.ok(!(await h.call("audit_in_viewer", {})).isError);
    assert.deepEqual(calls[0].params.devices.map((d: any) => d.name), ["iPhone 14 Pro", "iPad Air", "Desktop (1920x1080)"]);
    mix = [pick("Samsung Galaxy S24 Ultra")];
    calls.length = 0;
    assert.ok(!(await h.call("show_in_viewer", {})).isError);
    assert.deepEqual(calls[0].params.devices.map((d: any) => d.name), ["Samsung Galaxy S24 Ultra"]);
  });

  it("set_popular_mix adds, removes, replaces and resets", async () => {
    mix = [];
    let r = await h.call("get_popular_mix", {});
    assert.equal(r.data.isDefault, true);
    r = await h.call("set_popular_mix", { add: ["Galaxy S24 Ultra", "412x915"], remove: ["iPad"] });
    assert.ok(!r.isError, r.text);
    assert.deepEqual(r.data.devices.map((d: any) => d.name), ["iPhone 14 Pro", "Desktop (1920x1080)", "Samsung Galaxy S24 Ultra", "Custom 412×915"]);
    r = await h.call("set_popular_mix", { devices: ["iPhone SE"] });
    assert.deepEqual(r.data.devices.map((d: any) => d.name), ["iPhone SE"]);
    r = await h.call("set_popular_mix", { remove: ["Pixel 7"] });
    assert.ok(r.isError);
    assert.match(r.text, /Not in the Popular Mix/);
    r = await h.call("set_popular_mix", { remove: ["iPhone SE"] });
    assert.ok(r.isError, "must not empty the mix");
    r = await h.call("set_popular_mix", { reset: true });
    assert.equal(r.data.isDefault, true);
    assert.ok((await h.call("set_popular_mix", {})).isError, "nothing to change");
  });

  it("fails clearly on an unknown device without touching the tab", async () => {
    calls.length = 0;
    const r = await h.call("set_device", { device: "Nokia 3310" });
    assert.ok(r.isError);
    assert.match(r.text, /unknown_device/);
    assert.equal(calls.length, 0);
  });
});

describe("device tools with an older extension", () => {
  it("asks for an extension reload when the catalog command is missing", async () => {
    const h = await startServer();
    try {
      await h.connectExtension({});
      h.ctx.selected.tabId = 1;
      const r = await h.call("list_devices", {});
      assert.ok(r.isError);
      assert.match(r.text, /extension_outdated/);
    } finally {
      await h.close();
    }
  });
});
