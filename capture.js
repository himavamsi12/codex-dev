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
    function toast(msg, dur) {
        dur = dur || 2500;
        var old = document.getElementById('__cx_toast');
        if (old) old.remove();
        var el = document.createElement('div');
        el.id = '__cx_toast';
        el.textContent = msg;
        Object.assign(el.style, {
            position: 'fixed', bottom: '30px', left: '50%',
            transform: 'translateX(-50%) translateY(14px)',
            background: 'linear-gradient(135deg,#4FD1C5,#9F7AEA)',
            color: '#000', padding: '10px 22px', borderRadius: '30px',
            zIndex: '2147483647', fontFamily: 'system-ui,sans-serif',
            fontSize: '13px', fontWeight: '700',
            boxShadow: '0 8px 28px rgba(79,209,197,0.5)',
            transition: 'all 0.3s cubic-bezier(0.175,0.885,0.32,1.275)',
            opacity: '0', pointerEvents: 'none'
        });
        document.body.appendChild(el);
        requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(function () {
            el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(14px)';
            setTimeout(function () { if (el.parentNode) el.remove(); }, 320);
        }, dur);
    }

    // ── Listen for commands from popup/background ─────────────────────
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg.action === 'CAPTURE_SELECT_AREA') {
            startAreaSelect(msg.format || 'png');
            sendResponse({ ok: true });
        } else if (msg.action === 'CAPTURE_SELECT_ELEMENT') {
            startElementPicker(msg.format || 'png');
            sendResponse({ ok: true });
        } else if (msg.action === 'CAPTURE_FULL_PAGE') {
            captureFullPage(msg, sendResponse);
            return true;
        } else if (msg.action === 'GET_PAGE_DIMENSIONS') {
            sendResponse({
                scrollWidth:  Math.max(document.body.scrollWidth,  document.documentElement.scrollWidth),
                scrollHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
                viewWidth:    window.innerWidth,
                viewHeight:   window.innerHeight,
                devicePixelRatio: window.devicePixelRatio || 1
            });
        } else if (msg.action === 'SCROLL_TO') {
            window.scrollTo(0, msg.y);
            setTimeout(function () { sendResponse({ scrollY: window.scrollY }); }, 150);
            return true;
        } else if (msg.action === 'RESTORE_SCROLL') {
            window.scrollTo(0, msg.y);
        }
    });

    // ═══════════════════════════════════════════════════════════════════
    // SELECT AREA — drag a box on the page (no blur, 4-mask cutout)
    // ═══════════════════════════════════════════════════════════════════
    function startAreaSelect(format) {
        window.__codexCaptureActive = true;
        toast('🎯 Drag to select an area to capture', 4000);

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
            position: 'fixed', background: '#4FD1C5', color: '#000',
            fontSize: '11px', fontWeight: '700', fontFamily: 'monospace',
            padding: '2px 7px', borderRadius: '4px',
            display: 'none', pointerEvents: 'none', zIndex: '2147483647'
        });

        // Hint bar at top
        var hint = document.createElement('div');
        Object.assign(hint.style, {
            position: 'fixed', top: '12px', left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.75)', color: '#fff',
            padding: '7px 16px', borderRadius: '8px', fontSize: '12px',
            fontFamily: 'system-ui,sans-serif', zIndex: '2147483647',
            pointerEvents: 'none', border: '1px solid rgba(79,209,197,0.4)',
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

        function cleanup() {
            window.__codexCaptureActive = false;
            [overlay, box, lbl, hint, mTop, mBot, mLeft, mRight].forEach(function(el){ if(el.parentNode) el.remove(); });
        }

        document.addEventListener('keydown', function onEsc(e) {
            if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', onEsc); toast('Capture cancelled'); }
        });
    }

    // ═══════════════════════════════════════════════════════════════════
    // SELECT ELEMENT — hover highlight + click to capture
    // ═══════════════════════════════════════════════════════════════════
    function startElementPicker(format) {
        window.__codexCaptureActive = true;
        toast('🖱 Click any element to capture it', 4000);
        document.body.style.cursor = 'crosshair';

        var highlight = document.createElement('div');
        Object.assign(highlight.style, {
            position: 'fixed', pointerEvents: 'none', zIndex: '2147483646',
            border: '2px solid #9F7AEA', background: 'rgba(159,122,234,0.1)',
            boxShadow: '0 0 0 1px rgba(159,122,234,0.3)',
            borderRadius: '4px', transition: 'all 0.1s', display: 'none'
        });
        var label = document.createElement('div');
        Object.assign(label.style, {
            position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
            background: '#9F7AEA', color: '#fff', fontSize: '11px', fontWeight: '700',
            fontFamily: 'monospace', padding: '2px 6px', borderRadius: '4px', display: 'none'
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
