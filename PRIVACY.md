# Privacy Policy for Codex Dev

**Last updated:** October 14, 2026 (version 1.6.0)

## Overview

Codex Dev ("the Extension") is a Chrome extension for web designers and developers. It includes a responsive viewer with device mockups and a layout audit, a design inspector, a visual CSS editor, an asset extractor, screenshot capture, feedback pins, and an optional connection to Claude Code running on your own computer.

The Extension has no servers of its own in this version, no accounts, no analytics and no tracking. This policy explains what data the Extension handles and where it goes.

## Data stored on your device

The Extension stores the following in Chrome's local extension storage (`chrome.storage.local`). It never leaves your device unless described below:

- **Settings**: tool and responsive viewer preferences (for example device frames on or off).
- **Popular Mix**: the list of devices you chose for Quick Launch (device names and sizes).
- **Feedback pins**: the notes you write, the page address, the element they're attached to, the screen size and a small screenshot of the annotated element.
- **Claude Code connection settings** (only if you turn it on): the local port and the pairing token the Extension receives from the server on your computer. The list of tabs you allowed is kept in session storage and is cleared when the browser closes.

You can delete this data at any time in the Extension (for example by removing pins, or with "Reset to default" for the Popular Mix), or by uninstalling the Extension.

## Features that work entirely in your browser

These send nothing anywhere:

- **Responsive viewer** with device frames, rotation, synced scrolling, rulers and screenshots.
- **Layout audit** in the viewer: finds sideways scrolling, overflowing elements, cut-off text, covered controls, small tap targets and small text.
- **Network and CPU throttling** in the viewer: simulates slow connections and slow devices with Chrome's debugger, only in the viewer tab and its device frames, and only while you have a throttle setting turned on.
- **Design Inspector**, **Visual Editor**, **Capture** and **Feedback pins**.

To show websites inside the viewer's device frames, the Extension removes the headers that forbid framing (`X-Frame-Options`, `Content-Security-Policy`) and can set the chosen device's user agent. This applies only to pages loaded inside the viewer tab, never to your normal browsing.

## Data sent to websites (only when you use these tools)

- The **Asset Extractor** downloads the images, fonts, media and animation files you choose to save. It also fetches animation files to check whether they are Lottie animations.

These requests go straight to the websites that host those files, as if you had opened them yourself. Nothing is sent anywhere else.

## Claude Code connection (optional, off by default)

If you turn on **Claude Code** in the popup and run the separate `codex-dev` MCP server with Claude Code, the Extension connects to that server on your own computer (`127.0.0.1`) using a pairing you approve with a one-time code. The Extension itself sends nothing to any other server through this connection.

Claude Code can only use tabs you click **Allow on this tab** for, and only until the tab closes or moves to another site. For an allowed tab it can set the viewport, take screenshots, measure the layout, read element styles, preview CSS, open the page in the responsive viewer, read and change your Popular Mix, and read console and failed-network messages. URLs are sent without their query strings, and obvious tokens in error messages are removed. Cookies, passwords, form values, storage and request or response bodies are never read.

Claude Code is your own program. It may send what it receives (for example screenshots, page HTML and styles from allowed tabs) to Anthropic to answer your requests. That is governed by Anthropic's terms and privacy policy for the Claude Code you run (https://www.anthropic.com/legal/privacy), not by this Extension.

## AI features (turned off in this version)

The Extension's code contains AI features (Codex AI chat, Design Inspector AI, "Fix with AI" in the audit, and "Edit in Browser"). In version 1.6.0 they are turned off: their buttons are hidden and the Extension refuses AI requests, so no data is sent for them. If a future version turns them on, this policy will be updated first to describe exactly what they send and where.

## Data the Extension does not collect

- No personal information, accounts or email addresses
- No passwords, credentials or payment data. When pages are shown side by side in the responsive viewer, the Extension deliberately does not copy typing in password and payment-card fields from one device to the others.
- No browsing history
- No analytics, telemetry or tracking
- Nothing is sold or shared with anyone

## Permissions

| Permission | Why it's needed |
|---|---|
| `<all_urls>` (host access) | Run the tools on any website you choose, load sites in the responsive viewer, and download assets |
| `activeTab`, `tabs` | Work with the tab you're on, open the responsive viewer and reports in new tabs, and keep viewer settings limited to viewer tabs |
| `scripting` | Add the tools (inspector, editor, feedback pins, asset extractor, screenshot selection) to the page when you start them, and run the bundled layout checks in the viewer and on tabs you allow for Claude Code |
| `storage`, `unlimitedStorage` | Save settings, your Popular Mix and feedback pins (with their screenshots) on your device |
| `downloads` | Save screenshots and assets you choose to download |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | In the responsive viewer tab only: remove headers that block sites from loading in frames, and set the chosen device's user agent |
| `webNavigation` | Apply the viewer's device settings to the frames inside the viewer tab |
| `debugger` | Network and CPU throttling in the responsive viewer (only while a throttle setting is on), and, if you enable the Claude Code connection, viewport emulation, screenshots and console/network error capture on tabs you allow |
| `alarms` | Reconnect to the local Claude Code server once a minute when the connection is turned on |

## Keyboard shortcuts

The Extension registers keyboard shortcuts (for example Alt+Shift+D / Option+Shift+D to open it). They only run the Extension's own commands; the Extension does not record your keystrokes.

## Children's privacy

The Extension does not knowingly collect any data from anyone, including children under 13.

## Changes

If this policy changes, the "Last updated" date above will change too.

## Contact and source code

The Extension is open source, so you can check exactly what it does:

- Source code: https://github.com/himavamsi12/codex-dev
- Questions: https://github.com/himavamsi12/codex-dev/issues
