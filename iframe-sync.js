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

    function reportScroll() {
        const maxX = document.documentElement.scrollWidth - window.innerWidth;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        window.parent.postMessage({
            type: 'IFRAME_SCROLL',
            scrollPercentX: maxX > 0 ? window.scrollX / maxX : 0,
            scrollPercentY: maxY > 0 ? window.scrollY / maxY : 0
        }, VIEWER_ORIGIN);
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

    function applySyncScroll(data) {
        const maxX = document.documentElement.scrollWidth - window.innerWidth;
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        applyingSync = true;
        clearTimeout(applyingTimer);
        // Ignore our own scroll events until the incoming stream pauses
        applyingTimer = setTimeout(() => { applyingSync = false; }, 120);
        // 'instant' overrides sites that set scroll-behavior: smooth
        window.scrollTo({
            left: Math.max(0, (data.scrollPercentX || 0) * maxX),
            top: Math.max(0, (data.scrollPercentY || 0) * maxY),
            behavior: 'instant'
        });
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
    // Only obey the extension's own responsive viewer.

    window.addEventListener('message', function (event) {
        if (event.origin !== VIEWER_ORIGIN || event.source !== window.parent || !event.data) return;

        if (typeof event.data.type === 'string' && event.data.type.startsWith('CODEX_CAPTURE_')) {
            handleCapture(event.data).then(result => {
                if (result) event.source.postMessage({ type: 'CODEX_CAPTURE_REPLY', id: event.data.id, ...result }, event.origin);
            });
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
