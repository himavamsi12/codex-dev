// Claude Code bridge (service worker side). See mcp-server/README.md.
//
// The extension dials OUT to the local MCP server over an authenticated
// WebSocket on 127.0.0.1; nothing listens inside the browser. Claude Code can
// only reach tabs the user explicitly authorized from the popup, and only
// through the fixed command set in HANDLERS below. There is no navigation
// (the one tab it may open is the extension's own Responsive Viewer, for the
// page of an already-authorized tab), no arbitrary script execution, and no
// cookie / storage access.
//
// Needs: tabs, scripting, debugger (emulation, screenshots, console and
// network diagnostics), storage and alarms (reconnect), all already granted
// except alarms. See mcp-server/README.md for why each is used.
(function (root) {
    'use strict';

    const PROTOCOL = 1;
    const DEFAULT_PORT = 17373;
    const CONFIG_KEY = 'mcpBridge';          // chrome.storage.local { enabled, port, token }
    const TABS_KEY = 'mcpAuthorizedTabs';    // chrome.storage.session { [tabId]: { origin } }
    const ALARM = 'codex-mcp-reconnect';
    const MAX_LOG = 200;
    const MAX_PATCH_BYTES = 20 * 1024;
    const MAX_SCREENSHOT_BASE64 = 8 * 1024 * 1024;
    const RESTRICTED = /^(chrome|chrome-extension|chrome-untrusted|devtools|edge|about|view-source|file):/i;
    const WEBSTORE = /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/i;

    let ws = null;
    let ready = false;
    let lastError = '';
    let retryMs = 1000;
    let retryTimer = null;
    let pingTimer = null;
    let connecting = false;
    let stopped = false;

    // tabId -> { events: {console:[], network:[]}, pending: Map(requestId -> info), emulation, attachedByUs }
    const sessions = new Map();

    const err = (code, message, hint) => Object.assign(new Error(message), { code, hint });

    // ── Config / authorization ─────────────────────────────────────────
    async function getConfig() {
        const { [CONFIG_KEY]: c } = await chrome.storage.local.get(CONFIG_KEY);
        return { enabled: !!(c && c.enabled), port: (c && +c.port) || DEFAULT_PORT, token: (c && c.token) || '' };
    }

    async function getTabs() {
        const { [TABS_KEY]: t } = await chrome.storage.session.get(TABS_KEY);
        return t || {};
    }
    const setTabs = tabs => chrome.storage.session.set({ [TABS_KEY]: tabs });

    function originOf(url) { try { return new URL(url).origin; } catch (e) { return null; } }
    function inaccessible(url) { return !url || RESTRICTED.test(url) || WEBSTORE.test(url); }

    // Strip query/hash everywhere a URL leaves the browser: they often carry tokens.
    function safeUrl(url) {
        try { const u = new URL(url); return u.origin + u.pathname + (u.search ? '?…' : ''); } catch (e) { return String(url || '').slice(0, 200); }
    }
    function redact(text) {
        return String(text == null ? '' : text).slice(0, 500)
            .replace(/\b(bearer|basic)\s+[\w.~+\/=-]{8,}/gi, '$1 [redacted]')
            .replace(/(token|apikey|api_key|secret|password|passwd|authorization|session|cookie)(["']?\s*[:=]\s*["']?)[^\s"',;&]{6,}/gi, '$1$2[redacted]')
            .replace(/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}/g, '[jwt-redacted]');
    }

    async function authorizeTab(tabId) {
        const tab = await chrome.tabs.get(tabId);
        if (inaccessible(tab.url)) throw err('page_inaccessible', 'Chrome does not allow extensions on this page.');
        const tabs = await getTabs();
        tabs[tabId] = { origin: originOf(tab.url) };
        await setTabs(tabs);
        let diagnostics = true;
        try { await ensureDebugger(tabId); } catch (e) { diagnostics = false; }
        return { tabId, origin: tabs[tabId].origin, diagnostics };
    }

    async function revokeTab(tabId) {
        const tabs = await getTabs();
        delete tabs[tabId];
        await setTabs(tabs);
        await releaseDebugger(tabId);
    }

    // The one gate every tab command passes through.
    async function resolveTab(tabId) {
        if (!Number.isInteger(tabId)) throw err('no_tab_selected', 'No tab selected. Call list_browser_tabs, then select_browser_tab.');
        const tabs = await getTabs();
        if (!tabs[tabId]) throw err('tab_not_authorized', 'This tab is not authorized for Claude Code.', 'In the browser, open Codex Dev and choose "Allow on this tab" in the Claude Code section.');
        let tab;
        try { tab = await chrome.tabs.get(tabId); } catch (e) {
            await revokeTab(tabId);
            throw err('tab_closed', 'The selected tab no longer exists.', 'Call list_browser_tabs and select another tab.');
        }
        if (inaccessible(tab.url)) throw err('page_inaccessible', 'The tab is on a page Chrome does not let extensions inspect.');
        if (originOf(tab.url) !== tabs[tabId].origin) {
            await revokeTab(tabId);
            throw err('tab_not_authorized', 'The tab navigated to a different site, so its authorization was removed.', 'Authorize the tab again from the Codex Dev popup.');
        }
        return tab;
    }

    // ── Debugger sessions (viewport emulation, screenshots, diagnostics) ──
    function dbg(tabId, method, params) {
        return new Promise((resolve, reject) => {
            chrome.debugger.sendCommand({ tabId }, method, params || {}, result => {
                const e = chrome.runtime.lastError;
                e ? reject(err('debugger_error', e.message)) : resolve(result);
            });
        });
    }

    function pushLog(list, entry) { list.push(entry); if (list.length > MAX_LOG) list.shift(); }

    async function ensureDebugger(tabId) {
        let s = sessions.get(tabId);
        if (s && s.attached) return s;
        s = s || { events: { console: [], network: [] }, pending: new Map(), emulation: null };
        await new Promise((resolve, reject) => {
            chrome.debugger.attach({ tabId }, '1.3', () => {
                const e = chrome.runtime.lastError;
                // "already attached" is fine when it was us (e.g. the Performance tool)
                if (e && !/already attached/i.test(e.message)) return reject(err('debugger_unavailable', e.message, 'Close other debuggers on this tab (DevTools may be using it) and retry.'));
                s.attachedByUs = !e;
                resolve();
            });
        });
        s.attached = true;
        sessions.set(tabId, s);
        await dbg(tabId, 'Page.enable');
        await dbg(tabId, 'Runtime.enable');
        await dbg(tabId, 'Log.enable');
        await dbg(tabId, 'Network.enable');
        return s;
    }

    async function releaseDebugger(tabId) {
        const s = sessions.get(tabId);
        sessions.delete(tabId);
        if (s && s.attached && s.attachedByUs) {
            try { await dbg(tabId, 'Emulation.clearDeviceMetricsOverride'); } catch (e) { }
            await new Promise(r => chrome.debugger.detach({ tabId }, () => { void chrome.runtime.lastError; r(); }));
        }
    }

    function onDebuggerEvent(source, method, params) {
        const s = sessions.get(source.tabId);
        if (!s) return;
        const ts = Date.now();
        if (method === 'Runtime.exceptionThrown') {
            const d = params.exceptionDetails || {};
            pushLog(s.events.console, {
                ts, level: 'error', kind: 'exception',
                message: redact((d.exception && (d.exception.description || d.exception.value)) || d.text),
                source: safeUrl(d.url || ''), line: d.lineNumber, column: d.columnNumber
            });
        } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'assert')) {
            pushLog(s.events.console, {
                ts, level: 'error', kind: 'console.' + params.type,
                message: redact((params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ')),
                source: params.stackTrace && params.stackTrace.callFrames[0] ? safeUrl(params.stackTrace.callFrames[0].url) : ''
            });
        } else if (method === 'Log.entryAdded' && (params.entry.level === 'error' || params.entry.level === 'warning')) {
            const e = params.entry;
            pushLog(s.events.console, { ts, level: e.level, kind: 'log.' + e.source, message: redact(e.text), source: safeUrl(e.url || '') });
        } else if (method === 'Network.requestWillBeSent') {
            s.pending.set(params.requestId, { url: params.request.url, method: params.request.method, type: params.type });
            if (s.pending.size > 500) s.pending.delete(s.pending.keys().next().value);
        } else if (method === 'Network.responseReceived') {
            const r = params.response;
            if (r.status >= 400) {
                pushLog(s.events.network, { ts, url: safeUrl(r.url), method: (s.pending.get(params.requestId) || {}).method, status: r.status, statusText: r.statusText, resourceType: params.type });
            }
        } else if (method === 'Network.loadingFailed') {
            const p = s.pending.get(params.requestId) || {};
            if (!params.canceled || params.blockedReason) {
                pushLog(s.events.network, { ts, url: safeUrl(p.url || ''), method: p.method, status: 0, errorText: params.errorText, blockedReason: params.blockedReason, resourceType: params.type });
            }
        }
    }

    // Viewport preview for the Design Inspector AI panel (user-initiated from the page,
    // not an MCP command). Uses the same emulation as the MCP tools and releases the
    // debugger again afterwards unless the tab is also authorized for Claude Code.
    async function panelViewport(tabId, width, height) {
        const tab = await chrome.tabs.get(tabId);
        if (inaccessible(tab.url)) throw err('page_inaccessible', 'Chrome does not allow this on the current page.');
        width = Math.round(width); height = Math.round(height);
        if (!(width >= 200 && width <= 7680 && height >= 200 && height <= 4320)) throw err('bad_request', 'Viewport size out of range.');
        const s = await ensureDebugger(tabId);
        const mobile = width < 768;
        await dbg(tabId, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
        s.emulation = { width, height, deviceScaleFactor: 1, mobile };
        return { width, height };
    }

    async function panelResetViewport(tabId) {
        const s = sessions.get(tabId);
        if (!s) return;
        try { await dbg(tabId, 'Emulation.clearDeviceMetricsOverride'); } catch (e) { }
        s.emulation = null;
        if (!(await getTabs())[tabId]) await releaseDebugger(tabId);
    }

    // ── Command handlers ───────────────────────────────────────────────
    // Finds the viewer for the authorized tab's page (or opens one), focuses it, and
    // sends it one message. A new viewer needs a moment before it listens, so retry.
    async function viewerCall(tabId, devices, type, timeoutMs) {
        const tab = await resolveTab(tabId);
        const list = sanitizeViewerDevices(devices || []);
        if (!list.length && type === 'codex-viewer-add-devices') throw err('bad_request', 'No valid devices given.');
        const page = pageKey(tab.url);
        const viewerPrefix = chrome.runtime.getURL('viewer.html');
        let viewer = (await chrome.tabs.query({})).find(t => t.url && t.url.startsWith(viewerPrefix) && pageKey(viewerTarget(t.url)) === page);
        let opened = false;
        if (!viewer) {
            if (!list.length) throw err('bad_request', 'No viewer is open for this page.', 'Pass the devices to show.');
            const url = `${viewerPrefix}?devices=${encodeURIComponent(JSON.stringify(list))}&url=${encodeURIComponent(tab.url)}`;
            viewer = await chrome.tabs.create({ url, active: true, windowId: tab.windowId, index: tab.index + 1 });
            opened = true;
        } else {
            await chrome.tabs.update(viewer.id, { active: true });
        }
        try { await chrome.windows.update(viewer.windowId, { focused: true }); } catch (e) { /* window gone */ }

        const message = { type, viewerTabId: viewer.id, devices: list };
        const deadline = Date.now() + 15000;
        while (true) {
            try {
                const res = await Promise.race([
                    chrome.runtime.sendMessage(message),
                    new Promise((_, reject) => setTimeout(() => reject(err('timeout', 'The Responsive Viewer did not finish in time.')), timeoutMs)),
                ]);
                if (res && res.ok) return { viewerTabId: viewer.id, opened, res };
                if (res && res.error) throw err('viewer_error', res.error);
            } catch (e) {
                if (e.code) throw e;
                /* not listening yet */
            }
            if (Date.now() > deadline) throw err('viewer_unavailable', 'The Responsive Viewer did not respond.', 'Reload the viewer tab, then try again.');
            await new Promise(r => setTimeout(r, 400));
        }
    }

    // Viewer device lists come from Claude Code: keep only plain name/size/category.
    function sanitizeViewerDevices(devices) {
        if (!Array.isArray(devices)) return [];
        const sizeOk = n => Number.isInteger(n) && n >= 100 && n <= 4000;
        return devices.slice(0, 12)
            .filter(d => d && typeof d.name === 'string' && sizeOk(d.width) && sizeOk(d.height))
            .map(d => ({ name: d.name.slice(0, 60), width: d.width, height: d.height, category: ['mobile', 'tablet', 'desktop'].includes(d.category) ? d.category : 'custom' }));
    }

    // Page identity for matching a viewer to a tab: origin + path, no query or hash.
    function pageKey(url) { try { const u = new URL(url); return u.origin + u.pathname; } catch (e) { return null; } }
    function viewerTarget(viewerUrl) {
        try { return decodeURIComponent(new URL(viewerUrl).searchParams.get('url') || ''); } catch (e) { return ''; }
    }

    // Width/height from a base64 PNG's IHDR chunk (bytes 16-23), or null if it isn't a PNG.
    function pngSize(base64) {
        try {
            const b = atob(base64.slice(0, 32));
            if (b.charCodeAt(1) !== 0x50 || b.slice(12, 16) !== 'IHDR') return null;
            const u32 = i => ((b.charCodeAt(i) << 24) | (b.charCodeAt(i + 1) << 16) | (b.charCodeAt(i + 2) << 8) | b.charCodeAt(i + 3)) >>> 0;
            return { width: u32(16), height: u32(20) };
        } catch (e) { return null; }
    }

    async function runProbe(tabId, command, params) {
        const res = await chrome.scripting.executeScript({
            target: { tabId }, world: 'MAIN',
            func: root.CodexProbes.run, args: [command, params || {}]
        });
        const out = res && res[0] && res[0].result;
        if (!out) throw err('probe_failed', 'The page returned no result (it may be navigating).');
        if (out.error) throw err('probe_error', out.error);
        return out;
    }

    const PROBES = new Set(['waitStable', 'viewportInfo', 'audit', 'structure', 'inspect', 'styles', 'dimensions', 'typography', 'accessibility', 'spacing']);

    const DESIGN_ACTIONS = new Set(['select', 'context', 'patch', 'undo', 'reset', 'resetAll', 'export']);

    // Runs in the page (isolated world, where design-ai/engine.js was just loaded).
    function designCall(action, p) {
        const E = window.CodexDesignEngine;
        if (!E) return { ok: false, code: 'design_unavailable', error: 'The design engine could not be loaded on this page.' };
        switch (action) {
            case 'select': return E.selectBySelector(String(p.selector || ''));
            case 'context': { const c = E.context(); return c ? { ok: true, context: c, summary: E.summary() } : { ok: false, code: 'no_target', error: 'No target section is selected (or it left the page).' }; }
            case 'patch': { const r = E.apply({ operations: p.operations }, String(p.label || 'MCP patch').slice(0, 80)); return r.ok ? { ok: true, changed: r.changed, summary: r.summary } : { ok: false, code: r.code, errors: r.errors }; }
            case 'undo': return { ok: true, undone: E.undo(), summary: E.summary() };
            case 'reset': return { ok: true, reset: E.reset(), summary: E.summary() };
            case 'resetAll': E.resetAll(); return { ok: true, summary: E.summary() };
            case 'export': return E.exportData({ framework: p.framework, important: p.important, includeHtml: p.includeHtml });
            default: return { ok: false, code: 'bad_request', error: 'Unknown design action.' };
        }
    }

    const HANDLERS = {
        async status() {
            const cfg = await getConfig();
            const tabs = await getTabs();
            return { protocol: PROTOCOL, extensionVersion: chrome.runtime.getManifest().version, authorizedTabs: Object.keys(tabs).length, enabled: cfg.enabled };
        },

        async list_tabs() {
            const authorized = await getTabs();
            const out = [];
            for (const id of Object.keys(authorized)) {
                try {
                    const t = await chrome.tabs.get(+id);
                    if (originOf(t.url) !== authorized[id].origin) { await revokeTab(+id); continue; }
                    const s = sessions.get(+id);
                    out.push({ tabId: t.id, title: String(t.title || '').slice(0, 120), url: safeUrl(t.url), active: !!t.active, windowId: t.windowId, diagnostics: !!(s && s.attached), emulation: s && s.emulation });
                } catch (e) { await revokeTab(+id); }
            }
            return { tabs: out };
        },

        async validate_tab({ tabId }) {
            const tab = await resolveTab(tabId);
            const s = sessions.get(tabId);
            return { tabId, title: String(tab.title || '').slice(0, 120), url: safeUrl(tab.url), diagnostics: !!(s && s.attached), emulation: s && s.emulation };
        },

        async set_viewport({ tabId, width, height, deviceScaleFactor, mobile, reset }) {
            await resolveTab(tabId);
            const s = await ensureDebugger(tabId);
            if (reset) {
                await dbg(tabId, 'Emulation.clearDeviceMetricsOverride');
                s.emulation = null;
                return { emulation: null, note: 'Viewport restored to the real browser window.' };
            }
            const m = mobile === undefined ? width < 768 : !!mobile;
            await dbg(tabId, 'Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: deviceScaleFactor || 1, mobile: m, screenWidth: width, screenHeight: height });
            s.emulation = { width, height, deviceScaleFactor: deviceScaleFactor || 1, mobile: m };
            return { emulation: s.emulation };
        },

        async probe({ tabId, probe, params }) {
            if (!PROBES.has(probe)) throw err('bad_request', 'Unknown probe.');
            await resolveTab(tabId);
            return runProbe(tabId, probe, params);
        },

        async apply_patch({ tabId, id, css }) {
            await resolveTab(tabId);
            validatePatch(css);
            return runProbe(tabId, 'patch', { id, css });
        },

        async clear_patch({ tabId, id }) {
            await resolveTab(tabId);
            return runProbe(tabId, 'clearPatch', { id });
        },

        async screenshot({ tabId, fullPage, scale, maxHeight }) {
            await resolveTab(tabId);
            await ensureDebugger(tabId);
            const metrics = await dbg(tabId, 'Page.getLayoutMetrics');
            const vp = metrics.cssVisualViewport || metrics.visualViewport;
            const content = metrics.cssContentSize || metrics.contentSize;
            const width = Math.round(fullPage ? Math.max(vp.clientWidth, Math.min(content.width, 4000)) : vp.clientWidth);
            const height = Math.round(fullPage ? Math.min(content.height, maxHeight || 8000) : vp.clientHeight);
            const params = { format: 'png', captureBeyondViewport: !!fullPage, fromSurface: true };
            if (fullPage || scale) params.clip = { x: 0, y: 0, width, height, scale: scale || 1 };
            const shot = await dbg(tabId, 'Page.captureScreenshot', params);
            if (shot.data.length > MAX_SCREENSHOT_BASE64) throw err('too_large', 'Screenshot exceeds the 8 MB limit.', 'Lower scale, or capture the visible viewport instead of the full page.');
            // Report the PNG's real pixel size: the capture includes the device pixel ratio,
            // so CSS size × scale undercounts on HiDPI and emulated mobile viewports.
            const size = pngSize(shot.data) || { width: Math.round(width * (scale || 1)), height: Math.round(height * (scale || 1)) };
            return { format: 'png', base64: shot.data, width: size.width, height: size.height, cssWidth: width, cssHeight: height, fullPage: !!fullPage };
        },

        async diagnostics({ tabId, kind, limit, sinceTs }) {
            await resolveTab(tabId);
            const s = sessions.get(tabId);
            if (!s || !s.attached) {
                throw err('diagnostics_unavailable', 'Console and network capture is not running for this tab.', 'Re-authorize the tab from the Codex Dev popup (this attaches the debugger), then reload the page.');
            }
            const list = (kind === 'network' ? s.events.network : s.events.console).filter(e => !sinceTs || e.ts > sinceTs);
            return { kind, entries: list.slice(-Math.min(limit || 50, MAX_LOG)), total: list.length, note: 'Only events since the tab was authorized (or last reloaded through Codex Dev) are available.' };
        },

        // Design Inspector AI section preview (see design-ai/). Structured, validated
        // operations only: no CSS text, no selectors beyond picking the target, no script.
        async design({ tabId, action, params }) {
            if (!DESIGN_ACTIONS.has(action)) throw err('bad_request', 'Unknown design action.');
            await resolveTab(tabId);
            await chrome.scripting.executeScript({ target: { tabId }, files: ['design-ai/core.js', 'design-ai/provider.js', 'design-ai/engine.js'] });
            const res = await chrome.scripting.executeScript({ target: { tabId }, func: designCall, args: [action, params || {}] });
            const out = res && res[0] && res[0].result;
            if (!out) throw err('probe_failed', 'The page returned no result (it may be navigating).');
            if (out.ok === false) throw err(out.code || 'design_error', String(out.error || (out.errors && out.errors[0]) || 'Design action failed.').slice(0, 300));
            return out;
        },

        // The Responsive Viewer's device catalog (devices.js, loaded by background.js).
        async devices() {
            const all = typeof getAllDevices === 'function' ? getAllDevices() : [];
            return { devices: all.map(d => ({ name: d.name, width: d.width, height: d.height, category: d.category, brand: d.brand })) };
        },

        // Popular Mix: the user's default devices (popular-mix.js), shared with Quick Launch.
        async popular_mix_get() {
            return getPopularMix();
        },

        async popular_mix_set({ devices }) {
            return savePopularMix(Array.isArray(devices) ? devices : []);
        },

        // Shows devices in the Responsive Viewer for the authorized tab's page (an open
        // viewer on that page, or a new one) and brings it to the front.
        async viewer_add_devices({ tabId, devices }) {
            const v = await viewerCall(tabId, devices, 'codex-viewer-add-devices', 15000);
            return { viewerTabId: v.viewerTabId, opened: v.opened, added: v.res.added, alreadyShown: v.res.alreadyShown, devicesInViewer: v.res.total };
        },

        // Runs the viewer's own audit inside every device frame, so the user's tab is
        // never resized. The audit drawer opens, showing the same issues and pins.
        async viewer_audit({ tabId, devices }) {
            const v = await viewerCall(tabId, devices, 'codex-viewer-audit', 90000);
            return { viewerTabId: v.viewerTabId, opened: v.opened, added: v.res.added, ...v.res.result };
        },

        async reload({ tabId }) {
            await resolveTab(tabId);
            const s = await ensureDebugger(tabId);
            s.events.console.length = 0; s.events.network.length = 0; s.pending.clear();
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpd); reject(err('timeout', 'The page did not finish loading within 30s.')); }, 30000);
                function onUpd(id, info) {
                    if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(onUpd); resolve(); }
                }
                chrome.tabs.onUpdated.addListener(onUpd);
                chrome.tabs.reload(tabId, { bypassCache: false });
            });
            return { reloaded: true };
        }
    };

    function validatePatch(css) {
        if (typeof css !== 'string' || !css.trim()) throw err('bad_request', 'CSS patch is empty.');
        if (new TextEncoder().encode(css).length > MAX_PATCH_BYTES) throw err('bad_request', 'CSS patch is larger than 20 KB.');
        if (/@import|<\/?style|javascript:|expression\s*\(|behavior\s*:|-moz-binding/i.test(css)) throw err('bad_request', 'CSS patch contains a forbidden construct (@import, markup, or script URL).');
        if (/url\(\s*['"]?\s*(https?:|\/\/)/i.test(css)) throw err('bad_request', 'External url() references are not allowed in previews.');
    }

    // ── Connection ─────────────────────────────────────────────────────
    async function handleRequest(msg) {
        const reply = (ok, body) => {
            if (ws && ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ type: 'response', id: msg.id, ok }, body)));
        };
        try {
            if (typeof msg.id !== 'string' || msg.id.length > 64 || typeof msg.command !== 'string' || !Object.prototype.hasOwnProperty.call(HANDLERS, msg.command)) {
                throw err('bad_request', 'Unknown or malformed command.');
            }
            const params = msg.params && typeof msg.params === 'object' && !Array.isArray(msg.params) ? msg.params : {};
            reply(true, { result: await HANDLERS[msg.command](params) });
        } catch (e) {
            reply(false, { error: { code: e.code || 'extension_error', message: String(e.message || e).slice(0, 400), hint: e.hint } });
        }
    }

    function scheduleReconnect() {
        if (stopped) return;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
    }

    function teardownSocket() {
        ready = false;
        clearInterval(pingTimer);
        if (ws) { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; try { ws.close(); } catch (e) { } }
        ws = null;
    }

    async function connect() {
        if (stopped || connecting || (ws && ws.readyState <= 1)) return;
        const cfg = await getConfig();
        if (!cfg.enabled || !cfg.token) { lastError = cfg.enabled ? 'No pairing token set.' : ''; return; }
        connecting = true;
        try {
            ws = new WebSocket('ws://127.0.0.1:' + cfg.port + '/bridge');
        } catch (e) {
            lastError = e.message; connecting = false; scheduleReconnect(); return;
        }
        const sock = ws;
        sock.onopen = () => {
            connecting = false;
            sock.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, token: cfg.token, extensionVersion: chrome.runtime.getManifest().version }));
        };
        sock.onmessage = ev => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'welcome') { ready = true; lastError = ''; retryMs = 1000; clearInterval(pingTimer); pingTimer = setInterval(() => { if (sock.readyState === 1) sock.send('{"type":"ping"}'); }, 20000); }
            else if (msg.type === 'request' && ready) handleRequest(msg);
            else if (msg.type === 'error') lastError = String(msg.message || 'Server rejected the connection.').slice(0, 200);
        };
        sock.onclose = ev => {
            connecting = false;
            if (ws === sock) { teardownSocket(); }
            if (ev && ev.code === 4401) lastError = 'The server rejected the pairing token.';
            else if (!lastError) lastError = 'Could not reach the MCP server on 127.0.0.1.';
            scheduleReconnect();
        };
        sock.onerror = () => { /* onclose follows */ };
    }

    // Stops the bridge for good (tests); normal disable goes through applyConfig.
    function shutdown() {
        stopped = true;
        disconnect();
    }

    // One-time pairing: present the 6-digit code from codex_dev_connect and keep
    // the long-lived token the server hands back. Never retried automatically.
    function pairWith(port, code) {
        return new Promise((resolve, reject) => {
            let sock, done = false;
            const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); try { sock.onclose = sock.onmessage = null; sock.close(); } catch (e) { } fn(v); };
            const timer = setTimeout(() => finish(reject, err('pair_timeout', 'The MCP server did not answer. Is Claude Code running with codex-dev registered?')), 8000);
            try { sock = new WebSocket('ws://127.0.0.1:' + port + '/bridge'); } catch (e) { return finish(reject, err('pair_failed', e.message)); }
            sock.onopen = () => sock.send(JSON.stringify({ type: 'pair', protocol: PROTOCOL, code, extensionVersion: chrome.runtime.getManifest().version }));
            sock.onmessage = ev => {
                let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
                if (msg.type === 'paired' && typeof msg.token === 'string' && msg.token.length >= 16) finish(resolve, msg.token);
                else if (msg.type === 'error') finish(reject, err('pair_rejected', 'The code is wrong or expired. Ask Claude Code to run codex_dev_connect again.'));
            };
            sock.onclose = () => finish(reject, err('pair_rejected', 'The code is wrong or expired. Ask Claude Code to run codex_dev_connect again.'));
        });
    }

    function disconnect() {
        clearTimeout(retryTimer);
        teardownSocket();
        connecting = false;
    }

    async function applyConfig() {
        const cfg = await getConfig();
        disconnect();
        retryMs = 1000;
        lastError = '';
        if (cfg.enabled) await connect();
        else for (const id of [...sessions.keys()]) await releaseDebugger(id);
    }

    function popupStatus() {
        return getConfig().then(async cfg => ({
            enabled: cfg.enabled, port: cfg.port, hasToken: !!cfg.token,
            connected: ready, error: ready ? '' : lastError,
            authorizedTabs: Object.keys(await getTabs()).map(Number)
        }));
    }

    // Popup messages. Only extension pages (no sender.tab) may use these.
    function onMessage(message, sender, sendResponse) {
        if (!message || typeof message.action !== 'string' || message.action.indexOf('MCP_') !== 0) return false;
        if (sender.tab || sender.id !== chrome.runtime.id) { sendResponse({ ok: false, error: 'Not allowed.' }); return false; }
        (async () => {
            switch (message.action) {
                case 'MCP_STATUS': return Object.assign({ ok: true }, await popupStatus());
                case 'MCP_SAVE_CONFIG': {
                    const port = Math.round(+message.port);
                    if (!(port >= 1024 && port <= 65535)) return { ok: false, error: 'Port must be between 1024 and 65535.' };
                    const token = String(message.token || '').trim();
                    if (message.enabled && token.length < 16) return { ok: false, error: 'Enter the 6-digit code from Claude Code (or the token from "codex-dev-mcp token").' };
                    await chrome.storage.local.set({ [CONFIG_KEY]: { enabled: !!message.enabled, port, token } });
                    await applyConfig();
                    return Object.assign({ ok: true }, await popupStatus());
                }
                case 'MCP_PAIR': {
                    const port = Math.round(+message.port);
                    if (!(port >= 1024 && port <= 65535)) return { ok: false, error: 'Port must be between 1024 and 65535.' };
                    if (!/^\d{6}$/.test(String(message.code || '').trim())) return { ok: false, error: 'Enter the 6-digit code from Claude Code.' };
                    const token = await pairWith(port, String(message.code).trim());
                    await chrome.storage.local.set({ [CONFIG_KEY]: { enabled: true, port, token } });
                    disconnect(); stopped = false; retryMs = 1000; lastError = '';
                    await connect();
                    return Object.assign({ ok: true }, await popupStatus());
                }
                case 'MCP_AUTHORIZE_TAB': return Object.assign({ ok: true }, await authorizeTab(message.tabId));
                case 'MCP_REVOKE_TAB': await revokeTab(message.tabId); return { ok: true };
                default: return { ok: false, error: 'Unknown action.' };
            }
        })().then(sendResponse, e => sendResponse({ ok: false, error: e.message }));
        return true;
    }

    function init() {
        chrome.debugger.onEvent.addListener(onDebuggerEvent);
        chrome.debugger.onDetach.addListener(source => {
            const s = sessions.get(source.tabId);
            if (s) { s.attached = false; s.emulation = null; }
        });
        chrome.tabs.onRemoved.addListener(async tabId => {
            const tabs = await getTabs();
            if (tabs[tabId]) { delete tabs[tabId]; await setTabs(tabs); }
            sessions.delete(tabId);
        });
        chrome.runtime.onMessage.addListener(onMessage);
        chrome.alarms.create(ALARM, { periodInMinutes: 1 });
        chrome.alarms.onAlarm.addListener(a => { if (a.name === ALARM) connect(); });
        chrome.runtime.onStartup.addListener(connect);
        chrome.runtime.onInstalled.addListener(connect);
        connect();
    }

    root.CodexBridge = { init, shutdown, pairWith, panelViewport, panelResetViewport, applyConfig, authorizeTab, revokeTab, HANDLERS, handleRequest, validatePatch, redact, safeUrl, _state: () => ({ ready, lastError }) };
    if (!root.__codexBridgeNoAutoInit) init();
})(self);
