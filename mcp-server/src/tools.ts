import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BREAKPOINT_NAMES, BREAKPOINTS, type BreakpointName, DEFAULT_VIEWPORTS, LIMITATIONS, breakpointViewport, compareReports, runAudit, setViewport } from "./audit.js";
import { type Context, requireTab } from "./context.js";
import { compareImages } from "./diff.js";
import { type CatalogDevice, deviceViewport, fetchCatalog, findDevice } from "./devices.js";
import { BridgeError, describeError } from "./errors.js";
import { PAGE_TEXT_NOTICE, validateCssPatch } from "./validation.js";
import type { AuditReport, Issue, RawIssue, ViewportSpec } from "./types.js";

export const SERVER_VERSION = "0.1.0";

// ── shared schemas ───────────────────────────────────────────────────
const tabId = z.number().int().nonnegative().optional().describe("Browser tab id. Defaults to the tab chosen with select_browser_tab.");
const selector = z.string().min(1).max(500).describe("CSS selector.");
const dim = (name: string, min: number, max: number) => z.number().int().min(min).max(max).describe(name);
const viewportShape = {
  width: dim("Viewport width in CSS px", 200, 7680),
  height: dim("Viewport height in CSS px", 200, 4320),
};
const viewportSchema = z.object({ ...viewportShape, label: z.string().max(40).optional() });
const optionalViewport = z
  .object({ width: viewportShape.width, height: viewportShape.height.optional() })
  .optional()
  .describe("Temporarily measure at this viewport (height defaults to 800), then restore the previous viewport.");
const breakpointEnum = z.enum(["mobile", "tablet", "desktop"]);
const deviceName = z.string().min(1).max(60).describe('A device from the Responsive Viewer catalog, e.g. "iPhone 15 Pro", "Galaxy S24", "MacBook Air" (see list_devices), or a custom size like "412x915".');
const severityEnum = z.enum(["critical", "high", "medium", "low"]);
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 } as const;

type Json = Record<string, unknown>;
type ToolResult = { content: any[]; structuredContent?: Json; isError?: boolean };

function ok(data: Json, extra: any[] = []): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }, ...extra], structuredContent: data };
}

function fail(e: unknown): ToolResult {
  const body = { error: describeError(e) };
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }], structuredContent: body, isError: true };
}

/** Runs fn at a temporary viewport (if given), restoring the previous one afterwards. */
async function withViewport<T>(ctx: Context, id: number, vp: { width: number; height?: number; mobile?: boolean } | undefined, fn: () => Promise<T>): Promise<T> {
  if (!vp) return fn();
  const tab = await ctx.bridge.request<{ emulation: any }>("validate_tab", { tabId: id });
  const previous = tab.emulation;
  await setViewport(ctx, id, { width: vp.width, height: vp.height ?? 800, mobile: vp.mobile });
  try {
    await ctx.bridge.request("probe", { tabId: id, probe: "waitStable", params: {} }, 15_000);
    return await fn();
  } finally {
    try {
      if (previous) await setViewport(ctx, id, previous);
      else await ctx.bridge.request("set_viewport", { tabId: id, reset: true });
    } catch {
      /* best effort */
    }
  }
}

const probe = <T = any>(ctx: Context, id: number, name: string, params: Json = {}, timeout = 20_000) =>
  ctx.bridge.request<T>("probe", { tabId: id, probe: name, params }, timeout);

function shapeReport(r: AuditReport, detail: "summary" | "full", maxIssues = 40) {
  const issues = r.issues.slice(0, maxIssues).map((i: Issue) => {
    const base = {
      id: i.id,
      type: i.type,
      severity: i.severity,
      confidence: i.confidence,
      selector: i.selector,
      summary: i.summary,
      viewportWidths: i.viewports.map((o) => o.viewport.width),
      likelyCauses: i.likelyCauses,
      recommendation: i.recommendation,
    };
    return detail === "full" ? { ...base, tag: i.tag, text: i.text, computed: i.computed, occurrences: i.viewports } : { ...base, worstOccurrence: i.viewports[0] && { viewport: i.viewports[0].viewport, rect: i.viewports[0].rect, details: i.viewports[0].details }, computed: i.computed };
  });
  return {
    reportId: r.id,
    createdAt: r.createdAt,
    page: r.page,
    method: r.method,
    focusSelector: r.focusSelector,
    summary: r.summary,
    viewports: r.viewports.map((v) => ({
      viewport: v.viewport,
      tested: v.tested,
      skippedReason: v.skippedReason,
      layoutWidth: v.layoutWidth,
      horizontalScroll: v.horizontalScroll,
      documentOverflowPx: v.documentOverflowPx,
      issueCount: v.issueIds.length,
      screenshot: v.screenshot && { id: v.screenshot.id, path: v.screenshot.path },
      settled: v.stable,
    })),
    issues,
    issuesOmitted: Math.max(0, r.issues.length - maxIssues),
    notTested: r.notTested,
    limitations: r.limitations,
    notice: PAGE_TEXT_NOTICE,
    nextSteps: r.issues.length
      ? ["Use inspect_element with an issue's selector (and viewport) to see computed styles and matched CSS rules.", "Edit the source, then call verify_responsive_fix to compare against this report."]
      : ["No issues found by these checks. This does not prove the layout is correct; review the screenshots too."],
  };
}

function resolveViewports(input?: { width: number; height: number; label?: string }[], preset?: string): ViewportSpec[] {
  if (input?.length) return input.map((v) => ({ ...v, label: v.label ?? `${v.width}x${v.height}` }));
  const by = (p: string) => DEFAULT_VIEWPORTS.filter((v) => v.label!.startsWith(p));
  if (preset === "breakpoints") return BREAKPOINT_NAMES.map((n) => { const b = breakpointViewport(n); return { width: b.width, height: b.height, label: b.label }; });
  if (preset === "mobile" || preset === "tablet" || preset === "desktop") return by(preset);
  return DEFAULT_VIEWPORTS;
}

export function registerTools(server: McpServer, ctx: Context): void {
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  function tool<S extends z.ZodRawShape>(
    name: string,
    title: string,
    description: string,
    inputSchema: S,
    annotations: Json,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
  ): void {
    server.registerTool(name, { title, description, inputSchema, annotations }, (async (args: any) => {
      try {
        return await handler(args);
      } catch (e) {
        return fail(e);
      }
    }) as any);
  }

  // ── A. Browser and connection management ───────────────────────────
  tool(
    "codex_dev_status",
    "Codex Dev status",
    "Check whether the MCP server and the Codex Dev browser extension are connected and ready. Returns connection metadata only, never page content. Call this first.",
    {},
    readOnly,
    async () => {
      const bridge = ctx.bridge.status();
      let extension: Json | null = null;
      if (bridge.connected) {
        try {
          extension = await ctx.bridge.request("status", {}, 5000);
        } catch (e) {
          extension = { error: describeError(e) };
        }
      }
      const ready = bridge.connected && !!extension && !("error" in extension);
      return ok({
        ready,
        server: { name: "codex-dev-mcp", version: SERVER_VERSION, pid: process.pid },
        bridge,
        extension,
        selectedTabId: ctx.selected.tabId,
        reportsInMemory: ctx.reports.list().length,
        nextStep: !bridge.listening
          ? (bridge.listenError ?? "The bridge is not listening.")
          : !bridge.connected
            ? "Call codex_dev_connect, then give the user the code to enter in the Codex Dev popup (Claude Code → Connect)."
            : ctx.selected.tabId == null
              ? "Allow a tab in the Codex Dev popup (Claude Code → Allow on this tab), then call list_browser_tabs and select_browser_tab."
              : "Ready.",
      });
    },
  );

  tool(
    "codex_dev_connect",
    "Connect Codex Dev",
    "Start pairing with the Codex Dev browser extension. Returns a one-time 6-digit code (valid 2 minutes) for the user to enter in the extension popup under Claude Code; the extension then stores its own credentials and reconnects automatically. Call this when codex_dev_status says the extension is not connected, then tell the user the code and the steps.",
    {},
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async () => {
      const bridge = ctx.bridge.status();
      if (!bridge.listening) throw new BridgeError("bridge_unavailable", bridge.listenError ?? "The bridge is not listening.");
      if (bridge.connected) return ok({ alreadyConnected: true, message: "The extension is already connected. Next: allow a tab in the popup, then list_browser_tabs." });
      const { code, expiresInSeconds } = ctx.bridge.armPairing();
      return ok({
        pairingCode: code,
        expiresInSeconds,
        tellTheUser: [
          "Click the Codex Dev icon in Chrome and open Claude Code.",
          `Enter the code ${code} and press Connect (valid for ${expiresInSeconds / 60} minutes, one use).`,
          "Open the page to test and press Allow on this tab, then ask me to continue.",
        ],
        note: "Only enter this code in the Codex Dev popup. It is not needed again: the extension remembers the pairing.",
      });
    },
  );

  tool(
    "list_browser_tabs",
    "List authorized tabs",
    "List browser tabs the user has authorized for Claude Code, with title and URL (query strings are stripped). Tabs the user has not allowed are never listed.",
    {},
    readOnly,
    async () => {
      const res = await ctx.bridge.request<{ tabs: any[] }>("list_tabs");
      return ok({
        tabs: res.tabs,
        selectedTabId: ctx.selected.tabId,
        hint: res.tabs.length ? undefined : "No tabs are authorized. In Chrome, open the page, click the Codex Dev icon → Claude Code → Allow on this tab.",
        notice: PAGE_TEXT_NOTICE,
      });
    },
  );

  tool(
    "select_browser_tab",
    "Select a tab",
    "Select an authorized tab for subsequent tools. Fails if the tab is not authorized, closed, or on a page Chrome does not let extensions inspect.",
    { tabId: z.number().int().nonnegative().describe("Tab id from list_browser_tabs.") },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async ({ tabId: id }) => {
      const t = await ctx.bridge.request<any>("validate_tab", { tabId: id });
      ctx.selected.tabId = id;
      return ok({ selected: true, tab: t, notice: PAGE_TEXT_NOTICE });
    },
  );

  // ── B. Responsive testing ──────────────────────────────────────────
  tool(
    "set_viewport",
    "Set tab viewport",
    "Set the selected tab's real viewport with Chrome device-metrics emulation (shows Chrome's debugger banner). Persists until reset:true, the debugger is detached, or the tab authorization ends. width/height are required unless reset is true.",
    {
      width: viewportShape.width.optional(),
      height: viewportShape.height.optional(),
      deviceScaleFactor: z.number().min(1).max(4).optional().describe("Device pixel ratio, default 1."),
      mobile: z.boolean().optional().describe("Mobile emulation (viewport meta handling, overlay scrollbars). Defaults to true below 768px."),
      reset: z.boolean().optional().describe("Restore the real window size."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      if (!a.reset && (a.width == null || a.height == null)) throw new BridgeError("bad_request", "width and height are required unless reset is true.");
      const res = await ctx.bridge.request("set_viewport", { tabId: id, width: a.width, height: a.height, deviceScaleFactor: a.deviceScaleFactor, mobile: a.mobile, reset: a.reset });
      if (!a.reset) await probe(ctx, id, "waitStable", {}, 15_000).catch(() => undefined);
      const info = await probe(ctx, id, "viewportInfo");
      return ok({ ...(res as Json), measured: info });
    },
  );

  tool(
    "list_breakpoints",
    "List breakpoints",
    "List the three named breakpoints (mobile, tablet, desktop): device, CSS viewport size, device pixel ratio and mobile flag. They are the same devices as the Codex Dev Responsive Viewer's default preset, so results match what the user sees there. Use the names with set_breakpoint, capture_breakpoints, and run_responsive_audit preset 'breakpoints'.",
    {},
    readOnly,
    async () =>
      ok({
        breakpoints: BREAKPOINT_NAMES.map((name) => ({ name, ...BREAKPOINTS[name] })),
        note: "Mobile and tablet can be rotated with landscape:true. Sizes are CSS px.",
      }),
  );

  async function applyBreakpoint(id: number, name: BreakpointName, landscape?: boolean) {
    const b = breakpointViewport(name, landscape);
    await setViewport(ctx, id, { width: b.width, height: b.height, label: b.label, deviceScaleFactor: b.deviceScaleFactor, mobile: b.mobile });
    await probe(ctx, id, "waitStable", {}, 15_000).catch(() => undefined);
    return b;
  }

  tool(
    "set_breakpoint",
    "Set breakpoint",
    "Switch the selected tab to a named breakpoint (mobile = iPhone 14 Pro 393x852, tablet = iPad Air 820x1180, desktop = 1920x1080) with Chrome device-metrics emulation, including its device pixel ratio and mobile flag. Persists until set_viewport reset:true or another viewport is set, so follow-up tools (inspect_element, get_computed_styles, take_screenshot) measure at that breakpoint.",
    {
      breakpoint: breakpointEnum.describe("Which breakpoint."),
      landscape: z.boolean().optional().describe("Rotate mobile/tablet to landscape. Ignored for desktop."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const b = await applyBreakpoint(id, a.breakpoint, a.landscape);
      const info = await probe(ctx, id, "viewportInfo");
      return ok({ breakpoint: a.breakpoint, device: b.device, viewport: { width: b.width, height: b.height }, deviceScaleFactor: b.deviceScaleFactor, mobile: b.mobile, measured: info });
    },
  );

  tool(
    "capture_breakpoints",
    "Capture breakpoints",
    "Screenshot the selected tab at each named breakpoint (default mobile, tablet and desktop) in one call, then restore the previous viewport. Each image is saved with an id (for compare_screenshots) and returned inline, so the layouts can be compared side by side. Screenshots use device pixel ratio 1 to stay small; layout is otherwise identical to set_breakpoint.",
    {
      breakpoints: z.array(breakpointEnum).min(1).max(3).optional().describe("Which breakpoints, default all three."),
      landscape: z.boolean().optional().describe("Rotate mobile/tablet to landscape."),
      fullPage: z.boolean().optional().describe("Capture beyond the viewport (height capped at 8000 CSS px)."),
      scale: z.number().min(0.25).max(1).optional().describe("Output scale, default 0.5 (desktop is 1920 px wide)."),
      label: z.string().max(60).optional().describe("Note saved with each screenshot, e.g. 'before fix'."),
      tabId,
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const names = [...new Set(a.breakpoints ?? BREAKPOINT_NAMES)];
      const tab = await ctx.bridge.request<{ emulation: any }>("validate_tab", { tabId: id });
      const previous = tab.emulation;
      const patched = (ctx.patches.get(id)?.size ?? 0) > 0;
      const results: Json[] = [];
      const images: any[] = [];
      let budget = 6 * 1024 * 1024; // keep the whole reply a sensible size
      try {
        for (const name of names) {
          const b = breakpointViewport(name, a.landscape);
          try {
            await setViewport(ctx, id, { width: b.width, height: b.height, label: b.label, deviceScaleFactor: 1, mobile: b.mobile });
            await probe(ctx, id, "waitStable", {}, 15_000).catch(() => undefined);
            const shot = await ctx.bridge.request<any>("screenshot", { tabId: id, fullPage: a.fullPage, scale: a.scale ?? 0.5 }, 40_000);
            const info = await probe(ctx, id, "viewportInfo");
            const png = Buffer.from(shot.base64, "base64");
            const meta = ctx.shots.save(png, {
              width: shot.width,
              height: shot.height,
              url: info.url,
              viewport: { width: info.layoutWidth, height: info.clientHeight },
              fullPage: !!a.fullPage,
              label: [b.label, a.label].filter(Boolean).join(" · "),
              patchApplied: patched,
            });
            const inline = png.length <= budget;
            if (inline) {
              budget -= png.length;
              images.push({ type: "text", text: `${name}: ${b.device} ${b.width}x${b.height}` }, { type: "image", data: shot.base64, mimeType: "image/png" });
            }
            results.push({
              breakpoint: name,
              device: b.device,
              viewport: { width: b.width, height: b.height },
              layoutWidth: info.layoutWidth,
              horizontalScroll: info.layoutWidth != null && info.scrollWidth != null ? info.scrollWidth > info.layoutWidth : undefined,
              screenshotId: meta.id,
              path: meta.path,
              inline,
            });
          } catch (e) {
            results.push({ breakpoint: name, device: b.device, error: describeError(e) });
          }
        }
      } finally {
        try {
          if (previous) await setViewport(ctx, id, previous);
          else await ctx.bridge.request("set_viewport", { tabId: id, reset: true });
        } catch {
          /* best effort */
        }
      }
      return ok(
        {
          captures: results,
          cssPreviewApplied: patched,
          note: "Previous viewport restored. Use compare_screenshots with two ids for a pixel diff, or run_responsive_audit preset 'breakpoints' for measured issues.",
        },
        images,
      );
    },
  );

  // ── any device from the Responsive Viewer catalog ──────────────────
  const summarize = (d: CatalogDevice) => ({ name: d.name, width: d.width, height: d.height, category: d.category });

  tool(
    "list_devices",
    "List devices",
    "List the devices in the Codex Dev Responsive Viewer catalog (phones, tablets, laptops and desktops, CSS px, portrait). Filter by a name fragment or category. Use the names with set_device, show_in_viewer, run_responsive_audit `devices`, and the `device` option of the check tools. Any size not in the catalog can be given as \"WIDTHxHEIGHT\".",
    {
      query: z.string().max(60).optional().describe('Name fragment, e.g. "galaxy", "iphone 15", "macbook".'),
      category: z.enum(["mobile", "tablet", "desktop"]).optional(),
    },
    readOnly,
    async (a) => {
      const q = (a.query ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      const list = (await fetchCatalog(ctx)).filter(
        (d) => (!a.category || d.category === a.category) && (!q || d.name.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(q)),
      );
      return ok({ count: list.length, devices: list.map(summarize), note: 'Sizes are CSS px in portrait. Custom sizes: pass "WIDTHxHEIGHT" (200-4000 px).' });
    },
  );

  tool(
    "set_device",
    "Set device",
    "Emulate a specific device on the selected tab: a catalog device the user named (\"iPhone SE\", \"Galaxy S24 Ultra\", \"MacBook Pro 14\\\"\") or a custom \"WIDTHxHEIGHT\". Sets its CSS viewport, device pixel ratio and mobile flag, and persists like set_breakpoint until set_viewport reset:true, so follow-up tools measure at that device.",
    {
      device: deviceName,
      landscape: z.boolean().optional().describe("Rotate a phone or tablet to landscape. Ignored for desktops."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const d = findDevice(await fetchCatalog(ctx), a.device);
      const vp = deviceViewport(d, a.landscape);
      await setViewport(ctx, id, { ...vp, deviceScaleFactor: d.deviceScaleFactor, mobile: d.mobile });
      await probe(ctx, id, "waitStable", {}, 15_000).catch(() => undefined);
      const info = await probe(ctx, id, "viewportInfo");
      return ok({ device: d.name, custom: d.custom, category: d.category, viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: d.deviceScaleFactor, mobile: d.mobile, measured: info });
    },
  );

  // The user's Popular Mix (popup → Quick Launch): what "check responsive" tests by default.
  type MixDevice = { name: string; width: number; height: number; category: string };
  async function popularMix(): Promise<{ devices: MixDevice[]; isDefault: boolean }> {
    try {
      return await ctx.bridge.request<{ devices: MixDevice[]; isDefault: boolean }>("popular_mix_get");
    } catch (e) {
      if (e instanceof BridgeError && e.code === "bad_request")
        throw new BridgeError("extension_outdated", "This version of the Codex Dev extension has no Popular Mix.", "Reload the extension in chrome://extensions, then allow the tab again.");
      throw e;
    }
  }
  const mixNote = "Popular Mix is the user's default device set (Codex Dev popup → Quick Launch). Quick Launch opens it and audit_in_viewer / show_in_viewer use it when no devices are given.";

  tool(
    "get_popular_mix",
    "Get Popular Mix",
    "List the devices in the user's Popular Mix: the devices Quick Launch opens and that audit_in_viewer and show_in_viewer test when no devices are given. Default: iPhone 14 Pro, iPad Air, Desktop (1920x1080).",
    {},
    readOnly,
    async () => ok({ ...(await popularMix()), note: mixNote }),
  );

  tool(
    "set_popular_mix",
    "Set Popular Mix",
    "Change the user's Popular Mix (max 12 devices). Pass `devices` to replace the whole list, `add` and/or `remove` to edit it, or `reset: true` for the default three. Only change it when the user asks; the popup shows the change right away.",
    {
      devices: z.array(deviceName).min(1).max(12).optional().describe("Replace the list with these catalog devices or \"WIDTHxHEIGHT\" sizes."),
      add: z.array(deviceName).min(1).max(12).optional().describe("Devices to add."),
      remove: z.array(z.string().min(1).max(60)).min(1).max(12).optional().describe("Devices to remove (names as get_popular_mix lists them; partial names work)."),
      reset: z.boolean().optional().describe("Go back to the default: iPhone 14 Pro, iPad Air, Desktop (1920x1080)."),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      if (!a.reset && !a.devices && !a.add && !a.remove) throw new BridgeError("bad_request", "Nothing to change.", "Pass devices, add, remove or reset.");
      const catalog = a.devices || a.add ? await fetchCatalog(ctx) : [];
      const toMix = (q: string): MixDevice => { const d = findDevice(catalog, q); return { name: d.name, width: d.width, height: d.height, category: d.category }; };
      let list: MixDevice[] = a.reset ? [] : a.devices ? a.devices.map(toMix) : (await popularMix()).devices;
      if (a.remove) {
        const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
        const missing = a.remove.filter((r) => !list.some((d) => norm(d.name).includes(norm(r))));
        if (missing.length) throw new BridgeError("unknown_device", `Not in the Popular Mix: ${missing.join(", ")}.`, `It has: ${list.map((d) => d.name).join(", ")}.`);
        list = list.filter((d) => !a.remove!.some((r) => norm(d.name).includes(norm(r))));
      }
      if (a.add) for (const d of a.add.map(toMix)) if (!list.some((x) => x.name === d.name)) list.push(d);
      if (list.length > 12) throw new BridgeError("bad_request", `The Popular Mix holds at most 12 devices (${list.length} given).`);
      if (!a.reset && !list.length) throw new BridgeError("bad_request", "That would leave the Popular Mix empty.", "Use reset: true to go back to the default three devices.");
      const res = await ctx.bridge.request<{ devices: MixDevice[]; isDefault: boolean }>("popular_mix_set", { devices: list });
      return ok({ ...res, note: mixNote });
    },
  );

  tool(
    "show_in_viewer",
    "Show in Responsive Viewer",
    "Add devices to the Codex Dev Responsive Viewer for the selected tab's page and bring the viewer to the front, so the user sees them side by side in device frames. Adds to a viewer already open for that page, or opens one. Devices already shown are skipped. Without devices it shows the user's Popular Mix. To test them there, use audit_in_viewer.",
    {
      devices: z.array(deviceName).min(1).max(12).optional().describe("Catalog device names or custom \"WIDTHxHEIGHT\" sizes. Omit to show the user's Popular Mix."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const devices = a.devices
        ? (await fetchCatalog(ctx).then((catalog) => a.devices!.map((q) => findDevice(catalog, q)))).map((d) => ({ name: d.name, width: d.width, height: d.height, category: d.category }))
        : (await popularMix()).devices;
      const res = await ctx.bridge.request<Json>("viewer_add_devices", { tabId: id, devices });
      return ok({ ...res, note: "The viewer renders the page in iframes. Measurements from the other tools come from the real tab, not the viewer." });
    },
  );

  tool(
    "audit_in_viewer",
    "Audit in Responsive Viewer",
    "Test devices inside the Codex Dev Responsive Viewer instead of resizing the user's tab: adds the devices (if given) to the viewer for the selected tab's page, brings it to the front, and runs the viewer's audit in every device frame (overflow, elements past the screen, covered or off-screen controls, clipped text, tap targets, tiny text). The audit drawer opens with numbered pins, so the user sees the same issues returned here. Use it when the user asks to check responsiveness: without devices it tests the user's Popular Mix (see get_popular_mix).",
    {
      devices: z.array(deviceName).min(1).max(12).optional().describe("Catalog device names or custom \"WIDTHxHEIGHT\" sizes. Omit to test the user's Popular Mix."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const devices = a.devices
        ? (await fetchCatalog(ctx).then((catalog) => a.devices!.map((q) => findDevice(catalog, q)))).map((d) => ({ name: d.name, width: d.width, height: d.height, category: d.category }))
        : (await popularMix()).devices;
      const res = await ctx.bridge.request<Json>("viewer_audit", { tabId: id, devices }, 120_000);
      return ok({
        ...res,
        method: "responsive-viewer-iframes",
        notice: PAGE_TEXT_NOTICE,
        limitations: [
          "Measured inside the viewer's device iframes at each device's CSS width. Pixel ratio, touch input and user agent are not emulated (the viewer's User Agent menu can change the last).",
          "Every device in the viewer is audited, including ones already there. Pages that refuse to load in frames show up under skipped.",
          "Heuristic findings (tap targets, clipped text) can be intentional; check them before changing code.",
        ],
      });
    },
  );

  async function deviceViewports(names: string[]): Promise<ViewportSpec[]> {
    const catalog = await fetchCatalog(ctx);
    return names.map((n) => { const d = findDevice(catalog, n); return { width: d.width, height: d.height, label: d.name, mobile: d.mobile }; });
  }

  tool(
    "run_responsive_audit",
    "Run responsive audit",
    `Audit the selected tab across viewports: for each one it sets the real viewport, waits for layout to settle, measures horizontal overflow, elements past the viewport, off-screen/overlapping controls, clipped text, tap targets and tiny text, and saves a screenshot. Findings are labelled deterministic (measured) or heuristic (probably a problem). Default viewports: 320x720, 375x812, 390x844, 430x932, 768x1024, 1024x768, 1280x800, 1440x900, 1920x1080. The previous viewport is restored afterwards. Returns a reportId for verify_responsive_fix and get_audit_report.`,
    {
      viewports: z.array(viewportSchema).min(1).max(16).optional().describe("Override the default viewport set."),
      devices: z.array(deviceName).min(1).max(16).optional().describe("Audit at these catalog devices or custom \"WIDTHxHEIGHT\" sizes (see list_devices). Takes precedence over viewports and preset."),
      preset: z.enum(["mobile", "tablet", "desktop", "all", "breakpoints"]).optional().describe("Subset of the default viewports, or 'breakpoints' for exactly the three named breakpoints (see list_breakpoints). Ignored when viewports is given."),
      selector: selector.optional().describe("Limit element checks to this subtree (document-level overflow is then skipped)."),
      screenshots: z.boolean().optional().describe("Save a PNG per viewport (default true). Returned as file paths and ids, not inline."),
      reload: z.boolean().optional().describe("Reload the tab first so console/network capture starts clean. Reloading discards CSS previews. Default false."),
      detail: z.enum(["summary", "full"]).optional(),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (a) => {
      if (a.tabId != null) ctx.selected.tabId = a.tabId;
      if (a.reload) ctx.patches.delete(requireTab(ctx));
      const report = await runAudit(ctx, {
        viewports: a.devices ? await deviceViewports(a.devices) : resolveViewports(a.viewports, a.preset),
        selector: a.selector,
        screenshots: a.screenshots ?? true,
        reload: a.reload ?? false,
      });
      return ok(shapeReport(report, a.detail ?? "summary"));
    },
  );

  async function measureOnce(a: { width?: number; height?: number; selector?: string; tabId?: number }) {
    const id = requireTab(ctx, a.tabId);
    const vp = a.width ? { width: a.width, height: a.height } : undefined;
    return withViewport(ctx, id, vp, async () => {
      const res = await probe(ctx, id, "audit", { expectedWidth: a.width, selector: a.selector }, 30_000);
      return res as { issues: RawIssue[]; viewport: any; horizontalScroll: boolean; documentOverflowPx: number; pageClipsHorizontalOverflow: boolean; counts: Json; truncated: boolean };
    });
  }

  tool(
    "get_layout_overflow",
    "Get layout overflow",
    "Measure horizontal overflow at the current viewport (or temporarily at `width`): whether the document scrolls sideways, by how much, and which elements extend past the right edge, with selectors, rects, computed CSS and likely causes. Deterministic measurements only.",
    {
      width: viewportShape.width.optional().describe("Measure at this width, then restore the viewport."),
      height: viewportShape.height.optional(),
      selector: selector.optional(),
      tabId,
    },
    readOnly,
    async (a) => {
      const res = await measureOnce(a);
      const issues = res.issues.filter((i) => i.type === "horizontal-overflow" || i.type === "overflowing-element" || i.type === "viewport-meta-missing");
      return ok({
        viewport: res.viewport,
        horizontalScroll: res.horizontalScroll,
        documentOverflowPx: res.documentOverflowPx,
        pageClipsHorizontalOverflow: res.pageClipsHorizontalOverflow,
        overflowingElements: issues.filter((i) => i.type === "overflowing-element"),
        otherFindings: issues.filter((i) => i.type !== "overflowing-element"),
        scanned: res.counts,
        notice: PAGE_TEXT_NOTICE,
        limitations: LIMITATIONS.slice(0, 3),
      });
    },
  );

  tool(
    "get_responsive_issues",
    "Get responsive issues",
    "Run the full set of responsive checks at ONE viewport (current, or temporarily at `width`) without storing a report. Use run_responsive_audit for the multi-viewport comparison and verify_responsive_fix flow.",
    {
      width: viewportShape.width.optional(),
      height: viewportShape.height.optional(),
      minSeverity: severityEnum.optional().describe("Hide findings below this severity."),
      confidence: z.enum(["deterministic", "heuristic"]).optional(),
      selector: selector.optional(),
      tabId,
    },
    readOnly,
    async (a) => {
      const res = await measureOnce(a);
      const min = a.minSeverity ? SEVERITY_RANK[a.minSeverity] : 0;
      const issues = res.issues.filter((i) => SEVERITY_RANK[i.severity] >= min && (!a.confidence || i.confidence === a.confidence));
      return ok({ viewport: res.viewport, count: issues.length, issues, scanned: res.counts, notice: PAGE_TEXT_NOTICE });
    },
  );

  // ── C. DOM and CSS inspection ──────────────────────────────────────
  // ── design checks: typography, accessibility, section spacing ──────
  const where = {
    breakpoint: breakpointEnum.optional().describe("Measure at this named breakpoint (see list_breakpoints), then restore the viewport."),
    device: deviceName.optional().describe("Or measure at this catalog device or custom size (see list_devices), then restore the viewport."),
    width: viewportShape.width.optional().describe("Or measure at this width (ignored when breakpoint or device is given)."),
    height: viewportShape.height.optional(),
    tabId,
  };
  async function targetViewport(a: { breakpoint?: BreakpointName; device?: string; width?: number; height?: number }) {
    if (a.breakpoint) { const b = breakpointViewport(a.breakpoint); return { width: b.width, height: b.height, mobile: b.mobile }; }
    if (a.device) { const d = findDevice(await fetchCatalog(ctx), a.device); return { width: d.width, height: d.height, mobile: d.mobile, name: d.name }; }
    return a.width ? { width: a.width, height: a.height } : undefined;
  }
  async function designCheck(name: string, a: any, params: Json) {
    const id = requireTab(ctx, a.tabId);
    const vp = await targetViewport(a);
    const res = await withViewport(ctx, id, vp, () => probe<Json>(ctx, id, name, params, 30_000));
    return { breakpoint: a.breakpoint ?? null, device: (vp as { name?: string } | undefined)?.name ?? null, ...res, notice: PAGE_TEXT_NOTICE };
  }

  tool(
    "check_typography",
    "Check typography",
    "Report the fonts and font sizes the page actually renders at a breakpoint: each font family with its share of text, weights and sample selectors, every font size, heading sizes per level, and issues: fonts that failed to load (a fallback is showing), one-off fonts or sizes, inconsistent heading sizes, headings larger than the level above, tight line-height. Read-only.",
    { ...where, limit: z.number().int().min(100).max(5000).optional().describe("Max text elements to scan, default 3000.") },
    readOnly,
    async (a) => ok(await designCheck("typography", a, { limit: a.limit })),
  );

  tool(
    "check_accessibility",
    "Check accessibility",
    "Automated WCAG 2.x checks at a breakpoint: missing html lang and page title, zoom disabled, images without alt, links/buttons without an accessible name, unlabeled form fields, positive tabindex, missing or multiple h1, skipped heading levels, missing main landmark, duplicate ids used by labels/ARIA, and text colour contrast on solid backgrounds (4.5:1, 3:1 for large text). Each issue has a WCAG criterion and selector. Not a full audit: keyboard flow, focus styles and screen-reader wording still need a manual check. Read-only.",
    { ...where, perType: z.number().int().min(1).max(50).optional().describe("Max issues listed per type, default 12 (counts stay complete).") },
    readOnly,
    async (a) => ok(await designCheck("accessibility", a, { perType: a.perType })),
  );

  tool(
    "check_section_spacing",
    "Check section spacing",
    "Measure the page's main sections top to bottom at a breakpoint: each section's padding/margins and background, and the white space between the visible content of neighbouring sections. Flags gaps far from the page's typical gap, overlapping sections and lopsided padding. Spacing is a design decision: show the measurements to the user and ask before changing anything. Read-only.",
    { ...where, selector: selector.optional().describe("Container whose children are the sections. Default: <main>, or <body>, stepping through single wrappers.") },
    readOnly,
    async (a) => ok(await designCheck("spacing", a, { selector: a.selector })),
  );

  tool(
    "get_page_structure",
    "Get page structure",
    "Return a bounded outline of the DOM (tag, id, classes, role, display, size, short text) under a selector (default body). Form values are never read. Use a narrow selector and low depth instead of dumping the page.",
    {
      selector: selector.optional(),
      depth: z.number().int().min(1).max(8).optional().describe("Default 3."),
      maxNodes: z.number().int().min(10).max(600).optional().describe("Default 150."),
      viewport: optionalViewport,
      tabId,
    },
    readOnly,
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const res = await withViewport(ctx, id, a.viewport, () => probe(ctx, id, "structure", { selector: a.selector, depth: a.depth, maxNodes: a.maxNodes }));
      return ok({ ...res, notice: PAGE_TEXT_NOTICE });
    },
  );

  tool(
    "inspect_element",
    "Inspect an element",
    "Inspect one element: attributes (no values of form fields; URLs without query strings), box model, rect, scroll sizes, flex/grid context, ancestors, children, key computed styles, the CSS rules that match it (same-origin stylesheets, with @media), and hints about likely layout constraints. Optionally at a given viewport width.",
    { selector, index: z.number().int().min(0).max(500).optional().describe("Which match to inspect when the selector matches several (default 0)."), viewport: optionalViewport, tabId },
    readOnly,
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const res = await withViewport(ctx, id, a.viewport, () => probe(ctx, id, "inspect", { selector: a.selector, index: a.index }));
      return ok({ ...res, notice: PAGE_TEXT_NOTICE });
    },
  );

  tool(
    "get_computed_styles",
    "Get computed styles",
    "Read computed CSS values for one element: a list of properties you name (max 80), or a default layout-focused set. Supports ::before/::after.",
    {
      selector,
      properties: z.array(z.string().regex(/^[a-z-]{2,60}$/)).max(80).optional(),
      pseudo: z.enum(["::before", "::after", "::first-line", "::first-letter", "::placeholder"]).optional(),
      index: z.number().int().min(0).max(500).optional(),
      viewport: optionalViewport,
      tabId,
    },
    readOnly,
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const res = await withViewport(ctx, id, a.viewport, () => probe(ctx, id, "styles", { selector: a.selector, properties: a.properties, pseudo: a.pseudo, index: a.index }));
      return ok({ ...res, notice: PAGE_TEXT_NOTICE });
    },
  );

  tool(
    "get_element_dimensions",
    "Get element dimensions",
    "Measure every match of a selector (up to `limit`): rect in document coordinates, offset/client/scroll sizes, box model, visibility, whether it is in the viewport and how far it extends past the left/right edges.",
    { selector, limit: z.number().int().min(1).max(50).optional(), viewport: optionalViewport, tabId },
    readOnly,
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const res = await withViewport(ctx, id, a.viewport, () => probe(ctx, id, "dimensions", { selector: a.selector, limit: a.limit }));
      return ok({ ...res, notice: PAGE_TEXT_NOTICE });
    },
  );

  // ── D. Screenshots ─────────────────────────────────────────────────
  tool(
    "take_screenshot",
    "Take a screenshot",
    "Capture the selected tab as PNG, optionally at a temporary viewport, full-page, or scaled. Saved to a private temp file and returned with an id (for compare_screenshots) and, by default, inline. Includes any CSS preview currently applied and says so.",
    {
      viewport: optionalViewport,
      fullPage: z.boolean().optional().describe("Capture beyond the viewport (height capped at 8000 CSS px)."),
      scale: z.number().min(0.25).max(2).optional().describe("Output scale, default 1."),
      inline: z.boolean().optional().describe("Return the image inline (default true when under 4 MB)."),
      label: z.string().max(60).optional().describe("Note to remember with the screenshot, e.g. 'before fix'."),
      tabId,
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const { shot, info } = await withViewport(ctx, id, a.viewport, async () => ({
        shot: await ctx.bridge.request<any>("screenshot", { tabId: id, fullPage: a.fullPage, scale: a.scale }, 40_000),
        info: await probe(ctx, id, "viewportInfo"),
      }));
      const png = Buffer.from(shot.base64, "base64");
      const patched = (ctx.patches.get(id)?.size ?? 0) > 0;
      const meta = ctx.shots.save(png, {
        width: shot.width,
        height: shot.height,
        url: info.url,
        viewport: { width: info.layoutWidth, height: info.clientHeight },
        fullPage: !!a.fullPage,
        label: a.label,
        patchApplied: patched,
      });
      const inline = (a.inline ?? true) && png.length < 4 * 1024 * 1024;
      return ok(
        {
          screenshotId: meta.id,
          path: meta.path,
          width: meta.width,
          height: meta.height,
          capturedAt: meta.takenAt,
          conditions: { viewport: meta.viewport, fullPage: meta.fullPage, scale: a.scale ?? 1, cssPreviewApplied: patched, url: meta.url },
          inline,
          note: inline ? undefined : "Image not inlined (too large or inline:false); open the saved file.",
        },
        inline ? [{ type: "image", data: shot.base64, mimeType: "image/png" }] : [],
      );
    },
  );

  tool(
    "compare_screenshots",
    "Compare screenshots",
    "Pixel-diff two saved screenshots (anti-aliasing tolerant). Reports changed pixel count, the changed regions as bounding boxes, and writes a diff image (changed pixels in red). Differences are not proof of a regression: animations, ads, fonts and dynamic content also change pixels. Images must have identical dimensions. Defaults to the two most recent screenshots (before = older).",
    {
      before: z.string().regex(/^shot_[0-9a-f]+$/).optional(),
      after: z.string().regex(/^shot_[0-9a-f]+$/).optional(),
      threshold: z.number().min(0).max(1).optional().describe("Per-pixel sensitivity, default 0.1 (lower is stricter)."),
      includeDiffImage: z.boolean().optional().describe("Return the diff image inline."),
    },
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      let { before, after } = a;
      if (!before || !after) {
        const last = ctx.shots.latest(2);
        if (last.length < 2) throw new BridgeError("not_enough_screenshots", "Need two screenshots to compare.", "Take a 'before' screenshot, make the change, take an 'after' screenshot, then compare.");
        before = before ?? last[0].id;
        after = after ?? last[1].id;
      }
      const A = ctx.shots.read(before);
      const B = ctx.shots.read(after);
      const res = compareImages(A.png, B.png, a.threshold ?? 0.1);
      const conditions = {
        before: { id: A.meta.id, label: A.meta.label, viewport: A.meta.viewport, fullPage: A.meta.fullPage, cssPreviewApplied: A.meta.patchApplied, capturedAt: A.meta.takenAt },
        after: { id: B.meta.id, label: B.meta.label, viewport: B.meta.viewport, fullPage: B.meta.fullPage, cssPreviewApplied: B.meta.patchApplied, capturedAt: B.meta.takenAt },
      };
      if (!res.comparable) return ok({ ...res, conditions });
      const diffMeta = ctx.shots.save(res.diffPng, { width: res.width, height: res.height, url: A.meta.url, fullPage: A.meta.fullPage, label: `diff ${before} vs ${after}` });
      const { diffPng, ...summary } = res;
      return ok(
        {
          ...summary,
          diffImage: { id: diffMeta.id, path: diffMeta.path },
          conditions,
          interpretation: res.identical
            ? "Pixel-identical at this threshold."
            : "Pixels differ. This is a measurement of change, not a verdict: check the regions and the screenshots to decide whether it is the intended change or a regression.",
        },
        a.includeDiffImage ? [{ type: "image", data: diffPng.toString("base64"), mimeType: "image/png" }] : [],
      );
    },
  );

  // ── E. Diagnostics ─────────────────────────────────────────────────
  const diagnostics = (kind: "console" | "network") => async (a: { limit?: number; sinceMinutes?: number; tabId?: number }): Promise<ToolResult> => {
    const id = requireTab(ctx, a.tabId);
    const sinceTs = a.sinceMinutes ? Date.now() - a.sinceMinutes * 60_000 : undefined;
    const res = await ctx.bridge.request<any>("diagnostics", { tabId: id, kind, limit: a.limit, sinceTs });
    return ok({ ...res, notice: PAGE_TEXT_NOTICE });
  };
  const diagShape = {
    limit: z.number().int().min(1).max(200).optional().describe("Most recent N entries (default 50)."),
    sinceMinutes: z.number().min(0.1).max(1440).optional(),
    tabId,
  };

  tool(
    "get_console_errors",
    "Get console errors",
    "JavaScript exceptions, console.error calls and browser error/warning log entries captured since the tab was authorized (or last reloaded through Codex Dev). Messages are truncated and obvious tokens redacted. Needs the debugger attached, which happens when the tab is allowed.",
    diagShape,
    readOnly,
    diagnostics("console"),
  );

  tool(
    "get_failed_requests",
    "Get failed requests",
    "Network requests that returned HTTP 4xx/5xx or failed (DNS, TLS, CORS, blocked) since the tab was authorized or last reloaded. URLs have query strings removed; headers, bodies and cookies are never captured.",
    diagShape,
    readOnly,
    diagnostics("network"),
  );

  // ── F. CSS fix preview ─────────────────────────────────────────────
  tool(
    "preview_css_patch",
    "Preview a CSS patch",
    "Temporarily apply CSS to the selected tab as an in-memory stylesheet (not written to any file, not JavaScript, gone on reload). Use it to test a fix before editing source, then re-run an audit with reload:false. Max 20 KB; @import, external url() and script constructs are rejected. You must still make the real change in the project's source files.",
    {
      css: z.string().min(1).max(20 * 1024).describe("CSS rules to apply."),
      id: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional().describe("Patch name, default 'default'. Re-using an id replaces it."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      validateCssPatch(a.css);
      const id = requireTab(ctx, a.tabId);
      const res = await ctx.bridge.request<any>("apply_patch", { tabId: id, id: a.id ?? "default", css: a.css });
      ctx.patches.set(id, new Set(res.active));
      return ok({ ...res, temporary: true, note: "Preview only. Nothing was saved to the project; edit the source files to make this permanent. Reloading the page removes it." });
    },
  );

  tool(
    "clear_css_patch",
    "Clear CSS patches",
    "Remove the preview stylesheet(s) added by preview_css_patch, restoring the page's original styling.",
    { id: z.string().regex(/^[a-z0-9_-]{1,32}$/i).optional().describe("Patch to remove; omit to remove all."), tabId },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (a) => {
      const id = requireTab(ctx, a.tabId);
      const res = await ctx.bridge.request<any>("clear_patch", { tabId: id, id: a.id });
      if (res.active.length) ctx.patches.set(id, new Set(res.active));
      else ctx.patches.delete(id);
      return ok(res);
    },
  );

  // ── H. Design Inspector AI (section preview) ───────────────────────
  // Same engine and validator as the in-page panel. There is no AI here: Claude Code
  // supplies the operations. Nothing is uploaded, and nothing is written to the project.
  const designOp = z.union([
    z.object({ op: z.literal("set"), property: z.string().min(1).max(40), value: z.string().min(1).max(300), breakpoint: z.enum(["base", "tablet", "mobile"]).optional() }),
    z.object({ op: z.literal("remove"), property: z.string().min(1).max(40), breakpoint: z.enum(["base", "tablet", "mobile"]).optional() }),
    z.object({ op: z.literal("text"), value: z.string().min(1).max(500) }),
  ]);
  const design = async (tabIdArg: number | undefined, action: string, params: Json = {}) => ctx.bridge.request<any>("design", { tabId: requireTab(ctx, tabIdArg), action, params }, 30_000);
  const mutating = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

  tool(
    "select_target_section",
    "Select target section",
    "Choose the page element (first match of a CSS selector) that preview_section_patch will restyle. The user can instead pick it visually in the Design Inspector AI panel. Adds only an extension-owned data attribute.",
    { selector, tabId },
    mutating,
    async (a) => ok({ ...(await design(a.tabId, "select", { selector: a.selector })), notice: PAGE_TEXT_NOTICE }),
  );

  tool(
    "get_selected_element_context",
    "Get selected element context",
    "Describe the current target section: tag, classes, selector, size, viewport, short text, key computed styles and sanitized HTML (truncated). Form values and scripts are never included.",
    { tabId },
    readOnly,
    async (a) => ok({ ...(await design(a.tabId, "context")), notice: PAGE_TEXT_NOTICE }),
  );

  tool(
    "preview_section_patch",
    "Preview section patch",
    "Apply validated design operations to the selected target section as a temporary, undoable preview (all-or-nothing). Operations: set/remove an allow-listed CSS property per breakpoint (base = desktop, tablet ≤1024px, mobile ≤640px), or replace the text of a leaf element. No position, url(), scripts or selectors. Nothing is saved to the website or project.",
    { operations: z.array(designOp).min(1).max(60), label: z.string().max(80).optional(), tabId },
    mutating,
    async (a) => ok(await design(a.tabId, "patch", { operations: a.operations, label: a.label })),
  );

  tool(
    "reset_section_preview",
    "Reset section preview",
    "Undo the last section preview step, reset the selected section, or remove every Design Inspector AI preview on the page.",
    { mode: z.enum(["undo", "section", "all"]).optional().describe("Default: section."), tabId },
    mutating,
    async (a) => ok(await design(a.tabId, a.mode === "undo" ? "undo" : a.mode === "all" ? "resetAll" : "reset")),
  );

  tool(
    "export_section_patch",
    "Export section patch",
    "Export the CSS the preview applied (exactly as previewed), optionally with a sanitized HTML snapshot of the section and framework guidance. Guidance for React, Next.js and Tailwind is instructions only: no component is generated.",
    { framework: z.enum(["html", "react", "next", "tailwind"]).optional(), important: z.boolean().optional(), includeHtml: z.boolean().optional(), tabId },
    readOnly,
    async (a) => ok({ ...(await design(a.tabId, "export", { framework: a.framework, important: a.important, includeHtml: a.includeHtml })), notice: PAGE_TEXT_NOTICE }),
  );

  tool(
    "generate_section_recreation",
    "Generate section recreation (AI)",
    "Not available: Design Inspector AI has no AI provider connected in this version, so it cannot analyse a reference screenshot or generate a design itself. Always returns provider_not_configured. To restyle a section, work out the CSS yourself and use preview_section_patch.",
    {},
    readOnly,
    async () => {
      throw new BridgeError("provider_not_configured", "AI design generation is not available: no AI provider is configured in this version.", "Use preview_section_patch with operations you choose, or the manual builder in the Design Inspector AI panel.");
    },
  );

  // ── G. Verification workflow ───────────────────────────────────────
  tool(
    "verify_responsive_fix",
    "Verify responsive fix",
    "Re-run the responsive audit and compare it with a baseline report by stable issue id: which issues are resolved, still present, partially resolved or newly introduced, which viewports were tested, and what could not be verified. Defaults to the latest report as baseline, reloads the tab first (picks up source changes; set reload:false to verify an unsaved CSS preview instead) and re-tests the baseline's viewports.",
    {
      baselineReportId: z.string().regex(/^audit_[0-9a-f]+$/).optional(),
      viewports: z.array(viewportSchema).min(1).max(16).optional().describe("Defaults to the viewports of the baseline report."),
      reload: z.boolean().optional().describe("Default true."),
      waitMs: z.number().int().min(0).max(15000).optional().describe("Pause before measuring so a dev server can rebuild (default 1000)."),
      screenshots: z.boolean().optional().describe("Default true."),
      tabId,
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (a) => {
      if (a.tabId != null) ctx.selected.tabId = a.tabId;
      const baseline = ctx.reports.get(a.baselineReportId);
      const viewports = a.viewports?.length ? resolveViewports(a.viewports) : baseline.viewports.map((v) => v.viewport);
      const reload = a.reload ?? true;
      if (reload) ctx.patches.delete(requireTab(ctx));
      await new Promise((r) => setTimeout(r, a.waitMs ?? 1000));
      const current = await runAudit(ctx, { viewports, selector: baseline.focusSelector ?? undefined, screenshots: a.screenshots ?? true, reload, baselineOf: baseline.id });
      const cmp = compareReports(baseline, current);
      const shots = viewports.flatMap((vp) => {
        const b = baseline.viewports.find((v) => v.viewport.width === vp.width && v.viewport.height === vp.height)?.screenshot;
        const c = current.viewports.find((v) => v.viewport.width === vp.width && v.viewport.height === vp.height)?.screenshot;
        return b && c ? [{ viewport: vp, before: b.id, after: c.id }] : [];
      });
      return ok({
        verdict: cmp.verdict,
        comparison: cmp,
        screenshotPairs: shots,
        screenshotHint: shots.length ? "Pass a pair to compare_screenshots for a pixel diff." : undefined,
        current: shapeReport(current, "summary", 20),
        cssPreviewActive: (ctx.patches.get(requireTab(ctx))?.size ?? 0) > 0,
      });
    },
  );

  tool(
    "get_audit_report",
    "Get audit report",
    "Fetch a stored audit report (default: latest) or list the reports kept in memory. detail:'full' includes every per-viewport occurrence with rects and computed CSS.",
    { reportId: z.string().regex(/^audit_[0-9a-f]+$/).optional(), list: z.boolean().optional(), detail: z.enum(["summary", "full"]).optional() },
    readOnly,
    async (a) => {
      if (a.list) return ok({ reports: ctx.reports.list() });
      return ok(shapeReport(ctx.reports.get(a.reportId), a.detail ?? "full", 100));
    },
  );
}
