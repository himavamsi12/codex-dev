(function () {
    'use strict';

    const PANEL_ID    = 'codex-feedback-host';
    // One storage entry per site; each pin records the page it belongs to
    const STORAGE_KEY = 'codex_fb_' + location.hostname;

    // ── Toggle ────────────────────────────────────────────────────────
    // Each injection runs a fresh copy of this script, so the running copy
    // leaves its own teardown on window (shared by the extension's isolated
    // world) for the next injection to call.
    if (typeof window.__codexFeedbackTeardown === 'function') {
        var wasOpen = !!document.getElementById(PANEL_ID);
        window.__codexFeedbackTeardown();
        if (wasOpen) { _toast('Feedback mode: OFF'); return; }
    }

    var _pins = [];
    var _scope = 'page';           // 'page' | 'all'
    var _pinModeActive = false;
    var _hoverBox = null;
    var _popoverEl = null;
    var _detailEl = null;
    var _host, _shadow, _panel, _markerLayer;
    var _markerEls = {};           // pin id -> marker element
    var _raf = 0, _tick = 0;
    var _uiTeardown = null;

    // ── Toast ─────────────────────────────────────────────────────────
    function _toast(msg, dur) {
        if (window.CodexUI) { window.CodexUI.toast(msg, dur); return; }
        dur = dur || 2500;
        var old = document.getElementById('__cx_fb_toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.id = '__cx_fb_toast';
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', bottom: '30px', left: '50%',
            transform: 'translateX(-50%) translateY(14px)',
            background: '#16171a', border: '1px solid rgba(255,255,255,0.12)',
            color: '#ececef', padding: '9px 16px', borderRadius: '10px',
            zIndex: '2147483647', fontFamily: 'system-ui,sans-serif',
            fontSize: '13px', fontWeight: '500',
            boxShadow: '0 16px 40px -12px rgba(0,0,0,0.55)',
            transition: 'all 0.3s ease', opacity: '0', pointerEvents: 'none'
        });
        document.body.appendChild(t);
        requestAnimationFrame(function () { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
        setTimeout(function () {
            t.style.opacity = '0';
            setTimeout(function () { if (t.parentNode) t.remove(); }, 320);
        }, dur);
    }

    // ── Storage ───────────────────────────────────────────────────────
    function _loadPins(cb) {
        chrome.storage.local.get([STORAGE_KEY], function (r) { cb(_migrate(r[STORAGE_KEY] || [])); });
    }
    function _savePins(cb) {
        var data = {}; data[STORAGE_KEY] = _pins;
        chrome.storage.local.set(data, function () {
            if (chrome.runtime.lastError) {
                _toast('Could not save pins: ' + chrome.runtime.lastError.message, 4000);
            }
            if (cb) cb();
        });
    }
    // Pins saved by older versions only had viewport coordinates
    function _migrate(pins) {
        return pins.map(function (p) {
            if (p.docX == null) { p.docX = (p.x || 0) + (p.scrollX || 0); p.docY = (p.y || 0) + (p.scrollY || 0); }
            if (!p.page) p.page = _pageKey(p.url || location.href);
            return p;
        });
    }
    // Hash changes don't make a different page; query strings do
    function _pageKey(url) {
        try { var u = new URL(url); return u.origin + u.pathname + u.search; } catch (e) { return url; }
    }
    var _thisPage = _pageKey(location.href);
    function _pagePins() { return _pins.filter(function (p) { return p.page === _thisPage; }); }
    function _visiblePins() { return _scope === 'page' ? _pagePins() : _pins; }
    // Number pins per page, in the order they were added
    function _pinNumber(pin) {
        return _pins.filter(function (p) { return p.page === pin.page; }).indexOf(pin) + 1;
    }

    // Another tab (or the report page) changed the pins
    function _onStorageChanged(changes, area) {
        if (area !== 'local' || !changes[STORAGE_KEY]) return;
        _pins = _migrate(changes[STORAGE_KEY].newValue || []);
        _renderMarkers(); _refreshPanelBody();
    }

    // ── Utilities ─────────────────────────────────────────────────────
    function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    // Line icon from the shared set (utils/icons.js via utils/codex-ui.js)
    function _ic(name, size) { return window.CodexUI ? window.CodexUI.icon(name, size || 14) : ''; }
    function _breakpoint(w) {
        if (w < 480)  return { label: 'Mobile S', icon: 'device-mobile' };
        if (w < 768)  return { label: 'Mobile',   icon: 'device-mobile' };
        if (w < 1024) return { label: 'Tablet',   icon: 'device-tablet' };
        if (w < 1440) return { label: 'Desktop',  icon: 'device-desktop' };
        return                { label: 'Wide',     icon: 'device-desktop' };
    }
    // Short, readable label for the element
    function _getSelector(el) {
        if (!el || el === document.body) return 'body';
        var s = el.tagName.toLowerCase();
        if (el.id) return s + '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            var c = el.className.trim().split(/\s+/).slice(0, 2).join('.');
            if (c) s += '.' + c;
        }
        return s;
    }
    // Unique path used to find the element again later
    function _cssPath(el) {
        var parts = [];
        while (el && el.nodeType === 1 && el !== document.documentElement) {
            if (el.id) {
                var idSel = '#' + CSS.escape(el.id);
                try { if (document.querySelectorAll(idSel).length === 1) { parts.unshift(idSel); break; } } catch (e) { }
            }
            var tag = el.tagName.toLowerCase(), parent = el.parentElement;
            if (!parent) { parts.unshift(tag); break; }
            var same = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === el.tagName; });
            parts.unshift(same.length > 1 ? tag + ':nth-of-type(' + (same.indexOf(el) + 1) + ')' : tag);
            el = parent;
        }
        return parts.join(' > ');
    }
    function _findAnchor(pin) {
        if (!pin.path) return null;
        try {
            var el = document.querySelector(pin.path);
            if (el && (!pin.tag || el.tagName === pin.tag) && el.getClientRects().length) return el;
        } catch (e) { }
        return null;
    }
    function _severityMeta(sv) {
        var map = {
            bug:        { label: 'Bug',        color: '#f07575', bg: 'rgba(240,117,117,0.12)', icon: 'bug' },
            suggestion: { label: 'Suggestion', color: '#e8a64a', bg: 'rgba(232,166,74,0.12)',  icon: 'bulb' },
            question:   { label: 'Question',   color: '#6fb3ec', bg: 'rgba(111,179,236,0.12)', icon: 'help-circle' },
            info:       { label: 'Info',       color: '#5ccf8d', bg: 'rgba(92,207,141,0.12)',  icon: 'info-circle' },
        };
        return map[sv] || map.info;
    }
    function _nextFrame() {
        return new Promise(function (r) {
            var t = setTimeout(r, 120);
            requestAnimationFrame(function () { requestAnimationFrame(function () { clearTimeout(t); r(); }); });
        });
    }

    // ── Screenshot of the pinned element ──────────────────────────────
    // Hides the feedback UI first so the highlight box and panel aren't in
    // the picture, then shrinks the crop to a JPEG to keep storage small.
    function _captureElement(el) {
        if (!el || !el.isConnected) return Promise.resolve(null);
        _host.style.visibility = 'hidden';
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return _nextFrame().then(function () {
            var r = el.getBoundingClientRect(), pad = 16;
            var x0 = Math.max(0, r.left - pad), y0 = Math.max(0, r.top - pad);
            var x1 = Math.min(window.innerWidth, r.right + pad), y1 = Math.min(window.innerHeight, r.bottom + pad);
            if (x1 - x0 < 4 || y1 - y0 < 4) return null;
            return new Promise(function (resolve) {
                chrome.runtime.sendMessage({
                    action: 'GET_ELEMENT_SCREENSHOT',
                    rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
                    dpr: window.devicePixelRatio || 1
                }, function (res) {
                    if (chrome.runtime.lastError) { resolve(null); return; }
                    resolve(res && res.dataUrl ? res.dataUrl : null);
                });
            });
        }).then(function (dataUrl) {
            _host.style.visibility = '';
            return dataUrl ? _shrink(dataUrl, 720) : null;
        }, function () { _host.style.visibility = ''; return null; });
    }
    function _shrink(dataUrl, maxW) {
        return new Promise(function (resolve) {
            var img = new Image();
            img.onload = function () {
                var scale = Math.min(1, maxW / img.naturalWidth);
                var c = document.createElement('canvas');
                c.width = Math.max(1, Math.round(img.naturalWidth * scale));
                c.height = Math.max(1, Math.round(img.naturalHeight * scale));
                var ctx = c.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
                ctx.drawImage(img, 0, 0, c.width, c.height);
                try { resolve(c.toDataURL('image/jpeg', 0.82)); } catch (e) { resolve(dataUrl); }
            };
            img.onerror = function () { resolve(dataUrl); };
            img.src = dataUrl;
        });
    }

    // ── Pin markers (inside the panel's shadow root, fixed position) ──
    // Each marker follows its element, so it stays put when the page is
    // scrolled, resized or reflowed. Pins whose element is gone fall back to
    // where they were on the page.
    function _pinPoint(pin) {
        var el = _findAnchor(pin);
        if (el) {
            var r = el.getBoundingClientRect();
            return { x: r.left + (pin.offX || 0) * r.width, y: r.top + (pin.offY || 0) * r.height, anchored: true };
        }
        return { x: pin.docX - window.scrollX, y: pin.docY - window.scrollY, anchored: false };
    }
    function _renderMarkers() {
        if (!_markerLayer) return;
        _markerLayer.textContent = '';
        _markerEls = {};
        _pagePins().forEach(function (pin) {
            var sv = _severityMeta(pin.severity);
            var m = document.createElement('button');
            m.className = 'marker' + (pin.resolved ? ' resolved' : '');
            m.style.setProperty('--c', sv.color);
            m.title = '[' + sv.label + (pin.resolved ? ', resolved' : '') + '] ' + pin.note.substring(0, 80);
            m.setAttribute('aria-label', 'Pin ' + _pinNumber(pin) + ': ' + pin.note.substring(0, 80));
            m.innerHTML = '<span>' + _pinNumber(pin) + '</span>';
            m.addEventListener('click', function (e) {
                e.stopPropagation();
                _showPinDetail(pin);
            });
            _markerLayer.appendChild(m);
            _markerEls[pin.id] = m;
        });
        _positionMarkers();
    }
    function _positionMarkers() {
        _raf = 0;
        _pagePins().forEach(function (pin) {
            var m = _markerEls[pin.id];
            if (!m) return;
            var p = _pinPoint(pin);
            // The marker's point (bottom-left corner) sits on the pinned spot
            m.style.transform = 'translate(' + Math.round(p.x) + 'px,' + Math.round(p.y - 26) + 'px)';
            m.classList.toggle('lost', !p.anchored && !!pin.path);
        });
        if (_detailEl && _detailEl._pin) _placeNear(_detailEl, _detailEl._pin);
    }
    function _schedulePosition() { if (!_raf) _raf = requestAnimationFrame(_positionMarkers); }

    // ── Shadow DOM Panel ──────────────────────────────────────────────
    function _buildPanel() {
        _host = document.createElement('div');
        _host.id = PANEL_ID;
        Object.assign(_host.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647' });
        document.documentElement.appendChild(_host);
        _shadow = _host.attachShadow({ mode: 'open' });

        var style = document.createElement('style');
        style.textContent = `
        :host { all:initial; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; font-size:13px; color:#ececef; box-sizing:border-box; -webkit-font-smoothing:antialiased; }
        * { box-sizing:border-box; }
        .cx-icon { flex-shrink:0; display:inline-block; vertical-align:middle; }
        button { font-family:inherit; }
        :focus-visible { outline:2px solid #4fd1c5; outline-offset:2px; }
        .panel {
            position:fixed; top:12px; right:12px;
            width:340px; max-height:calc(100vh - 24px);
            background:#121316; border:1px solid rgba(255,255,255,0.14);
            border-radius:10px; box-shadow:0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -16px rgba(0,0,0,0.7);
            display:flex; flex-direction:column; overflow:hidden; z-index:10000;
            animation:panelIn 0.35s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes panelIn { from { opacity:0; transform:translateX(12px); } to { opacity:1; transform:none; } }
        .hdr { display:flex; justify-content:space-between; align-items:center;
            height:48px; padding:0 10px 0 14px; border-bottom:1px solid rgba(255,255,255,0.08);
            cursor:move; flex-shrink:0; user-select:none; }
        .hdr-title { font-weight:650; font-size:13.5px; display:flex; align-items:center; gap:8px; }
        .hdr-title .cx-icon { color:#5fd8cc; }
        .close-btn { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center;
            background:none; border:1px solid rgba(255,255,255,0.08); border-radius:6px;
            color:#9b9ca4; cursor:pointer; transition:color 0.15s, background 0.15s; }
        .close-btn:hover { color:#ececef; background:rgba(255,255,255,0.05); }
        .body { flex:1; overflow-y:auto; padding:14px; min-height:0;
            scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.14) transparent; }
        .body::-webkit-scrollbar { width:6px; }
        .body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.14); border-radius:999px; }

        /* Pin Mode toggle */
        .pin-mode-btn {
            width:100%; padding:9px; border-radius:6px; border:1px solid transparent; cursor:pointer;
            font-weight:600; font-size:12.5px;
            display:flex; align-items:center; justify-content:center; gap:7px;
            transition:background 0.15s, transform 0.1s; margin-bottom:12px;
            background:#4fd1c5; color:#07201d;
        }
        .pin-mode-btn:hover { background:#6adbd0; }
        .pin-mode-btn:active { transform:scale(0.98); }
        .pin-mode-btn.active { background:rgba(240,117,117,0.1); color:#f07575; border-color:rgba(240,117,117,0.35); }
        .pin-mode-btn.active:hover { background:rgba(240,117,117,0.16); }

        /* Stats */
        .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px; }
        .stat-c { background:#16171a; border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:8px 10px; }
        .stat-n { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:16px; font-weight:600; line-height:1.1; }
        .stat-l { font-size:11px; color:#9b9ca4; margin-top:2px; }

        /* Section label */
        .sec { font-size:12px; font-weight:600; margin:14px 0 8px; display:flex;
            justify-content:space-between; align-items:center; }
        .sec:first-child { margin-top:0; }
        .sec-count { color:#9b9ca4; font-weight:400; }

        /* Pin card */
        .pin-card { background:#16171a; border:1px solid rgba(255,255,255,0.08);
            border-radius:10px; padding:8px; margin-bottom:6px;
            display:flex; gap:10px; align-items:flex-start;
            transition:border-color 0.15s; cursor:pointer; }
        .pin-card:hover { border-color:rgba(255,255,255,0.16); }
        .pin-num { width:22px; height:22px; border-radius:50%; flex-shrink:0;
            display:flex; align-items:center; justify-content:center;
            font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; font-weight:600; color:#0e0f11; }
        .pin-body { flex:1; min-width:0; }
        .pin-note { font-size:12.5px; font-weight:500; line-height:1.4;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pin-note em { color:#9b9ca4; }
        .pin-meta { font-size:11px; color:#9b9ca4; margin-top:4px; display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
        .pin-sel { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:10.5px; color:#6e7078; }
        .badge { display:inline-flex; align-items:center; gap:4px; padding:1px 7px;
            border-radius:999px; font-size:10.5px; font-weight:600; white-space:nowrap; }
        .badge.neutral { background:rgba(255,255,255,0.05); color:#9b9ca4; }
        .pin-del { display:inline-flex; background:none; border:none; color:#6e7078; cursor:pointer;
            padding:4px; border-radius:6px; flex-shrink:0; transition:color 0.15s, background 0.15s; }
        .pin-del:hover { color:#f07575; background:rgba(240,117,117,0.1); }

        /* Thumb */
        .pin-thumb { width:48px; height:36px; border-radius:6px; object-fit:cover;
            border:1px solid rgba(255,255,255,0.08); flex-shrink:0; background:#1d1e22; }
        div.pin-thumb { display:flex; align-items:center; justify-content:center; color:#6e7078; }

        /* Actions */
        .export-btn { width:100%; padding:9px; border-radius:6px; border:none; cursor:pointer;
            font-weight:600; font-size:12.5px; margin-top:10px;
            background:#4fd1c5; color:#07201d; transition:background 0.15s, transform 0.1s;
            display:flex; align-items:center; justify-content:center; gap:7px; }
        .export-btn:hover { background:#6adbd0; }
        .export-btn:active { transform:scale(0.98); }
        .export-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
        .clear-btn { display:flex; align-items:center; justify-content:center; gap:6px;
            background:none; border:1px solid rgba(255,255,255,0.08);
            color:#9b9ca4; border-radius:6px; padding:8px; cursor:pointer;
            font-size:12px; font-weight:500; width:100%; margin-top:6px;
            transition:color 0.15s, border-color 0.15s, background 0.15s; }
        .clear-btn:hover { border-color:rgba(240,117,117,0.35); color:#f07575; background:rgba(240,117,117,0.08); }
        .empty { color:#9b9ca4; text-align:center; padding:24px 16px; font-size:12.5px; line-height:1.6; }
        .empty-icon { display:flex; justify-content:center; color:#6e7078; margin-bottom:10px; }

        /* Scope switch */
        .scope { display:grid; grid-template-columns:1fr 1fr; gap:2px; padding:3px; margin-bottom:12px;
            background:#1d1e22; border:1px solid rgba(255,255,255,0.08); border-radius:8px; }
        .scope button { background:none; border:none; color:#9b9ca4; font-size:11.5px; font-weight:550;
            padding:5px; border-radius:6px; cursor:pointer; }
        .scope button.on { background:#16171a; color:#ececef; box-shadow:0 1px 2px rgba(0,0,0,0.3); }
        .page-hd { display:flex; align-items:center; gap:5px; font-size:11px; color:#9b9ca4; margin:10px 0 6px;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .page-hd span { overflow:hidden; text-overflow:ellipsis; }
        .page-hd.here { color:#5fd8cc; }
        .pin-card:focus-visible { outline:2px solid #4fd1c5; outline-offset:1px; }
        .pin-card.resolved { opacity:0.55; }
        .pin-card.resolved .pin-note { text-decoration:line-through; }
        .btn-row { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
        .btn-row .clear-btn:not(.danger):hover { border-color:rgba(255,255,255,0.16); color:#ececef; background:rgba(255,255,255,0.05); }

        /* Markers */
        .markers { position:fixed; inset:0; pointer-events:none; overflow:hidden; z-index:1; }
        .marker { position:absolute; left:0; top:0; pointer-events:auto; width:26px; height:26px; padding:0;
            background:var(--c); color:#0e0f11; border:2px solid #fff; border-radius:50% 50% 50% 0;
            box-shadow:0 4px 12px rgba(0,0,0,0.35); cursor:pointer;
            display:flex; align-items:center; justify-content:center;
            font:600 10.5px ui-monospace,SFMono-Regular,Menlo,monospace; will-change:transform; }
        .marker:hover { filter:brightness(1.1); }
        .marker.resolved { opacity:0.5; filter:grayscale(0.7); }
        .marker.lost { border-style:dashed; }
        .marker.pulse { animation:pulse 0.9s ease 2; }
        @keyframes pulse { 50% { box-shadow:0 0 0 8px rgba(79,209,197,0.35), 0 4px 12px rgba(0,0,0,0.35); } }
        .hover-box { position:fixed; display:none; pointer-events:none; z-index:2;
            border:2px solid #4fd1c5; background:rgba(79,209,197,0.08); border-radius:6px; }

        /* Detail card + annotation popover */
        .detail, .popover { position:fixed; z-index:10001; background:#121316; border:1px solid rgba(255,255,255,0.14);
            border-radius:10px; padding:14px; box-shadow:0 24px 60px -16px rgba(0,0,0,0.7); font-size:12px; }
        .detail { width:280px; }
        .popover { width:290px; }
        .icon-btn { display:inline-flex; background:none; border:1px solid rgba(255,255,255,0.08); color:#9b9ca4;
            cursor:pointer; padding:4px; border-radius:6px; margin-left:auto; }
        .icon-btn:hover { color:#ececef; background:rgba(255,255,255,0.05); }
        .d-top { display:flex; align-items:center; gap:6px; margin-bottom:10px; }
        .d-shot { display:block; width:100%; max-height:180px; object-fit:contain; background:#1d1e22;
            border-radius:6px; border:1px solid rgba(255,255,255,0.08); margin-bottom:10px; }
        .d-note { font-size:13px; font-weight:600; line-height:1.45; margin-bottom:6px; white-space:pre-wrap; word-break:break-word; }
        .d-sel { font:10.5px ui-monospace,SFMono-Regular,Menlo,monospace; color:#6e7078; word-break:break-all; }
        .d-meta { display:flex; align-items:center; gap:5px; font-size:11px; color:#9b9ca4; margin-top:6px; }
        .d-actions { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:12px; }
        .d-btn { display:inline-flex; align-items:center; justify-content:center; gap:5px; padding:6px 4px;
            background:none; border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#ececef;
            font-size:11.5px; font-weight:550; cursor:pointer; }
        .d-btn:hover { background:rgba(255,255,255,0.05); }
        .d-btn.danger:hover, .clear-btn.danger:hover { color:#f07575; border-color:rgba(240,117,117,0.35); background:rgba(240,117,117,0.08); }
        .p-hd { display:flex; align-items:center; margin-bottom:12px; }
        .p-title { display:flex; align-items:center; gap:7px; font-weight:650; font-size:13px; }
        .p-title .cx-icon { color:#5fd8cc; }
        .p-lbl { display:block; font-size:12px; font-weight:500; color:#9b9ca4; margin-bottom:6px; }
        .p-sel { font:11px ui-monospace,SFMono-Regular,Menlo,monospace; background:#1d1e22; border:1px solid rgba(255,255,255,0.08);
            border-radius:6px; padding:6px 8px; margin-bottom:12px; word-break:break-all; }
        .sev-row { display:grid; grid-template-columns:repeat(4,1fr); gap:4px; margin-bottom:12px; }
        .sev-row button { display:flex; flex-direction:column; align-items:center; gap:3px; padding:7px 2px;
            border-radius:6px; border:1px solid rgba(255,255,255,0.08); background:transparent; color:#9b9ca4;
            cursor:pointer; font-size:11px; font-weight:550; transition:all 0.15s; }
        .sev-row button.on { background:var(--bg); border-color:var(--c); color:var(--c); }
        textarea { width:100%; min-height:72px; background:#16171a; border:1px solid rgba(255,255,255,0.14); color:#ececef;
            font:inherit; font-size:12.5px; border-radius:6px; padding:8px; outline:none; resize:vertical; }
        textarea:focus { border-color:#4fd1c5; }
        textarea.invalid { border-color:#f07575; }
        .p-err { font-size:11.5px; color:#f07575; margin-top:4px; }
        .p-err[hidden] { display:none; }
        .p-actions { display:flex; gap:6px; margin-top:12px; }
        .p-save { flex:1; padding:8px; background:#4fd1c5; color:#07201d; border:none; border-radius:6px; cursor:pointer; font-weight:600; font-size:12.5px; }
        .p-save:hover { background:#6adbd0; }
        .p-cancel { padding:8px 14px; background:none; border:1px solid rgba(255,255,255,0.14); color:#ececef; border-radius:6px; cursor:pointer; font-size:12.5px; }
        .p-foot { display:flex; align-items:center; justify-content:center; gap:4px; font-size:11px; color:#9b9ca4; margin-top:10px; }
        kbd { font:10px ui-monospace,SFMono-Regular,Menlo,monospace; padding:0 4px; border:1px solid rgba(255,255,255,0.14); border-radius:4px; }

        `;
        _shadow.appendChild(style);

        _markerLayer = document.createElement('div');
        _markerLayer.className = 'markers';
        _shadow.appendChild(_markerLayer);

        _hoverBox = document.createElement('div');
        _hoverBox.className = 'hover-box';
        _shadow.appendChild(_hoverBox);

        _panel = document.createElement('div');
        _panel.className = 'panel';
        _panel.innerHTML = `
        <div class="hdr" id="fb-hdr">
            <div class="hdr-title">${_ic('message-circle', 16)}Feedback Pins</div>
            <button class="close-btn" id="fb-close" aria-label="Close">${_ic('x', 16)}</button>
        </div>
        <div class="body" id="fb-body"></div>
        `;
        _shadow.appendChild(_panel);

        // Drag
        var drg = false, dsx, dsy, psl, pst;
        _shadow.getElementById('fb-hdr').addEventListener('mousedown', function (e) {
            if (e.target.closest('#fb-close')) return;
            drg = true; dsx = e.clientX; dsy = e.clientY;
            var r = _panel.getBoundingClientRect(); psl = r.left; pst = r.top;
            _panel.style.right = 'auto'; _panel.style.left = psl + 'px'; _panel.style.top = pst + 'px';
            e.preventDefault();
        });
        function dragMove(e) {
            if (!drg) return;
            var r = _panel.getBoundingClientRect();
            _panel.style.left = Math.min(Math.max(0, psl + e.clientX - dsx), window.innerWidth - r.width) + 'px';
            _panel.style.top = Math.min(Math.max(0, pst + e.clientY - dsy), window.innerHeight - 48) + 'px';
        }
        function dragUp() { drg = false; }
        document.addEventListener('mousemove', dragMove, true);
        document.addEventListener('mouseup', dragUp, true);
        _shadow.getElementById('fb-close').addEventListener('click', _teardownAll);
        _panel.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });
        // Typing in our inputs shouldn't trigger the site's keyboard shortcuts
        ['keydown', 'keyup', 'keypress'].forEach(function (t) {
            _host.addEventListener(t, function (e) { if (e.key !== 'Escape') e.stopPropagation(); });
        });

        window.addEventListener('scroll', _schedulePosition, true);
        window.addEventListener('resize', _schedulePosition);
        window.addEventListener('keydown', _onEsc, true);
        chrome.storage.onChanged.addListener(_onStorageChanged);
        // Layout can also move without scrolling (images loading, menus opening)
        _tick = setInterval(_schedulePosition, 500);

        _uiTeardown = function () {
            _disablePinMode(true);
            _closeDetail();
            document.removeEventListener('mousemove', dragMove, true);
            document.removeEventListener('mouseup', dragUp, true);
            window.removeEventListener('scroll', _schedulePosition, true);
            window.removeEventListener('resize', _schedulePosition);
            window.removeEventListener('keydown', _onEsc, true);
            chrome.storage.onChanged.removeListener(_onStorageChanged);
            clearInterval(_tick);
            if (_raf) cancelAnimationFrame(_raf);
            if (_host) _host.remove();
        };

        _refreshPanelBody();
    }

    function _onEsc(e) {
        if (e.key !== 'Escape') return;
        if (_popoverEl) { _closePinPopover(); }
        else if (_detailEl) { _closeDetail(); }
        else if (_pinModeActive) { _disablePinMode(); }
        else return;
        e.preventDefault(); e.stopPropagation();
    }

    function _refreshPanelBody() {
        if (!_shadow) return;
        var body = _shadow.getElementById('fb-body');
        if (!body) return;
        var list = _visiblePins();
        var pageCount = _pagePins().length;
        var count = function (sv) { return list.filter(function (p) { return p.severity === sv && !p.resolved; }).length; };
        var openCount = list.filter(function (p) { return !p.resolved; }).length;

        body.innerHTML = '';

        // Pin mode button
        var pmBtn = document.createElement('button');
        pmBtn.className = 'pin-mode-btn' + (_pinModeActive ? ' active' : '');
        pmBtn.innerHTML = _pinModeActive
            ? _ic('x', 15) + 'Stop Pinning'
            : _ic('map-pin', 15) + 'Enable Pin Mode';
        pmBtn.addEventListener('click', function () { _pinModeActive ? _disablePinMode() : _enablePinMode(); });
        body.appendChild(pmBtn);

        // This page / whole site
        if (_pins.length > pageCount || _scope === 'all') {
            var seg = document.createElement('div');
            seg.className = 'scope';
            seg.innerHTML = '<button data-s="page"' + (_scope === 'page' ? ' class="on"' : '') + '>This page (' + pageCount + ')</button>' +
                '<button data-s="all"' + (_scope === 'all' ? ' class="on"' : '') + '>Whole site (' + _pins.length + ')</button>';
            seg.querySelectorAll('button').forEach(function (b) {
                b.addEventListener('click', function () { _scope = b.dataset.s; _refreshPanelBody(); });
            });
            body.appendChild(seg);
        }

        // Stats (open pins only)
        if (list.length > 0) {
            var stats = document.createElement('div');
            stats.className = 'stats';
            stats.innerHTML = `
                <div class="stat-c"><div class="stat-n" style="color:#f07575">${count('bug')}</div><div class="stat-l">Bugs</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#e8a64a">${count('suggestion')}</div><div class="stat-l">Suggests</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#6fb3ec">${count('question')}</div><div class="stat-l">Questions</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#5ccf8d">${count('info')}</div><div class="stat-l">Info</div></div>
            `;
            body.appendChild(stats);
        }

        var sec = document.createElement('div');
        sec.className = 'sec';
        sec.innerHTML = 'Pins <span class="sec-count">' + openCount + ' open' + (list.length > openCount ? ', ' + (list.length - openCount) + ' resolved' : '') + '</span>';
        body.appendChild(sec);

        if (list.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'empty';
            empty.innerHTML = '<span class="empty-icon">' + _ic('map-pin', 28) + '</span>Enable Pin Mode above, then click<br>any element on the page to annotate it.';
            body.appendChild(empty);
            return;
        }

        var lastPage = null;
        list.forEach(function (pin) {
            // Group by page when showing the whole site
            if (_scope === 'all' && pin.page !== lastPage) {
                lastPage = pin.page;
                var ph = document.createElement('div');
                ph.className = 'page-hd' + (pin.page === _thisPage ? ' here' : '');
                var path = pin.page.replace(location.origin, '') || '/';
                ph.innerHTML = _ic(pin.page === _thisPage ? 'map-pin' : 'external-link', 12) + '<span>' + _esc(pin.page === _thisPage ? path + ' (this page)' : path) + '</span>';
                body.appendChild(ph);
            }
            var sv = _severityMeta(pin.severity);
            var bp = _breakpoint(pin.viewportW);
            var card = document.createElement('div');
            card.className = 'pin-card' + (pin.resolved ? ' resolved' : '');
            card.tabIndex = 0;

            var thumbHtml = pin.screenshot
                ? '<img class="pin-thumb" src="' + _esc(pin.screenshot) + '" alt="">'
                : '<div class="pin-thumb">' + _ic('photo-off', 16) + '</div>';

            card.innerHTML = `
                <div class="pin-num" style="background:${sv.color}">${pin.resolved ? _ic('check', 12) : _pinNumber(pin)}</div>
                ${thumbHtml}
                <div class="pin-body">
                    <div class="pin-note" title="${_esc(pin.note)}">${_esc(pin.note)}</div>
                    <div class="pin-meta">
                        <span class="badge" style="background:${sv.bg};color:${sv.color};">${_ic(sv.icon, 12)}${sv.label}</span>
                        <span class="badge neutral">${_ic(bp.icon, 12)}${bp.label}</span>
                        <span class="pin-sel">${_esc(pin.selector)}</span>
                    </div>
                </div>
                <button class="pin-del" title="Delete pin" aria-label="Delete pin">${_ic('trash', 15)}</button>
            `;
            card.querySelector('.pin-del').addEventListener('click', function (e) {
                e.stopPropagation();
                _deletePin(pin);
            });
            function open() {
                if (pin.page !== _thisPage) { location.href = pin.url; return; }
                _goToPin(pin);
            }
            card.addEventListener('click', open);
            card.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
            body.appendChild(card);
        });

        var expBtn = document.createElement('button');
        expBtn.className = 'export-btn';
        expBtn.innerHTML = _ic('file-download', 15) + 'Export Report (PDF)';
        expBtn.addEventListener('click', _exportFeedback);
        body.appendChild(expBtn);

        var row = document.createElement('div');
        row.className = 'btn-row';
        row.innerHTML = '<button class="clear-btn" id="fb-md">' + _ic('copy', 14) + 'Copy as Markdown</button>' +
            '<button class="clear-btn danger" id="fb-clear">' + _ic('trash', 14) + (_scope === 'page' ? 'Clear page' : 'Clear site') + '</button>';
        row.querySelector('#fb-md').addEventListener('click', _copyMarkdown);
        row.querySelector('#fb-clear').addEventListener('click', function () {
            var doomed = _visiblePins();
            if (!confirm('Delete ' + doomed.length + ' pin' + (doomed.length !== 1 ? 's' : '') + (_scope === 'page' ? ' on this page' : ' on ' + location.hostname) + '?')) return;
            _pins = _pins.filter(function (p) { return doomed.indexOf(p) === -1; });
            _savePins(); _renderMarkers(); _refreshPanelBody();
        });
        body.appendChild(row);
    }

    function _deletePin(pin) {
        _pins = _pins.filter(function (p) { return p !== pin; });
        _closeDetail();
        _savePins(); _renderMarkers(); _refreshPanelBody();
    }

    function _goToPin(pin) {
        var el = _findAnchor(pin);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else window.scrollTo({ top: pin.docY - window.innerHeight / 2, behavior: 'smooth' });
        var m = _markerEls[pin.id];
        if (m) { m.classList.remove('pulse'); void m.offsetWidth; m.classList.add('pulse'); }
        setTimeout(function () { _showPinDetail(pin); }, 450);
    }

    // ── Pin detail (from clicking a marker or card) ───────────────────
    function _closeDetail() {
        if (_detailEl) { _detailEl.remove(); _detailEl = null; }
    }
    function _placeNear(box, pin) {
        var p = _pinPoint(pin), w = box.offsetWidth || 280, h = box.offsetHeight || 200;
        var left = p.x + 20 + w > window.innerWidth - 8 ? p.x - w - 12 : p.x + 20;
        var top = Math.min(Math.max(8, p.y - 40), window.innerHeight - h - 8);
        box.style.left = Math.max(8, left) + 'px';
        box.style.top = Math.max(8, top) + 'px';
    }
    function _showPinDetail(pin) {
        _closeDetail();
        var d = document.createElement('div');
        d.className = 'detail';
        d._pin = pin;
        var sv = _severityMeta(pin.severity);
        var bp = _breakpoint(pin.viewportW);
        d.innerHTML = `
            <div class="d-top">
                <span class="badge" style="background:${sv.bg};color:${sv.color};">${_ic(sv.icon, 12)}${sv.label}</span>
                ${pin.resolved ? '<span class="badge neutral">' + _ic('check', 12) + 'Resolved</span>' : ''}
                <button class="icon-btn d-close" aria-label="Close">${_ic('x', 15)}</button>
            </div>
            ${pin.screenshot ? `<img class="d-shot" src="${_esc(pin.screenshot)}" alt="">` : ''}
            <div class="d-note">${_esc(pin.note)}</div>
            <div class="d-sel">${_esc(pin.selector)}</div>
            <div class="d-meta">${_ic(bp.icon, 12)}${bp.label}, ${pin.viewportW}×${pin.viewportH}px · ${_esc(new Date(pin.timestamp).toLocaleString())}</div>
            <div class="d-actions">
                <button class="d-btn" data-a="resolve">${_ic(pin.resolved ? 'refresh' : 'circle-check', 13)}${pin.resolved ? 'Reopen' : 'Resolve'}</button>
                <button class="d-btn" data-a="edit">${_ic('pencil', 13)}Edit</button>
                <button class="d-btn danger" data-a="delete">${_ic('trash', 13)}Delete</button>
            </div>
        `;
        _shadow.appendChild(d);
        _detailEl = d;
        _placeNear(d, pin);
        d.querySelector('.d-close').addEventListener('click', _closeDetail);
        d.querySelector('[data-a="resolve"]').addEventListener('click', function () {
            pin.resolved = !pin.resolved;
            _savePins(); _renderMarkers(); _refreshPanelBody(); _showPinDetail(pin);
        });
        d.querySelector('[data-a="edit"]').addEventListener('click', function () {
            _closeDetail();
            var p = _pinPoint(pin);
            _openPinPopover(p.x, p.y, _findAnchor(pin), pin);
        });
        d.querySelector('[data-a="delete"]').addEventListener('click', function () { _deletePin(pin); });
    }
    // Clicking anywhere else on the page closes the detail card
    function _onDocClick(e) {
        if (_detailEl && e.target !== _host) _closeDetail();
    }
    document.addEventListener('click', _onDocClick, true);

    // ── Pin Mode ──────────────────────────────────────────────────────
    // While pinning, the page must not react to the click (links, buttons,
    // menus that open on mousedown), so all pointer events are swallowed.
    var BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick', 'contextmenu'];

    function _enablePinMode() {
        if (_pinModeActive) return;
        _pinModeActive = true;
        _closeDetail();
        _toast('Pin Mode on. Click any element to annotate, Esc to stop', 3000);
        var cur = document.createElement('style');
        cur.id = '__cx_pin_cursor';
        cur.textContent = 'html, html * { cursor: crosshair !important; }';
        (document.head || document.documentElement).appendChild(cur);
        document.addEventListener('mousemove', _onPinHover, true);
        BLOCKED.forEach(function (t) { window.addEventListener(t, _onPinPointer, true); });
        _refreshPanelBody();
    }

    function _disablePinMode(silent) {
        if (!_pinModeActive) return;
        _pinModeActive = false;
        var cur = document.getElementById('__cx_pin_cursor');
        if (cur) cur.remove();
        if (_hoverBox) _hoverBox.style.display = 'none';
        document.removeEventListener('mousemove', _onPinHover, true);
        BLOCKED.forEach(function (t) { window.removeEventListener(t, _onPinPointer, true); });
        _closePinPopover();
        if (!silent) _refreshPanelBody();
    }

    function _isOurs(el) { return el === _host || (el && el.closest && el.closest('#' + PANEL_ID)); }

    function _onPinHover(e) {
        if (!_pinModeActive || _popoverEl) return;
        var el = e.target;
        if (_isOurs(el)) { _hoverBox.style.display = 'none'; return; }
        var r = el.getBoundingClientRect();
        Object.assign(_hoverBox.style, {
            display: 'block', left: r.left + 'px', top: r.top + 'px',
            width: r.width + 'px', height: r.height + 'px'
        });
    }

    function _onPinPointer(e) {
        if (!_pinModeActive || _isOurs(e.target)) return;
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
        if (e.type === 'click' && !_popoverEl) _openPinPopover(e.clientX, e.clientY, e.target, null, e);
        else if (e.type === 'click' && _popoverEl) _closePinPopover();
    }

    // ── Pin popover (new pin, or editing one) ─────────────────────────
    function _openPinPopover(x, y, el, editing, clickEvent) {
        _closePinPopover();
        var pop = document.createElement('div');
        pop.className = 'popover';
        var vw = editing ? editing.viewportW : window.innerWidth, vh = editing ? editing.viewportH : window.innerHeight;
        var bp = _breakpoint(vw);
        var selector = editing ? editing.selector : _getSelector(el);
        var selSev = editing ? editing.severity : 'bug';

        pop.innerHTML = `
            <div class="p-hd">
                <div class="p-title">${_ic(editing ? 'pencil' : 'map-pin', 16)}${editing ? 'Edit Annotation' : 'Add Annotation'}</div>
                <button class="icon-btn" data-a="close" aria-label="Close">${_ic('x', 14)}</button>
            </div>
            <div class="p-lbl">Element</div>
            <div class="p-sel">${_esc(selector)}</div>
            <div class="p-lbl">Severity</div>
            <div class="sev-row">
                ${['bug', 'suggestion', 'question', 'info'].map(function (k) {
                    var m = _severityMeta(k);
                    return '<button data-sev="' + k + '" style="--c:' + m.color + ';--bg:' + m.bg + '" title="' + m.label + '">' + _ic(m.icon, 16) + (k === 'suggestion' ? 'Suggest' : m.label) + '</button>';
                }).join('')}
            </div>
            <label class="p-lbl" for="fb-note">Note</label>
            <textarea id="fb-note" placeholder="Describe the issue or feedback..."></textarea>
            <div class="p-err" hidden>Add a note before saving.</div>
            <div class="p-actions">
                <button class="p-save" data-a="save">${editing ? 'Save Changes' : 'Save Pin'}</button>
                <button class="p-cancel" data-a="cancel">Cancel</button>
            </div>
            <div class="p-foot">${_ic(bp.icon, 12)}${bp.label}, ${vw}×${vh}px · <kbd>${navigator.platform.indexOf('Mac') > -1 ? '⌘' : 'Ctrl'}</kbd>+<kbd>Enter</kbd> to save</div>
        `;
        _shadow.appendChild(pop);
        _popoverEl = pop;
        var pw = 290, ph = pop.offsetHeight || 340;
        pop.style.left = Math.max(8, Math.min(x + 14, window.innerWidth - pw - 8)) + 'px';
        pop.style.top = Math.max(8, Math.min(y + 14, window.innerHeight - ph - 8)) + 'px';

        var note = pop.querySelector('#fb-note');
        if (editing) note.value = editing.note;
        var sevBtns = pop.querySelectorAll('[data-sev]');
        function updateSevBtns() {
            sevBtns.forEach(function (b) { b.classList.toggle('on', b.dataset.sev === selSev); });
        }
        updateSevBtns();
        sevBtns.forEach(function (b) {
            b.addEventListener('click', function () { selSev = b.dataset.sev; updateSevBtns(); });
        });
        pop.querySelector('[data-a="close"]').addEventListener('click', _closePinPopover);
        pop.querySelector('[data-a="cancel"]').addEventListener('click', _closePinPopover);
        note.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); }
        });
        pop.querySelector('[data-a="save"]').addEventListener('click', save);

        // Where on the element the user clicked, as a fraction of its box,
        // so the marker lands on the same spot at other screen sizes
        var r = el ? el.getBoundingClientRect() : null;
        var offX = r && r.width ? Math.min(1, Math.max(0, (x - r.left) / r.width)) : 0;
        var offY = r && r.height ? Math.min(1, Math.max(0, (y - r.top) / r.height)) : 0;

        function save() {
            var text = note.value.trim();
            if (!text) { note.classList.add('invalid'); pop.querySelector('.p-err').hidden = false; note.focus(); return; }
            _closePinPopover();
            if (editing) {
                editing.note = text;
                editing.severity = selSev;
                _savePins(); _renderMarkers(); _refreshPanelBody();
                _toast('Pin updated', 1600);
                return;
            }
            var pin = {
                id: _uid(),
                url: location.href,
                page: _thisPage,
                pageTitle: document.title,
                selector: selector,
                path: _cssPath(el),
                tag: el.tagName,
                offX: offX, offY: offY,
                docX: x + window.scrollX, docY: y + window.scrollY,
                viewportW: window.innerWidth, viewportH: window.innerHeight,
                note: text,
                severity: selSev,
                resolved: false,
                timestamp: Date.now(),
                screenshot: null
            };
            _captureElement(el).then(function (dataUrl) {
                pin.screenshot = dataUrl;
                _pins.push(pin);
                _savePins(function () { _toast('Pin ' + _pinNumber(pin) + ' saved', 2000); });
                _renderMarkers();
                _refreshPanelBody();
            });
        }

        setTimeout(function () { note.focus(); }, 60);
    }

    function _closePinPopover() {
        if (_popoverEl) { _popoverEl.remove(); _popoverEl = null; }
    }

    // ── Export ────────────────────────────────────────────────────────
    // The report is an extension page that reads the pins from storage, so
    // the site's Content-Security-Policy can't break it and its Save as PDF
    // button always works.
    function _exportFeedback() {
        var list = _visiblePins();
        if (!list.length) { _toast('No pins to export'); return; }
        chrome.runtime.sendMessage({ action: 'OPEN_FEEDBACK_REPORT', key: STORAGE_KEY, page: _scope === 'page' ? _thisPage : '' }, function (res) {
            if (chrome.runtime.lastError || !res || !res.ok) _toast('Could not open the report', 3000);
        });
    }

    function _copyMarkdown() {
        var list = _visiblePins();
        var lines = ['## Feedback: ' + (_scope === 'page' ? document.title || location.href : location.hostname), ''];
        var lastPage = null;
        list.forEach(function (pin) {
            if (_scope === 'all' && pin.page !== lastPage) { lastPage = pin.page; lines.push('### ' + pin.page, ''); }
            var sv = _severityMeta(pin.severity), bp = _breakpoint(pin.viewportW);
            lines.push('- [' + (pin.resolved ? 'x' : ' ') + '] **' + _pinNumber(pin) + '. ' + sv.label + ':** ' + pin.note.replace(/\n+/g, ' '));
            lines.push('  - Element: `' + pin.selector + '` · ' + bp.label + ' ' + pin.viewportW + '×' + pin.viewportH + 'px');
        });
        if (_scope === 'page') lines.push('', 'Page: ' + location.href);
        navigator.clipboard.writeText(lines.join('\n'))
            .then(function () { _toast('Copied ' + list.length + ' pin' + (list.length !== 1 ? 's' : '') + ' as Markdown'); })
            .catch(function () { _toast('Copy failed'); });
    }

    // ── Boot ──────────────────────────────────────────────────────────
    var _closed = false;
    function _teardownAll() {
        _closed = true;
        document.removeEventListener('click', _onDocClick, true);
        if (_uiTeardown) _uiTeardown();
        if (window.__codexFeedbackTeardown === _teardownAll) window.__codexFeedbackTeardown = null;
    }
    // Registered before loading so a toggle-off meanwhile still cleans up
    window.__codexFeedbackTeardown = _teardownAll;
    _loadPins(function (stored) {
        if (_closed) return;
        _pins = stored;
        _buildPanel();
        _renderMarkers();
        var here = _pagePins().length;
        _toast(here ? here + ' pin' + (here !== 1 ? 's' : '') + ' on this page' : 'Feedback ready. Enable Pin Mode to start annotating');
    });
})();
