# Codex Dev - Chrome Extension

A powerful Chrome extension for developers to test websites across multiple device screen sizes simultaneously in **one single tab**, and visually edit, drag, and export components in real-time.

## Features

🎨 **Powerful Visual Editor (NEW!)**
- **Live Editing:** Edit HTML, inline styles, media queries, and animations in real-time.
- **Visual Controls:** Style elements visually with dedicated Typography, Layout, Background, and Spacing controls.
- **Pseudo Classes:** Simulate and inspect `:hover`, `:active`, and `:focus` states easily.
- **Media Queries:** Inspect and edit styles across all active breakpoints.
- **Drag & Drop Positioning:** Free drag any element anywhere on the page to build layouts intuitively.
- **Syntax Highlighting:** Code is syntax highlighted for better reading and editing.
- **Export to CodePen:** Copy or export whole components with their children and styles directly to CodePen!

✨ **Hybrid Approach - Best of Both Worlds**
- **Iframe-first**: All devices display in one tab when possible
- **Smart fallback**: Automatically opens popup windows for sites that block iframes
- **Works with ALL websites**: Including sixjuly.com, facebook.com, twitter.com, etc.
- **Seamless UX**: You don't need to do anything - the extension handles it automatically

✨ **Single Tab Interface**
- All device viewports display in one tab
- Side-by-side comparison of different screen sizes
- Clean, organized layout

✨ **Quick Launch Presets**
- Popular Mix (iPhone, iPad, Desktop)
- Mobile Only (iPhone 14 Pro, iPhone SE, Samsung Galaxy S23)
- Tablet Only (iPad Pro, iPad Air, iPad Mini)
- Desktop Only (Various resolutions)

📱 **Device Presets**
- **Mobile**: iPhone 14 Pro, iPhone SE, Samsung Galaxy S23, Pixel 7
- **Tablet**: iPad Pro 12.9", iPad Air, iPad Mini, Surface Pro 7
- **Desktop**: 1366x768, 1920x1080, 2560x1440, 3840x2160

⚙️ **Custom Sizes**
- Enter any custom width and height (minimum 320px)
- Perfect for testing specific breakpoints

🎨 **Premium UI**
- Modern dark mode design
- Glassmorphism effects
- Smooth animations and transitions
- Responsive grid layout

🔧 **Viewport Controls**
- Rotate devices (portrait ↔ landscape)
- Refresh individual or all viewports
- Scroll synchronization
- Clean device labels

## Installation

1. **Download/Clone** this extension folder
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the `responsive extension` folder
6. The extension icon will appear in your Chrome toolbar

## Usage

### Testing Responsiveness
1. Navigate to any website you want to test
2. Click the Codex extension icon in your toolbar
3. Select a quick launch preset or individual device
4. The viewer opens in a new tab showing all devices side-by-side

### Visual Editor
1. Click the Codex extension icon
2. Click the specific tools/visual editor toggle on the bottom
3. Click any element on the webpage
4. A drag-able editor panel will appear allowing you to visually change CSS properties, freely drag the element, and export the HTML/CSS to CodePen!

## Design Inspector AI

Pick a section on any page, add a reference screenshot (upload or capture), then recreate the look with the manual builder: layout, typography, colours, gradient, borders, shadow, per-breakpoint rules and a width preview. Changes are a temporary live preview with undo/redo/reset, a before/after comparison and CSS/HTML export. "Generate design" reports that no provider is configured; the provider interface is in `design-ai/provider.js`.

**Responsive audit (viewer, Audit button):** audits every open device for layout problems (sideways scrolling, elements sticking out, cut-off text, covered controls, small tap targets, tiny text) and pins each issue on the device where it appears; the checks run locally and need no AI. **Fix with AI** writes a small CSS fix (validated against an allow-list), applies it live to every device, re-audits to show whether it worked, and shows a before/after diff you can copy. **Explain differences** summarises in plain language how the layout changes between the open devices. Logic: `responsive-audit.js`, `design-ai/responsive-fix.js`, `bridge/probes.js`.

**Animate tab (GSAP):** describe the motion in plain words ("fade the cards up one after another when I scroll", "lift on hover") and Codex AI (free, with a daily limit, no API key) returns an animation spec. The spec is validated against an allow-list (properties, eases, selectors, no script), played live with the bundled GSAP + ScrollTrigger (`vendor/gsap`), and exported as paste-ready GSAP code for HTML, React or Next.js. Ask follow-ups ("slower", "only the heading") to refine it. Logic is in `design-ai/animation.js`.

## Claude Code integration (MCP)

Codex Dev can act as a browser-testing tool for Claude Code: responsive audits across viewports, element and CSS inspection, screenshots and diffs, console/network errors, temporary CSS previews and fix verification. It runs through a local MCP server in [`mcp-server/`](mcp-server/README.md), only for tabs you explicitly allow. Setup, tools, permissions and troubleshooting are in that README. Exclude `mcp-server/` when zipping the extension for the Chrome Web Store.

## Edit in Browser (apply changes to your source with Claude Code)

Select an element in any device frame, describe a change ("stack these vertically on mobile only"), review the diff, and accept it. The change is made in your real source files by Claude Code running on your machine, and your dev server hot-reloads every frame.

```
Codex Dev viewer ──ws://127.0.0.1:17374 + token──▶ codex-dev-bridge (your project root) ──▶ Claude Code (your login)
   pick element, prompt, diff review                  checkpoint → edit → diff → accept / reject / undo
```

### Setup

1. **Add the source-mapping plugin** (Vite, dev only): `npm i -D codex-dev-vite-plugin`, then in `vite.config`:
   ```js
   import codexDev from "codex-dev-vite-plugin";
   export default { plugins: [codexDev(), react()] };
   ```
   It adds `data-source="src/App.tsx:12:5"` to JSX elements in dev and never touches production builds. See [`packages/vite-plugin`](packages/vite-plugin/README.md).
2. **Run the bridge from your project root** (a git repository): `npx codex-dev-bridge`. It prints a token. Sign in to Claude Code first with `claude login` (a Claude subscription works) or set `ANTHROPIC_API_KEY`.
3. **Pair once:** open your dev URL in Codex Dev, click **Edit**, paste the token, **Connect**. The token is kept in `chrome.storage.local`.
4. Click an element, type the change, **Apply**, then **Accept** or **Reject**. **Undo last edit** reverts accepted edits.

### Supported frameworks and limits

- **Vite + React/TSX/JSX:** exact `file:line:col` mapping. Other Vite JSX frameworks that compile `.jsx/.tsx` should work the same way.
- **Everything else (Next.js, Vue, Svelte, plain HTML):** no plugin yet, so Claude searches your code using the selector, classes and text. It works, but is less precise. A Next.js (Babel/SWC) plugin is not part of v1.
- Needs a git repository: checkpoints are git tree snapshots (your index, stash and branches are untouched). Undo refuses to overwrite a file you changed again after the edit.
- One edit at a time. The bridge only accepts typed edit messages from the extension; it never runs commands from the browser, and Claude Code is limited to reading and editing files inside the project (no shell, `.env`, `.git` or `node_modules`).
- The agent step uses Claude Code only in v1. Signing in with a ChatGPT account would need an OpenAI Codex CLI runner, which is not built.
- The element screenshot only works if the element is visible in the viewer window.
- **Claude Code can also ask what you selected:** `claude mcp add --transport http codex-dev-edit http://127.0.0.1:17374/mcp --header "Authorization: Bearer <token>"` gives it `get_selected_element` and `get_preview_screenshot`.
- Keep `packages/`, `examples/` and `mcp-server/` out of the Chrome Web Store zip.

## How It Works (Hybrid Approach)

🎯 **Intelligent Detection**:
1. Extension opens viewer in one tab with all device viewports
2. Each viewport tries to load the website in an iframe
3. If iframe loads successfully → Shows in the single tab ✅
4. If iframe is blocked → Automatically opens a popup window with device emulation ✅

**Result**: You get the best UX possible - everything in one tab when allowed, automatic fallback when needed!

## Important Notes

⚠️ **Popup Blocker**: Make sure to allow popups for this extension. When a site blocks iframes, the extension will automatically open popup windows.

✅ **Universal Compatibility**: This hybrid approach works with ALL websites:
- Sites that allow iframes (most sites) → Single tab view
- Sites that block iframes (facebook, twitter, sixjuly.com, etc.) → Popup windows with device emulation

## File Structure

```
responsive extension/
├── manifest.json          # Extension configuration
├── devices.js            # Device presets database
├── popup.html            # Extension popup interface
├── popup.css             # Popup styling
├── popup.js              # Popup functionality
├── viewer.html           # Main viewer page
├── viewer.css            # Viewer styling
├── viewer.js             # Viewer functionality
├── css-viewer.js         # The Visual Editor payload script
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md             # This file
```

## Technical Details

- **Manifest Version**: 3
- **Permissions**: `activeTab`, `tabs`, `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `scripting`, `<all_urls>`
- **Approach**: Hybrid iframe-based multi-viewport display with automatic popup fallback
- **Framework**: Vanilla JavaScript (no dependencies)
- **Styling**: Custom CSS with modern design patterns
- **Privacy**: All data stored locally, no external servers. See [Privacy Policy](PRIVACY.md)

## Browser Compatibility

- ✅ Chrome (tested)
- ✅ Edge (should work)
- ❌ Firefox (requires Manifest V2 conversion)
- ❌ Safari (requires different extension format)

## License

Free to use and modify for personal and commercial projects.

---

**Made with ❤️ for developers**
