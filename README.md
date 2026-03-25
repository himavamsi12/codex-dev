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
