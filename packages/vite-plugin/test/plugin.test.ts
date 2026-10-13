import assert from "node:assert/strict";
import { test } from "node:test";
import codexDev, { injectSource } from "../src/index.js";

test("adds data-source to host elements only, with 1-based line:col", () => {
  const src = `export const A = () => (\n  <>\n    <div className="a">\n      <Card />\n      <img src="x" />\n    </div>\n  </>\n);\n`;
  const out = injectSource(src, "/proj/src/A.tsx", "/proj")!;
  assert.ok(out.code.includes('<div data-source="src/A.tsx:3:5" className="a">'));
  assert.ok(out.code.includes('<img data-source="src/A.tsx:5:7" src="x" />'));
  assert.ok(!out.code.includes("<Card data-source"));
  assert.ok(!out.code.includes("<> data-source"));
});

test("does not duplicate an existing attribute; ignores files without JSX; survives syntax errors", () => {
  assert.equal(injectSource('const x = <div data-source="y" />;', "/p/a.tsx", "/p"), null);
  assert.equal(injectSource("export const x = 1;", "/p/a.ts", "/p"), null);
  assert.doesNotThrow(() => injectSource("const x = <div", "/p/a.tsx", "/p"));
});

test("plugin is dev-only and skips node_modules", () => {
  const p: any = codexDev();
  assert.equal(p.apply, "serve");
  p.configResolved({ root: "/p" });
  assert.equal(p.transform("const x = <div/>", "/p/node_modules/lib/a.tsx"), null);
  assert.ok(p.transform("const x = <div/>", "/p/src/a.tsx?v=1"));
});
