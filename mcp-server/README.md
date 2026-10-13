# Codex Dev MCP

An [MCP](https://modelcontextprotocol.io) server that lets **Claude Code** test and debug pages in your real Chrome through the **Codex Dev extension**: responsive audits across viewports, DOM/CSS inspection, screenshots and pixel diffs, console and network errors, temporary CSS previews, and before/after verification of a fix.

Claude Code does the reasoning and edits your source files. Codex Dev only measures, previews, and reports.

```
Claude Code ──stdio──▶ codex-dev-mcp (Node) ◀──ws://127.0.0.1──  Codex Dev extension ──▶ tabs you allowed
   (MCP client)         MCP tools + bridge      authenticated        (service worker)      (CDP + page probes)
```

* The MCP server speaks MCP over **stdio** to Claude Code and listens for the extension on **`127.0.0.1` only**.
* The extension dials *out* to the server; nothing listens inside the browser.
* Every connection must present a **pairing token** and come from a `chrome-extension://` origin.
* Claude Code can only touch **tabs you explicitly allow** in the extension popup.

## Setup

Requirements: Node 18.17+ (developed on 20), Chrome, Claude Code.

### 1. Build the server

From the repository root:

```bash
cd mcp-server
npm install
npm run build
```

### 2. Register it with Claude Code

Pick one scope. Both use paths relative to the repository, so nothing machine-specific is stored.

**Project scope** (shared config in `.mcp.json`; run from the repository root, and approve the server when Claude Code asks):

```bash
claude mcp add --scope project codex-dev -- node mcp-server/dist/index.js
```

**Local scope** (private to you; absolute path needed because it is not tied to the working directory):

```bash
claude mcp add codex-dev -- node "$(pwd)/mcp-server/dist/index.js"
```

The resulting project config is:

```json
{
  "mcpServers": {
    "codex-dev": { "type": "stdio", "command": "node", "args": ["mcp-server/dist/index.js"], "env": {} }
  }
}
```

### 3. Load the extension and pair it

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and choose the repository root (the folder with `manifest.json`). If it was already loaded, click **Reload**: this release adds the `alarms` permission.
2. In Claude Code, just say **"Connect Codex Dev"**. Claude calls `codex_dev_connect` and gives you a one-time 6-digit code (valid 2 minutes).
3. Click the Codex Dev toolbar icon → **Claude Code**, type the code, press **Connect**. The extension receives its credentials from the server and stores them, so you only do this once; later sessions reconnect on their own. The dot turns green when connected.
4. Open the page you want to test (for example `http://localhost:3000`), click the icon → **Claude Code** → **Allow on this tab**, then tell Claude to continue. Chrome shows its "debugging this browser" banner while a tab is allowed; that is expected (see Permissions). Allowing a tab stays a click in the popup on purpose: it is your consent.

Prefer to skip the prompt? `node mcp-server/dist/index.js token` prints the long-lived token, which you can paste into the same popup field instead of a code.

### 4. Verify it works

```bash
claude mcp list          # codex-dev should show ✓ Connected
```

Inside Claude Code run `/mcp` and check that `codex-dev` lists 32 tools, then ask:

> Connect Codex Dev, then check the status.

You should end up with `ready: true`. If not, `nextStep` in the reply says what is missing.

## The website-check skill

`skills/website-check/SKILL.md` teaches Claude Code the whole routine: connect, check the page at the mobile, tablet and desktop breakpoints (layout, fonts, accessibility, section spacing, console errors), **report the findings and ask which to fix**, then edit the project source and verify with a re-check. Install it once for every project:

```bash
node mcp-server/dist/index.js install-skill            # ~/.claude/skills/website-check
node mcp-server/dist/index.js install-skill --project  # ./.claude/skills/website-check (run in your site's repo)
```

Restart Claude Code, then in your site's project say **"Check my site with Codex Dev"** (or run `/website-check`).

## Example prompts

* "Use Codex Dev to audit my website at localhost:3000 across mobile, tablet, and desktop. Find responsive issues and return the affected elements and CSS evidence."
* "Inspect the navigation bar at 375px width and explain why it overflows."
* "Compare the responsive audit before and after my latest changes."
* "Preview a CSS fix for the identified issue, then rerun the audit."
* "Show me my page at mobile, tablet and desktop breakpoints and tell me what breaks."
* "Switch to the tablet breakpoint and inspect the header."
* "Check for console errors and failed requests on the currently selected development page."

A typical loop: `run_responsive_audit` → `inspect_element` on the reported selectors → `preview_css_patch` to try a fix → edit the source → `verify_responsive_fix`.

> **Navigation:** the server never navigates tabs. Open the page yourself and allow it. Authorization is per tab and ends when the tab navigates to a different origin or closes.

## Tools

All tools accept an optional `tabId` (default: the tab chosen with `select_browser_tab`). Viewports are in CSS px. Text that comes from pages is returned alongside a notice that it is untrusted data.

| Tool | Purpose | Arguments |
| --- | --- | --- |
| `codex_dev_connect` | Start pairing: returns a one-time 6-digit code for the popup | none |
| `codex_dev_status` | Server/extension connection state; no page content | none |
| `list_browser_tabs` | Authorized tabs: id, title, URL (query stripped) | none |
| `select_browser_tab` | Choose the tab for later calls | `tabId` |
| `set_viewport` | Real viewport via Chrome device-metrics emulation | `width`, `height` (200–7680 / 200–4320), `deviceScaleFactor?`, `mobile?`, `reset?` |
| `list_breakpoints` | The three named breakpoints: mobile = iPhone 14 Pro 393×852 @3x, tablet = iPad Air 820×1180 @2x, desktop = 1920×1080. Same devices as the Responsive Viewer's default preset | none |
| `set_breakpoint` | Switch the tab to a named breakpoint (with its pixel ratio and mobile flag) for follow-up tools | `breakpoint` (mobile/tablet/desktop), `landscape?` |
| `capture_breakpoints` | Screenshot every breakpoint in one call, inline, then restore the viewport | `breakpoints?[]`, `landscape?`, `fullPage?`, `scale?` (default 0.5), `label?` |
| `list_devices` | Search the Responsive Viewer's device catalog (phones, tablets, laptops, desktops) | `query?`, `category?` |
| `set_device` | Emulate a named device ("Galaxy S24", "iPhone SE") or a custom `WIDTHxHEIGHT` for follow-up tools | `device`, `landscape?` |
| `show_in_viewer` | Add devices to the Responsive Viewer open on the tab's page (or open one in the background) | `devices[]` |
| `check_typography` | Fonts and sizes actually rendered: families with share and weights, sizes, heading scale; flags fonts that failed to load, one-off fonts/sizes, inconsistent or inverted headings, tight line-height | `breakpoint?` or `width?`/`height?`, `limit?` |
| `check_accessibility` | Automated WCAG checks with criterion numbers: lang, title, zoom blocked, alt text, unnamed links/buttons, unlabeled fields, tabindex, h1 and heading order, main landmark, duplicate ids, text contrast on solid backgrounds. Lists what it can't check | `breakpoint?` or `width?`/`height?`, `perType?` |
| `check_section_spacing` | Main sections top to bottom with padding/margins, white space between neighbouring sections' content, and gaps that break the page's rhythm | `breakpoint?` or `width?`/`height?`, `selector?` |
| `run_responsive_audit` | Multi-viewport audit with screenshots; stores a report | `viewports?[{width,height,label?}]`, `preset?` (mobile/tablet/desktop/all/breakpoints), `selector?`, `screenshots?` (default true), `reload?`, `detail?` |
| `get_layout_overflow` | Horizontal overflow and the elements causing it | `width?`, `height?`, `selector?` |
| `get_responsive_issues` | All checks at one viewport, no stored report | `width?`, `height?`, `minSeverity?`, `confidence?`, `selector?` |
| `get_page_structure` | Bounded DOM outline | `selector?`, `depth?` (1–8), `maxNodes?` (10–600), `viewport?` |
| `inspect_element` | Box model, flex/grid context, ancestors, computed styles, matched CSS rules, hints | `selector`, `index?`, `viewport?` |
| `get_computed_styles` | Computed values for chosen properties | `selector`, `properties?` (≤80), `pseudo?`, `index?`, `viewport?` |
| `get_element_dimensions` | Rects, scroll/client sizes, how far past the edges | `selector`, `limit?` (≤50), `viewport?` |
| `take_screenshot` | PNG of the tab, optionally at a temporary viewport | `viewport?`, `fullPage?`, `scale?` (0.25–2), `inline?`, `label?` |
| `compare_screenshots` | Pixel diff with changed regions and a diff image | `before?`, `after?` (screenshot ids; default the last two), `threshold?`, `includeDiffImage?` |
| `get_console_errors` | Exceptions, `console.error`, error/warning log entries | `limit?`, `sinceMinutes?` |
| `get_failed_requests` | HTTP 4xx/5xx and network failures (no headers/bodies) | `limit?`, `sinceMinutes?` |
| `preview_css_patch` | Temporary in-page stylesheet (not saved anywhere) | `css` (≤20 KB), `id?` |
| `clear_css_patch` | Remove preview stylesheet(s) | `id?` |
| `verify_responsive_fix` | Re-audit and compare with a baseline by stable issue id | `baselineReportId?`, `viewports?`, `reload?` (default true), `waitMs?`, `screenshots?` |
| `get_audit_report` | Fetch or list stored reports | `reportId?`, `list?`, `detail?` |
| `select_target_section` | Choose the element (CSS selector) to restyle | `selector` |
| `get_selected_element_context` | Tag, classes, size, viewport, key styles, sanitized HTML of the target | none |
| `preview_section_patch` | Temporary, undoable restyle: validated `set`/`remove` CSS operations per breakpoint, or leaf text | `operations[]`, `label?` |
| `reset_section_preview` | Undo one step, reset the section, or remove all previews | `mode?` (undo/section/all) |
| `export_section_patch` | The CSS exactly as previewed, optional sanitized HTML and framework guidance | `framework?`, `important?`, `includeHtml?` |
| `generate_section_recreation` | Always returns `provider_not_configured`: there is no AI provider in this version | none |

### Design Inspector AI (section preview)

The extension's **Design Inspector AI** panel (open the Design Inspector from the popup, then press the AI button on its toolbar) lets a person upload or capture a reference screenshot, pick a section on the page, restyle it with a manual builder, preview at Desktop/Tablet/Mobile, compare before/after and export the CSS. The six `*_section_*` tools above drive the same engine and the same patch validator (an allow-list of CSS properties; no `position`, `url()`, scripts or selectors), so Claude Code can preview a restyle you can then see, undo or export in the panel. Nothing is saved to the website or your project.

Not exposed on purpose: the reference screenshot (Claude Code would forward it to the model, which breaks the panel's "never leaves this computer" rule). AI generation does not exist yet; `generate_section_recreation` says so.

## What the audit measures

| Finding | Confidence | Meaning |
| --- | --- | --- |
| `horizontal-overflow` | deterministic | The document scrolls sideways; reports by how many px |
| `overflowing-element` | deterministic | An element extends past the right edge and is not inside a scroll container. Overflowing siblings are reported once as their container, with the children listed. Includes `likelyCauses` derived from computed CSS |
| `viewport-meta-missing` | deterministic | Layout viewport differs from the requested width and there is no `<meta name="viewport">` |
| `offscreen-control` | heuristic | Interactive element fully outside the viewport (may be an intentional off-canvas menu) |
| `overlapping-control` | heuristic | Control centre is covered by a non-fixed element |
| `text-clipped` | heuristic | Text cut off by `overflow: hidden` without an ellipsis |
| `small-tap-target` | heuristic | Below 24×24 px at touch widths |
| `small-text` | heuristic | Font size under 11 px |

*Deterministic* means a direct layout measurement. *Heuristic* means "probably a problem, confirm it". The audit does not judge visual design, colour contrast or content, and does not claim to find every defect.

Issue ids are `type:hash(selector)` (or `horizontal-overflow:document`), so the same problem has the same id across runs. If you rename the element's classes the id changes and it shows up as one resolved plus one new issue.

### How the viewport is measured

The audit runs in the **real tab** using Chrome's device-metrics emulation (the same mechanism as DevTools' device toolbar), not in the Codex Dev viewer's iframes, so a device frame's bezel can never be counted as a website bug. Consequences:

* The user agent, touch input and server-side device detection are not changed.
* On mobile widths, Chrome zooms out when content is wider than the viewport, so `window.innerWidth` can exceed the requested width. The tools use the layout viewport (`documentElement.clientWidth`) and report it as `layoutWidth`.
* Only the top frame is scanned; cross-origin iframes are not inspected.

## Permissions the extension needs, and why

| Permission | Used for | New? |
| --- | --- | --- |
| `tabs`, `scripting`, `host_permissions: <all_urls>` | List allowed tabs; run read-only measuring functions in a tab you allowed | existing |
| `debugger` | Viewport emulation, screenshots, console and network capture. Chrome shows its banner while attached | existing |
| `storage` | Pairing settings (`chrome.storage.local`) and the allowed-tab list (`chrome.storage.session`, cleared when the browser closes) | existing |
| `alarms` | Re-dial the MCP server once a minute so the bridge recovers when the service worker sleeps or the server restarts | **added** |

Nothing is requested at runtime. The bridge does nothing until you enable it in the popup, and a tab is only reachable after you click **Allow on this tab**.

## Security model

* **Local only.** The bridge binds `127.0.0.1`, rejects requests whose `Host` is not a loopback name (DNS rebinding), and requires the `Origin` to be `chrome-extension://<32 chars>`. Web pages cannot reach it, even with the token. Set `CODEX_DEV_EXTENSION_ID` to pin one extension ID.
* **Authenticated.** The first message must be a `hello` with the pairing token (compared in constant time) or a `pair` with a live one-time code; nothing else is processed before it. Pairing codes are 6 digits, only exist after you ask Claude to connect, expire after 2 minutes, die after 5 wrong guesses or first use, and are only accepted from a `chrome-extension://` origin on loopback. The token itself is never shown to the model. Five failed attempts lock the endpoint for 30 s. Commands from an unauthenticated socket are never executed.
* **Fixed command set.** The extension answers only the commands in `bridge/bridge.js` (`HANDLERS`). There is no navigation, no arbitrary script evaluation, no cookies/storage/form values, and no tab creation. `__proto__`, `constructor`, etc. are rejected.
* **Authorized tabs only.** Every tab command goes through one gate that checks the tab is allowed, still open, inspectable, and still on the same origin; otherwise authorization is removed.
* **Bounded and redacted.** Payload limits: 16 MB bridge messages, 8 MB screenshots, 20 KB CSS patches, 200 log entries. URLs leave the browser without query strings; console text is truncated and obvious tokens (bearer/JWT/`password=…`) are redacted. Page text in results is short and flagged as untrusted.
* **No instructions from pages.** The server instructions and every page-derived result tell the model to treat site content as data. A page cannot grant itself access to anything.
* **CSS previews are not JavaScript.** Patches are validated twice (server and extension): no `@import`, no external `url()`, no markup or script URLs, ≤ 20 KB. They are applied as an in-memory constructed stylesheet that is gone on reload, and never written to disk.
* **Logs.** The server logs to stderr only (stdout is the MCP channel) and never logs page content, URLs with queries, tokens or screenshots.

Screenshots are stored as PNG files in a private (0700) directory under your OS temp folder, at most 80 kept.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_DEV_MCP_PORT` | `17373` | Bridge port. Use the same port in the popup |
| `CODEX_DEV_MCP_TOKEN` | generated | Override the pairing token |
| `CODEX_DEV_MCP_HOME` | `~/.codex-dev-mcp` | Where the token file lives |
| `CODEX_DEV_EXTENSION_ID` | any | Only accept this extension ID |

Pass them to Claude Code with `claude mcp add -e CODEX_DEV_MCP_PORT=17400 codex-dev -- node …`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `codex_dev_status` → `extension_not_connected` | Ask Claude to "Connect Codex Dev", enter the code in the popup → Connect. The server only runs while Claude Code has it started; the popup dot stays amber until then |
| "The code is wrong or expired" | Codes last 2 minutes and work once. Ask Claude to run `codex_dev_connect` again |
| "The server rejected the pairing token" | The stored credentials are stale (token file or `CODEX_DEV_MCP_TOKEN` changed). Pair again with a fresh code |
| `Port 17373 is already in use` | Another Claude Code session owns the bridge. Set `CODEX_DEV_MCP_PORT` for one of them and the same port in the popup |
| `tab_not_authorized` | Open the popup on that tab → Allow on this tab. Authorization is removed when the tab changes origin |
| `page_inaccessible` | Chrome blocks extensions on `chrome://`, the Web Store, and some pages. Use a normal site |
| `debugger_unavailable` | Another debugger holds the tab. Close that tab's DevTools or other debugging extensions, then allow the tab again |
| `diagnostics_unavailable` | The debugger is not attached (for example you dismissed Chrome's banner). Allow the tab again and reload |
| Console/network lists are empty | Capture starts when the tab is allowed. Use `reload: true` on an audit, or reload the page |
| Bridge disconnects after a while | Chrome stops idle service workers; the alarm re-dials within a minute. Reload the extension if it persists |
| Tools missing in Claude Code | `claude mcp list`; rebuild with `npm run build`; for project scope approve the server on the next `claude` start |

## Development and tests

```bash
cd mcp-server
npm run typecheck
npm run build
npm test
```

`npm test` runs, with no setup beyond Chrome being installed:

| File | Covers |
| --- | --- |
| `tools.test.ts` | Tool registration, schemas, annotations, argument validation, disconnected-browser errors, CSS-patch validation |
| `bridge.test.ts` | Token and one-time-code pairing, origin/host authentication, lockout, request correlation, timeouts, disconnect and reconnect, port conflicts |
| `extension-bridge.test.ts` | The extension's real `bridge/bridge.js` against a mocked `chrome.*`: authorization gate, command validation, diagnostics redaction, message-sender checks |
| `e2e.test.ts` | MCP client → server → bridge → real Chrome: overflow detection, element inspection, patch apply/clear, audit, verify, screenshot diff. A stand-in for the extension answers with the same page probes (`bridge/probes.js`) |
| `reports.test.ts` | Issue merging, report comparison, image diff |
| `stdio.test.ts` | The server as a child process over real MCP stdio; the token CLI |
| `real-extension.test.ts` | The actual extension loaded in Chrome for Testing: pairing, tab authorization, debugger-based emulation/screenshots/diagnostics, audit, patch, verify. Skipped unless `CHROME_FOR_TESTING_PATH` is set (see the file header) |

### Manual verification (what automation cannot cover)

Branded Chrome 137+ cannot load unpacked extensions from the command line, and the popup UI is not covered by automated tests. Check once per release:

1. Reload the extension, tell Claude "Connect Codex Dev", enter the code in the popup → Claude Code, press Connect: dot turns green.
2. On a dev page click **Allow on this tab**: Chrome shows the debugging banner; the button becomes **Revoke access for this tab**.
3. In Claude Code: `codex_dev_status` → ready; `list_browser_tabs` shows only that tab; run an audit and confirm the page's viewport is restored afterwards.
4. Navigate the allowed tab to a different site and confirm the next tool call fails with `tab_not_authorized`.
5. Click **Revoke**: the banner goes away and calls fail with `tab_not_authorized`.

## Known limitations

* One extension connection and one bridge port per machine; a second Claude Code session needs its own port.
* Console and network capture starts when a tab is allowed (or reloaded through Codex Dev); earlier events are not available. Only the top frame's resources are guaranteed for network failures; request bodies and headers are not captured.
* Audits measure the top document only. Content in cross-origin iframes, canvases and closed shadow roots is not inspected. Open shadow roots are not traversed.
* The element scan is capped at 5,000 elements per viewport (reported as `scanTruncated`).
* Pixel diffs cannot tell intended changes from regressions, and animations, ads and fonts cause noise. Both images must have identical dimensions.
* There is no vision model: screenshots are returned to Claude as images, and the server does no semantic visual analysis.
* Reports and screenshot ids live in memory; restarting the server forgets them.
