// Responsive audit drawer for the viewer.
//
//  Issues   Runs the page audit inside every device frame (iframe-sync.js runs
//           bridge/probes.js there), merges the results and pins each issue on
//           the device it appears on. No AI is involved in finding issues.
//  Fix it   For one issue, asks Codex AI for CSS rules, validates them
//           (responsive-fix.js), applies them live to every device, re-audits to
//           prove whether it worked, and shows a before/after diff.
//  Explain  Sends a compact layout fingerprint of each device to Codex AI and
//           shows a plain-language summary of what changes between them.
//
// Page-derived text (selectors, messages, element text) is always set with
// textContent, never as HTML.
(function () {
    'use strict';

    const SEV = { high: 0, medium: 1, low: 2 };
    const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
    const TITLES = {
        'horizontal-overflow': 'Page scrolls sideways',
        'viewport-meta-missing': 'No viewport meta tag',
        'text-clipped': 'Text is cut off',
        'overflowing-element': 'Element sticks out of the screen',
        'offscreen-control': 'Control is off screen',
        'overlapping-control': 'Control is covered',
        'small-tap-target': 'Touch target is too small',
        'small-text': 'Text is too small',
    };
    const FINDING_SEV = { problem: 'high', warning: 'medium', info: 'info' };
    const MAX_CONTEXT = 70000;

    const state = {
        open: false, tab: 'issues', busy: '', devices: [], issues: [], skipped: [],
        audited: false, fixes: new Map(), explain: null, explainError: '', quota: null, pins: true, focusMark: null,
    };
    let root = null, body = null, statusEl = null, quotaEl = null, fixSeq = 0, msgSeq = 0;
    // Fix with AI and Explain differences are hidden while AI is off (ai/feature-flags.js)
    const AI = !!self.CODEX_AI_ENABLED;

    // ── tiny DOM helper ────────────────────────────────────────────────
    function h(tag, attrs, ...kids) {
        const el = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v === false || v === null || v === undefined) return;
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
            else el.setAttribute(k, v === true ? '' : v);
        });
        kids.flat().forEach(kid => { if (kid !== null && kid !== undefined && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid))); });
        return el;
    }
    const icon = (n, s) => { const t = document.createElement('span'); t.className = 'ra-ico'; t.innerHTML = window.CodexIcons ? CodexIcons.svg(n, s || 16) : ''; return t; };
    const toast = (m, ms) => { if (window.CodexUI && CodexUI.toast) CodexUI.toast(m, ms || 2500); };

    // ── devices and frame messaging ────────────────────────────────────
    function devices() {
        return Array.from(document.querySelectorAll('.viewport')).map(v => {
            const iframe = v.querySelector('iframe');
            const title = v.querySelector('.viewport-title');
            if (!iframe || !title) return null;
            return { uid: v.dataset.uid, name: title.textContent, iframe, viewport: v, width: Number(iframe.width) || iframe.clientWidth };
        }).filter(Boolean);
    }

    function ask(iframe, type, payload, timeout) {
        return new Promise((resolve, reject) => {
            const id = 'ra' + (++msgSeq);
            const timer = setTimeout(() => { window.removeEventListener('message', on); reject(new Error('This device did not respond. Refresh it and try again.')); }, timeout || 15000);
            function on(e) {
                if (e.source !== iframe.contentWindow || !e.data || e.data.type !== 'CODEX_RA_REPLY' || e.data.id !== id) return;
                clearTimeout(timer);
                window.removeEventListener('message', on);
                e.data.ok === false ? reject(new Error(e.data.error || 'Request failed.')) : resolve(e.data);
            }
            window.addEventListener('message', on);
            try { iframe.contentWindow.postMessage({ type, id, ...(payload || {}) }, '*'); } catch (err) { clearTimeout(timer); window.removeEventListener('message', on); reject(err); }
        });
    }

    async function probe(dev, name, params, timeout) {
        const res = await ask(dev.iframe, 'CODEX_RA_PROBE', { probe: name, params: params || {} }, timeout);
        if (res.result && res.result.error) throw new Error(res.result.error);
        return res.result;
    }

    function rpc(message) {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage(message, res => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : (res || { ok: false, error: 'No response from the extension.' })));
            } catch (e) { resolve({ ok: false, error: 'The extension was reloaded. Refresh this page.' }); }
        });
    }

    async function ai(kind, context) {
        const res = await rpc({ action: 'DESIGN_AI_RESPONSIVE', kind, context });
        const r = res.ok ? res.result : null;
        if (r && r.quota) { state.quota = r.quota; renderQuota(); }
        if (!r || !r.ok) throw new Error((r && r.error && r.error.message) || res.error || 'Something went wrong.');
        return r;
    }

    // ── audit ──────────────────────────────────────────────────────────
    function groupIssues(results) {
        const map = new Map();
        results.forEach(({ dev, data }) => {
            if (!data) return;
            data.issues.forEach(i => {
                const key = i.type + '|' + i.selector;
                let g = map.get(key);
                if (!g) {
                    g = { key, type: i.type, severity: i.severity, confidence: i.confidence, selector: i.selector, tag: i.tag, text: i.text, message: i.message, devices: [] };
                    map.set(key, g);
                }
                if (SEV[i.severity] < SEV[g.severity]) g.severity = i.severity;
                g.devices.push({ uid: dev.uid, name: dev.name, width: dev.width, issue: i });
            });
        });
        const list = Array.from(map.values()).sort((a, b) => SEV[a.severity] - SEV[b.severity] || b.devices.length - a.devices.length);
        list.forEach((g, i) => { g.n = i + 1; });
        return list;
    }

    // `only`: device names to audit (Claude Code's request); other frames are left alone.
    async function auditAll(only) {
        const devs = Array.isArray(only) && only.length ? devices().filter(d => only.includes(d.name)) : devices();
        const results = await Promise.all(devs.map(async dev => {
            try { await probe(dev, 'waitStable', { timeoutMs: 2500 }, 6000).catch(() => null); return { dev, data: await probe(dev, 'audit', { expectedWidth: dev.width }, 25000) }; }
            catch (e) { return { dev, data: null, error: e.message }; }
        }));
        return { devs, results, issues: groupIssues(results), skipped: results.filter(r => !r.data).map(r => r.dev.name) };
    }

    function pushMarks() {
        state.devices.forEach(dev => {
            const marks = state.pins ? state.issues.filter(g => g.selector !== 'document' && g.devices.some(d => d.uid === dev.uid)).map(g => ({
                id: g.key, n: g.n, selector: g.selector, severity: g.severity, rect: g.devices.find(d => d.uid === dev.uid).issue.rect,
            })) : [];
            if (state.focusMark && state.focusMark.devices.includes(dev.uid)) marks.push(state.focusMark.mark);
            ask(dev.iframe, 'CODEX_RA_MARK', { marks }, 5000).catch(() => {});
        });
    }

    async function runAudit(only) {
        if (state.busy) return;
        if (!devices().length) { toast('Add a device first.'); return; }
        setBusy(Array.isArray(only) && only.length ? 'Auditing ' + only.length + ' device' + (only.length > 1 ? 's' : '') + '…' : 'Auditing every device…');
        try {
            const out = await auditAll(only);
            state.devices = out.devs; state.issues = out.issues; state.skipped = out.skipped; state.audited = true;
            state.focusMark = null;
            pushMarks();
        } finally { setBusy(''); }
        render();
    }

    // ── Fix it ─────────────────────────────────────────────────────────
    function fixContext(g) {
        const sorted = g.devices.slice().sort((a, b) => a.width - b.width);
        const first = sorted[0];
        const issue = first.issue;
        const ctx = {
            issue: { type: g.type, severity: g.severity, selector: g.selector, message: issue.message, likelyCauses: issue.likelyCauses, hints: issue.hints, computed: issue.computed, overflowPx: issue.overflowPx, size: issue.size, overflowingChildren: issue.overflowingChildren },
            seenOn: sorted.map(d => ({ device: d.name, width: d.width, message: d.issue.message })),
        };
        if (g.selector === 'document') {
            // Page-level issue: give the model the elements that cause it
            ctx.relatedIssues = state.issues.filter(x => x.key !== g.key && x.selector !== 'document' && x.devices.some(d => d.uid === first.uid)).slice(0, 8).map(x => {
                const i = x.devices.find(d => d.uid === first.uid).issue;
                return { type: x.type, selector: x.selector, message: i.message, likelyCauses: i.likelyCauses, computed: i.computed };
            });
        }
        return ctx;
    }

    async function beforeValues(dev, rules) {
        const before = {};
        for (const rule of rules.slice(0, 6)) {
            const first = rule.selector.split(',')[0].trim();
            try {
                const r = await probe(dev, 'styles', { selector: first, properties: rule.declarations.map(d => d.property) }, 8000);
                before[rule.selector] = r.styles || {};
            } catch (e) { /* element not found at this width: no "before" value */ }
        }
        return before;
    }

    async function applyFix(entry) {
        await Promise.all(state.devices.map(d => probe(d, 'patch', { id: entry.id, css: entry.css }, 8000).catch(() => null)));
        entry.applied = true;
    }
    async function removeFix(entry) {
        await Promise.all(state.devices.map(d => probe(d, 'clearPatch', { id: entry.id }, 8000).catch(() => null)));
        entry.applied = false;
    }

    // What changed on each device for this issue, after re-auditing with the fix applied
    function verify(entry, beforeIssues, afterIssues) {
        const was = beforeIssues.find(g => g.key === entry.key);
        const now = afterIssues.find(g => g.key === entry.key);
        const wasOn = new Set((was ? was.devices : entry.issue.devices).map(d => d.uid));
        const nowOn = new Set((now ? now.devices : []).map(d => d.uid));
        const fixedOn = Array.from(wasOn).filter(u => !nowOn.has(u));
        const beforeKeys = new Set(beforeIssues.map(g => g.key));
        const introduced = afterIssues.filter(g => !beforeKeys.has(g.key));
        entry.result = { total: wasOn.size, fixed: fixedOn.length, remaining: Array.from(nowOn).filter(u => wasOn.has(u)).length, introduced: introduced.map(g => TITLES[g.type] || g.type) };
    }

    async function fixIssue(key) {
        const g = state.issues.find(x => x.key === key);
        if (!g || state.busy) return;
        const old = state.fixes.get(key);
        if (old && old.applied) await removeFix(old);
        const entry = { key, status: 'loading', issue: { devices: g.devices.map(d => ({ uid: d.uid, name: d.name, width: d.width })), type: g.type, severity: g.severity, selector: g.selector, message: g.message, n: g.n }, id: 'fix-' + (++fixSeq) };
        state.fixes.set(key, entry);
        setBusy('Writing a fix…');
        render();
        try {
            const target = g.devices.slice().sort((a, b) => a.width - b.width)[0];
            const dev = state.devices.find(d => d.uid === target.uid);
            const ctx = fixContext(g);
            if (g.selector !== 'document') {
                try { const inspected = await probe(dev, 'inspect', { selector: g.selector }, 10000); delete inspected.viewport; ctx.element = inspected; } catch (e) { /* the AI still has the issue data */ }
            }
            let text = JSON.stringify(ctx);
            if (text.length > 30000 && ctx.element) { delete ctx.element.matchedRules; text = JSON.stringify(ctx); }
            const r = await ai('fix', text.slice(0, 40000));
            if (r.offTopic) throw new Error(r.summary);
            const checked = ResponsiveFix.validateFix(r.fix);
            if (!checked.ok) throw new Error('The AI fix could not be used' + (checked.warnings[0] ? ': ' + checked.warnings[0] : '.'));
            Object.assign(entry, {
                status: 'ready', rules: checked.rules, css: checked.css, cleanCss: checked.cleanCss, warnings: checked.warnings,
                explanation: r.summary, caveats: r.caveats || '', rows: ResponsiveFix.diffRows(checked.rules, await beforeValues(dev, checked.rules)),
            });
            await applyFix(entry);
            setBusy('Checking the result on every device…');
            const beforeIssues = state.issues;
            const out = await auditAll();
            verify(entry, beforeIssues, out.issues);
            state.devices = out.devs; state.issues = out.issues; state.skipped = out.skipped;
            pushMarks();
        } catch (e) {
            entry.status = 'error';
            entry.error = e.message;
            if (entry.applied) await removeFix(entry);
        } finally { setBusy(''); }
        render();
    }

    async function undoFix(key) {
        const entry = state.fixes.get(key);
        if (!entry || state.busy) return;
        setBusy('Undoing…');
        await removeFix(entry);
        state.fixes.delete(key);
        try { const out = await auditAll(); state.devices = out.devs; state.issues = out.issues; state.skipped = out.skipped; pushMarks(); } finally { setBusy(''); }
        render();
    }

    async function undoAll() {
        for (const entry of state.fixes.values()) if (entry.applied) await removeFix(entry);
        state.fixes.clear();
        await runAudit();
    }

    function allFixCss() {
        const css = Array.from(state.fixes.values()).filter(f => f.applied && f.cleanCss).map(f => '/* ' + (TITLES[f.issue.type] || f.issue.type) + ' */\n' + f.cleanCss);
        return css.join('\n\n');
    }

    async function copy(text, done) {
        try { await navigator.clipboard.writeText(text); toast(done || 'Copied.'); } catch (e) { toast('Could not copy. Select the text and copy it manually.', 3500); }
    }

    // ── Explain ────────────────────────────────────────────────────────
    async function explain() {
        if (state.busy) return;
        const devs = devices();
        if (devs.length < 2) { state.explainError = 'Open at least two devices (for example a phone and a laptop) to compare them.'; state.explain = null; render(); return; }
        setBusy('Reading each layout…');
        state.explainError = ''; state.explain = null;
        render();
        try {
            if (!state.audited) { const out = await auditAll(); state.devices = out.devs; state.issues = out.issues; state.skipped = out.skipped; state.audited = true; pushMarks(); }
            const prints = await Promise.all(devs.map(async dev => {
                try { return { dev, fp: await probe(dev, 'fingerprint', {}, 15000) }; } catch (e) { return null; }
            }));
            const ok = prints.filter(Boolean);
            if (ok.length < 2) throw new Error('Fewer than two devices responded. Refresh them and try again.');
            const build = limit => JSON.stringify({
                devices: ok.map(({ dev, fp }) => ({
                    name: dev.name, width: dev.width, height: dev.iframe.height ? Number(dev.iframe.height) : undefined, pageHeight: fp.pageHeight, scrollsHorizontally: fp.horizontalScroll,
                    layout: fp.nodes.slice(0, limit), hiddenLandmarks: fp.hiddenLandmarks, menuButtons: fp.menuToggles, headings: fp.headings,
                    auditIssues: state.issues.filter(g => g.devices.some(d => d.uid === dev.uid)).slice(0, 12).map(g => ({ type: g.type, selector: g.selector, message: g.devices.find(d => d.uid === dev.uid).issue.message.slice(0, 140) })),
                })),
            });
            let text = build(60);
            for (const limit of [40, 25, 12]) if (text.length > MAX_CONTEXT) text = build(limit);
            if (text.length > MAX_CONTEXT) throw new Error('The page is too large to compare. Try fewer devices.');
            setBusy('Writing the explanation…');
            const r = await ai('compare', text);
            if (r.offTopic) throw new Error(r.summary);
            state.explain = { summary: r.summary, findings: r.findings || [] };
        } catch (e) { state.explainError = e.message; } finally { setBusy(''); }
        render();
    }

    function showFinding(f) {
        const names = new Set(f.devices || []);
        const targets = state.devices.filter(d => !names.size || names.has(d.name));
        const sel = typeof f.selector === 'string' ? f.selector : '';
        if (!sel) return;
        state.focusMark = { devices: targets.map(d => d.uid), mark: { id: 'finding', n: '•', selector: sel, severity: FINDING_SEV[f.severity] || 'info' } };
        pushMarks();
        targets.forEach((d, i) => { ask(d.iframe, 'CODEX_RA_FOCUS', { id: 'finding' }, 5000).catch(() => {}); if (i === 0) d.viewport.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); });
    }

    function showIssue(g) {
        const first = state.devices.find(d => g.devices.some(x => x.uid === d.uid));
        g.devices.forEach(x => { const d = state.devices.find(y => y.uid === x.uid); if (d) ask(d.iframe, 'CODEX_RA_FOCUS', { id: g.key }, 5000).catch(() => {}); });
        if (first) first.viewport.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }

    // ── rendering ──────────────────────────────────────────────────────
    function setBusy(text) {
        state.busy = text;
        if (statusEl) { statusEl.textContent = text; statusEl.hidden = !text; }
        if (root) root.classList.toggle('is-busy', !!text);
    }
    function renderQuota() {
        if (!quotaEl) return;
        quotaEl.textContent = state.quota ? `${state.quota.remaining} of ${state.quota.limit} free AI requests left today` : 'AI fixes and explanations use your free daily requests';
    }

    function devChips(list) {
        return h('div', { class: 'ra-devs' }, list.map(d => h('span', { class: 'ra-chip', text: `${d.name} · ${d.width}px` })));
    }

    function fixCard(entry, g) {
        if (entry.status === 'loading') return h('div', { class: 'ra-fix' }, h('p', { class: 'ra-muted', text: 'Writing a fix…' }));
        if (entry.status === 'error') {
            return h('div', { class: 'ra-fix ra-fix-bad' }, h('b', { text: 'Could not fix this' }), h('p', { text: entry.error }),
                g ? h('button', { class: 'ra-btn small', onclick: () => fixIssue(entry.key), text: 'Try again' }) : null);
        }
        const res = entry.result;
        let verdict = null;
        if (res) {
            const good = res.remaining === 0;
            verdict = h('p', { class: 'ra-verdict ' + (good ? 'ok' : 'warn') },
                good ? `Fixed on ${res.fixed} of ${res.total} device${res.total > 1 ? 's' : ''}.` : `Fixed on ${res.fixed} of ${res.total}; still happening on ${res.remaining}.`,
                res.introduced.length ? ` New: ${res.introduced.slice(0, 3).join(', ')}.` : ' No new issues found.');
        }
        const rows = entry.rows.map(r => h('tr', null,
            h('td', { class: 'ra-mono', text: r.property + (r.media ? ' @' + r.media.replace(/[()]/g, '') : '') }),
            h('td', { class: 'ra-del ra-mono', text: r.before === null ? '(not set)' : r.before }),
            h('td', { class: 'ra-add ra-mono', text: r.after })));
        return h('div', { class: 'ra-fix' },
            h('p', { text: entry.explanation }),
            entry.caveats ? h('p', { class: 'ra-muted', text: entry.caveats }) : null,
            h('table', { class: 'ra-diff' }, h('thead', null, h('tr', null, h('th', { text: 'Property' }), h('th', { text: 'Before' }), h('th', { text: 'After' }))), h('tbody', null, rows)),
            h('pre', { class: 'ra-code', tabindex: '0', text: entry.cleanCss }),
            verdict,
            entry.warnings && entry.warnings.length ? h('p', { class: 'ra-muted', text: entry.warnings.length + ' part(s) of the AI answer were skipped because they are not allowed.' }) : null,
            h('div', { class: 'ra-row' },
                h('button', { class: 'ra-btn small primary', onclick: () => copy(entry.cleanCss, 'CSS copied.'), text: 'Copy CSS' }),
                entry.applied ? h('button', { class: 'ra-btn small', onclick: () => undoFix(entry.key), text: 'Undo' }) : null));
    }

    function issueCard(g) {
        const entry = state.fixes.get(g.key);
        const first = g.devices[0].issue;
        return h('article', { class: 'ra-issue sev-' + g.severity, 'data-key': g.key },
            h('header', null,
                h('span', { class: 'ra-n', text: g.n }),
                h('div', { class: 'ra-title' }, h('b', { text: TITLES[g.type] || g.type }), h('small', { class: 'ra-mono', text: g.selector })),
                h('span', { class: 'ra-tag', title: g.confidence === 'deterministic' ? 'Measured directly, so this is definitely happening.' : 'A heuristic: usually right, but it can be intentional.', text: g.confidence === 'deterministic' ? 'Certain' : 'Likely' })),
            h('p', { text: first.message }),
            devChips(g.devices),
            h('footer', null,
                g.selector !== 'document' ? h('button', { class: 'ra-btn small', onclick: () => showIssue(g), text: 'Show' }) : null,
                AI ? h('button', { class: 'ra-btn small primary', disabled: !!state.busy || null, onclick: () => fixIssue(g.key), text: entry && entry.status === 'ready' ? 'Fix again' : 'Fix with AI' }) : null),
            entry ? fixCard(entry, g) : null);
    }

    function resolvedCard(entry) {
        return h('article', { class: 'ra-issue ra-resolved' },
            h('header', null, h('span', { class: 'ra-n ok' }, icon('check', 12)),
                h('div', { class: 'ra-title' }, h('b', { text: (TITLES[entry.issue.type] || entry.issue.type) + ' - fixed' }), h('small', { class: 'ra-mono', text: entry.issue.selector }))),
            devChips(entry.issue.devices), fixCard(entry, null));
    }

    function renderIssues() {
        const frag = [];
        if (!state.audited) {
            frag.push(h('div', { class: 'ra-empty' },
                h('p', null, 'Checks every open device for layout problems: sideways scrolling, elements sticking out, cut-off text, covered controls, tiny tap targets and small text.'),
                h('p', { class: 'ra-muted', text: AI ? 'The checks run in your browser and find the problems without AI. AI is used only when you ask it to fix something.' : 'The checks run in your browser.' })));
            return frag;
        }
        const resolved = Array.from(state.fixes.values()).filter(f => f.status === 'ready' && !state.issues.some(g => g.key === f.key));
        const counts = { high: 0, medium: 0, low: 0 };
        state.issues.forEach(g => { counts[g.severity]++; });
        frag.push(h('div', { class: 'ra-summary' },
            state.issues.length
                ? [h('b', { text: `${state.issues.length} issue${state.issues.length > 1 ? 's' : ''}` }), ` on ${state.devices.length - state.skipped.length} device${state.devices.length - state.skipped.length === 1 ? '' : 's'}`,
                    h('span', { class: 'ra-counts' }, ['high', 'medium', 'low'].filter(s => counts[s]).map(s => h('span', { class: 'ra-count sev-' + s, text: `${counts[s]} ${SEV_LABEL[s].toLowerCase()}` })))]
                : [icon('circle-check', 16), h('b', { text: ' No layout problems found' }), ' at these widths.'],
            state.skipped.length ? h('p', { class: 'ra-muted', text: `Could not check: ${state.skipped.join(', ')}. Some sites block extensions inside frames; refresh the device and run the audit again.` }) : null));
        state.issues.forEach(g => frag.push(issueCard(g)));
        resolved.forEach(f => frag.push(resolvedCard(f)));
        if (!state.issues.length && !resolved.length) frag.push(h('p', { class: 'ra-muted', text: 'The checks are automatic and cover common problems. They do not judge design quality.' }));
        return frag;
    }

    function renderExplain() {
        const frag = [h('div', { class: 'ra-empty' },
            h('p', null, 'Compares how the page is laid out on each open device and explains the differences in plain language: what collapses, stacks, hides or breaks.'),
            h('button', { class: 'ra-btn primary wide', disabled: !!state.busy || null, onclick: explain, text: state.explain ? 'Explain again' : 'Explain differences' }),
            h('p', { class: 'ra-muted', text: 'Sends a compact description of each layout (box sizes, columns, hidden menus), not screenshots or page text. It only sees the devices you have open, so add an in-between width to test it.' }))];
        if (state.explainError) frag.push(h('div', { class: 'ra-fix ra-fix-bad' }, h('b', { text: 'Could not explain' }), h('p', { text: state.explainError })));
        if (state.explain) {
            frag.push(h('div', { class: 'ra-story' }, h('p', { text: state.explain.summary })));
            state.explain.findings.forEach(f => {
                const sev = FINDING_SEV[f.severity] || 'info';
                const canShow = typeof f.selector === 'string' && f.selector;
                frag.push(h('article', { class: 'ra-issue sev-' + sev },
                    h('header', null, h('span', { class: 'ra-n', text: f.severity === 'problem' ? '!' : f.severity === 'warning' ? '?' : 'i' }), h('div', { class: 'ra-title' }, h('b', { text: f.title }))),
                    h('p', { text: f.detail }),
                    f.devices && f.devices.length ? h('div', { class: 'ra-devs' }, f.devices.map(n => h('span', { class: 'ra-chip', text: n }))) : null,
                    canShow ? h('footer', null, h('button', { class: 'ra-btn small', onclick: () => showFinding(f), text: 'Show on devices' })) : null));
            });
        }
        return frag;
    }

    function render() {
        if (!root) return;
        Array.from(root.querySelectorAll('[data-tab]')).forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
        const hasFix = Array.from(state.fixes.values()).some(f => f.applied);
        root.querySelector('[data-el="pins"]').checked = state.pins;
        root.querySelector('[data-el="foot"]').hidden = !(hasFix && state.tab === 'issues');
        body.replaceChildren(...(state.tab === 'issues' ? renderIssues() : renderExplain()));
    }

    function build() {
        statusEl = h('p', { class: 'ra-status', role: 'status', hidden: true });
        quotaEl = h('p', { class: 'ra-quota', hidden: !AI || null });
        body = h('div', { class: 'ra-body' });
        root = h('aside', { class: 'ra-drawer', 'aria-label': 'Responsive audit', hidden: true },
            h('header', { class: 'ra-head' },
                h('b', null, icon('bug', 16), ' Responsive audit'),
                h('button', { class: 'ra-x', 'aria-label': 'Close', onclick: () => toggle(false) }, icon('x', 16))),
            h('nav', { class: 'ra-tabs', role: 'tablist' },
                h('button', { role: 'tab', 'data-tab': 'issues', onclick: () => { state.tab = 'issues'; render(); }, text: 'Issues' }),
                AI ? h('button', { role: 'tab', 'data-tab': 'explain', onclick: () => { state.tab = 'explain'; render(); }, text: 'Explain differences' }) : null),
            h('div', { class: 'ra-bar' },
                h('button', { class: 'ra-btn primary', onclick: () => runAudit() }, icon('refresh', 14), ' Run audit'),
                h('label', { class: 'ra-pins' }, h('input', { type: 'checkbox', 'data-el': 'pins', checked: true, onchange: e => { state.pins = e.target.checked; pushMarks(); } }), ' Show pins')),
            statusEl, body,
            h('footer', { class: 'ra-foot', 'data-el': 'foot', hidden: true },
                h('button', { class: 'ra-btn small primary', onclick: () => copy(allFixCss(), 'All fixes copied.'), text: 'Copy all fixes' }),
                h('button', { class: 'ra-btn small', onclick: undoAll, text: 'Undo all fixes' })),
            quotaEl);
        document.body.appendChild(root);
        renderQuota();
    }

    function toggle(open) {
        if (!root) build();
        state.open = open === undefined ? !state.open : open;
        if (state.open && window.EditPanel && EditPanel.state.open) EditPanel.setOpen(false);
        root.hidden = !state.open;
        document.body.classList.toggle('ra-open', state.open);
        const btn = document.getElementById('responsive-audit');
        if (btn) btn.classList.toggle('active', state.open);
        if (!state.open) state.devices.forEach(d => ask(d.iframe, 'CODEX_RA_CLEAR', {}, 3000).catch(() => {}));
        else if (state.audited) pushMarks();
        render();
    }

    function init() {
        const btn = document.getElementById('responsive-audit');
        if (btn) btn.addEventListener('click', () => toggle());
    }

    // ── Claude Code ────────────────────────────────────────────────────
    // Waits until every device frame answers (new frames are still loading the page).
    async function whenReady(timeoutMs) {
        const end = Date.now() + timeoutMs;
        for (const dev of devices()) {
            while (true) {
                try { await probe(dev, 'viewportInfo', {}, 1500); break; }
                catch (e) { if (Date.now() > end) break; await new Promise(r => setTimeout(r, 500)); }
            }
        }
    }

    // Runs the normal audit with the drawer open, so the user sees the same issues and
    // pins Claude gets back. Returns a compact copy of the results.
    async function auditForClaude(only) {
        if (state.busy) throw new Error('The viewer is busy with another audit or fix. Try again shortly.');
        if (!devices().length) throw new Error('The viewer has no devices.');
        await whenReady(20000);
        toggle(true);
        await runAudit(only);
        return {
            devices: state.devices.map(d => ({ name: d.name, width: d.width })),
            skipped: state.skipped,
            issues: state.issues.slice(0, 40).map(g => ({
                n: g.n, type: g.type, title: TITLES[g.type] || g.type, severity: g.severity, confidence: g.confidence,
                selector: g.selector, message: g.message,
                devices: g.devices.map(d => ({ name: d.name, width: d.width, rect: d.issue.rect })),
            })),
            issuesOmitted: Math.max(0, state.issues.length - 40),
        };
    }

    window.ResponsiveAudit = { init, toggle, runAudit, auditForClaude, state, _groupIssues: groupIssues };
})();
