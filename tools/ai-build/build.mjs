// Bundles ai/claude-service.js + the Anthropic SDK into one classic script,
// vendor/claude-service.js, which background.js loads with importScripts()
// and uses through self.CodexAI.
//   cd tools/ai-build && npm install && npm run build
import { rollup } from 'rollup'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import terser from '@rollup/plugin-terser'
import commonjs from '@rollup/plugin-commonjs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

const bundle = await rollup({
  input: path.join(root, 'ai/claude-service.js'),
  plugins: [nodeResolve({ browser: true, modulePaths: [path.join(root, 'tools/ai-build/node_modules')] }), commonjs()],
})
await bundle.write({
  file: path.join(root, 'vendor/claude-service.js'),
  format: 'iife',
  inlineDynamicImports: true,
  name: 'CodexAI',
  banner: '/*! Codex AI service | bundles @anthropic-ai/sdk (MIT) | built by tools/ai-build */',
  plugins: [terser({ format: { comments: /^!/ } })],
})
await bundle.close()
console.log('vendor/claude-service.js written')
