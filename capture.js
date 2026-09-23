(function () {
    'use strict';

    // ── Guard: prevent double-injection ──────────────────────────────
    if (window.__codexCaptureActive) {
        // Toggle off
        window.__codexCaptureActive = false;
        var old = document.getElementById('__codex_capture_overlay');
        if (old) old.remove();
        document.body.style.cursor = '';
        return;
    }

    // ── Toast ─────────────────────────────────────────────────────────
    // Delegates to the shared implementation (utils/codex-ui.js, injected
    // by popup.js before this file) so timing/font/easing stay in sync with
    // every other tool's toast instead of drifting independently.
    function toast(msg, dur) {
        if (window.CodexUI) { window.CodexUI.toast(msg, dur); return; }
        var old = document.getElementById('__cx_toast');
        if (old) old.remove();
        var el = document.createElement('div');
        el.id = '__cx_toast';
        el.textContent = msg;
        Object.assign(el.style, {
            position: 'fixed', bottom: '30px', left: '50%',
            transform: 'translateX(-50%) translateY(14px)',
            background: '#16171a', border: '1px solid rgba(255,255,255,0.12)',
            color: '#ececef', padding: '9px 16px', borderRadius: '10px',
            zIndex: '2147483647', fontFamily: 'system-ui,sans-serif',
            fontSize: '13px', fontWeight: '500',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.55)',
            transition: 'all 0.3s cubic-bezier(0.16,1,0.3,1)',
            opacity: '0', pointerEvents: 'none'
        });
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(function () {
            el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(14px)';
            setTimeout(function () { if (el.parentNode) el.remove(); }, 320);
        }, dur || 2500);
    }

    // ── Listen for commands from popup/background ─────────────────────
    // Full-page capture is handled entirely by background.js (it drives the
    // scroll+stitch itself via chrome.scripting.executeScript) — it never
    // messages this content script, so CAPTURE_FULL_PAGE/GET_PAGE_DIMENSIONS/
    // SCROLL_TO/RESTORE_SCROLL branches used to sit here calling a
    // captureFullPage() that was never defined in this file: a guaranteed
    // ReferenceError the moment this script was still resident on the page
    // (from a prior Select Area/Element use) when a Full Page capture ran.
    // Only the two capture modes this file actually implements are handled.
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.action === 'CAPTURE_SELECT_AREA') {
            startAreaSelect(msg.format || 'png');
            sendResponse({ ok: true });
        } else if (msg.action === 'CAPTURE_SELECT_ELEMENT') {
            startElementPicker(msg.format || 'png');
            sendResponse({ ok: true });
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // SELECT AREA — drag a box on the page (no blur, 4-mask cutout)
    // ═══════════════════════════════════════════════════════════════════
    function startAreaSelect(format) {
        window.__codexCaptureActive = true;
        toast('Drag to select an area to capture', 4000);

        // Root container — intercepts all mouse events but is itself invisible
        var overlay = document.createElement('div');
        overlay.id = '__codex_capture_overlay';
        Object.assign(overlay.style, {
            position: 'fixed', inset: '0', zIndex: '2147483645',
            cursor: 'crosshair'
            // NO background, NO blur — page stays perfectly clear
        });

        // 4 dark masks that will surround the selection (top/bottom/left/right)
        function makeMask() {
            var m = document.createElement('div');
            Object.assign(m.style, {
                position: 'fixed', background: 'rgba(0,0,0,0.55)',
                pointerEvents: 'none', zIndex: '2147483646', display: 'none'
            });
            return m;
        }
        var mTop = makeMask(), mBot = makeMask(), mLeft = makeMask(), mRight = makeMask();

        // Selection border box (sits above the masks)
        var box = document.createElement('div');
        Object.assign(box.style, {
            position: 'fixed', border: '2px solid #4FD1C5',
            boxShadow: '0 0 0 1px rgba(79,209,197,0.5)',
            display: 'none', pointerEvents: 'none',
            zIndex: '2147483647'
        });

        // Dimensions label
        var lbl = document.createElement('div');
        Object.assign(lbl.style, {
            position: 'fixed', background: '#4FD1C5', color: '#07201d',
            fontSize: '11px', fontWeight: '600', fontFamily: 'ui-monospace,monospace',
            padding: '2px 7px', borderRadius: '6px',
            display: 'none', pointerEvents: 'none', zIndex: '2147483647'
        });

        // Hint bar at top
        var hint = document.createElement('div');
        Object.assign(hint.style, {
            position: 'fixed', top: '12px', left: '50%',
            transform: 'translateX(-50%)',
            background: '#16171a', color: '#ececef',
            padding: '7px 14px', borderRadius: '10px', fontSize: '12px',
            fontFamily: 'system-ui,sans-serif', zIndex: '2147483647',
            pointerEvents: 'none', border: '1px solid rgba(255,255,255,0.12)',
            whiteSpace: 'nowrap'
        });
        hint.textContent = 'Drag to select · Press Esc to cancel';

        [overlay, mTop, mBot, mLeft, mRight, box, lbl, hint].forEach(function(el){ document.body.appendChild(el); });

        var startX, startY, dragging = false;
        var W = window.innerWidth, H = window.innerHeight;

        function updateMasks(x, y, w, h) {
            // TOP mask
            mTop.style.cssText    += ';display:block;left:0;top:0;width:' + W + 'px;height:' + y + 'px;';
            // BOTTOM mask
            mBot.style.cssText    += ';display:block;left:0;top:' + (y+h) + 'px;width:' + W + 'px;height:' + (H-y-h) + 'px;';
            // LEFT mask
            mLeft.style.cssText   += ';display:block;left:0;top:' + y + 'px;width:' + x + 'px;height:' + h + 'px;';
            // RIGHT mask
            mRight.style.cssText  += ';display:block;left:' + (x+w) + 'px;top:' + y + 'px;width:' + (W-x-w) + 'px;height:' + h + 'px;';
        }

        overlay.addEventListener('mousedown', function (e) {
            e.preventDefault();
            dragging = true;
            startX = e.clientX; startY = e.clientY;
            box.style.display = 'block'; lbl.style.display = 'block';
            [mTop, mBot, mLeft, mRight].forEach(function(m){ m.style.display='block'; });
        });

        overlay.addEventListener('mousemove', function (e) {
            if (!dragging) return;
            var x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
            var w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);

            box.style.left = x + 'px'; box.style.top = y + 'px';
            box.style.width = w + 'px'; box.style.height = h + 'px';

            // Label below selection box
            lbl.style.left = x + 'px';
            lbl.style.top  = (y + h + 4) + 'px';
            lbl.textContent = Math.round(w) + ' × ' + Math.round(h) + 'px';

            updateMasks(x, y, w, h);
        });

        overlay.addEventListener('mouseup', function (e) {
            if (!dragging) return;
            dragging = false;
            var x = Math.min(e.clientX, startX), y = Math.min(e.clientY, startY);
            var w = Math.abs(e.clientX - startX), h = Math.abs(e.clientY - startY);

            if (w < 10 || h < 10) { cleanup(); toast('Selection too small, try again.'); return; }

            // Hide overlay elements instantly before capturing so they don't appear in screenshot
            [overlay, box, lbl, hint, mTop, mBot, mLeft, mRight].forEach(function(el){ el.style.display = 'none'; });

            // Small delay to let browser repaint without overlay before capturing
            setTimeout(function() {
                cleanup();
                chrome.runtime.sendMessage({
                    action: 'DO_CAPTURE_AREA',
                    rect: { x: x, y: y, w: w, h: h },
                    dpr: window.devicePixelRatio || 1,
                    format: format
                });
            }, 80);
        });

        function onEsc(e) {
            if (e.key === 'Escape') { cleanup(); toast('Capture cancelled'); }
        }

        function cleanup() {
            window.__codexCaptureActive = false;
            [overlay, box, lbl, hint, mTop, mBot, mLeft, mRight].forEach(function(el){ if(el.parentNode) el.remove(); });
            document.removeEventListener('keydown', onEsc);
        }

        document.addEventListener('keydown', onEsc);
    }

    // ═══════════════════════════════════════════════════════════════════
    // SELECT ELEMENT — hover highlight + click to capture
    // ═══════════════════════════════════════════════════════════════════
    function startElementPicker(format) {
        window.__codexCaptureActive = true;
        toast('Click any element to capture it', 4000);
        document.body.style.cursor = 'crosshair';

        var highlight = document.createElement('div');
        Object.assign(highlight.style, {
            position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
            border: '2px solid #4FD1C5', background: 'rgba(79,209,197,0.1)',
            boxShadow: '0 0 0 1px rgba(79,209,197,0.3)',
            borderRadius: '6px', transition: 'all 0.1s', display: 'none'
        });
        var label = document.createElement('div');
        Object.assign(label.style, {
            position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
            background: '#4FD1C5', color: '#07201d', fontSize: '11px', fontWeight: '600',
            fontFamily: 'ui-monospace,monospace', padding: '2px 6px', borderRadius: '6px', display: 'none'
        });
        document.body.appendChild(highlight);
        document.body.appendChild(label);

        var lastEl = null;

        function onMove(e) {
            var el = document.elementFromPoint(e.clientX, e.clientY);
            if (!el || el === highlight || el === label) return;
            lastEl = el;
            var r = el.getBoundingClientRect();
            highlight.style.display = 'block';
            highlight.style.left   = r.left + 'px'; highlight.style.top    = r.top + 'px';
            highlight.style.width  = r.width + 'px'; highlight.style.height = r.height + 'px';
            label.style.display = 'block';
            label.textContent = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/)[0] : '') + '  ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px';
            label.style.left = Math.min(r.left, window.innerWidth - 220) + 'px';
            label.style.top  = Math.max(0, r.top - 24) + 'px';
        }

        function onClick(e) {
            e.preventDefault(); e.stopPropagation();
            cleanup();
            if (!lastEl) return;
            var r = lastEl.getBoundingClientRect();
            chrome.runtime.sendMessage({
                action: 'DO_CAPTURE_AREA',
                rect: { x: r.left, y: r.top, w: r.width, h: r.height },
                dpr: window.devicePixelRatio || 1,
                format: format
            });
        }

        function onEsc(e) {
            if (e.key === 'Escape') { cleanup(); toast('Capture cancelled'); }
        }

        function cleanup() {
            window.__codexCaptureActive = false;
            document.body.style.cursor = '';
            if (highlight.parentNode) highlight.remove();
            if (label.parentNode) label.remove();
            document.removeEventListener('mousemove', onMove, true);
            document.removeEventListener('click', onClick, true);
            document.removeEventListener('keydown', onEsc);
        }

        document.addEventListener('mousemove', onMove, true);
        document.addEventListener('click', onClick, true);
        document.addEventListener('keydown', onEsc);
    }
})();
