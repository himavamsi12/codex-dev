// Design Inspector AI: page-side engine.
//
// Owns everything that touches the inspected page: the element picker, the
// target element, and the live preview. It needs no chrome.* APIs, so it runs
// the same in the extension's isolated world and in the test harness.
//
// Preview model: each target element gets an extension-owned attribute
// (data-cx-design="dN") and a PatchStore. The engine renders every store as
// rules scoped to that attribute into ONE extension-owned stylesheet. The
// site's own stylesheets and elements are never edited; the only changes to the
// page are that attribute, that stylesheet and, if the user asks, the text of a
// leaf element (restored on reset). Reset removes all three.
(function (root) {
    'use strict';
    if (root.CodexDesignEngine) return;
    const Core = root.DesignAICore;

    const ATTR = 'data-cx-design';
    const STYLE_ID = 'codex-design-ai-style';
    const OWN_SELECTOR = 'codex-inspector, codex-ai-panel, codex-design-ai-panel, codex-design-ai-hl';
    const CONTEXT_STYLES = ['display', 'position', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns',
        'width', 'max-width', 'min-height', 'padding', 'margin', 'color', 'background-color', 'background-image',
        'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
        'border', 'border-radius', 'box-shadow', 'opacity'];
    const CONTEXT_HTML_MAX = 12000;

    const listeners = { change: [], stale: [], pick: [] };
    const sessions = new Map();     // id -> { id, el, store, path, originalText, stale }
    let current = null;
    let nextId = 1;
    let enabled = true;
    let styleEl = null;
    let sheet = null;
    let observer = null;
    let observerTimer = 0;
    let picking = null;

    function emit(name, detail) {
        listeners[name].forEach(function (fn) { try { fn(detail); } catch (e) { /* listener errors must not break the engine */ } });
    }
    function on(name, fn) {
        if (!listeners[name]) throw new Error('Unknown event ' + name);
        listeners[name].push(fn);
        return function () { listeners[name] = listeners[name].filter(function (f) { return f !== fn; }); };
    }

    // ── Elements ───────────────────────────────────────────────────────
    function isOwn(node) {
        return !!(node && node.closest && node.closest(OWN_SELECTOR));
    }

    function esc(s) { return (root.CSS && root.CSS.escape) ? root.CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&'); }

    // Short selector that matches exactly this element (best effort).
    function cssPath(el) {
        if (!el || el.nodeType !== 1) return '';
        if (el === document.body) return 'body';
        const parts = [];
        for (let node = el; node && node.nodeType === 1 && node !== document.body && parts.length < 7; node = node.parentElement) {
            let part = node.nodeName.toLowerCase();
            if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) { parts.unshift('#' + esc(node.id)); break; }
            const cls = Array.prototype.filter.call(node.classList || [], function (c) {
                return c.length < 40 && !/^(css-|sc-|jsx-|_)|[0-9a-f]{6,}/i.test(c);
            }).slice(0, 2);
            if (cls.length) part += '.' + cls.map(esc).join('.');
            const parent = node.parentElement;
            if (parent) {
                const same = Array.prototype.filter.call(parent.children, function (c) { return c.nodeName === node.nodeName; });
                const alike = Array.prototype.filter.call(parent.children, function (c) { return c.matches(part); });
                if (alike.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
            }
            parts.unshift(part);
        }
        return parts.join(' > ');
    }

    function sessionFor(el) {
        for (const s of sessions.values()) if (s.el === el) return s;
        return null;
    }

    function openSession(el) {
        let s = sessionFor(el);
        if (s) return s;
        s = { id: 'd' + (nextId++), el: el, store: new Core.PatchStore(), path: cssPath(el), originalText: null, stale: false };
        sessions.set(s.id, s);
        return s;
    }

    function tag(s) { if (s.el.getAttribute(ATTR) !== s.id) s.el.setAttribute(ATTR, s.id); }
    function untag(s) { if (s.el && s.el.isConnected && s.el.getAttribute(ATTR) === s.id) s.el.removeAttribute(ATTR); }

    function hasOverrides(s) { return !s.store.isEmpty(); }

    // ── Rendering ──────────────────────────────────────────────────────
    function selectorFor(s) { return 'html [' + ATTR + '="' + s.id + '"]'; }

    function allCss() {
        const out = [];
        sessions.forEach(function (s) {
            if (s.stale || !hasOverrides(s)) return;
            const css = s.store.toCss(selectorFor(s));
            if (css) out.push(css);
        });
        return out.join('\n\n');
    }

    function unmount() {
        if (styleEl) { styleEl.remove(); styleEl = null; }
        if (sheet) { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (x) { return x !== sheet; }); sheet = null; }
    }

    function mount(cssText) {
        if (!cssText) { unmount(); return; }
        if (sheet) {
            sheet.replaceSync(cssText);
            return;
        }
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = STYLE_ID;
            (document.head || document.documentElement).appendChild(styleEl);
        }
        styleEl.textContent = cssText;
        // A page's Content-Security-Policy can refuse inline <style>; the rules then never land.
        if (!styleEl.sheet || styleEl.sheet.cssRules.length === 0) {
            if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in document) {
                styleEl.remove(); styleEl = null;
                sheet = new CSSStyleSheet();
                sheet.replaceSync(cssText);
                document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
            }
        }
    }

    function syncText(s) {
        if (s.stale || !s.el.isConnected) return;
        const want = s.store.state.text;
        if (want) {
            if (s.originalText === null) s.originalText = s.el.textContent;
            if (s.el.textContent !== want) s.el.textContent = want;
        } else if (s.originalText !== null) {
            s.el.textContent = s.originalText;
            s.originalText = null;
        }
    }

    function render() {
        sessions.forEach(function (s) {
            if (s.stale) return;
            if (hasOverrides(s) && enabled) tag(s); else if (!hasOverrides(s)) untag(s);
            if (enabled) syncText(s);
        });
        mount(enabled ? allCss() : '');
        emit('change', summary());
    }

    // ── Target ─────────────────────────────────────────────────────────
    function setTarget(el) {
        if (!el || el.nodeType !== 1 || isOwn(el) || el === document.documentElement) return null;
        current = openSession(el);
        current.stale = false;
        emit('change', summary());
        return current;
    }

    function selectBySelector(selector) {
        let list;
        try { list = document.querySelectorAll(selector); } catch (e) { return { ok: false, error: 'Invalid CSS selector.' }; }
        const el = Array.prototype.find.call(list, function (n) { return !isOwn(n); });
        if (!el) return { ok: false, error: 'No element matches that selector.' };
        if (el === document.documentElement) return { ok: false, error: 'Pick a section inside the page, not the whole document.' };
        setTarget(el);
        return { ok: true, matches: list.length, context: context() };
    }

    function selectParent() {
        if (!current) return null;
        const p = current.el.parentElement;
        if (!p || p === document.documentElement) return null;
        return setTarget(p);
    }

    // Look for the element again after the page replaced it (framework re-render).
    function refresh() {
        let changed = false;
        sessions.forEach(function (s) {
            if (s.el.isConnected) { if (s.stale) { s.stale = false; changed = true; } return; }
            let found = null;
            try {
                const m = document.querySelectorAll(s.path);
                if (m.length === 1 && !isOwn(m[0]) && !sessionFor(m[0])) found = m[0];
            } catch (e) { /* invalid path: treat as lost */ }
            if (found) { s.el = found; s.stale = false; s.originalText = null; changed = true; }
            else if (!s.stale) { s.stale = true; changed = true; emit('stale', { id: s.id, path: s.path }); }
        });
        if (changed) render();
    }

    function watch() {
        if (observer || typeof MutationObserver !== 'function') return;
        observer = new MutationObserver(function () {
            clearTimeout(observerTimer);
            observerTimer = setTimeout(refresh, 250);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    function context() {
        if (!current) return null;
        refresh();
        const el = current.el;
        if (current.stale || !el.isConnected) return null;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const computed = {};
        CONTEXT_STYLES.forEach(function (k) {
            const v = cs.getPropertyValue(k);
            if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') computed[k] = v;
        });
        let html = '';
        try { html = Core.sanitizeHtml(el.outerHTML.slice(0, CONTEXT_HTML_MAX * 2)).slice(0, CONTEXT_HTML_MAX); } catch (e) { /* no DOMParser */ }
        return {
            tag: el.nodeName.toLowerCase(),
            id: el.id || '',
            classes: Array.prototype.slice.call(el.classList, 0, 12),
            selector: current.path,
            rect: { width: Math.round(r.width), height: Math.round(r.height) },
            viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
            text: String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
            childCount: el.children.length,
            isLeaf: el.children.length === 0,
            html: html,
            computed: computed,
        };
    }

    function summary() {
        return {
            hasTarget: !!current,
            stale: !!(current && current.stale),
            targetId: current ? current.id : null,
            changes: current ? current.store.changes() : [],
            canUndo: !!(current && current.store.canUndo()),
            canRedo: !!(current && current.store.canRedo()),
            history: current ? current.store.log.slice() : [],
            enabled: enabled,
            sessions: sessions.size,
            active: Array.from(sessions.values()).filter(hasOverrides).length,
        };
    }

    // ── Patching ───────────────────────────────────────────────────────
    function validateAgainstDom(s, patch) {
        const errors = [];
        const ops = (patch && patch.operations) || [];
        const wantsText = ops.some(function (o) { return o && o.op === 'text'; });
        if (wantsText && s.el.children.length > 0) errors.push('Text can only be replaced on an element with no child elements. Select the inner text element instead.');
        ops.forEach(function (o, i) {
            if (o && o.op === 'set' && root.CSS && root.CSS.supports) {
                const probe = Core.validateDeclaration(o.property, o.value);
                if (probe.ok && !root.CSS.supports(o.property, probe.value)) errors.push('Operation ' + (i + 1) + ': the browser does not accept "' + o.property + ': ' + probe.value + '".');
            }
        });
        return errors;
    }

    function apply(patch, label, options) {
        if (!current) return { ok: false, errors: ['Select a target section first.'], code: 'no_target' };
        refresh();
        if (current.stale || !current.el.isConnected) return { ok: false, errors: ['The selected element is no longer on the page. Select it again.'], code: 'target_stale' };
        const domErrors = validateAgainstDom(current, patch);
        if (domErrors.length) return { ok: false, errors: domErrors, code: 'invalid_patch' };
        const res = current.store.apply(patch, label, options);
        if (!res.ok) return { ok: false, errors: res.errors, code: 'invalid_patch' };
        if (res.changed) { render(); }
        return { ok: true, changed: res.changed, errors: [], summary: summary() };
    }

    function history(action) {
        if (!current) return false;
        const done = current.store[action]();
        if (done) render();
        return done;
    }

    function resetSession(s) {
        const wasText = s.originalText !== null;
        s.store.reset();
        if (wasText && s.el.isConnected) { s.el.textContent = s.originalText; }
        s.originalText = null;
        untag(s);
    }

    function reset() {
        if (!current) return false;
        resetSession(current);
        render();
        return true;
    }

    function resetAll() {
        sessions.forEach(resetSession);
        sessions.clear();
        current = null;
        enabled = true;
        render();
    }

    function setEnabled(on_) {
        enabled = !!on_;
        if (!enabled) sessions.forEach(function (s) { if (s.originalText !== null && s.el.isConnected) s.el.textContent = s.originalText; });
        render();
    }

    // ── Export ─────────────────────────────────────────────────────────
    function exportData(opts) {
        opts = opts || {};
        if (!current) return { ok: false, error: 'Select a target section first.', code: 'no_target' };
        refresh();
        if (current.stale || !current.el.isConnected) return { ok: false, error: 'The selected element is no longer on the page.', code: 'target_stale' };
        const framework = Core.FRAMEWORKS[opts.framework] ? opts.framework : 'html';
        const important = opts.important !== false;
        const el = current.el;
        const className = Core.exportClassName(Array.prototype.slice.call(el.classList));
        const useClass = framework === 'react' || framework === 'next';
        const selector = useClass ? '.' + className : current.path;
        const css = current.store.toCss(selector, { important: important });

        let html = '';
        if (opts.includeHtml !== false) {
            // Export the element as the page really shows it: with the preview, not the original.
            const clone = el.cloneNode(true);
            clone.removeAttribute(ATTR);
            if (useClass && !clone.classList.contains(className)) clone.classList.add(className);
            try { html = Core.sanitizeHtml(clone.outerHTML); } catch (e) { html = ''; }
        }
        const out = Core.buildExport({ css: css, html: html, framework: framework, className: className, selectorLabel: selector });
        return { ok: true, framework: framework, selector: selector, className: className, css: out.css, html: out.html, guidance: out.guidance, notes: out.notes, changes: current.store.changes(), empty: !css && !current.store.state.text };
    }

    // ── Picker ─────────────────────────────────────────────────────────
    const BLOCKED = ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend', 'submit', 'dragstart', 'selectstart'];

    function overlay() {
        const o = document.createElement('codex-design-ai-hl');
        Object.assign(o.style, {
            position: 'fixed', display: 'none', pointerEvents: 'none', zIndex: '2147483646', boxSizing: 'border-box',
            border: '2px solid #4fd1c5', background: 'rgba(79,209,197,0.14)', borderRadius: '2px', transition: 'all 60ms linear',
        });
        const label = document.createElement('span');
        Object.assign(label.style, {
            position: 'absolute', left: '-2px', top: '-22px', padding: '2px 6px', font: '600 11px/16px ui-monospace, Menlo, monospace',
            background: '#4fd1c5', color: '#07201d', borderRadius: '3px 3px 0 0', whiteSpace: 'nowrap', pointerEvents: 'none',
        });
        o.appendChild(label);
        document.documentElement.appendChild(o);
        return { box: o, label: label };
    }

    // Events from the Design Inspector AI panel itself must pass through while picking.
    function fromOwn(e) {
        const path = e.composedPath ? e.composedPath() : [e.target];
        return path.some(function (n) { return n && n.nodeType === 1 && n.matches && n.matches(OWN_SELECTOR); });
    }

    function pickable(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el || isOwn(el) || el === document.documentElement) return null;
        return el;
    }

    function startPicker(callbacks) {
        if (picking) stopPicker();
        const ui = overlay();
        const prevCursor = document.documentElement.style.cursor;
        document.documentElement.style.cursor = 'crosshair';
        const state = { ui: ui, hover: null, callbacks: callbacks || {}, prevCursor: prevCursor, handlers: [] };

        function place() {
            const el = state.hover;
            if (!el || !el.isConnected) { ui.box.style.display = 'none'; return; }
            const r = el.getBoundingClientRect();
            Object.assign(ui.box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
            ui.label.firstChild && ui.label.removeChild(ui.label.firstChild);
            ui.label.appendChild(document.createTextNode(cssPath(el).split(' > ').pop() + '  ' + Math.round(r.width) + '×' + Math.round(r.height)));
            ui.label.style.top = r.top < 24 ? (r.height + 2) + 'px' : '-22px';
        }
        function onMove(e) {
            if (fromOwn(e)) { if (state.hover) { state.hover = null; place(); } return; }
            const el = pickable(e.clientX, e.clientY);
            if (el !== state.hover) { state.hover = el; place(); }
        }
        function onPick(e) {
            if (fromOwn(e)) return;
            e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
            const el = pickable(e.clientX, e.clientY) || state.hover;
            if (!el) return;
            const cb = state.callbacks.onPick;
            stopPicker();
            const s = setTarget(el);
            emit('pick', { id: s && s.id });
            if (cb) cb(el);
        }
        function onKey(e) {
            if (fromOwn(e) && e.key !== 'Escape') return;
            if (e.key !== 'Escape') {
                // typing must not reach the site while picking
                if (!e.metaKey && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); }
                return;
            }
            e.preventDefault(); e.stopImmediatePropagation();
            const cb = state.callbacks.onCancel;
            stopPicker();
            if (cb) cb();
        }
        function block(e) {
            if (fromOwn(e)) return;
            e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
        }
        function add(type, fn, opts) { window.addEventListener(type, fn, opts); state.handlers.push([type, fn, opts]); }
        BLOCKED.forEach(function (t) { add(t, t === 'click' ? onPick : block, true); });
        add('mousemove', onMove, true);
        add('keydown', onKey, true);
        add('keypress', block, true);
        add('keyup', block, true);
        add('scroll', place, true);
        add('resize', place, true);
        picking = state;
        return true;
    }

    function stopPicker() {
        if (!picking) return false;
        picking.handlers.forEach(function (h) { window.removeEventListener(h[0], h[1], h[2]); });
        picking.ui.box.remove();
        document.documentElement.style.cursor = picking.prevCursor;
        picking = null;
        return true;
    }

    // ── Lifecycle ──────────────────────────────────────────────────────
    function destroy() {
        stopPicker();
        resetAll();
        if (observer) { observer.disconnect(); observer = null; }
        clearTimeout(observerTimer);
        Object.keys(listeners).forEach(function (k) { listeners[k] = []; });
        delete root.CodexDesignEngine;
    }

    watch();

    root.CodexDesignEngine = {
        ATTR, STYLE_ID,
        on, startPicker, stopPicker, isPicking: function () { return !!picking; },
        setTarget, selectBySelector, selectParent, hasTarget: function () { return !!current; },
        targetElement: function () { return current && current.el.isConnected ? current.el : null; },
        context, summary, apply, undo: function () { return history('undo'); }, redo: function () { return history('redo'); },
        reset, resetAll, setEnabled, exportData, refresh, destroy, cssPath,
    };
})(typeof self !== 'undefined' ? self : this);
