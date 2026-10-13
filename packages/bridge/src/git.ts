import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Runs a fixed git subcommand. Arguments are never passed through a shell. */
export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, env: { ...process.env, ...env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${stderr.toString().trim() || err.message}`));
      else resolve(stdout);
    });
    if (input !== undefined) child.stdin?.end(input);
  });
}

export const gitText = async (cwd: string, args: string[], env?: NodeJS.ProcessEnv) => (await git(cwd, args, env)).toString("utf8");

export async function repoRoot(cwd: string): Promise<string | null> {
  try { return (await gitText(cwd, ["rev-parse", "--show-toplevel"])).trim(); } catch { return null; }
}

export async function branchName(root: string): Promise<string | null> {
  try { return (await gitText(root, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || null; } catch { return null; }
}

/**
 * Snapshots the whole working tree (tracked + untracked, honouring .gitignore)
 * as a git tree object, without touching the user's index, stash or branches.
 */
export async function snapshotTree(root: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "codex-dev-idx-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    await git(root, ["add", "-A", "--", "."], env);
    return (await gitText(root, ["write-tree"], env)).trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
