// Codex AI chat panel (content script, isolated world).
//
// Opened from the Design Inspector's AI button. Reads the inspector's current
// selection ([data-selected]), sends the elements' HTML + key styles and the
// user's request to background.js (which calls Claude or OpenAI with the user's own
// key), then applies the returned edits to the live page with undo.
//
// Runs in the extension's isolated world on purpose: page scripts can't call
// chrome.runtime, so they can't trigger requests billed to the user's key.
(function () {
    'use strict';
    if (window.__codexAiPanel) return;
    window.__codexAiPanel = true;

    const HOST_TAG = 'codex-ai-panel';
    const MAX_ELEMENTS = 5;
    const MAX_HTML = 12000;
    const MAX_HISTORY_TURNS = 10;
    // Attributes the inspector adds to page elements; never sent to the AI
    const INSPECTOR_ATTRS = ['data-selected', 'data-selected-hide', 'data-label-id', 'data-measuring', 'data-pseudo-select'];
    const STYLE_KEYS = ['display', 'position', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap',
        'grid-template-columns', 'width', 'height', 'max-width', 'margin', 'padding', 'color', 'background-color',
        'background-image', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align',
        'border', 'border-radius', 'box-shadow', 'opacity'];
    const SUGGESTIONS = ['Make this section look more modern', 'Put these cards in a row', 'Add a nice hover effect', 'Make the text easier to read'];

    const icon = (name, size) => (window.CodexIcons ? window.CodexIcons.svg(name, size || 16) : '');

    // ── State ──────────────────────────────────────────────────────────
    let host = null, shadow = null, els = {};
    let busy = false;
    let targets = [];            // elements the next request applies to
    const history = [];          // earlier turns sent back to the AI
    const turns = [];            // rendered assistant turns (for undo)

    // ── Messaging with background.js ───────────────────────────────────
    function rpc(message) {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage(message, response => {
                    if (chrome.runtime.lastError) resolve({ ok: false, error: { code: 'runtime', message: chrome.runtime.lastError.message } });
                    else resolve(response || { ok: false, error: { code: 'empty', message: 'No response from the extension.' } });
                });
            } catch (e) {
                resolve({ ok: false, error: { code: 'runtime', message: 'The extension was reloaded. Refresh the page to use Codex AI.' } });
            }
        });
    }

    // ── Selection ──────────────────────────────────────────────────────
    function isOwnNode(node) {
        return !!(node.closest && (node.closest(HOST_TAG) || node.closest('codex-inspector')));
    }
    function currentSelection() {
        return [...document.querySelectorAll('[data-selected="true"]')].filter(n => !isOwnNode(n)).slice(0, MAX_ELEMENTS);
    }
    // Keep targeting the last edited elements when the selection disappears
    // (for example after an HTML replacement removed the selected node).
    function refreshTargets() {
        const selected = currentSelection();
        targets = selected.length ? selected : targets.filter(n => n.isConnected);
        renderTarget();
    }

    function shortSelector(el) {
        let s = el.tagName.toLowerCase();
        if (el.id) return s + '#' + el.id;
        const classes = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(c => c && !c.startsWith('codex-')).slice(0, 2);
        if (classes.length) s += '.' + classes.join('.');
        return s;
    }
    function selectorPath(el) {
        const parts = [];
        for (let n = el; n && n !== document.body && parts.length < 4; n = n.parentElement) parts.unshift(shortSelector(n));
        return parts.join(' > ');
    }

    // ── Context for the AI ─────────────────────────────────────────────
    function cleanHTML(el) {
        const clone = el.cloneNode(true);
        [clone, ...clone.querySelectorAll('*')].forEach(n => INSPECTOR_ATTRS.forEach(a => n.removeAttribute(a)));
        return clone.outerHTML.replace(/\s{2,}/g, ' ');
    }
    function styleSummary(el, keys) {
        const cs = getComputedStyle(el);
        return keys.map(k => `${k}: ${cs.getPropertyValue(k)}`).filter(line => !/: (none|normal|auto|0px)?$/.test(line)).join('; ');
    }
    // Stable handle for each edited element, used by the AI's "css" rules
    let nextId = 1;
    function aiId(el) {
        if (!el.hasAttribute('data-cx-ai')) el.setAttribute('data-cx-ai', 'k' + (nextId++));
        return el.getAttribute('data-cx-ai');
    }

    const TRANSPARENT = /^(transparent|rgba\(0, 0, 0, 0\))$/;
    // The color actually behind an element (first ancestor with a background)
    function sitsOn(el) {
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') return `${cs.backgroundColor} with background image ${cs.backgroundImage.slice(0, 120)}`;
            if (!TRANSPARENT.test(cs.backgroundColor)) return cs.backgroundColor;
        }
        return 'rgb(255, 255, 255) (browser default)';
    }

    // Summary of the page's own design system, so edits match the site
    function designContext() {
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !isOwnNode(el); };
        const lines = [];
        const sample = (sel, label) => {
            const el = [...document.querySelectorAll(sel)].find(visible);
            if (!el) return;
            const cs = getComputedStyle(el);
            lines.push(`${label}: ${cs.fontFamily.split(',').slice(0, 2).join(',')}; ${cs.fontSize}/${cs.lineHeight} weight ${cs.fontWeight}; color ${cs.color}` +
                (cs.letterSpacing !== 'normal' ? `; letter-spacing ${cs.letterSpacing}` : ''));
        };
        sample('h1', 'H1'); sample('h2', 'H2'); sample('h3', 'H3'); sample('p', 'Body text'); sample('a[href]', 'Link');
        const bodyCs = getComputedStyle(document.body);
        lines.push(`Page background: ${sitsOn(document.body)}; base font ${bodyCs.fontFamily.split(',').slice(0, 2).join(',')} ${bodyCs.fontSize}`);

        const count = (map, key) => { if (key) map.set(key, (map.get(key) || 0) + 1); };
        const accents = new Map(), radii = new Map();
        [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')].filter(visible).slice(0, 200).forEach(el => {
            const cs = getComputedStyle(el);
            if (!TRANSPARENT.test(cs.backgroundColor)) count(accents, cs.backgroundColor);
            if (cs.borderRadius !== '0px') count(radii, cs.borderRadius);
        });
        const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
        if (accents.size) lines.push(`Button/accent colors in use: ${top(accents, 5).join(', ')}`);
        if (radii.size) lines.push(`Border radii in use: ${top(radii, 4).join(', ')}`);

        // Design tokens declared as CSS variables on :root / html
        const vars = [];
        try {
            for (const sheet of document.styleSheets) {
                let rules;
                try { rules = sheet.cssRules; } catch (e) { continue; }
                for (const rule of rules || []) {
                    if (!rule.style || !/^(:root|html)\b/.test(rule.selectorText || '')) continue;
                    for (const prop of rule.style) {
                        if (prop.startsWith('--') && vars.length < 40) {
                            const v = rule.style.getPropertyValue(prop).trim();
                            if (v && v.length < 60) vars.push(`${prop}: ${v}`);
                        }
                    }
                }
                if (vars.length >= 40) break;
            }
        } catch (e) { }
        if (vars.length) lines.push(`CSS variables (use them with var() where they fit): ${vars.join('; ')}`);
        return lines.join('\n');
    }

    function buildContext(list) {
        let truncated = false;
        const blocks = list.map((el, i) => {
            const id = aiId(el);
            const r = el.getBoundingClientRect();
            let html = cleanHTML(el);
            if (html.length > MAX_HTML) {
                html = html.slice(0, MAX_HTML) + `\n[HTML truncated: ${html.length - MAX_HTML} more characters not shown]`;
                truncated = true;
            }
            const parent = el.parentElement;
            return [
                `[${i}] ${selectorPath(el)}  (css selector: [data-cx-ai="${id}"])`,
                `Box: ${Math.round(r.width)}x${Math.round(r.height)}px at x=${Math.round(r.left)}, y=${Math.round(r.top)} in the viewport; sits on ${sitsOn(el.parentElement || el)}`,
                `HTML:\n${html}`,
                `Computed styles: ${styleSummary(el, STYLE_KEYS)}`,
                parent ? `Parent <${shortSelector(parent)}>: ${styleSummary(parent, ['display', 'flex-direction', 'justify-content', 'align-items', 'gap', 'grid-template-columns', 'width'])}` : '',
            ].filter(Boolean).join('\n');
        });
        let design = '';
        try { design = designContext(); } catch (e) { }
        const text = `Page: ${location.hostname}${location.pathname}\nViewport: ${window.innerWidth}x${window.innerHeight}` +
            (design ? `\n\nDesign system on this page:\n${design}` : '') +
            `\n\nSelected elements (${list.length}):\n\n${blocks.join('\n\n')}`;
        return { text, truncated };
    }

    // ── Applying edits (with undo) ─────────────────────────────────────
    const SAFE_PROP = /^-{0,2}[a-z][a-z0-9-]*$/i;
    const SAFE_ATTR = /^[a-z_:][\w:.-]*$/i;
    const BAD_URL = /^\s*(javascript|vbscript|data:text\/html)/i;

    // Model HTML goes into the live page, so strip anything executable.
    function sanitizeToNodes(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        tpl.content.querySelectorAll('script, iframe, object, embed, link, meta, base, frame, frameset').forEach(n => n.remove());
        tpl.content.querySelectorAll('*').forEach(n => {
            [...n.attributes].forEach(a => {
                const name = a.name.toLowerCase();
                if (name.startsWith('on') || name === 'srcdoc' || (/^(href|src|action|formaction|xlink:href|poster)$/.test(name) && BAD_URL.test(a.value))) {
                    n.removeAttribute(a.name);
                }
            });
        });
        return [...tpl.content.childNodes].filter(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    }

    // How the browser would compute a value (e.g. "white" -> "rgb(255, 255, 255)")
    function normalized(property, value) {
        const probe = document.createElement('span');
        probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none';
        probe.style.setProperty(property, value);
        document.documentElement.appendChild(probe);
        const result = getComputedStyle(probe).getPropertyValue(property);
        probe.remove();
        return result;
    }

    function setStyle(el, property, value) {
        if (/^transition/.test(property)) { el.style.setProperty(property, value); return; }
        // Selected elements animate style changes (the inspector sets
        // transition: all), so switch transitions off while checking whether
        // the new value actually took effect, then put the element's own back.
        const oldTransition = el.style.getPropertyValue('transition');
        const oldTransitionPriority = el.style.getPropertyPriority('transition');
        el.style.setProperty('transition', 'none', 'important');
        const before = getComputedStyle(el).getPropertyValue(property);
        el.style.setProperty(property, value);
        // Page stylesheets with higher priority can win; retry as !important,
        // unless the element already had the requested value
        if (getComputedStyle(el).getPropertyValue(property) === before && el.style.getPropertyValue(property)
            && normalized(property, value) !== before) {
            el.style.setProperty(property, value, 'important');
        }
        if (oldTransition) el.style.setProperty('transition', oldTransition, oldTransitionPriority);
        else el.style.removeProperty('transition');
    }

    // Put back an element's original style attribute instantly (no transition)
    // (the transition:none must be part of the same change as the restored
    // values, then removed on its own once they've landed)
    function restoreStyle(el, styleAttr) {
        el.setAttribute('style', (styleAttr ? styleAttr + ';' : '') + 'transition:none !important');
        getComputedStyle(el).color; // flush
        if (styleAttr === null) el.removeAttribute('style');
        else el.setAttribute('style', styleAttr);
    }

    // The AI's "css": a constructed stylesheet (not a <style> tag, so the
    // site's Content-Security-Policy can't block it). Every declaration is
    // forced to !important so it wins over the site's own rules.
    const BAD_CSS = /@import|expression\s*\(|javascript:|-moz-binding|behavior\s*:/i;
    function forceImportant(rules) {
        for (const rule of rules) {
            if (rule.style) for (const prop of [...rule.style]) rule.style.setProperty(prop, rule.style.getPropertyValue(prop), 'important');
            if (rule.cssRules) forceImportant(rule.cssRules);
        }
    }
    // Every style rule must be scoped to an edited element: rules that would
    // reach the rest of the page are removed (the rest of the sheet is kept)
    function dropUnscoped(parent, out = []) {
        for (let i = parent.cssRules.length - 1; i >= 0; i--) {
            const rule = parent.cssRules[i];
            if (rule.selectorText != null && rule.style) {
                const loose = rule.selectorText.split(',').map(x => x.trim()).filter(sel => !/\[data-cx-ai=/.test(sel));
                if (loose.length) { out.push(...loose); parent.deleteRule(i); }
            } else if (rule.cssRules && !(rule instanceof CSSKeyframesRule)) {
                dropUnscoped(rule, out);
            }
        }
        return out;
    }
    // Add a stylesheet to the page; returns a function that removes it.
    // Falls back to a <style> element if adopting isn't possible.
    function adopt(sheet) {
        try {
            document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
            return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(x => x !== sheet); };
        } catch (e) {
            const tag = document.createElement('style');
            tag.setAttribute('data-codex-ai', '');
            tag.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
            (document.head || document.documentElement).appendChild(tag);
            return () => tag.remove();
        }
    }

    function applyCss(css, problems) {
        if (!css || !css.trim()) return null;
        if (BAD_CSS.test(css)) { problems.push('css: contains a forbidden construct (@import, expression, javascript:) and was not applied'); return null; }
        let sheet;
        try {
            sheet = new CSSStyleSheet();
            sheet.replaceSync(css);
        } catch (e) { problems.push('css: could not be parsed (' + e.message + ')'); return null; }
        if (!sheet.cssRules.length) { problems.push('css: no valid rules were found, check the syntax'); return null; }
        const loose = dropUnscoped(sheet);
        if (loose.length) problems.push('css: rules with selectors not scoped to a [data-cx-ai] element were skipped: ' + loose.slice(0, 5).join(', '));
        if (!sheet.cssRules.length) return null;
        forceImportant(sheet.cssRules);
        return adopt(sheet);
    }

    function applyChanges(list, changes, css) {
        const undo = [];
        const applied = [];
        const problems = [];
        for (const change of changes || []) {
            let el = list[change.element];
            if (!el || !el.isConnected) { problems.push(`change for element ${change.element}: no such selected element`); continue; }
            const touched = [];

            if (change.html) {
                const nodes = sanitizeToNodes(change.html);
                if (!nodes.length) problems.push(`element ${change.element}: the html was empty after removing unsafe parts`);
                if (nodes.length) {
                    // Keep the handle so css rules still reach the new element
                    const id = el.getAttribute('data-cx-ai');
                    const root = nodes.find(n => n.nodeType === 1);
                    if (id && root && !root.hasAttribute('data-cx-ai')) root.setAttribute('data-cx-ai', id);
                    const original = el;
                    const anchor = document.createComment('codex-ai');
                    original.replaceWith(anchor);
                    nodes.forEach(n => anchor.before(n));
                    anchor.remove();
                    undo.push(() => { nodes[0].before(original); nodes.forEach(n => n.remove()); });
                    el = nodes.find(n => n.nodeType === 1) || el;
                    list[change.element] = el;
                    touched.push('structure');
                }
            }
            if (change.styles && change.styles.length) {
                const beforeStyle = el.getAttribute('style');
                const target = el;
                change.styles.forEach(s => {
                    const prop = (s.property || '').trim(), value = (s.value || '').trim().replace(/\s*!important\s*$/i, '');
                    if (!SAFE_PROP.test(prop)) { problems.push(`element ${change.element}: "${prop}" is not a CSS property name`); return; }
                    if (!prop.startsWith('--') && window.CSS && window.CSS.supports && !window.CSS.supports(prop, value)) {
                        problems.push(`element ${change.element}: "${prop}: ${value}" is not valid CSS`); return;
                    }
                    setStyle(target, prop, value);
                });
                undo.push(() => restoreStyle(target, beforeStyle));
                touched.push(...change.styles.map(s => s.property));
            }
            if (typeof change.text === 'string') {
                const beforeHTML = el.innerHTML;
                const target = el;
                target.textContent = change.text;
                undo.push(() => { target.innerHTML = beforeHTML; });
                touched.push('text');
            }
            if (change.attributes && change.attributes.length) {
                const target = el;
                change.attributes.forEach(a => {
                    const name = a.name.toLowerCase();
                    if (!SAFE_ATTR.test(name) || name.startsWith('on') || name === 'srcdoc' || BAD_URL.test(a.value)) return;
                    const prev = target.hasAttribute(a.name) ? target.getAttribute(a.name) : null;
                    target.setAttribute(a.name, a.value);
                    undo.push(() => { prev === null ? target.removeAttribute(a.name) : target.setAttribute(a.name, prev); });
                    touched.push(a.name);
                });
            }
            if (touched.length) applied.push({ label: shortSelector(el), touched });
        }
        const undoCss = applyCss(css, problems);
        if (undoCss) { undo.push(undoCss); applied.push({ label: 'stylesheet', touched: ['hover, responsive and child rules'] }); }
        return { applied, problems, undo: () => undo.slice().reverse().forEach(fn => { try { fn(); } catch (e) { /* node already gone */ } }) };
    }

    // ── Screenshot of the selection ────────────────────────────────────
    // Hides the inspector's overlays and this panel for a moment so the AI
    // sees the page as a visitor would.
    const CAPTURE_CSS = 'codex-inspector, codex-ai-panel, cxi-handles, cxi-handle, cxi-label, cxi-hover, cxi-distance, cxi-gridlines, cxi-overlay, cxi-metatip, cxi-ally, cxi-boxmodel, cxi-corners, cxi-grip, cxi-offscreen-label, cxi-hotkeys { visibility: hidden !important; } ' +
        '[data-selected], [data-pseudo-select], [data-hover] { outline: none !important; }';
    const nextFrame = () => new Promise(r => { const t = setTimeout(r, 120); requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(t); r(); })); });
    async function captureSelection(list) {
        const rects = list.map(el => el.getBoundingClientRect()).filter(r => r.width && r.height);
        if (!rects.length) return null;
        const pad = 32, vw = window.innerWidth, vh = window.innerHeight;
        const x0 = Math.max(0, Math.min(...rects.map(r => r.left)) - pad), y0 = Math.max(0, Math.min(...rects.map(r => r.top)) - pad);
        const x1 = Math.min(vw, Math.max(...rects.map(r => r.right)) + pad), y1 = Math.min(vh, Math.max(...rects.map(r => r.bottom)) + pad);
        if (x1 - x0 < 16 || y1 - y0 < 16) return null;
        let remove = null;
        try {
            const sheet = new CSSStyleSheet();
            sheet.replaceSync(CAPTURE_CSS);
            remove = adopt(sheet);
            await nextFrame();
            const res = await rpc({ action: 'AI_CAPTURE', rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0, vw }, dpr: window.devicePixelRatio || 1 });
            return (res && res.image) || null;
        } catch (e) {
            return null;
        } finally {
            if (remove) remove();
        }
    }

    // ── UI ─────────────────────────────────────────────────────────────
    const CSS = `
        :host { all: initial; display: block; }
        /* Closed popover must disappear (all:initial would otherwise keep it shown) */
        :host(:not(:popover-open)) { display: none !important; }
        * { box-sizing: border-box; }
        .panel {
            --bg: #16171a; --bg-2: #1d1e22; --border: rgba(255,255,255,.1); --text: #ececef; --muted: #9b9ca4;
            --accent: #4fd1c5; --accent-text: #5fd8cc; --accent-soft: rgba(79,209,197,.14); --on-accent: #07201d;
            --danger: #f07575; --purple: #9f7aea;
            display: flex; flex-direction: column;
            width: 380px; max-height: min(580px, calc(100vh - 120px));
            background: var(--bg); color: var(--text);
            border: 1px solid var(--border); border-radius: 14px;
            box-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 24px 60px -16px rgba(0,0,0,.6);
            font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            -webkit-font-smoothing: antialiased;
            overflow: hidden;
            animation: panel-in .3s cubic-bezier(.16,1,.3,1);
        }
        @media (prefers-color-scheme: light) {
            .panel { --bg: #ffffff; --bg-2: #f3f3f5; --border: rgba(17,18,22,.1); --text: #16171a; --muted: #5b5d65;
                --accent: #0f7f75; --accent-text: #0b7a70; --accent-soft: rgba(20,163,150,.1); --on-accent: #fff; --danger: #c93c3c;
                box-shadow: 0 24px 60px -16px rgba(17,18,22,.25); }
        }
        @keyframes panel-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) { .panel, .skeleton i { animation: none !important; } }
        .cx-icon { flex-shrink: 0; display: block; }
        button { font: inherit; color: inherit; }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        header { display: flex; align-items: center; gap: 8px; padding: 12px 12px 12px 14px; border-bottom: 1px solid var(--border); }
        .brand { display: flex; align-items: center; gap: 7px; font-weight: 650; font-size: 13.5px; }
        .brand .cx-icon { color: var(--accent); }
        .model { margin-left: auto; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
        .icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; flex: none;
            background: none; border: 1px solid var(--border); border-radius: 7px; color: var(--muted); cursor: pointer; }
        .icon-btn:hover { color: var(--text); background: var(--bg-2); }

        .target { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-bottom: 1px solid var(--border); font-size: 12px; color: var(--muted); }
        .target code { font: 11.5px ui-monospace, 'SF Mono', Menlo, monospace; color: var(--text); background: var(--bg-2);
            padding: 2px 6px; border-radius: 5px; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .target.is-empty { color: var(--muted); }

        .thread { flex: 1; min-height: 120px; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 12px;
            scrollbar-width: thin; scrollbar-color: var(--border) transparent; overscroll-behavior: contain; }
        .empty { margin: auto 0; text-align: center; color: var(--muted); }
        .empty p { margin: 0 0 12px; }
        .chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
        .chip { background: var(--bg-2); border: 1px solid var(--border); border-radius: 999px; padding: 5px 10px; font-size: 12px; cursor: pointer; }
        .chip:hover { border-color: var(--accent); color: var(--accent-text); }

        .msg { max-width: 92%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-wrap: break-word; }
        .msg.user { align-self: flex-end; background: var(--accent-soft); border-bottom-right-radius: 4px; }
        .msg.ai { align-self: flex-start; background: var(--bg-2); border-bottom-left-radius: 4px; white-space: normal; }
        .msg.ai p { margin: 0; }
        .msg.error { align-self: flex-start; color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); }
        .applied { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 4px; font-size: 11.5px; color: var(--muted); }
        .applied code { font: 11px ui-monospace, 'SF Mono', Menlo, monospace; color: var(--text); }
        .row { display: flex; gap: 6px; margin-top: 8px; }
        .ghost { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--border);
            border-radius: 7px; padding: 4px 9px; font-size: 12px; cursor: pointer; color: var(--text); }
        .ghost:hover { background: var(--bg); }
        .ghost:disabled { opacity: .5; cursor: default; }
        .note { margin-top: 6px; font-size: 11.5px; color: var(--muted); }

        .skeleton { align-self: flex-start; width: 70%; display: grid; gap: 6px; padding: 10px 12px; background: var(--bg-2); border-radius: 12px; }
        .skeleton i { display: block; height: 8px; border-radius: 4px;
            background: linear-gradient(90deg, var(--border), color-mix(in srgb, var(--accent) 30%, transparent), var(--border));
            background-size: 200% 100%; animation: shimmer 1.4s linear infinite; }
        .skeleton i:nth-child(2) { width: 80%; } .skeleton i:nth-child(3) { width: 55%; }
        @keyframes shimmer { to { background-position: -200% 0; } }

        .setup { padding: 22px 18px; text-align: center; display: grid; gap: 10px; justify-items: center; }
        .setup .badge { display: flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;
            background: var(--accent-soft); color: var(--accent-text); }
        .setup h3 { margin: 0; font-size: 14px; }
        .setup p { margin: 0; color: var(--muted); max-width: 280px; }
        .primary { background: var(--accent); color: var(--on-accent); border: none; border-radius: 8px; padding: 8px 14px;
            font-weight: 600; cursor: pointer; }
        .primary:hover { filter: brightness(1.08); }
        .primary:disabled { opacity: .5; cursor: default; }

        form { display: flex; gap: 8px; align-items: flex-end; padding: 10px 12px; border-top: 1px solid var(--border); }
        textarea { flex: 1; resize: none; min-height: 38px; max-height: 120px; padding: 9px 11px; border-radius: 10px;
            border: 1px solid var(--border); background: var(--bg-2); color: var(--text); font: inherit; outline: none; }
        textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
        textarea::placeholder { color: var(--muted); }
        .send { width: 38px; height: 38px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; }
        .foot { margin: 0; padding: 0 14px 10px; font-size: 11px; color: var(--muted); }
        .foot button { background: none; border: none; padding: 0; color: var(--accent-text); cursor: pointer; font-size: 11px; }
        [hidden] { display: none !important; }
    `;

    function build() {
        host = document.createElement(HOST_TAG);
        host.setAttribute('popover', 'manual');
        Object.assign(host.style, {
            position: 'fixed', inset: 'auto 16px 92px auto', margin: '0', padding: '0', border: '0',
            background: 'transparent', width: 'auto', height: 'auto', overflow: 'visible', zIndex: '2147483647',
        });
        shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = `
            <style>${CSS}</style>
            <section class="panel" role="dialog" aria-label="Codex AI">
                <header>
                    <span class="brand">${icon('sparkles', 16)}Codex AI</span>
                    <span class="model" data-el="model"></span>
                    <button class="icon-btn" data-el="close" aria-label="Close">${icon('x', 15)}</button>
                </header>
                <div class="target" data-el="target"></div>
                <div class="setup" data-el="setup" hidden>
                    <span class="badge">${icon('sparkles', 20)}</span>
                    <h3>Add your API key</h3>
                    <p>Codex AI runs on your own Claude (Anthropic) or ChatGPT (OpenAI) API key. Add one in settings to start editing with AI.</p>
                    <button class="primary" data-el="open-settings">Open settings</button>
                </div>
                <div class="thread" data-el="thread">
                    <div class="empty" data-el="empty">
                        <p>Select an element, then describe the change.</p>
                        <div class="chips">${SUGGESTIONS.map(s => `<button class="chip" type="button">${s}</button>`).join('')}</div>
                    </div>
                </div>
                <form data-el="form">
                    <textarea data-el="input" rows="1" maxlength="2000" placeholder="Describe a change, like “make this button green”" aria-label="Describe a change"></textarea>
                    <button class="primary send" data-el="send" aria-label="Send">${icon('chevron-right', 18)}</button>
                </form>
                <p class="foot"><span data-el="foot-text">Runs on your own API key.</span> <button type="button" data-el="settings-link">Settings</button></p>
            </section>`;
        shadow.querySelectorAll('[data-el]').forEach(n => { els[n.dataset.el] = n; });

        // Keep typing inside the panel away from the page and the inspector's
        // single-key shortcuts (G, I, M... would otherwise switch tools).
        ['keydown', 'keyup', 'keypress'].forEach(t => shadow.addEventListener(t, e => {
            e.stopPropagation();
            if (t === 'keydown' && e.key === 'Escape') { e.preventDefault(); close(); }
        }));

        els.close.addEventListener('click', close);
        els['open-settings'].addEventListener('click', () => rpc({ action: 'AI_OPEN_SETTINGS' }));
        els['settings-link'].addEventListener('click', () => rpc({ action: 'AI_OPEN_SETTINGS' }));
        els.form.addEventListener('submit', e => { e.preventDefault(); if (e.isTrusted !== false) send(els.input.value); });
        els.input.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(els.input.value); }
        });
        els.input.addEventListener('input', autoGrow);
        shadow.querySelectorAll('.chip').forEach(chip => chip.addEventListener('click', e => {
            if (!e.isTrusted) return;
            els.input.value = chip.textContent;
            send(chip.textContent);
        }));

        document.documentElement.appendChild(host);
        watchSelection();
    }

    function autoGrow() {
        els.input.style.height = 'auto';
        els.input.style.height = Math.min(els.input.scrollHeight, 120) + 'px';
    }

    function renderTarget() {
        if (!els.target) return;
        if (!targets.length) {
            els.target.className = 'target is-empty';
            els.target.innerHTML = `${icon('click', 14)}<span>Click an element on the page to select it</span>`;
            return;
        }
        els.target.className = 'target';
        els.target.innerHTML = `${icon('pointer', 14)}<span>Editing</span><code></code>${targets.length > 1 ? `<span>and ${targets.length - 1} more</span>` : ''}`;
        els.target.querySelector('code').textContent = shortSelector(targets[0]);
    }

    let observer = null;
    function watchSelection() {
        let pending = false;
        observer = new MutationObserver(() => {
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => { pending = false; refreshTargets(); });
        });
        observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-selected'] });
    }

    function scrollThread() { els.thread.scrollTop = els.thread.scrollHeight; }

    function addBubble(cls, text) {
        els.empty.hidden = true;
        const div = document.createElement('div');
        div.className = 'msg ' + cls;
        div.textContent = text;
        els.thread.appendChild(div);
        scrollThread();
        return div;
    }

    function addSkeleton() {
        const div = document.createElement('div');
        div.className = 'skeleton';
        div.setAttribute('aria-label', 'Codex AI is working on it');
        div.innerHTML = '<i></i><i></i><i></i>';
        els.thread.appendChild(div);
        scrollThread();
        return div;
    }

    function addError(message, retry) {
        const div = addBubble('error', message);
        if (retry) {
            const row = document.createElement('div');
            row.className = 'row';
            row.innerHTML = `<button class="ghost" type="button">${icon('refresh', 13)}Try again</button>`;
            row.querySelector('button').addEventListener('click', () => { div.remove(); retry(); });
            div.appendChild(row);
        }
    }

    function addResult(summary, result, truncated) {
        els.empty.hidden = true;
        const div = document.createElement('div');
        div.className = 'msg ai';
        const p = document.createElement('p');
        p.textContent = summary;
        div.appendChild(p);
        if (result.applied.length) {
            const ul = document.createElement('ul');
            ul.className = 'applied';
            result.applied.forEach(a => {
                const li = document.createElement('li');
                li.innerHTML = '<code></code> ';
                li.querySelector('code').textContent = a.label;
                li.append(a.touched.join(', '));
                ul.appendChild(li);
            });
            div.appendChild(ul);
            const row = document.createElement('div');
            row.className = 'row';
            row.innerHTML = `<button class="ghost" type="button">${icon('rotate-clockwise', 13)}Undo</button>`;
            const undoBtn = row.querySelector('button');
            undoBtn.addEventListener('click', () => {
                result.undo();
                undoBtn.disabled = true;
                undoBtn.textContent = 'Undone';
                refreshTargets();
            });
            div.appendChild(row);
        }
        if (result.problems && result.problems.length) {
            const note = document.createElement('div');
            note.className = 'note';
            note.textContent = 'Skipped: ' + result.problems.join('; ');
            div.appendChild(note);
        }
        if (truncated) {
            const note = document.createElement('div');
            note.className = 'note';
            note.textContent = 'This element is large, so only part of its HTML was sent.';
            div.appendChild(note);
        }
        els.thread.appendChild(div);
        turns.push(result);
        scrollThread();
    }

    async function refreshStatus() {
        const status = await rpc({ action: 'AI_STATUS' });
        const enabled = !!(status && status.enabled);
        els.setup.hidden = enabled;
        els.thread.hidden = !enabled;
        els.form.hidden = !enabled;
        els.target.hidden = !enabled;
        els.model.textContent = enabled ? (status.modelLabel || '') : '';
        if (status && status.footer) els['foot-text'].textContent = status.footer;
        return enabled;
    }

    async function send(raw) {
        const instruction = (raw || '').trim();
        if (!instruction || busy) return;
        refreshTargets();
        if (!targets.length) {
            addError('Select an element on the page first, then send your request.');
            return;
        }
        if (!(await refreshStatus())) return;

        const list = targets.slice();
        const context = buildContext(list);
        busy = true;
        els.send.disabled = true;
        els.input.value = '';
        autoGrow();
        addBubble('user', instruction);
        const skeleton = addSkeleton();

        const image = await captureSelection(list);
        const past = history.slice(-MAX_HISTORY_TURNS * 2);
        let response = await rpc({ action: 'AI_EDIT', instruction, context: context.text, image, history: past });

        if (!response.ok) {
            skeleton.remove();
            busy = false;
            els.send.disabled = false;
            addError((response.error && response.error.message) || 'Something went wrong.', () => { els.input.value = instruction; send(instruction); });
            if (response.error && (response.error.code === 'no_key' || response.error.code === 'auth')) refreshStatus();
            return;
        }

        // Outside design and development: show the reason, change nothing
        if (response.offTopic) {
            skeleton.remove();
            busy = false;
            els.send.disabled = false;
            addBubble('ai', response.summary);
            els.input.focus();
            return;
        }

        let result = applyChanges(list, response.changes, response.css);
        let turn = { summary: response.summary, changes: response.changes, css: response.css };

        // Self-correction: if part of the edit couldn't be applied (invalid
        // CSS, unscoped selectors...), tell the AI exactly what failed once
        // and apply its fix on top.
        if (result.problems.length) {
            const fixRequest = 'Some of your edits could not be applied:\n- ' + result.problems.slice(0, 6).map(p => p.slice(0, 220)).join('\n- ') +
                '\nReturn only the corrected edits for these problems (the rest is already applied). Current state of the selection:';
            const followUp = await rpc({
                action: 'AI_EDIT',
                instruction: fixRequest,
                context: buildContext(list.filter(n => n.isConnected)).text,
                history: [...past, { role: 'user', content: `Request: ${instruction}` }, { role: 'assistant', content: JSON.stringify(turn) }],
            });
            if (followUp.ok && !followUp.offTopic) {
                const fix = applyChanges(list, followUp.changes, followUp.css);
                const undoFirst = result.undo;
                result = {
                    applied: [...result.applied, ...fix.applied],
                    problems: fix.problems,
                    undo: () => { fix.undo(); undoFirst(); },
                };
                turn = { summary: response.summary, changes: [...(response.changes || []), ...(followUp.changes || [])], css: [response.css, followUp.css].filter(Boolean).join('\n') || null };
            }
        }

        skeleton.remove();
        busy = false;
        els.send.disabled = false;
        targets = list.filter(n => n.isConnected);
        renderTarget();
        addResult(response.summary || (result.applied.length ? 'Done.' : 'No changes were needed.'), result, context.truncated);
        history.push({ role: 'user', content: `Request: ${instruction}` });
        history.push({ role: 'assistant', content: JSON.stringify(turn) });
        els.input.focus();
    }

    // ── Open / close ───────────────────────────────────────────────────
    async function open() {
        if (!host) build();
        if (!host.isConnected) document.documentElement.appendChild(host);
        if (host.showPopover && !host.matches(':popover-open')) host.showPopover();
        refreshTargets();
        await refreshStatus();
        if (!els.setup.hidden) return;
        els.input.focus();
    }
    function close() {
        if (host && host.hidePopover && host.matches(':popover-open')) host.hidePopover();
    }
    function isOpen() { return !!(host && host.matches(':popover-open')); }

    window.addEventListener('codex-ai:toggle', () => { isOpen() ? close() : open(); });
    window.addEventListener('codex-ai:close', close);
    window.addEventListener('codex-inspector:exit', close);
    // Settings saved in another tab: refresh the key state if the panel is open
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.codexAi && isOpen()) refreshStatus(); });
})();
