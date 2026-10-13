// Design Inspector AI: GSAP animations.
//
// The user describes the motion in plain words; the AI answers with an
// ANIMATION SPEC (plain data, never script). This file is the only way a spec
// reaches the page:
//
// - validateAnimation(): allow-lists every property, value, ease and selector
//   and normalises the spec. Anything else is dropped with a warning.
// - buildCode(): turns a validated spec into GSAP code the user can paste into
//   plain HTML, React or Next.js.
// - play(): runs a validated spec on the selected element with the bundled
//   GSAP (vendor/gsap, loaded before this file) and can revert it completely.
//
// Spec shape (after validation):
//   { summary, trigger:'load'|'scroll'|'hover', repeat, yoyo, repeatDelay,
//     scroll:{ start, end, scrub, once } | null,
//     steps:[{ target:'self'|'children'|'select', selector, method:'from'|'to'|'fromTo',
//              from:{}, to:{}, duration, delay, ease, stagger:{ each, from } | null, position }] }
(function (root) {
    'use strict';
    if (root.DesignAIAnimation) return;

    const MAX_STEPS = 8;
    const MAX_TOTAL_SECONDS = 20;
    const FORBIDDEN = /url\s*\(|image-set\s*\(|expression\s*\(|javascript:|vbscript:|data:|@import|[;{}<>\\]|\/\*|\*\/|[\u0000-\u001f]/i;
    const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([^()]*\)|transparent|currentcolor|[a-z]{3,20})$/i;
    const NUM = '-?\\d*\\.?\\d+';
    const NUM_RE = new RegExp('^' + NUM + '$');
    const LEN_RE = new RegExp('^' + NUM + '(px|%|em|rem|vw|vh)?$');
    const DEG_RE = new RegExp('^' + NUM + '(deg)?$');
    const ORIGIN_RE = /^(top|bottom|left|right|center|-?\d+(\.\d+)?%|-?\d+(\.\d+)?px)( (top|bottom|left|right|center|-?\d+(\.\d+)?%|-?\d+(\.\d+)?px)){0,2}$/i;
    const FILTER_RE = /^((blur|brightness|contrast|saturate|grayscale)\(\d*\.?\d+(px|%)?\)\s?){1,3}$/i;
    const CLIP_RE = /^(inset\([\d.%\s]+(round [\d.%\s]+)?\)|circle\([\d.%\s]+(at [\w.%\s]+)?\)|ellipse\([\d.%\s]+(at [\w.%\s]+)?\)|polygon\([\d.%\s,]+\))$/i;
    const EASE_RE = /^(none|linear|(?:power[1-4]|sine|expo|circ|quad|cubic|quart|quint|back|elastic|bounce)\.(?:in|out|inOut)(?:\([\d.,\s-]{1,20}\))?|steps\(\d{1,2}\))$/;
    const POSITION_RE = /^(<|>|[<>][+-]=?\d*\.?\d+|[+-]=\d*\.?\d+|\d*\.?\d+)$/;
    const SCROLL_POS_RE = /^[a-z0-9%+\-=. ]{1,30}$/i;
    const SELECTOR_RE = /^[\w\s.#>\-[\]="'*~+,:()]{1,120}$/;
    const STAGGER_FROM = ['start', 'center', 'end', 'edges', 'random'];

    // GSAP property -> how its value is checked
    const PROPS = {
        opacity: { kind: 'unit', min: 0, max: 1 },
        autoAlpha: { kind: 'unit', min: 0, max: 1 },
        x: { kind: 'length' }, y: { kind: 'length' },
        xPercent: { kind: 'number', min: -500, max: 500 }, yPercent: { kind: 'number', min: -500, max: 500 },
        scale: { kind: 'number', min: 0, max: 10 }, scaleX: { kind: 'number', min: 0, max: 10 }, scaleY: { kind: 'number', min: 0, max: 10 },
        rotation: { kind: 'deg' }, rotationX: { kind: 'deg' }, rotationY: { kind: 'deg' },
        skewX: { kind: 'deg' }, skewY: { kind: 'deg' },
        transformOrigin: { kind: 'origin' },
        color: { kind: 'color' }, backgroundColor: { kind: 'color' }, borderColor: { kind: 'color' },
        borderRadius: { kind: 'length' }, letterSpacing: { kind: 'length' },
        width: { kind: 'length', auto: true }, height: { kind: 'length', auto: true },
        clipPath: { kind: 'clip' },
        filter: { kind: 'filter' },
    };
    const PROP_NAMES = Object.keys(PROPS);

    function num(v) { return typeof v === 'number' ? v : (typeof v === 'string' && NUM_RE.test(v.trim()) ? Number(v) : NaN); }
    function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

    function validateValue(prop, raw) {
        const t = Object.prototype.hasOwnProperty.call(PROPS, prop) ? PROPS[prop] : null;
        if (!t) return { error: '"' + String(prop).slice(0, 30) + '" is not an animatable property (use ' + PROP_NAMES.slice(0, 8).join(', ') + '...).' };
        if (typeof raw !== 'number' && typeof raw !== 'string') return { error: prop + ': value must be a number or text.' };
        const s = String(raw).trim();
        if (!s || s.length > 120) return { error: prop + ': value is empty or too long.' };
        if (FORBIDDEN.test(s)) return { error: prop + ': value contains something that is not allowed.' };
        switch (t.kind) {
            case 'unit': { const n = num(s); return isFinite(n) && n >= 0 && n <= 1 ? { value: n } : { error: prop + ': use a number from 0 to 1.' }; }
            case 'number': { const n = num(s); return isFinite(n) && n >= t.min && n <= t.max ? { value: n } : { error: prop + ': use a number from ' + t.min + ' to ' + t.max + '.' }; }
            case 'deg': {
                if (!DEG_RE.test(s)) return { error: prop + ': use degrees, for example 15 or -8deg.' };
                const n = parseFloat(s);
                return Math.abs(n) <= 3600 ? { value: n } : { error: prop + ': too large.' };
            }
            case 'length': {
                if (t.auto && s === 'auto') return { value: 'auto' };
                if (!LEN_RE.test(s)) return { error: prop + ': "' + s + '" is not a length (use 40, 40px, 50% or 2rem).' };
                const n = parseFloat(s);
                if (Math.abs(n) > 5000) return { error: prop + ': too large.' };
                return { value: NUM_RE.test(s) ? n : s };
            }
            case 'color': return COLOR_RE.test(s) ? { value: s } : { error: prop + ': "' + s + '" is not a colour.' };
            case 'origin': return ORIGIN_RE.test(s) ? { value: s } : { error: prop + ': use keywords or percentages like "50% 100%".' };
            case 'clip': return CLIP_RE.test(s) ? { value: s } : { error: prop + ': use inset(), circle(), ellipse() or polygon() with numbers.' };
            case 'filter': return FILTER_RE.test(s) ? { value: s } : { error: prop + ': use blur(8px), brightness(1.2), saturate(0)...' };
        }
        return { error: prop + ': not supported.' };
    }

    // Accepts [{property,value}] (what the AI returns) or a plain object
    function entries(vars) {
        if (Array.isArray(vars)) return vars.filter(function (e) { return e && typeof e === 'object'; }).map(function (e) { return [e.property, e.value]; });
        if (vars && typeof vars === 'object') return Object.keys(vars).map(function (k) { return [k, vars[k]]; });
        return [];
    }

    function cleanVars(vars, label, warnings) {
        const out = {};
        entries(vars).slice(0, 14).forEach(function (pair) {
            const r = validateValue(pair[0], pair[1]);
            if (r.error) warnings.push(label + ': ' + r.error); else out[pair[0]] = r.value;
        });
        return out;
    }

    function numberIn(v, lo, hi, dflt) { const n = num(v); return isFinite(n) ? clamp(n, lo, hi) : dflt; }

    /**
     * Returns { ok, spec, warnings, errors }. ok is true when at least one step
     * survived; dropped properties or steps are listed in warnings.
     */
    function validateAnimation(input) {
        const warnings = [], errors = [];
        if (!input || typeof input !== 'object' || !Array.isArray(input.steps) || !input.steps.length) {
            return { ok: false, spec: null, warnings: warnings, errors: ['The animation has no steps.'] };
        }
        const trigger = ['load', 'scroll', 'hover'].indexOf(input.trigger) !== -1 ? input.trigger : 'load';
        const spec = {
            summary: String(input.summary || '').slice(0, 400),
            trigger: trigger,
            repeat: Math.round(numberIn(input.repeat, -1, 10, 0)),
            yoyo: input.yoyo === true,
            repeatDelay: numberIn(input.repeatDelay, 0, 10, 0),
            scroll: null,
            steps: [],
        };
        if (trigger === 'hover') { spec.repeat = 0; }
        if (trigger === 'scroll') {
            const sc = input.scroll && typeof input.scroll === 'object' ? input.scroll : {};
            const pos = function (v, d) { return typeof v === 'string' && SCROLL_POS_RE.test(v.trim()) ? v.trim() : d; };
            spec.scroll = { start: pos(sc.start, 'top 80%'), end: pos(sc.end, 'bottom 20%'), scrub: sc.scrub === true, once: sc.once !== false };
        }

        input.steps.slice(0, MAX_STEPS).forEach(function (raw, i) {
            const label = 'Step ' + (i + 1);
            if (!raw || typeof raw !== 'object') { warnings.push(label + ' was not readable and was skipped.'); return; }
            const target = ['self', 'children', 'select'].indexOf(raw.target) !== -1 ? raw.target : 'self';
            let selector = null;
            if (target === 'select') {
                selector = typeof raw.selector === 'string' ? raw.selector.trim() : '';
                if (!selector || !SELECTOR_RE.test(selector)) { warnings.push(label + ': the target selector is missing or not allowed; step skipped.'); return; }
            }
            const method = ['from', 'to', 'fromTo'].indexOf(raw.method) !== -1 ? raw.method : 'from';
            const from = method === 'to' ? {} : cleanVars(raw.from, label, warnings);
            const to = method === 'from' ? {} : cleanVars(raw.to, label, warnings);
            // "from" tweens animate from the given values to the current ones
            if (method === 'from' && !Object.keys(from).length) { warnings.push(label + ' had nothing to animate and was skipped.'); return; }
            if (method === 'to' && !Object.keys(to).length) { warnings.push(label + ' had nothing to animate and was skipped.'); return; }
            if (method === 'fromTo' && (!Object.keys(from).length || !Object.keys(to).length)) { warnings.push(label + ' needs both start and end values; skipped.'); return; }
            let ease = typeof raw.ease === 'string' ? raw.ease.trim() : '';
            if (!ease) ease = 'power2.out';
            else if (!EASE_RE.test(ease)) { warnings.push(label + ': ease "' + ease.slice(0, 30) + '" is not supported; using power2.out.'); ease = 'power2.out'; }
            const each = numberIn(raw.stagger, 0, 2, 0);
            const stagger = target !== 'self' && each > 0
                ? { each: each, from: STAGGER_FROM.indexOf(raw.staggerFrom) !== -1 ? raw.staggerFrom : 'start' }
                : null;
            let position = null;
            if (raw.position !== null && raw.position !== undefined && String(raw.position).trim() !== '') {
                const p = String(raw.position).trim();
                if (POSITION_RE.test(p)) position = p; else warnings.push(label + ': position "' + p.slice(0, 20) + '" was ignored.');
            }
            spec.steps.push({
                target: target, selector: selector, method: method, from: from, to: to,
                duration: numberIn(raw.duration, 0.05, 10, 0.6), delay: numberIn(raw.delay, 0, 10, 0),
                ease: ease, stagger: stagger, position: position,
            });
        });
        if (input.steps.length > MAX_STEPS) warnings.push('Only the first ' + MAX_STEPS + ' steps are used.');
        if (!spec.steps.length) return { ok: false, spec: null, warnings: warnings, errors: ['No step could be used.'].concat(warnings.slice(0, 3)) };
        const total = spec.steps.reduce(function (t, s) { return t + s.duration + s.delay + (s.stagger ? s.stagger.each * 20 : 0); }, 0);
        if (total > MAX_TOTAL_SECONDS * 4) return { ok: false, spec: null, warnings: warnings, errors: ['This animation is far too long. Ask for something shorter.'] };
        return { ok: true, spec: spec, warnings: warnings, errors: errors };
    }

    // ── Code export ────────────────────────────────────────────────────
    function jsValue(v) { return typeof v === 'number' ? String(v) : JSON.stringify(v).replace(/"/g, "'"); }
    function jsObject(o, extra) {
        const parts = Object.keys(o).map(function (k) { return k + ': ' + jsValue(o[k]); });
        return '{ ' + parts.concat(extra || []).join(', ') + ' }';
    }

    function targetExpr(step, rootVar) {
        if (step.target === 'children') return rootVar + '.children';
        if (step.target === 'select') return rootVar + ".querySelectorAll('" + step.selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "')";
        return rootVar;
    }

    function tweenLine(step, rootVar, indent) {
        const common = ['duration: ' + step.duration, 'ease: ' + jsValue(step.ease)];
        if (step.delay) common.push('delay: ' + step.delay);
        if (step.stagger) common.push('stagger: { each: ' + step.stagger.each + ", from: '" + step.stagger.from + "' }");
        const pos = step.position ? ', ' + jsValue(/^\d*\.?\d+$/.test(step.position) ? Number(step.position) : step.position) : '';
        const t = targetExpr(step, rootVar);
        if (step.method === 'fromTo') return indent + 'tl.fromTo(' + t + ', ' + jsObject(step.from) + ', ' + jsObject(step.to, common) + pos + ');';
        return indent + 'tl.' + step.method + '(' + t + ', ' + jsObject(step.method === 'from' ? step.from : step.to, common) + pos + ');';
    }

    function timelineOptions(spec, rootVar) {
        const o = [];
        if (spec.trigger === 'hover') o.push('paused: true');
        if (spec.repeat) o.push('repeat: ' + spec.repeat);
        if (spec.yoyo) o.push('yoyo: true');
        if (spec.repeat && spec.repeatDelay) o.push('repeatDelay: ' + spec.repeatDelay);
        if (spec.trigger === 'scroll' && spec.scroll) {
            const s = spec.scroll;
            o.push('scrollTrigger: { trigger: ' + rootVar + ", start: '" + s.start + "', end: '" + s.end + "'" +
                (s.scrub ? ', scrub: true' : ", toggleActions: '" + (s.once ? 'play none none none' : 'play none none reverse') + "'") + (s.once && !s.scrub ? ', once: true' : '') + ' }');
        }
        return o;
    }

    /**
     * GSAP code for a validated spec.
     * framework: 'html' | 'tailwind' | 'react' | 'next'. selector: CSS selector of the animated element.
     */
    function buildCode(spec, options) {
        options = options || {};
        const fw = options.framework || 'html';
        const selector = (options.selector || '.animated').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const scroll = spec.trigger === 'scroll';
        const opts = timelineOptions(spec, 'el');
        const reactive = fw === 'react' || fw === 'next';

        if (!reactive) {
            const lines = [];
            lines.push('<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/gsap.min.js"></script>');
            if (scroll) lines.push('<script src="https://cdn.jsdelivr.net/npm/gsap@3.13.0/dist/ScrollTrigger.min.js"></script>');
            lines.push('<script>');
            if (scroll) lines.push('  gsap.registerPlugin(ScrollTrigger);');
            lines.push("  const el = document.querySelector('" + selector + "');");
            lines.push("  if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {");
            lines.push('    const tl = gsap.timeline(' + (opts.length ? '{ ' + opts.join(', ') + ' }' : '') + ');');
            spec.steps.forEach(function (s) { lines.push(tweenLine(s, 'el', '    ')); });
            if (spec.trigger === 'hover') {
                lines.push("    el.addEventListener('mouseenter', () => tl.play());");
                lines.push("    el.addEventListener('mouseleave', () => tl.reverse());");
            }
            lines.push('  }');
            lines.push('</script>');
            return lines.join('\n');
        }

        const lines = [];
        if (fw === 'next') lines.push("'use client';", '');
        lines.push("import { useLayoutEffect, useRef } from 'react';");
        lines.push("import gsap from 'gsap';");
        if (scroll) lines.push("import { ScrollTrigger } from 'gsap/ScrollTrigger';", '', 'gsap.registerPlugin(ScrollTrigger);');
        lines.push('', '// npm install gsap', 'export default function AnimatedSection({ children }) {');
        lines.push('  const ref = useRef(null);', '');
        lines.push('  useLayoutEffect(() => {');
        lines.push('    const el = ref.current;');
        lines.push('    if (!el || window.matchMedia(\'(prefers-reduced-motion: reduce)\').matches) return;');
        lines.push('    let enter, leave;');
        lines.push('    const ctx = gsap.context(() => {');
        lines.push('      const tl = gsap.timeline(' + (opts.length ? '{ ' + opts.join(', ') + ' }' : '') + ');');
        spec.steps.forEach(function (s) { lines.push(tweenLine(s, 'el', '      ')); });
        if (spec.trigger === 'hover') {
            lines.push('      enter = () => tl.play();', '      leave = () => tl.reverse();');
            lines.push("      el.addEventListener('mouseenter', enter);", "      el.addEventListener('mouseleave', leave);");
        }
        lines.push('    }, el);');
        lines.push('    return () => {');
        if (spec.trigger === 'hover') lines.push("      el.removeEventListener('mouseenter', enter);", "      el.removeEventListener('mouseleave', leave);");
        lines.push('      ctx.revert();', '    };', '  }, []);', '');
        lines.push('  return <section ref={ref}>{children}</section>;', '}');
        return lines.join('\n');
    }

    // ── Live preview ───────────────────────────────────────────────────
    let active = null;

    function resolveTargets(el, step) {
        if (step.target === 'children') return Array.prototype.slice.call(el.children);
        if (step.target === 'select') {
            try { return Array.prototype.slice.call(el.querySelectorAll(step.selector), 0, 200); } catch (e) { return []; }
        }
        return [el];
    }

    function libs() {
        const gsap = root.gsap;
        if (!gsap) return null;
        if (root.ScrollTrigger && gsap.registerPlugin) { try { gsap.registerPlugin(root.ScrollTrigger); } catch (e) { /* already registered */ } }
        return gsap;
    }

    function stop() {
        if (!active) return;
        try { active.cleanup(); } catch (e) { /* page changed under us */ }
        active = null;
    }

    /**
     * Runs a validated spec on el. Replaces any animation already playing.
     * Returns { ok, warnings } or { ok:false, error }.
     */
    function play(el, spec) {
        const gsap = libs();
        if (!gsap) return { ok: false, error: 'The animation engine (GSAP) did not load on this page.' };
        if (!el || !el.isConnected) return { ok: false, error: 'The selected element is no longer on the page.' };
        if (!spec || !Array.isArray(spec.steps)) return { ok: false, error: 'There is no animation to play.' };
        stop();
        const warnings = [];
        let enter = null, leave = null, tl = null;
        const ctx = gsap.context(function () {
            const opts = {};
            if (spec.trigger === 'hover') opts.paused = true;
            if (spec.repeat) { opts.repeat = spec.repeat; if (spec.repeatDelay) opts.repeatDelay = spec.repeatDelay; }
            if (spec.yoyo) opts.yoyo = true;
            if (spec.trigger === 'scroll' && spec.scroll && root.ScrollTrigger) {
                const s = spec.scroll;
                opts.scrollTrigger = Object.assign({ trigger: el, start: s.start, end: s.end }, s.scrub ? { scrub: true } : { toggleActions: s.once ? 'play none none none' : 'play none none reverse', once: s.once });
            }
            tl = gsap.timeline(opts);
            spec.steps.forEach(function (step, i) {
                const targets = resolveTargets(el, step);
                if (!targets.length) { warnings.push('Step ' + (i + 1) + ' found nothing to animate.'); return; }
                const common = { duration: step.duration, ease: step.ease };
                if (step.delay) common.delay = step.delay;
                if (step.stagger) common.stagger = { each: step.stagger.each, from: step.stagger.from };
                const pos = step.position === null ? undefined : (/^\d*\.?\d+$/.test(step.position) ? Number(step.position) : step.position);
                if (step.method === 'fromTo') tl.fromTo(targets, Object.assign({}, step.from), Object.assign({}, step.to, common), pos);
                else if (step.method === 'from') tl.from(targets, Object.assign({}, step.from, common), pos);
                else tl.to(targets, Object.assign({}, step.to, common), pos);
            });
            if (spec.trigger === 'hover') {
                enter = function () { tl.play(); };
                leave = function () { tl.reverse(); };
                el.addEventListener('mouseenter', enter);
                el.addEventListener('mouseleave', leave);
            }
        }, el);
        active = {
            el: el, spec: spec,
            cleanup: function () {
                if (enter) el.removeEventListener('mouseenter', enter);
                if (leave) el.removeEventListener('mouseleave', leave);
                ctx.revert();
            },
        };
        if (root.ScrollTrigger && spec.trigger === 'scroll') { try { root.ScrollTrigger.refresh(); } catch (e) { /* ignore */ } }
        return { ok: true, warnings: warnings, hint: spec.trigger === 'hover' ? 'Hover over the section to see it.' : spec.trigger === 'scroll' ? 'Scroll the section into view to see it.' : '' };
    }

    function replay() {
        if (!active) return { ok: false, error: 'There is no animation to replay.' };
        return play(active.el, active.spec);
    }

    root.DesignAIAnimation = {
        PROP_NAMES, MAX_STEPS,
        validateValue, validateAnimation, buildCode,
        play, stop, replay, isPlaying: function () { return !!active; },
    };
})(typeof self !== 'undefined' ? self : this);
