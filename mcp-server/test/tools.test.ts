import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startServer } from "./helpers/harness.js";

const EXPECTED = [
  "capture_breakpoints",
  "check_accessibility",
  "check_section_spacing",
  "check_typography",
  "list_breakpoints",
  "set_breakpoint",
  "list_devices",
  "set_device",
  "show_in_viewer",
  "audit_in_viewer",
  "get_popular_mix",
  "set_popular_mix",
  "clear_css_patch",
  "codex_dev_connect",
  "codex_dev_status",
  "export_section_patch",
  "generate_section_recreation",
  "get_selected_element_context",
  "preview_section_patch",
  "reset_section_preview",
  "select_target_section",
  "compare_screenshots",
  "get_audit_report",
  "get_computed_styles",
  "get_console_errors",
  "get_element_dimensions",
  "get_failed_requests",
  "get_layout_overflow",
  "get_page_structure",
  "get_responsive_issues",
  "inspect_element",
  "list_browser_tabs",
  "preview_css_patch",
  "run_responsive_audit",
  "select_browser_tab",
  "set_viewport",
  "take_screenshot",
  "verify_responsive_fix",
];

describe("tool registration and validation (no browser)", () => {
  let h: Awaited<ReturnType<typeof startServer>>;
  before(async () => {
    h = await startServer();
  });
  after(() => h.close());

  it("registers every tool with a description and an input schema", async () => {
    const { tools } = await h.client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...EXPECTED].sort());
    for (const t of tools) {
      assert.ok(t.description && t.description.length > 40, `${t.name} needs a real description`);
      assert.equal(t.inputSchema.type, "object");
    }
  });

  it("marks inspection tools read-only and state-changing tools not", async () => {
    const { tools } = await h.client.listTools();
    const hint = (n: string) => tools.find((t) => t.name === n)!.annotations?.readOnlyHint;
    for (const n of ["list_browser_tabs", "inspect_element", "get_computed_styles", "get_layout_overflow", "get_console_errors"]) assert.equal(hint(n), true, n);
    for (const n of ["preview_css_patch", "set_viewport", "run_responsive_audit"]) assert.equal(hint(n), false, n);
  });

  it("lists the three named breakpoints without a browser", async () => {
    const res: any = await h.client.callTool({ name: "list_breakpoints", arguments: {} });
    assert.ok(!res.isError);
    const names = res.structuredContent.breakpoints.map((b: any) => `${b.name}:${b.width}x${b.height}`);
    assert.deepEqual(names, ["mobile:393x852", "tablet:820x1180", "desktop:1920x1080"]);
  });

  it("rejects invalid arguments before touching the browser", async () => {
    const cases: [string, Record<string, unknown>][] = [
      ["set_breakpoint", { breakpoint: "watch" }],
      ["capture_breakpoints", { breakpoints: ["mobile"], scale: 5 }],
      ["set_device", { device: "" }],
      ["show_in_viewer", { devices: [] }],
      ["audit_in_viewer", { devices: Array(13).fill("iPhone SE") }],
      ["run_responsive_audit", { devices: ["x".repeat(61)] }],
      ["set_viewport", { width: 10, height: 800 }],
      ["set_viewport", { width: "wide", height: 800 }],
      ["run_responsive_audit", { viewports: [] }],
      ["run_responsive_audit", { viewports: [{ width: 99999, height: 800 }] }],
      ["inspect_element", { selector: "" }],
      ["inspect_element", { selector: "a".repeat(501) }],
      ["get_computed_styles", { selector: "p", properties: ["color; background"] }],
      ["compare_screenshots", { before: "../../etc/passwd" }],
      ["verify_responsive_fix", { baselineReportId: "nope" }],
      ["select_browser_tab", { tabId: -1 }],
    ];
    for (const [name, args] of cases) {
      const r = await h.client.callTool({ name, arguments: args }).then(
        (x: any) => ({ isError: !!x.isError, text: JSON.stringify(x.content) }),
        (e: Error) => ({ isError: true, text: e.message }),
      );
      assert.equal(r.isError, true, `${name} ${JSON.stringify(args)} should be rejected`);
      assert.doesNotMatch(r.text, /extension_not_connected/, `${name} must fail validation first`);
    }
  });

  it("reports a disconnected browser helpfully", async () => {
    const st = await h.call("codex_dev_status");
    assert.equal(st.isError, false);
    assert.equal(st.data.ready, false);
    assert.equal(st.data.bridge.listening, true);
    assert.equal(st.data.bridge.connected, false);
    assert.match(st.data.nextStep, /codex_dev_connect/);
    assert.ok(!JSON.stringify(st.data).includes("test-token"), "status must not leak the token");
  });

  it("returns structured errors when the extension is missing", async () => {
    for (const [name, args] of [["list_browser_tabs", {}], ["select_browser_tab", { tabId: 1 }], ["get_layout_overflow", { tabId: 1 }]] as const) {
      const r = await h.call(name, args);
      assert.equal(r.isError, true, name);
      assert.equal(r.data.error.code, "extension_not_connected", name);
      assert.match(r.data.error.hint, /Codex Dev/);
    }
  });

  it("requires a selected tab for page tools", async () => {
    const ext = await h.connectExtension({ status: async () => ({}) });
    const r = await h.call("inspect_element", { selector: "h1" });
    assert.equal(r.data.error.code, "no_tab_selected");
    ext.close();
  });

  it("validates CSS patches on the server before sending them", async () => {
    let sent = 0;
    const ext = await h.connectExtension({ apply_patch: async () => (sent++, { applied: true, active: ["default"] }) });
    h.ctx.selected.tabId = 1;
    const bad = [
      "@import url(https://evil.example/x.css);",
      "body{background:url(https://evil.example/pixel.png)}",
      "</style><script>alert(1)</script>",
      "a{background:url(javascript:alert(1))}",
      "a{width:expression(alert(1))}",
      "   ",
      "a{color:red}" + "/*".padEnd(21 * 1024, "x") + "*/",
    ];
    for (const css of bad) {
      const r = await h.client.callTool({ name: "preview_css_patch", arguments: { css } }).then(
        (x: any) => !!x.isError,
        () => true,
      );
      assert.equal(r, true, `should reject ${css.slice(0, 40)}`);
    }
    assert.equal(sent, 0, "nothing rejected may reach the extension");
    const good = await h.call("preview_css_patch", { css: ".nav{flex-wrap:wrap}" });
    assert.equal(good.isError, false);
    assert.equal(good.data.temporary, true);
    assert.equal(sent, 1);
    ext.close();
  });

  it("codex_dev_connect returns a one-time 6-digit code and arms pairing", async () => {
    while (h.bridge.status().connected) await new Promise((r) => setTimeout(r, 10));
    const r = await h.call("codex_dev_connect");
    assert.equal(r.isError, false);
    assert.match(r.data.pairingCode, /^\d{6}$/);
    assert.equal(r.data.expiresInSeconds, 120);
    assert.ok(r.data.tellTheUser.length >= 3);
    assert.ok(!JSON.stringify(r.data).includes("test-token"), "the long token is never shown to the model");
    const ext = await h.connectExtension({});
    const again = await h.call("codex_dev_connect");
    assert.equal(again.data.alreadyConnected, true);
    ext.close();
  });

  it("generate_section_recreation always reports that no AI provider is configured", async () => {
    const r = await h.call("generate_section_recreation");
    assert.equal(r.isError, true);
    assert.equal(r.data.error.code, "provider_not_configured");
    assert.match(r.data.error.hint, /preview_section_patch/);
  });

  it("validates section patch arguments before touching the browser", async () => {
    for (const args of [{ operations: [] }, { operations: [{ op: "run", code: "alert(1)" }] }, { operations: [{ op: "set", property: "color" }] }, { operations: [{ op: "set", property: "color", value: "red", breakpoint: "watch" }] }]) {
      const r = await h.client.callTool({ name: "preview_section_patch", arguments: args }).then((x: any) => !!x.isError, () => true);
      assert.equal(r, true, JSON.stringify(args));
    }
  });

  it("surfaces report lookups for unknown ids", async () => {
    const r = await h.call("get_audit_report", {});
    assert.equal(r.data.error.code, "report_not_found");
    const v = await h.call("verify_responsive_fix", { baselineReportId: "audit_deadbeef" });
    assert.equal(v.data.error.code, "report_not_found");
  });
});
