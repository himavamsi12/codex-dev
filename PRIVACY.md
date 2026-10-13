# Privacy Policy for Codex Dev

**Last updated:** September 24, 2026

## Overview

Codex Dev ("the Extension") is a Chrome extension for web designers and developers. It includes a responsive viewer with device mockups, a design inspector, a visual CSS editor, an SEO audit, an asset extractor, screenshot capture, feedback pins and Codex AI (AI-assisted design edits and animations).

The Extension has no servers of its own, no accounts, no analytics and no tracking. This policy explains what data the Extension handles and where it goes.

## Data stored on your device

The Extension stores the following in Chrome's local extension storage (`chrome.storage.local`). It never leaves your device unless described below:

- **Settings**: responsive viewer preferences (for example device frames on or off).
- **Codex AI install ID**: a random ID, generated in your browser, used only to count your daily free requests.
- **Claude Code bridge settings** (only if you turn it on): the local port and the pairing token you pasted. The list of tabs you allowed is kept in session storage and is cleared when the browser closes.
- **Feedback pins**: the notes you write, the page address, the element they're attached to, the screen size and a small screenshot of the annotated element.

You can delete this data at any time by removing keys or pins in the Extension, or by uninstalling the Extension.

## Data sent to third parties

### Codex AI (only when you use it)

Codex AI needs no account and no API key. It sends data only when you press send in the Codex AI chat, or Create animation in Design Inspector AI. The request goes to the Codex Dev server, which forwards it to Anthropic (Claude, https://www.anthropic.com/legal/privacy) and returns the answer.

Each request contains:
- your message,
- for edits, a screenshot of the area of the page you selected,
- the HTML and key styles of the selected elements,
- a summary of the page's design (fonts, colors, spacing values),
- the page address,
- earlier messages from the same chat.

The Codex Dev server does not store your message, HTML or screenshot, and does not log their content. To enforce a daily limit on free use it keeps only a request count for your install (a random ID generated in your browser, not linked to any account or person) and for a hashed network address; these counters expire after two days. Anthropic handles the forwarded data under its own privacy policy and terms.

**Responsive audit (viewer).** The **Audit** drawer finds layout problems (sideways scrolling, overflowing elements, cut-off text, covered controls, small tap targets) entirely in your browser, with no AI and nothing sent anywhere. Only when you press **Fix with AI** or **Explain differences** is data sent to Codex AI, as described above: for a fix, the issue's details and an inspection of the affected element (its tag, size, key layout styles, matching CSS rules and a short text excerpt); for an explanation, a compact layout description of each open device (box sizes, column counts, hidden menus, heading sizes) and the audit's findings. No screenshots, no full page text, no cookies or form values, and not the page address.

### Link checker and asset downloads (only when you use them)

- The SEO audit's **Check HTTP Status** button requests each link on the page to read its status code.
- The Asset Extractor downloads the images, fonts, media and animation files you choose to save. It also fetches animation files to check whether they are Lottie animations.

These requests go straight to the websites that host those files, as if you had opened them yourself. Nothing is sent anywhere else.

### Design Inspector AI (only when you use it)

The panel lets you add a reference screenshot (an upload, or a capture of the page you are on) and restyle a section of the page. The screenshot is shown in the panel and kept in the browser's session memory so it follows you between tabs; it is cleared when you press Remove or close the browser, and it is not uploaded anywhere unless you press **Generate design** with a reference attached: then a reduced JPEG copy (at most 1280 pixels on its longest side) is sent, with your description and the selected section's HTML and key styles, to Codex AI as described above. The server does not store it. The **Animate** section works the same way: only when you press Create animation, it sends your description and the HTML of the selected section (no screenshot, no page cookies or form values) to Codex AI, exactly as described above. The reply is plain data that the Extension checks against an allow-list before the bundled GSAP library plays it; the AI cannot run script on the page. Preview changes exist only on the page you are viewing and disappear on reload or Reset. Previewing at a screen width uses Chrome's debugger on that tab and ends when you press Actual size or close the panel.

### Claude Code bridge (optional, off by default)

If you turn on **Claude Code** in the popup and register the separate `mcp-server` with Claude Code, the Extension connects to that server on your own computer (`127.0.0.1`) using a pairing you approve with a one-time code. Nothing leaves your computer through this connection.

Claude Code can only use tabs you click **Allow on this tab** for, and only until the tab closes or moves to another site. For an allowed tab it can set the viewport, take screenshots, measure the layout, read element styles, preview CSS, and read console and failed-network messages. URLs are sent without their query strings, and obvious tokens in error messages are removed. Cookies, passwords, form values, storage and request or response bodies are never read. What happens to results after they reach Claude Code is governed by Anthropic's terms for the Claude Code you run, not by this Extension.

### Edit in Browser (local bridge)

If you turn on **Edit** and run `codex-dev-bridge` yourself, the Extension connects to `127.0.0.1` on your computer only, using a token you paste once (kept in `chrome.storage.local`). When you press Apply it sends the selected element (its HTML, text, class names, a few computed styles, and a cropped screenshot) and your instruction to that local program, which passes them to Claude Code under your own Claude login. Nothing is sent to Codex Dev servers. What Claude Code does with them is governed by Anthropic's terms.

## Data the Extension does not collect

- No personal information, accounts or email addresses
- No browsing history
- No analytics, telemetry or tracking
- No passwords or payment data. When pages are shown side by side in the responsive viewer, the Extension deliberately does not copy typing in password and payment-card fields from one device to the others.

## Permissions

| Permission | Why it's needed |
|---|---|
| `<all_urls>` (host access) | Run the tools on any website you choose, load sites in the responsive viewer, check links and download assets |
| `activeTab`, `tabs` | Work with the tab you're on and open the responsive viewer and reports in new tabs |
| `scripting` | Add the tools (inspector, editor, SEO audit, feedback pins, asset extractor) to the page when you start them |
| `storage`, `unlimitedStorage` | Save settings and feedback pins (with their screenshots) on your device |
| `downloads` | Save screenshots and assets you choose to download |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | In the responsive viewer tab only: remove headers that block sites from loading in frames, and set the chosen device's user agent |
| `webNavigation` | Apply the viewer's device settings to the frames inside the viewer tab |
| `debugger` | Performance tools in the responsive viewer (slow-network and slow-CPU simulation, attached to the viewer tab only while you use them) and, if you enable the Claude Code bridge, viewport emulation, screenshots and console/network capture on tabs you allow |
| `alarms` | Reconnect to the local Claude Code bridge once a minute when it is turned on |

## Children's privacy

The Extension does not knowingly collect any data from anyone, including children under 13.

## Changes

If this policy changes, the "Last updated" date above will change too.

## Contact and source code

The Extension is open source, so you can check exactly what it does:

- Source code: https://github.com/himavamsi12/codex-dev
- Questions: https://github.com/himavamsi12/codex-dev/issues
