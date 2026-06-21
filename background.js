// Background script — header stripping + screenshot capture
console.log('Codex Dev: Background script loaded');

// ── Declarative rules for iframe embedding ──────────────────────────
const rules = [
    {
        id: 1, priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'X-Frame-Options', operation: 'remove' }, { header: 'Frame-Options', operation: 'remove' }] },
        condition: { resourceTypes: ['sub_frame'], urlFilter: '*' }
    },
    {
        id: 2, priority: 1,
        action: { type: 'modifyHeaders', responseHeaders: [{ header: 'Content-Security-Policy', operation: 'remove' }] },
        condition: { resourceTypes: ['sub_frame'], urlFilter: '*' }
    }
];

chrome.runtime.onInstalled.addListener(() => {
    chrome.declarativeNetRequest.updateDynamicRules(
        { removeRuleIds: rules.map(r => r.id), addRules: rules },
        () => { if (chrome.runtime.lastError) console.error('Rules error:', chrome.runtime.lastError); }
    );
});

// ── Message handler ──────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // ── UA Spoofing ──────────────────────────────────────────────────
    if (message.type === 'SET_USER_AGENT') {
        updateUserAgentRule(message.value);

    // ── Link Checker ─────────────────────────────────────────────────
    } else if (message.type === 'CHECK_LINK') {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        fetch(message.url, { method: 'HEAD', credentials: 'omit', signal: ctrl.signal })
            .then(r => { clearTimeout(t); sendResponse({ status: r.status, ok: r.ok }); })
            .catch(() => {
                const c2 = new AbortController(), t2 = setTimeout(() => c2.abort(), 8000);
                fetch(message.url, { method: 'GET', credentials: 'omit', signal: c2.signal })
                    .then(r => { clearTimeout(t2); sendResponse({ status: r.status, ok: r.ok }); })
                    .catch(err => { clearTimeout(t2); sendResponse({ status: 0, error: err.message }); });
            });
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

        // ── Step 4: Restore original scroll position ──────────────────
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
        try { sendResponse({ ok: false, error: e.message }); } catch(e2) {}
    }
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
function sendToTab(tabId, msg) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, msg, res => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(res);
        });
    });
}

function updateUserAgentRule(userAgent) {
    const ruleId = 999;
    if (!userAgent) {
        chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId], addRules: [] });
        return;
    }
    const rule = {
        id: ruleId, priority: 2,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: userAgent }] },
        condition: { urlFilter: '*', resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet'] }
    };
    chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [ruleId], addRules: [rule] },
        () => { if (chrome.runtime.lastError) console.error('UA rule error:', chrome.runtime.lastError); }
    );
}

