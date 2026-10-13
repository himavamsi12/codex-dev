import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PNG } from "pngjs";
import { compareReports, mergeIssues, summarize } from "../src/audit.js";
import { compareImages } from "../src/diff.js";
import type { AuditReport, RawIssue, ViewportResult, ViewportSpec } from "../src/types.js";

const vp = (width: number): ViewportSpec => ({ width, height: 800, label: `${width}` });
const raw = (id: string, over: Partial<RawIssue> = {}): RawIssue => ({
  id,
  type: id.split(":")[0],
  severity: "medium",
  confidence: "deterministic",
  selector: "#" + id.split(":")[1],
  message: "msg " + id,
  ...over,
});

function report(id: string, perVp: Record<number, RawIssue[] | null>): AuditReport {
  const viewports: ViewportResult[] = [];
  const merged: { viewport: ViewportSpec; issues: RawIssue[] }[] = [];
  const notTested: AuditReport["notTested"] = [];
  for (const [w, issues] of Object.entries(perVp)) {
    const v = vp(+w);
    if (issues === null) {
      viewports.push({ viewport: v, tested: false, skippedReason: "boom", issueIds: [] });
      notTested.push({ viewport: v, reason: "boom" });
    } else {
      viewports.push({ viewport: v, tested: true, issueIds: issues.map((i) => i.id) });
      merged.push({ viewport: v, issues });
    }
  }
  const issues = mergeIssues(merged);
  return { id, createdAt: "", page: { url: "http://x/", title: "", tabId: 1 }, method: "m", focusSelector: null, viewports, issues, summary: summarize(issues, viewports), notTested, limitations: [] };
}

describe("issue merging", () => {
  it("merges the same id across viewports and keeps the worst severity", () => {
    const issues = mergeIssues([
      { viewport: vp(320), issues: [raw("overflowing-element:nav", { severity: "high", message: "worse", likelyCauses: ["a"] })] },
      { viewport: vp(375), issues: [raw("overflowing-element:nav", { severity: "medium", likelyCauses: ["a", "b"] })] },
    ]);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].severity, "high");
    assert.equal(issues[0].summary, "worse");
    assert.deepEqual(issues[0].viewports.map((o) => o.viewport.width), [320, 375]);
    assert.deepEqual(issues[0].likelyCauses, ["a", "b"]);
  });

  it("sorts by severity, then deterministic before heuristic", () => {
    const issues = mergeIssues([
      {
        viewport: vp(375),
        issues: [raw("small-text:a", { severity: "low", confidence: "heuristic" }), raw("text-clipped:b", { severity: "medium", confidence: "heuristic" }), raw("overflowing-element:c", { severity: "medium" }), raw("horizontal-overflow:document", { severity: "high" })],
      },
    ]);
    assert.deepEqual(issues.map((i) => i.id), ["horizontal-overflow:document", "overflowing-element:c", "text-clipped:b", "small-text:a"]);
  });

  it("summarizes counts by severity and confidence", () => {
    const r = report("a", { 375: [raw("horizontal-overflow:document", { severity: "high" }), raw("small-text:x", { severity: "low", confidence: "heuristic" })] });
    assert.deepEqual(r.summary.bySeverity, { critical: 0, high: 1, medium: 0, low: 1 });
    assert.equal(r.summary.deterministic, 1);
    assert.equal(r.summary.heuristic, 1);
  });
});

describe("report comparison", () => {
  it("classifies resolved, persisting, partially resolved and introduced issues", () => {
    const base = report("b", {
      320: [raw("overflowing-element:nav"), raw("overflowing-element:hero"), raw("small-text:t", { confidence: "heuristic", severity: "low" })],
      375: [raw("overflowing-element:nav"), raw("overflowing-element:hero")],
    });
    const cur = report("c", {
      320: [raw("overflowing-element:hero"), raw("overflowing-element:footer")],
      375: [raw("overflowing-element:hero")],
    });
    const cmp = compareReports(base, cur);
    assert.deepEqual(cmp.resolved.map((r) => r.id).sort(), ["overflowing-element:nav", "small-text:t"]);
    assert.deepEqual(cmp.persisting.map((p) => p.id), ["overflowing-element:hero"]);
    assert.deepEqual(cmp.introduced.map((i) => i.id), ["overflowing-element:footer"]);
    assert.equal(cmp.verdict, "mixed");
    assert.deepEqual(cmp.viewportsTested.sort(), [320, 375]);
  });

  it("detects a partial fix (gone at one viewport, still present at another)", () => {
    const base = report("b", { 320: [raw("overflowing-element:nav")], 768: [raw("overflowing-element:nav")] });
    const cur = report("c", { 320: [raw("overflowing-element:nav")], 768: [] });
    const cmp = compareReports(base, cur);
    assert.equal(cmp.persisting.length, 1);
    assert.deepEqual(cmp.partiallyResolved[0].fixedViewports, [768]);
    assert.deepEqual(cmp.partiallyResolved[0].remainingViewports, [320]);
    assert.equal(cmp.verdict, "improved");
  });

  it("does not claim a fix for viewports that were not re-tested", () => {
    const base = report("b", { 320: [raw("overflowing-element:nav")], 1280: [raw("overflowing-element:wide")] });
    const cur = report("c", { 320: [], 1280: null });
    const cmp = compareReports(base, cur);
    assert.deepEqual(cmp.resolved.map((r) => r.id), ["overflowing-element:nav"]);
    assert.deepEqual(cmp.notVerified.map((n) => n.id), ["overflowing-element:wide"]);
    assert.deepEqual(cmp.viewportsNotTested.map((n) => n.viewport.width), [1280]);
  });

  it("is inconclusive when nothing could be tested and unchanged when identical", () => {
    const base = report("b", { 320: [raw("overflowing-element:nav")] });
    assert.equal(compareReports(base, report("c", { 320: null })).verdict, "inconclusive");
    assert.equal(compareReports(base, report("d", { 320: [raw("overflowing-element:nav")] })).verdict, "unchanged");
  });

  it("flags severity changes on persisting issues", () => {
    const base = report("b", { 320: [raw("overflowing-element:nav", { severity: "high" })] });
    const cur = report("c", { 320: [raw("overflowing-element:nav", { severity: "medium" })] });
    assert.equal(compareReports(base, cur).persisting[0].changed, "severity high → medium");
  });
});

function png(w: number, h: number, paint: (x: number, y: number) => [number, number, number]): Buffer {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
    }
  return PNG.sync.write(p);
}

describe("image comparison", () => {
  const white = () => [255, 255, 255] as [number, number, number];

  it("reports identical images as identical", () => {
    const r = compareImages(png(64, 64, white), png(64, 64, white));
    assert.ok(r.comparable);
    assert.equal(r.identical, true);
    assert.equal(r.changedPixels, 0);
    assert.equal(r.regions.length, 0);
  });

  it("finds the changed region with a bounding box", () => {
    const changed = png(200, 100, (x, y) => (x >= 120 && x < 160 && y >= 40 && y < 70 ? [0, 0, 0] : [255, 255, 255]));
    const r = compareImages(png(200, 100, white), changed);
    assert.ok(r.comparable && !r.identical);
    assert.equal(r.changedPixels, 40 * 30);
    assert.equal(r.regions.length, 1);
    const g = r.regions[0];
    assert.ok(g.x <= 120 && g.x + g.width >= 160 && g.y <= 40 && g.y + g.height >= 70, JSON.stringify(g));
    assert.ok(g.width <= 40 + 32 && g.height <= 30 + 32, "box is tight (within one 16px cell of the change)");
    assert.ok(PNG.sync.read(r.diffPng).width === 200);
  });

  it("separates distant changes into distinct regions", () => {
    const b = png(300, 100, (x, y) => ((x < 20 && y < 20) || (x >= 260 && y >= 70) ? [0, 0, 0] : [255, 255, 255]));
    const r = compareImages(png(300, 100, white), b);
    assert.ok(r.comparable);
    assert.equal(r.regions.length, 2);
  });

  it("refuses to diff images with different dimensions", () => {
    const r = compareImages(png(10, 10, white), png(10, 12, white));
    assert.equal(r.comparable, false);
    if (!r.comparable) assert.deepEqual(r.b, { width: 10, height: 12 });
  });
});
