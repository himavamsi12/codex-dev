import { parse } from "@babel/parser";
import MagicString from "magic-string";
import { relative, sep } from "node:path";
import type { Plugin } from "vite";

const ATTR = "data-source";
const EXT = /\.(jsx|tsx)$/;

type Node = { type: string; start: number; end: number; loc: { start: { line: number; column: number } }; [k: string]: any };

function walk(node: any, visit: (n: Node) => void): void {
  if (!node || typeof node.type !== "string") return;
  visit(node);
  for (const key in node) {
    if (key === "loc" || key === "extra" || key === "leadingComments" || key === "trailingComments") continue;
    const v = node[key];
    if (Array.isArray(v)) v.forEach(c => walk(c, visit));
    else if (v && typeof v === "object") walk(v, visit);
  }
}

/**
 * Adds data-source="relative/path.tsx:line:col" (1-based) to every host (lowercase) JSX element.
 * Fragments and components are skipped: a component may not forward unknown props, and the
 * extension falls back to the nearest ancestor that does have the attribute.
 * Returns null when nothing changed.
 */
export function injectSource(code: string, file: string, root: string): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["jsx", "typescript"], errorRecovery: true });
  } catch {
    return null; // leave unparsable files to Vite's own error reporting
  }
  const rel = relative(root, file).split(sep).join("/");
  const s = new MagicString(code);
  let changed = false;
  walk(ast.program, n => {
    if (n.type !== "JSXOpeningElement") return;
    const name = n.name;
    if (name.type !== "JSXIdentifier" || !/^[a-z]/.test(name.name)) return;
    if (n.attributes.some((a: Node) => a.type === "JSXAttribute" && a.name?.name === ATTR)) return;
    const pos = name.end; // right after the tag name, valid for self-closing and normal tags
    s.appendLeft(pos, ` ${ATTR}=${JSON.stringify(`${rel}:${n.loc.start.line}:${n.loc.start.column + 1}`)}`);
    changed = true;
  });
  return changed ? { code: s.toString(), map: s.generateMap({ hires: true, source: file }) } : null;
}

export interface CodexDevOptions {
  /** Extra path fragments to skip, in addition to node_modules. */
  exclude?: string[];
}

/** Dev server only (`apply: "serve"`): production builds are never touched. */
export default function codexDev(options: CodexDevOptions = {}): Plugin {
  let root = process.cwd();
  return {
    name: "codex-dev-source",
    apply: "serve",
    enforce: "pre",
    configResolved(config) { root = config.root; },
    transform(code, id) {
      const file = id.split("?")[0];
      if (!EXT.test(file) || file.includes("node_modules") || file.startsWith("\0")) return null;
      if (options.exclude?.some(x => file.includes(x))) return null;
      return injectSource(code, file, root);
    },
  };
}
