// Edit mode, frame side. Runs in every frame but only wakes up inside a Codex Dev
// viewer device frame (same guard as iframe-sync.js) and only while the viewer has
// switched Edit mode on.
//
//  - hover outlines the element under the pointer, click selects it, Esc cancels
//  - while on, clicks are swallowed so selecting never triggers the page's own handlers
//  - the selection is described (source mapping, selector, trimmed HTML, text, classes,
//    key computed styles) and posted to the viewer; the viewer adds device + screenshot
//
// Page content is read, never executed or evaluated. The overlay lives in a shadow root
// and ignores the pointer, so the page can't see or intercept it.
(function () {
    'use strict';

    const VIEWER_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
    const inViewer = window !== window.top && window.parent === window.top
        && !!location.ancestorOrigins && location.ancestorOrigins[0] === VIEWER_ORIGIN;
    if (!inViewer) return;

    const STYLE_PROPS = ['display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
        'grid-template-columns', 'width', 'height', 'padding', 'margin', 'font-size', 'color', 'background-color', 'overflow'];
    const MAX_HTML = 2048;

    let active = false;
    let host = null, box = null, label = null;
    let hovered = null, selected = null;

    function post(msg) { window.parent.postMessage(msg, VIEWER_ORIGIN); }

    // ── overlay ────────────────────────────────────────────────────────
    function ensureOverlay() {
        if (host && host.isConnected) return;
        host = document.createElement('codex-edit-overlay');
        host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
        const root = host.attachShadow({ mode: 'closed' });
        root.innerHTML = '<style>' +
            '.b{position:fixed;box-sizing:border-box;border:2px solid #4fd1c5;background:rgba(79,209,197,.14);border-radius:2px;display:none}' +
            '.b.sel{border-style:solid;background:rgba(79,209,197,.22);box-shadow:0 0 0 1px rgba(7,32,29,.5)}' +
            '.l{position:absolute;left:-2px;bottom:100%;margin-bottom:2px;padding:2px 6px;font:600 11px/1.4 ui-monospace,Menlo,monospace;' +
            'color:#07201d;background:#4fd1c5;border-radius:3px;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}' +
            '.b.low .l{bottom:auto;top:100%;margin:2px 0 0}</style><div class="b"><div class="l"></div></div>';
        box = root.querySelector('.b');
        label = root.querySelector('.l');
        document.documentElement.appendChild(host);
    }

    function place(el, isSelected) {
        ensureOverlay();
        if (!el || !el.isConnected) { box.style.display = 'none'; return; }
        const r = el.getBoundingClientRect();
        box.style.cssText = `display:block;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        box.classList.toggle('sel', !!isSelected);
        box.classList.toggle('low', r.top < 22);
        const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
        label.textContent = `${el.tagName.toLowerCase()}${cls}  ${Math.round(r.width)}×${Math.round(r.height)}`;
    }

    function refresh() { place(selected || hovered, !!selected); }

    // ── description ────────────────────────────────────────────────────
    const esc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
    const one = sel => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };

    function uniqueSelector(el) {
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && cur !== document.documentElement) {
            let part = cur.tagName.toLowerCase();
            if (cur.id) {
                parts.unshift('#' + esc(cur.id));
                if (one(parts.join(' > '))) break;
                parts[0] = part + '#' + esc(cur.id);
            } else {
                const cls = (typeof cur.className === 'string' ? cur.className.trim().split(/\s+/) : []).filter(c => c && c.length < 40).slice(0, 3);
                if (cls.length) part += '.' + cls.map(esc).join('.');
                const parent = cur.parentElement;
                if (parent) {
                    const sameKind = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
                    if (sameKind.length > 1) part += `:nth-child(${Array.from(parent.children).indexOf(cur) + 1})`;
                }
                parts.unshift(part);
            }
            if (one(parts.join(' > '))) break;
            cur = cur.parentElement;
        }
        return parts.join(' > ');
    }

    function sourceOf(el) {
        const owner = el.closest('[data-source]');
        if (!owner) return null;
        const m = /^(.+):(\d+):(\d+)$/.exec(owner.getAttribute('data-source') || '');
        return m ? { file: m[1], line: +m[2], column: +m[3], inferred: owner !== el } : null;
    }

    function trimmedHtml(el) {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
        clone.querySelectorAll('svg').forEach(n => { n.textContent = ''; });
        let html = clone.outerHTML.replace(/\sdata-source="[^"]*"/g, '');
        if (html.length > MAX_HTML) html = html.slice(0, MAX_HTML) + '…';
        return html;
    }

    function describe(el) {
        const cs = getComputedStyle(el);
        const styles = {};
        STYLE_PROPS.forEach(p => { const v = cs.getPropertyValue(p); if (v) styles[p] = v.slice(0, 120); });
        const r = el.getBoundingClientRect();
        return {
            source: sourceOf(el),
            selector: uniqueSelector(el).slice(0, 1000),
            tag: el.tagName.toLowerCase(),
            html: trimmedHtml(el),
            text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 500),
            classes: (typeof el.className === 'string' ? el.className.trim().split(/\s+/) : []).filter(Boolean).slice(0, 60).map(c => c.slice(0, 200)),
            styles,
            rect: { x: r.left, y: r.top, width: r.width, height: r.height },
            viewportWidth: window.innerWidth,
            pageUrl: location.origin + location.pathname,
        };
    }

    // ── events (capture phase, so the page never sees them while editing) ──
    const swallow = e => { if (!active) return; e.preventDefault(); e.stopImmediatePropagation(); };
    function onMove(e) {
        if (!active || selected) return;
        const el = e.target;
        if (el === hovered || !(el instanceof Element)) return;
        hovered = el;
        refresh();
    }
    function onClick(e) {
        if (!active) return;
        swallow(e);
        if (!(e.target instanceof Element)) return;
        selected = e.target;
        refresh();
        post({ type: 'CODEX_EDIT_SELECT', payload: describe(selected) });
    }
    function onKey(e) {
        if (active && e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); post({ type: 'CODEX_EDIT_CANCEL' }); }
    }

    function setActive(on) {
        if (on === active) return;
        active = on;
        const m = on ? 'addEventListener' : 'removeEventListener';
        window[m]('mousemove', onMove, true);
        window[m]('click', onClick, true);
        ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick', 'contextmenu', 'submit', 'touchstart', 'touchend'].forEach(t => window[m](t, swallow, true));
        window[m]('keydown', onKey, true);
        window[m]('scroll', refresh, true);
        window[m]('resize', refresh);
        document.documentElement.style.cursor = on ? 'crosshair' : '';
        if (!on) { hovered = selected = null; if (box) box.style.display = 'none'; }
    }

    window.addEventListener('message', e => {
        if (e.origin !== VIEWER_ORIGIN || e.source !== window.parent || !e.data || typeof e.data.type !== 'string') return;
        if (e.data.type === 'CODEX_EDIT_MODE') setActive(!!e.data.on);
        else if (e.data.type === 'CODEX_EDIT_CLEAR') { selected = null; hovered = null; refresh(); }
    });
})();
