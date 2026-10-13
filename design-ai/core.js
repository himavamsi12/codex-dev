// Design Inspector AI: pure logic shared by the panel, the page engine, the MCP
// bridge and the tests. Nothing here talks to the network or to chrome.*.
//
// - image validation (type, size, magic bytes)
// - the patch model and its validator: the ONLY way a design change reaches a
//   page. A patch is a list of small operations on one element; there is no
//   script, no selector, no markup.
// - PatchStore: undo / redo / reset history and CSS generation
// - export helpers (CSS, sanitized HTML, framework guidance)
(function (root) {
    'use strict';
    if (root.DesignAICore) return;

    const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
    const MAX_IMAGE_PIXELS = 50 * 1000 * 1000;
    const IMAGE_TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' };
    const MAX_VALUE_LENGTH = 300;
    const MAX_OPS_PER_PATCH = 60;
    const MAX_TEXT_LENGTH = 500;
    const MAX_HTML_BYTES = 200 * 1024;

    const BREAKPOINTS = {
        base: { label: 'Desktop', media: null },
        tablet: { label: 'Tablet', media: '(max-width: 1024px)', previewWidth: 768 },
        mobile: { label: 'Mobile', media: '(max-width: 640px)', previewWidth: 390 },
    };

    // ── Images ─────────────────────────────────────────────────────────
    class DesignAIError extends Error {
        constructor(code, message) {
            super(message);
            this.name = 'DesignAIError';
            this.code = code;
        }
    }

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    /** Declared type and size, before the file is read. */
    function validateImageMeta(meta) {
        if (!meta || typeof meta !== 'object') return { ok: false, error: 'No file selected.' };
        if (!IMAGE_TYPES[meta.type]) {
            return { ok: false, error: 'Unsupported file type' + (meta.type ? ' (' + meta.type + ')' : '') + '. Use a PNG, JPEG or WebP image.' };
        }
        if (!(meta.size > 0)) return { ok: false, error: 'The file is empty.' };
        if (meta.size > MAX_IMAGE_BYTES) {
            return { ok: false, error: 'The image is ' + formatBytes(meta.size) + '. The limit is ' + formatBytes(MAX_IMAGE_BYTES) + '.' };
        }
        return { ok: true };
    }

    /** What the bytes really are, from the file signature (a renamed .txt is not an image). */
    function sniffImageType(bytes) {
        const b = bytes;
        if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
        if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
        if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
        return null;
    }

    /** Full check once the first bytes are available. */
    function validateImageBytes(meta, bytes) {
        const m = validateImageMeta(meta);
        if (!m.ok) return m;
        const real = sniffImageType(bytes);
        if (!real) return { ok: false, error: 'This file is not a valid PNG, JPEG or WebP image (it may be corrupted or renamed).' };
        if (real !== meta.type) {
            return { ok: false, error: 'The file says it is ' + IMAGE_TYPES[meta.type] + ' but its contents are ' + IMAGE_TYPES[real] + '. Re-export it as a normal image.' };
        }
        return { ok: true, type: real };
    }

    function validateImageDimensions(width, height) {
        if (!(width > 0 && height > 0)) return { ok: false, error: 'The image has no readable size, so it is probably corrupted.' };
        if (width * height > MAX_IMAGE_PIXELS) return { ok: false, error: 'The image is ' + width + '×' + height + ', which is too large to display safely.' };
        return { ok: true };
    }

    // ── Patch operations ───────────────────────────────────────────────
    // Properties a design patch may set. Position, z-index, content, filters,
    // pointer-events and anything that could cover the page or load a
    // resource are deliberately absent.
    const LENGTH = 'length', COLOR = 'color', KEYWORD = 'keyword', NUMBER = 'number', ANY = 'any';
    const PROPERTY_TYPES = {
        'display': { kind: KEYWORD, values: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents'] },
        'flex-direction': { kind: KEYWORD, values: ['row', 'row-reverse', 'column', 'column-reverse'] },
        'flex-wrap': { kind: KEYWORD, values: ['nowrap', 'wrap', 'wrap-reverse'] },
        'justify-content': { kind: KEYWORD, values: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'start', 'end', 'normal', 'stretch'] },
        'align-items': { kind: KEYWORD, values: ['flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'start', 'end', 'normal'] },
        'align-content': { kind: KEYWORD, values: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'stretch', 'start', 'end', 'normal'] },
        'align-self': { kind: KEYWORD, values: ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'start', 'end'] },
        'grid-template-columns': { kind: ANY },
        'grid-template-rows': { kind: ANY },
        'gap': { kind: LENGTH, multi: 2 },
        'row-gap': { kind: LENGTH },
        'column-gap': { kind: LENGTH },
        'width': { kind: LENGTH, keywords: ['auto', 'fit-content', 'max-content', 'min-content'] },
        'max-width': { kind: LENGTH, keywords: ['none', 'fit-content', 'max-content', 'min-content'] },
        'min-width': { kind: LENGTH, keywords: ['auto', 'fit-content', 'max-content', 'min-content'] },
        'height': { kind: LENGTH, keywords: ['auto', 'fit-content', 'max-content', 'min-content'] },
        'max-height': { kind: LENGTH, keywords: ['none', 'fit-content', 'max-content', 'min-content'] },
        'min-height': { kind: LENGTH, keywords: ['auto', 'fit-content', 'max-content', 'min-content'] },
        'padding': { kind: LENGTH, multi: 4 },
        'padding-top': { kind: LENGTH }, 'padding-right': { kind: LENGTH }, 'padding-bottom': { kind: LENGTH }, 'padding-left': { kind: LENGTH },
        'margin': { kind: LENGTH, multi: 4, keywords: ['auto'] },
        'margin-top': { kind: LENGTH, keywords: ['auto'] }, 'margin-right': { kind: LENGTH, keywords: ['auto'] },
        'margin-bottom': { kind: LENGTH, keywords: ['auto'] }, 'margin-left': { kind: LENGTH, keywords: ['auto'] },
        'overflow': { kind: KEYWORD, values: ['visible', 'hidden', 'auto', 'scroll', 'clip'] },
        'box-sizing': { kind: KEYWORD, values: ['border-box', 'content-box'] },
        'font-size': { kind: LENGTH },
        'font-weight': { kind: ANY },
        'font-family': { kind: ANY },
        'font-style': { kind: KEYWORD, values: ['normal', 'italic', 'oblique'] },
        'line-height': { kind: LENGTH, keywords: ['normal'], unitless: true },
        'letter-spacing': { kind: LENGTH, keywords: ['normal'] },
        'text-align': { kind: KEYWORD, values: ['left', 'right', 'center', 'justify', 'start', 'end'] },
        'text-transform': { kind: KEYWORD, values: ['none', 'uppercase', 'lowercase', 'capitalize'] },
        'text-decoration': { kind: ANY },
        'color': { kind: COLOR },
        'background-color': { kind: COLOR },
        'background-image': { kind: ANY, gradientOnly: true },
        'background': { kind: ANY, gradientOnly: true },
        'border': { kind: ANY },
        'border-width': { kind: LENGTH, multi: 4 },
        'border-style': { kind: KEYWORD, values: ['none', 'solid', 'dashed', 'dotted', 'double'] },
        'border-color': { kind: COLOR },
        'border-radius': { kind: LENGTH, multi: 4 },
        'box-shadow': { kind: ANY },
        'opacity': { kind: NUMBER, min: 0, max: 1 },
        // Layout-only extras used by responsive fixes (viewer "Fix it")
        'overflow-x': { kind: KEYWORD, values: ['visible', 'hidden', 'auto', 'scroll', 'clip'] },
        'overflow-y': { kind: KEYWORD, values: ['visible', 'hidden', 'auto', 'scroll', 'clip'] },
        'overflow-wrap': { kind: KEYWORD, values: ['normal', 'break-word', 'anywhere'] },
        'word-break': { kind: KEYWORD, values: ['normal', 'break-all', 'keep-all', 'break-word'] },
        'hyphens': { kind: KEYWORD, values: ['none', 'manual', 'auto'] },
        'white-space': { kind: KEYWORD, values: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'break-spaces'] },
        'text-overflow': { kind: KEYWORD, values: ['clip', 'ellipsis'] },
        'object-fit': { kind: KEYWORD, values: ['fill', 'contain', 'cover', 'none', 'scale-down'] },
        'justify-items': { kind: KEYWORD, values: ['start', 'end', 'center', 'stretch', 'normal'] },
        'aspect-ratio': { kind: ANY },
        'flex': { kind: ANY },
        'flex-basis': { kind: LENGTH, keywords: ['auto', 'content'] },
        'flex-grow': { kind: NUMBER, min: 0, max: 100 },
        'flex-shrink': { kind: NUMBER, min: 0, max: 100 },
        'order': { kind: NUMBER, min: -100, max: 100 },
        'grid-column': { kind: ANY },
        'grid-row': { kind: ANY },
    };

    const FORBIDDEN_VALUE = /url\s*\(|image-set\s*\(|element\s*\(|expression\s*\(|javascript:|vbscript:|data:|@import|behavior\s*:|-moz-binding|[;{}<>\\]|\/\*|\*\/|[\u0000-\u001f]/i;
    const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix)\([^()]*(?:\([^()]*\)[^()]*)*\)|[a-z]+)$/i;
    const LENGTH_TOKEN = /^(?:-?\d*\.?\d+(?:px|em|rem|%|vw|vh|vmin|vmax|ch|ex|pt|cm|mm|in|svh|dvh|lvh|svw|dvw|lvw)?|0|(?:calc|min|max|clamp)\([^()]*(?:\([^()]*\)[^()]*)*\)|var\(--[\w-]+(?:\s*,\s*[^()]*)?\))$/i;
    const GRADIENT_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

    function balancedParens(s) {
        let d = 0;
        for (let i = 0; i < s.length; i++) {
            if (s[i] === '(') d++;
            else if (s[i] === ')' && --d < 0) return false;
        }
        return d === 0;
    }

    // Splits on spaces that are not inside parentheses.
    function splitTopLevel(s) {
        const out = [];
        let depth = 0, cur = '';
        for (const ch of s) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
        }
        if (cur) out.push(cur);
        return out;
    }

    // Splits on commas that are not inside parentheses.
    function splitCommas(s) {
        const out = [];
        let depth = 0, cur = '';
        for (const ch of s) {
            if (ch === '(') depth++;
            if (ch === ')') depth--;
            if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
        }
        out.push(cur.trim());
        return out;
    }

    /**
     * Checks one declaration. Returns { ok, value } with the normalised value
     * (trimmed, "!important" stripped, bare numbers given px) or { ok:false, error }.
     */
    function validateDeclaration(property, rawValue) {
        const type = Object.prototype.hasOwnProperty.call(PROPERTY_TYPES, property) ? PROPERTY_TYPES[property] : null;
        if (!type) return { ok: false, error: '"' + String(property).slice(0, 40) + '" is not a property design patches may change.' };
        if (typeof rawValue !== 'string') return { ok: false, error: property + ': value must be text.' };
        let value = rawValue.replace(/\s*!important\s*$/i, '').trim().replace(/\s+/g, ' ');
        if (!value) return { ok: false, error: property + ': value is empty.' };
        if (value.length > MAX_VALUE_LENGTH) return { ok: false, error: property + ': value is longer than ' + MAX_VALUE_LENGTH + ' characters.' };
        if (FORBIDDEN_VALUE.test(value)) return { ok: false, error: property + ': value contains something that is not allowed (url(), data:, braces, semicolons or script).' };
        if (!balancedParens(value)) return { ok: false, error: property + ': unbalanced parentheses.' };
        if (/^(inherit|initial|unset|revert|revert-layer)$/i.test(value)) return { ok: true, value: value.toLowerCase() };

        switch (type.kind) {
            case KEYWORD:
                if (type.values.indexOf(value.toLowerCase()) === -1) return { ok: false, error: property + ': use one of ' + type.values.join(', ') + '.' };
                return { ok: true, value: value.toLowerCase() };
            case COLOR:
                if (!COLOR_RE.test(value)) return { ok: false, error: property + ': "' + value + '" is not a colour.' };
                if (/^[a-z]+$/i.test(value) && !/^(transparent|currentcolor|[a-z]{3,20})$/i.test(value)) return { ok: false, error: property + ': "' + value + '" is not a colour.' };
                return { ok: true, value: value };
            case NUMBER: {
                const n = Number(value);
                if (!isFinite(n) || n < type.min || n > type.max) return { ok: false, error: property + ': enter a number from ' + type.min + ' to ' + type.max + '.' };
                return { ok: true, value: String(n) };
            }
            case LENGTH: {
                const parts = splitTopLevel(value);
                const max = type.multi || 1;
                if (parts.length > max) return { ok: false, error: property + ': at most ' + max + ' value' + (max > 1 ? 's' : '') + '.' };
                const out = [];
                for (const p of parts) {
                    if (type.keywords && type.keywords.indexOf(p.toLowerCase()) !== -1) { out.push(p.toLowerCase()); continue; }
                    if (!LENGTH_TOKEN.test(p)) return { ok: false, error: property + ': "' + p + '" is not a valid length (try 16px, 1.5rem, 50% or calc()).' };
                    // bare numbers mean px, except where a unitless value is meaningful
                    if (/^-?\d*\.?\d+$/.test(p) && Number(p) !== 0 && !type.unitless) out.push(p + 'px');
                    else out.push(p);
                }
                return { ok: true, value: out.join(' ') };
            }
            default: {
                if (type.gradientOnly) {
                    const layers = splitCommas(value);
                    const okLayers = layers.every(function (l) { return GRADIENT_RE.test(l) || l === 'none' || COLOR_RE.test(l); });
                    if (!okLayers) return { ok: false, error: property + ': only colours and gradients are allowed (no images).' };
                }
                if (property === 'font-weight' && !/^(normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/i.test(value)) return { ok: false, error: 'font-weight: use 100–900, normal or bold.' };
                if (property === 'font-family' && !/^[\w\s,'"-]+$/.test(value)) return { ok: false, error: 'font-family: use font names separated by commas.' };
                return { ok: true, value: value };
            }
        }
    }

    /**
     * Validates a whole patch. Returns { ok, operations, errors } where
     * operations holds only the clean, normalised ones. Nothing is applied here.
     *   { op:'set',    property, value, breakpoint? }
     *   { op:'remove', property, breakpoint? }
     *   { op:'text',   value }            (leaf elements only; enforced by the engine)
     */
    function validatePatch(patch) {
        const errors = [], operations = [];
        if (!patch || typeof patch !== 'object' || !Array.isArray(patch.operations)) {
            return { ok: false, operations: operations, errors: ['A patch needs an "operations" list.'] };
        }
        if (patch.operations.length === 0) return { ok: false, operations: operations, errors: ['The patch has no operations.'] };
        if (patch.operations.length > MAX_OPS_PER_PATCH) return { ok: false, operations: operations, errors: ['A patch may contain at most ' + MAX_OPS_PER_PATCH + ' operations.'] };
        patch.operations.forEach(function (op, i) {
            const at = 'Operation ' + (i + 1) + ': ';
            if (!op || typeof op !== 'object') { errors.push(at + 'not an object.'); return; }
            const bp = op.breakpoint === undefined ? 'base' : op.breakpoint;
            if (!Object.prototype.hasOwnProperty.call(BREAKPOINTS, bp)) { errors.push(at + 'breakpoint must be base, tablet or mobile.'); return; }
            if (op.op === 'set') {
                const r = validateDeclaration(op.property, op.value);
                if (!r.ok) errors.push(at + r.error);
                else operations.push({ op: 'set', property: op.property, value: r.value, breakpoint: bp });
            } else if (op.op === 'remove') {
                if (!Object.prototype.hasOwnProperty.call(PROPERTY_TYPES, op.property)) errors.push(at + 'unknown property.');
                else operations.push({ op: 'remove', property: op.property, breakpoint: bp });
            } else if (op.op === 'text') {
                if (typeof op.value !== 'string' || !op.value.trim()) errors.push(at + 'text is empty.');
                else if (op.value.length > MAX_TEXT_LENGTH) errors.push(at + 'text is longer than ' + MAX_TEXT_LENGTH + ' characters.');
                else operations.push({ op: 'text', value: op.value });
            } else {
                errors.push(at + 'unknown operation "' + String(op.op).slice(0, 20) + '".');
            }
        });
        return { ok: errors.length === 0, operations: operations, errors: errors };
    }

    // ── Patch history ──────────────────────────────────────────────────
    function emptyState() { return { decl: { base: {}, tablet: {}, mobile: {} }, text: null }; }
    function cloneState(s) {
        return { decl: { base: Object.assign({}, s.decl.base), tablet: Object.assign({}, s.decl.tablet), mobile: Object.assign({}, s.decl.mobile) }, text: s.text };
    }

    class PatchStore {
        constructor() {
            this.state = emptyState();
            this.past = [];     // { state, label }
            this.future = [];
            this.log = [];      // labels of applied patches, oldest first
        }

        /** Validates and applies. All-or-nothing: one bad operation rejects the patch. */
        apply(patch, label, options) {
            const v = validatePatch(patch);
            if (!v.ok) return { ok: false, errors: v.errors };
            const next = cloneState(this.state);
            v.operations.forEach(function (op) {
                if (op.op === 'set') next.decl[op.breakpoint][op.property] = op.value;
                else if (op.op === 'remove') delete next.decl[op.breakpoint][op.property];
                else if (op.op === 'text') next.text = op.value;
            });
            if (JSON.stringify(next) === JSON.stringify(this.state)) return { ok: true, changed: false, errors: [] };
            const key = options && options.coalesce;
            if (key && key === this.lastKey && this.past.length) {
                // keep dragging a slider or colour picker as ONE undo step
                this.log[this.log.length - 1] = label || 'Change';
            } else {
                this.past.push({ state: this.state, label: label || 'Change' });
                this.log.push(label || 'Change');
            }
            this.lastKey = key || null;
            this.state = next;
            this.future = [];
            return { ok: true, changed: true, errors: [] };
        }

        canUndo() { return this.past.length > 0; }
        canRedo() { return this.future.length > 0; }

        undo() {
            const prev = this.past.pop();
            if (!prev) return false;
            this.lastKey = null;
            this.future.push({ state: this.state, label: this.log.pop() });
            this.state = prev.state;
            return true;
        }

        redo() {
            const next = this.future.pop();
            if (!next) return false;
            this.lastKey = null;
            this.past.push({ state: this.state, label: next.label });
            this.log.push(next.label);
            this.state = next.state;
            return true;
        }

        /** Drops every override and the history. */
        reset() {
            this.state = emptyState();
            this.past = [];
            this.future = [];
            this.log = [];
            this.lastKey = null;
        }

        isEmpty() {
            return !this.state.text && Object.keys(this.state.decl).every(function (k) { return Object.keys(this.state.decl[k]).length === 0; }, this);
        }

        /** Flat list of the active overrides, for the UI and for export summaries. */
        changes() {
            const out = [];
            Object.keys(BREAKPOINTS).forEach(function (bp) {
                Object.keys(this.state.decl[bp]).forEach(function (prop) {
                    out.push({ breakpoint: bp, property: prop, value: this.state.decl[bp][prop] });
                }, this);
            }, this);
            if (this.state.text) out.push({ breakpoint: 'base', property: 'text', value: this.state.text });
            return out;
        }

        /**
         * CSS for the active overrides. Desktop first, then tablet, then mobile,
         * so narrower rules win. `important` makes the preview beat the site's own rules.
         */
        toCss(selector, options) {
            const important = !options || options.important !== false;
            const suffix = important ? ' !important' : '';
            const blocks = [];
            Object.keys(BREAKPOINTS).forEach(function (bp) {
                const props = Object.keys(this.state.decl[bp]);
                if (!props.length) return;
                const body = props.map(function (p) { return '  ' + p + ': ' + this.state.decl[bp][p] + suffix + ';'; }, this).join('\n');
                const media = BREAKPOINTS[bp].media;
                blocks.push(media
                    ? '@media ' + media + ' {\n' + selector.replace(/^/gm, '  ') + ' {\n' + body.replace(/^/gm, '  ') + '\n  }\n}'
                    : selector + ' {\n' + body + '\n}');
            }, this);
            return blocks.join('\n\n');
        }
    }

    // ── Export ─────────────────────────────────────────────────────────
    const FRAMEWORKS = {
        html: { label: 'Plain HTML/CSS' },
        react: { label: 'React' },
        next: { label: 'Next.js' },
        tailwind: { label: 'Tailwind CSS' },
    };

    /**
     * Guidance only. Nothing here converts the page into React, Next.js or
     * Tailwind; it explains how to bring the exported CSS into that stack.
     */
    function frameworkGuidance(framework, className) {
        const cls = className || 'cx-section';
        switch (framework) {
            case 'react':
                return [
                    'React guidance (not a generated component)',
                    '1. Save the CSS below as a stylesheet, for example ' + cls + '.css, and import it in your component.',
                    '2. Give the matching element className="' + cls + '". The selector in the CSS targets that class.',
                    '3. In JSX use className instead of class, and convert any inline style strings to objects.',
                    '4. The exported HTML is a static snapshot: it does not include this site\'s JavaScript or components.',
                ].join('\n');
            case 'next':
                return [
                    'Next.js guidance (not a generated component)',
                    '1. Save the CSS as ' + cls + '.module.css next to your component, or in a global stylesheet.',
                    '2. With a CSS module use className={styles.' + cls.replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); }) + '}; with a global stylesheet use className="' + cls + '".',
                    '3. Replace the selector in the CSS with ".' + cls + '" (it is already set when you choose a class name).',
                    '4. The exported HTML is a static snapshot: it does not include this site\'s JavaScript or components.',
                ].join('\n');
            case 'tailwind':
                return [
                    'Tailwind guidance (no automatic conversion is performed)',
                    'The CSS below is plain CSS. To use Tailwind, map each declaration to a utility class yourself,',
                    'or keep it as-is in a global stylesheet or inside @layer components { ... }.',
                    'Declarations are listed per breakpoint: Desktop = base, Tablet = max-width 1024px, Mobile = max-width 640px.',
                    'Tailwind\'s own breakpoints are min-width based, so responsive overrides need to be inverted when converted.',
                ].join('\n');
            default:
                return 'Plain HTML/CSS: paste the CSS into a <style> block or stylesheet and give the element the class "' + cls + '".';
        }
    }

    /** Tidy class name for exports, e.g. "hero-section" from the element's own class. */
    function exportClassName(classes) {
        const first = (classes || []).filter(function (c) { return /^[a-z][\w-]{1,30}$/i.test(c) && !/^(css-|sc-|jsx-|_)/.test(c) && !/\d{4,}/.test(c); })[0];
        return first ? first : 'cx-section';
    }

    const REMOVE_ELEMENTS = 'script,style,link,meta,iframe,frame,frameset,object,embed,applet,base,form,noscript,template,portal,dialog,svg script,codex-inspector,codex-ai-panel,codex-design-ai-panel';

    /**
     * Sanitized copy of an element's markup for export. Scripts, frames, forms,
     * event handlers, javascript: URLs and extension attributes are removed.
     * Text and structure are kept. Needs a DOM (DOMParser).
     */
    function sanitizeHtml(html, options) {
        const doc = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html');
        const body = doc.body;
        body.querySelectorAll(REMOVE_ELEMENTS).forEach(function (n) { n.remove(); });
        const stripClasses = options && options.stripClasses;
        body.querySelectorAll('*').forEach(function (el) {
            Array.prototype.slice.call(el.attributes).forEach(function (a) {
                const name = a.name.toLowerCase(), val = a.value;
                const unsafeUrl = /^\s*(javascript|vbscript|data:text\/html)/i.test(val);
                if (/^on/.test(name) || name.indexOf('data-cx') === 0 || name.indexOf('data-selected') === 0 || name === 'data-label-id' || name === 'data-measuring' ||
                    name === 'data-pseudo-select' || name === 'srcdoc' || name === 'nonce' || name === 'integrity' ||
                    ((name === 'href' || name === 'src' || name === 'xlink:href' || name === 'action' || name === 'formaction') && unsafeUrl)) {
                    el.removeAttribute(a.name);
                } else if (name === 'style' && /url\s*\(|expression\s*\(|javascript:/i.test(val)) {
                    el.removeAttribute('style');
                }
            });
            if (stripClasses) el.removeAttribute('class');
        });
        let out = body.innerHTML.replace(/>\s+</g, '>\n<').trim();
        if (out.length > MAX_HTML_BYTES) out = out.slice(0, MAX_HTML_BYTES) + '\n<!-- truncated -->';
        return out;
    }

    /**
     * Bundles the export text. `css` must come from PatchStore.toCss so it is
     * exactly what the preview applied.
     */
    function buildExport(input) {
        const framework = FRAMEWORKS[input.framework] ? input.framework : 'html';
        const cls = input.className || 'cx-section';
        const css = input.css || '';
        const parts = {
            css: css ? '/* Generated by Codex Dev Design Inspector AI. Applies to: ' + input.selectorLabel + ' */\n' + css : '',
            guidance: frameworkGuidance(framework, cls),
            html: input.html ? input.html : '',
            notes: [
                'Temporary preview export: your website\'s source files were not changed.',
                'Exported HTML is a sanitized static snapshot of the section; the site\'s JavaScript behaviour and framework components are not reproduced.',
            ],
        };
        return parts;
    }

    root.DesignAICore = {
        MAX_IMAGE_BYTES, IMAGE_TYPES, BREAKPOINTS, PROPERTY_TYPES, FRAMEWORKS, DesignAIError,
        formatBytes, validateImageMeta, sniffImageType, validateImageBytes, validateImageDimensions,
        validateDeclaration, validatePatch, PatchStore,
        frameworkGuidance, exportClassName, sanitizeHtml, buildExport,
    };
})(typeof self !== 'undefined' ? self : this);
