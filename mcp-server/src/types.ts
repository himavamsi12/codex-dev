export type Severity = "critical" | "high" | "medium" | "low";
export type Confidence = "deterministic" | "heuristic";

export interface ViewportSpec {
  width: number;
  height: number;
  label?: string;
  /** Chrome's mobile emulation flag; set for catalog phones and tablets. */
  mobile?: boolean;
}

/** One issue as returned by the page probe for a single viewport. */
export interface RawIssue {
  id: string;
  type: string;
  severity: Severity;
  confidence: Confidence;
  selector: string;
  message: string;
  tag?: string;
  text?: string;
  rect?: { x: number; y: number; width: number; height: number; right?: number };
  likelyCauses?: string[];
  computed?: Record<string, string>;
  [extra: string]: unknown;
}

export interface IssueOccurrence {
  viewport: ViewportSpec;
  message: string;
  severity: Severity;
  rect?: RawIssue["rect"];
  details: Record<string, unknown>;
}

/** An issue merged across every viewport it appeared in. Identified by a stable id. */
export interface Issue {
  id: string;
  type: string;
  severity: Severity;
  confidence: Confidence;
  selector: string;
  tag?: string;
  text?: string;
  summary: string;
  likelyCauses: string[];
  computed?: Record<string, string>;
  recommendation: string;
  viewports: IssueOccurrence[];
}

export interface ViewportResult {
  viewport: ViewportSpec;
  tested: boolean;
  skippedReason?: string;
  layoutWidth?: number;
  horizontalScroll?: boolean;
  documentOverflowPx?: number;
  issueIds: string[];
  elementsScanned?: number;
  scanTruncated?: boolean;
  screenshot?: { id: string; path: string; width: number; height: number };
  waitedMs?: number;
  stable?: boolean;
}

export interface AuditReport {
  id: string;
  createdAt: string;
  page: { url: string; title: string; tabId: number };
  method: string;
  focusSelector: string | null;
  viewports: ViewportResult[];
  issues: Issue[];
  summary: {
    viewportsRequested: number;
    viewportsTested: number;
    issues: number;
    bySeverity: Record<Severity, number>;
    deterministic: number;
    heuristic: number;
  };
  notTested: { viewport: ViewportSpec; reason: string }[];
  limitations: string[];
  baselineOf?: string;
}

export interface ScreenshotMeta {
  id: string;
  path: string;
  width: number;
  height: number;
  takenAt: string;
  url: string;
  viewport?: { width: number; height: number };
  fullPage: boolean;
  label?: string;
  patchApplied?: boolean;
}
