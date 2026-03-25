// Content script to be injected into iframes for scroll and interaction sync
(function () {
    'use strict';

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

    let scrollTimeout;
    window.addEventListener('scroll', function () {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(function () {
            const scrollPercentX = window.scrollX / (document.documentElement.scrollWidth - window.innerWidth);
            const scrollPercentY = window.scrollY / (document.documentElement.scrollHeight - window.innerHeight);

            window.parent.postMessage({
                type: 'IFRAME_SCROLL',
                scrollPercentX: isNaN(scrollPercentX) ? 0 : scrollPercentX,
                scrollPercentY: isNaN(scrollPercentY) ? 0 : scrollPercentY,
                frameId: window.frameElement ? window.frameElement.dataset.frameId : null
            }, '*');
        }, 50);
    }, { passive: true });



    // --- CLICK & INPUT SYNC ---

    function onClick(e) {
        if (!e.isTrusted) return;
        const target = e.target;
        if (!target) return;

        const path = getDomPath(target);

        window.parent.postMessage({
            type: 'IFRAME_CLICK',
            path: path,
            frameId: window.frameElement ? window.frameElement.dataset.frameId : null
        }, '*');
    }

    function onInput(e) {
        if (!e.isTrusted) return;
        const target = e.target;
        if (!target) return;

        const path = getDomPath(target);

        window.parent.postMessage({
            type: 'IFRAME_INPUT',
            path: path,
            value: target.value,
            frameId: window.frameElement ? window.frameElement.dataset.frameId : null
        }, '*');
    }

    window.addEventListener('click', onClick);
    window.addEventListener('input', onInput);

    // --- MESSAGE LISTENER ---

    window.addEventListener('message', function (event) {
        if (event.data.type === 'SYNC_SCROLL') {
            const targetX = event.data.scrollPercentX * (document.documentElement.scrollWidth - window.innerWidth);
            const targetY = event.data.scrollPercentY * (document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo({
                left: isNaN(targetX) ? 0 : targetX,
                top: isNaN(targetY) ? 0 : targetY,
                behavior: 'auto'
            });
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
