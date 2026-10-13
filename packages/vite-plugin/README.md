# codex-dev-vite-plugin

Dev-only Vite plugin that adds `data-source="relative/path.tsx:line:col"` (1-based) to host JSX elements so Codex Dev can map a clicked element back to your code.

```js
import codexDev from "codex-dev-vite-plugin";
export default { plugins: [codexDev(), react()] };   // before the React plugin
```

- Runs only on the dev server (`apply: "serve"`); production builds are untouched.
- Skips `node_modules`, fragments and component elements (`<Card/>`): components may not forward unknown props, so Codex Dev uses the nearest mapped ancestor instead.
- Option `exclude: string[]` skips paths containing those fragments.

## Next.js
Not supported in v1. Codex Dev falls back to the selector, classes and text, and Claude searches the codebase for the element. A Babel/SWC plugin is a possible follow-up.
