import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeError } from "./errors.js";
import type { AuditReport, ScreenshotMeta } from "./types.js";

const MAX_REPORTS = 25;
const MAX_SCREENSHOTS = 80;

export class ReportStore {
  private reports = new Map<string, AuditReport>();
  private order: string[] = [];

  save(r: AuditReport): void {
    this.reports.set(r.id, r);
    this.order.push(r.id);
    while (this.order.length > MAX_REPORTS) this.reports.delete(this.order.shift()!);
  }

  get(id?: string): AuditReport {
    const key = id ?? this.order[this.order.length - 1];
    const r = key ? this.reports.get(key) : undefined;
    if (!r) {
      throw new BridgeError(
        "report_not_found",
        id ? `No audit report with id "${id}".` : "No audit has been run in this session yet.",
        "Run run_responsive_audit first. Reports are kept in memory for the life of the MCP server.",
      );
    }
    return r;
  }

  list(): { id: string; createdAt: string; url: string; issues: number }[] {
    return this.order.map((id) => {
      const r = this.reports.get(id)!;
      return { id, createdAt: r.createdAt, url: r.page.url, issues: r.issues.length };
    });
  }
}

/** PNG screenshots kept in a private temp directory and referenced by id. */
export class ScreenshotStore {
  private metas = new Map<string, ScreenshotMeta>();
  private order: string[] = [];
  readonly dir: string;

  constructor(dir?: string) {
    this.dir = dir ?? join(tmpdir(), `codex-dev-mcp-${typeof process.getuid === "function" ? process.getuid() : "user"}`);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(this.dir, 0o700);
    } catch {
      /* not supported on this platform */
    }
  }

  save(png: Buffer, meta: Omit<ScreenshotMeta, "id" | "path" | "takenAt">): ScreenshotMeta {
    const id = "shot_" + randomBytes(5).toString("hex");
    const path = join(this.dir, `${id}.png`);
    writeFileSync(path, png, { mode: 0o600 });
    const full: ScreenshotMeta = { ...meta, id, path, takenAt: new Date().toISOString() };
    this.metas.set(id, full);
    this.order.push(id);
    while (this.order.length > MAX_SCREENSHOTS) {
      const old = this.order.shift()!;
      const m = this.metas.get(old);
      this.metas.delete(old);
      if (m && existsSync(m.path)) rmSync(m.path, { force: true });
    }
    return full;
  }

  meta(id: string): ScreenshotMeta {
    const m = this.metas.get(id);
    if (!m) throw new BridgeError("screenshot_not_found", `No screenshot with id "${id}".`, "Take one with take_screenshot, or pass screenshots:true to run_responsive_audit.");
    return m;
  }

  read(id: string): { meta: ScreenshotMeta; png: Buffer } {
    const meta = this.meta(id);
    return { meta, png: readFileSync(meta.path) };
  }

  latest(n = 1): ScreenshotMeta[] {
    return this.order.slice(-n).map((id) => this.metas.get(id)!);
  }

  list(): ScreenshotMeta[] {
    return this.order.map((id) => this.metas.get(id)!);
  }
}
