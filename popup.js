// Populate device lists on popup load
document.addEventListener('DOMContentLoaded', () => {
    populateDeviceLists();
    attachEventListeners();
});

// Populate device lists by category
function populateDeviceLists() {
    const categories = ['mobile', 'tablet', 'desktop'];

    categories.forEach(category => {
        const container = document.getElementById(`${category}-devices`);
        const devices = getDevicesByCategory(category);

        devices.forEach((device, index) => {
            const deviceElement = createDeviceElement(device, index);
            container.appendChild(deviceElement);
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
      <div class="device-dimensions">${device.width} × ${device.height}</div>
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
                category: 'custom',
                icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
            };
            launchViewer([customDevice]);
        } else {
            alert('Please enter valid dimensions (minimum 320px)');
        }
    });

    // Allow Enter key in custom inputs
    document.getElementById('custom-width').addEventListener('keypress', handleEnterKey);
    document.getElementById('custom-height').addEventListener('keypress', handleEnterKey);

    // CSS Viewer Toggle
    const cssViewerBtn = document.getElementById('toggle-css-viewer');
    if (cssViewerBtn) {
        cssViewerBtn.addEventListener('click', () => {
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab) {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['css-viewer.js']
                    });
                    window.close(); // Close popup
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
                    // Inject JSZip first, then the extractor script. Wait for completion to close.
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames: true },
                        files: ['jszip.min.js']
                    }, () => {
                        chrome.scripting.executeScript({
                            target: { tabId: tab.id, allFrames: true },
                            files: ['asset-extractor.js']
                        }, () => {
                            window.close(); // Close popup only AFTER script finishes injecting
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
                    // Inject into MAIN world so document.querySelectorAll reads the live page DOM
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['seo-tools.js'],
                        world: 'MAIN'
                    });
                    window.close(); // Close popup
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
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['feedback.js']
                    });
                    window.close();
                }
            });
        });
    }
}

// ── Capture Panel (inline modal inside popup) ─────────────────────
function showCapturePanel() {
    // Remove existing if open (toggle)
    const existing = document.getElementById('capture-panel');
    if (existing) { existing.remove(); return; }

    const panel = document.createElement('div');
    panel.id = 'capture-panel';
    panel.style.cssText = `
        position:fixed; inset:0; background:rgba(8,9,14,0.96);
        z-index:9999; display:flex; flex-direction:column;
        font-family:'Outfit',system-ui,sans-serif; color:#e2e8f0;
        padding:18px 16px; gap:10px; overflow-y:auto;
    `;

    panel.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <div style="font-size:14px;font-weight:700;background:linear-gradient(135deg,#4FD1C5,#9F7AEA);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">
                📸 Capture Screenshot
            </div>
            <button id="cap-close" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;cursor:pointer;padding:3px 9px;border-radius:5px;font-size:12px;">✕</button>
        </div>

        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#4FD1C5;margin-bottom:2px;">Format</div>
        <div style="display:flex;gap:6px;margin-bottom:8px;">
            ${['PNG','JPEG','WEBP'].map(f => `<button class="fmt-btn" data-fmt="${f.toLowerCase()}" style="flex:1;padding:7px 4px;background:${f==='PNG'?'rgba(79,209,197,0.15)':'rgba(255,255,255,0.05)'};border:1px solid ${f==='PNG'?'#4FD1C5':'rgba(255,255,255,0.1)'};border-radius:7px;color:${f==='PNG'?'#4FD1C5':'#94a3b8'};font-size:11px;font-weight:700;cursor:pointer;">${f}</button>`).join('')}
        </div>

        <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#4FD1C5;margin-bottom:4px;">Capture Mode</div>

        ${[
            { id:'cap-visible',  icon:'🖥',  title:'Visible Part',     desc:'Capture what you see right now in the viewport' },
            { id:'cap-fullpage', icon:'📄',  title:'Full Page',        desc:'Scroll and stitch the entire page into one image' },
            { id:'cap-area',     icon:'⬛',  title:'Select Area',      desc:'Drag to select any region of the page' },
            { id:'cap-element',  icon:'🖱',  title:'Select Element',   desc:'Click any element on the page to capture it' },
        ].map(m => `
            <button id="${m.id}" style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.09);border-radius:10px;padding:12px 14px;cursor:pointer;text-align:left;transition:border-color 0.18s;width:100%;" onmouseover="this.style.borderColor='#4FD1C5'" onmouseout="this.style.borderColor='rgba(255,255,255,0.09)'">
                <span style="font-size:22px;flex-shrink:0;">${m.icon}</span>
                <div>
                    <div style="font-weight:700;color:#fff;font-size:12.5px;margin-bottom:2px;">${m.title}</div>
                    <div style="font-size:11px;color:#94a3b8;line-height:1.4;">${m.desc}</div>
                </div>
            </button>
        `).join('')}

        <div id="cap-status" style="font-size:11px;color:#4FD1C5;text-align:center;min-height:16px;margin-top:4px;"></div>
    `;

    document.body.appendChild(panel);

    // Close
    document.getElementById('cap-close').addEventListener('click', () => panel.remove());

    // Format selector
    let selectedFormat = 'png';
    panel.querySelectorAll('.fmt-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedFormat = btn.dataset.fmt;
            panel.querySelectorAll('.fmt-btn').forEach(b => {
                b.style.background = 'rgba(255,255,255,0.05)';
                b.style.borderColor = 'rgba(255,255,255,0.1)';
                b.style.color = '#94a3b8';
            });
            btn.style.background = 'rgba(79,209,197,0.15)';
            btn.style.borderColor = '#4FD1C5';
            btn.style.color = '#4FD1C5';
        });
    });

    function setStatus(msg) {
        const s = document.getElementById('cap-status');
        if (s) s.textContent = msg;
    }

    function withActiveTab(cb) {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) cb(tabs[0]);
        });
    }

    // Ensure capture.js is injected in ISOLATED world so it can listen to background messages
    function ensureCaptureScript(tabId, cb) {
        chrome.scripting.executeScript(
            { target: { tabId }, files: ['capture.js'] },
            () => { if (chrome.runtime.lastError) console.warn('capture.js inject:', chrome.runtime.lastError.message); cb(); }
        );
    }

    // ── Visible ──
    document.getElementById('cap-visible').addEventListener('click', () => {
        setStatus('Capturing viewport…');
        withActiveTab(tab => {
            chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE', format: selectedFormat }, res => {
                if (res && res.ok) { setStatus('✓ Saved to Downloads!'); setTimeout(() => panel.remove(), 1500); }
                else setStatus('Error: ' + (res && res.error || 'Unknown'));
            });
        });
    });


    // ── Full Page ── (fire-and-forget: popup closes immediately, file appears in Downloads when done)
    document.getElementById('cap-fullpage').addEventListener('click', () => {
        // Send without a response callback — popup will close before the long capture finishes
        // Background handles the download autonomously; no response needed
        chrome.runtime.sendMessage({ action: 'CAPTURE_FULL_PAGE', format: selectedFormat });
        // Show brief status then close popup so the message port stays open in the background
        setStatus('📄 Full page capture started… check Downloads!');
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
