// Load all available devices from devices.js
function loadAllDevices() {
    allDevices = [
        ...DEVICE_PRESETS.mobile,
        ...DEVICE_PRESETS.tablet,
        ...DEVICE_PRESETS.desktop
    ];
}

// Setup device selector modal
function setupDeviceSelector() {
    const addDeviceBtn = document.getElementById('add-device');
    const modal = document.getElementById('device-selector');
    const closeModalBtn = document.getElementById('close-modal');
    const overlay = modal.querySelector('.device-selector-overlay');
    const categoryBtns = document.querySelectorAll('.category-btn');
    const deviceList = document.getElementById('device-list');
    const addCustomBtn = document.getElementById('add-custom-device');
    const customWidthInput = document.getElementById('custom-width');
    const customHeightInput = document.getElementById('custom-height');
    const customNameInput = document.getElementById('custom-name');

    // Show modal
    addDeviceBtn.addEventListener('click', () => {
        modal.classList.add('active');
        populateDeviceList('all');
    });

    // Close modal
    closeModalBtn.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    overlay.addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Category filtering
    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const category = btn.dataset.category;

            const customForm = document.getElementById('custom-device-form');
            const deviceListContainer = document.getElementById('device-list-container');

            if (category === 'custom') {
                // Show custom form, hide device list
                customForm.style.display = 'block';
                deviceListContainer.style.display = 'none';
            } else {
                // Show device list, hide custom form
                customForm.style.display = 'none';
                deviceListContainer.style.display = 'block';
                populateDeviceList(category);
            }
        });
    });

    // Add custom device
    addCustomBtn.addEventListener('click', () => {
        const width = parseInt(customWidthInput.value);
        const height = parseInt(customHeightInput.value);
        const name = customNameInput.value.trim() || `Custom ${width}×${height}`;

        // Validate inputs
        if (!width || !height || width < 100 || height < 100 || width > 4000 || height > 4000) {
            alert('⚠️ Invalid Dimensions\n\nPlease enter valid width and height between 100 and 4000 pixels.');
            return;
        }

        // Create custom device object
        const customDevice = {
            name: name,
            width: width,
            height: height,
            category: 'custom',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
        };

        // Add the viewport
        addViewport(customDevice);

        // Clear inputs
        customWidthInput.value = '';
        customHeightInput.value = '';
        customNameInput.value = '';

        // Close modal
        modal.classList.remove('active');
    });
}

// Populate device list in modal
function populateDeviceList(category) {
    const deviceList = document.getElementById('device-list');
    deviceList.innerHTML = '';

    let filteredDevices = allDevices;
    if (category !== 'all') {
        filteredDevices = allDevices.filter(d => d.category === category);
    }

    filteredDevices.forEach(device => {
        const isAlreadyAdded = viewports.some(v => v.name === device.name);

        const deviceItem = document.createElement('div');
        deviceItem.className = `device-item ${isAlreadyAdded ? 'disabled' : ''}`;
        deviceItem.innerHTML = `
            <div class="device-item-icon">${device.icon}</div>
            <div class="device-item-name">${device.name}</div>
            <div class="device-item-size">${device.width} × ${device.height}</div>
        `;

        if (!isAlreadyAdded) {
            deviceItem.addEventListener('click', () => {
                addViewport(device);
                document.getElementById('device-selector').classList.remove('active');
            });
        }

        deviceList.appendChild(deviceItem);
    });
}

// Add a new viewport dynamically
function addViewport(device) {
    // Add to viewports array
    viewports.push(device);

    // Create viewport element
    const container = document.getElementById('viewports-container');
    const viewportElement = createViewportElement(device, viewports.length - 1);
    container.appendChild(viewportElement);

    // Apply current zoom level
    const viewportsContainer = document.getElementById('viewports-container');
    if (currentZoom !== 1.0) {
        viewportsContainer.style.transform = `scale(${currentZoom})`;
        viewportsContainer.style.transformOrigin = 'top left';
        const inverseZoom = 1 / currentZoom;
        viewportsContainer.style.width = `${inverseZoom * 100}%`;
        viewportsContainer.style.height = `${inverseZoom * 100}%`;
    }

    // Update URL parameters
    updateUrlParams();
}

// Remove a viewport
function removeViewport(index) {
    // Remove from array
    viewports.splice(index, 1);

    // Recreate all viewports to maintain correct indices
    const container = document.getElementById('viewports-container');
    container.innerHTML = '';

    if (viewports.length === 0) {
        container.innerHTML = '<p style="color: #a0a0a0; text-align: center; width: 100%;">No devices selected. Click "Add Device" to add viewports.</p>';
    } else {
        viewports.forEach((device, idx) => {
            const viewportElement = createViewportElement(device, idx);
            container.appendChild(viewportElement);
        });
    }

    // Reapply zoom
    const viewportsContainer = document.getElementById('viewports-container');
    if (currentZoom !== 1.0) {
        viewportsContainer.style.transform = `scale(${currentZoom})`;
        viewportsContainer.style.transformOrigin = 'top left';
        const inverseZoom = 1 / currentZoom;
        viewportsContainer.style.width = `${inverseZoom * 100}%`;
        viewportsContainer.style.height = `${inverseZoom * 100}%`;
    }

    // Update URL parameters
    updateUrlParams();
}

// Update URL parameters to reflect current devices
function updateUrlParams() {
    const params = new URLSearchParams(window.location.search);
    params.set('devices', encodeURIComponent(JSON.stringify(viewports)));
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    history.replaceState(null, '', newUrl);
}
