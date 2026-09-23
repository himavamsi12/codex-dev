// Populate device lists on popup load
document.addEventListener('DOMContentLoaded', () => {
    CodexIcons.hydrate();
    populateDeviceLists();
    attachEventListeners();
    setupTopLevelTabs();
    setupDeviceCategoryTabs();
});

// Top-level "Tools" / "Launch Viewer" tabs
function setupTopLevelTabs() {
    const tabs = document.querySelectorAll('.popup-tab');
    const views = document.querySelectorAll('.popup-view');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
            views.forEach(v => v.classList.remove('active'));
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
            document.getElementById('view-' + tab.dataset.view).classList.add('active');
        });
    });
}

// Mobile / Tablet / Desktop device-list switcher inside the Launch Viewer view
function setupDeviceCategoryTabs() {
    const tabs = document.querySelectorAll('.device-cat-tab');
    const panels = document.querySelectorAll('.device-list');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const panel = document.querySelector(`.device-list[data-cat-panel="${tab.dataset.cat}"]`);
            if (panel) panel.classList.add('active');
        });
    });
    // Default: mobile panel visible on load
    const defaultPanel = document.querySelector('.device-list[data-cat-panel="mobile"]');
    if (defaultPanel) defaultPanel.classList.add('active');
}

// Populate device lists by category
function populateDeviceLists() {
    const categories = ['mobile', 'tablet', 'desktop'];

    categories.forEach(category => {
        const container = document.getElementById(`${category}-devices`);
        const devices = getDevicesByCategory(category);

        let lastBrand = null;
        devices.forEach((device, index) => {
            // Group long lists by brand (catalog order is already grouped)
            if (category !== 'desktop' && device.brand && device.brand !== lastBrand) {
                const label = document.createElement('div');
                label.className = 'device-group-label';
                label.textContent = device.brand === 'apple' ? 'Apple' : category === 'tablet' ? 'Android and Windows' : 'Android';
                container.appendChild(label);
                lastBrand = device.brand;
            }
            container.appendChild(createDeviceElement(device, index));
        });
    });
}

// Create device list item element
function createDeviceElement(device, index) {
    const div = document.createElement('div');
    div.className = 'device-item';
    div.style.animationDelay = `${index * 0.03}s`; // Faster animation
    div.dataset.deviceName = device.name;

    div.innerHTML = `
    <div class="device-info">
      <div class="device-name">${device.name}</div>
      <div class="device-dimensions">${device.width}×${device.height}</div>
    </div>
    <div class="device-icon">${device.icon}</div>
  `;

    div.addEventListener('click', () => {
        launchViewer([device]);
    });

    return div;
}

// Attach event listeners
function attachEventListeners() {
    // Quick launch preset buttons (only those with data-devices attribute)
    const presetButtons = document.querySelectorAll('.preset-btn[data-devices]');
    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const deviceNames = JSON.parse(btn.dataset.devices);
            const devices = deviceNames.map(name => findDeviceByName(name)).filter(d => d);
            launchViewer(devices);
        });
    });

    // Custom size launch button
    const customBtn = document.getElementById('launch-custom');
    customBtn.addEventListener('click', () => {
        const width = parseInt(document.getElementById('custom-width').value);
        const height = parseInt(document.getElementById('custom-height').value);

        if (width && height && width >= 320 && height >= 320) {
            const customDevice = {
                name: `Custom (${width}×${height})`,
                width: width,
                height: height,
                category: 'custom',
                icon: CodexIcons.svg('adjustments-horizontal', 24)
            };
            launchViewer([customDevice]);
        } else {
            showCustomError(true);
        }
    });

    // Allow Enter key in custom inputs; clear the error as soon as the user edits
    ['custom-width', 'custom-height'].forEach(id => {
        const input = document.getElementById(id);
        input.addEventListener('keypress', handleEnterKey);
        input.addEventListener('input', () => showCustomError(false));
    });

    // Every on-demand tool shares one design-token/toast library. Inject it
    // first (idempotent — guarded by `if (window.CodexUI) return` inside the
    // file itself) so the tool script can call window.CodexUI.* immediately.
    function withSharedUI(tabId, opts, cb) {
        chrome.scripting.executeScript({
            target: { tabId, allFrames: !!opts.allFrames, },
            files: ['utils/icons.js', 'utils/codex-ui.js']
        }, () => { if (chrome.runtime.lastError) console.warn('codex-ui inject:', chrome.runtime.lastError.message); cb(); });
    }

    // Design Inspector (vendor/inspector) — injected by background.js so the
    // keyboard shortcut and the popup share one code path.
    const inspectorBtn = document.getElementById('toggle-inspector');
    if (inspectorBtn) {
        inspectorBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (!tab) return;
                chrome.runtime.sendMessage({ action: 'TOGGLE_INSPECTOR', tabId: tab.id }, res => {
                    if (res && res.ok) { window.close(); return; }
                    const status = document.getElementById('tools-status');
                    status.textContent = (res && res.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'Could not open the inspector on this page.';
                    status.hidden = false;
                });
            });
        });
    }

    // CSS Viewer Toggle
    const cssViewerBtn = document.getElementById('toggle-css-viewer');
    if (cssViewerBtn) {
        cssViewerBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    withSharedUI(tab.id, {}, () => {
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['css-viewer.js']
                        });
                        window.close(); // Close popup
                    });
                }
            });
        });
    }

    // Asset Extractor Toggle
    const assetExtractorBtn = document.getElementById('toggle-asset-extractor');
    if (assetExtractorBtn) {
        assetExtractorBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    // Inject JSZip + shared UI, then the extractor script. Wait for completion to close.
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames: true },
                        files: ['jszip.min.js']
                    }, () => {
                        withSharedUI(tab.id, { allFrames: true }, () => {
                            chrome.scripting.executeScript({
                                target: { tabId: tab.id, allFrames: true },
                                files: ['asset-extractor.js']
                            }, () => {
                                window.close(); // Close popup only AFTER script finishes injecting
                            });
                        });
                    });
                }
            });
        });
    }

    // SEO & Insights Toggle
    const seoToolsBtn = document.getElementById('toggle-seo-tools');
    if (seoToolsBtn) {
        seoToolsBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    // Isolated world: reads the same live DOM, and can reach the
                    // background worker for the link checker
                    withSharedUI(tab.id, {}, () => {
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['seo-tools.js']
                        });
                        window.close(); // Close popup
                    });
                }
            });
        });
    }

    // ── Capture Tool ──────────────────────────────────────────────────
    const captureBtn = document.getElementById('toggle-capture');
    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            showCapturePanel();
        });
    }

    // ── Feedback Tool ─────────────────────────────────────────────────
    const feedbackBtn = document.getElementById('toggle-feedback');
    if (feedbackBtn) {
        feedbackBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    withSharedUI(tab.id, {}, () => {
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id },
                            files: ['feedback.js']
                        });
                        window.close();
                    });
                }
            });
        });
    }
}

// ── Capture sheet (static markup in popup.html, toggled here) ─────
function showCapturePanel() {
    const panel = document.getElementById('capture-panel');
    const container = document.querySelector('.popup-container');
    const close = () => { panel.hidden = true; container.classList.remove('sheet-open'); };

    // Toggle
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    container.classList.add('sheet-open');
    setStatus('');

    if (panel.dataset.bound) return;
    panel.dataset.bound = '1';
    panel.remove = close; // existing handlers below call panel.remove() to dismiss

    document.getElementById('cap-close').addEventListener('click', close);

    // Format selector
    let selectedFormat = 'png';
    panel.querySelectorAll('.fmt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedFormat = btn.dataset.fmt;
            panel.querySelectorAll('.fmt-btn').forEach(b => {
                b.classList.toggle('active', b === btn);
                b.setAttribute('aria-checked', String(b === btn));
            });
        });
    });

    function setStatus(msg, isError) {
        const s = document.getElementById('cap-status');
        if (!s) return;
        s.textContent = msg;
        s.classList.toggle('is-error', !!isError);
    }

    function withActiveTab(cb) {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) cb(tabs[0]);
        });
    }

    // Ensure capture.js is injected in ISOLATED world so it can listen to background messages
    function ensureCaptureScript(tabId, cb) {
        chrome.scripting.executeScript(
            { target: { tabId }, files: ['utils/icons.js', 'utils/codex-ui.js'] },
            () => {
                chrome.scripting.executeScript(
                    { target: { tabId }, files: ['capture.js'] },
                    () => { if (chrome.runtime.lastError) console.warn('capture.js inject:', chrome.runtime.lastError.message); cb(); }
                );
            }
        );
    }

    // ── Visible ──
    document.getElementById('cap-visible').addEventListener('click', () => {
        setStatus('Capturing viewport...');
        withActiveTab(tab => {
            chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE', format: selectedFormat }, res => {
                if (res && res.ok) { setStatus('Saved to Downloads'); setTimeout(() => panel.remove(), 1500); }
                else setStatus('Error: ' + (res && res.error || 'Unknown'), true);
            });
        });
    });


    // ── Full Page ── (fire-and-forget: popup closes immediately, file appears in Downloads when done)
    document.getElementById('cap-fullpage').addEventListener('click', () => {
        // Send without a response callback — popup will close before the long capture finishes
        // Background handles the download autonomously; no response needed
        chrome.runtime.sendMessage({ action: 'CAPTURE_FULL_PAGE', format: selectedFormat });
        // Show brief status then close popup so the message port stays open in the background
        setStatus('Full page capture started. Check Downloads.');
        setTimeout(() => { try { window.close(); } catch(e) { panel.remove(); } }, 1200);
    });


    // ── Select Area ──
    document.getElementById('cap-area').addEventListener('click', () => {
        panel.remove();
        withActiveTab(tab => {
            ensureCaptureScript(tab.id, () => {
                chrome.tabs.sendMessage(tab.id, { action: 'CAPTURE_SELECT_AREA', format: selectedFormat });
                window.close();
            });
        });
    });

    // ── Select Element ──
    document.getElementById('cap-element').addEventListener('click', () => {
        panel.remove();
        withActiveTab(tab => {
            ensureCaptureScript(tab.id, () => {
                chrome.tabs.sendMessage(tab.id, { action: 'CAPTURE_SELECT_ELEMENT', format: selectedFormat });
                window.close();
            });
        });
    });
}

function showCustomError(show) {
    document.getElementById('custom-error').hidden = !show;
    ['custom-width', 'custom-height'].forEach(id => {
        const input = document.getElementById(id);
        if (show) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
    });
}

// Handle Enter key in custom inputs
function handleEnterKey(e) {
    if (e.key === 'Enter') {
        document.getElementById('launch-custom').click();
    }
}

// Find device by name
function findDeviceByName(name) {
    const allDevices = getAllDevices();
    return allDevices.find(device => device.name === name);
}

// Launch responsive viewer with selected devices (iframe approach - all in one tab)
function launchViewer(devices) {
    if (!devices || devices.length === 0) {
        return;
    }

    // Get current tab URL
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const currentUrl = tabs[0].url;

        // Encode devices and URL for passing to viewer
        const encodedDevices = encodeURIComponent(JSON.stringify(devices));
        const encodedUrl = encodeURIComponent(currentUrl);

        // Open viewer in new tab (single tab with all viewports)
        const viewerUrl = `viewer.html?devices=${encodedDevices}&url=${encodedUrl}`;
        chrome.tabs.create({ url: viewerUrl });
    });
}
