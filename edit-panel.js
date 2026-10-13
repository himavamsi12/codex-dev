// Edit in Browser, viewer side.
//
//  Edit mode   Turns on element picking inside every device frame (edit-mode.js).
//  Selection   Adds the device name/width and a cropped screenshot to what the frame sent.
//  Bridge      Talks to `codex-dev-bridge` running in the user's project over
//              ws://127.0.0.1:<port>/ws with a pairing token the user pastes once
//              (chrome.storage.local). Claude Code runs there, with the user's own
//              login; no API key is ever stored in the extension.
//  Review      Shows the returned diff; Accept keeps it, Reject restores the checkpoint,
//              Undo reverts the last accepted edit.
//
// Everything derived from the page or the bridge is rendered with textContent.
(function () {
    'use strict';

    const PROTOCOL = 1;
    const STORE_KEY = 'editBridge';
    const DEFAULT_PORT = 17374;
    const MAX_SHOT = 1200;

    const state = {
        open: false,
        conn: 'idle',      // idle | connecting | connected | offline | bad_token
        connNote: '',
        project: null,
        cfg: { token: '', port: DEFAULT_PORT },
        selection: null,   // what the user picked (with device + screenshot)
        phase: 'idle',     // idle | sending | editing | review | done | error
        phaseNote: '',
        editId: null,
        result: null,
        undoDepth: 0,
    };

    let ws = null, pingTimer = null, retryTimer = null, retryMs = 1000, seq = 0;
    let root = null, el = {};

    // ── tiny DOM helper ────────────────────────────────────────────────
    function h(tag, attrs, ...kids) {
        const n = document.createElement(tag);
        Object.entries(attrs || {}).forEach(([k, v]) => {
            if (v === false || v === null || v === undefined) return;
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v === true ? '' : v);
        });
        kids.flat().forEach(c => { if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
        return n;
    }
    const toast = (m, ms) => { if (window.CodexUI && CodexUI.toast) CodexUI.toast(m, ms || 2500); };
    const iframes = () => Array.from(document.querySelectorAll('.viewport-frame iframe'));

    function deviceOf(source) {
        const iframe = iframes().find(f => f.contentWindow === source);
        if (!iframe) return null;
        const title = iframe.closest('.viewport') && iframe.closest('.viewport').querySelector('.viewport-title');
        return { iframe, name: title ? title.textContent : 'Device', width: Number(iframe.width) || iframe.clientWidth, height: Number(iframe.height) || iframe.clientHeight };
    }

    function tellFrames(msg, except) {
        iframes().forEach(f => { if (f.contentWindow !== except) { try { f.contentWindow.postMessage(msg, '*'); } catch (e) { /* navigating */ } } });
    }

    // ── bridge connection ──────────────────────────────────────────────
    function setConn(conn, note) { state.conn = conn; state.connNote = note || ''; render(); }

    function send(msg) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return false;
        ws.send(JSON.stringify(msg));
        return true;
    }

    function connect() {
        disconnect(true);
        if (!state.cfg.token) { setConn('idle'); return; }
        setConn('connecting');
        let sock;
        try { sock = new WebSocket(`ws://127.0.0.1:${state.cfg.port}/ws`); } catch (e) { setConn('offline', 'Invalid port.'); return; }
        ws = sock;
        let welcomed = false;
        sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL, token: state.cfg.token, extensionVersion: chrome.runtime.getManifest().version }));
        sock.onmessage = ev => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.type === 'welcome') {
                welcomed = true; retryMs = 1000;
                state.project = m.project; state.undoDepth = m.undoDepth || 0;
                setConn('connected');
                pingTimer = setInterval(() => send({ type: 'ping' }), 20000);
            } else onBridge(m);
        };
        sock.onclose = ev => {
            if (ws !== sock) return;
            ws = null; clearInterval(pingTimer);
            if (ev.code === 4401 || state.conn === 'bad_token') { setConn('bad_token', 'The bridge rejected this token. Copy it again from the terminal.'); return; }
            if (state.phase === 'sending' || state.phase === 'editing') setPhase('error', 'Lost the connection to the bridge.');
            setConn('offline', welcomed ? 'Connection lost.' : 'Bridge not running. Start it with `npx codex-dev-bridge` in your project.');
            if (state.open) { clearTimeout(retryTimer); retryTimer = setTimeout(connect, retryMs); retryMs = Math.min(retryMs * 2, 10000); }
        };
        sock.onerror = () => { /* onclose follows */ };
    }

    function disconnect(quiet) {
        clearTimeout(retryTimer); clearInterval(pingTimer);
        if (ws) { const s = ws; ws = null; s.onclose = null; try { s.close(); } catch (e) { /* ignore */ } }
        if (!quiet) setConn('idle');
    }

    function onBridge(m) {
        switch (m.type) {
            case 'error':
                if (m.code === 'bad_token') { state.conn = 'bad_token'; return; } // onclose renders it
                setPhase('error', m.message || 'Something went wrong.');
                break;
            case 'progress':
                if (m.id === state.editId) setPhase('editing', m.message);
                break;
            case 'result':
                if (m.id !== state.editId) return;
                state.result = m;
                setPhase('review', m.summary || '');
                break;
            case 'done':
                state.undoDepth = m.undoDepth;
                state.result = null;
                if (m.action === 'accepted') { setPhase('done', 'Applied. Your dev server will reload the frames.'); clearSelection(); }
                else if (m.action === 'rejected') setPhase('done', 'Rejected. Your files are back as they were.');
                else if (m.action === 'undone') setPhase('done', 'Last edit undone.');
                else if (m.action === 'no_changes') setPhase('done', m.message || 'Claude Code made no changes.');
                else setPhase('idle');
                break;
            case 'capture_request': answerCapture(m.rid); break;
        }
    }

    async function answerCapture(rid) {
        try {
            const url = await toJpeg(await captureVisibleTab(), 1600);
            send({ type: 'capture_response', rid, dataUrl: url });
        } catch (e) { send({ type: 'capture_response', rid, error: String(e && e.message || e).slice(0, 250) }); }
    }

    // ── selection ──────────────────────────────────────────────────────
    function loadImage(src) {
        return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('Image failed to load.')); i.src = src; });
    }

    async function toJpeg(dataUrl, maxSide) {
        const img = await loadImage(dataUrl);
        const k = Math.min(1, maxSide / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
    }

    // Crops the element out of a screenshot of the viewer tab. Only works if it is on screen.
    async function cropElement(dev, rect) {
        const ir = dev.iframe.getBoundingClientRect();
        const scale = dev.iframe.offsetWidth ? ir.width / dev.iframe.offsetWidth : 1;
        const top = document.querySelector('.viewer-header').offsetHeight;
        const pad = 8;
        const x0 = Math.max(0, ir.left + rect.x * scale - pad), y0 = Math.max(top, ir.top + rect.y * scale - pad);
        const x1 = Math.min(window.innerWidth, ir.left + (rect.x + rect.width) * scale + pad), y1 = Math.min(window.innerHeight, ir.top + (rect.y + rect.height) * scale + pad);
        if (x1 - x0 < 8 || y1 - y0 < 8) return undefined;
        const img = await loadImage(await captureVisibleTab());
        const r = img.width / window.innerWidth;
        const w = (x1 - x0) * r, hh = (y1 - y0) * r;
        const k = Math.min(1, MAX_SHOT / Math.max(w, hh));
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(hh * k);
        c.getContext('2d').drawImage(img, x0 * r, y0 * r, w, hh, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.85);
    }

    async function onSelect(dev, p) {
        tellFrames({ type: 'CODEX_EDIT_CLEAR' }, dev.iframe.contentWindow);
        const sel = {
            source: p.source || null, selector: p.selector, tag: p.tag, html: p.html, text: p.text, classes: p.classes, styles: p.styles,
            device: { name: dev.name.slice(0, 120), width: p.viewportWidth || dev.width, height: dev.height },
            pageUrl: p.pageUrl,
        };
        state.selection = sel;
        if (state.phase === 'done' || state.phase === 'error') setPhase('idle');
        render();
        console.log('[Codex Dev] Edit selection', sel);
        try { sel.screenshot = await cropElement(dev, p.rect); } catch (e) { /* screenshot is optional */ }
        if (state.selection === sel) { render(); send({ type: 'selection', selection: sel }); }
    }

    function clearSelection() {
        state.selection = null;
        tellFrames({ type: 'CODEX_EDIT_CLEAR' });
        render();
    }

    // ── edit flow ──────────────────────────────────────────────────────
    function setPhase(phase, note) { state.phase = phase; state.phaseNote = note || ''; render(); }

    function apply() {
        const instruction = el.prompt.value.trim();
        if (!instruction || !state.selection || state.conn !== 'connected') return;
        state.editId = 'e' + Date.now().toString(36) + (++seq);
        state.result = null;
        setPhase('sending', 'Sending to the bridge…');
        if (!send({ type: 'edit', id: state.editId, instruction, selection: state.selection })) setPhase('error', 'Not connected to the bridge.');
    }

    // ── rendering ──────────────────────────────────────────────────────
    const CONN_LABEL = { idle: 'Not connected', connecting: 'Connecting…', connected: 'Connected', offline: 'Bridge not running', bad_token: 'Bad token' };

    function renderDiff(diff) {
        const box = h('div', { class: 'ed-diff', tabindex: 0, role: 'region', 'aria-label': 'Diff' });
        diff.split('\n').slice(0, 1500).forEach(line => {
            let cls = '';
            if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) cls = 'meta';
            else if (line.startsWith('@@')) cls = 'hunk';
            else if (line.startsWith('+')) cls = 'add';
            else if (line.startsWith('-')) cls = 'del';
            box.append(h('div', { class: 'ed-l ' + cls, text: line || ' ' }));
        });
        return box;
    }

    function render() {
        if (!root) return;
        const busy = state.phase === 'sending' || state.phase === 'editing';
        const connected = state.conn === 'connected';

        el.pill.className = 'ed-pill ' + state.conn;
        el.pillText.textContent = CONN_LABEL[state.conn] + (connected && state.project ? ` · ${state.project.name}${state.project.branch ? ' @ ' + state.project.branch : ''}` : '');
        el.connNote.textContent = state.connNote;
        el.connNote.hidden = !state.connNote;
        el.setup.hidden = connected;
        el.connectBtn.textContent = state.conn === 'connecting' ? 'Connecting…' : 'Connect';
        el.connectBtn.disabled = state.conn === 'connecting';

        const sel = state.selection;
        el.selEmpty.hidden = !!sel;
        el.selInfo.hidden = !sel;
        if (sel) {
            el.selDevice.textContent = `${sel.device.name}, ${sel.device.width}px`;
            el.selTag.textContent = sel.selector;
            el.selSource.textContent = sel.source
                ? `${sel.source.file}:${sel.source.line}${sel.source.inferred ? ' (nearest mapped ancestor)' : ''}`
                : 'No source mapping: Claude will search your code. Add the Vite plugin for exact results.';
            el.selSource.classList.toggle('ed-warn', !sel.source);
            el.shot.hidden = !sel.screenshot;
            if (sel.screenshot) el.shot.src = sel.screenshot;
        }

        el.prompt.disabled = busy || state.phase === 'review';
        el.apply.disabled = busy || state.phase === 'review' || !connected || !sel;
        el.apply.hidden = busy;
        el.cancel.hidden = !busy;

        el.status.hidden = state.phase === 'idle';
        el.status.className = 'ed-status ' + state.phase;
        el.status.textContent = state.phase === 'review' ? 'Review the change below.' : state.phaseNote;
        el.stepper.hidden = !(busy || state.phase === 'review' || state.phase === 'done');
        el.stepper.querySelectorAll('li').forEach(li => {
            const order = ['sending', 'editing', 'review', 'done'];
            li.className = order.indexOf(li.dataset.step) < order.indexOf(state.phase) ? 'past' : li.dataset.step === state.phase ? 'now' : '';
        });

        el.review.hidden = state.phase !== 'review' || !state.result;
        if (!el.review.hidden) {
            const r = state.result;
            el.reviewSummary.textContent = r.summary || '';
            el.files.textContent = '';
            r.files.forEach(f => el.files.append(h('li', {}, h('span', { class: 'ed-fs ' + f.status, text: f.status[0].toUpperCase() }), h('span', { class: 'ra-mono', text: f.path }), h('span', { class: 'ed-delta' }, h('b', { class: 'a', text: '+' + f.additions }), ' ', h('b', { class: 'd', text: '−' + f.deletions })))));
            el.diffHost.textContent = '';
            el.diffHost.append(renderDiff(r.diff));
            el.trunc.hidden = !r.truncated;
        }
        el.undo.disabled = !connected || busy || state.phase === 'review' || !state.undoDepth;
        el.undo.textContent = state.undoDepth ? `Undo last edit (${state.undoDepth})` : 'Undo last edit';
    }

    function build() {
        el.pillText = h('span');
        el.pill = h('span', { class: 'ed-pill idle', role: 'status' }, h('i', { class: 'ed-dot' }), el.pillText);
        el.connNote = h('p', { class: 'ra-muted', hidden: true });
        el.token = h('input', { type: 'password', class: 'ed-input', placeholder: 'Pairing token from the terminal', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Pairing token' });
        el.port = h('input', { type: 'number', class: 'ed-input ed-port', min: 1024, max: 65535, 'aria-label': 'Bridge port' });
        el.connectBtn = h('button', { class: 'ra-btn primary', text: 'Connect', onclick: () => {
            const token = el.token.value.trim() || state.cfg.token;
            const port = Math.min(65535, Math.max(1024, Number(el.port.value) || DEFAULT_PORT));
            state.cfg = { token, port };
            chrome.storage.local.set({ [STORE_KEY]: state.cfg });
            el.token.value = '';
            retryMs = 1000;
            connect();
        } });
        el.setup = h('div', { class: 'ed-setup' },
            h('p', { class: 'ra-muted' }, 'In your project folder run ', h('code', { text: 'npx codex-dev-bridge' }), ', then paste the token it prints. Claude Code uses your own login (Claude subscription or API key).'),
            h('div', { class: 'ra-row' }, el.token, el.port), el.connectBtn);

        el.selEmpty = h('p', { class: 'ra-muted', text: 'Click any element in a device frame. Esc cancels the selection; Esc again leaves Edit mode.' });
        el.selDevice = h('b'); el.selTag = h('span', { class: 'ra-mono ed-clip' }); el.selSource = h('span', { class: 'ra-mono ed-clip' });
        el.shot = h('img', { class: 'ed-shot', alt: 'Selected element', hidden: true });
        el.selInfo = h('div', { class: 'ed-sel', hidden: true }, el.selDevice, el.selTag, el.selSource, el.shot,
            h('button', { class: 'ra-btn small', text: 'Pick another', onclick: clearSelection }));

        el.prompt = h('textarea', { class: 'ed-input ed-prompt', rows: 3, maxlength: 4000, placeholder: 'e.g. make this a 2-column grid on tablet', 'aria-label': 'Describe the change',
            onkeydown: e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); apply(); } }, oninput: render });
        el.apply = h('button', { class: 'ra-btn primary wide', text: 'Apply', onclick: apply });
        el.cancel = h('button', { class: 'ra-btn wide', text: 'Cancel', hidden: true, onclick: () => { send({ type: 'cancel', id: state.editId }); } });
        el.status = h('p', { class: 'ed-status', role: 'status', hidden: true });
        el.stepper = h('ol', { class: 'ed-steps', hidden: true }, ...[['sending', 'Sending'], ['editing', 'Editing'], ['review', 'Review'], ['done', 'Done']].map(([k, t]) => h('li', { 'data-step': k, text: t })));

        el.reviewSummary = h('p', { class: 'ed-summary' });
        el.files = h('ul', { class: 'ed-files' });
        el.diffHost = h('div');
        el.trunc = h('p', { class: 'ra-muted', text: 'Diff truncated. Open the files in your editor for the full change.', hidden: true });
        el.review = h('section', { class: 'ed-review', hidden: true }, el.reviewSummary, el.files, el.diffHost, el.trunc,
            h('div', { class: 'ra-row' },
                h('button', { class: 'ra-btn primary', style: 'flex:1', text: 'Accept', onclick: () => send({ type: 'accept', id: state.editId }) }),
                h('button', { class: 'ra-btn', style: 'flex:1', text: 'Reject', onclick: () => send({ type: 'reject', id: state.editId }) })));
        el.undo = h('button', { class: 'ra-btn small', text: 'Undo last edit', disabled: true, onclick: () => send({ type: 'undo' }) });

        root = h('aside', { class: 'ed-drawer', hidden: true, 'aria-label': 'Edit in Browser' },
            h('header', { class: 'ra-head' }, h('b', {}, 'Edit in Browser'), h('button', { class: 'ra-x', 'aria-label': 'Close', onclick: () => setOpen(false), text: '✕' })),
            h('div', { class: 'ed-body' },
                el.pill, el.connNote, el.setup,
                h('h4', { text: 'Selected element' }), el.selEmpty, el.selInfo,
                h('h4', { text: 'Change' }), el.prompt, el.apply, el.cancel, el.stepper, el.status,
                el.review),
            h('footer', { class: 'ra-foot' }, el.undo));
        document.body.appendChild(root);
        el.port.value = state.cfg.port;
    }

    // ── mode ───────────────────────────────────────────────────────────
    function setOpen(open) {
        if (!root) build();
        state.open = open === undefined ? !state.open : open;
        root.hidden = !state.open;
        document.body.classList.toggle('ed-open', state.open);
        const btn = document.getElementById('edit-mode');
        if (btn) { btn.classList.toggle('active', state.open); btn.setAttribute('aria-pressed', String(state.open)); }
        if (state.open) {
            if (window.ResponsiveAudit && ResponsiveAudit.state && ResponsiveAudit.state.open) ResponsiveAudit.toggle(false);
            tellFrames({ type: 'CODEX_EDIT_MODE', on: true });
            if (state.cfg.token && !ws) connect();
        } else {
            tellFrames({ type: 'CODEX_EDIT_MODE', on: false });
            state.selection = null;
            disconnect(true);
        }
        render();
    }

    async function init() {
        try {
            const got = await chrome.storage.local.get(STORE_KEY);
            if (got[STORE_KEY]) state.cfg = { token: got[STORE_KEY].token || '', port: got[STORE_KEY].port || DEFAULT_PORT };
        } catch (e) { /* storage unavailable: user can still paste a token */ }
        const btn = document.getElementById('edit-mode');
        if (btn) btn.addEventListener('click', () => setOpen());

        window.addEventListener('message', e => {
            if (!e.data || typeof e.data.type !== 'string' || !e.data.type.startsWith('CODEX_EDIT_') || !state.open) return;
            const dev = deviceOf(e.source);
            if (!dev) return; // not one of our device frames
            if (e.data.type === 'CODEX_EDIT_SELECT') onSelect(dev, e.data.payload || {});
            else if (e.data.type === 'CODEX_EDIT_CANCEL') escape();
        });
        // Frames that load or reload (including after a hot reload) need to be told the mode again.
        document.addEventListener('load', e => {
            if (state.open && e.target instanceof HTMLIFrameElement) { try { e.target.contentWindow.postMessage({ type: 'CODEX_EDIT_MODE', on: true }, '*'); } catch (err) { /* ignore */ } }
        }, true);
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.open && !e.defaultPrevented) escape(); });
    }

    function escape() {
        if (state.selection && state.phase !== 'review') clearSelection();
        else if (state.phase !== 'review' && state.phase !== 'sending' && state.phase !== 'editing') setOpen(false);
    }

    window.EditPanel = { init, setOpen, state };
})();
