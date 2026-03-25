# Privacy Policy for Codex Dev

**Last Updated:** December 30, 2024

## Overview

Codex Dev ("the Extension") is a developer tool for testing websites across multiple responsive screen sizes. This privacy policy explains how we handle data when you use our Chrome extension.

## Data Collection

### What We Collect

The Extension **does not collect or store any data**, locally or otherwise.

### What We DON'T Collect

- ❌ Personal information
- ❌ Browsing history
- ❌ Passwords or credentials
- ❌ Form data
- ❌ Cookies from websites you visit
- ❌ Any data from websites you test
- ❌ Device preferences or settings (all settings are temporary per session)

## How We Use Data

### No Data Storage

The Extension operates entirely in your browser memory for the duration of your session:
- No data is stored locally
- No data is ever transmitted to external servers
- No analytics or tracking

### Website Access

The Extension needs to access websites you choose to test:
- Loads websites in iframes for responsive testing
- Modifies HTTP headers (X-Frame-Options) to enable iframe loading
- This is done locally in your browser only
- No data from these websites is collected or stored

## Data Sharing

**We do not share, sell, or transmit any data to third parties.**

All processing happens locally in your browser. The Extension:
- Does not connect to any external servers
- Does not send analytics
- Does not track usage
- Does not share data with anyone

## Permissions Explained

The Extension requests the following permissions:

| Permission | Why We Need It |
|------------|----------------|
| `activeTab` | To capture screenshots of viewports you're testing |
| `tabs` | To open the responsive viewer in a new tab |
| `declarativeNetRequest` | To modify X-Frame-Options headers so websites can load in iframes |
| `declarativeNetRequestWithHostAccess` | Required for header modification to work |
| `<all_urls>` | To load any website you want to test in the responsive viewer |

## Your Rights

### Data Control

You have full control over your data:
- **View Data**: Open Chrome DevTools → Application → Storage → Local Storage
- **Delete Data**: Clear all stored preferences by removing the extension
- **Opt-Out**: Simply don't use the extension

### No Account Required

The Extension does not require:
- Account creation
- Login credentials
- Email address
- Any personal information

## Data Security

- All data stays on your device
- No transmission to external servers
- Chrome's built-in security protects your local storage
- No encryption needed (data never leaves your device)

## Children's Privacy

The Extension does not knowingly collect data from anyone, including children under 13. Since all data is stored locally and no personal information is collected, there are no special considerations for children's privacy.

## Changes to Privacy Policy

We may update this privacy policy from time to time. Changes will be reflected in the "Last Updated" date above. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## Third-Party Websites

When you use the Extension to test websites:
- Those websites have their own privacy policies
- We do not control or access data from those websites
- Please review the privacy policies of websites you visit

## Contact

For questions about this privacy policy or the Extension:
- **GitHub Issues**: [Your GitHub Repository URL]
- **Email**: [Your Contact Email]

## Open Source

This Extension is open source. You can review the code to verify our privacy practices:
- **Source Code**: [Your GitHub Repository URL]

## Summary

**In Plain English:**
- We don't collect your personal data
- Everything stays on your computer
- We don't send anything to servers
- We don't track you
- You can delete everything by removing the extension

---

**Your privacy matters to us. This extension is built by developers, for developers, with privacy as a core principle.**
