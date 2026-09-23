// Background script — header stripping + screenshot capture
console.log('Codex Dev: Background script loaded');

// Codex AI engines (bring-your-own-key):
//   Claude: bundled Anthropic SDK + edit service (tools/ai-build) -> self.CodexAI
//   OpenAI: ai/openai-service.js -> self.CodexOpenAI (shares CodexAI's prompt)
importScripts('vendor/claude-service.js', 'ai/openai-service.js');

// ── Viewer-tab tracking ────────────────────────────────────────────
// Every rule below that used to apply globally (urlFilter: '*', no tab
// restriction) is now scoped to only the tab(s) the extension itself opened
// via viewer.html — never to the user's normal browsing.
const VIEWER_URL_PREFIX = chrome.runtime.getURL('viewer.html');
const viewerTabIds = new Set();
const uaByTab = new Map(); // tabId -> user agent string, in-memory only

function isViewerTab(tab) {
    return !!(tab && typeof tab.url === 'string' && tab.url.startsWith(VIEWER_URL_PREFIX));
}

chrome.tabs.onCreated.addListener(tab => {
    if (isViewerTab(tab)) registerViewerTab(tab.id);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url && isViewerTab(tab)) registerViewerTab(tabId);
});
chrome.tabs.onRemoved.addListener(tabId => {
    if (viewerTabIds.delete(tabId)) {
        uaByTab.delete(tabId);
        applyEmbedRules();
    }
});

function registerViewerTab(tabId) {
    if (viewerTabIds.has(tabId)) return;
    viewerTabIds.add(tabId);
    applyEmbedRules();
}

// ── Declarative rules for iframe embedding ──────────────────────────
// Strips X-Frame-Options / CSP only for sub_frame requests inside a
// tab this extension opened — not for every site the user visits.
function applyEmbedRules() {
    const tabIds = Array.from(viewerTabIds);
    if (tabIds.length === 0) {
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1, 2] });
        return;
    }
    const rules = [
        {
            id: 1, priority: 1,
            action: { type: 'modifyHeaders', responseHeaders: [{ header: 'X-Frame-Options', operation: 'remove' }, { header: 'Frame-Options', operation: 'remove' }] },
            condition: { resourceTypes: ['sub_frame'], tabIds }
        },
        {
            id: 2, priority: 1,
            action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Security-Policy', operation: 'remove' }] },
            condition: { resourceTypes: ['sub_frame'], tabIds }
        }
    ];
    chrome.declarativeNetRequest.updateDynamicRules(
        { removeRuleIds: [1, 2], addRules: rules },
        () => { if (chrome.runtime.lastError) console.error('Rules error:', chrome.runtime.lastError); }
    );
}

// ── Design Inspector ─────────────────────────────────────────────────
// Bundled in vendor/inspector (Apache-2.0, see its NOTICE). The toolbar is a
// web component, and custom elements only work in the page's own world, so
// everything below runs with world: 'MAIN'.
const INSPECTOR_DIR = 'vendor/inspector';

async function toggleInspector(tabId) {
    const target = { tabId };
    const [{ result: open }] = await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: () => !!document.querySelector('codex-inspector')
    });

    if (open) {
        await chrome.scripting.executeScript({
            target, world: 'MAIN',
            func: () => window.dispatchEvent(new CustomEvent('codex-ai:close'))
        });
        // Slide out, then remove (disconnectedCallback unbinds hotkeys and
        // clears every overlay it added to the page).
        await chrome.scripting.executeScript({
            target, world: 'MAIN',
            func: () => document.querySelectorAll('codex-inspector').forEach(node => {
                const done = () => { if (node.isConnected) node.remove(); };
                node.animate([{ transform: 'translateY(150%)', opacity: 0 }], { duration: 250, easing: 'ease-in' }).onfinish = done;
                setTimeout(done, 300);
            })
        });
        return { open: false };
    }

    // Page-level styles once per document (insertCSS would otherwise stack copies).
    const [{ result: needsCss }] = await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: () => {
            if (document.documentElement.hasAttribute('data-codex-inspector')) return false;
            document.documentElement.setAttribute('data-codex-inspector', '');
            return true;
        }
    });
    if (needsCss) await chrome.scripting.insertCSS({ target, files: [INSPECTOR_DIR + '/inspector.css'] });

    // Defines the elements; the bundle skips itself if they already exist.
    await chrome.scripting.executeScript({ target, world: 'MAIN', files: [INSPECTOR_DIR + '/inspector.js'] });
    await chrome.scripting.executeScript({
        target, world: 'MAIN',
        func: () => document.body.prepend(document.createElement('codex-inspector'))
    });
    // Codex AI chat panel (isolated world): opened by the toolbar's AI button
    await chrome.scripting.executeScript({ target, files: ['utils/icons.js', 'ai-panel.js'] });

    // Relay (isolated world, once per page): the toolbar fires
    // 'codex-inspector:exit' on Esc twice; page scripts can't reach the
    // extension directly, so this forwards it to open the popup.
    await chrome.scripting.executeScript({
        target,
        func: () => {
            if (window.__codexInspectorRelay) return;
            window.__codexInspectorRelay = true;
            window.addEventListener('codex-inspector:exit', () => {
                chrome.runtime.sendMessage({ action: 'INSPECTOR_EXITED' }).catch(() => {});
            });
        }
    });
    return { open: true };
}

// ── Codex AI ─────────────────────────────────────────────────────────
// Bring your own key: Codex AI runs on the user's own Anthropic (Claude) or
// OpenAI (ChatGPT models) API key, saved in Codex AI settings
// (chrome.storage.local 'codexAi'):
//   { provider: 'anthropic' | 'openai',
//     anthropic: { apiKey, model }, openai: { apiKey, model } }
// getAiAccess() is the single gate for AI features, so paid plans can plug
// in here later. API keys are only ever read here, never sent to pages.
const AI_ENGINES = {
    anthropic: { name: 'Anthropic', lib: () => CodexAI },
    openai: { name: 'OpenAI', lib: () => CodexOpenAI },
};

// Older versions stored a single Anthropic key as { apiKey, model }
function normalizeAiSettings(raw) {
    raw = raw || {};
    const out = {
        provider: raw.provider === 'openai' ? 'openai' : 'anthropic',
        anthropic: { ...(raw.anthropic || {}) },
        openai: { ...(raw.openai || {}) },
    };
    if (raw.apiKey && !out.anthropic.apiKey) out.anthropic = { apiKey: raw.apiKey, model: raw.model };
    return out;
}

async function getAiSettings() {
    const { codexAi } = await chrome.storage.local.get('codexAi');
    return normalizeAiSettings(codexAi);
}

async function getAiAccess() {
    const settings = await getAiSettings();
    const provider = settings.provider;
    const engine = AI_ENGINES[provider];
    const lib = engine.lib();
    const conf = settings[provider];
    const model = conf.model || lib.DEFAULT_MODEL;
    const known = lib.MODELS.find(m => m.id === model);
    return {
        enabled: !!conf.apiKey,
        reason: conf.apiKey ? null : 'no_key',
        provider, plan: 'byok', model,
        modelLabel: known ? known.label.replace(/ \(.*\)$/, '') : model,
        footer: `Runs on your ${engine.name} API key.`,
    };
}

async function handleAiEdit(message) {
    const access = await getAiAccess();
    if (!access.enabled) return { ok: false, error: { code: 'no_key', message: 'Add your Claude or OpenAI API key in Codex AI settings first.' } };

    // Requests are short design instructions, not documents
    const instruction = String(message.instruction || '');
    if (instruction.length > 2000) return { ok: false, error: { code: 'too_long', message: 'That request is too long. Describe the design change in a few sentences.' } };

    const settings = await getAiSettings();
    const lib = AI_ENGINES[access.provider].lib();
    try {
        return await lib.requestEdit({
            apiKey: settings[access.provider].apiKey,
            model: access.model,
            history: Array.isArray(message.history) ? message.history : [],
            context: String(message.context || ''),
            instruction,
            image: typeof message.image === 'string' && message.image.length < 8e6 ? message.image : null,
        });
    } catch (e) {
        console.warn('Codex AI:', e);
        return { ok: false, error: lib.describeError(e) };
    }
}

// Crop the visible tab to rect (CSS px) and shrink it to at most 1280px on
// the long edge as JPEG: plenty for Claude to judge a layout, cheap in tokens.
async function captureForAi(windowId, rect, dpr) {
    const shot = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 90 });
    const bitmap = await createImageBitmap(await (await fetch(shot)).blob());
    const ratio = bitmap.width / Math.max(1, (rect && rect.vw) || bitmap.width / (dpr || 1));
    const sx = Math.max(0, Math.round(rect.x * ratio)), sy = Math.max(0, Math.round(rect.y * ratio));
    const sw = Math.min(bitmap.width - sx, Math.round(rect.w * ratio)), sh = Math.min(bitmap.height - sy, Math.round(rect.h * ratio));
    if (sw < 8 || sh < 8) { bitmap.close(); return null; }
    const scale = Math.min(1, 1280 / Math.max(sw, sh));
    const canvas = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    canvas.getContext('2d').drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return 'data:image/jpeg;base64,' + btoa(bin);
}

function inspectorError(e) {
    const msg = (e && e.message) || String(e);
    return /cannot be scripted|Cannot access|chrome:\/\/|extensions gallery/i.test(msg)
        ? 'Chrome does not allow extensions on this page. Try a regular website.'
        : msg;
}

chrome.commands.onCommand.addListener(async command => {
    if (command !== 'toggle-inspector') return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) toggleInspector(tab.id).catch(e => console.warn('Inspector:', inspectorError(e)));
});

// ── Message handler ──────────────────────────────────────────────────
// ── Lottie helpers (Asset Extractor) ────────────────────────────────
// Downloads a candidate animation file. Plain JSON comes back as text;
// .lottie files (zip archives) as base64 for the page to unpack.
async function fetchLottie(url) {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return { ok: false, error: 'Invalid URL' }; }
    if (!/^https?:$/.test(parsed.protocol)) return { ok: false, error: 'Not a web URL' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const r = await fetch(parsed.href, { credentials: 'omit', signal: ctrl.signal });
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
        const size = +r.headers.get('content-length') || 0;
        if (size > 25 * 1024 * 1024) return { ok: false, error: 'Too large' };
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (bytes.length > 25 * 1024 * 1024) return { ok: false, error: 'Too large' };
        // "PK" = zip archive = dotLottie
        if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return { ok: true, kind: 'zip', base64: btoa(bin) };
        }
        return { ok: true, kind: 'json', text: new TextDecoder().decode(bytes) };
    } catch (err) {
        return { ok: false, error: err.message };
    } finally {
        clearTimeout(timer);
    }
}

// Runs in the page (MAIN world): reads animations from the page's own
// lottie-web instance, including ones bundled into the site's JavaScript
// when the library is exposed (window.lottie / bodymovin / Webflow).
function readPageLotties() {
    const libs = [];
    const add = l => { if (l && typeof l.getRegisteredAnimations === 'function' && libs.indexOf(l) === -1) libs.push(l); };
    try { add(window.lottie); } catch (e) { }
    try { add(window.bodymovin); } catch (e) { }
    try {
        const wf = window.Webflow && window.Webflow.require && window.Webflow.require('lottie');
        if (wf) { add(wf.lottie); add(wf); }
    } catch (e) { }
    const out = [], seen = new Set();
    libs.forEach(lib => {
        let anims = [];
        try { anims = lib.getRegisteredAnimations() || []; } catch (e) { }
        anims.forEach(a => {
            if (!a || seen.has(a) || !a.animationData) return;
            seen.add(a);
            let json;
            try { json = JSON.stringify(a.animationData); } catch (e) { return; }
            if (!json || json.length > 25 * 1024 * 1024) return;
            let path = '';
            try { if (a.path && a.fileName) path = new URL(a.path + a.fileName + '.json', location.href).href; } catch (e) { }
            out.push({ name: a.name || a.animationData.nm || '', path, json, frameUrl: location.href });
        });
    });
    return out;
}

// ── Link checker (SEO tool) ─────────────────────────────────────────
// Runs here rather than in the page so CORS doesn't turn every cross-site
// link into a false "error". Tries HEAD first; many servers mishandle HEAD
// (405, 404, 501...), so any failure is retried once with GET, reading only
// the headers.
async function checkLink(url) {
    let parsed;
    try { parsed = new URL(url); } catch (e) { return { status: 0, error: 'Invalid URL' }; }
    if (!/^https?:$/.test(parsed.protocol)) return { status: 0, error: 'Not a web link' };

    const attempt = async (method) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10000);
        try {
            const r = await fetch(parsed.href, { method, credentials: 'omit', cache: 'no-store', redirect: 'follow', signal: ctrl.signal });
            if (method === 'GET' && r.body) r.body.cancel().catch(() => {});
            return { status: r.status, ok: r.ok, redirected: r.redirected, finalUrl: r.url };
        } catch (err) {
            return { status: 0, timeout: err.name === 'AbortError', error: err.message };
        } finally {
            clearTimeout(timer);
        }
    };

    const head = await attempt('HEAD');
    if (head.status && head.status < 400) return head;
    const get = await attempt('GET');
    // Prefer whichever gave a real HTTP answer
    return get.status || !head.status ? get : head;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ── Codex AI (from the chat panel content script) ─────────────────
    if (message.action === 'AI_STATUS') {
        getAiAccess().then(sendResponse);
        return true;
    }
    if (message.action === 'AI_EDIT') {
        // Only content scripts in a tab may ask for edits
        if (!sender.tab) { sendResponse({ ok: false, error: { code: 'sender', message: 'Not allowed.' } }); return; }
        handleAiEdit(message).then(sendResponse);
        return true;
    }
    if (message.action === 'AI_CAPTURE') {
        // Screenshot of the selected area, sent to Claude with the request
        if (!sender.tab) { sendResponse({ image: null }); return; }
        captureForAi(sender.tab.windowId, message.rect, message.dpr)
            .then(image => sendResponse({ image }))
            .catch(() => sendResponse({ image: null }));
        return true;
    }
    if (message.action === 'AI_OPEN_SETTINGS') {
        chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
    }

    // Inspector closed with Esc twice: bring the Codex Dev popup back
    if (message.action === 'INSPECTOR_EXITED') {
        const windowId = sender.tab && sender.tab.windowId;
        chrome.action.openPopup(windowId ? { windowId } : {})
            .catch(e => console.warn('Could not open popup:', e.message));
        return;
    }

    if (message.action === 'TOGGLE_INSPECTOR') {
        toggleInspector(message.tabId)
            .then(res => sendResponse({ ok: true, ...res }))
            .catch(e => sendResponse({ ok: false, error: inspectorError(e) }));
        return true; // async response
    }

    // ── UA Spoofing ──────────────────────────────────────────────────
    if (message.type === 'SET_USER_AGENT') {
        const tabId = sender.tab && sender.tab.id;
        updateUserAgentRule(message.value, tabId);
        sendResponse({ ok: true });

    // ── Screenshot: raw visible-tab capture (caller crops itself) ────
    } else if (message.action === 'CAPTURE_VISIBLE_RAW') {
        chrome.tabs.captureVisibleTab(null, { format: 'png' })
            .then(dataUrl => sendResponse({ dataUrl }))
            .catch(err => sendResponse({ dataUrl: null, error: err.message }));
        return true;

    // ── Link Checker ─────────────────────────────────────────────────
    // ── Lottie (Asset Extractor) ─────────────────────────────────────
    } else if (message.action === 'FETCH_LOTTIE') {
        fetchLottie(message.url).then(sendResponse);
        return true;

    } else if (message.action === 'GET_LOTTIE_RUNTIME') {
        if (!sender.tab) { sendResponse({ animations: [] }); return; }
        chrome.scripting.executeScript({ target: { tabId: sender.tab.id, allFrames: true }, world: 'MAIN', func: readPageLotties })
            .then(results => sendResponse({ animations: results.flatMap(r => Array.isArray(r.result) ? r.result : []) }))
            .catch(() => sendResponse({ animations: [] }));
        return true;

    } else if (message.action === 'LOAD_LOTTIE_PLAYER') {
        if (!sender.tab) { sendResponse({ ok: false }); return; }
        chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: ['vendor/lottie/lottie_light.min.js'] })
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;

    } else if (message.action === 'GET_LOTTIE_LIB') {
        fetch(chrome.runtime.getURL('vendor/lottie/lottie_light.min.js'))
            .then(r => r.text())
            .then(text => sendResponse({ text }))
            .catch(() => sendResponse({ text: null }));
        return true;

    } else if (message.action === 'DOWNLOAD_ASSET') {
        // Single asset from the Asset Extractor
        let ok = false;
        try { ok = /^(https?|data):$/.test(new URL(message.url).protocol); } catch (e) { }
        if (!ok) { sendResponse({ ok: false, error: 'Unsupported URL' }); return; }
        const filename = String(message.filename || 'asset')
            .replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'asset';
        chrome.downloads.download({ url: message.url, filename: 'codex-assets/' + filename, conflictAction: 'uniquify' })
            .then(id => sendResponse({ ok: true, id }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;

    } else if (message.action === 'OPEN_FEEDBACK_REPORT') {
        // Only the feedback tool's own per-site storage keys
        if (typeof message.key !== 'string' || !/^codex_fb_/.test(message.key)) { sendResponse({ ok: false }); return; }
        const url = chrome.runtime.getURL('feedback-report.html') +
            '?key=' + encodeURIComponent(message.key) + '&page=' + encodeURIComponent(message.page || '');
        chrome.tabs.create({ url, index: sender.tab ? sender.tab.index + 1 : undefined })
            .then(() => sendResponse({ ok: true }))
            .catch(err => sendResponse({ ok: false, error: err.message }));
        return true;

    } else if (message.type === 'CHECK_LINK') {
        checkLink(message.url).then(sendResponse);
        return true;

    // ── CAPTURE: Visible Viewport ─────────────────────────────────────
    } else if (message.action === 'CAPTURE_VISIBLE') {
        captureVisible(sender.tab || null, message, sendResponse);
        return true;

    // ── CAPTURE: Full Page (scroll + stitch) ──────────────────────────
    } else if (message.action === 'CAPTURE_FULL_PAGE') {
        captureFullPage(message, sendResponse);
        return true;

    // ── CAPTURE: Area / Element crop ─────────────────────────────────
    } else if (message.action === 'DO_CAPTURE_AREA') {
        // Sent from content script after user selects area/element
        captureAndCrop(sender.tab.id, message.rect, message.dpr, message.format || 'png', sendResponse);
        return true;
        
    // ── CAPTURE: Return Element Screenshot Data URL ──────────────────
    } else if (message.action === 'GET_ELEMENT_SCREENSHOT') {
        captureRegionDataUrl(sender.tab.id, message.rect, message.dpr).then(dataUrl => {
            sendResponse({ dataUrl: dataUrl });
        }).catch(err => {
            sendResponse({ dataUrl: null, error: err.message });
        });
        return true;
    }
});

// ════════════════════════════════════════════════════════════════════
// CAPTURE VISIBLE
// ════════════════════════════════════════════════════════════════════
async function captureVisible(tab, msg, sendResponse) {
    try {
        const tabId = tab ? tab.id : (await getActiveTab()).id;
        const format = msg.format || 'png';
        const quality = format === 'png' ? undefined : 92;
        const dataUrl = await chrome.tabs.captureVisibleTab(null, {
            format: format === 'webp' ? 'webp' : (format === 'jpeg' ? 'jpeg' : 'png'),
            quality: quality
        });
        downloadDataUrl(dataUrl, 'codex-visible-' + timestamp() + '.' + format);
        sendResponse({ ok: true });
    } catch (e) {
        console.error('Capture visible error:', e);
        sendResponse({ ok: false, error: e.message });
    }
}

// ════════════════════════════════════════════════════════════════════
// CAPTURE FULL PAGE — scroll + stitch
// ════════════════════════════════════════════════════════════════════
async function captureFullPage(msg, sendResponse) {
    let tab;
    try {
        tab = await getActiveTab();
    } catch(e) {
        console.error('Full page: no active tab', e);
        return;
    }

    const format = msg.format || 'png';

    try {
        // ── Step 0: Pre-scroll once so lazy-loaded / scroll-animated content renders ──
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async () => {
                const wait = (ms) => new Promise(r => setTimeout(r, ms));
                const h = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
                for (let y = 0; y < h(); y += window.innerHeight) {
                    window.scrollTo({ top: y, behavior: 'instant' });
                    await wait(150);
                }
                window.scrollTo({ top: 0, behavior: 'instant' });
            }
        });
        await sleep(300);

        // ── Step 1: Get page dimensions directly via scripting ────────
        const dimResult = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => ({
                scrollWidth:  Math.max(document.body.scrollWidth,  document.documentElement.scrollWidth),
                scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                viewWidth:    window.innerWidth,
                viewHeight:   window.innerHeight,
                dpr:          window.devicePixelRatio || 1,
                currentY:     window.scrollY
            })
        });
        const dims = dimResult[0].result;
        const { scrollWidth, scrollHeight, viewWidth, viewHeight, dpr, currentY: savedScrollY } = dims;

        // ── Step 2: Scroll to top ──────────────────────────────────────
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => window.scrollTo({ top: 0, behavior: 'instant' })
        });
        await sleep(400);

        // ── Step 3: Capture strip by strip ────────────────────────────
        const strips = [];
        let y = 0;
        const step = viewHeight;

        while (y < scrollHeight) {
            // Scroll to position
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (scrollY) => window.scrollTo({ top: scrollY, behavior: 'instant' }),
                args: [y]
            });
            // Hide fixed/sticky overlays so they don't repeat in every strip.
            // First strip keeps top-anchored ones (e.g. the navbar) so it appears once.
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: hideFixedElements,
                args: [strips.length === 0]
            });
            // Wait for render + stay within Chrome's 2 captures/sec rate limit
            await sleep(700);

            const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });

            // Get actual scroll position (page may not scroll past max)
            const posResult = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => window.scrollY
            });
            const actualY = posResult[0].result;

            strips.push({ dataUrl, y: actualY, h: Math.min(step, scrollHeight - actualY) });

            if (y + step >= scrollHeight) break; // done
            y += step;
        }

        // ── Step 4: Restore hidden elements + original scroll position ─
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: restoreFixedElements
        });
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (sy) => window.scrollTo({ top: sy, behavior: 'instant' }),
            args: [savedScrollY]
        });

        // ── Step 5: Stitch all strips ─────────────────────────────────
        const stitched = await stitchStrips(strips, scrollWidth, scrollHeight, viewWidth, viewHeight, dpr, format);
        downloadDataUrl(stitched, 'codex-fullpage-' + timestamp() + '.' + format);

        try { sendResponse({ ok: true }); } catch(e) {} // popup may already be closed

    } catch (e) {
        console.error('Full page capture error:', e);
        chrome.scripting.executeScript({ target: { tabId: tab.id }, func: restoreFixedElements }).catch(() => {});
        try { sendResponse({ ok: false, error: e.message }); } catch(e2) {}
    }
}

// Injected into the page. Hides position:fixed/sticky elements (idempotent — re-run
// each strip to catch headers that only become fixed after scrolling).
// keepTop: on the first strip, leave elements anchored to the top half visible.
function hideFixedElements(keepTop) {
    const hidden = window.__codexHidden || (window.__codexHidden = []);
    for (const el of document.querySelectorAll('body *')) {
        if (el.hasAttribute('data-codex-hidden')) continue;
        const pos = getComputedStyle(el).position;
        if (pos !== 'fixed' && pos !== 'sticky') continue;
        if (keepTop && el.getBoundingClientRect().top < window.innerHeight / 2) continue;
        hidden.push({
            el,
            value: el.style.getPropertyValue('visibility'),
            priority: el.style.getPropertyPriority('visibility')
        });
        el.setAttribute('data-codex-hidden', '');
        el.style.setProperty('visibility', 'hidden', 'important');
    }
}

function restoreFixedElements() {
    for (const { el, value, priority } of window.__codexHidden || []) {
        el.style.setProperty('visibility', value, priority);
        el.removeAttribute('data-codex-hidden');
    }
    window.__codexHidden = [];
}


// ════════════════════════════════════════════════════════════════════
// CAPTURE AREA — crop from a visible-tab screenshot
// ════════════════════════════════════════════════════════════════════
async function captureAndCrop(tabId, rect, dpr, format, sendResponse) {
    try {
        const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
        const cropped = await cropImage(dataUrl, rect, dpr, format);
        downloadDataUrl(cropped, 'codex-capture-' + timestamp() + '.' + format);
        if (sendResponse) sendResponse({ ok: true });
    } catch (e) {
        console.error('Area capture error:', e);
        if (sendResponse) sendResponse({ ok: false, error: e.message });
    }
}

async function captureRegionDataUrl(tabId, rect, dpr) {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const cropped = await cropImage(dataUrl, rect, dpr, 'png');
    return cropped;
}

// ════════════════════════════════════════════════════════════════════
// IMAGE HELPERS — use OffscreenCanvas (available in service worker)
// ════════════════════════════════════════════════════════════════════
async function cropImage(dataUrl, rect, dpr, format) {
    const blob = await dataUrlToBlob(dataUrl);
    const bitmap = await createImageBitmap(blob);
    const sx = Math.round(rect.x * dpr), sy = Math.round(rect.y * dpr);
    const sw = Math.round(rect.w * dpr), sh = Math.round(rect.h * dpr);
    const canvas = new OffscreenCanvas(sw, sh);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
    bitmap.close();
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const outBlob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
    return blobToDataUrl(outBlob);
}

async function stitchStrips(strips, scrollWidth, scrollHeight, viewWidth, viewHeight, dpr, format) {
    const W = Math.round(scrollWidth * dpr);
    const H = Math.round(scrollHeight * dpr);
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d');

    for (const strip of strips) {
        const blob = await dataUrlToBlob(strip.dataUrl);
        const bm = await createImageBitmap(blob);
        // Each strip covers viewHeight on screen; we paste at strip.y * dpr
        const dy = Math.round(strip.y * dpr);
        const drawH = Math.round(strip.h * dpr);
        ctx.drawImage(bm, 0, 0, Math.round(viewWidth * dpr), drawH, 0, dy, Math.round(viewWidth * dpr), drawH);
        bm.close();
    }
    const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
    const outBlob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
    return blobToDataUrl(outBlob);
}

function dataUrlToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)[1];
    const binary = atob(parts[1]);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ════════════════════════════════════════════════════════════════════
// DOWNLOAD
// ════════════════════════════════════════════════════════════════════
function downloadDataUrl(dataUrl, filename) {
    chrome.downloads.download({ url: dataUrl, filename: filename, saveAs: false });
}

// ════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function timestamp() { return new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19); }
function getActiveTab() {
    return new Promise((resolve, reject) => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]) resolve(tabs[0]); else reject(new Error('No active tab'));
        });
    });
}
// Scoped to a single tab (the viewer tab that asked for it) — never global.
// The network-header rewrite and the in-page navigator.userAgent override
// both key off the same in-memory uaByTab map, so there is no async
// chrome.storage read on the critical path (that was the source of the
// old race between document_start and the page's own early scripts).
function updateUserAgentRule(userAgent, tabId) {
    const ruleId = 999;
    if (!tabId) return;

    if (!userAgent) {
        uaByTab.delete(tabId);
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId], addRules: [] });
        return;
    }

    uaByTab.set(tabId, userAgent);

    const rule = {
        id: ruleId, priority: 2,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: userAgent }] },
        condition: { tabIds: [tabId], resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet'] }
    };
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId], addRules: [rule] },
        () => { if (chrome.runtime.lastError) console.error('UA rule error:', chrome.runtime.lastError); }
    );
}

// ── Client-side navigator.userAgent override (replaces ua-spoof.js) ──
// Fires as early as webNavigation exposes (before the committed frame's own
// scripts run), and the UA value is already sitting in memory (uaByTab) —
// no async storage read needed, so there's nothing for page scripts to race.
chrome.webNavigation.onCommitted.addListener(details => {
    if (!viewerTabIds.has(details.tabId)) return;
    const ua = uaByTab.get(details.tabId);
    if (!ua) return;

    chrome.scripting.executeScript({
        target: { tabId: details.tabId, frameIds: [details.frameId] },
        world: 'MAIN',
        func: (uaValue) => {
            try {
                Object.defineProperty(navigator, 'userAgent', { get: () => uaValue, configurable: true });
                Object.defineProperty(navigator, 'platform', { get: () => uaValue.includes('iPhone') || uaValue.includes('iPad') ? 'iPhone' : navigator.platform, configurable: true });
                Object.defineProperty(navigator, 'vendor', { get: () => 'Apple Computer, Inc.', configurable: true });
            } catch (e) { /* redefining a non-configurable property on this page — ignore */ }
        },
        args: [ua]
    }).catch(() => { /* frame may have already navigated away */ });
});

