# Privacy Policy for Codex Dev

**Last updated:** September 24, 2026

## Overview

Codex Dev ("the Extension") is a Chrome extension for web designers and developers. It includes a responsive viewer with device mockups, a design inspector, a visual CSS editor, an SEO audit, an asset extractor, screenshot capture, feedback pins and Codex AI (AI-assisted design edits using your own API key).

The Extension has no servers of its own, no accounts, no analytics and no tracking. This policy explains what data the Extension handles and where it goes.

## Data stored on your device

The Extension stores the following in Chrome's local extension storage (`chrome.storage.local`). It never leaves your device unless described below:

- **Settings**: responsive viewer preferences (for example device frames on or off).
- **Codex AI settings**: the AI provider you chose, the model, and the API key(s) you entered.
- **Feedback pins**: the notes you write, the page address, the element they're attached to, the screen size and a small screenshot of the annotated element.

You can delete this data at any time by removing keys or pins in the Extension, or by uninstalling the Extension.

## Data sent to third parties

### Codex AI (only when you use it)

Codex AI is off until you add your own API key. It sends data only when you press send in the Codex AI chat. Each request goes directly from your browser to the provider you chose, using your key:

- **Anthropic** (Claude), when Claude is selected: https://www.anthropic.com/legal/privacy
- **OpenAI** (ChatGPT models), when ChatGPT is selected: https://openai.com/policies/privacy-policy

Each request contains:
- your message,
- a screenshot of the area of the page you selected,
- the HTML and key styles of the selected elements,
- a summary of the page's design (fonts, colors, spacing values),
- the page address,
- earlier messages from the same chat.

Your API key is sent only to that provider, to authenticate the request. The provider handles this data under its own privacy policy and terms, as part of your own account with them. The Extension's developer never receives it.

### Link checker and asset downloads (only when you use them)

- The SEO audit's **Check HTTP Status** button requests each link on the page to read its status code.
- The Asset Extractor downloads the images, fonts, media and animation files you choose to save. It also fetches animation files to check whether they are Lottie animations.

These requests go straight to the websites that host those files, as if you had opened them yourself. Nothing is sent anywhere else.

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
| `storage`, `unlimitedStorage` | Save settings, API keys and feedback pins (with their screenshots) on your device |
| `downloads` | Save screenshots and assets you choose to download |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | In the responsive viewer tab only: remove headers that block sites from loading in frames, and set the chosen device's user agent |
| `webNavigation` | Apply the viewer's device settings to the frames inside the viewer tab |
| `debugger` | Performance tools in the responsive viewer: slow-network and slow-CPU simulation. Attached only to the viewer tab, and only while you use those tools |

## Children's privacy

The Extension does not knowingly collect any data from anyone, including children under 13.

## Changes

If this policy changes, the "Last updated" date above will change too.

## Contact and source code

The Extension is open source, so you can check exactly what it does:

- Source code: https://github.com/himavamsi12/codex-dev
- Questions: https://github.com/himavamsi12/codex-dev/issues
