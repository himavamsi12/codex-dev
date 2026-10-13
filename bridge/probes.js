// Page-side probes for the Claude Code bridge (see mcp-server/).
//
// CodexProbes.run is serialized by chrome.scripting.executeScript, so it must
// be fully self-contained: every helper lives inside it, and it may not touch
// anything from the service worker's scope. The same function is evaluated in
// real Chrome by the MCP server's tests.
//
// Everything here is read-only except the 'patch' / 'clearPatch' commands,
// which only add or remove one constructed stylesheet (never script).
//
// Page text is untrusted data. Probes return short, bounded excerpts of it
// for identification only (tags, classes, <=40 chars of text) and never read
// form values, cookies or storage.
self.CodexProbes = {
    run: function (command, p) {
        'use strict';
        p = p || {};

        // ── helpers ────────────────────────────────────────────────────
        var PATCH_KEY = '__codexDevPatches';
        var INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[tabindex]:not([tabindex="-1"])';

        function esc(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
        function clip(s, n) { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
        function r1(n) { return Math.round(n * 10) / 10; }
        function rectOf(el) {
            var r = el.getBoundingClientRect();
            return { x: r1(r.left + window.scrollX), y: r1(r.top + window.scrollY), width: r1(r.width), height: r1(r.height), right: r1(r.right + window.scrollX) };
        }
        function safeQueryAll(sel) {
            try { return { list: Array.prototype.slice.call(document.querySelectorAll(sel)) }; }
            catch (e) { return { error: 'Invalid CSS selector: ' + clip(e.message, 120) }; }
        }
        function isOurs(el) {
            var n = el.nodeName || '';
            return n.indexOf('CXI-') === 0 || n === 'CODEX-INSPECTOR' || n === 'CODEX-AI-PANEL';
        }

        // Short, mostly-unique selector. Prefers #id, then tag.class chain, and
        // adds :nth-of-type only where the path is still ambiguous.
        function cssPath(el) {
            if (!el || el.nodeType !== 1) return '';
            if (el === document.documentElement) return 'html';
            if (el === document.body) return 'body';
            var parts = [], node = el, depth = 0;
            while (node && node.nodeType === 1 && node !== document.body && depth < 6) {
                var part = node.nodeName.toLowerCase();
                if (node.id && document.querySelectorAll('#' + esc(node.id)).length === 1) {
                    parts.unshift('#' + esc(node.id));
                    break;
                }
                var cls = Array.prototype.filter.call(node.classList || [], function (c) {
                    return c.length < 40 && !/^(css-|sc-|jsx-|_)|[0-9a-f]{6,}/i.test(c);
                }).slice(0, 2);
                if (cls.length) part += '.' + cls.map(esc).join('.');
                var parent = node.parentElement;
                if (parent) {
                    var same = Array.prototype.filter.call(parent.children, function (c) { return c.nodeName === node.nodeName; });
                    if (same.length > 1) {
                        var sib = Array.prototype.filter.call(parent.children, function (c) { return c.matches(part); });
                        if (sib.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
                    }
                }
                parts.unshift(part);
                node = parent;
                depth++;
            }
            return parts.join(' > ');
        }

        function hash(s) {
            var h = 2166136261;
            for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
            return (h >>> 0).toString(36);
        }

        function visible(el, cs) {
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
            if (parseFloat(cs.opacity) === 0) return false;
            var r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        }

        // How far the page itself can scroll sideways. scrollingElement is <html> in
        // standards mode (body in quirks); body.scrollWidth would also count content
        // that body clips with overflow-x: hidden/clip, which never scrolls.
        function pageOverflowX() {
            var de = document.documentElement;
            return (document.scrollingElement || de).scrollWidth - de.clientWidth;
        }

        // Is the point hidden by an ancestor, e.g. a link inside a collapsed
        // dropdown (height 0, overflow hidden) or a faded-out menu (opacity 0)?
        function hiddenByAncestor(el, x, y) {
            for (var a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
                var cs = getComputedStyle(a);
                if (parseFloat(cs.opacity) === 0) return true;
                if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
                var r = a.getBoundingClientRect();
                if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
            }
            return false;
        }

        // Does an ancestor clip/scroll this element, so it cannot widen the page?
        function containedByScroller(el) {
            for (var a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
                if (a === document.body) {
                    // body overflow propagates to the viewport unless html has its own
                    var hs = getComputedStyle(document.documentElement).overflowX;
                    if (hs === 'visible') continue;
                }
                var ox = getComputedStyle(a).overflowX;
                if (ox !== 'visible') return a;
            }
            return null;
        }

        var LAYOUT_PROPS = ['display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'box-sizing',
            'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
            'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
            'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
            'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
            'overflow-x', 'overflow-y', 'white-space', 'text-overflow', 'word-break', 'overflow-wrap',
            'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'justify-content', 'align-items', 'align-self', 'gap',
            'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
            'transform', 'font-size', 'line-height', 'visibility', 'opacity', 'aspect-ratio', 'object-fit'];

        function styleObj(cs, props) {
            var o = {};
            props.forEach(function (k) {
                var v = cs.getPropertyValue(k);
                if (v !== '' && v != null) o[k] = v;
            });
            return o;
        }

        function boxModel(el, cs) {
            var f = function (k) { return parseFloat(cs.getPropertyValue(k)) || 0; };
            var r = el.getBoundingClientRect();
            return {
                margin: { top: f('margin-top'), right: f('margin-right'), bottom: f('margin-bottom'), left: f('margin-left') },
                border: { top: f('border-top-width'), right: f('border-right-width'), bottom: f('border-bottom-width'), left: f('border-left-width') },
                padding: { top: f('padding-top'), right: f('padding-right'), bottom: f('padding-bottom'), left: f('padding-left') },
                borderBox: { width: r1(r.width), height: r1(r.height) },
                content: {
                    width: r1(Math.max(0, r.width - f('padding-left') - f('padding-right') - f('border-left-width') - f('border-right-width'))),
                    height: r1(Math.max(0, r.height - f('padding-top') - f('padding-bottom') - f('border-top-width') - f('border-bottom-width')))
                }
            };
        }

        function safeAttrs(el) {
            var out = {}, keep = /^(id|class|role|type|name|rel|target|alt|title|lang|dir|hidden|disabled|placeholder|for|colspan|rowspan|width|height|loading|aria-[a-z-]+|data-testid|data-test|data-cy)$/;
            Array.prototype.forEach.call(el.attributes || [], function (a) {
                if (keep.test(a.name)) out[a.name] = clip(a.value, 120);
                else if (a.name === 'href' || a.name === 'src') {
                    // drop query/hash: they carry tokens
                    out[a.name] = clip(String(a.value).split(/[?#]/)[0], 160);
                } else if (a.name === 'style') out.style = clip(a.value, 300);
            });
            return out;
        }

        function describe(el) {
            var s = el.nodeName.toLowerCase();
            if (el.id) s += '#' + el.id;
            var c = Array.prototype.slice.call(el.classList || [], 0, 3);
            if (c.length) s += '.' + c.join('.');
            return clip(s, 80);
        }

        function matchedRules(el) {
            var out = [], total = 0;
            function visit(rules, media) {
                Array.prototype.forEach.call(rules, function (rule) {
                    if (rule.type === 1) {
                        var ok = false;
                        try { ok = el.matches(rule.selectorText); } catch (e) { /* pseudo or invalid */ }
                        if (!ok) return;
                        total++;
                        if (out.length < 30) {
                            var sheet = rule.parentStyleSheet && rule.parentStyleSheet.href;
                            out.push({
                                selector: clip(rule.selectorText, 160),
                                media: media || undefined,
                                source: sheet ? clip(sheet.split(/[?#]/)[0].split('/').slice(-2).join('/'), 80) : 'inline <style>',
                                declarations: clip(rule.style.cssText, 400)
                            });
                        }
                    } else if (rule.type === 4) { // @media
                        var m = false;
                        try { m = window.matchMedia(rule.conditionText || rule.media.mediaText).matches; } catch (e) { }
                        if (m) visit(rule.cssRules, '@media ' + clip(rule.conditionText || rule.media.mediaText, 100));
                    } else if (rule.type === 12) { // @supports
                        visit(rule.cssRules, media);
                    } else if (rule.cssRules && rule.type !== 3) {
                        // @layer / nested grouping rules
                        visit(rule.cssRules, media);
                    }
                });
            }
            Array.prototype.forEach.call(document.styleSheets, function (sheet) {
                var rules;
                try { rules = sheet.cssRules; } catch (e) { return; } // cross-origin sheet
                if (rules) visit(rules, '');
            });
            return { rules: out, total: total };
        }

        // Plausible reasons an element is wider than the viewport. Each is
        // derived from computed values, never guessed from names.
        function overflowCauses(el, cs, vw) {
            var causes = [], w = el.getBoundingClientRect().width, tag = el.nodeName.toLowerCase();
            var width = cs.width, minW = cs.minWidth, ws = cs.whiteSpace;
            if (/px$/.test(width) && parseFloat(width) > vw && cs.display !== 'inline') causes.push('computed width ' + width + (el.style.width ? ' (inline style)' : ' (from a stylesheet; see matchedRules in inspect_element)') + ' is wider than the ' + vw + 'px viewport');
            if (/px$/.test(minW) && parseFloat(minW) > vw) causes.push('min-width ' + minW + ' is wider than the viewport');
            if (cs.maxWidth === 'none' && (tag === 'img' || tag === 'video' || tag === 'iframe' || tag === 'canvas' || tag === 'svg' || tag === 'table' || tag === 'pre')) causes.push('<' + tag + '> has no max-width, so its intrinsic size (' + Math.round(w) + 'px) is not constrained');
            if ((ws === 'nowrap' || ws === 'pre') && el.scrollWidth > vw) causes.push('white-space: ' + ws + ' keeps text on one line (' + el.scrollWidth + 'px)');
            if (cs.position === 'absolute' && /px$/.test(cs.left) && parseFloat(cs.left) + w > vw) causes.push('absolutely positioned with left ' + cs.left + ' and width ' + Math.round(w) + 'px');
            if (cs.transform && cs.transform !== 'none') causes.push('transform ' + clip(cs.transform, 60) + ' shifts the element');
            if (/^-/.test(cs.marginLeft) || /^-/.test(cs.marginRight)) causes.push('negative margin (' + cs.marginLeft + ' / ' + cs.marginRight + ')');
            var parent = el.parentElement;
            if (parent) {
                var pcs = getComputedStyle(parent);
                if (/flex/.test(pcs.display) && pcs.flexDirection.indexOf('row') === 0 && pcs.flexWrap === 'nowrap') causes.push('parent is a nowrap flex row; children cannot wrap and min-width:auto stops them shrinking below their content');
                if (/grid/.test(pcs.display) && /px/.test(pcs.gridTemplateColumns) && !/minmax|fr|auto/.test(pcs.gridTemplateColumns)) causes.push('parent grid uses fixed column tracks (' + clip(pcs.gridTemplateColumns, 80) + ')');
            }
            if (Math.abs(w - window.innerWidth) < 2 && document.documentElement.scrollHeight > window.innerHeight) causes.push('width equals 100vw, which includes the vertical scrollbar width');
            return causes;
        }

        // Reasons a container's children cannot fit.
        function containerCauses(el, cs) {
            var causes = [];
            if (/flex/.test(cs.display) && cs.flexDirection.indexOf('row') === 0 && cs.flexWrap === 'nowrap') causes.push('flex row with flex-wrap: nowrap; its children cannot wrap onto a new line, and min-width:auto stops them shrinking below their content');
            if (/grid/.test(cs.display) && /px/.test(cs.gridTemplateColumns) && !/minmax|fr|auto/.test(cs.gridTemplateColumns)) causes.push('grid with fixed column tracks (' + clip(cs.gridTemplateColumns, 80) + ')');
            if (cs.whiteSpace === 'nowrap') causes.push('white-space: nowrap keeps inline content on one line');
            if (cs.overflowX === 'visible') causes.push('overflow-x is visible, so overflowing children widen the page instead of scrolling inside the container');
            return causes;
        }

        // ── commands ───────────────────────────────────────────────────
        function waitStable() {
            var timeout = Math.min(Math.max(+p.timeoutMs || 3000, 200), 10000);
            var quiet = Math.min(Math.max(+p.quietMs || 250, 50), 2000);
            var start = performance.now(), lastChange = start, last = '';
            // Chrome pauses requestAnimationFrame in hidden or occluded windows, so race it
            // against a timer; otherwise the promise never settles and the caller times out.
            function nextFrame(fn) {
                var ran = false;
                function run() { if (!ran) { ran = true; fn(); } }
                if (!document.hidden) requestAnimationFrame(run);
                setTimeout(run, 100);
            }
            return new Promise(function (resolve) {
                function sample() {
                    var de = document.documentElement;
                    var sig = [de.scrollWidth, de.scrollHeight, de.clientWidth, window.innerWidth, document.readyState, document.fonts ? document.fonts.status : ''].join('|');
                    var now = performance.now();
                    if (sig !== last) { last = sig; lastChange = now; }
                    var ready = document.readyState === 'complete' && (!document.fonts || document.fonts.status !== 'loading');
                    if (ready && now - lastChange >= quiet) return resolve({ stable: true, waitedMs: Math.round(now - start) });
                    if (now - start >= timeout) return resolve({ stable: false, waitedMs: Math.round(now - start), reason: ready ? 'layout kept changing' : 'page still loading' });
                    setTimeout(function () { nextFrame(sample); }, 50);
                }
                nextFrame(sample);
            });
        }

        function viewportInfo() {
            var de = document.documentElement, vv = window.visualViewport;
            var meta = document.querySelector('meta[name=viewport]');
            return {
                // clientWidth is the layout viewport. innerWidth is the visual viewport and
                // grows when a mobile browser zooms out to fit overflowing content.
                innerWidth: window.innerWidth, innerHeight: window.innerHeight,
                clientWidth: de.clientWidth, clientHeight: de.clientHeight,
                layoutWidth: de.clientWidth,
                scrollWidth: de.scrollWidth, scrollHeight: de.scrollHeight,
                devicePixelRatio: window.devicePixelRatio,
                visualViewport: vv ? { width: r1(vv.width), height: r1(vv.height), scale: r1(vv.scale) } : null,
                viewportMeta: meta ? clip(meta.getAttribute('content') || '', 120) : null,
                url: location.origin + location.pathname,
                title: clip(document.title, 120)
            };
        }

        // The responsive audit for the current viewport.
        function audit() {
            var de = document.documentElement;
            var vw = de.clientWidth;
            var cap = Math.min(+p.maxElements || 5000, 20000);
            var focus = p.selector ? safeQueryAll(p.selector) : null;
            if (focus && focus.error) return { error: focus.error };
            var all = focus ? focus.list.reduce(function (acc, root) {
                acc.push(root);
                return acc.concat(Array.prototype.slice.call(root.querySelectorAll('*')));
            }, []) : Array.prototype.slice.call(document.body ? document.body.querySelectorAll('*') : []);
            var truncated = all.length > cap;
            if (truncated) all = all.slice(0, cap);

            var issues = [], counts = { scanned: all.length, interactive: 0 };
            var info = viewportInfo();
            var expected = +p.expectedWidth || 0;

            function add(type, severity, confidence, el, message, extra) {
                var selector = el ? cssPath(el) : 'document';
                var issue = {
                    id: type + ':' + (el ? hash(type + '|' + selector) : 'document'),
                    type: type, severity: severity, confidence: confidence,
                    selector: selector, message: message
                };
                if (el) {
                    issue.tag = el.nodeName.toLowerCase();
                    issue.rect = rectOf(el);
                    var t = clip(el.textContent, 40);
                    if (t) issue.text = t;
                }
                if (extra) for (var k in extra) issue[k] = extra[k];
                issues.push(issue);
                return issue;
            }

            // Document-level horizontal scroll (deterministic)
            var docOverflow = pageOverflowX();
            var rootCs = getComputedStyle(de), bodyCs = document.body ? getComputedStyle(document.body) : rootCs;
            var hClipped = rootCs.overflowX === 'hidden' || rootCs.overflowX === 'clip' || bodyCs.overflowX === 'hidden' || bodyCs.overflowX === 'clip';
            if (!focus && docOverflow > 1) {
                add('horizontal-overflow', 'high', 'deterministic', null,
                    'The page scrolls horizontally: content is ' + docOverflow + 'px wider than the ' + vw + 'px viewport.',
                    { overflowPx: docOverflow, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth });
            }

            // Layout viewport differs from the requested width: usually a missing viewport meta tag
            if (expected && !info.viewportMeta && Math.abs(info.layoutWidth - expected) > 2 && !focus) {
                add('viewport-meta-missing', 'high', 'deterministic', null,
                    'The layout viewport is ' + info.layoutWidth + 'px but ' + expected + 'px was requested, and the page has no <meta name="viewport">. Mobile browsers will render it zoomed out.',
                    { layoutWidth: info.layoutWidth, requestedWidth: expected });
            }

            // Per-element scan
            var offending = new Set(), meta = new Map(), interactive = [];
            all.forEach(function (el) {
                if (isOurs(el) || el.closest('codex-inspector')) return;
                var cs = getComputedStyle(el);
                if (!visible(el, cs)) return;
                var r = el.getBoundingClientRect();
                var docRight = r.right + window.scrollX;
                var fixed = cs.position === 'fixed';
                var scroller = containedByScroller(el);
                var isInteractive = el.matches(INTERACTIVE) && !el.closest('[inert],[aria-hidden=true]');
                if (isInteractive) { counts.interactive++; if (interactive.length < 400) interactive.push({ el: el, cs: cs, r: r }); }

                if (!fixed && !scroller && docRight > vw + 1 && cs.position !== 'sticky') {
                    offending.add(el);
                    meta.set(el, { cs: cs, over: r1(docRight - vw) });
                }

                // Text cut off by the element's own overflow (heuristic)
                if (!scroller && (cs.overflowX === 'hidden' || cs.overflowX === 'clip') && el.scrollWidth > el.clientWidth + 2
                    && cs.textOverflow !== 'ellipsis' && !cs.webkitLineClamp && cs.display !== 'inline'
                    && Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })) {
                    add('text-clipped', 'medium', 'heuristic', el,
                        'Text is cut off: content is ' + (el.scrollWidth - el.clientWidth) + 'px wider than the element and overflow is ' + cs.overflowX + '. This can also be an intentional truncation.',
                        { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, computed: styleObj(cs, ['overflow-x', 'white-space', 'width', 'max-width', 'text-overflow']) });
                }
            });

            // Elements that extend past the viewport; report originators only,
            // i.e. those whose parent does not also overflow.
            var origin = [];
            offending.forEach(function (el) {
                var parent = el.parentElement;
                if (!parent || !offending.has(parent) || parent === document.body) origin.push(el);
            });
            // Several overflowing siblings usually mean their container is the
            // problem (a nowrap flex row, a fixed grid): report the container once.
            var groups = new Map(), singles = [];
            origin.forEach(function (el) {
                var parent = el.parentElement;
                if (parent && parent !== document.body && parent !== document.documentElement) {
                    if (!groups.has(parent)) groups.set(parent, []);
                    groups.get(parent).push(el);
                } else singles.push(el);
            });
            groups.forEach(function (kids, parent) { if (kids.length < 2) singles.push(kids[0]); });
            var reported = [];
            groups.forEach(function (kids, parent) {
                if (kids.length < 2) return;
                var pcs = getComputedStyle(parent);
                var over = Math.max.apply(null, kids.map(function (k) { return meta.get(k).over; }));
                reported.push({ el: parent, cs: pcs, over: over, kids: kids });
            });
            singles.forEach(function (el) { reported.push({ el: el, cs: meta.get(el).cs, over: meta.get(el).over, kids: null }); });
            reported.sort(function (a, b) { return b.over - a.over; });
            reported.slice(0, 25).forEach(function (item) {
                var el = item.el, w = el.getBoundingClientRect().width;
                var heavy = item.over > vw * 0.1 || item.over > w * 0.5;
                var causes = item.kids ? containerCauses(el, item.cs) : overflowCauses(el, item.cs, vw);
                var message = item.kids
                    ? item.kids.length + ' children extend up to ' + item.over + 'px past the right edge of the ' + vw + 'px viewport'
                    : 'Extends ' + item.over + 'px past the right edge of the ' + vw + 'px viewport';
                if (hClipped && docOverflow <= 1) message += ' (clipped by overflow-x: hidden on the page, so it is cut off rather than scrollable)';
                add('overflowing-element', heavy ? 'high' : 'medium', 'deterministic', el, message + '.', {
                    overflowPx: item.over, clippedByPage: hClipped && docOverflow <= 1,
                    overflowingChildren: item.kids ? item.kids.slice(0, 8).map(cssPath) : undefined,
                    overflowingChildCount: item.kids ? item.kids.length : undefined,
                    likelyCauses: causes,
                    computed: styleObj(item.cs, ['display', 'position', 'width', 'min-width', 'max-width', 'box-sizing', 'overflow-x', 'white-space', 'flex-wrap', 'flex-direction', 'grid-template-columns', 'margin-left', 'margin-right', 'left', 'transform'])
                });
            });
            if (reported.length > 25) counts.overflowingElementsOmitted = reported.length - 25;

            // Controls the user cannot reach: fully outside the viewport horizontally (heuristic: could be an off-canvas menu)
            var offscreen = 0;
            interactive.forEach(function (it) {
                var r = it.r;
                if ((r.left >= vw - 1 || r.right <= 1) && !containedByScroller(it.el) && !it.el.closest('[hidden]')) {
                    offscreen++;
                    if (offscreen <= 15) {
                        add('offscreen-control', 'medium', 'heuristic', it.el,
                            'Interactive element sits entirely ' + (r.right <= 1 ? 'left of' : 'right of') + ' the viewport and cannot be reached without scrolling. It may be an intentional off-canvas menu.',
                            { rect: rectOf(it.el) });
                    }
                }
            });
            if (offscreen > 15) counts.offscreenControlsOmitted = offscreen - 15;

            // Controls covered by something that is not a fixed/sticky overlay (heuristic)
            var covered = 0;
            interactive.forEach(function (it) {
                var r = it.r;
                var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return;
                if (it.cs.pointerEvents === 'none' || hiddenByAncestor(it.el, cx, cy)) return; // closed menu, not a covered control
                var top = document.elementFromPoint(cx, cy);
                if (!top || top === it.el || it.el.contains(top) || top.contains(it.el) || isOurs(top) || top.closest('codex-inspector')) return;
                for (var a = top; a && a !== document.body; a = a.parentElement) {
                    var ps = getComputedStyle(a).position;
                    if (ps === 'fixed' || ps === 'sticky') return; // intentional overlay: header, cookie banner, dialog
                }
                covered++;
                if (covered <= 10) {
                    add('overlapping-control', 'medium', 'heuristic', it.el,
                        'The centre of this control is covered by <' + describe(top) + '>, so clicks may not reach it.',
                        { coveredBy: cssPath(top) });
                }
            });

            // Tap targets and tiny text (heuristic, only informative at touch widths)
            if (vw <= 820) {
                var small = 0;
                interactive.forEach(function (it) {
                    var cs = it.cs, r = it.r;
                    if (cs.display === 'inline' || it.el.nodeName === 'INPUT' && /^(checkbox|radio)$/.test(it.el.type)) return;
                    if (r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 24 && r.right > 0 && r.left < vw) {
                        small++;
                        if (small <= 15) {
                            add('small-tap-target', 'low', 'heuristic', it.el,
                                'Touch target is ' + Math.round(r.width) + '×' + Math.round(r.height) + 'px; WCAG 2.2 AA asks for at least 24×24px (44×44px is the platform guideline).',
                                { size: { width: r1(r.width), height: r1(r.height) } });
                        }
                    }
                });
                if (small > 15) counts.smallTapTargetsOmitted = small - 15;
            }
            var tiny = 0;
            all.forEach(function (el) {
                if (tiny > 40) return;
                if (!Array.prototype.some.call(el.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim().length > 3; })) return;
                var cs = getComputedStyle(el);
                if (!visible(el, cs)) return;
                var fs = parseFloat(cs.fontSize);
                if (fs > 0 && fs < 11) {
                    tiny++;
                    if (tiny <= 10) add('small-text', 'low', 'heuristic', el, 'Font size is ' + fs + 'px, below a comfortable reading size.', { fontSize: fs });
                }
            });

            return {
                viewport: info,
                horizontalScroll: docOverflow > 1, documentOverflowPx: Math.max(0, docOverflow),
                pageClipsHorizontalOverflow: hClipped,
                issues: issues, counts: counts, truncated: truncated,
                focusSelector: p.selector || null
            };
        }

        // A compact picture of the page layout at this width, for comparing devices:
        // landmark and container boxes with how many columns/rows their children
        // use, landmarks that are hidden, menu buttons, and heading sizes.
        function fingerprint() {
            var de = document.documentElement;
            var LAND = /^(header|nav|main|footer|section|article|aside|form|ul|ol)$/i;
            var SKIP = /^(script|style|link|meta|template|noscript)$/i;
            var nodes = [], count = 0;
            function kidsOf(el) {
                return Array.prototype.filter.call(el.children, function (c) {
                    if (isOurs(c) || SKIP.test(c.nodeName)) return false;
                    return visible(c, getComputedStyle(c));
                });
            }
            function distinct(list, key) {
                var seen = {};
                list.forEach(function (r) { seen[Math.round(r[key] / 8)] = 1; });
                return Object.keys(seen).length;
            }
            function walk(el, depth) {
                if (depth > 4 || count >= 60) return;
                kidsOf(el).forEach(function (c) {
                    if (count >= 60) return;
                    var kids = kidsOf(c);
                    if (LAND.test(c.nodeName) || kids.length >= 2) {
                        count++;
                        var cs = getComputedStyle(c), r = c.getBoundingClientRect();
                        var rects = kids.slice(0, 40).map(function (k) { return k.getBoundingClientRect(); });
                        var h = c.querySelector('h1,h2,h3,h4');
                        var n = {
                            selector: cssPath(c), tag: c.nodeName.toLowerCase(),
                            label: clip((h || c).textContent, 40),
                            rect: { x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) },
                            display: cs.display, children: kids.length
                        };
                        if (/flex/.test(cs.display)) { n.flexDirection = cs.flexDirection; n.flexWrap = cs.flexWrap; }
                        if (/grid/.test(cs.display)) n.gridColumns = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
                        if (rects.length >= 2) { n.columns = distinct(rects, 'left'); n.rows = distinct(rects, 'top'); }
                        nodes.push(n);
                    }
                    walk(c, depth + 1);
                });
            }
            if (document.body) walk(document.body, 0);
            var hidden = [];
            Array.prototype.slice.call(document.querySelectorAll('header,nav,aside,[role=navigation],[role=banner]'), 0, 40).forEach(function (el) {
                if (isOurs(el) || hidden.length >= 10) return;
                var cs = getComputedStyle(el), r = el.getBoundingClientRect();
                if (!visible(el, cs) || (r.width < 2 && r.height < 2)) hidden.push({ selector: cssPath(el), tag: el.nodeName.toLowerCase(), label: clip(el.getAttribute('aria-label') || el.textContent, 30) });
            });
            var toggles = [];
            Array.prototype.slice.call(document.querySelectorAll('button,[role=button],a'), 0, 400).forEach(function (el) {
                if (toggles.length >= 5 || isOurs(el)) return;
                var hint = (el.getAttribute('aria-label') || '') + ' ' + el.className + ' ' + el.id;
                if (/menu|burger|hamburger|nav-?toggle|drawer/i.test(hint) && visible(el, getComputedStyle(el))) toggles.push({ selector: cssPath(el), label: clip(el.getAttribute('aria-label') || el.textContent, 24) });
            });
            var headings = [];
            Array.prototype.slice.call(document.querySelectorAll('h1,h2,h3'), 0, 40).forEach(function (el) {
                var cs = getComputedStyle(el);
                if (headings.length < 12 && visible(el, cs)) headings.push({ tag: el.nodeName.toLowerCase(), text: clip(el.textContent, 40), fontSize: parseFloat(cs.fontSize) });
            });
            return {
                viewport: viewportInfo(), pageHeight: de.scrollHeight,
                horizontalScroll: pageOverflowX() > 1,
                nodes: nodes, hiddenLandmarks: hidden, menuToggles: toggles, headings: headings
            };
        }

        function structure() {
            var rootSel = p.selector || 'body';
            var q = safeQueryAll(rootSel);
            if (q.error) return { error: q.error };
            if (!q.list.length) return { error: 'No element matches ' + clip(rootSel, 80) };
            var maxDepth = Math.min(Math.max(+p.depth || 3, 1), 8), maxNodes = Math.min(Math.max(+p.maxNodes || 150, 10), 600);
            var count = 0, skipped = /^(script|style|noscript|template|link|meta)$/i;
            function node(el, d) {
                count++;
                var cs = getComputedStyle(el);
                var n = { tag: el.nodeName.toLowerCase(), selector: cssPath(el) };
                if (el.id) n.id = el.id;
                if (el.classList.length) n.classes = Array.prototype.slice.call(el.classList, 0, 5);
                var role = el.getAttribute('role'); if (role) n.role = role;
                n.display = cs.display;
                if (cs.position !== 'static') n.position = cs.position;
                var r = el.getBoundingClientRect();
                n.size = { width: r1(r.width), height: r1(r.height) };
                var own = Array.prototype.filter.call(el.childNodes, function (c) { return c.nodeType === 3 && c.textContent.trim(); }).map(function (c) { return c.textContent; }).join(' ');
                if (own) n.text = clip(own, 40);
                var kids = Array.prototype.filter.call(el.children, function (c) { return !skipped.test(c.nodeName) && !isOurs(c); });
                if (d < maxDepth) {
                    n.children = [];
                    for (var i = 0; i < kids.length; i++) {
                        if (count >= maxNodes) { n.childrenTruncated = kids.length - i; break; }
                        n.children.push(node(kids[i], d + 1));
                    }
                } else if (kids.length) n.childCount = kids.length;
                return n;
            }
            return { root: node(q.list[0], 0), matchCount: q.list.length, nodes: count, truncated: count >= maxNodes, viewport: viewportInfo() };
        }

        function inspect() {
            var q = safeQueryAll(p.selector);
            if (q.error) return { error: q.error };
            if (!q.list.length) return { error: 'No element matches ' + clip(p.selector, 80) };
            var idx = Math.min(Math.max(+p.index || 0, 0), q.list.length - 1);
            var el = q.list[idx], cs = getComputedStyle(el);
            var parent = el.parentElement, pcs = parent ? getComputedStyle(parent) : null;
            var ancestors = [];
            for (var a = parent, i = 0; a && i < 6; a = a.parentElement, i++) {
                var acs = getComputedStyle(a);
                ancestors.push({ element: describe(a), selector: cssPath(a), display: acs.display, position: acs.position, overflowX: acs.overflowX, width: r1(a.getBoundingClientRect().width) });
            }
            var layout = { display: cs.display, position: cs.position, boxSizing: cs.boxSizing };
            if (/flex/.test(cs.display)) layout.flexContainer = styleObj(cs, ['flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap']);
            if (/grid/.test(cs.display)) layout.gridContainer = styleObj(cs, ['grid-template-columns', 'grid-template-rows', 'gap', 'justify-items', 'align-items']);
            if (pcs && /flex/.test(pcs.display)) layout.flexItem = Object.assign(styleObj(cs, ['flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'min-width']), { parentDirection: pcs.flexDirection, parentWrap: pcs.flexWrap });
            if (pcs && /grid/.test(pcs.display)) layout.gridItem = Object.assign(styleObj(cs, ['grid-column', 'grid-row']), { parentColumns: clip(pcs.gridTemplateColumns, 120) });
            var hints = [];
            if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) hints.push('Content is ' + (el.scrollWidth - el.clientWidth) + 'px wider than the box and overflow-x is ' + cs.overflowX + '.');
            if (pcs && /flex/.test(pcs.display) && cs.minWidth === 'auto' && el.scrollWidth > el.clientWidth) hints.push('Flex item with min-width:auto cannot shrink below its content; set min-width:0 or allow wrapping.');
            if (cs.position === 'absolute' || cs.position === 'fixed') hints.push('Taken out of normal flow (position: ' + cs.position + ').');
            var m = matchedRules(el);
            var kids = Array.prototype.slice.call(el.children, 0, 12).map(function (c) { return { element: describe(c), selector: cssPath(c) }; });
            return {
                matchCount: q.list.length, index: idx, selector: cssPath(el), tag: el.nodeName.toLowerCase(),
                attributes: safeAttrs(el), text: clip(el.textContent, 80),
                rect: rectOf(el), boxModel: boxModel(el, cs),
                scroll: { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight },
                layout: layout, hints: hints,
                computed: styleObj(cs, LAYOUT_PROPS),
                matchedRules: m.rules, matchedRuleCount: m.total,
                ancestors: ancestors, childCount: el.children.length, children: kids,
                viewport: viewportInfo()
            };
        }

        function styles() {
            var q = safeQueryAll(p.selector);
            if (q.error) return { error: q.error };
            if (!q.list.length) return { error: 'No element matches ' + clip(p.selector, 80) };
            var idx = Math.min(Math.max(+p.index || 0, 0), q.list.length - 1);
            var el = q.list[idx];
            var cs;
            try { cs = getComputedStyle(el, p.pseudo || null); } catch (e) { return { error: 'Invalid pseudo-element' }; }
            var props = Array.isArray(p.properties) && p.properties.length ? p.properties.slice(0, 80) : LAYOUT_PROPS;
            return { matchCount: q.list.length, index: idx, selector: cssPath(el), pseudo: p.pseudo || null, styles: styleObj(cs, props) };
        }

        function dimensions() {
            var q = safeQueryAll(p.selector);
            if (q.error) return { error: q.error };
            var limit = Math.min(Math.max(+p.limit || 10, 1), 50);
            var vw = document.documentElement.clientWidth, vh = window.innerHeight;
            return {
                matchCount: q.list.length,
                viewport: { width: vw, height: vh, scrollX: window.scrollX, scrollY: window.scrollY },
                elements: q.list.slice(0, limit).map(function (el) {
                    var cs = getComputedStyle(el), r = el.getBoundingClientRect();
                    return {
                        selector: cssPath(el), tag: el.nodeName.toLowerCase(),
                        rect: rectOf(el),
                        offset: { width: el.offsetWidth, height: el.offsetHeight },
                        client: { width: el.clientWidth, height: el.clientHeight },
                        scroll: { width: el.scrollWidth, height: el.scrollHeight },
                        boxModel: boxModel(el, cs),
                        visibility: { display: cs.display, visibility: cs.visibility, opacity: cs.opacity },
                        inViewport: r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh,
                        extendsPastRight: r1(Math.max(0, r.right - vw)),
                        extendsPastLeft: r1(Math.max(0, -r.left))
                    };
                })
            };
        }

        // Temporary preview only: one constructed stylesheet per patch id.
        // Constructed sheets are not subject to a page's style-src CSP and are
        // removed by clearPatch or by reloading the page.
        function patch() {
            var list = window[PATCH_KEY] = window[PATCH_KEY] || {};
            var id = String(p.id || 'default');
            var sheet = list[id];
            if (!sheet) {
                if (typeof CSSStyleSheet !== 'function' || !('adoptedStyleSheets' in document)) return { error: 'This page cannot take constructed stylesheets.' };
                sheet = new CSSStyleSheet();
                list[id] = sheet;
                document.adoptedStyleSheets = document.adoptedStyleSheets.concat([sheet]);
            }
            try { sheet.replaceSync(String(p.css)); } catch (e) { return { error: 'CSS rejected by the browser: ' + clip(e.message, 160) }; }
            return { applied: true, id: id, ruleCount: sheet.cssRules.length, active: Object.keys(list) };
        }

        function clearPatch() {
            var list = window[PATCH_KEY] || {};
            var ids = p.id ? [String(p.id)] : Object.keys(list);
            var removed = [];
            ids.forEach(function (id) {
                if (!list[id]) return;
                document.adoptedStyleSheets = document.adoptedStyleSheets.filter(function (s) { return s !== list[id]; });
                delete list[id];
                removed.push(id);
            });
            return { removed: removed, active: Object.keys(list) };
        }

        // ── shared by typography / accessibility / spacing ─────────────
        // Visible elements that hold their own text (not just nested text)
        function textElements(limit) {
            var out = [], all = document.body ? document.body.getElementsByTagName('*') : [];
            for (var i = 0; i < all.length && out.length < limit; i++) {
                var el = all[i];
                if (isOurs(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|PATH|IFRAME|OPTION)$/i.test(el.nodeName)) continue;
                var own = '';
                for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) own += c.nodeValue;
                if (!own.trim()) continue;
                var cs = getComputedStyle(el);
                if (!visible(el, cs)) continue;
                out.push({ el: el, cs: cs, text: own });
            }
            return out;
        }
        function firstFamily(stack) { return String(stack || '').split(',')[0].trim().replace(/^["']|["']$/g, ''); }
        var GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|emoji|math|fangsong|-apple-system|blinkmacsystemfont|inherit|initial)$/i;
        function sample(list, n) { return list.slice(0, n || 3); }

        // ── typography ─────────────────────────────────────────────────
        // Which fonts and sizes the page really uses, one-off fonts and sizes,
        // fonts that are declared but not loaded (rendering a fallback), and
        // heading sizes that don't follow the heading levels.
        function typography() {
            var items = textElements(p.limit || 3000);
            var fams = {}, sizes = {}, issues = [], total = items.length;
            var loadedCheck = {};
            items.forEach(function (it) {
                var fam = firstFamily(it.cs.fontFamily), size = it.cs.fontSize, sel;
                var f = fams[fam] || (fams[fam] = { family: fam, stack: clip(it.cs.fontFamily, 120), count: 0, weights: {}, selectors: [] });
                f.count++; f.weights[it.cs.fontWeight] = 1;
                if (f.selectors.length < 3) f.selectors.push(cssPath(it.el));
                var s = sizes[size] || (sizes[size] = { size: size, count: 0, selectors: [] });
                s.count++;
                if (s.selectors.length < 3) s.selectors.push(cssPath(it.el));
                if (!(fam in loadedCheck)) {
                    var ok = true;
                    if (!GENERIC.test(fam) && document.fonts && document.fonts.check) {
                        try { ok = document.fonts.check('16px "' + fam.replace(/"/g, '') + '"'); } catch (e) { ok = true; }
                        // check() is also true for fonts that are installed locally; a declared
                        // @font-face that failed shows as status 'error'
                        try {
                            document.fonts.forEach(function (ff) { if (firstFamily(ff.family) === fam && ff.status === 'error') ok = false; });
                        } catch (e) { }
                    }
                    loadedCheck[fam] = ok;
                }
            });
            var famList = Object.keys(fams).map(function (k) { var f = fams[k]; f.weights = Object.keys(f.weights).sort(); f.share = total ? r1(f.count / total * 100) : 0; f.loaded = loadedCheck[k]; return f; })
                .sort(function (a, b) { return b.count - a.count; });
            var sizeList = Object.keys(sizes).map(function (k) { var s = sizes[k]; s.share = total ? r1(s.count / total * 100) : 0; return s; })
                .sort(function (a, b) { return parseFloat(a.size) - parseFloat(b.size); });

            famList.forEach(function (f) {
                if (!f.loaded) issues.push({ type: 'font-not-loaded', severity: 'high', family: f.family, selectors: f.selectors, message: 'The page asks for "' + f.family + '" but it did not load, so the browser shows a fallback font (' + clip(f.stack, 80) + ').' });
            });
            if (famList.length > 3) {
                famList.slice(1).forEach(function (f) {
                    if (f.share < 3 && !/mono|code|icon|awesome|material/i.test(f.family)) issues.push({ type: 'one-off-font', severity: 'medium', family: f.family, count: f.count, selectors: f.selectors, message: '"' + f.family + '" is used by only ' + f.count + ' text element(s) (' + f.share + '%). It may be an unintended font.' });
                });
            }
            if (sizeList.length > 10) issues.push({ type: 'many-font-sizes', severity: 'low', count: sizeList.length, message: sizeList.length + ' different font sizes are used. A type scale usually has 6-8.' });
            sizeList.forEach(function (s) {
                if (s.count === 1 && sizeList.length > 6) issues.push({ type: 'one-off-font-size', severity: 'low', size: s.size, selectors: s.selectors, message: 'Font size ' + s.size + ' is used only once.' });
            });

            // Headings: size should not grow as the level goes down
            var heads = [];
            for (var lvl = 1; lvl <= 6; lvl++) {
                var hs = Array.prototype.filter.call(document.querySelectorAll('h' + lvl), function (h) { return visible(h, getComputedStyle(h)); });
                if (!hs.length) continue;
                var px = hs.map(function (h) { return parseFloat(getComputedStyle(h).fontSize); });
                heads.push({ level: lvl, count: hs.length, minPx: Math.min.apply(null, px), maxPx: Math.max.apply(null, px), families: Object.keys(hs.reduce(function (o, h) { o[firstFamily(getComputedStyle(h).fontFamily)] = 1; return o; }, {})), sample: cssPath(hs[0]) });
                if (Math.max.apply(null, px) - Math.min.apply(null, px) > 4) issues.push({ type: 'inconsistent-heading-size', severity: 'medium', level: lvl, message: 'h' + lvl + ' headings range from ' + Math.min.apply(null, px) + 'px to ' + Math.max.apply(null, px) + 'px.', selectors: sample(hs.map(cssPath)) });
            }
            for (var i = 1; i < heads.length; i++) {
                if (heads[i].minPx > heads[i - 1].maxPx + 0.5) issues.push({ type: 'heading-scale-inverted', severity: 'medium', message: 'h' + heads[i].level + ' (' + heads[i].minPx + 'px) is larger than h' + heads[i - 1].level + ' (' + heads[i - 1].maxPx + 'px).', selectors: [heads[i].sample, heads[i - 1].sample] });
            }
            // Body text that is hard to read
            items.forEach(function (it) {
                if (issues.length > 80) return;
                var fs = parseFloat(it.cs.fontSize), lh = parseFloat(it.cs.lineHeight);
                if (it.text.trim().length > 80 && fs < 22 && lh && lh / fs < 1.25) issues.push({ type: 'tight-line-height', severity: 'low', selector: cssPath(it.el), message: 'Paragraph text with line-height ' + r1(lh / fs) + ' (' + it.cs.lineHeight + ' on ' + it.cs.fontSize + '). 1.4-1.6 reads better.' });
            });
            return { viewport: viewportInfo(), textElements: total, families: famList.slice(0, 15), sizes: sizeList.slice(0, 30), headings: heads, issues: issues.slice(0, 80) };
        }

        // ── accessibility ──────────────────────────────────────────────
        // Automated WCAG checks that can be measured reliably in the page.
        // Not a full audit: keyboard flow, screen-reader wording and meaning
        // still need a person.
        function parseColor(s) {
            var m = String(s).match(/rgba?\(([^)]+)\)/);
            if (!m) return null;
            var v = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
            return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
        }
        function lum(c) {
            var f = function (x) { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
            return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
        }
        function blend(top, under) {
            var a = top.a;
            return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
        }
        // Background behind el: solid colours up the tree. null when an image
        // or gradient is in the way (contrast can't be measured reliably).
        function backgroundOf(el) {
            var layers = [];
            for (var a = el; a && a.nodeType === 1; a = a.parentElement) {
                var cs = getComputedStyle(a);
                if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
                var c = parseColor(cs.backgroundColor);
                if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
            }
            var base = { r: 255, g: 255, b: 255, a: 1 };
            for (var i = layers.length - 1; i >= 0; i--) base = blend(layers[i], base);
            return base;
        }
        function accName(el) {
            var n = el.getAttribute('aria-label');
            if (n && n.trim()) return n;
            var ids = el.getAttribute('aria-labelledby');
            if (ids) { var t = ids.split(/\s+/).map(function (id) { var r = document.getElementById(id); return r ? r.textContent : ''; }).join(' '); if (t.trim()) return t; }
            if (el.labels && el.labels.length) { var l = Array.prototype.map.call(el.labels, function (x) { return x.textContent; }).join(' '); if (l.trim()) return l; }
            var txt = (el.innerText || el.textContent || '');
            if (txt.trim()) return txt;
            var img = el.querySelector && el.querySelector('img[alt]:not([alt=""]), svg title, [aria-label]');
            if (img) return img.getAttribute('alt') || img.getAttribute('aria-label') || img.textContent;
            if (el.value && /^(submit|button|reset)$/i.test(el.type || '')) return el.value;
            if (el.alt) return el.alt;
            return el.getAttribute('title') || '';
        }
        function accessibility() {
            var issues = [], counts = {};
            function add(o) { counts[o.type] = (counts[o.type] || 0) + 1; if (counts[o.type] <= (p.perType || 12)) issues.push(o); }
            var hiddenFromAT = function (el) { return !!el.closest('[aria-hidden="true"],[hidden],[inert]'); };

            if (!document.documentElement.getAttribute('lang')) add({ type: 'html-lang-missing', severity: 'high', wcag: '3.1.1', selector: 'html', message: 'The <html> element has no lang attribute, so screen readers may use the wrong language.' });
            if (!document.title || !document.title.trim()) add({ type: 'page-title-missing', severity: 'medium', wcag: '2.4.2', selector: 'title', message: 'The page has no <title>.' });
            var vm = document.querySelector('meta[name="viewport"]');
            if (vm && /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*(1(\.0)?|0?\.\d+)(?![\d.])/i.test(vm.content || '')) add({ type: 'zoom-disabled', severity: 'high', wcag: '1.4.4', selector: 'meta[name=viewport]', message: 'The viewport meta tag blocks pinch zoom (' + clip(vm.content, 80) + ').' });

            Array.prototype.forEach.call(document.images, function (img) {
                if (hiddenFromAT(img) || /^(presentation|none)$/.test(img.getAttribute('role') || '')) return;
                var cs = getComputedStyle(img);
                if (!visible(img, cs)) return;
                if (!img.hasAttribute('alt')) add({ type: 'image-alt-missing', severity: 'high', wcag: '1.1.1', selector: cssPath(img), message: 'Image has no alt attribute. Use alt="" if it is decorative.' });
            });
            Array.prototype.forEach.call(document.querySelectorAll('a[href],button,[role=button],[role=link],input[type=submit],input[type=button],input[type=image]'), function (el) {
                if (hiddenFromAT(el) || !visible(el, getComputedStyle(el))) return;
                if (!accName(el).trim()) add({ type: el.matches('a') ? 'link-name-missing' : 'button-name-missing', severity: 'high', wcag: '4.1.2', selector: cssPath(el), message: (el.matches('a') ? 'Link' : 'Button') + ' has no accessible name (no text, aria-label or labelled image). Icon-only controls need aria-label.' });
            });
            Array.prototype.forEach.call(document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image]):not([type=reset]),select,textarea'), function (el) {
                if (hiddenFromAT(el) || !visible(el, getComputedStyle(el))) return;
                var named = (el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title');
                if (!named) add({ type: 'form-label-missing', severity: 'high', wcag: '1.3.1', selector: cssPath(el), message: 'Form field has no label' + (el.placeholder ? ' (a placeholder is not a label)' : '') + '.' });
            });
            Array.prototype.forEach.call(document.querySelectorAll('[tabindex]'), function (el) {
                if (parseInt(el.getAttribute('tabindex'), 10) > 0) add({ type: 'positive-tabindex', severity: 'medium', wcag: '2.4.3', selector: cssPath(el), message: 'tabindex="' + el.getAttribute('tabindex') + '" changes the keyboard order. Use 0 or -1.' });
            });

            // Headings
            var hs = Array.prototype.filter.call(document.querySelectorAll('h1,h2,h3,h4,h5,h6'), function (h) { return !hiddenFromAT(h) && visible(h, getComputedStyle(h)); });
            var h1s = hs.filter(function (h) { return h.tagName === 'H1'; });
            if (!h1s.length) add({ type: 'h1-missing', severity: 'medium', wcag: '1.3.1', selector: 'body', message: 'The page has no visible <h1>.' });
            if (h1s.length > 1) add({ type: 'multiple-h1', severity: 'low', wcag: '1.3.1', selector: cssPath(h1s[1]), message: 'There are ' + h1s.length + ' <h1> headings.' });
            for (var i = 1; i < hs.length; i++) {
                var a = +hs[i - 1].tagName[1], b = +hs[i].tagName[1];
                if (b > a + 1) add({ type: 'heading-level-skipped', severity: 'medium', wcag: '1.3.1', selector: cssPath(hs[i]), message: 'Heading jumps from h' + a + ' to h' + b + ' ("' + clip(hs[i].textContent, 40) + '").' });
            }
            if (!document.querySelector('main,[role=main]')) add({ type: 'main-landmark-missing', severity: 'low', wcag: '1.3.1', selector: 'body', message: 'No <main> landmark, so screen-reader users can not jump to the content.' });

            // Duplicate ids referenced by labels / aria
            var seen = {};
            Array.prototype.forEach.call(document.querySelectorAll('[id]'), function (el) { seen[el.id] = (seen[el.id] || 0) + 1; });
            Array.prototype.forEach.call(document.querySelectorAll('label[for],[aria-labelledby],[aria-describedby],[aria-controls]'), function (el) {
                ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls'].forEach(function (attr) {
                    (el.getAttribute(attr) || '').split(/\s+/).forEach(function (id) { if (id && seen[id] > 1) add({ type: 'duplicate-id-reference', severity: 'medium', wcag: '4.1.1', selector: cssPath(el), message: attr + ' points to id "' + clip(id, 30) + '", which is used ' + seen[id] + ' times.' }); });
                });
            });

            // Colour contrast (solid backgrounds only)
            var unknown = 0, checked = 0;
            textElements(p.contrastLimit || 600).forEach(function (it) {
                if (hiddenFromAT(it.el)) return;
                var fg = parseColor(it.cs.color);
                if (!fg || fg.a === 0) return;
                var bg = backgroundOf(it.el);
                if (!bg) { unknown++; return; }
                checked++;
                fg = blend(fg, bg);
                var l1 = lum(fg), l2 = lum(bg), ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
                var px = parseFloat(it.cs.fontSize), bold = parseInt(it.cs.fontWeight, 10) >= 700;
                var large = px >= 24 || (bold && px >= 18.66);
                var need = large ? 3 : 4.5;
                if (ratio < need) add({ type: 'low-contrast', severity: ratio < need - 1.5 ? 'high' : 'medium', wcag: '1.4.3', selector: cssPath(it.el), ratio: r1(ratio), required: need, color: it.cs.color, background: 'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')', fontSize: it.cs.fontSize, text: clip(it.text, 40), message: 'Text contrast ' + r1(ratio) + ':1, needs ' + need + ':1.' });
            });

            var sevRank = { high: 3, medium: 2, low: 1 };
            issues.sort(function (x, y) { return sevRank[y.severity] - sevRank[x.severity]; });
            return { viewport: viewportInfo(), counts: counts, issues: issues, contrast: { checked: checked, skippedOverImages: unknown },
                notChecked: ['keyboard focus order and visible focus styles', 'screen-reader wording and announcements', 'text over images or gradients (contrast)', 'motion, timing and media captions'] };
        }

        // ── section spacing ────────────────────────────────────────────
        // The page's main sections top to bottom, the white space between the
        // content of neighbouring sections, and which gaps break the rhythm.
        function spacing() {
            var root = p.selector ? document.querySelector(p.selector) : (document.querySelector('main,[role=main]') || document.body);
            if (!root) return { error: 'No element matches ' + clip(p.selector, 80) + '.' };
            function flowChildren(node) {
                return Array.prototype.filter.call(node.children, function (c) {
                    if (isOurs(c) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META)$/.test(c.nodeName)) return false;
                    var cs = getComputedStyle(c);
                    if (!visible(c, cs) || cs.position === 'fixed' || cs.position === 'absolute') return false;
                    return c.getBoundingClientRect().height >= 40;
                });
            }
            // Step through single wrappers (<div id="root">, layout shells)
            var kids = flowChildren(root), guard = 0;
            while (kids.length === 1 && guard++ < 6) { root = kids[0]; kids = flowChildren(root); }
            // Include header/footer outside <main> so their gaps are measured too
            if (!p.selector && root !== document.body && (root.matches('main,[role=main]') || root.closest('main,[role=main]'))) {
                var before = document.querySelector('body > header, body header:not(main header)');
                var after = document.querySelector('body > footer, body footer:not(main footer)');
                if (before && visible(before, getComputedStyle(before)) && getComputedStyle(before).position !== 'fixed') kids.unshift(before);
                if (after && visible(after, getComputedStyle(after))) kids.push(after);
            }
            kids = kids.slice(0, 40);

            // Where the visible content of a section starts and ends (ignores its padding)
            function contentBox(sec) {
                var top = Infinity, bottom = -Infinity, n = 0;
                var all = sec.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,img,svg,video,picture,input,textarea,select,blockquote,figure,span,label');
                for (var i = 0; i < all.length && n < 400; i++) {
                    var el = all[i], cs = getComputedStyle(el);
                    if (!visible(el, cs) || cs.position === 'fixed') continue;
                    var r = el.getBoundingClientRect();
                    if (r.height < 4) continue;
                    n++;
                    top = Math.min(top, r.top + window.scrollY);
                    bottom = Math.max(bottom, r.bottom + window.scrollY);
                }
                return n ? { top: r1(top), bottom: r1(bottom) } : null;
            }
            var sections = kids.map(function (el) {
                var cs = getComputedStyle(el), r = el.getBoundingClientRect();
                var heading = el.querySelector('h1,h2,h3');
                return {
                    selector: cssPath(el), tag: el.nodeName.toLowerCase(), heading: heading ? clip(heading.textContent, 40) : null,
                    top: r1(r.top + window.scrollY), height: r1(r.height),
                    paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom,
                    background: cs.backgroundImage !== 'none' ? 'image' : cs.backgroundColor,
                    content: contentBox(el)
                };
            });
            var gaps = [];
            for (var i = 1; i < sections.length; i++) {
                var a = sections[i - 1], b = sections[i];
                var boxGap = r1(b.top - (a.top + a.height));
                var whitespace = a.content && b.content ? r1(b.content.top - a.content.bottom) : null;
                gaps.push({ between: [a.selector, b.selector], headings: [a.heading, b.heading], boxGap: boxGap, contentWhitespace: whitespace,
                    detail: { prevPaddingBottom: a.paddingBottom, prevMarginBottom: a.marginBottom, nextMarginTop: b.marginTop, nextPaddingTop: b.paddingTop } });
            }
            var vals = gaps.map(function (g) { return g.contentWhitespace; }).filter(function (v) { return v != null && v >= 0; }).sort(function (x, y) { return x - y; });
            var median = vals.length ? vals[Math.floor(vals.length / 2)] : null;
            var issues = [];
            gaps.forEach(function (g) {
                var w = g.contentWhitespace;
                if (w == null) return;
                if (w < 0) issues.push({ type: 'sections-overlap', severity: 'high', between: g.between, whitespace: w, message: 'Content of these sections overlaps by ' + Math.abs(w) + 'px.' });
                else if (median && Math.abs(w - median) > Math.max(24, median * 0.4)) issues.push({ type: w < median ? 'gap-too-small' : 'gap-too-large', severity: 'medium', between: g.between, headings: g.headings, whitespace: w, typical: median, message: 'White space between these sections is ' + w + 'px; most gaps are about ' + median + 'px.' });
                if (Math.round(w) % 4 !== 0 && Math.abs(w - median) > 2) g.offGrid = true;
            });
            // Same spacing on both sides? (asymmetric padding is a common slip)
            sections.forEach(function (s) {
                var t = parseFloat(s.paddingTop), b = parseFloat(s.paddingBottom);
                if (t > 0 && b > 0 && Math.abs(t - b) > Math.max(16, Math.min(t, b) * 0.5)) issues.push({ type: 'asymmetric-padding', severity: 'low', selector: s.selector, message: 'Padding is ' + s.paddingTop + ' on top but ' + s.paddingBottom + ' at the bottom.' });
            });
            return { viewport: viewportInfo(), container: cssPath(root), sections: sections, gaps: gaps, typicalWhitespace: median, issues: issues,
                note: 'contentWhitespace is the distance from the last visible content of one section to the first visible content of the next (padding and margins included). Whether a gap is "right" is a design decision: report and ask before changing it.' };
        }

        switch (command) {
            case 'typography': return typography();
            case 'accessibility': return accessibility();
            case 'spacing': return spacing();
            case 'waitStable': return waitStable();
            case 'viewportInfo': return viewportInfo();
            case 'audit': return audit();
            case 'fingerprint': return fingerprint();
            case 'structure': return structure();
            case 'inspect': return inspect();
            case 'styles': return styles();
            case 'dimensions': return dimensions();
            case 'patch': return patch();
            case 'clearPatch': return clearPatch();
            default: return { error: 'Unknown probe: ' + command };
        }
    }
};
