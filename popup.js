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
    // Quick launch preset buttons
    const presetButtons = document.querySelectorAll('.preset-btn');
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
