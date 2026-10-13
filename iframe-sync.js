// Content script to be injected into iframes for scroll and interaction sync
(function () {
    'use strict';

    // This content script runs in every frame of every site. It must only
    // ever talk to the extension's own responsive viewer: never send clicks
    // or typed values to (or take commands from) any other page that happens
    // to embed a site in a frame.
    const VIEWER_ORIGIN = 'chrome-extension://' + chrome.runtime.id;
    const inViewer = window !== window.top && window.parent === window.top
        && !!location.ancestorOrigins && location.ancestorOrigins[0] === VIEWER_ORIGIN;
    if (!inViewer) return;

    // --- UTILITIES (Inlined for simplicity in non-bundled environment) ---

    function getDomPath(el) {
        const stack = [];
        while (el.parentElement != null) {
            let sibCount = 0;
            let sibIndex = 0;
            for (let i = 0; i < el.parentElement.childNodes.length; i++) {
                let sib = el.parentElement.childNodes[i];
                if (sib.nodeName === el.nodeName) {
                    if (sib === el) {
                        sibIndex = sibCount;
                    }
                    sibCount++;
                }
            }
            if (el.hasAttribute('id') && el.id !== '') {
                stack.unshift(el.nodeName.toLowerCase() + '#' + el.id);
            } else if (sibCount > 1) {
                stack.unshift(el.nodeName.toLowerCase() + ':eq(' + sibIndex + ')');
            } else {
                stack.unshift(el.nodeName.toLowerCase());
            }
            el = el.parentElement;
        }
        return stack.join(' > ');
    }

    function findWrappingSvg(element) {
        if (!element) return null;
        if (element.tagName === 'svg') return element;
        if (element !== document.body && element.parentElement) return findWrappingSvg(element.parentElement);
        return null;
    }

    function splitPath(path) {
        const splitByDotRegexUsingEq = /(:eq\(.*?\))/gi;
        return path.trim().split(splitByDotRegexUsingEq).map(r => {
            if (r.startsWith(':eq')) {
                const match = r.match(/([0-9])/g);
                return match ? parseInt(match.join('')) : 0;
            }
            r = r.trim();
            return r.startsWith('>') ? `:scope ${r}` : r;
        }).filter(r => r !== '');
    }

    function findElement(path) {
        const paths = splitPath(path);
        let element = document.documentElement;
        while (paths.length > 0) {
            const path = paths.shift();
            let index = 0;
            if (typeof paths[0] === 'number') index = paths.shift();

            if (typeof path === 'string') {
                if (index > 0) {
                    const found = element.querySelectorAll(path);
                    element = found[index];
                } else {
                    element = element.querySelector(path);
                }
            }
            if (!element) return null;
        }
        if (!element) return null;
        const wrappingSvg = findWrappingSvg(element);
        if (wrappingSvg) return wrappingSvg.parentElement || wrappingSvg;
        return element;
    }

    // --- SCROLL SYNC ---
    // Report scroll position continuously while scrolling (not only after
    // scrolling stops), so the other devices follow in real time. Scrolls
    // applied *from* another device are not reported back, which would make
    // the devices fight each other.
    let syncEnabled = false;
    let applyingSync = false;
    let applyingTimer = null;
    let lastReport = 0;
    let trailingReport = null;

    // Devices are matched by content, not by percentage: a phone page is far
    // taller than the desktop one, so the same percentage shows different
    // content and moves each device at a different speed. The reported anchor
    // is the element under a reading line 30% down the viewport, plus how far
    // through it that line is; the other devices put the same point of the
    // same element on their own reading line.
    const READ_LINE = 0.3;
    let anchorCache = { el: null, path: '' };

    function scrollMetrics() {
        const maxX = document.documentElement.scrollWidth - window.innerWidth;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        return { maxX, maxY };
    }

    function findAnchor() {
        const lineY = window.innerHeight * READ_LINE;
        let el = document.elementFromPoint(window.innerWidth / 2, lineY);
        while (el && el !== document.body && el !== document.documentElement) {
            const cs = getComputedStyle(el);
            // A fixed header or overlay doesn't move with the page
            if (cs.position === 'fixed' || cs.position === 'sticky') return null;
            const r = el.getBoundingClientRect();
            if (r.height >= 24 && cs.display !== 'inline' && r.top <= lineY && r.bottom >= lineY) {
                if (anchorCache.el !== el) anchorCache = { el, path: getDomPath(el) };
                return { path: anchorCache.path, frac: (lineY - r.top) / r.height };
            }
            el = el.parentElement;
        }
        return null;
    }

    function reportScroll() {
        const { maxX, maxY } = scrollMetrics();
        const msg = {
            type: 'IFRAME_SCROLL',
            scrollPercentX: maxX > 0 ? window.scrollX / maxX : 0,
            scrollPercentY: maxY > 0 ? window.scrollY / maxY : 0
        };
        // At the very top or bottom the percentage is exact; use it
        if (msg.scrollPercentY > 0.002 && msg.scrollPercentY < 0.998) {
            const a = findAnchor();
            if (a) { msg.anchor = a.path; msg.anchorFrac = a.frac; }
        }
        window.parent.postMessage(msg, VIEWER_ORIGIN);
    }

    // Scroll events already arrive at most once per repaint; report them right
    // away (capped at ~60/s) plus once more when scrolling stops, so the final
    // position always lands.
    window.addEventListener('scroll', function () {
        if (!syncEnabled || applyingSync) return;
        const now = performance.now();
        clearTimeout(trailingReport);
        if (now - lastReport >= 16) {
            lastReport = now;
            reportScroll();
        }
        trailingReport = setTimeout(reportScroll, 50);
    }, { passive: true });

    let resolvedAnchor = { path: '', el: null };
    function anchorTarget(data) {
        if (!data.anchor) return null;
        let el = resolvedAnchor.path === data.anchor && resolvedAnchor.el && resolvedAnchor.el.isConnected ? resolvedAnchor.el : null;
        if (!el) {
            try { el = findElement(data.anchor); } catch (e) { el = null; }
            resolvedAnchor = { path: data.anchor, el };
        }
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (!r.height) return null; // hidden at this size
        const pos = getComputedStyle(el).position;
        if (pos === 'fixed' || pos === 'sticky') return null;
        return window.scrollY + r.top + (data.anchorFrac || 0) * r.height - window.innerHeight * READ_LINE;
    }

    // Apply at most once per frame, always the newest position
    let pendingSync = null;
    let syncFrame = 0;
    function applySyncScroll(data) {
        pendingSync = data;
        applyingSync = true;
        clearTimeout(applyingTimer);
        // Ignore our own scroll events until the incoming stream pauses
        applyingTimer = setTimeout(() => { applyingSync = false; }, 150);
        if (!syncFrame) syncFrame = requestAnimationFrame(flushSyncScroll);
    }

    function flushSyncScroll() {
        syncFrame = 0;
        const data = pendingSync;
        pendingSync = null;
        if (!data) return;
        const { maxX, maxY } = scrollMetrics();
        let top = anchorTarget(data);
        if (top == null) top = (data.scrollPercentY || 0) * maxY;
        top = Math.round(Math.min(Math.max(0, top), Math.max(0, maxY)));
        const left = Math.round(Math.max(0, (data.scrollPercentX || 0) * maxX));
        if (Math.abs(top - window.scrollY) < 1 && Math.abs(left - window.scrollX) < 1) return;
        // 'instant' overrides sites that set scroll-behavior: smooth
        window.scrollTo({ left, top, behavior: 'instant' });
    }

    // --- CLICK & INPUT SYNC ---

    function onClick(e) {
        if (!e.isTrusted) return;
        const target = e.target;
        if (!target) return;

        const path = getDomPath(target);

        window.parent.postMessage({
            type: 'IFRAME_CLICK',
            path: path
        }, VIEWER_ORIGIN);
    }

    function onInput(e) {
        if (!e.isTrusted) return;
        const target = e.target;
        if (!target) return;
        // Never mirror passwords or payment fields into other frames
        if (target.type === 'password' || /cc-|card/i.test(target.autocomplete || '')) return;

        const path = getDomPath(target);

        window.parent.postMessage({
            type: 'IFRAME_INPUT',
            path: path,
            value: target.value
        }, VIEWER_ORIGIN);
    }

    window.addEventListener('click', onClick);
    window.addEventListener('input', onInput);

    // --- FULL-PAGE CAPTURE (driven by the responsive viewer) ---
    // The viewer scrolls this frame step by step and screenshots each step;
    // fixed/sticky elements are hidden after the first step so headers and
    // chat widgets don't repeat in the stitched image.
    const capture = { hidden: [], savedY: 0 };
    const wait = ms => new Promise(r => setTimeout(r, ms));
    // Wait for a repaint, but never hang: Chrome pauses animation frames in
    // throttled or off-screen frames, so fall back to a short timeout.
    const frames = () => new Promise(r => {
        const timer = setTimeout(r, 100);
        requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); r(); }));
    });
    const pageHeight = () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);

    function hideFixed(keepTop) {
        document.querySelectorAll('body *').forEach(el => {
            if (el.hasAttribute('data-codex-capture-hidden')) return;
            const pos = getComputedStyle(el).position;
            if (pos !== 'fixed' && pos !== 'sticky') return;
            if (keepTop && el.getBoundingClientRect().top < window.innerHeight / 2) return;
            capture.hidden.push({ el, value: el.style.getPropertyValue('visibility'), priority: el.style.getPropertyPriority('visibility') });
            el.setAttribute('data-codex-capture-hidden', '');
            el.style.setProperty('visibility', 'hidden', 'important');
        });
    }

    function restoreFixed() {
        capture.hidden.forEach(({ el, value, priority }) => {
            el.style.setProperty('visibility', value, priority);
            el.removeAttribute('data-codex-capture-hidden');
        });
        capture.hidden = [];
    }

    async function handleCapture(data) {
        if (data.type === 'CODEX_CAPTURE_BEGIN') {
            capture.savedY = window.scrollY;
            // Scroll through once so lazy-loaded content and scroll animations render
            for (let y = 0, i = 0; y < pageHeight() && i < 60; y += window.innerHeight, i++) {
                window.scrollTo({ top: y, behavior: 'instant' });
                await wait(120);
            }
            window.scrollTo({ top: 0, behavior: 'instant' });
            await frames();
            return { scrollHeight: pageHeight(), innerHeight: window.innerHeight, innerWidth: window.innerWidth };
        }
        if (data.type === 'CODEX_CAPTURE_SCROLL') {
            window.scrollTo({ top: data.y, behavior: 'instant' });
            // First step keeps top-anchored bars (the site's navbar) once
            hideFixed(data.first);
            await frames();
            await wait(80);
            return { scrollY: window.scrollY, scrollHeight: pageHeight() };
        }
        if (data.type === 'CODEX_CAPTURE_END') {
            restoreFixed();
            window.scrollTo({ top: capture.savedY, behavior: 'instant' });
            return {};
        }
        return null;
    }

    // --- MESSAGE LISTENER ---
    // --- RESPONSIVE AUDIT (probes + numbered pins, driven by the viewer's Audit drawer) ---
    // Only these read-only probes (and the CSS preview patch) can be requested.
    const RA_PROBES = ['audit', 'fingerprint', 'inspect', 'styles', 'patch', 'clearPatch', 'waitStable'];
    const RA_COLORS = { high: '#f07575', medium: '#e8a64a', low: '#6fb3ec', info: '#4fd1c5' };
    let raHost = null, raRoot = null, raMarks = [], raWatch = false;

    function raEnsureHost() {
        if (raHost && raHost.isConnected) return;
        raHost = document.createElement('codex-ra-marks');
        raHost.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;';
        raRoot = raHost.attachShadow({ mode: 'closed' });
        document.documentElement.appendChild(raHost);
    }

    // Marks follow their element when it can still be found, else use the audited box
    function raLayout() {
        if (!raRoot) return;
        raRoot.replaceChildren();
        raMarks.forEach(m => {
            let r = null;
            try { const el = m.selector && document.querySelector(m.selector); if (el) { const b = el.getBoundingClientRect(); if (b.width || b.height) r = { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height }; } } catch (e) { /* bad selector: use the stored box */ }
            if (!r && m.rect) r = { x: m.rect.x, y: m.rect.y, w: m.rect.width, h: m.rect.height };
            if (!r) return;
            const color = RA_COLORS[m.severity] || RA_COLORS.info;
            const box = document.createElement('div');
            box.dataset.id = m.id;
            box.style.cssText = `position:absolute;left:${r.x}px;top:${r.y}px;width:${Math.max(r.w, 4)}px;height:${Math.max(r.h, 4)}px;outline:2px solid ${color};outline-offset:-1px;background:${color}1f;box-sizing:border-box;border-radius:3px;`;
            const badge = document.createElement('span');
            badge.textContent = String(m.n);
            badge.style.cssText = `position:absolute;left:-2px;top:-2px;transform:translateY(-100%);min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:9px 9px 9px 0;background:${color};color:#101114;font:700 11px/18px -apple-system,system-ui,sans-serif;text-align:center;`;
            box.appendChild(badge);
            raRoot.appendChild(box);
        });
    }

    function raMark(marks) {
        raEnsureHost();
        raMarks = (marks || []).map(m => ({ id: String(m.id), n: m.n, selector: typeof m.selector === 'string' ? m.selector.slice(0, 300) : '', severity: m.severity, rect: m.rect }));
        raLayout();
        if (!raWatch) { raWatch = true; window.addEventListener('resize', () => raLayout()); }
    }

    function raFocus(id) {
        const m = raMarks.find(x => x.id === id);
        if (!m) return false;
        let el = null;
        try { el = m.selector && document.querySelector(m.selector); } catch (e) { /* stored box only */ }
        if (el) el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        else if (m.rect) window.scrollTo({ top: Math.max(0, m.rect.y - innerHeight / 3), behavior: 'smooth' });
        const box = raRoot && raRoot.querySelector(`[data-id="${CSS.escape(id)}"]`);
        if (box && box.animate) box.animate([{ boxShadow: '0 0 0 0 rgba(255,255,255,.9)' }, { boxShadow: '0 0 0 14px rgba(255,255,255,0)' }], { duration: 900, iterations: 2 });
        return true;
    }

    async function handleResponsive(data) {
        try {
            if (data.type === 'CODEX_RA_PROBE') {
                if (!RA_PROBES.includes(data.probe) || !self.CodexProbes) return { ok: false, error: 'Probe not available.' };
                return { ok: true, result: await self.CodexProbes.run(data.probe, data.params || {}) };
            }
            if (data.type === 'CODEX_RA_MARK') { raMark(Array.isArray(data.marks) ? data.marks.slice(0, 200) : []); return { ok: true }; }
            if (data.type === 'CODEX_RA_FOCUS') return { ok: true, found: raFocus(String(data.id)) };
            if (data.type === 'CODEX_RA_CLEAR') { raMarks = []; raLayout(); return { ok: true }; }
            return { ok: false, error: 'Unknown request.' };
        } catch (e) {
            return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
        }
    }

    // Only obey the extension's own responsive viewer.

    window.addEventListener('message', function (event) {
        if (event.origin !== VIEWER_ORIGIN || event.source !== window.parent || !event.data) return;

        if (typeof event.data.type === 'string' && event.data.type.startsWith('CODEX_CAPTURE_')) {
            handleCapture(event.data).then(result => {
                if (result) event.source.postMessage({ type: 'CODEX_CAPTURE_REPLY', id: event.data.id, ...result }, event.origin);
            });
            return;
        }

        if (typeof event.data.type === 'string' && event.data.type.startsWith('CODEX_RA_')) {
            handleResponsive(event.data).then(result => event.source.postMessage({ type: 'CODEX_RA_REPLY', id: event.data.id, ...result }, event.origin));
            return;
        }

        if (event.data.type === 'ENABLE_SYNC_SCROLL') { syncEnabled = true; return; }
        if (event.data.type === 'DISABLE_SYNC_SCROLL') { syncEnabled = false; return; }

        if (event.data.type === 'SYNC_SCROLL') {
            applySyncScroll(event.data);
        }

        if (event.data.type === 'SYNC_CLICK') {
            const element = findElement(event.data.path);
            if (element) {
                if (element.tagName.toLowerCase() === 'input') {
                    element.focus();
                } else {
                    element.click();
                }
            }
        }

        if (event.data.type === 'SYNC_INPUT') {
            const element = findElement(event.data.path);
            if (element) {
                element.value = event.data.value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }
    });

})();
