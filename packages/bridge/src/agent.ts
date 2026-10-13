import { isAbsolute, relative, resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { SYSTEM_APPEND } from "./prompt.js";

export interface AgentRun { summary: string }
export interface AgentRunner {
  name: string;
  run(opts: { prompt: string; cwd: string; signal: AbortSignal; onProgress: (message: string) => void }): Promise<AgentRun>;
}

const TOOLS = ["Read", "Edit", "Write", "MultiEdit", "Glob", "Grep"];
const PROTECTED = /(^|\/)(\.git|node_modules)(\/|$)|(^|\/)\.env[^/]*$/;

function insideProject(cwd: string, p: unknown): boolean {
  if (typeof p !== "string") return true; // tools without a path (Glob/Grep) stay in cwd
  const rel = relative(cwd, isAbsolute(p) ? p : resolve(cwd, p));
  return !!rel && !rel.startsWith("..") && !isAbsolute(rel) && !PROTECTED.test(rel.split("\\").join("/"));
}

const AUTH_HINT = "Claude Code is not signed in. Run `claude login` in a terminal (your Claude subscription works), or start the bridge with ANTHROPIC_API_KEY set.";

/**
 * Runs Claude Code through the Agent SDK. Authentication is whatever Claude
 * Code already has: a `claude login` subscription or ANTHROPIC_API_KEY in this
 * process's environment. Nothing is stored by Codex Dev.
 */
export const claudeRunner: AgentRunner = {
  name: "claude",
  async run({ prompt, cwd, signal, onProgress }) {
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort(), { once: true });
    let summary = "";
    const q = query({
      prompt,
      options: {
        cwd,
        abortController,
        maxTurns: 25,
        tools: TOOLS,
        permissionMode: "acceptEdits",
        systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM_APPEND },
        canUseTool: async (tool, input) => {
          const path = (input.file_path ?? input.path) as unknown;
          if (!TOOLS.includes(tool)) return { behavior: "deny", message: `${tool} is not available for browser edits.` };
          if (!insideProject(cwd, path)) return { behavior: "deny", message: "That path is outside the project or protected." };
          return { behavior: "allow", updatedInput: input };
        },
      },
    });
    try {
      for await (const msg of q) {
        if (msg.type === "assistant") {
          if (msg.error === "authentication_failed" || msg.error === "oauth_org_not_allowed") throw new Error(AUTH_HINT);
          for (const block of msg.message.content) {
            if (block.type === "tool_use") {
              const file = (block.input as any)?.file_path;
              onProgress(`${block.name}${typeof file === "string" ? " " + relative(cwd, file) : ""}`);
            } else if (block.type === "text" && block.text.trim()) summary = block.text.trim();
          }
        } else if (msg.type === "result") {
          if (msg.subtype !== "success") throw new Error(`Claude Code stopped: ${msg.subtype}`);
          summary = msg.result?.trim() || summary;
        }
      }
    } catch (e) {
      if (abortController.signal.aborted) throw new Error("Cancelled.");
      const m = e instanceof Error ? e.message : String(e);
      throw new Error(/login|auth|401|credential/i.test(m) && !m.includes("claude login") ? `${AUTH_HINT} (${m.slice(0, 200)})` : m);
    }
    return { summary: summary.slice(0, 1000) };
  },
};
