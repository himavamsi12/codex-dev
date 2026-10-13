import { chmod, lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import type { FileChange } from "./protocol.js";
import { git, gitText, snapshotTree } from "./git.js";

export interface Checkpoint { before: string; after?: string }

const MAX_DIFF_BYTES = 200_000;

export const createCheckpoint = async (root: string): Promise<Checkpoint> => ({ before: await snapshotTree(root) });

export async function finishCheckpoint(root: string, cp: Checkpoint): Promise<{ diff: string; files: FileChange[]; truncated: boolean }> {
  cp.after = await snapshotTree(root);
  if (cp.after === cp.before) return { diff: "", files: [], truncated: false };
  const diffRaw = await gitText(root, ["diff-tree", "-p", "-M", "--no-color", "--no-ext-diff", cp.before, cp.after]);
  const numstat = await gitText(root, ["diff-tree", "-r", "--numstat", "--no-renames", cp.before, cp.after]);
  const names = await gitText(root, ["diff-tree", "-r", "--name-status", "--no-renames", cp.before, cp.after]);
  const status = new Map<string, FileChange["status"]>();
  for (const line of names.split("\n")) {
    const [s, p] = line.split("\t");
    if (p) status.set(p, s === "A" ? "added" : s === "D" ? "deleted" : "modified");
  }
  const files: FileChange[] = [];
  for (const line of numstat.split("\n")) {
    const [a, d, p] = line.split("\t");
    if (p) files.push({ path: p, status: status.get(p) ?? "modified", additions: a === "-" ? 0 : +a, deletions: d === "-" ? 0 : +d });
  }
  const truncated = diffRaw.length > MAX_DIFF_BYTES;
  return { diff: truncated ? diffRaw.slice(0, MAX_DIFF_BYTES) : diffRaw, files, truncated };
}

/** Paths come from git itself, but are still confined to the repo before any write or delete. */
function safePath(root: string, rel: string): string {
  const n = normalize(rel);
  if (!rel || isAbsolute(n) || n.split(sep).includes("..") || n.split(sep)[0] === ".git") throw new Error(`Refusing unsafe path: ${rel}`);
  return join(root, n);
}

async function blobAt(root: string, tree: string, path: string): Promise<{ hash: string; mode: string } | null> {
  const out = (await gitText(root, ["ls-tree", "-z", tree, "--", path])).split("\0")[0];
  const m = out.match(/^(\d+) \w+ ([0-9a-f]+)\t/);
  return m ? { mode: m[1], hash: m[2] } : null;
}

export class RestoreConflict extends Error {
  constructor(public files: string[]) {
    super(`These files changed again after the edit, so they were left alone: ${files.join(", ")}`);
  }
}

/**
 * Puts back exactly the files the edit touched (before → after), and nothing
 * else. If a touched file was modified again since (by you or your dev tools),
 * nothing is changed and the conflicting files are reported.
 */
export async function restoreCheckpoint(root: string, cp: Checkpoint): Promise<void> {
  if (!cp.after) return;
  const changed = (await gitText(root, ["diff-tree", "-r", "--name-only", "-z", "--no-renames", cp.before, cp.after])).split("\0").filter(Boolean);
  const current = await snapshotTree(root);
  const conflicts: string[] = [];
  for (const p of changed) {
    const now = await blobAt(root, current, p);
    const expected = await blobAt(root, cp.after, p);
    if ((now?.hash ?? null) !== (expected?.hash ?? null)) conflicts.push(p);
  }
  if (conflicts.length) throw new RestoreConflict(conflicts);

  for (const p of changed) {
    const target = safePath(root, p);
    const old = await blobAt(root, cp.before, p);
    if (!old) {
      await rm(target, { force: true });
      continue;
    }
    const content = await git(root, ["cat-file", "blob", old.hash]);
    await mkdir(dirname(target), { recursive: true });
    const st = await lstat(target).catch(() => null);
    if (st?.isSymbolicLink()) await rm(target, { force: true });
    await writeFile(target, content);
    if (old.mode === "100755") await chmod(target, 0o755);
  }
}
