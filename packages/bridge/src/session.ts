import { RestoreConflict, createCheckpoint, finishCheckpoint, restoreCheckpoint, type Checkpoint } from "./checkpoint.js";
import { buildPrompt } from "./prompt.js";
import type { AgentRunner } from "./agent.js";
import type { FileChange, Selection, ServerMessage } from "./protocol.js";

const MAX_UNDO = 20;

type Send = (m: ServerMessage) => void;
interface Pending { id: string; cp: Checkpoint; files: FileChange[] }

/** One edit at a time: idle → editing → awaiting review → (accepted | rejected). Accepted edits stack for undo. */
export class EditSession {
  private busy: { id: string; abort: AbortController } | null = null;
  private pending: Pending | null = null;
  private undoStack: { id: string; cp: Checkpoint }[] = [];
  lastSelection: Selection | null = null;

  constructor(private root: string, private agent: AgentRunner) {}

  get undoDepth() { return this.undoStack.length; }

  async edit(id: string, instruction: string, sel: Selection, send: Send): Promise<void> {
    if (this.busy) return send({ type: "error", id, code: "busy", message: "Another edit is still running." });
    if (this.pending) return send({ type: "error", id, code: "review_pending", message: "Accept or reject the previous edit first." });
    const abort = new AbortController();
    this.busy = { id, abort };
    this.lastSelection = sel;
    try {
      send({ type: "progress", id, stage: "checkpoint", message: "Saving a checkpoint…" });
      const cp = await createCheckpoint(this.root);
      send({ type: "progress", id, stage: "editing", message: "Claude Code is editing…" });
      let run;
      try {
        run = await this.agent.run({
          prompt: buildPrompt(instruction, sel), cwd: this.root, signal: abort.signal,
          onProgress: message => send({ type: "progress", id, stage: "editing", message }),
        });
      } catch (e) {
        // Whatever was half-written is rolled back so a failed run never leaves stray edits.
        await finishCheckpoint(this.root, cp).then(() => restoreCheckpoint(this.root, cp)).catch(() => {});
        throw e;
      }
      send({ type: "progress", id, stage: "diffing", message: "Collecting the diff…" });
      const { diff, files, truncated } = await finishCheckpoint(this.root, cp);
      if (!files.length) return send({ type: "done", id, action: "no_changes", undoDepth: this.undoDepth, message: run.summary || "Claude Code made no changes." });
      this.pending = { id, cp, files };
      send({ type: "result", id, diff, files, summary: run.summary, truncated });
    } catch (e) {
      send({ type: "error", id, code: "edit_failed", message: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = null;
    }
  }

  cancel(id: string) { if (this.busy?.id === id) this.busy.abort.abort(); }

  accept(id: string, send: Send) {
    if (!this.pending || this.pending.id !== id) return send({ type: "error", id, code: "no_pending", message: "Nothing to accept." });
    this.undoStack.push({ id, cp: this.pending.cp });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.pending = null;
    send({ type: "done", id, action: "accepted", undoDepth: this.undoDepth });
  }

  async reject(id: string, send: Send) {
    if (!this.pending || this.pending.id !== id) return send({ type: "error", id, code: "no_pending", message: "Nothing to reject." });
    try {
      await restoreCheckpoint(this.root, this.pending.cp);
      this.pending = null;
      send({ type: "done", id, action: "rejected", undoDepth: this.undoDepth });
    } catch (e) { this.restoreError(id, e, send); }
  }

  async undo(send: Send) {
    if (this.pending) return send({ type: "error", code: "review_pending", message: "Accept or reject the pending edit first." });
    const last = this.undoStack[this.undoStack.length - 1];
    if (!last) return send({ type: "error", code: "nothing_to_undo", message: "No accepted edit to undo." });
    try {
      await restoreCheckpoint(this.root, last.cp);
      this.undoStack.pop();
      send({ type: "done", id: last.id, action: "undone", undoDepth: this.undoDepth });
    } catch (e) { this.restoreError(last.id, e, send); }
  }

  private restoreError(id: string, e: unknown, send: Send) {
    send({ type: "error", id, code: e instanceof RestoreConflict ? "restore_conflict" : "restore_failed", message: e instanceof Error ? e.message : String(e) });
  }
}
