// Line icons for static markup in viewer.html
CodexIcons.hydrate();

// Global state
let viewports = [];          // device objects currently shown, each tagged with _uid
let targetUrl = '';
let syncScrollEnabled = false;
let currentZoom = 1.0;
let allDevices = []; // Will be populated from devices.js
let framesEnabled = readPref('codex.viewer.frames', true);
let nextViewportUid = 1;

function readPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch (e) { return fallback; }
}
function writePref(key, value) {
    try { localStorage.setItem(key, value ? '1' : '0'); } catch (e) { /* storage blocked: keep in memory */ }
}

// Initialize viewer on page load
document.addEventListener('DOMContentLoaded', () => {
    loadAllDevices();
    parseUrlParameters();
    displayUrl();
    createViewports();
    attachHeaderControls();
    setupDeviceSelector();
    setupUserAgentSelector();

    if (window.DesignTools) {
        window.DesignTools.init();
    }

    if (window.PerformanceTools) {
        window.PerformanceTools.init();
    }
});

// Parse URL parameters to get devices and target URL
function parseUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const devicesParam = urlParams.get('devices');
    const urlParam = urlParams.get('url');

    if (devicesParam) {
        try {
            // Links from the popup (and older links) carry name/size only;
            // resolveDevice fills in frame + brand from the catalog.
            viewports = JSON.parse(decodeURIComponent(devicesParam)).map(resolveDevice);
        } catch (e) {
            console.error('Error parsing devices:', e);
            viewports = [];
        }
    }

    if (urlParam) {
        targetUrl = decodeURIComponent(urlParam);
    }
}

// Display target URL in header
function displayUrl() {
    const urlDisplay = document.getElementById('url-display');
    urlDisplay.textContent = targetUrl || 'No URL specified';
    urlDisplay.title = targetUrl;
}

// Short address for the mockup's URL bar: host for web pages, file name for local files.
function targetHost() {
    try {
        const u = new URL(targetUrl);
        if (u.protocol === 'file:') return decodeURIComponent(u.pathname.split('/').pop() || 'file');
        return u.hostname || targetUrl;
    } catch (e) { return targetUrl || 'about:blank'; }
}

// Create viewport elements for each device
function createViewports() {
    const container = document.getElementById('viewports-container');

    if (viewports.length === 0) {
        container.innerHTML = '<p class="viewports-empty">No devices selected. Click "Add Device" to add viewports.</p>';
        return;
    }

    viewports.forEach(device => container.appendChild(createViewportElement(device)));
}

const SCREENSHOT_ICON = CodexIcons.svg('camera', 16);

// Create a single viewport element (header + device mockup + iframe)
function createViewportElement(device) {
    device._uid = device._uid || nextViewportUid++;

    const viewport = document.createElement('div');
    viewport.className = 'viewport';
    viewport.style.animationDelay = `${Math.min(viewports.indexOf(device), 8) * 0.05}s`;
    viewport.dataset.uid = device._uid;

    const rotatable = DeviceFrames.canRotate(device);
    const header = document.createElement('div');
    header.className = 'viewport-header';
    header.innerHTML = `
    <div class="viewport-info">
      <div class="viewport-name">
        <span class="viewport-device-icon">${device.icon || CodexIcons.svg('adjustments-horizontal', 24)}</span>
        <span class="viewport-title"></span>
      </div>
      <div class="viewport-dimensions"></div>
    </div>
    <div class="viewport-controls">
      <span class="shot-menu-wrap">
        <button class="viewport-btn screenshot-viewport-btn" title="Screenshot" aria-haspopup="menu" aria-expanded="false">${SCREENSHOT_ICON}</button>
        <span class="shot-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-shot="full">${CodexIcons.svg('arrow-autofit-height', 15)}<span>Full page</span></button>
          <button type="button" role="menuitem" data-shot="visible">${CodexIcons.svg('device-mobile', 15)}<span>Visible area with device frame</span></button>
        </span>
      </span>
      ${rotatable ? `<button class="viewport-btn rotate-btn" title="Rotate">${CodexIcons.svg('rotate-clockwise', 16)}</button>` : ''}
      <button class="viewport-btn refresh-btn" title="Refresh">${CodexIcons.svg('refresh', 16)}</button>
      <button class="viewport-btn viewport-close-btn" title="Remove">${CodexIcons.svg('x', 16)}</button>
    </div>
  `;
    // Names come from the catalog or the custom-device form: set as text, not HTML.
    header.querySelector('.viewport-title').textContent = device.name;

    const mockup = DeviceFrames.build(device);
    mockup.setHost(targetHost());
    const frame = mockup.frame;

    const iframe = document.createElement('iframe');
    iframe.src = targetUrl;
    iframe.dataset.frameId = `frame-${device._uid}`;
    iframe.loading = 'lazy';
    iframe.title = device.name;

    const state = { landscape: false };

    // Size everything for the current frame/orientation state. Only resizes:
    // the iframe stays in place, so toggling frames or rotating never reloads it.
    function layoutViewport() {
        const L = mockup.apply({ frames: framesEnabled, landscape: state.landscape });
        iframe.width = L.viewportW;
        iframe.height = L.viewportH;

        const dims = header.querySelector('.viewport-dimensions');
        const visibleDiffers = L.viewportW !== L.screenW || L.viewportH !== L.screenH;
        dims.textContent = visibleDiffers
            ? `${L.viewportW}×${L.viewportH} visible`
            : `${L.screenW}×${L.screenH}`;
        dims.title = visibleDiffers
            ? `Screen ${L.screenW}×${L.screenH}. The page gets ${L.viewportW}×${L.viewportH} after the status bar and browser UI.`
            : `Viewport ${L.screenW}×${L.screenH}`;

        // Ruler ticks are drawn for a fixed size: redraw after a resize.
        if (window.DesignTools && window.DesignTools.rulerEnabled) {
            window.DesignTools.removeRulerFromFrame(frame);
            window.DesignTools.addRulerToFrame(frame);
        }
        return L;
    }
    viewport._layout = layoutViewport;

    if (rotatable) {
        header.querySelector('.rotate-btn').addEventListener('click', () => {
            state.landscape = !state.landscape;
            mockup.root.classList.add('rotating');
            setTimeout(() => mockup.root.classList.remove('rotating'), 500);
            layoutViewport();
        });
    }

    header.querySelector('.refresh-btn').addEventListener('click', () => {
        iframe.src = iframe.src;
    });

    header.querySelector('.viewport-close-btn').addEventListener('click', () => {
        removeViewportByUid(device._uid);
    });

    // Camera: menu with a full-page capture (the whole site at this device's
    // width) and the visible device mockup.
    const screenshotBtn = header.querySelector('.screenshot-viewport-btn');
    const shotMenu = header.querySelector('.shot-menu');
    const setMenu = open => {
        shotMenu.hidden = !open;
        screenshotBtn.setAttribute('aria-expanded', String(open));
    };
    screenshotBtn.addEventListener('click', e => {
        e.stopPropagation();
        setMenu(shotMenu.hidden);
    });
    document.addEventListener('click', e => { if (!shotMenu.hidden && !shotMenu.contains(e.target)) setMenu(false); });

    shotMenu.addEventListener('click', async e => {
        const item = e.target.closest('[data-shot]');
        if (!item) return;
        setMenu(false);
        screenshotBtn.innerHTML = '<div class="loading-spinner is-small"></div>';
        screenshotBtn.disabled = true;
        const L = layoutViewport();
        const orientation = state.landscape ? '-landscape' : '';
        try {
            if (item.dataset.shot === 'full') {
                await captureFullPageToFile(iframe, frame, `codex-${device.name}${orientation}-${L.viewportW}w-fullpage`);
            } else {
                // Framed: the whole mockup. Unframed: just the page area.
                const target = framesEnabled ? mockup.root : frame;
                await captureElementToFile(target, `codex-${device.name}${orientation}-${L.viewportW}x${L.viewportH}`);
            }
        } catch (err) {
            console.error('Screenshot error:', err);
            CodexUI.toast(`Error: ${err.message || err}`, 4000);
        } finally {
            screenshotBtn.innerHTML = SCREENSHOT_ICON;
            screenshotBtn.disabled = false;
        }
    });

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'viewport-loading';
    loading.innerHTML = '<div class="loading-spinner"></div>';

    iframe.addEventListener('load', () => {
        setTimeout(() => { loading.style.display = 'none'; }, 500);

        // If sync scroll is enabled, re-enable it for this newly loaded iframe
        if (syncScrollEnabled) {
            setTimeout(() => {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'ENABLE_SYNC_SCROLL',
                        frameId: iframe.dataset.frameId
                    }, '*');
                } catch (e) {
                    console.warn('Could not re-enable sync for iframe:', e);
                }
            }, 100); // Small delay to ensure content script is ready
        }
    });

    iframe.addEventListener('error', () => {
        loading.style.display = 'none';
        console.error(`Failed to load ${targetUrl} in ${device.name}`);
    });

    frame.appendChild(iframe);
    frame.appendChild(loading);
    layoutViewport();

    // Apply design tools if active
    if (window.DesignTools) {
        window.DesignTools.applyToNewViewport(frame);
    }

    viewport.appendChild(header);
    viewport.appendChild(mockup.root);

    return viewport;
}

// Re-layout every viewport (frames toggled). Iframes are not reloaded.
function relayoutAllViewports() {
    document.querySelectorAll('.viewport').forEach(v => { if (v._layout) v._layout(); });
}

function removeViewportByUid(uid) {
    const index = viewports.findIndex(v => v._uid === uid);
    if (index !== -1) viewports.splice(index, 1);

    const el = document.querySelector(`.viewport[data-uid="${uid}"]`);
    if (el) {
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        el.style.transform = 'scale(0.96)';
        el.style.opacity = '0';
        setTimeout(() => {
            el.remove();
            if (!viewports.length) createViewports();
        }, 200);
    }
    updateUrlParams();
    if (typeof refreshDevicePicker === 'function') refreshDevicePicker();
}

// ── Screenshots ─────────────────────────────────────────────────────────
// captureVisibleTab only sees what is on screen, so the element is brought
// fully into view first (zooming the workspace out if it is taller or wider
// than the window), captured, cropped, and the view is restored.
// Wait for a repaint (with a timeout so a throttled tab can never hang it)
const nextFrame = () => new Promise(r => {
    const timer = setTimeout(r, 100);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); r(); }));
});
const wait = ms => new Promise(r => setTimeout(r, ms));

function captureVisibleTab() {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: 'CAPTURE_VISIBLE_RAW' }, response => {
            if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
            if (!response || !response.dataUrl) return reject(new Error((response && response.error) || 'Failed to capture tab'));
            resolve(response.dataUrl);
        });
    });
}

async function captureElementToFile(el, fileBase) {
    const container = document.getElementById('viewports-container');
    const headerH = document.querySelector('.viewer-header').offsetHeight;
    const margin = 12;
    const savedZoom = currentZoom;
    const savedScroll = { x: window.scrollX, y: window.scrollY, cx: container.scrollLeft };

    let rect = el.getBoundingClientRect();
    const naturalW = rect.width / currentZoom, naturalH = rect.height / currentZoom;
    const fit = Math.min(1, (window.innerWidth - margin * 2) / naturalW, (window.innerHeight - headerH - margin * 2) / naturalH);
    const zoomChanged = fit < currentZoom;
    if (zoomChanged) applyWorkspaceZoom(fit, { silent: true });

    try {
        await nextFrame();
        rect = el.getBoundingClientRect();
        // Scroll so the element sits just below the sticky header.
        // The workspace scrolls horizontally inside its own (scaled) box, so
        // screen distances convert to its scroll units by dividing by the zoom.
        const effectiveZoom = zoomChanged ? fit : currentZoom;
        window.scrollBy(0, rect.top - headerH - margin);
        container.scrollLeft += (rect.left - margin) / effectiveZoom;
        await nextFrame();
        await wait(250); // let iframes repaint at the new position

        rect = el.getBoundingClientRect();
        const dataUrl = await captureVisibleTab();
        const img = await new Promise((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('Failed to load captured image'));
            i.src = dataUrl;
        });

        // The capture is in device pixels; derive the ratio from the image itself.
        const scale = img.naturalWidth / window.innerWidth;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(rect.width * scale);
        canvas.height = Math.round(rect.height * scale);
        canvas.getContext('2d').drawImage(img,
            rect.left * scale, rect.top * scale, rect.width * scale, rect.height * scale,
            0, 0, canvas.width, canvas.height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `${fileBase.replace(/[^a-z0-9x-]+/gi, '-').toLowerCase()}-${stamp}.png`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        if (zoomChanged) CodexUI.toast('Saved. The device was captured at reduced size to fit the window.', 3500);
        else CodexUI.toast('Screenshot saved to Downloads', 2000);
    } finally {
        if (zoomChanged) applyWorkspaceZoom(savedZoom, { silent: true });
        container.scrollLeft = savedScroll.cx;
        window.scrollTo(savedScroll.x, savedScroll.y);
    }
}

// ── Full-page capture ───────────────────────────────────────────────────
// The site in the iframe is scrolled step by step by iframe-sync.js (the
// content script inside the frame); each step is screenshotted and the
// visible part of the frame is stitched into one tall image at the
// device's width.
function frameRequest(iframe, type, payload, timeoutMs) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
        const onMessage = e => {
            if (e.source !== iframe.contentWindow || !e.data || e.data.type !== 'CODEX_CAPTURE_REPLY' || e.data.id !== id) return;
            cleanup();
            resolve(e.data);
        };
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('This page did not respond. Refresh the device (↻) and try again; some sites block extensions inside frames.'));
        }, timeoutMs || 10000);
        const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
        window.addEventListener('message', onMessage);
        iframe.contentWindow.postMessage({ type, id, ...(payload || {}) }, '*');
    });
}

async function captureFullPageToFile(iframe, frameEl, fileBase) {
    const container = document.getElementById('viewports-container');
    const headerH = document.querySelector('.viewer-header').offsetHeight;
    const margin = 12;
    const savedZoom = currentZoom;
    const savedScroll = { x: window.scrollX, y: window.scrollY, cx: container.scrollLeft };

    CodexUI.toast('Preparing full-page capture...', 2500);
    const info = await frameRequest(iframe, 'CODEX_CAPTURE_BEGIN', {}, 20000);

    // The whole device frame must be on screen, so each step captures one
    // full screen of the site and the last step lands exactly at the bottom.
    let rect = frameEl.getBoundingClientRect();
    const naturalW = rect.width / currentZoom, naturalH = rect.height / currentZoom;
    const fit = Math.min(1, (window.innerWidth - margin * 2) / naturalW, (window.innerHeight - headerH - margin * 2) / naturalH);
    const zoomChanged = fit < currentZoom;
    if (zoomChanged) applyWorkspaceZoom(fit, { silent: true });
    const zoom = zoomChanged ? fit : currentZoom;

    try {
        await nextFrame();
        rect = frameEl.getBoundingClientRect();
        window.scrollBy(0, rect.top - headerH - margin);
        container.scrollLeft += (rect.left - margin) / zoom;
        await nextFrame();
        rect = frameEl.getBoundingClientRect();

        const step = info.innerHeight; // one full screen of the site per shot

        let canvas = null, ctx = null, outScale = 1, totalHeight = info.scrollHeight;
        let y = 0, shot = 0, lastY = -1;
        const shots = Math.ceil(totalHeight / step);
        while (true) {
            const pos = await frameRequest(iframe, 'CODEX_CAPTURE_SCROLL', { y, first: y === 0 });
            // Safety: stop if the site no longer scrolls (never loop on one spot)
            if (pos.scrollY <= lastY) break;
            lastY = pos.scrollY;
            totalHeight = Math.max(totalHeight, pos.scrollHeight);
            await wait(shot === 0 ? 150 : 550); // captureVisibleTab allows ~2 captures per second
            const dataUrl = await captureVisibleTab();
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('Failed to load captured image'));
                i.src = dataUrl;
            });
            const s = img.naturalWidth / window.innerWidth;       // image px per screen px
            if (!canvas) {
                // Browsers cap canvas size; scale down very long pages to fit
                outScale = Math.min(zoom * s, 32000 / totalHeight, Math.sqrt(250e6 / (info.innerWidth * totalHeight)));
                canvas = document.createElement('canvas');
                canvas.width = Math.round(info.innerWidth * outScale);
                canvas.height = Math.round(totalHeight * outScale);
                ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            const sliceCss = Math.min(step, totalHeight - pos.scrollY); // frame px this slice covers
            ctx.drawImage(img,
                rect.left * s, rect.top * s, rect.width * s, sliceCss * zoom * s,
                0, Math.round(pos.scrollY * outScale), canvas.width, Math.round(sliceCss * outScale));
            shot++;
            CodexUI.toast(`Capturing full page... ${Math.min(shot, shots)}/${shots}`, 1500);
            if (pos.scrollY + step >= totalHeight || shot > 200) break;
            y = pos.scrollY + step;
        }

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `${fileBase.replace(/[^a-z0-9x-]+/gi, '-').toLowerCase()}-${stamp}.png`;
        link.href = url;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        CodexUI.toast(`Full page saved (${canvas.width}×${canvas.height}px)`, 3000);
    } finally {
        await frameRequest(iframe, 'CODEX_CAPTURE_END', {}, 5000).catch(() => {});
        if (zoomChanged) applyWorkspaceZoom(savedZoom, { silent: true });
        container.scrollLeft = savedScroll.cx;
        window.scrollTo(savedScroll.x, savedScroll.y);
    }
}

// Zoom scales the whole workspace; one implementation shared by the slider,
// the device picker and screenshots.
function applyWorkspaceZoom(level, opts) {
    const container = document.getElementById('viewports-container');
    if (!opts || !opts.silent) currentZoom = level;
    // Captures measure right after zooming, so skip the zoom animation for them
    container.style.transition = opts && opts.silent ? 'none' : '';
    if (level === 1) {
        container.style.transform = '';
        container.style.width = '';
        container.style.height = '';
        return;
    }
    container.style.transform = `scale(${level})`;
    container.style.transformOrigin = 'top left';
    container.style.width = `${100 / level}%`;
    container.style.height = `${100 / level}%`;
}

// Attach header controls
function attachHeaderControls() {
    const refreshAllBtn = document.getElementById('refresh-all');
    const syncScrollBtn = document.getElementById('sync-scroll');
    const screenshotBtn = document.getElementById('screenshot');
    const framesBtn = document.getElementById('toggle-frames');
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomValue = document.getElementById('zoom-value');

    // Zoom control - scales the entire workspace
    zoomSlider.addEventListener('input', (e) => {
        zoomValue.textContent = `${e.target.value}%`;
        applyWorkspaceZoom(e.target.value / 100);
    });

    // Device frames on/off (remembered)
    const syncFramesBtn = () => {
        framesBtn.classList.toggle('active', framesEnabled);
        framesBtn.setAttribute('aria-pressed', String(framesEnabled));
        framesBtn.title = framesEnabled ? 'Hide device frames' : 'Show device frames';
    };
    syncFramesBtn();
    framesBtn.addEventListener('click', () => {
        framesEnabled = !framesEnabled;
        writePref('codex.viewer.frames', framesEnabled);
        syncFramesBtn();
        relayoutAllViewports();
    });

    // Refresh all viewports
    refreshAllBtn.addEventListener('click', () => {
        document.querySelectorAll('.viewport-frame iframe').forEach(iframe => {
            iframe.src = iframe.src;
        });
    });

    // Toggle scroll sync
    syncScrollBtn.addEventListener('click', () => {
        syncScrollEnabled = !syncScrollEnabled;
        syncScrollBtn.classList.toggle('active', syncScrollEnabled);

        if (syncScrollEnabled) {
            enableScrollSync();
        } else {
            disableScrollSync();
        }
    });

    // Whole-workspace screenshot: system tools capture every device at once
    screenshotBtn.addEventListener('click', () => {
        CodexUI.toast('Use Cmd+Shift+5 (Mac) or Win+Shift+S to capture all devices. Each device also has its own camera button.', 5000);
    });
}

// Setup User Agent Selector
function setupUserAgentSelector() {
    const uaSelector = document.getElementById('ua-selector');

    if (!uaSelector || !window.USER_AGENTS) return;

    // Populate options
    window.USER_AGENTS.forEach(ua => {
        const option = document.createElement('option');
        option.value = ua.value;
        option.textContent = ua.name;
        uaSelector.appendChild(option);
    });

    // Handle change
    uaSelector.addEventListener('change', (e) => {
        const selectedUA = e.target.value;

        // Send to background — it scopes the header rewrite + navigator
        // override to this tab only (see background.js updateUserAgentRule)
        chrome.runtime.sendMessage({
            type: 'SET_USER_AGENT',
            value: selectedUA
        }, () => {
            if (chrome.runtime.lastError) {
                console.error('SET_USER_AGENT failed:', chrome.runtime.lastError.message);
                return;
            }
            // Refresh all iframes to apply new UA
            const iframes = document.querySelectorAll('.viewport-frame iframe');
            iframes.forEach(iframe => {
                iframe.src = iframe.src;
            });
        });
    });
}


// Scroll sync using postMessage
let scrollSyncMessageHandler = null;

function enableScrollSync() {
    // Broadcast enable message to all iframes with their frame IDs
    const iframes = document.querySelectorAll('.viewport-frame iframe');
    iframes.forEach(iframe => {
        try {
            iframe.contentWindow.postMessage({
                type: 'ENABLE_SYNC_SCROLL',
                frameId: iframe.dataset.frameId  // Send frame ID to content script
            }, '*');
        } catch (e) {
            console.warn('Could not send enable message to iframe:', e);
        }
    });

    // Relay one device's scroll/click/input to every other device. The sender
    // is identified by its window (frames can't read their own iframe id).
    scrollSyncMessageHandler = (event) => {
        if (!event.data) return;
        const kinds = { IFRAME_SCROLL: 'SYNC_SCROLL', IFRAME_CLICK: 'SYNC_CLICK', IFRAME_INPUT: 'SYNC_INPUT' };
        const relayType = kinds[event.data.type];
        if (!relayType) return;
        const iframes = document.querySelectorAll('.viewport-frame iframe');
        if (![...iframes].some(f => f.contentWindow === event.source)) return; // not one of our devices

        const message = relayType === 'SYNC_SCROLL'
            ? { type: relayType, scrollPercentX: event.data.scrollPercentX, scrollPercentY: event.data.scrollPercentY }
            : relayType === 'SYNC_CLICK'
                ? { type: relayType, path: event.data.path }
                : { type: relayType, path: event.data.path, value: event.data.value };

        iframes.forEach(iframe => {
            if (iframe.contentWindow === event.source) return; // skip the sender
            try { iframe.contentWindow.postMessage(message, '*'); } catch (e) { /* frame navigating */ }
        });
    };

    window.addEventListener('message', scrollSyncMessageHandler);
    console.log('Sync scroll enabled: scrolling will be synchronized across viewports');
}

function disableScrollSync() {
    // Broadcast disable message to all iframes
    const iframes = document.querySelectorAll('.viewport-frame iframe');
    iframes.forEach(iframe => {
        try {
            iframe.contentWindow.postMessage({
                type: 'DISABLE_SYNC_SCROLL'
            }, '*');
        } catch (e) {
            console.warn('Could not send disable message to iframe:', e);
        }
    });

    if (scrollSyncMessageHandler) {
        window.removeEventListener('message', scrollSyncMessageHandler);
        scrollSyncMessageHandler = null;
    }
    console.log('Sync scroll disabled');
}

// Global Message Listener for Load Times (Always Active)
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'IFRAME_LOADED') {
        const frameId = event.data.frameId;
        const loadTime = Math.round(event.data.loadTime);
        updateViewportLoadTime(frameId, loadTime);
    }
});

function updateViewportLoadTime(frameId, timeMs) {
    // Find viewport header based on frameId
    const frames = document.querySelectorAll('.viewport-frame iframe');
    let targetFrame = null;

    frames.forEach(f => {
        if (f.dataset.frameId === frameId) targetFrame = f;
    });

    if (targetFrame) {
        const viewport = targetFrame.closest('.viewport');
        const header = viewport.querySelector('.viewport-header');

        // Remove existing badge if any (re-loads)
        const existingBadge = header.querySelector('.load-time-badge');
        if (existingBadge) existingBadge.remove();

        const badge = document.createElement('span');
        badge.className = 'load-time-badge';

        const timeSec = (timeMs / 1000).toFixed(2);
        badge.textContent = `${timeSec}s`;

        // Color coding
        badge.classList.add(timeSec < 1.0 ? 'is-fast' : timeSec < 3.0 ? 'is-ok' : 'is-slow');

        // Insert after device name
        const nameEl = header.querySelector('.viewport-info');
        if (nameEl) {
            nameEl.appendChild(badge);
        }
    }
}
