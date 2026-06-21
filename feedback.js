(function () {
    'use strict';

    const PANEL_ID   = 'codex-feedback-host';
    const STORAGE_KEY = 'codex_fb_' + location.hostname;

    // ── Toggle ────────────────────────────────────────────────────────
    if (window.__codexFeedback) {
        window.__codexFeedback = false;
        var _h = document.getElementById(PANEL_ID);
        if (_h) _h.remove();
        _cleanupPinMode();
        _removeAllMarkers();
        _toast('Feedback mode: OFF');
        return;
    }
    window.__codexFeedback = true;

    var _pins = [];
    var _pinModeActive = false;
    var _hoverEl = null;
    var _hoverBox = null;
    var _popoverEl = null;

    // ── Toast ─────────────────────────────────────────────────────────
    function _toast(msg, dur) {
        dur = dur || 2500;
        var old = document.getElementById('__cx_fb_toast');
        if (old) old.remove();
        var t = document.createElement('div');
        t.id = '__cx_fb_toast';
        t.textContent = msg;
        Object.assign(t.style, {
            position: 'fixed', bottom: '30px', left: '50%',
            transform: 'translateX(-50%) translateY(14px)',
            background: 'linear-gradient(135deg,#4FD1C5,#9F7AEA)',
            color: '#000', padding: '10px 22px', borderRadius: '30px',
            zIndex: '2147483647', fontFamily: "'Outfit',system-ui,sans-serif",
            fontSize: '13px', fontWeight: '700',
            boxShadow: '0 8px 28px rgba(79,209,197,0.45)',
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
        chrome.storage.local.get([STORAGE_KEY], function (r) { cb(r[STORAGE_KEY] || []); });
    }
    function _savePins() {
        var data = {}; data[STORAGE_KEY] = _pins;
        chrome.storage.local.set(data);
    }
    function _clearPins(cb) {
        var data = {}; data[STORAGE_KEY] = [];
        chrome.storage.local.set(data, cb);
    }

    // ── Utilities ─────────────────────────────────────────────────────
    function _uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
    function _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function _breakpoint(w) {
        if (w < 480)  return { label: 'Mobile S', icon: '📱', color: '#fc8181' };
        if (w < 768)  return { label: 'Mobile',   icon: '📱', color: '#f6ad55' };
        if (w < 1024) return { label: 'Tablet',   icon: '📟', color: '#f6e05e' };
        if (w < 1440) return { label: 'Desktop',  icon: '🖥', color: '#68d391' };
        return                { label: 'Wide',     icon: '🖥', color: '#63b3ed' };
    }
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
    function _severityMeta(sv) {
        var map = {
            bug:        { label: 'Bug',        color: '#fc8181', bg: 'rgba(245,101,101,0.15)', icon: '🐛' },
            suggestion: { label: 'Suggestion', color: '#f6ad55', bg: 'rgba(237,137,54,0.15)',  icon: '💡' },
            question:   { label: 'Question',   color: '#63b3ed', bg: 'rgba(99,179,237,0.15)',  icon: '❓' },
            info:       { label: 'Info',       color: '#68d391', bg: 'rgba(72,187,120,0.15)',  icon: 'ℹ️' },
        };
        return map[sv] || map.info;
    }

    // ── Screenshot of region via background ───────────────────────────
    function _captureRegion(rect, dpr, cb) {
        chrome.runtime.sendMessage({
            action: 'GET_ELEMENT_SCREENSHOT',
            rect: rect, dpr: dpr || window.devicePixelRatio || 1
        }, function (res) { cb(res && res.dataUrl ? res.dataUrl : null); });
    }

    // ── Pin Markers on page ───────────────────────────────────────────
    function _removeAllMarkers() {
        document.querySelectorAll('.__cx_pin_marker').forEach(function (m) { m.remove(); });
    }
    function _renderMarkers() {
        _removeAllMarkers();
        _pins.forEach(function (pin, i) {
            var sv = _severityMeta(pin.severity);
            var m = document.createElement('div');
            m.className = '__cx_pin_marker';
            m.title = '[' + sv.label + '] ' + pin.note.substring(0, 60);
            Object.assign(m.style, {
                position: 'absolute',
                left: (pin.x + window.scrollX) + 'px',
                top:  (pin.y + window.scrollY) + 'px',
                width: '26px', height: '26px',
                background: sv.color, color: '#000',
                borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: '2147483640', cursor: 'pointer',
                boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
                fontFamily: 'system-ui,sans-serif',
                fontSize: '10px', fontWeight: '800',
                border: '2px solid rgba(255,255,255,0.5)'
            });
            var inner = document.createElement('div');
            Object.assign(inner.style, { transform: 'rotate(45deg)', lineHeight: '1' });
            inner.textContent = i + 1;
            m.appendChild(inner);
            document.body.appendChild(m);
            m.addEventListener('click', function (e) {
                e.stopPropagation();
                _showPinDetail(pin, i);
            });
        });
    }

    // ── Shadow DOM Panel ──────────────────────────────────────────────
    var _shadow, _panel;

    function _buildPanel() {
        var host = document.createElement('div');
        host.id = PANEL_ID;
        Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647' });
        document.body.appendChild(host);
        _shadow = host.attachShadow({ mode: 'open' });

        if (!document.getElementById('__cx_fb_fonts')) {
            var fl = document.createElement('link');
            fl.id = '__cx_fb_fonts'; fl.rel = 'stylesheet';
            fl.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap';
            document.head.appendChild(fl);
        }

        var style = document.createElement('style');
        style.textContent = `
        :host { font-family:'Outfit',system-ui,sans-serif; font-size:13px; color:#e2e8f0; box-sizing:border-box; }
        * { box-sizing:border-box; }
        .panel {
            position:fixed; top:14px; right:14px;
            width:340px; max-height:calc(100vh - 28px);
            background:rgba(10,11,16,0.97); border:1px solid rgba(255,255,255,0.09);
            border-radius:16px; box-shadow:0 32px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06);
            display:flex; flex-direction:column; overflow:hidden; z-index:10000;
            backdrop-filter:blur(20px);
        }
        .hdr { display:flex; justify-content:space-between; align-items:center;
            padding:12px 16px; background:rgba(0,0,0,0.3); border-bottom:1px solid rgba(255,255,255,0.08);
            cursor:move; flex-shrink:0; user-select:none; }
        .hdr-title { font-weight:700; font-size:13.5px;
            background:linear-gradient(135deg,#4FD1C5,#9F7AEA);
            -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text;
            display:flex; align-items:center; gap:7px; }
        .close-btn { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1);
            color:#94a3b8; -webkit-text-fill-color:#94a3b8; cursor:pointer; font-size:11px;
            padding:3px 8px; border-radius:5px; transition:all 0.15s; }
        .close-btn:hover { color:#fff; -webkit-text-fill-color:#fff; }
        .body { flex:1; overflow-y:auto; padding:14px; min-height:0;
            scrollbar-width:thin; scrollbar-color:rgba(255,255,255,0.1) transparent; }
        .body::-webkit-scrollbar { width:4px; }
        .body::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.1); border-radius:2px; }

        /* Pin Mode Toggle */
        .pin-mode-btn {
            width:100%; padding:11px; border-radius:10px; border:none; cursor:pointer;
            font-family:'Outfit',sans-serif; font-weight:700; font-size:12.5px;
            display:flex; align-items:center; justify-content:center; gap:8px;
            transition:all 0.2s; margin-bottom:12px;
            background:linear-gradient(135deg,#9F7AEA,#6366f1);
            color:#fff; box-shadow:0 4px 16px rgba(99,102,241,0.35);
        }
        .pin-mode-btn.active { background:linear-gradient(135deg,#f56565,#e53e3e); box-shadow:0 4px 16px rgba(245,101,101,0.35); }
        .pin-mode-btn:hover { opacity:0.9; transform:translateY(-1px); }

        /* Stats strip */
        .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:6px; margin-bottom:12px; }
        .stat-c { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
            border-radius:8px; padding:8px 6px; text-align:center; }
        .stat-n { font-size:18px; font-weight:800; line-height:1; }
        .stat-l { font-size:9px; color:#94a3b8; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }

        /* Section label */
        .sec { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:1px;
            color:#4FD1C5; margin-bottom:8px; margin-top:14px; display:flex;
            justify-content:space-between; align-items:center; }
        .sec:first-child { margin-top:0; }

        /* Pin card */
        .pin-card { background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08);
            border-radius:10px; padding:10px; margin-bottom:7px;
            display:flex; gap:10px; align-items:flex-start;
            transition:border-color 0.15s; cursor:pointer; }
        .pin-card:hover { border-color:rgba(255,255,255,0.18); }
        .pin-num { width:24px; height:24px; border-radius:50%; flex-shrink:0;
            display:flex; align-items:center; justify-content:center;
            font-size:10px; font-weight:800; color:#000; }
        .pin-body { flex:1; min-width:0; }
        .pin-note { font-size:12px; font-weight:500; color:#fff; line-height:1.4;
            white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .pin-meta { font-size:10px; color:#94a3b8; margin-top:3px; display:flex; gap:6px; flex-wrap:wrap; }
        .badge { display:inline-flex; align-items:center; gap:3px; padding:2px 6px;
            border-radius:4px; font-size:9.5px; font-weight:700; white-space:nowrap; }
        .pin-del { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:13px;
            padding:2px 4px; border-radius:4px; flex-shrink:0; transition:color 0.15s; }
        .pin-del:hover { color:#fc8181; }

        /* Thumb */
        .pin-thumb { width:48px; height:36px; border-radius:5px; object-fit:cover;
            border:1px solid rgba(255,255,255,0.12); flex-shrink:0; background:rgba(0,0,0,0.3); }

        /* Export btn */
        .export-btn { width:100%; padding:11px; border-radius:10px; border:none; cursor:pointer;
            font-family:'Outfit',sans-serif; font-weight:700; font-size:12.5px; margin-top:10px;
            background:linear-gradient(135deg,#4FD1C5,#38b2ac); color:#071515;
            box-shadow:0 4px 16px rgba(79,209,197,0.3); transition:all 0.2s;
            display:flex; align-items:center; justify-content:center; gap:8px; }
        .export-btn:hover { opacity:0.9; transform:translateY(-1px); }
        .export-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
        .clear-btn { background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
            color:#94a3b8; -webkit-text-fill-color:#94a3b8; border-radius:8px; padding:8px; cursor:pointer;
            font-family:'Outfit',sans-serif; font-size:11px; font-weight:600; width:100%; margin-top:6px;
            transition:all 0.15s; }
        .clear-btn:hover { border-color:rgba(245,101,101,0.4); color:#fc8181; -webkit-text-fill-color:#fc8181; }
        .empty { color:#94a3b8; text-align:center; padding:24px 16px; font-size:12px; line-height:1.8; }
        .empty-icon { font-size:32px; display:block; margin-bottom:8px; }
        `;
        _shadow.appendChild(style);

        _panel = document.createElement('div');
        _panel.className = 'panel';
        _panel.innerHTML = `
        <div class="hdr" id="fb-hdr">
            <div class="hdr-title">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="-webkit-text-fill-color:unset;">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Feedback Pins
            </div>
            <button class="close-btn" id="fb-close">✕</button>
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
        document.addEventListener('mousemove', function (e) { if (!drg) return; _panel.style.left = (psl + e.clientX - dsx) + 'px'; _panel.style.top = (pst + e.clientY - dsy) + 'px'; }, true);
        document.addEventListener('mouseup', function () { drg = false; }, true);
        _shadow.getElementById('fb-close').addEventListener('click', function () {
            window.__codexFeedback = false;
            host.remove(); _cleanupPinMode(); _removeAllMarkers();
        });
        _panel.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });

        _refreshPanelBody();
    }

    function _refreshPanelBody() {
        if (!_shadow) return;
        var body = _shadow.getElementById('fb-body');
        if (!body) return;

        var bugs = _pins.filter(function(p){ return p.severity==='bug'; }).length;
        var suggs = _pins.filter(function(p){ return p.severity==='suggestion'; }).length;
        var qs = _pins.filter(function(p){ return p.severity==='question'; }).length;
        var infos = _pins.filter(function(p){ return p.severity==='info'; }).length;

        body.innerHTML = '';

        // Pin mode button
        var pmBtn = document.createElement('button');
        pmBtn.className = 'pin-mode-btn' + (_pinModeActive ? ' active' : '');
        pmBtn.innerHTML = (_pinModeActive
            ? '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Stop Pinning'
            : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg> 📌 Enable Pin Mode');
        pmBtn.addEventListener('click', function () { _pinModeActive ? _disablePinMode() : _enablePinMode(); });
        body.appendChild(pmBtn);

        // Stats
        if (_pins.length > 0) {
            var stats = document.createElement('div');
            stats.className = 'stats';
            stats.innerHTML = `
                <div class="stat-c"><div class="stat-n" style="color:#fc8181">${bugs}</div><div class="stat-l">Bugs</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#f6ad55">${suggs}</div><div class="stat-l">Suggests</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#63b3ed">${qs}</div><div class="stat-l">Questions</div></div>
                <div class="stat-c"><div class="stat-n" style="color:#68d391">${infos}</div><div class="stat-l">Info</div></div>
            `;
            body.appendChild(stats);
        }

        // Pins list
        var sec = document.createElement('div');
        sec.className = 'sec';
        sec.innerHTML = 'Pins <span style="color:#94a3b8;font-weight:400;text-transform:none;letter-spacing:0;">' + _pins.length + ' total</span>';
        body.appendChild(sec);

        if (_pins.length === 0) {
            var empty = document.createElement('div');
            empty.className = 'empty';
            empty.innerHTML = '<span class="empty-icon">📌</span>Enable Pin Mode above, then click<br>any element on the page to annotate it.';
            body.appendChild(empty);
        } else {
            _pins.forEach(function (pin, i) {
                var sv = _severityMeta(pin.severity);
                var bp = _breakpoint(pin.viewportW);
                var card = document.createElement('div');
                card.className = 'pin-card';
                card.style.borderLeft = '3px solid ' + sv.color;

                var thumbHtml = pin.screenshot
                    ? '<img class="pin-thumb" src="' + _esc(pin.screenshot) + '" alt="pin screenshot">'
                    : '<div class="pin-thumb" style="display:flex;align-items:center;justify-content:center;font-size:18px;">🖼</div>';

                card.innerHTML = `
                    <div class="pin-num" style="background:${sv.color}">${i+1}</div>
                    ${thumbHtml}
                    <div class="pin-body">
                        <div class="pin-note" title="${_esc(pin.note)}">${_esc(pin.note) || '<em style="color:#94a3b8">No note</em>'}</div>
                        <div class="pin-meta">
                            <span class="badge" style="background:${sv.bg};color:${sv.color};border:1px solid ${sv.color}33;">${sv.icon} ${sv.label}</span>
                            <span class="badge" style="background:rgba(255,255,255,0.05);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);">${bp.icon} ${bp.label}</span>
                            <span style="color:#718096;">${_esc(pin.selector)}</span>
                        </div>
                    </div>
                    <button class="pin-del" data-idx="${i}" title="Delete pin">🗑</button>
                `;
                card.querySelector('.pin-del').addEventListener('click', function (e) {
                    e.stopPropagation();
                    _pins.splice(parseInt(this.dataset.idx), 1);
                    _savePins(); _renderMarkers(); _refreshPanelBody();
                });
                card.addEventListener('click', function () {
                    window.scrollTo({ top: pin.scrollY - window.innerHeight/2 + pin.y, behavior: 'smooth' });
                    _toast('→ Pin ' + (i+1) + ': ' + pin.note.substring(0, 30), 1800);
                });
                body.appendChild(card);
            });

            // Export button
            var expBtn = document.createElement('button');
            expBtn.className = 'export-btn';
            expBtn.innerHTML = '📄 Export Feedback PDF';
            expBtn.addEventListener('click', _exportFeedback);
            body.appendChild(expBtn);

            var clearBtn = document.createElement('button');
            clearBtn.className = 'clear-btn';
            clearBtn.textContent = '🗑 Clear all pins';
            clearBtn.addEventListener('click', function () {
                if (!confirm('Clear all ' + _pins.length + ' pins?')) return;
                _pins = []; _clearPins(function () { _renderMarkers(); _refreshPanelBody(); });
            });
            body.appendChild(clearBtn);
        }
    }

    // ── Pin Detail Popover (from clicking marker) ─────────────────────
    function _showPinDetail(pin, idx) {
        var old = document.getElementById('__cx_pin_detail');
        if (old) old.remove();
        var d = document.createElement('div');
        d.id = '__cx_pin_detail';
        var sv = _severityMeta(pin.severity);
        var bp = _breakpoint(pin.viewportW);
        Object.assign(d.style, {
            position: 'fixed', zIndex: '2147483646',
            left: Math.min(pin.x + 30, window.innerWidth - 280) + 'px',
            top: Math.max(pin.y - 100, 10) + 'px',
            width: '270px',
            background: 'rgba(10,11,16,0.97)', border: '1px solid ' + sv.color + '55',
            borderRadius: '12px', padding: '14px',
            fontFamily: "'Outfit',system-ui,sans-serif",
            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
            backdropFilter: 'blur(16px)', color: '#e2e8f0', fontSize: '12px'
        });
        d.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <span style="background:${sv.bg};color:${sv.color};border:1px solid ${sv.color}44;border-radius:5px;padding:3px 8px;font-size:10px;font-weight:700;">${sv.icon} ${sv.label}</span>
                <button onclick="this.closest('#__cx_pin_detail').remove()" style="background:none;border:none;color:#94a3b8;cursor:pointer;font-size:14px;">✕</button>
            </div>
            ${pin.screenshot ? `<img src="${_esc(pin.screenshot)}" style="width:100%;border-radius:7px;border:1px solid rgba(255,255,255,0.1);margin-bottom:10px;">` : ''}
            <div style="font-size:13px;font-weight:600;color:#fff;margin-bottom:6px;">${_esc(pin.note)}</div>
            <div style="font-size:10px;color:#718096;font-family:'JetBrains Mono',monospace;">${_esc(pin.selector)}</div>
            <div style="font-size:10px;color:#94a3b8;margin-top:6px;">${bp.icon} ${bp.label} · ${pin.viewportW}×${pin.viewportH}px</div>
        `;
        document.body.appendChild(d);
        setTimeout(function () { document.addEventListener('click', function rm(e) { if (!d.contains(e.target)) { d.remove(); document.removeEventListener('click', rm); } }); }, 100);
    }

    // ── Pin Mode ──────────────────────────────────────────────────────
    function _enablePinMode() {
        _pinModeActive = true;
        _toast('📌 Pin Mode ON — click any element to annotate', 3000);
        document.body.style.cursor = 'crosshair';

        // Hover highlight
        _hoverBox = document.createElement('div');
        Object.assign(_hoverBox.style, {
            position: 'fixed', pointerEvents: 'none', zIndex: '2147483644',
            border: '2px solid #9F7AEA', background: 'rgba(159,122,234,0.07)',
            borderRadius: '4px', display: 'none', transition: 'all 0.08s'
        });
        document.body.appendChild(_hoverBox);

        document.addEventListener('mousemove', _onPinHover, true);
        document.addEventListener('click', _onPinClick, true);
        document.addEventListener('keydown', _onPinEsc);
        _refreshPanelBody();
    }

    function _disablePinMode() {
        _pinModeActive = false;
        document.body.style.cursor = '';
        if (_hoverBox) { _hoverBox.remove(); _hoverBox = null; }
        document.removeEventListener('mousemove', _onPinHover, true);
        document.removeEventListener('click', _onPinClick, true);
        document.removeEventListener('keydown', _onPinEsc);
        _closePinPopover();
        _refreshPanelBody();
    }

    function _cleanupPinMode() { if (_pinModeActive) _disablePinMode(); }

    function _onPinEsc(e) {
        if (e.key === 'Escape') {
            if (_popoverEl) { _closePinPopover(); }
            else { _disablePinMode(); }
        }
    }

    function _onPinHover(e) {
        if (!_pinModeActive || _popoverEl) return;
        var el = e.target;
        if (el === _hoverBox || el.id === '__cx_pin_popover') return;
        if (el.closest('#' + PANEL_ID)) return;
        _hoverEl = el;
        var r = el.getBoundingClientRect();
        Object.assign(_hoverBox.style, {
            display: 'block', left: r.left + 'px', top: r.top + 'px',
            width: r.width + 'px', height: r.height + 'px'
        });
    }

    function _onPinClick(e) {
        if (!_pinModeActive) return;
        var el = e.target;
        if (el.closest('#' + PANEL_ID) || el.closest('#__cx_pin_popover')) return;
        if (el.classList && el.classList.contains('__cx_pin_marker')) return;
        e.preventDefault(); e.stopPropagation();
        _openPinPopover(e.clientX, e.clientY, el);
    }

    // ── Pin Popover ───────────────────────────────────────────────────
    function _openPinPopover(x, y, el) {
        _closePinPopover();
        var pop = document.createElement('div');
        pop.id = '__cx_pin_popover';
        var bp = _breakpoint(window.innerWidth);
        var left = Math.min(x + 14, window.innerWidth - 300);
        var top  = Math.min(y + 14, window.innerHeight - 340);
        Object.assign(pop.style, {
            position: 'fixed', left: left + 'px', top: top + 'px',
            width: '290px', zIndex: '2147483646',
            background: 'rgba(10,11,16,0.98)',
            border: '1px solid rgba(159,122,234,0.4)',
            borderRadius: '12px', padding: '16px',
            fontFamily: "'Outfit',system-ui,sans-serif", color: '#e2e8f0',
            boxShadow: '0 16px 50px rgba(0,0,0,0.7)',
            backdropFilter: 'blur(20px)', fontSize: '12px'
        });

        var rect = el.getBoundingClientRect();
        var selector = _getSelector(el);

        pop.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <div style="font-weight:700;font-size:13px;background:linear-gradient(135deg,#9F7AEA,#6366f1);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">📌 Add Annotation</div>
                <button id="__cx_pop_close" style="background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;cursor:pointer;padding:2px 8px;border-radius:5px;font-size:11px;font-family:inherit;">✕</button>
            </div>
            <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin-bottom:4px;">Element</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:10.5px;color:#81e6d9;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:6px 8px;margin-bottom:10px;word-break:break-all;">${_esc(selector)}</div>

            <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin-bottom:4px;">Severity</div>
            <div id="__cx_sev_row" style="display:flex;gap:5px;margin-bottom:10px;">
                ${[['bug','🐛','Bug','#fc8181'],['suggestion','💡','Suggest','#f6ad55'],['question','❓','Question','#63b3ed'],['info','ℹ️','Info','#68d391']].map(function(s){
                    return `<button data-sev="${s[0]}" style="flex:1;padding:5px 3px;border-radius:6px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);color:#94a3b8;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:700;transition:all 0.15s;" title="${s[2]}">${s[1]}<br>${s[2]}</button>`;
                }).join('')}
            </div>

            <div style="font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:#94a3b8;margin-bottom:4px;">Note</div>
            <textarea id="__cx_pop_note" placeholder="Describe the issue or feedback…" style="width:100%;min-height:72px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);color:#fff;font-family:'Outfit',sans-serif;font-size:12px;border-radius:7px;padding:8px;outline:none;resize:vertical;"></textarea>

            <div style="display:flex;gap:7px;margin-top:10px;">
                <button id="__cx_pop_save" style="flex:1;padding:9px;background:linear-gradient(135deg,#9F7AEA,#6366f1);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-family:inherit;font-size:12px;transition:opacity 0.15s;">Save Pin</button>
                <button id="__cx_pop_cancel" style="padding:9px 14px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:8px;cursor:pointer;font-family:inherit;font-size:12px;">Cancel</button>
            </div>
            <div style="font-size:10px;color:#4FD1C5;margin-top:8px;text-align:center;opacity:0.7;">${bp.icon} ${bp.label} · ${window.innerWidth}×${window.innerHeight}px</div>
        `;

        document.body.appendChild(pop);
        _popoverEl = pop;

        // Severity selection
        var selSev = 'bug';
        var sevBtns = pop.querySelectorAll('[data-sev]');
        function updateSevBtns() {
            sevBtns.forEach(function (b) {
                var active = b.dataset.sev === selSev;
                var colors = { bug:'#fc8181', suggestion:'#f6ad55', question:'#63b3ed', info:'#68d391' };
                b.style.background = active ? 'rgba('+hexToRgb(colors[b.dataset.sev])+',0.2)' : 'rgba(255,255,255,0.04)';
                b.style.borderColor = active ? colors[b.dataset.sev] : 'rgba(255,255,255,0.1)';
                b.style.color = active ? colors[b.dataset.sev] : '#94a3b8';
            });
        }
        updateSevBtns();
        sevBtns.forEach(function (b) {
            b.addEventListener('click', function () { selSev = this.dataset.sev; updateSevBtns(); });
        });

        pop.querySelector('#__cx_pop_close').addEventListener('click', _closePinPopover);
        pop.querySelector('#__cx_pop_cancel').addEventListener('click', _closePinPopover);

        pop.querySelector('#__cx_pop_save').addEventListener('click', function () {
            var note = pop.querySelector('#__cx_pop_note').value.trim();
            if (!note) { pop.querySelector('#__cx_pop_note').style.borderColor = '#f56565'; return; }
            var pin = {
                id: _uid(),
                url: location.href,
                pageTitle: document.title,
                selector: selector,
                x: x, y: y,
                scrollX: window.scrollX, scrollY: window.scrollY,
                viewportW: window.innerWidth, viewportH: window.innerHeight,
                note: note,
                severity: selSev,
                timestamp: Date.now(),
                screenshot: null
            };
            _closePinPopover();
            // Capture screenshot of region
            var pad = 20;
            var rr = { x: Math.max(0, rect.left - pad), y: Math.max(0, rect.top - pad),
                       w: Math.min(window.innerWidth - rect.left + pad, rect.width + pad*2),
                       h: Math.min(window.innerHeight - rect.top + pad, rect.height + pad*2) };
            _captureRegion(rr, window.devicePixelRatio || 1, function (dataUrl) {
                pin.screenshot = dataUrl;
                _pins.push(pin);
                _savePins();
                _renderMarkers();
                _refreshPanelBody();
                _toast('📌 Pin #' + _pins.length + ' saved!', 2000);
            });
        });

        // Focus note textarea
        setTimeout(function () { var ta = pop.querySelector('#__cx_pop_note'); if (ta) ta.focus(); }, 80);
    }

    function _closePinPopover() {
        if (_popoverEl) { _popoverEl.remove(); _popoverEl = null; }
    }

    function hexToRgb(hex) {
        var r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return r ? parseInt(r[1],16)+','+parseInt(r[2],16)+','+parseInt(r[3],16) : '255,255,255';
    }

    // ── PDF Export (beautiful HTML → Print) ──────────────────────────
    function _exportFeedback() {
        if (_pins.length === 0) { _toast('No pins to export!'); return; }
        var bugs = _pins.filter(function(p){ return p.severity==='bug'; }).length;
        var suggs = _pins.filter(function(p){ return p.severity==='suggestion'; }).length;
        var qs = _pins.filter(function(p){ return p.severity==='question'; }).length;
        var infos = _pins.filter(function(p){ return p.severity==='info'; }).length;
        var domain = location.hostname;
        var exportDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });

        var pinsHtml = _pins.map(function (pin, i) {
            var sv = _severityMeta(pin.severity);
            var bp = _breakpoint(pin.viewportW);
            var dateStr = new Date(pin.timestamp).toLocaleString();
            return `
            <div class="pin-section" style="page-break-inside:avoid;">
                <div class="pin-header">
                    <div class="pin-number" style="background:${sv.color}">${i+1}</div>
                    <div class="pin-header-info">
                        <span class="severity-badge" style="background:${sv.bg};color:${sv.color};border:1.5px solid ${sv.color}55;">${sv.icon} ${sv.label}</span>
                        <span class="bp-badge">${bp.icon} ${bp.label} — ${pin.viewportW}×${pin.viewportH}px</span>
                    </div>
                </div>
                ${pin.screenshot ? `<div class="screenshot-wrap"><img class="screenshot" src="${pin.screenshot}" alt="Element screenshot"></div>` : ''}
                <div class="note-box">
                    <div class="note-label">📝 Feedback Note</div>
                    <div class="note-text">${_esc(pin.note)}</div>
                </div>
                <div class="pin-details">
                    <div class="detail-row"><span class="detail-key">Element</span><code class="detail-val">${_esc(pin.selector)}</code></div>
                    <div class="detail-row"><span class="detail-key">Position</span><code class="detail-val">x:${Math.round(pin.x)} y:${Math.round(pin.y)}</code></div>
                    <div class="detail-row"><span class="detail-key">Viewport</span><code class="detail-val">${pin.viewportW}×${pin.viewportH}px (${bp.label})</code></div>
                    <div class="detail-row"><span class="detail-key">Page URL</span><code class="detail-val url">${_esc(pin.url)}</code></div>
                    <div class="detail-row"><span class="detail-key">Captured</span><code class="detail-val">${dateStr}</code></div>
                </div>
            </div>`;
        }).join('<div class="pin-divider"></div>');

        var html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feedback Report — ${_esc(domain)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', -apple-system, sans-serif; font-size: 14px; color: #1a202c; background: #f7f8fc; line-height: 1.6; }

    @media print {
        body { background: #fff; }
        .cover { page-break-after: always; }
        .no-print { display: none !important; }
        @page { margin: 20mm 15mm; }
    }

    /* Cover Page */
    .cover {
        min-height: 100vh; display: flex; flex-direction: column; justify-content: center;
        background: linear-gradient(145deg, #0f0c29, #302b63, #24243e);
        color: #fff; padding: 60px 80px; position: relative; overflow: hidden;
    }
    .cover::before {
        content:''; position:absolute; inset:0;
        background: radial-gradient(ellipse at 20% 50%, rgba(159,122,234,0.15) 0%, transparent 60%),
                    radial-gradient(ellipse at 80% 20%, rgba(79,209,197,0.12) 0%, transparent 50%);
    }
    .cover-content { position:relative; z-index:1; }
    .cover-badge { display:inline-block; background:rgba(79,209,197,0.15); color:#4fd1c5;
        border:1px solid rgba(79,209,197,0.3); border-radius:6px; padding:4px 12px;
        font-size:11px; font-weight:700; letter-spacing:1.2px; text-transform:uppercase; margin-bottom:24px; }
    .cover-title { font-size:42px; font-weight:800; line-height:1.15; margin-bottom:10px;
        background:linear-gradient(135deg,#fff 60%,rgba(255,255,255,0.7));
        -webkit-background-clip:text; -webkit-text-fill-color:transparent; background-clip:text; }
    .cover-url { font-size:16px; color:rgba(255,255,255,0.55); margin-bottom:36px; font-weight:400; }
    .cover-meta { display:flex; gap:40px; margin-bottom:48px; }
    .cover-meta-item { }
    .cover-meta-num { font-size:36px; font-weight:800; color:#4fd1c5; line-height:1; }
    .cover-meta-label { font-size:11px; color:rgba(255,255,255,0.45); text-transform:uppercase; letter-spacing:0.8px; margin-top:4px; }
    .cover-date { font-size:13px; color:rgba(255,255,255,0.35); }
    .cover-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:36px; max-width:480px; }
    .cover-stat { background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px 14px; text-align:center; }
    .cover-stat-num { font-size:28px; font-weight:800; }
    .cover-stat-label { font-size:10px; text-transform:uppercase; letter-spacing:0.7px; margin-top:4px; opacity:0.55; }

    /* Content */
    .content { max-width: 820px; margin: 0 auto; padding: 48px 40px; }
    .section-title { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:1.5px;
        color:#9F7AEA; margin-bottom:28px; padding-bottom:10px; border-bottom:2px solid #e2e8f0; }

    /* Pin sections */
    .pin-section { background:#fff; border-radius:16px; padding:28px;
        box-shadow:0 2px 12px rgba(0,0,0,0.06); margin-bottom:28px;
        border:1px solid #e8ecf0; }
    .pin-header { display:flex; align-items:center; gap:14px; margin-bottom:18px; }
    .pin-number { width:36px; height:36px; border-radius:50%; display:flex; align-items:center;
        justify-content:center; font-size:14px; font-weight:800; color:#000; flex-shrink:0; }
    .pin-header-info { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .severity-badge { display:inline-flex; align-items:center; gap:5px; padding:4px 11px;
        border-radius:6px; font-size:11px; font-weight:700; }
    .bp-badge { background:#f0f4ff; color:#4a5568; border:1px solid #dde3ef;
        border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600; }

    /* Screenshot */
    .screenshot-wrap { margin-bottom:20px; border-radius:10px; overflow:hidden;
        border:1px solid #e2e8f0; box-shadow:0 4px 20px rgba(0,0,0,0.08); }
    .screenshot { display:block; width:100%; height:auto; max-height:300px; object-fit:contain; background:#f8fafc; }

    /* Note */
    .note-box { background:#f8f9ff; border-left:4px solid #9F7AEA; border-radius:0 10px 10px 0;
        padding:16px 18px; margin-bottom:16px; }
    .note-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px;
        color:#9F7AEA; margin-bottom:6px; }
    .note-text { font-size:14px; color:#2d3748; line-height:1.65; font-weight:400; }

    /* Details table */
    .pin-details { display:flex; flex-direction:column; gap:6px; }
    .detail-row { display:flex; gap:12px; align-items:baseline; font-size:12px; }
    .detail-key { color:#718096; font-weight:600; min-width:70px; flex-shrink:0; }
    .detail-val { font-family:'JetBrains Mono',monospace; color:#4a5568; font-size:11px;
        background:#f7fafc; padding:2px 7px; border-radius:4px; border:1px solid #e2e8f0; word-break:break-all; }
    .detail-val.url { color:#667eea; }
    .pin-divider { height:1px; background:transparent; margin-bottom:28px; }

    /* No-print print button */
    .print-bar { position:fixed; top:0; left:0; right:0; background:rgba(10,11,16,0.95);
        padding:12px 32px; display:flex; gap:12px; align-items:center; z-index:999;
        backdrop-filter:blur(12px); box-shadow:0 4px 20px rgba(0,0,0,0.4); }
    .print-btn { background:linear-gradient(135deg,#4FD1C5,#38b2ac); color:#071515;
        border:none; padding:9px 22px; border-radius:8px; font-weight:800; font-size:13px;
        cursor:pointer; font-family:'Inter',sans-serif; }
    .print-btn:hover { opacity:0.88; }
    .print-title { color:#fff; font-weight:600; font-size:14px; flex:1; }
    .print-hint { color:#94a3b8; font-size:12px; }
    .cover { padding-top: 80px; }
</style>
</head>
<body>
<div class="print-bar no-print">
    <div class="print-title">📄 Feedback Report — ${_esc(domain)}</div>
    <div class="print-hint">File → Print → Save as PDF</div>
    <button class="print-btn" onclick="window.print()">🖨 Save as PDF</button>
</div>

<!-- Cover Page -->
<div class="cover">
    <div class="cover-content">
        <div class="cover-badge">Codex Dev · Feedback Report</div>
        <div class="cover-title">Design &amp; UX<br>Feedback Report</div>
        <div class="cover-url">🌐 ${_esc(domain)}</div>
        <div class="cover-meta">
            <div class="cover-meta-item">
                <div class="cover-meta-num">${_pins.length}</div>
                <div class="cover-meta-label">Total Annotations</div>
            </div>
            <div class="cover-meta-item">
                <div class="cover-meta-num">${new Set(_pins.map(function(p){return p.viewportW;})).size}</div>
                <div class="cover-meta-label">Breakpoints</div>
            </div>
        </div>
        <div class="cover-grid">
            <div class="cover-stat"><div class="cover-stat-num" style="color:#fc8181">${bugs}</div><div class="cover-stat-label">Bugs</div></div>
            <div class="cover-stat"><div class="cover-stat-num" style="color:#f6ad55">${suggs}</div><div class="cover-stat-label">Suggestions</div></div>
            <div class="cover-stat"><div class="cover-stat-num" style="color:#63b3ed">${qs}</div><div class="cover-stat-label">Questions</div></div>
            <div class="cover-stat"><div class="cover-stat-num" style="color:#68d391">${infos}</div><div class="cover-stat-label">Info</div></div>
        </div>
        <div class="cover-date" style="margin-top:28px;">Generated on ${exportDate}</div>
    </div>
</div>

<!-- Annotations -->
<div class="content">
    <div class="section-title">Annotated Feedback — ${_pins.length} item${_pins.length !== 1 ? 's' : ''}</div>
    ${pinsHtml}
</div>
</body>
</html>`;

        var blob = new Blob([html], { type: 'text/html' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
        _toast('📄 Report opened — use File → Print → Save as PDF', 4000);
    }

    // ── Boot ──────────────────────────────────────────────────────────
    _loadPins(function (stored) {
        _pins = stored;
        _buildPanel();
        _renderMarkers();
        _toast('📌 Feedback tool ready! Enable Pin Mode to start annotating.');
    });
})();
