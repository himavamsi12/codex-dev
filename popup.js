// Populate device lists on popup load
document.addEventListener('DOMContentLoaded', () => {
    CodexIcons.hydrate();
    populateDeviceLists();
    attachEventListeners();
    setupTopLevelTabs();
    setupDeviceCategoryTabs();
    setupPopularMix();
    setupKeyboard();
});

// ── Keyboard ─────────────────────────────────────────────────────────
// Global shortcuts live in manifest.json "commands" (the user can rebind them
// at chrome://extensions/shortcuts); everything below works inside the popup.
function setupKeyboard() {
    const $ = id => document.getElementById(id);
    const container = document.querySelector('.popup-container');
    const openSheet = () => document.querySelector('.sheet:not([hidden])');
    const activeView = () => document.querySelector('.popup-view.active');
    const isTyping = el => el && (el.matches('input, textarea, select') || el.isContentEditable);
    const visible = el => el.offsetParent !== null && !el.disabled;

    // Number hints on the tools and presets, so the shortcuts are discoverable.
    const hint = (el, n) => {
        const k = document.createElement('kbd');
        k.className = 'row-key';
        k.textContent = n;
        k.setAttribute('aria-hidden', 'true');
        el.appendChild(k);
    };
    document.querySelectorAll('#view-tools .tool-list > .tool-row').forEach((row, i) => {
        if (i < 9) row.insertBefore(Object.assign(document.createElement('span'), { className: 'row-key-slot' }), row.querySelector('.tool-chevron'));
        if (i < 9) hint(row.querySelector('.row-key-slot'), i + 1);
        row.setAttribute('aria-keyshortcuts', String(i + 1));
    });
    document.querySelectorAll('#view-launch .preset-btn').forEach((btn, i) => {
        if (i < 9) hint(btn.querySelector('.preset-name'), i + 1);
        btn.setAttribute('aria-keyshortcuts', String(i + 1));
    });

    // Global shortcuts (manifest.json "commands"): the defaults for Windows/Linux
    // and Mac side by side, plus the key the user bound if they changed it.
    const GLOBAL = [
        { name: '_execute_action', label: 'Open Codex Dev', key: 'D' },
        { name: 'open-popular-mix', label: 'Open this page with your Popular Mix', key: 'V' },
        { name: 'toggle-inspector', label: 'Design Inspector on/off', key: 'I' },
    ];
    const isMac = /Mac/i.test(navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform);
    const keys = (...parts) => {
        const dt = document.createElement('dt');
        parts.forEach((p, i) => {
            if (i) dt.append('+');
            const k = document.createElement('kbd');
            k.textContent = p;
            dt.appendChild(k);
        });
        return dt;
    };
    chrome.commands.getAll(commands => {
        const dl = $('global-keys');
        const platform = (label, dt, current) => {
            const line = document.createElement('div');
            line.className = 'key-plat' + (current ? ' is-current' : '');
            line.append(Object.assign(document.createElement('span'), { textContent: label }), dt);
            return line;
        };
        GLOBAL.forEach(g => {
            const bound = (commands.find(c => c.name === g.name) || {}).shortcut || '';
            const row = document.createElement('div');
            row.className = 'key-row-global';
            const dd = document.createElement('dd');
            dd.textContent = g.label;
            const def = isMac ? '⌥⇧' + g.key : 'Alt+Shift+' + g.key;
            if (bound.replace(/\s/g, '') !== def) {
                const note = document.createElement('span');
                note.className = 'key-note';
                note.textContent = bound ? 'You set ' + bound : 'Not set on this computer';
                dd.appendChild(note);
            }
            row.append(dd, platform('Windows / Linux', keys('Alt', 'Shift', g.key), !isMac), platform('Mac', keys('⌥ Option', '⇧ Shift', g.key), isMac));
            dl.appendChild(row);
            if (g.name === 'toggle-inspector' && bound) $('inspector-key-hint').textContent = '. Press ' + bound;
        });
    });
    $('shortcuts-change').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

    const sheet = $('shortcuts-panel');
    const closeShortcuts = () => { sheet.hidden = true; container.classList.remove('sheet-open'); $('shortcuts-btn').focus(); };
    const toggleShortcuts = () => {
        if (!sheet.hidden) { closeShortcuts(); return; }
        const other = openSheet();
        if (other) other.querySelector('.sheet-header .icon-btn').click();
        sheet.hidden = false;
        container.classList.add('sheet-open');
        $('shortcuts-close').focus();
    };
    $('shortcuts-btn').addEventListener('click', toggleShortcuts);
    $('shortcuts-close').addEventListener('click', closeShortcuts);

    const OPENERS = { 'mix-panel': 'mix-edit', 'shortcuts-panel': 'shortcuts-btn', 'capture-panel': 'toggle-capture', 'mcp-panel': 'toggle-mcp' };

    function switchView(step) {
        const tabs = Array.from(document.querySelectorAll('.popup-tab'));
        const i = tabs.findIndex(t => t.classList.contains('active'));
        const next = tabs[(i + step + tabs.length) % tabs.length];
        next.click();
        next.focus();
    }

    function moveFocus(step) {
        const scope = openSheet() || activeView();
        const items = Array.from(scope.querySelectorAll('.tool-row, .preset-btn, .preset-edit, .device-cat-tab, .device-list.active .device-item, .mix-row input, .mix-chip-remove, input, button.custom-btn')).filter(visible);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        const next = items[i < 0 ? (step > 0 ? 0 : items.length - 1) : Math.min(items.length - 1, Math.max(0, i + step))];
        next.focus();
        next.scrollIntoView({ block: 'nearest' });
    }

    document.addEventListener('keydown', e => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
        const sheetOpen = openSheet();
        if (e.key === 'Escape') {
            if (isTyping(e.target) && e.target.value) return; // let the field clear itself first
            if (sheetOpen) {
                e.preventDefault();
                sheetOpen.querySelector('.sheet-header .icon-btn').click();
                // Focus must not stay in the hidden sheet (a hidden search box would swallow keys)
                const opener = $(OPENERS[sheetOpen.id]);
                if (sheetOpen.hidden && sheetOpen.contains(document.activeElement)) (opener && visible(opener) ? opener : document.body).focus();
            }
            return; // with nothing open, Chrome closes the popup
        }
        if (isTyping(e.target)) return;
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveFocus(e.key === 'ArrowDown' ? 1 : -1); return; }
        if (e.key === '?') { e.preventDefault(); toggleShortcuts(); return; }
        if (sheetOpen) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            if (e.target.classList && e.target.classList.contains('device-cat-tab')) return; // segmented control keeps its arrows
            e.preventDefault();
            switchView(e.key === 'ArrowRight' ? 1 : -1);
            return;
        }
        const view = activeView();
        if (/^[1-9]$/.test(e.key)) {
            const items = view.id === 'view-tools' ? view.querySelectorAll('.tool-list > .tool-row') : view.querySelectorAll('.preset-btn');
            const item = items[Number(e.key) - 1];
            if (item) { e.preventDefault(); item.focus(); item.click(); }
            return;
        }
        if ((e.key === 'e' || e.key === 'E') && view.id === 'view-launch') { e.preventDefault(); $('mix-edit').click(); }
    });
}

// ── Popular Mix (popular-mix.js) ─────────────────────────────────────
// Quick Launch's first card. Claude Code reads and edits the same list over
// MCP, so the card and the editor re-render on every storage change.
function setupPopularMix() {
    const $ = id => document.getElementById(id);
    const panel = $('mix-panel');
    const container = document.querySelector('.popup-container');
    let current = [];

    function summary(devices) {
        if (devices.length <= 2) return devices.map(d => d.name).join(', ');
        const words = { mobile: ['phone', 'phones'], tablet: ['tablet', 'tablets'], desktop: ['desktop', 'desktops'], custom: ['custom size', 'custom sizes'] };
        const counts = {};
        devices.forEach(d => { counts[d.category] = (counts[d.category] || 0) + 1; });
        return Object.keys(words).filter(c => counts[c]).map(c => counts[c] + ' ' + words[c][counts[c] > 1 ? 1 : 0]).join(', ');
    }

    function setStatus(msg, isError) {
        const st = $('mix-status');
        st.textContent = msg || '';
        st.classList.toggle('is-error', !!isError);
    }

    async function save(list) {
        if (!list.length) { setStatus('Keep at least one device, or use Reset to default.', true); return; }
        const res = await savePopularMix(list);
        render(res);
        setStatus('Saved.');
    }

    function renderChips() {
        const ul = $('mix-chips');
        ul.textContent = '';
        current.forEach(d => {
            const li = document.createElement('li');
            li.className = 'mix-chip';
            const label = document.createElement('span');
            label.textContent = d.name;
            const size = document.createElement('span');
            size.className = 'mix-chip-size';
            size.textContent = d.width + '×' + d.height;
            const rm = document.createElement('button');
            rm.type = 'button';
            rm.className = 'mix-chip-remove';
            rm.setAttribute('aria-label', 'Remove ' + d.name);
            rm.innerHTML = CodexIcons.svg('x', 12);
            rm.addEventListener('click', () => save(current.filter(x => x.name !== d.name)));
            li.append(label, size, rm);
            ul.appendChild(li);
        });
        $('mix-count').textContent = 'Your devices (' + current.length + ')';
    }

    function renderList() {
        const list = $('mix-list');
        const q = $('mix-search').value.toLowerCase().replace(/[^a-z0-9]+/g, '');
        list.textContent = '';
        const groups = { mobile: 'Phones', tablet: 'Tablets', desktop: 'Desktops' };
        Object.keys(groups).forEach(cat => {
            const items = getDevicesByCategory(cat).filter(d => !q || d.name.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(q));
            if (!items.length) return;
            const head = document.createElement('div');
            head.className = 'device-group-label';
            head.textContent = groups[cat];
            list.appendChild(head);
            items.forEach(d => {
                const row = document.createElement('label');
                row.className = 'mix-row';
                const box = document.createElement('input');
                box.type = 'checkbox';
                box.checked = current.some(x => x.name === d.name);
                box.disabled = !box.checked && current.length >= POPULAR_MIX_MAX;
                box.addEventListener('change', () => save(box.checked ? current.concat([d]) : current.filter(x => x.name !== d.name)));
                const name = document.createElement('span');
                name.className = 'mix-row-name';
                name.textContent = d.name;
                const size = document.createElement('span');
                size.className = 'mix-chip-size';
                size.textContent = d.width + '×' + d.height;
                row.append(box, name, size);
                list.appendChild(row);
            });
        });
        if (!list.childElementCount) list.textContent = 'No devices match.';
    }

    function render(mix) {
        current = mix.devices;
        $('mix-meta').textContent = summary(current) + (mix.isDefault ? '' : ' · yours');
        $('mix-reset').disabled = mix.isDefault;
        if (!panel.hidden) { renderChips(); renderList(); }
    }

    const close = () => { panel.hidden = true; container.classList.remove('sheet-open'); setStatus(''); };
    $('mix-launch').addEventListener('click', async () => launchViewer((await getPopularMix()).devices));
    $('mix-edit').addEventListener('click', async () => {
        panel.hidden = false;
        container.classList.add('sheet-open');
        $('mix-search').value = '';
        render(await getPopularMix());
        $('mix-search').focus();
    });
    $('mix-close').addEventListener('click', close);
    $('mix-search').addEventListener('input', renderList);
    $('mix-reset').addEventListener('click', async () => { render(await savePopularMix([])); setStatus('Back to iPhone 14 Pro, iPad Air and Desktop.'); });
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[POPULAR_MIX_KEY]) getPopularMix().then(render);
    });
    getPopularMix().then(render);
}

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
    // Reachable and openable from the keyboard like the buttons around it
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launchViewer([device]); }
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

    // ── Capture Tool ──────────────────────────────────────────────────
    const captureBtn = document.getElementById('toggle-capture');
    if (captureBtn) {
        captureBtn.addEventListener('click', () => {
            showCapturePanel();
        });
    }

    const mcpBtn = document.getElementById('toggle-mcp');
    if (mcpBtn) mcpBtn.addEventListener('click', showMcpPanel);

    // ── Feedback Tool ─────────────────────────────────────────────
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


// ── Claude Code bridge sheet ──────────────────────────────────────
function showMcpPanel() {
    const panel = document.getElementById('mcp-panel');
    const container = document.querySelector('.popup-container');
    const close = () => { panel.hidden = true; container.classList.remove('sheet-open'); };
    if (!panel.hidden) { close(); return; }
    panel.hidden = false;
    container.classList.add('sheet-open');

    const $ = id => document.getElementById(id);
    const send = msg => new Promise(resolve => chrome.runtime.sendMessage(msg, res => resolve(res || { ok: false, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No response.' })));
    let enabled = false, tabId = null, tabAllowed = false;

    function setStatus(msg, isError) { const s = $('mcp-status'); s.textContent = msg; s.classList.toggle('is-error', !!isError); }

    function render(st) {
        enabled = st.enabled;
        $('mcp-port').value = st.port;
        $('mcp-toggle').textContent = enabled ? 'Disconnect' : 'Connect';
        $('mcp-dot').className = 'mcp-dot' + (st.connected ? ' is-on' : enabled ? ' is-wait' : '');
        $('mcp-dot').title = st.connected ? 'Connected' : enabled ? 'Waiting for the MCP server' : 'Off';
        tabAllowed = tabId != null && st.authorizedTabs.includes(tabId);
        $('mcp-tab-toggle').textContent = tabAllowed ? 'Revoke access for this tab' : 'Allow on this tab';
        setStatus(st.connected ? 'Connected to the MCP server.' : st.error || (enabled ? 'Waiting for the MCP server…' : ''), !st.connected && !!st.error);
    }

    async function refresh() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = tab ? tab.id : null;
        const st = await send({ action: 'MCP_STATUS' });
        if (st.ok) render(st);
    }

    if (!panel.dataset.bound) {
        panel.dataset.bound = '1';
        panel.querySelectorAll('.mcp-copy').forEach(btn => btn.addEventListener('click', async () => {
            const text = btn.previousElementSibling.textContent;
            try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; }
            catch (e) { btn.textContent = 'Press Ctrl+C'; }
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
        }));
        $('mcp-close').addEventListener('click', close);
        $('mcp-toggle').addEventListener('click', async () => {
            const entered = $('mcp-token').value.trim();
            let res;
            if (enabled) {
                res = await send({ action: 'MCP_SAVE_CONFIG', enabled: false, port: $('mcp-port').value, token: (await chrome.storage.local.get('mcpBridge')).mcpBridge?.token || '' });
            } else if (/^\d{6}$/.test(entered)) {
                setStatus('Pairing…');
                res = await send({ action: 'MCP_PAIR', port: $('mcp-port').value, code: entered });
            } else {
                // Already paired earlier (or a long token pasted): just turn it on
                const stored = (await chrome.storage.local.get('mcpBridge')).mcpBridge?.token || '';
                res = await send({ action: 'MCP_SAVE_CONFIG', enabled: true, port: $('mcp-port').value, token: entered || stored });
                if (!res.ok && !entered && !stored) res.error = 'Say "Connect Codex Dev" in Claude Code and enter the 6-digit code it gives you.';
            }
            if (!res.ok) return setStatus(res.error, true);
            $('mcp-token').value = '';
            render(res);
            setTimeout(refresh, 1200);
        });
        $('mcp-tab-toggle').addEventListener('click', async () => {
            if (tabId == null) return setStatus('No active tab.', true);
            const res = await send(tabAllowed ? { action: 'MCP_REVOKE_TAB', tabId } : { action: 'MCP_AUTHORIZE_TAB', tabId });
            if (!res.ok) return setStatus(res.error, true);
            await refresh();
            if (!tabAllowed) return;
            setStatus(res.diagnostics ? 'Tab allowed.' : 'Tab allowed, but the debugger could not attach, so console and network capture is off.', !res.diagnostics);
        });
    }
    refresh();
}
