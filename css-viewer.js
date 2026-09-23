(function () {
    'use strict';
    const HOST_ID = 'codex-visual-editor-host';

    // Fallback in case this script is ever injected before utils/codex-ui.js
    // (normally popup.js injects codex-ui.js first — see popup.js).
    const UI = window.CodexUI || {
        toast: function (msg) { console.log('[Codex]', msg); },
        injectTokens: function (root) {
            const s = document.createElement('style');
            s.textContent = ':host{--cx-bg:#1a1a24;--cx-bg-alt:#1a1a24;--cx-panel:#2d2d3d;--cx-panel-alt:#2d2d3d;--cx-border:rgba(255,255,255,0.1);--cx-text:#e2e8f0;--cx-text-muted:#a0aec0;--cx-accent:#4FD1C5;--cx-accent-hover:#3eb1a6;--cx-danger:#f56565;--cx-radius-sm:4px;--cx-radius-md:8px;--cx-radius-lg:12px;--cx-font:system-ui,sans-serif;--cx-font-mono:monospace;}';
            root.appendChild(s);
            return s;
        },
        icon: function () { return ''; }
    };

    // ── Single teardown, used by every close path (toolbar re-click, ESC,
    // panel close button) — replaces the old two-divergent-paths bug where
    // the top-of-file toggle branch removed only 3/6 listeners and never
    // cleared multi-selection outlines, the injected pseudo-class <style>,
    // or force-classes left on page elements. ─────────────────────────────
    function teardown() {
        window.CodexVisualEditorActive = false;
        const state = window.__cxVE;
        if (state) {
            document.removeEventListener('mouseover', state.onMouseOver, true);
            document.removeEventListener('mouseout', state.onMouseOut, true);
            document.removeEventListener('mousedown', state.onMouseDown, true);
            document.removeEventListener('mousemove', state.onMouseMove, true);
            document.removeEventListener('mouseup', state.onMouseUp, true);
            document.removeEventListener('click', state.onClick, true);
            document.removeEventListener('dblclick', state.onDblClick, true);
            window.removeEventListener('keydown', state.onKeydown, true);
        }

        if (window.CodexSelectedElements) {
            window.CodexSelectedElements.forEach(function (el) { if (el && el.style) el.style.outline = ''; });
            window.CodexSelectedElements.clear();
        }
        if (window.CodexLastHighlight) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }
        window.CodexSelectedElement = null;

        // Remove the pseudo-class force-<state> style tag and strip the
        // force-classes it targeted from every element in the page.
        const injected = document.getElementById('codex-injected-styles');
        if (injected) injected.remove();
        document.querySelectorAll('[class*="codex-force-"]').forEach(function (el) {
            el.className = el.className.replace(/codex-force-\S+/g, '').trim();
        });

        document.body.classList.remove('codex-drag-mode-active');

        const host = document.getElementById(HOST_ID);
        if (host) host.remove();

        window.__cxVE = null;
        UI.toast('Visual Editor: OFF');
    }

    if (window.CodexVisualEditorActive) {
        teardown();
        return;
    }

    // ── Activate ──────────────────────────────────────────────────────────
    window.CodexVisualEditorActive = true;
    window.CodexSelectedElements = new Set();
    window.CodexSelectedElement = null;
    UI.toast('Visual Editor on. Click to select, Shift+click for more, Esc to close');

    const host = document.createElement('div');
    host.id = HOST_ID;
    host.style.position = 'fixed';
    host.style.left = '0';
    host.style.top = '0';
    host.style.width = '0';
    host.style.height = '0';
    host.style.zIndex = '2147483647';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    UI.injectTokens(shadow);

    const style = document.createElement('style');
    style.textContent = `
        :host {
            font-family: var(--cx-font);
            font-size: 13px;
            color: var(--cx-text);
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
        }
        * { box-sizing: border-box; }
        button, select, input, textarea { font-family: inherit; }
        :focus-visible { outline: 2px solid var(--cx-accent); outline-offset: 2px; }

        .editor-panel {
            position: fixed;
            top: 12px;
            right: 12px;
            width: 380px;
            height: calc(100vh - 24px);
            background: var(--cx-bg-alt);
            border: 1px solid var(--cx-border-strong);
            border-radius: var(--cx-radius-md);
            box-shadow: var(--cx-shadow);
            display: none;
            flex-direction: column;
            overflow: hidden;
            z-index: 10000;
            pointer-events: auto;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 48px;
            padding: 0 10px 0 14px;
            border-bottom: 1px solid var(--cx-border);
            cursor: move;
        }
        .header-title {
            font-weight: 650;
            font-size: 13.5px;
            color: var(--cx-text);
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .header-title .cx-icon { color: var(--cx-accent-text); }
        .close-btn {
            width: 28px;
            height: 28px;
            align-items: center;
            justify-content: center;
            background: none;
            border: 1px solid var(--cx-border);
            border-radius: var(--cx-radius-sm);
            color: var(--cx-text-muted);
            cursor: pointer;
            display: flex;
            flex-shrink: 0;
            transition: color 0.15s, background 0.15s;
        }
        .close-btn:hover { color: var(--cx-text); background: var(--cx-hover); }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--cx-border);
            padding: 0 6px;
            overflow-x: auto;
            scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar { display: none; }
        .tab {
            flex: 1 0 auto;
            text-align: center;
            padding: 10px 6px 9px;
            cursor: pointer;
            color: var(--cx-text-muted);
            border-bottom: 2px solid transparent;
            font-weight: 550;
            font-size: 11.5px;
            white-space: nowrap;
            transition: color 0.15s, border-color 0.15s;
        }
        .tab:hover { color: var(--cx-text); }
        .tab.active { color: var(--cx-text); border-bottom-color: var(--cx-accent); }

        /* Motion tab */
        .anim-row {
            background: rgba(0,0,0,0.25); border: 1px solid var(--cx-border);
            border-radius: var(--cx-radius-sm); padding: 10px; margin-bottom: 10px;
        }
        .anim-row-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
        .anim-name { font-family: var(--cx-font-mono); font-size: 11px; color: var(--cx-accent); font-weight:600; }
        .anim-meta { font-size: 10px; color: var(--cx-text-muted); }
        .anim-scrubber { width: 100%; accent-color: var(--cx-accent); margin-bottom: 6px; }
        .anim-controls { display:flex; gap:6px; align-items:center; }
        .anim-controls select { background: rgba(0,0,0,0.3); border:1px solid var(--cx-border); color:#fff; border-radius:4px; font-size:10px; padding:3px; }

        /* Fonts tab */
        .font-row {
            background: rgba(0,0,0,0.25); border: 1px solid var(--cx-border);
            border-radius: var(--cx-radius-sm); padding: 8px 10px; margin-bottom: 8px;
        }
        .font-row-head { display:flex; justify-content:space-between; align-items:center; }
        .font-name { font-family: var(--cx-font-mono); font-size: 11px; color: #fff; }
        .font-status { font-size: 10.5px; font-weight:600; padding:1px 7px; border-radius:999px; }
        .font-status.loaded { background: rgba(72,187,120,0.18); color: var(--cx-success, #48bb78); }
        .font-status.loading { background: rgba(237,137,54,0.18); color: var(--cx-warning, #ed8936); }
        .font-status.unloaded { background: rgba(255,255,255,0.08); color: var(--cx-text-muted); }
        .font-status.error { background: rgba(245,101,101,0.18); color: var(--cx-danger, #f56565); }
        .font-detail { font-size: 10px; color: var(--cx-text-muted); margin-top:4px; word-break: break-all; }
        .font-display-badge { font-family: var(--cx-font-mono); font-size:10px; color: var(--cx-text-muted); }

        /* React/Vue/Angular tab */
        .fw-badge { display:inline-block; font-size:10px; font-weight:700; padding:3px 8px; border-radius:6px; background: rgba(79,209,197,0.15); color: var(--cx-accent); margin-bottom:10px; }
        .fw-tree { font-family: var(--cx-font-mono); font-size: 11px; background: #1e1e1e; color:#d4d4d4; border:1px solid var(--cx-border); border-radius:var(--cx-radius-sm); padding:8px; white-space:pre-wrap; word-break:break-all; max-height:260px; overflow-y:auto; }
        .fw-chain { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:12px; }
        .fw-chip { background: rgba(0,0,0,0.3); border:1px solid var(--cx-border); color: var(--cx-text-muted); border-radius:4px; padding:3px 7px; font-size:10px; font-family: var(--cx-font-mono); cursor:pointer; }
        .fw-chip:hover, .fw-chip.current { color: var(--cx-accent); border-color: var(--cx-accent); }

        .tab-content {
            display: none;
            flex: 1;
            min-height: 0;
            max-height: calc(100vh - 140px);
            overflow-y: auto;
            padding: 16px;
            overscroll-behavior: contain;
        }
        .tab-content.active { display: block; }

        .section { margin-bottom: 20px; }
        .section-title {
            font-size: 12px;
            color: var(--cx-text);
            margin-bottom: 8px;
            font-weight: 600;
        }

        .multi-banner {
            background: var(--cx-accent-soft);
            border: 1px solid var(--cx-accent-ring);
            color: var(--cx-accent-text);
            border-radius: var(--cx-radius-sm);
            padding: 8px 10px;
            font-size: 11px;
            margin-bottom: 14px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .control-group {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .control-group label { width: 40%; color: var(--cx-text-muted); }
        .control-input {
            width: 60%;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--cx-border);
            color: #fff;
            padding: 6px 8px;
            border-radius: var(--cx-radius-sm);
            outline: none;
            font-family: var(--cx-font-mono);
            font-size: 12px;
        }
        .control-input:focus { border-color: var(--cx-accent); }
        .color-input-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--cx-border);
            border-radius: var(--cx-radius-sm);
            padding: 4px;
            width: 60%;
        }
        .color-input-wrapper input[type="color"] {
            border: none; width: 24px; height: 24px; padding: 0; background: none; cursor: pointer;
        }
        .color-input-wrapper input[type="text"] {
            background: none; border: none; color: #fff; width: 100%; outline: none;
            font-family: var(--cx-font-mono); font-size: 12px;
        }

        .code-editor {
            width: 100%; min-height: 120px;
            background: #1e1e1e; color: #d4d4d4;
            border: 1px solid var(--cx-border); border-radius: var(--cx-radius-sm);
            padding: 8px; font-family: var(--cx-font-mono); font-size: 12px;
            resize: vertical; outline: none; white-space: pre-wrap;
        }

        .pseudo-toggles { display: flex; gap: 8px; margin-bottom: 12px; }
        .pseudo-toggle {
            padding: 4px 8px; border-radius: var(--cx-radius-sm);
            border: 1px solid var(--cx-border); background: none;
            color: var(--cx-text-muted); cursor: pointer; font-size: 11px;
        }
        .pseudo-toggle.active {
            background: rgba(79,209,197,0.2); color: var(--cx-accent); border-color: var(--cx-accent);
        }

        .layer-crumbs { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; }
        .layer-crumb {
            background: rgba(0,0,0,0.3); border: 1px solid var(--cx-border);
            color: var(--cx-text-muted); border-radius: var(--cx-radius-sm);
            padding: 3px 8px; font-size: 11px; font-family: var(--cx-font-mono);
            cursor: pointer;
        }
        .layer-crumb:hover, .layer-crumb.current { color: var(--cx-accent); border-color: var(--cx-accent); }
        .layer-child {
            display: flex; align-items: center; justify-content: space-between;
            background: rgba(0,0,0,0.2); border: 1px solid var(--cx-border);
            border-radius: var(--cx-radius-sm); padding: 6px 10px; margin-bottom: 6px;
            font-family: var(--cx-font-mono); font-size: 11px; cursor: pointer; color: var(--cx-text);
        }
        .layer-child:hover { border-color: var(--cx-accent); color: var(--cx-accent); }
        .layer-child .lc-meta { color: var(--cx-text-muted); font-size: 10px; }

        .hint-text { font-size: 10px; color: var(--cx-text-muted); margin-top: 6px; line-height: 1.5; }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'editor-panel';
    panel.innerHTML = `
        <div class="header">
            <div class="header-title" id="el-title">&lt;div&gt;</div>
            <button class="close-btn" id="close-panel" aria-label="Close">${UI.icon('close', 16)}</button>
        </div>
        <div class="tabs">
            <div class="tab active" data-tab="visual">Visual</div>
            <div class="tab" data-tab="layers">Layers</div>
            <div class="tab" data-tab="motion">Motion</div>
            <div class="tab" data-tab="fonts">Fonts</div>
            <div class="tab" data-tab="react">React</div>
            <div class="tab" data-tab="code">Code</div>
            <div class="tab" data-tab="export">Export</div>
        </div>

        <div class="tab-content active" id="tab-visual">
            <div class="multi-banner" id="multi-banner" style="display:none;">
                <span id="multi-banner-text">0 elements selected</span>
                <button class="cx-btn cx-btn-ghost" id="multi-clear" style="width:auto;padding:3px 8px;">Clear</button>
            </div>

            <div class="section" id="section-states">
                <div class="section-title">States</div>
                <div class="pseudo-toggles">
                    <button class="pseudo-toggle" data-state=":hover">:hover</button>
                    <button class="pseudo-toggle" data-state=":active">:active</button>
                    <button class="pseudo-toggle" data-state=":focus">:focus</button>
                </div>
            </div>

            <div class="section" id="section-image" style="display:none;">
                <div class="section-title">Image Source</div>
                <div class="control-group">
                    <label>URL</label>
                    <input type="text" class="control-input" id="img-url-input" placeholder="https://...">
                </div>
                <button class="cx-btn cx-btn-ghost" id="img-file-btn" style="width:100%;margin-top:6px;">Choose file…</button>
                <input type="file" id="img-file-input" accept="image/*" style="display:none;">
            </div>

            <div class="section" id="section-mq">
                <div class="section-title">Media Queries</div>
                <div class="media-queries" id="mq-list" style="max-height: 150px; overflow-y: auto;">
                    <div style="color:var(--cx-text-muted); font-size:11px;">Select an element to view active media queries.</div>
                </div>
            </div>

            <div class="section">
                <div class="section-title">Positioning</div>
                <button class="cx-btn cx-btn-ghost" id="drag-mode-btn" style="width:100%;">Enable Free Drag</button>
                <div class="hint-text">Drag the selected element to move it freely. Or use arrow keys to nudge by 1px (Shift+arrow = 10px) — works on the whole selection.</div>

                <div class="control-group" style="margin-top:12px;">
                    <label>Position</label>
                    <input type="text" class="control-input" data-prop="position">
                </div>
                <div class="control-group">
                    <label>Top</label>
                    <input type="text" class="control-input" data-prop="top">
                </div>
                <div class="control-group">
                    <label>Left</label>
                    <input type="text" class="control-input" data-prop="left">
                </div>
                <div class="control-group">
                    <label>Z-Index</label>
                    <input type="text" class="control-input" data-prop="zIndex">
                </div>
            </div>

            <div class="section">
                <div class="section-title">Layout & Spacing</div>
                <div class="control-group">
                    <label>Display</label>
                    <input type="text" class="control-input" data-prop="display">
                </div>
                <div class="control-group">
                    <label>Width</label>
                    <input type="text" class="control-input" data-prop="width">
                </div>
                <div class="control-group">
                    <label>Height</label>
                    <input type="text" class="control-input" data-prop="height">
                </div>
                <div class="control-group">
                    <label>Margin</label>
                    <input type="text" class="control-input" data-prop="margin">
                </div>
                <div class="control-group">
                    <label>Padding</label>
                    <input type="text" class="control-input" data-prop="padding">
                </div>
            </div>

            <div class="section">
                <div class="section-title">Typography</div>
                <div class="control-group">
                    <label>Color</label>
                    <div class="color-input-wrapper">
                        <input type="color" id="color-picker" data-prop="color">
                        <input type="text" id="color-text" data-prop="color">
                    </div>
                </div>
                <div class="control-group">
                    <label>Font Family</label>
                    <input type="text" class="control-input" data-prop="fontFamily" placeholder="e.g. Arial, sans-serif">
                </div>
                <div class="control-group">
                    <label>Font Size</label>
                    <input type="text" class="control-input" data-prop="fontSize">
                </div>
                <div class="control-group">
                    <label>Font Weight</label>
                    <input type="text" class="control-input" data-prop="fontWeight">
                </div>
                <div class="control-group">
                    <label>Line Height</label>
                    <input type="text" class="control-input" data-prop="lineHeight">
                </div>
                <div class="control-group">
                    <label>Letter Spacing</label>
                    <input type="text" class="control-input" data-prop="letterSpacing">
                </div>
                <div class="control-group">
                    <label>Text Align</label>
                    <input type="text" class="control-input" data-prop="textAlign">
                </div>
                <div class="control-group">
                    <label>Text Decoration</label>
                    <input type="text" class="control-input" data-prop="textDecoration">
                </div>
                <div class="control-group">
                    <label>Text Transform</label>
                    <input type="text" class="control-input" data-prop="textTransform">
                </div>
                <div class="hint-text" id="hint-inline-edit">Double-click any text element on the page to edit its text in place.</div>
            </div>

            <div class="section">
                <div class="section-title">Background & Borders</div>
                <div class="control-group">
                    <label>Background</label>
                    <div class="color-input-wrapper">
                        <input type="color" id="bg-picker" data-prop="backgroundColor">
                        <input type="text" id="bg-text" data-prop="backgroundColor">
                    </div>
                </div>
                <div class="control-group">
                    <label>Border Radius</label>
                    <input type="text" class="control-input" data-prop="borderRadius">
                </div>
                <div class="control-group">
                    <label>Border</label>
                    <input type="text" class="control-input" data-prop="border">
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-layers">
            <div class="section">
                <div class="section-title">Ancestors</div>
                <div class="layer-crumbs" id="layer-crumbs"></div>
            </div>
            <div class="section">
                <div class="section-title">Children</div>
                <div id="layer-children">
                    <div style="color:var(--cx-text-muted); font-size:11px;">Select an element to see its children here.</div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-motion">
            <div class="section">
                <div class="section-title">Animations &amp; Transitions</div>
                <div id="motion-list">
                    <div style="color:var(--cx-text-muted); font-size:11px;">Select an element to see its running animations and transitions here.</div>
                </div>
                <div class="hint-text">Scrub the slider to step through a frame at a time — the animation pauses automatically while you drag.</div>
            </div>
        </div>

        <div class="tab-content" id="tab-fonts">
            <div class="section">
                <div class="section-title">Fonts Loaded On This Page</div>
                <div id="fonts-list">
                    <div style="color:var(--cx-text-muted); font-size:11px;">Loading font inventory…</div>
                </div>
                <div class="hint-text">"Simulate FOUT" briefly hides text set in that font (then reveals it) so you can preview the flash a slow font load would cause.</div>
            </div>
        </div>

        <div class="tab-content" id="tab-react">
            <div class="section">
                <div class="section-title">Component Inspector</div>
                <div id="react-info">
                    <div style="color:var(--cx-text-muted); font-size:11px;">Select an element to detect its owning React / Vue / Angular component.</div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-code">
            <div class="section">
                <div class="section-title">HTML (Live Edit)</div>
                <textarea class="code-editor" id="html-editor"></textarea>
            </div>
            <div class="section">
                <div class="section-title">Inline CSS (Live Edit)</div>
                <textarea class="code-editor" id="css-editor"></textarea>
            </div>
        </div>

        <div class="tab-content" id="tab-export">
            <div class="section">
                <div class="section-title">CodePen Export</div>
                <p style="color:var(--cx-text-muted); margin-bottom:15px; line-height:1.5;">
                    Export this element and its children to CodePen. This will include the inline styles and generate a snapshot of the current state.
                </p>
                <button class="cx-btn" id="export-btn" style="display:flex; align-items:center; justify-content:center; gap:6px; width:100%;">
                    Export to CodePen
                    ${UI.icon('external-link', 14)}
                </button>
            </div>
        </div>
    `;
    shadow.appendChild(panel);

    // Fonts tab is page-wide (not selection-dependent) — populate it once
    // up front so it's ready the moment the user clicks that tab.
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { populateFonts(); }).catch(function () { });
    }
    populateFonts();

    // ── Selection helpers ───────────────────────────────────────────────
    function clearOutline(el) { if (el && el.style) el.style.outline = ''; }
    function outlineSelected(el) { if (el && el.style && el !== document.body && el !== document.documentElement) el.style.outline = '2px solid #4FD1C5'; }

    function selectSingle(el) {
        window.CodexSelectedElements.forEach(clearOutline);
        window.CodexSelectedElements.clear();
        window.CodexSelectedElements.add(el);
        outlineSelected(el);
        window.CodexSelectedElement = el;
        window.CodexLastHighlight = el;
        refreshPanelForSelection();
    }

    function toggleInSelection(el) {
        if (window.CodexSelectedElements.has(el)) {
            window.CodexSelectedElements.delete(el);
            clearOutline(el);
        } else {
            window.CodexSelectedElements.add(el);
            outlineSelected(el);
        }
        const arr = Array.from(window.CodexSelectedElements);
        window.CodexSelectedElement = arr.length ? arr[arr.length - 1] : null;
        refreshPanelForSelection();
    }

    function refreshPanelForSelection() {
        const n = window.CodexSelectedElements.size;
        const banner = shadow.getElementById('multi-banner');
        const bannerText = shadow.getElementById('multi-banner-text');

        if (n === 0) {
            panel.style.display = 'none';
            return;
        }
        panel.style.display = 'flex';

        if (n > 1) {
            banner.style.display = 'flex';
            bannerText.textContent = n + ' elements selected — edits below apply to all';
        } else {
            banner.style.display = 'none';
        }

        openEditorForElement(window.CodexSelectedElement, n > 1 ? Array.from(window.CodexSelectedElements) : null);
    }

    // ── Highlighting ─────────────────────────────────────────────────────
    function handleMouseOver(e) {
        if (!window.CodexVisualEditorActive) return;
        const el = e.target;
        if (el === host || el.closest('#' + HOST_ID)) return;
        e.stopPropagation();

        if (window.CodexLastHighlight && !window.CodexSelectedElements.has(window.CodexLastHighlight)) {
            window.CodexLastHighlight.style.outline = '';
        }
        if (el !== document.body && el !== document.documentElement && !window.CodexSelectedElements.has(el)) {
            el.style.outline = '2px dashed #4FD1C5';
            window.CodexLastHighlight = el;
        }
    }

    function handleMouseOut(e) {
        if (!window.CodexVisualEditorActive) return;
        if (window.CodexLastHighlight && !window.CodexSelectedElements.has(window.CodexLastHighlight)) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }
    }

    let hasDragged = false;

    function handleClick(e) {
        if (!window.CodexVisualEditorActive) return;
        if (hasDragged) { e.preventDefault(); e.stopPropagation(); return; }

        const el = e.target;
        if (el === host || el.closest('#' + HOST_ID)) return;

        e.preventDefault();
        e.stopPropagation();

        if (e.shiftKey) {
            toggleInSelection(el);
        } else {
            selectSingle(el);
        }
    }

    // Double-click: inline text edit for leaf elements, image swap for <img>.
    function handleDblClick(e) {
        if (!window.CodexVisualEditorActive) return;
        const el = e.target;
        if (el === host || el.closest('#' + HOST_ID)) return;
        if (el === document.body || el === document.documentElement) return;

        if (el.tagName === 'IMG') {
            e.preventDefault();
            e.stopPropagation();
            selectSingle(el);
            const tabs = shadow.querySelectorAll('.tab');
            tabs.forEach(function (t) { t.classList.toggle('active', t.dataset.tab === 'visual'); });
            shadow.querySelectorAll('.tab-content').forEach(function (c) { c.classList.toggle('active', c.id === 'tab-visual'); });
            const urlInput = shadow.getElementById('img-url-input');
            if (urlInput) urlInput.focus();
            return;
        }

        // Only allow true inline editing on leaf (childless) elements so we
        // don't accidentally let contentEditable swallow nested markup.
        if (el.children.length > 0) return;

        e.preventDefault();
        e.stopPropagation();
        startInlineEdit(el);
    }

    function startInlineEdit(el) {
        el.contentEditable = 'true';
        el.spellcheck = false;
        el.focus();
        try {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (err) { /* selection API not available in this context — non-fatal */ }

        function commit() {
            el.contentEditable = 'false';
            el.removeEventListener('blur', commit);
            el.removeEventListener('keydown', onKey);
            if (window.CodexSelectedElement === el) populateCodeEditor(el);
        }
        function onKey(ke) {
            if (ke.key === 'Enter' && !ke.shiftKey) { ke.preventDefault(); el.blur(); }
            else if (ke.key === 'Escape') { el.blur(); }
        }
        el.addEventListener('blur', commit);
        el.addEventListener('keydown', onKey);
    }

    // ── Arrow-key nudging ────────────────────────────────────────────────
    const ARROW_DELTA = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

    function isTypingTarget() {
        const active = document.activeElement;
        if (active === host && shadow.activeElement) {
            const tag = shadow.activeElement.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        }
        if (active && active.isContentEditable) return true;
        const tag = active && active.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    }

    function nudge(el, dx, dy) {
        const cs = window.getComputedStyle(el);
        if (cs.position === 'static') el.style.position = 'relative';
        const curLeft = parseFloat(el.style.left) || 0;
        const curTop = parseFloat(el.style.top) || 0;
        el.style.setProperty('left', (curLeft + dx) + 'px');
        el.style.setProperty('top', (curTop + dy) + 'px');
    }

    function handleKeydown(e) {
        if (!window.CodexVisualEditorActive) return;

        // Esc works in layers: while typing (inline text edit or a panel
        // field) it just finishes that edit; otherwise it hides the editor.
        // Either way the page doesn't also react to this Esc.
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            if (isTypingTarget()) {
                const field = document.activeElement === host ? shadow.activeElement : document.activeElement;
                if (field && field.blur) field.blur();
                return;
            }
            teardown();
            return;
        }

        const delta = ARROW_DELTA[e.key];
        if (!delta || isTypingTarget() || window.CodexSelectedElements.size === 0) return;

        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        window.CodexSelectedElements.forEach(function (el) { nudge(el, delta[0] * step, delta[1] * step); });

        if (window.CodexSelectedElement) {
            populateCodeEditor(window.CodexSelectedElement);
            populateVisualEditor(window.CodexSelectedElement, Array.from(window.CodexSelectedElements));
        }
    }

    // ── Editor panel population ──────────────────────────────────────────
    function openEditorForElement(el, multiTargets) {
        let headerText = '&lt;' + el.tagName.toLowerCase() + '&gt;';
        if (el.className && typeof el.className === 'string' && el.className.trim()) {
            headerText += `<span style="color:#A0AEC0; font-size:11px; margin-left:8px;">.${el.className.trim().split(/\s+/).join('.')}</span>`;
        }
        if (el.id) headerText += `<span style="color:#F687B3; font-size:11px; margin-left:8px;">#${el.id}</span>`;
        shadow.getElementById('el-title').innerHTML = headerText;

        const imageSection = shadow.getElementById('section-image');
        if (el.tagName === 'IMG' && !multiTargets) {
            imageSection.style.display = 'block';
            shadow.getElementById('img-url-input').value = el.getAttribute('src') || '';
        } else {
            imageSection.style.display = 'none';
        }

        populateVisualEditor(el, multiTargets);
        populateCodeEditor(el);
        populateMediaQueries(el);
        populateLayers(el);
        populateMotion(el);
        populateReactInfo(el);
    }

    function extractRuleBody(cssText) {
        // Brace-counting extractor — the old `/{([^}]+)}/` regex truncated
        // on any rule containing nested braces (e.g. @supports-in-@media).
        const start = cssText.indexOf('{');
        if (start === -1) return cssText.trim();
        let depth = 0;
        for (let i = start; i < cssText.length; i++) {
            if (cssText[i] === '{') depth++;
            else if (cssText[i] === '}') {
                depth--;
                if (depth === 0) return cssText.slice(start + 1, i).trim();
            }
        }
        return cssText.slice(start + 1).trim();
    }

    function populateMediaQueries(el) {
        const mqList = shadow.getElementById('mq-list');
        mqList.innerHTML = '';
        let found = false;

        try {
            for (let i = 0; i < document.styleSheets.length; i++) {
                const sheet = document.styleSheets[i];
                let rules;
                try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin sheet

                if (!rules) continue;
                for (let j = 0; j < rules.length; j++) {
                    const rule = rules[j];
                    if (rule.type !== CSSRule.MEDIA_RULE) continue;
                    const mediaRules = rule.cssRules;
                    for (let k = 0; k < mediaRules.length; k++) {
                        const mRule = mediaRules[k];
                        try {
                            if (mRule.selectorText && el.matches(mRule.selectorText)) {
                                found = true;
                                const item = document.createElement('div');
                                item.style.cssText = 'background:rgba(0,0,0,0.2); border:1px solid var(--cx-border); border-radius:4px; padding:6px 8px; margin-bottom:6px; font-family:var(--cx-font-mono); font-size:11px; display:flex; flex-direction:column; gap:4px;';

                                const condition = document.createElement('div');
                                condition.style.color = '#C586C0';
                                condition.textContent = '@media ' + rule.conditionText;

                                const cssText = document.createElement('div');
                                cssText.style.color = 'var(--cx-text-muted)';
                                cssText.style.whiteSpace = 'pre-wrap';
                                cssText.textContent = extractRuleBody(mRule.cssText);

                                item.appendChild(condition);
                                item.appendChild(cssText);
                                mqList.appendChild(item);
                            }
                        } catch (e) { /* invalid selectorText in the wild — skip */ }
                    }
                }
            }
        } catch (err) {
            console.warn('Error reading stylesheets', err);
        }

        if (!found) {
            mqList.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">No active media queries found for this element.</div>';
        }
    }

    function describeEl(el) {
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        else if (el.className && typeof el.className === 'string' && el.className.trim()) s += '.' + el.className.trim().split(/\s+/)[0];
        return s;
    }

    function populateLayers(el) {
        const crumbs = shadow.getElementById('layer-crumbs');
        const childrenBox = shadow.getElementById('layer-children');
        crumbs.innerHTML = '';
        childrenBox.innerHTML = '';

        const chain = [];
        let node = el;
        while (node && node !== document.documentElement.parentNode) {
            chain.unshift(node);
            if (node === document.body) break;
            node = node.parentElement;
        }

        chain.forEach(function (ancestor) {
            const crumb = document.createElement('div');
            crumb.className = 'layer-crumb' + (ancestor === el ? ' current' : '');
            crumb.textContent = describeEl(ancestor);
            crumb.addEventListener('click', function () { selectSingle(ancestor); });
            crumbs.appendChild(crumb);
        });

        const children = Array.from(el.children);
        if (children.length === 0) {
            childrenBox.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">No child elements.</div>';
            return;
        }
        children.forEach(function (child) {
            const row = document.createElement('div');
            row.className = 'layer-child';
            row.innerHTML = `<span>${describeEl(child)}</span><span class="lc-meta">${child.children.length ? child.children.length + ' children' : 'leaf'}</span>`;
            row.addEventListener('click', function () { selectSingle(child); });
            childrenBox.appendChild(row);
        });
    }

    // ── Motion / Animation Inspector ─────────────────────────────────────
    // Uses the Web Animations API (element.getAnimations()) so it covers
    // both CSS @keyframes animations and CSS transitions uniformly — no
    // polling of computed style needed to detect what's running.
    function populateMotion(el) {
        const box = shadow.getElementById('motion-list');
        if (!box) return;
        box.innerHTML = '';

        let anims = [];
        try { anims = el.getAnimations ? el.getAnimations() : []; } catch (e) { anims = []; }

        if (!anims.length) {
            box.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">No active animations or transitions on this element right now. Trigger it (hover/click/scroll) — this tab auto-refreshes while open.</div>';
            return;
        }

        anims.forEach(function (anim, idx) {
            const effect = anim.effect;
            let duration = 0;
            try {
                const timing = effect && effect.getComputedTiming ? effect.getComputedTiming() : {};
                duration = (typeof timing.duration === 'number') ? timing.duration : 0;
            } catch (e) { /* older engines without getComputedTiming — leave 0 */ }

            const name = anim.animationName || (anim.transitionProperty ? 'transition: ' + anim.transitionProperty : ('animation-' + idx));

            const row = document.createElement('div');
            row.className = 'anim-row';
            row.innerHTML = `
                <div class="anim-row-head">
                    <span class="anim-name">${name}</span>
                    <span class="anim-meta">${anim.playState}</span>
                </div>
                <input type="range" class="anim-scrubber" min="0" max="${Math.max(duration, 1)}" step="1" value="0">
                <div class="anim-controls">
                    <button class="cx-btn cx-btn-ghost anim-toggle" style="width:auto;padding:4px 10px;">Pause</button>
                    <select class="anim-rate" title="Playback rate">
                        <option value="1">1x</option>
                        <option value="0.5">0.5x</option>
                        <option value="0.25">0.25x</option>
                        <option value="0.1">0.1x</option>
                    </select>
                </div>
            `;
            box.appendChild(row);

            const scrubber = row.querySelector('.anim-scrubber');
            const toggleBtn = row.querySelector('.anim-toggle');
            const rateSelect = row.querySelector('.anim-rate');
            toggleBtn.textContent = anim.playState === 'running' ? 'Pause' : 'Play';

            scrubber.addEventListener('pointerdown', function () {
                try { anim.pause(); } catch (e) { }
                toggleBtn.textContent = 'Play';
            });
            scrubber.addEventListener('input', function (e) {
                try { anim.currentTime = parseFloat(e.target.value); } catch (e) { }
            });
            toggleBtn.addEventListener('click', function () {
                if (anim.playState === 'running') { anim.pause(); toggleBtn.textContent = 'Play'; }
                else { anim.play(); toggleBtn.textContent = 'Pause'; }
            });
            rateSelect.addEventListener('change', function (e) {
                try { anim.playbackRate = parseFloat(e.target.value); } catch (err) { }
            });

            // Keep the scrubber in sync while the animation runs on its own.
            // Stops itself once the editor is torn down or this row is
            // replaced by a fresh populateMotion() call — no separate
            // teardown bookkeeping needed for this loop.
            (function tick() {
                if (!window.CodexVisualEditorActive || !shadow.contains(row)) return;
                try {
                    if (typeof anim.currentTime === 'number' && document.activeElement !== scrubber) scrubber.value = anim.currentTime;
                } catch (e) { return; }
                requestAnimationFrame(tick);
            })();
        });
    }

    // ── Font Loading / FOUT-FOIT Inspector ───────────────────────────────
    function getFontFaceMeta() {
        // Best-effort match of @font-face src/font-display to family names
        // from whatever same-origin stylesheets we're able to read.
        const meta = {};
        try {
            for (let i = 0; i < document.styleSheets.length; i++) {
                let rules;
                try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
                if (!rules) continue;
                for (let j = 0; j < rules.length; j++) {
                    const rule = rules[j];
                    if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
                    const family = (rule.style.getPropertyValue('font-family') || '').replace(/["']/g, '').trim();
                    if (!family) continue;
                    if (!meta[family]) meta[family] = [];
                    meta[family].push({
                        src: rule.style.getPropertyValue('src') || '',
                        display: rule.style.getPropertyValue('font-display') || 'auto'
                    });
                }
            }
        } catch (e) { /* ignore */ }
        return meta;
    }

    function populateFonts() {
        const box = shadow.getElementById('fonts-list');
        if (!box) return;
        if (!document.fonts) {
            box.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">Font Loading API not available in this context.</div>';
            return;
        }

        const faceMeta = getFontFaceMeta();
        box.innerHTML = '';

        const faces = [];
        document.fonts.forEach(function (f) { faces.push(f); });

        if (!faces.length) {
            box.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">No custom @font-face fonts detected — this page is using system/default fonts only.</div>';
            return;
        }

        faces.forEach(function (face) {
            const family = face.family.replace(/["']/g, '');
            const entries = faceMeta[family] || [];
            const src = entries.length ? entries[0].src : '';
            const display = entries.length ? entries[0].display : 'auto';

            const row = document.createElement('div');
            row.className = 'font-row';
            row.innerHTML = `
                <div class="font-row-head">
                    <span class="font-name">${family} <span style="color:var(--cx-text-muted);">${face.weight} ${face.style}</span></span>
                    <span class="font-status ${face.status}">${face.status}</span>
                </div>
                <div class="font-detail">
                    <span class="font-display-badge">font-display: ${display}</span>
                    ${src ? '<div style="margin-top:3px;">' + escapeHtml(src).slice(0, 160) + '</div>' : ''}
                </div>
                <button class="cx-btn cx-btn-ghost fout-btn" style="width:auto; padding:4px 10px; margin-top:8px;">Simulate FOUT</button>
            `;
            box.appendChild(row);
            row.querySelector('.fout-btn').addEventListener('click', function () { simulateFout(family); });
        });
    }

    function simulateFout(family) {
        // Find elements actually rendering with this font, hide their text
        // briefly then reveal it — a visual stand-in for the flash a slow
        // font load causes, without needing real network throttling.
        const targets = [];
        document.querySelectorAll('body, body *').forEach(function (node) {
            if (node.closest && node.closest('#' + HOST_ID)) return;
            try {
                const cs = window.getComputedStyle(node);
                if (cs.fontFamily && cs.fontFamily.indexOf(family) !== -1 && node.textContent && node.textContent.trim()) targets.push(node);
            } catch (e) { /* ignore */ }
        });
        if (!targets.length) { UI.toast('No visible text is currently using "' + family + '"'); return; }

        targets.forEach(function (t) { t.style.setProperty('visibility', 'hidden', 'important'); });
        UI.toast('Simulating FOUT for "' + family + '" — text hidden for 1.2s');
        setTimeout(function () { targets.forEach(function (t) { t.style.removeProperty('visibility'); }); }, 1200);
    }

    // ── Framework Component Inspector (React / Vue / Angular) ────────────
    // Best-effort: reads the same internal fiber/instance properties the
    // official React/Vue DevTools read. Field names are undocumented and
    // can shift between major versions, so every access is guarded.
    function safeStringify(obj, maxDepth) {
        maxDepth = maxDepth || 2;
        const seen = new WeakSet();
        function serialize(value, depth) {
            if (value === null || value === undefined) return value;
            const t = typeof value;
            if (t === 'function') return '[Function' + (value.name ? ': ' + value.name : '') + ']';
            if (t !== 'object') return value;
            if (seen.has(value)) return '[Circular]';
            if (depth <= 0) return Array.isArray(value) ? '[Array]' : '[Object]';
            seen.add(value);
            if (value instanceof Node) return '[DOM ' + value.nodeName + ']';
            if (Array.isArray(value)) return value.slice(0, 20).map(function (v) { return serialize(v, depth - 1); });
            const out = {};
            Object.keys(value).slice(0, 30).forEach(function (k) {
                try { out[k] = serialize(value[k], depth - 1); } catch (e) { out[k] = '[Unreadable]'; }
            });
            return out;
        }
        try { return JSON.stringify(serialize(obj, maxDepth), null, 2); } catch (e) { return String(obj); }
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function findReactFiberKey(el) {
        return Object.keys(el).find(function (k) { return k.indexOf('__reactFiber$') === 0 || k.indexOf('__reactInternalInstance$') === 0; });
    }

    function componentNameFromFiber(fiber) {
        const t = fiber.type;
        if (!t) return 'Unknown';
        if (typeof t === 'string') return t;
        return t.displayName || t.name || 'Anonymous';
    }

    function detectReact(el) {
        let node = el;
        while (node) {
            const key = findReactFiberKey(node);
            if (key) {
                const fiber = node[key];
                let compFiber = fiber;
                while (compFiber && typeof compFiber.type === 'string') compFiber = compFiber.return;
                if (!compFiber) compFiber = fiber;
                return { framework: 'React', name: componentNameFromFiber(compFiber), props: compFiber.memoizedProps, state: compFiber.memoizedState };
            }
            node = node.parentElement;
        }
        return null;
    }

    function detectVue(el) {
        let node = el;
        while (node) {
            if (node.__vueParentComponent) {
                const inst = node.__vueParentComponent;
                return { framework: 'Vue 3', name: (inst.type && (inst.type.name || inst.type.__name)) || 'Anonymous', props: inst.props, state: inst.setupState || inst.data };
            }
            if (node.__vue__) {
                const inst = node.__vue__;
                return { framework: 'Vue 2', name: (inst.$options && (inst.$options.name || inst.$options._componentTag)) || 'Anonymous', props: inst.$props, state: inst.$data };
            }
            node = node.parentElement;
        }
        return null;
    }

    function detectAngular(el) {
        try {
            if (window.ng && typeof window.ng.getComponent === 'function') {
                let node = el;
                while (node) {
                    const comp = window.ng.getComponent(node);
                    if (comp) return { framework: 'Angular', name: comp.constructor ? comp.constructor.name : 'Component', props: null, state: comp };
                    node = node.parentElement;
                }
            }
        } catch (e) { /* Angular DevTools global not present — not a dev build */ }
        if (el.closest && el.closest('[ng-version]')) {
            return { framework: 'Angular', name: '(enable Angular DevTools for full component detail)', props: null, state: null };
        }
        return null;
    }

    function populateReactInfo(el) {
        const box = shadow.getElementById('react-info');
        if (!box) return;

        const info = detectReact(el) || detectVue(el) || detectAngular(el);
        if (!info) {
            box.innerHTML = '<div style="color:var(--cx-text-muted); font-size:11px;">No React, Vue, or Angular component detected on or above this element.</div>';
            return;
        }

        let html = '<div class="fw-badge">' + escapeHtml(info.framework) + ' — ' + escapeHtml(info.name) + '</div>';
        if (info.props !== undefined && info.props !== null) {
            html += '<div class="section-title" style="margin-top:8px;">Props</div><div class="fw-tree">' + escapeHtml(safeStringify(info.props)) + '</div>';
        }
        if (info.state !== undefined && info.state !== null) {
            html += '<div class="section-title" style="margin-top:12px;">State</div><div class="fw-tree">' + escapeHtml(safeStringify(info.state)) + '</div>';
        }
        box.innerHTML = html;
    }

    function rgbToHex(rgb) {
        if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return '#000000';
        if (rgb.startsWith('#')) return rgb;
        const match = rgb.match(/^rgba?[\s+]?\([\s+]?(\d+)[\s+]?,[\s+]?(\d+)[\s+]?,[\s+]?(\d+)[\s+]?/i);
        return (match && match.length === 4) ? '#' +
            ('0' + parseInt(match[1], 10).toString(16)).slice(-2) +
            ('0' + parseInt(match[2], 10).toString(16)).slice(-2) +
            ('0' + parseInt(match[3], 10).toString(16)).slice(-2) : rgb;
    }

    function applyPropToTargets(prop, hyphenated, value, targets) {
        const list = targets && targets.length ? targets : [];
        list.forEach(function (t) {
            if (!value) t.style.removeProperty(hyphenated);
            else t.style.setProperty(hyphenated, value);
        });
    }

    function populateVisualEditor(el, multiTargets) {
        const styles = window.getComputedStyle(el);
        const targets = multiTargets || [el];

        const inputs = shadow.querySelectorAll('.control-input');
        inputs.forEach(function (input) {
            const prop = input.getAttribute('data-prop');
            if (!prop) return;
            input.value = styles[prop] || '';
            input.oninput = function (e) {
                const hyphenated = prop.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
                applyPropToTargets(prop, hyphenated, e.target.value, targets);
                if (window.CodexSelectedElement) populateCodeEditor(window.CodexSelectedElement);
            };
        });

        const colorPicker = shadow.getElementById('color-picker');
        const colorText = shadow.getElementById('color-text');
        const txtColor = styles.color;
        colorText.value = txtColor;
        colorPicker.value = rgbToHex(txtColor);
        const updateColor = function (val) {
            targets.forEach(function (t) { t.style.color = val; });
            colorText.value = val;
            colorPicker.value = rgbToHex(val);
            if (window.CodexSelectedElement) populateCodeEditor(window.CodexSelectedElement);
        };
        colorPicker.oninput = function (e) { updateColor(e.target.value); };
        colorText.oninput = function (e) { updateColor(e.target.value); };

        const bgPicker = shadow.getElementById('bg-picker');
        const bgText = shadow.getElementById('bg-text');
        const bgColor = styles.backgroundColor;
        bgText.value = bgColor;
        bgPicker.value = rgbToHex(bgColor);
        const updateBg = function (val) {
            targets.forEach(function (t) { t.style.backgroundColor = val; });
            bgText.value = val;
            bgPicker.value = rgbToHex(val);
            if (window.CodexSelectedElement) populateCodeEditor(window.CodexSelectedElement);
        };
        bgPicker.oninput = function (e) { updateBg(e.target.value); };
        bgText.oninput = function (e) { updateBg(e.target.value); };

        // Image source controls (single-selection only)
        const urlInput = shadow.getElementById('img-url-input');
        const fileBtn = shadow.getElementById('img-file-btn');
        const fileInput = shadow.getElementById('img-file-input');
        if (el.tagName === 'IMG' && !multiTargets) {
            urlInput.oninput = function (e) { el.setAttribute('src', e.target.value); };
            fileBtn.onclick = function () { fileInput.click(); };
            fileInput.onchange = function () {
                const file = fileInput.files && fileInput.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = function () {
                    el.setAttribute('src', reader.result);
                    urlInput.value = reader.result;
                    if (window.CodexSelectedElement === el) populateCodeEditor(el);
                };
                reader.readAsDataURL(file);
            };
        }
    }

    function populateCodeEditor(el) {
        const htmlEditor = shadow.getElementById('html-editor');
        const cssEditor = shadow.getElementById('css-editor');

        if (document.activeElement !== htmlEditor) htmlEditor.value = highlightHtml(el.outerHTML);
        if (document.activeElement !== cssEditor) {
            cssEditor.value = el.getAttribute('style') ? el.getAttribute('style').split(';').join(';\n').trim() : '';
        }

        htmlEditor.oninput = function (e) {
            try {
                const temp = document.createElement('div');
                temp.innerHTML = e.target.value;
                const newEl = temp.firstElementChild;
                if (newEl) {
                    el.replaceWith(newEl);
                    window.CodexSelectedElements.delete(el);
                    window.CodexSelectedElements.add(newEl);
                    window.CodexSelectedElement = newEl;
                    outlineSelected(newEl);
                    el = newEl;
                    populateVisualEditor(el);
                }
            } catch (err) { /* invalid HTML mid-edit — ignore until it parses */ }
        };

        cssEditor.oninput = function (e) {
            el.setAttribute('style', e.target.value.replace(/\n/g, ' '));
            populateVisualEditor(el);
        };
    }

    function highlightHtml(html) {
        let formatted = '', indent = '';
        html.split(/>\s*</).forEach(function (node) {
            if (node.match(/^\/\w/)) indent = indent.substring(2);
            formatted += indent + '<' + node + '>\r\n';
            if (node.match(/^<?\w[^>]*[^\/]$/)) indent += '  ';
        });
        return formatted.substring(1, formatted.length - 3);
    }

    // ── Tabs ─────────────────────────────────────────────────────────────
    const tabs = shadow.querySelectorAll('.tab');
    const contents = shadow.querySelectorAll('.tab-content');
    tabs.forEach(function (tab) {
        tab.addEventListener('click', function () {
            tabs.forEach(function (t) { t.classList.remove('active'); });
            contents.forEach(function (c) { c.classList.remove('active'); });
            tab.classList.add('active');
            shadow.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            if (tab.dataset.tab === 'layers' && window.CodexSelectedElement) populateLayers(window.CodexSelectedElement);
            if (tab.dataset.tab === 'motion' && window.CodexSelectedElement) populateMotion(window.CodexSelectedElement);
            if (tab.dataset.tab === 'fonts') populateFonts();
            if (tab.dataset.tab === 'react' && window.CodexSelectedElement) populateReactInfo(window.CodexSelectedElement);
        });
    });

    // ── Close / multi-clear ──────────────────────────────────────────────
    shadow.getElementById('close-panel').addEventListener('click', function () { teardown(); });
    shadow.getElementById('multi-clear').addEventListener('click', function () {
        window.CodexSelectedElements.forEach(clearOutline);
        window.CodexSelectedElements.clear();
        window.CodexSelectedElement = null;
        panel.style.display = 'none';
    });

    panel.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });
    panel.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
    panel.addEventListener('scroll', function (e) { e.stopPropagation(); }, { passive: true });

    // ── Panel drag ───────────────────────────────────────────────────────
    const panelHeader = shadow.querySelector('.header');
    let isDraggingPanel = false;
    let panelDragStartX, panelDragStartY, panelStartLeft, panelStartTop;

    panelHeader.addEventListener('mousedown', function (e) {
        if (e.target.closest('.close-btn')) return;
        isDraggingPanel = true;
        panelDragStartX = e.clientX;
        panelDragStartY = e.clientY;
        const rect = panel.getBoundingClientRect();
        panelStartLeft = rect.left;
        panelStartTop = rect.top;
        if (getComputedStyle(panel).position === 'fixed') {
            panel.style.right = 'auto';
            panel.style.left = panelStartLeft + 'px';
            panel.style.top = panelStartTop + 'px';
        }
        e.preventDefault();
    });

    // ── Free-drag mode (single element) ─────────────────────────────────
    let dragModeActive = false;
    let isDragging = false;
    let dragStartX = 0, dragStartY = 0, dragStartLeft = 0, dragStartTop = 0;

    const dragBtn = shadow.getElementById('drag-mode-btn');
    dragBtn.addEventListener('click', function () {
        dragModeActive = !dragModeActive;
        dragBtn.textContent = dragModeActive ? 'Disable Free Drag' : 'Enable Free Drag';
        dragBtn.classList.toggle('cx-btn-ghost', !dragModeActive);
        if (dragModeActive) {
            document.body.classList.add('codex-drag-mode-active');
            injectHostStyle('.codex-drag-mode-active * { cursor: grab !important; } .codex-drag-mode-active *:active { cursor: grabbing !important; }');
        } else {
            document.body.classList.remove('codex-drag-mode-active');
        }
        if (dragModeActive && window.CodexSelectedElement) {
            const s = window.getComputedStyle(window.CodexSelectedElement);
            if (s.position === 'static') {
                window.CodexSelectedElement.style.position = 'relative';
                populateCodeEditor(window.CodexSelectedElement);
                populateVisualEditor(window.CodexSelectedElement);
            }
        }
    });

    function handleMouseDown(e) {
        if (!window.CodexVisualEditorActive || !dragModeActive || !window.CodexSelectedElement) return;
        const el = window.CodexSelectedElement;
        if (e.target === el || el.contains(e.target)) {
            e.preventDefault();
            isDragging = true;
            hasDragged = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            const s = window.getComputedStyle(el);
            if (s.position === 'static') el.style.position = 'relative';
            dragStartLeft = parseFloat(s.left) || 0;
            dragStartTop = parseFloat(s.top) || 0;
        }
    }

    function handleMouseMove(e) {
        if (isDraggingPanel) {
            const dx = e.clientX - panelDragStartX;
            const dy = e.clientY - panelDragStartY;
            panel.style.left = (panelStartLeft + dx) + 'px';
            panel.style.top = (panelStartTop + dy) + 'px';
        }
        if (!isDragging || !window.CodexSelectedElement) return;
        hasDragged = true;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        window.CodexSelectedElement.style.setProperty('left', (dragStartLeft + dx) + 'px', 'important');
        window.CodexSelectedElement.style.setProperty('top', (dragStartTop + dy) + 'px', 'important');
    }

    function handleMouseUp() {
        isDraggingPanel = false;
        if (isDragging) {
            isDragging = false;
            if (window.CodexSelectedElement && hasDragged) {
                populateCodeEditor(window.CodexSelectedElement);
                populateVisualEditor(window.CodexSelectedElement);
            }
            setTimeout(function () { hasDragged = false; }, 0);
        }
    }

    // ── CodePen export ───────────────────────────────────────────────────
    shadow.getElementById('export-btn').addEventListener('click', function () {
        if (!window.CodexSelectedElement) return;
        const el = window.CodexSelectedElement;
        const data = {
            title: 'Codex Export',
            description: 'Exported from Codex Dev Visual Editor',
            html: el.outerHTML,
            css: 'body { \n  background: #f7fafc; \n  display: flex; \n  justify-content: center; \n  align-items: center; \n  min-height: 100vh; \n}',
            editors: '110'
        };
        const jsonString = JSON.stringify(data).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
        const form = document.createElement('form');
        form.action = 'https://codepen.io/pen/define';
        form.method = 'POST';
        form.target = '_blank';
        form.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'data';
        input.value = jsonString;
        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        form.remove();
        UI.toast('Exporting to CodePen...');
    });

    // ── Pseudo-class state toggles ───────────────────────────────────────
    shadow.querySelectorAll('.pseudo-toggle').forEach(function (toggle) {
        toggle.addEventListener('click', function () {
            toggle.classList.toggle('active');
            const state = toggle.dataset.state;
            const el = window.CodexSelectedElement;
            if (!el) return;
            const forceClass = 'codex-force' + state.replace(':', '-');
            if (toggle.classList.contains('active')) {
                el.classList.add(forceClass);
                injectHostStyle('.' + forceClass + ' { ' + (state === ':hover' ? 'filter: brightness(0.9);' : '') + ' }');
            } else {
                el.classList.remove(forceClass);
            }
        });
    });

    function injectHostStyle(cssRule) {
        let styleEl = document.getElementById('codex-injected-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'codex-injected-styles';
            document.head.appendChild(styleEl);
        }
        if (!styleEl.innerHTML.includes(cssRule)) styleEl.innerHTML += '\n' + cssRule;
    }

    // ── Wire up global listeners, stored on window so a fresh re-injection
    // (the toggle-off branch at the top of this file) can remove the exact
    // same function references — the old version declared these as plain
    // function statements, which are *different objects on every script
    // re-injection*, so its removeEventListener calls silently never
    // matched anything and every toggle leaked all 6 listeners. ─────────
    window.__cxVE = {
        onMouseOver: handleMouseOver,
        onMouseOut: handleMouseOut,
        onMouseDown: handleMouseDown,
        onMouseMove: handleMouseMove,
        onMouseUp: handleMouseUp,
        onClick: handleClick,
        onDblClick: handleDblClick,
        onKeydown: handleKeydown
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('click', handleClick, true);
    document.addEventListener('dblclick', handleDblClick, true);
    // Keys on window (capture): runs before page handlers on document, so
    // sites with their own shortcuts can't swallow Esc or the arrow keys.
    window.addEventListener('keydown', handleKeydown, true);
})();
