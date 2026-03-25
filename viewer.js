// Global state
let viewports = [];
let targetUrl = '';
let syncScrollEnabled = false;
let currentZoom = 1.0;
let allDevices = []; // Will be populated from devices.js

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
});

// Parse URL parameters to get devices and target URL
function parseUrlParameters() {
    const urlParams = new URLSearchParams(window.location.search);
    const devicesParam = urlParams.get('devices');
    const urlParam = urlParams.get('url');

    if (devicesParam) {
        try {
            viewports = JSON.parse(decodeURIComponent(devicesParam));
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

// Create viewport elements for each device
function createViewports() {
    const container = document.getElementById('viewports-container');

    if (viewports.length === 0) {
        container.innerHTML = '<p style="color: #a0a0a0; text-align: center; width: 100%;">No devices selected</p>';
        return;
    }

    viewports.forEach((device, index) => {
        const viewportElement = createViewportElement(device, index);
        container.appendChild(viewportElement);
    });
}

const SCREENSHOT_ICON = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>';

// Create a single viewport element
function createViewportElement(device, index) {
    const viewport = document.createElement('div');
    viewport.className = 'viewport';
    viewport.style.animationDelay = `${index * 0.05}s`; // Faster animation
    viewport.dataset.index = index;

    // Create viewport header
    const header = document.createElement('div');
    header.className = 'viewport-header';
    header.innerHTML = `
    <div class="viewport-info">
      <div class="viewport-name">
        <span>${device.icon}</span>
        <span>${device.name}</span>
      </div>
      <div class="viewport-dimensions">${device.width} × ${device.height}</div>
    </div>
    <div class="viewport-controls">
      <button class="viewport-btn screenshot-viewport-btn" title="Screenshot this viewport">${SCREENSHOT_ICON}</button>
      <button class="viewport-btn rotate-btn" title="Rotate">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
      </button>
      <button class="viewport-btn refresh-btn" title="Refresh">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
      </button>
      <button class="viewport-btn viewport-close-btn" title="Remove">
        <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
  `;

    // Create viewport frame
    const frame = document.createElement('div');
    frame.className = 'viewport-frame';
    frame.style.width = `${device.width}px`;
    frame.style.height = `${device.height}px`;

    // Create iframe with lazy loading for better performance
    const iframe = document.createElement('iframe');
    iframe.src = targetUrl;
    iframe.width = device.width;
    iframe.height = device.height;
    iframe.dataset.frameId = `frame-${index}`;
    iframe.loading = 'lazy'; // Lazy load iframes for better performance

    // Content script will automatically inject into iframe via manifest
    // But we need to communicate with it

    // Rotation logic
    const rotateBtn = header.querySelector('.rotate-btn');
    let isLandscape = false;

    rotateBtn.addEventListener('click', () => {
        isLandscape = !isLandscape;

        // Animate
        frame.classList.add('rotating');
        setTimeout(() => frame.classList.remove('rotating'), 500);

        if (isLandscape) {
            frame.style.width = `${device.height}px`;
            frame.style.height = `${device.width}px`;
            iframe.width = device.height;
            iframe.height = device.width;
        } else {
            frame.style.width = `${device.width}px`;
            frame.style.height = `${device.height}px`;
            iframe.width = device.width;
            iframe.height = device.height;
        }
    });

    // Refresh logic
    const refreshBtn = header.querySelector('.refresh-btn');
    refreshBtn.addEventListener('click', () => {
        iframe.src = iframe.src;
    });

    // Close logic
    const closeBtn = header.querySelector('.viewport-close-btn');
    closeBtn.addEventListener('click', () => {
        viewport.style.transform = 'scale(0.8)';
        viewport.style.opacity = '0';
        setTimeout(() => viewport.remove(), 300);
    });

    // Screenshot logic
    const screenshotBtn = header.querySelector('.screenshot-viewport-btn');
    screenshotBtn.addEventListener('click', async () => {
        // Show loading state on button
        const originalContent = screenshotBtn.innerHTML;
        screenshotBtn.innerHTML = '<div class="loading-spinner" style="width: 14px; height: 14px; border-width: 2px;"></div>';
        screenshotBtn.disabled = true;

        try {
            // Get current dimensions (might be rotated)
            const width = parseInt(frame.style.width);
            const height = parseInt(frame.style.height);
            const dimensions = `${width} × ${height}`;
            const deviceName = device.name + (isLandscape ? ' (Landscape)' : '');

            // ... existing screenshot logic ...
            // We need to capture the visible tab
            // Since we can't easily capture just the iframe content due to cross-origin restrictions
            // We will use the approach of capturing the visible tab and cropping

            // Send message to background to capture visible tab
            chrome.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB' }, (response) => {
                if (chrome.runtime.lastError || !response || !response.dataUrl) {
                    throw new Error(chrome.runtime.lastError?.message || 'Failed to capture tab');
                }

                processScreenshot(response.dataUrl, iframe, width, height, deviceName, dimensions, () => {
                    screenshotBtn.innerHTML = SCREENSHOT_ICON;
                    screenshotBtn.disabled = false;
                }, (err) => {
                    console.error('Screenshot error:', err);
                    screenshotBtn.innerHTML = SCREENSHOT_ICON;
                    screenshotBtn.disabled = false;
                    alert(`❌ Error: ${err.message || err.toString() || 'Unknown error'}`);
                });
            });

        } catch (err) {
            console.error('Screenshot error:', err);
            screenshotBtn.innerHTML = SCREENSHOT_ICON;
            screenshotBtn.disabled = false;
            alert(`❌ Error: ${err.message || err.toString() || 'Unknown error'}`);
        }
    });

    // Loading indicator
    const loading = document.createElement('div');
    loading.className = 'viewport-loading';
    loading.innerHTML = '<div class="loading-spinner"></div>';

    // Handle iframe load
    iframe.addEventListener('load', () => {
        // Hide loading indicator after iframe loads
        setTimeout(() => {
            loading.style.display = 'none';
        }, 500);

        // If sync scroll is enabled, re-enable it for this newly loaded iframe
        if (syncScrollEnabled) {
            setTimeout(() => {
                try {
                    iframe.contentWindow.postMessage({
                        type: 'ENABLE_SYNC_SCROLL',
                        frameId: iframe.dataset.frameId
                    }, '*');
                    console.log('🔄 Re-enabled sync scroll for', iframe.dataset.frameId, 'after load');
                } catch (e) {
                    console.warn('Could not re-enable sync for iframe:', e);
                }
            }, 100); // Small delay to ensure content script is ready
        }
    });

    // Handle iframe errors
    iframe.addEventListener('error', () => {
        loading.style.display = 'none';
        console.error(`Failed to load ${targetUrl} in ${device.name}`);
    });

    frame.appendChild(iframe);
    frame.appendChild(loading);

    // Apply design tools if active
    if (window.DesignTools) {
        window.DesignTools.applyToNewViewport(frame);
    }

    viewport.appendChild(header);
    viewport.appendChild(frame);

    return viewport;
}

// Helper to process screenshot (crop and download)
function processScreenshot(dataUrl, iframe, width, height, deviceName, dimensions, onSuccess, onError) {
    const img = new Image();
    img.onload = () => {
        try {
            const canvas = document.createElement('canvas');
            const rect = iframe.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;

            canvas.width = width * dpr;
            canvas.height = height * dpr;
            const ctx = canvas.getContext('2d');

            // Draw the portion of the screenshot that corresponds to the iframe
            // Note: coordinates must be relative to the viewport/window
            // The captureVisibleTab captures the whole window content area

            ctx.drawImage(
                img,
                rect.left * dpr, // Source X
                rect.top * dpr,  // Source Y
                rect.width * dpr, // Source Width
                rect.height * dpr, // Source Height
                0, 0, // Dest X, Y
                width * dpr, // Dest Width
                height * dpr // Dest Height
            );

            // Download
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                const safeName = deviceName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
                const safeDims = dimensions.replace(' × ', 'x').replace(/[^0-9x]/g, '');
                link.download = `codex-fullpage-${safeName}-${safeDims}-${timestamp}.png`;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);

                if (onSuccess) onSuccess();
            }, 'image/png');
        } catch (e) {
            if (onError) onError(e);
        }
    };
    img.onerror = (e) => {
        if (onError) onError(new Error('Failed to load captured image'));
    };
    img.src = dataUrl;
}

// Attach header controls
function attachHeaderControls() {
    const refreshAllBtn = document.getElementById('refresh-all');
    const syncScrollBtn = document.getElementById('sync-scroll');
    const screenshotBtn = document.getElementById('screenshot');
    const zoomSlider = document.getElementById('zoom-slider');
    const zoomValue = document.getElementById('zoom-value');
    const viewportsContainer = document.getElementById('viewports-container');

    // Zoom control - scales the entire workspace
    zoomSlider.addEventListener('input', (e) => {
        const zoomLevel = e.target.value / 100;
        currentZoom = zoomLevel; // Track current zoom
        zoomValue.textContent = `${e.target.value}%`;

        // Apply zoom to the entire viewports container
        viewportsContainer.style.transform = `scale(${zoomLevel})`;
        viewportsContainer.style.transformOrigin = 'top left';

        // Adjust container width to maintain scrollability
        // When scaled down, we need more space to show all content
        const inverseZoom = 1 / zoomLevel;
        viewportsContainer.style.width = `${inverseZoom * 100}%`;
        viewportsContainer.style.height = `${inverseZoom * 100}%`;
    });

    // Refresh all viewports
    refreshAllBtn.addEventListener('click', () => {
        const iframes = document.querySelectorAll('.viewport-frame iframe');
        iframes.forEach(iframe => {
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

    // Screenshot functionality - captures visible viewports
    screenshotBtn.addEventListener('click', async () => {
        try {
            // Use Chrome's built-in screenshot API
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: 'screen' }
            });

            // Stop the stream immediately (we just needed permission)
            stream.getTracks().forEach(track => track.stop());

            // Inform user to use browser screenshot
            alert('📸 Screenshot Tips\n\n1. Press Cmd+Shift+5 (Mac) or use browser screenshot tools\n2. Select the area you want to capture\n3. All viewports will be included in the screenshot\n\nAlternatively, use Chrome DevTools screenshot feature (Cmd+Shift+P → "Screenshot")');
        } catch (err) {
            alert('📸 Take a Screenshot\n\nUse your browser\'s built-in screenshot tools:\n\n• Mac: Cmd + Shift + 5\n• Windows: Win + Shift + S\n• Chrome DevTools: Cmd/Ctrl + Shift + P → "Screenshot"\n\nThis will capture all visible viewports!');
        }
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

        // Send to background
        chrome.runtime.sendMessage({
            type: 'SET_USER_AGENT',
            value: selectedUA
        }, () => {
            // Also save to storage for client-side spoofing
            chrome.storage.local.set({ userAgent: selectedUA }, () => {
                // Refresh all iframes to apply new UA
                const iframes = document.querySelectorAll('.viewport-frame iframe');
                iframes.forEach(iframe => {
                    iframe.src = iframe.src;
                });
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

    // Create message handler for iframe scroll events
    scrollSyncMessageHandler = (event) => {
        if (event.data.type === 'IFRAME_SCROLL') {
            // Broadcast scroll position to all iframes except the source
            iframes.forEach(iframe => {
                if (iframe.dataset.frameId === event.data.frameId) return; // Skip source
                try {
                    iframe.contentWindow.postMessage({
                        type: 'SYNC_SCROLL',
                        scrollPercentX: event.data.scrollPercentX,
                        scrollPercentY: event.data.scrollPercentY,
                        sourceFrameId: event.data.frameId
                    }, '*');
                } catch (e) {
                    // Ignore errors
                }
            });
        }

        if (event.data.type === 'IFRAME_CLICK') {
            iframes.forEach(iframe => {
                if (iframe.dataset.frameId === event.data.frameId) return; // Skip source
                try {
                    iframe.contentWindow.postMessage({
                        type: 'SYNC_CLICK',
                        path: event.data.path
                    }, '*');
                } catch (e) {
                    console.warn('Sync click error', e);
                }
            });
        }

        if (event.data.type === 'IFRAME_INPUT') {
            iframes.forEach(iframe => {
                if (iframe.dataset.frameId === event.data.frameId) return; // Skip source
                try {
                    iframe.contentWindow.postMessage({
                        type: 'SYNC_INPUT',
                        path: event.data.path,
                        value: event.data.value
                    }, '*');
                } catch (e) {
                    console.warn('Sync input error', e);
                }
            });
        }
    };

    window.addEventListener('message', scrollSyncMessageHandler);
    console.log('✅ Sync scroll enabled - scrolling will be synchronized across viewports');
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
    console.log('❌ Sync scroll disabled');
}

// Global Message Listener for Load Times (Always Active)
window.addEventListener('message', (event) => {
    if (event.data.type === 'IFRAME_LOADED') {
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
        if (timeSec < 1.0) {
            badge.style.color = '#4FD1C5'; // Green
            badge.style.border = '1px solid rgba(79, 209, 197, 0.3)';
        } else if (timeSec < 3.0) {
            badge.style.color = '#F6E05E'; // Yellow
            badge.style.border = '1px solid rgba(246, 224, 94, 0.3)';
        } else {
            badge.style.color = '#F56565'; // Red
            badge.style.border = '1px solid rgba(245, 101, 101, 0.3)';
        }

        // Insert after device name
        const nameEl = header.querySelector('.viewport-info');
        if (nameEl) {
            nameEl.appendChild(badge);
        }
    }
}

// Global Message Listener for Load Times (Always Active)
window.addEventListener('message', (event) => {
    if (event.data.type === 'IFRAME_LOADED') {
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
        if (timeSec < 1.0) {
            badge.style.color = '#4FD1C5'; // Green
            badge.style.border = '1px solid rgba(79, 209, 197, 0.3)';
        } else if (timeSec < 3.0) {
            badge.style.color = '#F6E05E'; // Yellow
            badge.style.border = '1px solid rgba(246, 224, 94, 0.3)';
        } else {
            badge.style.color = '#F56565'; // Red
            badge.style.border = '1px solid rgba(245, 101, 101, 0.3)';
        }

        // Insert after device name
        const nameEl = header.querySelector('.viewport-info'); // Use info container
        if (nameEl) {
            nameEl.appendChild(badge);
        }
    }
}
