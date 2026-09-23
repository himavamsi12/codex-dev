// Device picker: grouped catalog, search, and a strip of the devices already
// in this tab. Clicking a tile toggles that device; the picker stays open so
// several devices can be added or removed in one go.

// Load all available devices from devices.js
function loadAllDevices() {
    allDevices = getAllDevices();
}

const PICKER_GROUPS = [
    { title: 'Apple phones', icon: 'brand-apple', match: d => d.category === 'mobile' && d.brand === 'apple' },
    { title: 'Android phones', icon: 'brand-android', match: d => d.category === 'mobile' && d.brand !== 'apple' },
    { title: 'iPads', icon: 'brand-apple', match: d => d.category === 'tablet' && d.brand === 'apple' },
    { title: 'Android and Windows tablets', icon: 'device-tablet', match: d => d.category === 'tablet' && d.brand !== 'apple' },
    { title: 'Laptops', icon: 'device-laptop', match: d => d.category === 'desktop' && d.frame === 'laptop' },
    { title: 'Desktops', icon: 'device-imac', match: d => d.category === 'desktop' && d.frame !== 'laptop' }
];

let pickerCategory = 'all';
let pickerQuery = '';

// Setup device selector modal
function setupDeviceSelector() {
    const addDeviceBtn = document.getElementById('add-device');
    const modal = document.getElementById('device-selector');
    const closeModalBtn = document.getElementById('close-modal');
    const doneBtn = document.getElementById('picker-done');
    const overlay = modal.querySelector('.device-selector-overlay');
    const categoryBtns = document.querySelectorAll('.category-btn');
    const searchInput = document.getElementById('device-search');
    const addCustomBtn = document.getElementById('add-custom-device');
    const customWidthInput = document.getElementById('custom-width');
    const customHeightInput = document.getElementById('custom-height');
    const customNameInput = document.getElementById('custom-name');

    function openPicker() {
        modal.classList.add('active');
        refreshDevicePicker();
        setTimeout(() => searchInput.focus(), 50);
    }
    function closePicker() {
        modal.classList.remove('active');
        addDeviceBtn.focus();
    }

    addDeviceBtn.addEventListener('click', openPicker);
    closeModalBtn.addEventListener('click', closePicker);
    doneBtn.addEventListener('click', closePicker);
    overlay.addEventListener('click', closePicker);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closePicker();
    });

    searchInput.addEventListener('input', () => {
        pickerQuery = searchInput.value.trim().toLowerCase();
        if (pickerCategory === 'custom') selectCategory('all');
        else renderDeviceGrid();
    });

    function selectCategory(category) {
        pickerCategory = category;
        categoryBtns.forEach(b => b.classList.toggle('active', b.dataset.category === category));
        const isCustom = category === 'custom';
        document.getElementById('custom-device-form').style.display = isCustom ? 'block' : 'none';
        document.getElementById('device-list-container').style.display = isCustom ? 'none' : 'block';
        if (!isCustom) renderDeviceGrid();
    }

    categoryBtns.forEach(btn => {
        btn.addEventListener('click', () => selectCategory(btn.dataset.category));
    });

    // Add custom device
    addCustomBtn.addEventListener('click', () => {
        const width = parseInt(customWidthInput.value);
        const height = parseInt(customHeightInput.value);
        const name = customNameInput.value.trim() || `Custom ${width}×${height}`;

        if (!width || !height || width < 100 || height < 100 || width > 4000 || height > 4000) {
            document.getElementById('custom-error').hidden = false;
            return;
        }
        document.getElementById('custom-error').hidden = true;

        addViewport({
            name: name,
            width: width,
            height: height,
            category: 'custom',
            icon: CodexIcons.svg('adjustments-horizontal', 24)
        });

        customWidthInput.value = '';
        customHeightInput.value = '';
        customNameInput.value = '';
    });
}

// Small outline of the device at its real aspect ratio (fits a 40×40 box).
function deviceSilhouette(device) {
    const box = 40;
    const ratio = device.width / device.height;
    const w = ratio <= 1 ? Math.max(12, Math.round(box * ratio)) : box;
    const h = ratio <= 1 ? box : Math.max(12, Math.round(box / ratio));
    const kind = DeviceFrames.PROFILES[DeviceFrames.profileKey(device)].kind;
    return `<span class="silhouette is-${kind}" style="width:${w}px;height:${h}px"></span>`;
}

function isInTab(device) {
    return viewports.some(v => v.name === device.name);
}

// Re-render both the "In this tab" strip and the grid (called after any change).
function refreshDevicePicker() {
    const modal = document.getElementById('device-selector');
    if (!modal || !modal.classList.contains('active')) return;
    renderCurrentStrip();
    if (pickerCategory !== 'custom') renderDeviceGrid();
}

function renderCurrentStrip() {
    const strip = document.getElementById('picker-current');
    strip.innerHTML = '';
    if (!viewports.length) {
        strip.innerHTML = '<span class="picker-empty">No devices yet. Pick some below.</span>';
        return;
    }
    viewports.forEach(device => {
        const chip = document.createElement('span');
        chip.className = 'picker-chip';
        chip.innerHTML = `${deviceSilhouette(device)}<span class="picker-chip-name"></span>
            <button class="picker-chip-remove">${CodexIcons.svg('x', 12)}</button>`;
        chip.querySelector('.picker-chip-name').textContent = device.name;
        const remove = chip.querySelector('.picker-chip-remove');
        remove.setAttribute('aria-label', 'Remove ' + device.name);
        remove.addEventListener('click', () => removeViewportByUid(device._uid));
        strip.appendChild(chip);
    });
}

function renderDeviceGrid() {
    const list = document.getElementById('device-list');
    list.innerHTML = '';

    const visible = allDevices.filter(d =>
        (pickerCategory === 'all' || d.category === pickerCategory) &&
        (!pickerQuery || d.name.toLowerCase().includes(pickerQuery)));

    if (!visible.length) {
        const empty = document.createElement('p');
        empty.className = 'picker-empty-state';
        empty.textContent = `No devices match "${pickerQuery}".`;
        list.appendChild(empty);
        return;
    }

    PICKER_GROUPS.forEach(group => {
        const devices = visible.filter(group.match);
        if (!devices.length) return;

        const section = document.createElement('section');
        section.className = 'picker-group';
        section.innerHTML = `<h4 class="picker-group-title">${CodexIcons.svg(group.icon, 15)}${group.title}<span class="picker-group-count">${devices.length}</span></h4>`;
        const grid = document.createElement('div');
        grid.className = 'picker-grid';

        devices.forEach(device => {
            const selected = isInTab(device);
            const tile = document.createElement('button');
            tile.type = 'button';
            tile.className = 'device-tile' + (selected ? ' is-selected' : '');
            tile.setAttribute('aria-pressed', String(selected));
            tile.title = `${device.name}, ${device.width}×${device.height}`;
            tile.innerHTML = `
                <span class="device-tile-check">${CodexIcons.svg('check', 12)}</span>
                <span class="device-tile-art">${deviceSilhouette(device)}</span>
                <span class="device-tile-name"></span>
                <span class="device-tile-size">${device.width}×${device.height}</span>`;
            tile.querySelector('.device-tile-name').textContent = device.name;
            tile.addEventListener('click', () => {
                const existing = viewports.find(v => v.name === device.name);
                if (existing) removeViewportByUid(existing._uid);
                else addViewport({ ...device });
            });
            grid.appendChild(tile);
        });

        section.appendChild(grid);
        list.appendChild(section);
    });
}

// Add a new viewport dynamically
function addViewport(device) {
    const container = document.getElementById('viewports-container');
    if (!viewports.length) container.innerHTML = ''; // drop the empty-state message

    viewports.push(device);
    const viewportElement = createViewportElement(device);
    container.appendChild(viewportElement);

    applyWorkspaceZoom(currentZoom);
    updateUrlParams();
    refreshDevicePicker();
}

// Keep the URL shareable and short: catalog devices by name, custom ones by size.
function updateUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const compact = viewports.map(d => ({ name: d.name, width: d.width, height: d.height, category: d.category }));
    params.set('devices', encodeURIComponent(JSON.stringify(compact)));
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}
