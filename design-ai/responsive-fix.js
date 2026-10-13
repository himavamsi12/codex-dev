// Responsive "Fix it": validation, preview CSS and diff for AI-written fixes.
//
// The AI answers with rules as DATA ({ media, selector, declarations[] }). This
// file is the only way they reach a page: every declaration goes through
// DesignAICore.validateDeclaration (an allow-list of layout properties), media
// queries and selectors are pattern-checked, and the CSS text is built here, so
// the model can never write arbitrary CSS, markup or script.
(function (root) {
    'use strict';
    if (root.ResponsiveFix) return;
    const Core = root.DesignAICore;

    const MAX_RULES = 8, MAX_DECLARATIONS = 12;
    const SELECTOR_RE = /^[\w\s.#>\-[\]="'*~+:()]{1,160}$/;
    const MEDIA_RE = /^\(\s*(?:max|min)-width:\s*\d{2,4}(?:\.\d+)?px\s*\)(?:\s+and\s+\(\s*(?:max|min)-width:\s*\d{2,4}(?:\.\d+)?px\s*\))?$/;

    function cleanSelector(sel) {
        const s = String(sel == null ? '' : sel).trim();
        if (!s || !SELECTOR_RE.test(s)) return null;
        // every comma-separated part must be non-empty, at most 4 parts
        const parts = s.split(',').map(x => x.trim());
        if (parts.length > 4 || parts.some(x => !x)) return null;
        return parts.join(', ');
    }

    function cleanMedia(media) {
        if (media === null || media === undefined || String(media).trim() === '') return null;
        const m = String(media).trim().replace(/^@media\s*/i, '');
        return MEDIA_RE.test(m) ? m.replace(/\s+/g, ' ') : undefined; // undefined = rejected
    }

    /**
     * Returns { ok, rules, warnings, css, cleanCss }.
     *   rules:    [{ media, selector, declarations:[{ property, value }] }] (validated)
     *   css:      preview CSS, every declaration !important so it beats the site's own rules
     *   cleanCss: the same without !important, for copying
     */
    function validateFix(fix) {
        const warnings = [], rules = [];
        const input = fix && Array.isArray(fix.rules) ? fix.rules : [];
        input.slice(0, MAX_RULES).forEach(function (r, i) {
            const at = 'Rule ' + (i + 1) + ': ';
            const selector = cleanSelector(r && r.selector);
            if (!selector) { warnings.push(at + 'the selector is missing or not allowed; skipped.'); return; }
            const media = cleanMedia(r.media);
            if (media === undefined) { warnings.push(at + 'the media query is not allowed (use max-width or min-width in px); skipped.'); return; }
            const declarations = [];
            (Array.isArray(r.declarations) ? r.declarations : []).slice(0, MAX_DECLARATIONS).forEach(function (d) {
                const res = Core.validateDeclaration(d && d.property, d && d.value);
                if (res.ok) declarations.push({ property: d.property, value: res.value });
                else warnings.push(at + res.error);
            });
            if (!declarations.length) { warnings.push(at + 'nothing usable in it; skipped.'); return; }
            rules.push({ media: media, selector: selector, declarations: declarations });
        });
        if (input.length > MAX_RULES) warnings.push('Only the first ' + MAX_RULES + ' rules are used.');
        return { ok: rules.length > 0, rules: rules, warnings: warnings, css: toCss(rules, true), cleanCss: toCss(rules, false) };
    }

    function toCss(rules, important) {
        return rules.map(function (r) {
            const pad = r.media ? '  ' : '';
            const body = r.declarations.map(function (d) { return pad + '  ' + d.property + ': ' + d.value + (important ? ' !important' : '') + ';'; }).join('\n');
            const block = pad + r.selector + ' {\n' + body + '\n' + pad + '}';
            return r.media ? '@media ' + r.media + ' {\n' + block + '\n}' : block;
        }).join('\n\n');
    }

    /**
     * Before/after rows for the diff view. before: { "<selector>": { property: value } }
     * (computed values at the time of the fix); rows are one per declaration.
     */
    function diffRows(rules, before) {
        const rows = [];
        rules.forEach(function (r) {
            const known = (before && before[r.selector]) || {};
            r.declarations.forEach(function (d) {
                rows.push({ selector: r.selector, media: r.media, property: d.property, before: known[d.property] === undefined ? null : known[d.property], after: d.value });
            });
        });
        return rows;
    }

    root.ResponsiveFix = { validateFix, toCss, diffRows, cleanSelector, cleanMedia };
})(typeof self !== 'undefined' ? self : this);
