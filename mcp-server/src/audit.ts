import { randomBytes } from "node:crypto";
import { type Context, requireTab } from "./context.js";
import { BridgeError, describeError } from "./errors.js";
import type { AuditReport, Issue, IssueOccurrence, RawIssue, Severity, ViewportResult, ViewportSpec } from "./types.js";

export const DEFAULT_VIEWPORTS: ViewportSpec[] = [
  { width: 320, height: 720, label: "mobile-320" },
  { width: 375, height: 812, label: "mobile-375" },
  { width: 390, height: 844, label: "mobile-390" },
  { width: 430, height: 932, label: "mobile-430" },
  { width: 768, height: 1024, label: "tablet-768" },
  { width: 1024, height: 768, label: "tablet-1024" },
  { width: 1280, height: 800, label: "desktop-1280" },
  { width: 1440, height: 900, label: "desktop-1440" },
  { width: 1920, height: 1080, label: "desktop-1920" },
];

/**
 * The three named breakpoints. They match the Responsive Viewer's default
 * "Mobile / Tablet / Desktop" preset (devices.js), so what Claude measures is
 * what the user sees in the viewer.
 */
export const BREAKPOINTS = {
  mobile: { device: "iPhone 14 Pro", width: 393, height: 852, deviceScaleFactor: 3, mobile: true },
  tablet: { device: "iPad Air", width: 820, height: 1180, deviceScaleFactor: 2, mobile: true },
  desktop: { device: "Desktop (1920x1080)", width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false },
} as const;
export type BreakpointName = keyof typeof BREAKPOINTS;
export const BREAKPOINT_NAMES = Object.keys(BREAKPOINTS) as BreakpointName[];

/** Width/height for a breakpoint, swapped for landscape. */
export function breakpointViewport(name: BreakpointName, landscape = false) {
  const b = BREAKPOINTS[name];
  const [width, height] = landscape && name !== "desktop" ? [b.height, b.width] : [b.width, b.height];
  return { ...b, width, height, label: name + (landscape && name !== "desktop" ? "-landscape" : "") };
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

const RECOMMENDATIONS: Record<string, string> = {
  "horizontal-overflow":
    "Find the widest elements with get_layout_overflow, then constrain them (max-width: 100%, min-width: 0 on flex/grid children, overflow-wrap: anywhere for long strings). Avoid overflow-x: hidden on body as a fix: it hides the problem.",
  "overflowing-element":
    "Inspect the element with inspect_element and check likelyCauses. Typical fixes: max-width: 100% on media, flex-wrap: wrap or min-width: 0 on flex rows, replacing fixed px widths with fluid units, wrapping tables in a scroll container.",
  "viewport-meta-missing": 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.',
  "text-clipped": "If the text matters, allow it to wrap (white-space: normal, overflow-wrap: anywhere) or add text-overflow: ellipsis with a title/tooltip. Ignore if the truncation is intentional.",
  "offscreen-control": "Confirm whether this is an intentional off-canvas menu. If not, check position/transform/left values and the parent's width at this viewport.",
  "overlapping-control": "Check z-index and absolute/negative-margin positioning on the covering element; use inspect_element on both selectors.",
  "small-tap-target": "Give the control at least 24×24px of hit area (ideally 44×44px) with padding or min-height/min-width.",
  "small-text": "Raise the font size, or confirm the text is decorative.",
};

export interface AuditOptions {
  viewports: ViewportSpec[];
  selector?: string;
  screenshots: boolean;
  reload: boolean;
  keepViewport?: boolean;
  settleTimeoutMs?: number;
  baselineOf?: string;
}

export const LIMITATIONS = [
  "Measured in the real browser tab using Chrome device-metrics emulation (width, height, device scale factor, mobile flag). It does not use the Codex Dev iframe viewer, so device-frame bezels and mockup chrome never count as page overflow.",
  "Emulation does not change the user agent, touch input or server-side device detection; sites that serve different HTML per user agent are measured as served to the current browser.",
  "Only the top frame is scanned; content inside cross-origin iframes is not inspected.",
  "Findings marked 'deterministic' are direct layout measurements. Findings marked 'heuristic' are likely problems that can be intentional (off-canvas menus, truncation); verify them before changing code.",
  "The audit cannot judge visual design quality, colour contrast or content, and does not claim to find every responsive defect.",
];

const newId = (prefix: string) => `${prefix}_${randomBytes(4).toString("hex")}`;
const tag = (v: ViewportSpec) => `${v.width}x${v.height}`;

function worse(a: Severity, b: Severity): boolean {
  return SEVERITY_RANK[a] > SEVERITY_RANK[b];
}

/** Merges per-viewport probe issues into issues keyed by stable id. */
export function mergeIssues(perViewport: { viewport: ViewportSpec; issues: RawIssue[] }[]): Issue[] {
  const map = new Map<string, Issue>();
  for (const { viewport, issues } of perViewport) {
    for (const raw of issues) {
      const { id, type, severity, confidence, selector, message, tag: t, text, rect, likelyCauses, computed, ...rest } = raw;
      const occ: IssueOccurrence = { viewport, message, severity, rect, details: rest };
      const existing = map.get(id);
      if (!existing) {
        map.set(id, {
          id,
          type,
          severity,
          confidence,
          selector,
          tag: t,
          text,
          summary: message,
          likelyCauses: [...(likelyCauses ?? [])],
          computed,
          recommendation: RECOMMENDATIONS[type] ?? "Inspect the element with inspect_element.",
          viewports: [occ],
        });
      } else {
        existing.viewports.push(occ);
        if (worse(severity, existing.severity)) {
          existing.severity = severity;
          existing.summary = message;
          existing.computed = computed ?? existing.computed;
        }
        for (const c of likelyCauses ?? []) if (!existing.likelyCauses.includes(c)) existing.likelyCauses.push(c);
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || (a.confidence === b.confidence ? 0 : a.confidence === "deterministic" ? -1 : 1) || b.viewports.length - a.viewports.length,
  );
}

export function summarize(issues: Issue[], viewports: ViewportResult[]): AuditReport["summary"] {
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) bySeverity[i.severity]++;
  return {
    viewportsRequested: viewports.length,
    viewportsTested: viewports.filter((v) => v.tested).length,
    issues: issues.length,
    bySeverity,
    deterministic: issues.filter((i) => i.confidence === "deterministic").length,
    heuristic: issues.filter((i) => i.confidence === "heuristic").length,
  };
}

export async function setViewport(ctx: Context, tabId: number, v: ViewportSpec & { deviceScaleFactor?: number; mobile?: boolean }) {
  return ctx.bridge.request("set_viewport", { tabId, width: v.width, height: v.height, deviceScaleFactor: v.deviceScaleFactor, mobile: v.mobile });
}

/** Sets each viewport on the selected tab, measures it, and builds a report. */
export async function runAudit(ctx: Context, opts: AuditOptions): Promise<AuditReport> {
  const tabId = requireTab(ctx);
  const tab = await ctx.bridge.request<{ title: string; url: string; emulation: any }>("validate_tab", { tabId });
  const previous = tab.emulation as { width: number; height: number; deviceScaleFactor?: number; mobile?: boolean } | null;

  if (opts.reload) await ctx.bridge.request("reload", { tabId }, 45_000);

  const results: ViewportResult[] = [];
  const raw: { viewport: ViewportSpec; issues: RawIssue[] }[] = [];
  const notTested: AuditReport["notTested"] = [];
  let fatal: BridgeError | null = null;

  try {
    for (const viewport of opts.viewports) {
      if (fatal) {
        const reason = `Skipped after an earlier failure: ${fatal.message}`;
        results.push({ viewport, tested: false, skippedReason: reason, issueIds: [] });
        notTested.push({ viewport, reason });
        continue;
      }
      try {
        await setViewport(ctx, tabId, viewport);
        const settle = await ctx.bridge.request<{ stable: boolean; waitedMs: number }>(
          "probe",
          { tabId, probe: "waitStable", params: { timeoutMs: opts.settleTimeoutMs ?? 3000 } },
          15_000,
        );
        const res = await ctx.bridge.request<any>(
          "probe",
          { tabId, probe: "audit", params: { expectedWidth: viewport.width, selector: opts.selector } },
          30_000,
        );
        let screenshot: ViewportResult["screenshot"];
        if (opts.screenshots) {
          try {
            const shot = await ctx.bridge.request<{ base64: string; width: number; height: number }>("screenshot", { tabId }, 30_000);
            const meta = ctx.shots.save(Buffer.from(shot.base64, "base64"), {
              width: shot.width,
              height: shot.height,
              url: res.viewport.url,
              viewport: { width: viewport.width, height: viewport.height },
              fullPage: false,
              label: `audit ${tag(viewport)}`,
            });
            screenshot = { id: meta.id, path: meta.path, width: meta.width, height: meta.height };
          } catch (e) {
            notTested.push({ viewport, reason: `Screenshot failed: ${describeError(e).message}` });
          }
        }
        raw.push({ viewport, issues: res.issues as RawIssue[] });
        results.push({
          viewport,
          tested: true,
          layoutWidth: res.viewport.clientWidth,
          horizontalScroll: res.horizontalScroll,
          documentOverflowPx: res.documentOverflowPx,
          issueIds: (res.issues as RawIssue[]).map((i) => i.id),
          elementsScanned: res.counts.scanned,
          scanTruncated: res.truncated,
          screenshot,
          waitedMs: settle.waitedMs,
          stable: settle.stable,
        });
      } catch (e) {
        const err = e instanceof BridgeError ? e : new BridgeError("internal_error", String(e));
        // Connection / authorization problems will not fix themselves on the next viewport
        if (["extension_not_connected", "extension_disconnected", "tab_not_authorized", "tab_closed", "page_inaccessible", "debugger_unavailable"].includes(err.code)) fatal = err;
        results.push({ viewport, tested: false, skippedReason: err.message, issueIds: [] });
        notTested.push({ viewport, reason: err.message });
      }
    }
  } finally {
    if (!opts.keepViewport) {
      try {
        if (previous) await setViewport(ctx, tabId, previous);
        else await ctx.bridge.request("set_viewport", { tabId, reset: true });
      } catch {
        /* best effort: the user can reset from the debugger banner */
      }
    }
  }

  const issues = mergeIssues(raw);
  const limitations = [...LIMITATIONS];
  if (results.some((r) => r.scanTruncated)) limitations.push("At least one viewport hit the element scan cap, so very large pages were only partly scanned.");
  if (!opts.screenshots) limitations.push("Screenshots were not requested.");
  const report: AuditReport = {
    id: newId("audit"),
    createdAt: new Date().toISOString(),
    page: { url: tab.url, title: tab.title, tabId },
    method: "chrome-device-metrics-emulation",
    focusSelector: opts.selector ?? null,
    viewports: results,
    issues,
    summary: summarize(issues, results),
    notTested,
    limitations,
    baselineOf: opts.baselineOf,
  };
  ctx.reports.save(report);
  return report;
}

export interface Comparison {
  baselineId: string;
  currentId: string;
  resolved: { id: string; type: string; selector: string; viewports: number[] }[];
  persisting: { id: string; type: string; selector: string; severity: Severity; viewports: number[]; changed?: string }[];
  introduced: { id: string; type: string; selector: string; severity: Severity; viewports: number[] }[];
  partiallyResolved: { id: string; selector: string; fixedViewports: number[]; remainingViewports: number[] }[];
  notVerified: { id: string; selector: string; viewports: number[]; reason: string }[];
  viewportsTested: number[];
  viewportsNotTested: { viewport: ViewportSpec; reason: string }[];
  verdict: "improved" | "unchanged" | "regressed" | "mixed" | "inconclusive";
}

const widths = (i: Issue) => i.viewports.map((o) => o.viewport.width);

/** Compares two reports by stable issue id and viewport width. */
export function compareReports(base: AuditReport, cur: AuditReport): Comparison {
  const testedNow = new Set(cur.viewports.filter((v) => v.tested).map((v) => v.viewport.width));
  const baseById = new Map(base.issues.map((i) => [i.id, i]));
  const curById = new Map(cur.issues.map((i) => [i.id, i]));

  const resolved: Comparison["resolved"] = [];
  const persisting: Comparison["persisting"] = [];
  const introduced: Comparison["introduced"] = [];
  const partiallyResolved: Comparison["partiallyResolved"] = [];
  const notVerified: Comparison["notVerified"] = [];

  for (const [id, b] of baseById) {
    const c = curById.get(id);
    const bw = widths(b);
    const verifiable = bw.filter((w) => testedNow.has(w));
    if (!verifiable.length) {
      notVerified.push({ id, selector: b.selector, viewports: bw, reason: "None of this issue's viewports were tested in the new run." });
      continue;
    }
    if (!c) {
      resolved.push({ id, type: b.type, selector: b.selector, viewports: verifiable });
      if (verifiable.length < bw.length) notVerified.push({ id, selector: b.selector, viewports: bw.filter((w) => !testedNow.has(w)), reason: "Some viewports were not re-tested." });
      continue;
    }
    const cw = widths(c);
    const fixed = verifiable.filter((w) => !cw.includes(w));
    if (fixed.length) partiallyResolved.push({ id, selector: b.selector, fixedViewports: fixed, remainingViewports: cw });
    const changed = c.severity !== b.severity ? `severity ${b.severity} → ${c.severity}` : undefined;
    persisting.push({ id, type: c.type, selector: c.selector, severity: c.severity, viewports: cw, changed });
  }
  for (const [id, c] of curById) {
    if (!baseById.has(id)) introduced.push({ id, type: c.type, selector: c.selector, severity: c.severity, viewports: widths(c) });
  }

  let verdict: Comparison["verdict"];
  const anyTested = testedNow.size > 0;
  if (!anyTested) verdict = "inconclusive";
  else if (!resolved.length && !introduced.length && !partiallyResolved.length) verdict = "unchanged";
  else if (introduced.length && (resolved.length || partiallyResolved.length)) verdict = "mixed";
  else if (introduced.length) verdict = "regressed";
  else verdict = "improved";

  return {
    baselineId: base.id,
    currentId: cur.id,
    resolved,
    persisting,
    introduced,
    partiallyResolved,
    notVerified,
    viewportsTested: [...testedNow],
    viewportsNotTested: cur.notTested.map((n) => n),
    verdict,
  };
}
