(function () {
    const HOST_ID = 'codex-visual-editor-host';

    if (window.CodexVisualEditorActive) {
        window.CodexVisualEditorActive = false;
        document.removeEventListener('mouseover', handleMouseOver, true);
        document.removeEventListener('mouseout', handleMouseOut, true);
        document.removeEventListener('click', handleClick, true);

        const host = document.getElementById(HOST_ID);
        if (host) host.remove();

        if (window.CodexLastHighlight) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }

        document.body.classList.remove('codex-drag-mode-active');
        showToast('Visual Editor: OFF');
        return;
    }

    window.CodexVisualEditorActive = true;
    window.CodexSelectedElement = null;
    showToast('Visual Editor: ON. Click an element to edit.');

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

    const style = document.createElement('style');
    style.textContent = `
        :host {
            --bg: #1a1a24;
            --bg-panel: #2d2d3d;
            --text: #e2e8f0;
            --text-muted: #a0aec0;
            --accent: #4FD1C5;
            --border: rgba(255,255,255,0.1);
            font-family: 'Inter', system-ui, sans-serif;
            font-size: 13px;
            color: var(--text);
            box-sizing: border-box;
        }
        * { box-sizing: border-box; }
        
        .editor-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 340px;
            height: calc(100vh - 40px); /* Strictly constrain height instead of max-height */
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            display: none;
            flex-direction: column;
            overflow: hidden;
            z-index: 10000;
            pointer-events: auto; /* Ensure it captures all pointer and scroll events */
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: rgba(0,0,0,0.2);
            border-bottom: 1px solid var(--border);
            cursor: move;
        }
        
        .header-title {
            font-weight: 600;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 16px;
        }
        .close-btn:hover { color: #fff; }

        .tabs {
            display: flex;
            border-bottom: 1px solid var(--border);
            background: var(--bg-panel);
        }
        .tab {
            flex: 1;
            text-align: center;
            padding: 10px;
            cursor: pointer;
            color: var(--text-muted);
            border-bottom: 2px solid transparent;
            font-weight: 500;
        }
        .tab.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }

        .tab-content {
            display: none;
            flex: 1;
            min-height: 0;
            max-height: calc(100vh - 140px);
            overflow-y: auto;
            padding: 16px;
            overscroll-behavior: contain;
        }
        .tab-content.active {
            display: block;
        }

        .section {
            margin-bottom: 20px;
        }
        .section-title {
            font-size: 11px;
            text-transform: uppercase;
            color: var(--text-muted);
            margin-bottom: 8px;
            letter-spacing: 0.5px;
            font-weight: 600;
        }

        .control-group {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .control-group label {
            width: 40%;
            color: var(--text-muted);
        }
        .control-input {
            width: 60%;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--border);
            color: #fff;
            padding: 6px 8px;
            border-radius: 4px;
            outline: none;
            font-family: monospace;
            font-size: 12px;
        }
        .control-input:focus {
            border-color: var(--accent);
        }
        .color-input-wrapper {
            display: flex;
            align-items: center;
            gap: 8px;
            background: rgba(0,0,0,0.3);
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 4px;
            width: 60%;
        }
        .color-input-wrapper input[type="color"] {
            border: none;
            width: 24px;
            height: 24px;
            padding: 0;
            background: none;
            cursor: pointer;
        }
        .color-input-wrapper input[type="text"] {
            background: none;
            border: none;
            color: #fff;
            width: 100%;
            outline: none;
            font-family: monospace;
            font-size: 12px;
        }
        
        .code-editor {
            width: 100%;
            min-height: 120px;
            background: #1e1e1e;
            color: #d4d4d4;
            border: 1px solid var(--border);
            border-radius: 4px;
            padding: 8px;
            font-family: monospace;
            font-size: 12px;
            resize: vertical;
            outline: none;
            white-space: pre-wrap;
        }
        
        .btn {
            background: var(--accent);
            color: #000;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            width: 100%;
            margin-top: 10px;
        }
        .btn:hover { background: #3eb1a6; }
        
        .pseudo-toggles {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        .pseudo-toggle {
            padding: 4px 8px;
            border-radius: 4px;
            border: 1px solid var(--border);
            background: none;
            color: var(--text-muted);
            cursor: pointer;
            font-size: 11px;
        }
        .pseudo-toggle.active {
            background: rgba(79, 209, 197, 0.2);
            color: var(--accent);
            border-color: var(--accent);
        }
        
        .hl-tag { color: #569cd6; }
        .hl-attr { color: #9cdcfe; }
        .hl-string { color: #ce9178; }
        .hl-prop { color: #9cdcfe; }
        .hl-val { color: #ce9178; }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'editor-panel';
    panel.innerHTML = `
        <div class="header">
            <div class="header-title" id="el-title">&lt;div&gt;</div>
            <button class="close-btn" id="close-panel">✕</button>
        </div>
        <div class="tabs">
            <div class="tab active" data-tab="visual">Visual</div>
            <div class="tab" data-tab="code">Code</div>
            <div class="tab" data-tab="export">Export</div>
        </div>
        
        <div class="tab-content active" id="tab-visual">
            <div class="section">
                <div class="section-title">States</div>
                <div class="pseudo-toggles">
                    <button class="pseudo-toggle" data-state=":hover">:hover</button>
                    <button class="pseudo-toggle" data-state=":active">:active</button>
                    <button class="pseudo-toggle" data-state=":focus">:focus</button>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Media Queries</div>
                <div class="media-queries" id="mq-list" style="max-height: 150px; overflow-y: auto;">
                    <div style="color:var(--text-muted); font-size:11px;">Select an element to view active media queries.</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Positioning (Drag & Drop)</div>
                <button class="btn" id="drag-mode-btn" style="background:var(--bg-panel); color:var(--accent); border:1px solid var(--accent); white-space:nowrap; margin-top:0;">Enable Free Drag</button>
                <div style="font-size:10px; color:var(--text-muted); margin-top:6px;">When enabled, click and drag the selected element to move it freely.</div>
                
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
                <p style="color:var(--text-muted); margin-bottom:15px; line-height:1.5;">
                    Export this element and its children to CodePen. This will include the inline styles and generate a snapshot of the current state.
                </p>
                <button class="btn" id="export-btn" style="display:flex; align-items:center; justify-content:center; gap:6px;">
                    Export to CodePen
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                </button>
            </div>
        </div>
    `;
    shadow.appendChild(panel);

    // Highlighting Logic
    function handleMouseOver(e) {
        if (!window.CodexVisualEditorActive) return;
        const el = e.target;
        if (el === host || el.closest('#' + HOST_ID)) return;

        e.stopPropagation();

        if (window.CodexLastHighlight && window.CodexLastHighlight !== window.CodexSelectedElement) {
            window.CodexLastHighlight.style.outline = '';
        }

        if (el !== document.body && el !== document.documentElement && el !== window.CodexSelectedElement) {
            el.style.outline = '2px dashed #4FD1C5';
            window.CodexLastHighlight = el;
        }
    }

    function handleMouseOut(e) {
        if (!window.CodexVisualEditorActive) return;
        if (window.CodexLastHighlight && window.CodexLastHighlight !== window.CodexSelectedElement) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }
    }

    let hasDragged = false;

    function handleClick(e) {
        if (!window.CodexVisualEditorActive) return;

        if (hasDragged) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const el = e.target;
        if (el === host || el.closest('#' + HOST_ID)) return;

        e.preventDefault();
        e.stopPropagation();

        if (window.CodexSelectedElement) {
            window.CodexSelectedElement.style.outline = '';
        }

        window.CodexSelectedElement = el;

        if (el !== document.body && el !== document.documentElement) {
            el.style.outline = '2px solid #4FD1C5';
        }
        window.CodexLastHighlight = el;

        openEditorForElement(el);
    }

    // Editor Logic
    function openEditorForElement(el) {
        panel.style.display = 'flex';

        let headerText = '&lt;' + el.tagName.toLowerCase() + '&gt;';
        if (el.className && typeof el.className === 'string') {
            headerText += `<span style="color:#A0AEC0; font-size:11px; margin-left:8px;">.${el.className.split(' ').join('.')}</span>`;
        }
        if (el.id) headerText += `<span style="color:#F687B3; font-size:11px; margin-left:8px;">#${el.id}</span>`;

        shadow.getElementById('el-title').innerHTML = headerText;

        populateVisualEditor(el);
        populateCodeEditor(el);
        populateMediaQueries(el);
    }

    // Find active media queries for element
    function populateMediaQueries(el) {
        const mqList = shadow.getElementById('mq-list');
        mqList.innerHTML = '';

        let found = false;

        try {
            for (let i = 0; i < document.styleSheets.length; i++) {
                const sheet = document.styleSheets[i];
                // cross-origin stylesheets will throw SecurityError when accessing cssRules
                let rules;
                try { rules = sheet.cssRules; } catch (e) { continue; }

                if (!rules) continue;

                for (let j = 0; j < rules.length; j++) {
                    const rule = rules[j];
                    if (rule.type === CSSRule.MEDIA_RULE) {
                        const mediaRules = rule.cssRules;
                        for (let k = 0; k < mediaRules.length; k++) {
                            const mRule = mediaRules[k];
                            // Try-catch for invalid selectors that might be in the wild
                            try {
                                if (mRule.selectorText && el.matches(mRule.selectorText)) {
                                    found = true;
                                    const item = document.createElement('div');
                                    item.style.cssText = 'background:rgba(0,0,0,0.2); border:1px solid var(--border); border-radius:4px; padding:6px 8px; margin-bottom:6px; font-family:monospace; font-size:11px; display:flex; flex-direction:column; gap:4px;';

                                    const condition = document.createElement('div');
                                    condition.style.color = '#C586C0';
                                    condition.textContent = '@media ' + rule.conditionText;

                                    const cssText = document.createElement('div');
                                    cssText.style.color = 'var(--text-muted)';
                                    cssText.style.whiteSpace = 'pre-wrap';
                                    // Simple extraction of rules block
                                    const blockMatch = mRule.cssText.match(/{([^}]+)}/);
                                    cssText.textContent = blockMatch ? blockMatch[1].trim() : mRule.cssText;

                                    item.appendChild(condition);
                                    item.appendChild(cssText);
                                    mqList.appendChild(item);
                                }
                            } catch (e) { }
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("Error reading stylesheets", err);
        }

        if (!found) {
            mqList.innerHTML = '<div style="color:var(--text-muted); font-size:11px;">No active media queries found for this element.</div>';
        }
    }

    // Format rgb/rgba to hex for color pickers
    function rgbToHex(rgb) {
        if (!rgb || rgb === 'rgba(0, 0, 0, 0)' || rgb === 'transparent') return '#000000';
        if (rgb.startsWith('#')) return rgb;
        const match = rgb.match(/^rgba?[\s+]?\([\s+]?(\d+)[\s+]?,[\s+]?(\d+)[\s+]?,[\s+]?(\d+)[\s+]?/i);
        return (match && match.length === 4) ? "#" +
            ("0" + parseInt(match[1], 10).toString(16)).slice(-2) +
            ("0" + parseInt(match[2], 10).toString(16)).slice(-2) +
            ("0" + parseInt(match[3], 10).toString(16)).slice(-2) : rgb;
    }

    function populateVisualEditor(el) {
        const styles = window.getComputedStyle(el);

        const inputs = shadow.querySelectorAll('.control-input');
        inputs.forEach(input => {
            const prop = input.getAttribute('data-prop');
            if (prop) {
                input.value = styles[prop] || '';
                input.oninput = (e) => {
                    // Update either shorthand like style.fontSize or style.setProperty('font-size')
                    const hyphenated = prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase());

                    if (!e.target.value) {
                        el.style.removeProperty(hyphenated);
                    } else {
                        el.style.setProperty(hyphenated, e.target.value);
                    }

                    populateCodeEditor(el);
                };
            }
        });

        // Color & Background Pickers
        const colorPicker = shadow.getElementById('color-picker');
        const colorText = shadow.getElementById('color-text');
        const txtColor = styles.color;
        colorText.value = txtColor;
        colorPicker.value = rgbToHex(txtColor);

        const updateColor = (val) => {
            el.style.color = val;
            colorText.value = val;
            colorPicker.value = rgbToHex(val);
            populateCodeEditor(el);
        };
        colorPicker.oninput = (e) => updateColor(e.target.value);
        colorText.oninput = (e) => updateColor(e.target.value);


        const bgPicker = shadow.getElementById('bg-picker');
        const bgText = shadow.getElementById('bg-text');
        const bgColor = styles.backgroundColor;
        bgText.value = bgColor;
        bgPicker.value = rgbToHex(bgColor);

        const updateBg = (val) => {
            el.style.backgroundColor = val;
            bgText.value = val;
            bgPicker.value = rgbToHex(val);
            populateCodeEditor(el);
        };
        bgPicker.oninput = (e) => updateBg(e.target.value);
        bgText.oninput = (e) => updateBg(e.target.value);
    }

    function populateCodeEditor(el) {
        const htmlEditor = shadow.getElementById('html-editor');
        const cssEditor = shadow.getElementById('css-editor');

        if (document.activeElement !== htmlEditor) {
            htmlEditor.value = highlightHtml(el.outerHTML);
        }
        if (document.activeElement !== cssEditor) {
            cssEditor.value = el.getAttribute('style') ? el.getAttribute('style').split(';').join(';\\n').trim() : '';
        }

        htmlEditor.oninput = (e) => {
            try {
                const temp = document.createElement('div');
                temp.innerHTML = e.target.value;
                const newEl = temp.firstElementChild;
                if (newEl) {
                    el.replaceWith(newEl);
                    window.CodexSelectedElement = newEl;
                    el = newEl;
                    populateVisualEditor(el);
                }
            } catch (err) { }
        };

        cssEditor.oninput = (e) => {
            el.setAttribute('style', e.target.value.replace(/\\n/g, ' '));
            populateVisualEditor(el);
        };
    }

    // Very basic regex-based syntax formatter for textarea
    function highlightHtml(html) {
        let formatted = '', indent = '';
        html.split(/>\s*</).forEach(function (node) {
            if (node.match(/^\/\w/)) indent = indent.substring(2);
            formatted += indent + '<' + node + '>\r\n';
            if (node.match(/^<?\w[^>]*[^\/]$/)) indent += '  ';
        });
        return formatted.substring(1, formatted.length - 3);
    }

    // Tabs logic
    const tabs = shadow.querySelectorAll('.tab');
    const contents = shadow.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            shadow.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // Close logic
    shadow.getElementById('close-panel').addEventListener('click', () => {
        panel.style.display = 'none';
        if (window.CodexSelectedElement) {
            window.CodexSelectedElement.style.outline = '';
            window.CodexSelectedElement = null;
        }
        if (window.CodexLastHighlight) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }
    });

    // Prevent background scrolling when interacting with the panel
    panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('scroll', (e) => e.stopPropagation(), { passive: true });

    // Panel Drag Logic
    const panelHeader = shadow.querySelector('.header');
    let isDraggingPanel = false;
    let panelDragStartX, panelDragStartY, panelStartLeft, panelStartTop;

    panelHeader.addEventListener('mousedown', (e) => {
        if (e.target.closest('.close-btn')) return; // Don't drag if clicking close button
        isDraggingPanel = true;
        panelDragStartX = e.clientX;
        panelDragStartY = e.clientY;

        const rect = panel.getBoundingClientRect();
        panelStartLeft = rect.left;
        panelStartTop = rect.top;

        // Convert panel to absolute positioning for dragging if it was fixed
        if (getComputedStyle(panel).position === 'fixed') {
            panel.style.right = 'auto'; // clear right tracking
            panel.style.left = panelStartLeft + 'px';
            panel.style.top = panelStartTop + 'px';
        }

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingPanel) return;
        const dx = e.clientX - panelDragStartX;
        const dy = e.clientY - panelDragStartY;
        panel.style.left = (panelStartLeft + dx) + 'px';
        panel.style.top = (panelStartTop + dy) + 'px';
    }, true);

    document.addEventListener('mouseup', () => {
        isDraggingPanel = false;
    }, true);

    // Drag Logic
    let dragModeActive = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragStartLeft = 0;
    let dragStartTop = 0;

    const dragBtn = shadow.getElementById('drag-mode-btn');
    if (dragBtn) {
        dragBtn.addEventListener('click', () => {
            dragModeActive = !dragModeActive;
            dragBtn.textContent = dragModeActive ? "Disable Free Drag" : "Enable Free Drag";
            dragBtn.style.background = dragModeActive ? "var(--accent)" : "var(--bg-panel)";
            dragBtn.style.color = dragModeActive ? "#000" : "var(--accent)";

            if (dragModeActive) {
                document.body.classList.add('codex-drag-mode-active');
                injectHostStyle('.codex-drag-mode-active * { cursor: grab !important; } .codex-drag-mode-active *:active { cursor: grabbing !important; }');
            } else {
                document.body.classList.remove('codex-drag-mode-active');
            }

            if (dragModeActive && window.CodexSelectedElement) {
                const style = window.getComputedStyle(window.CodexSelectedElement);
                if (style.position === 'static') {
                    window.CodexSelectedElement.style.position = 'relative';
                    populateCodeEditor(window.CodexSelectedElement);
                    populateVisualEditor(window.CodexSelectedElement);
                }
            }
        });
    }

    function handleMouseDown(e) {
        if (!window.CodexVisualEditorActive || !dragModeActive || !window.CodexSelectedElement) return;

        const el = window.CodexSelectedElement;

        if (e.target === el || el.contains(e.target)) {
            e.preventDefault();
            isDragging = true;
            hasDragged = false;
            dragStartX = e.clientX;
            dragStartY = e.clientY;

            const style = window.getComputedStyle(el);
            if (style.position === 'static') {
                el.style.position = 'relative';
            }

            dragStartLeft = parseFloat(style.left) || 0;
            dragStartTop = parseFloat(style.top) || 0;
        }
    }

    function handleMouseMove(e) {
        if (!isDragging || !window.CodexSelectedElement) return;

        hasDragged = true;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;

        window.CodexSelectedElement.style.setProperty('left', (dragStartLeft + dx) + 'px', 'important');
        window.CodexSelectedElement.style.setProperty('top', (dragStartTop + dy) + 'px', 'important');
    }

    function handleMouseUp(e) {
        if (isDragging) {
            isDragging = false;
            if (window.CodexSelectedElement && hasDragged) {
                populateCodeEditor(window.CodexSelectedElement);
                populateVisualEditor(window.CodexSelectedElement);
            }
            setTimeout(() => { hasDragged = false; }, 0);
        }
    }

    // CodePen Export logic
    shadow.getElementById('export-btn').addEventListener('click', () => {
        if (!window.CodexSelectedElement) return;
        const el = window.CodexSelectedElement;

        const data = {
            title: "Codex Export",
            description: "Exported from Codex Dev Visual Editor",
            html: el.outerHTML,
            css: `body { \n  background: #f7fafc; \n  display: flex; \n  justify-content: center; \n  align-items: center; \n  min-height: 100vh; \n}`,
            editors: "110"
        };

        const JSONstring = JSON.stringify(data).replace(/"/g, "&quot;").replace(/'/g, "&apos;");

        const form = document.createElement('form');
        form.action = 'https://codepen.io/pen/define';
        form.method = 'POST';
        form.target = '_blank';
        form.style.display = 'none';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'data';
        input.value = JSONstring;

        form.appendChild(input);
        document.body.appendChild(form);
        form.submit();
        form.remove();

        showToast('Exporting to CodePen...');
    });

    // State Pseudo Toggles
    const pseudoToggles = shadow.querySelectorAll('.pseudo-toggle');
    pseudoToggles.forEach(toggle => {
        toggle.addEventListener('click', () => {
            toggle.classList.toggle('active');
            // Advanced Pseudo Class forcing requires injecting stylesheet to override.
            // Simplified here: we would add a tracking class like codex-force-hover
            // Since that requires stylesheet injection on the host, we'll mock the state.
            const state = toggle.dataset.state;
            const el = window.CodexSelectedElement;
            if (!el) return;

            const forceClass = `codex-force${state.replace(':', '-')}`;
            if (toggle.classList.contains('active')) {
                el.classList.add(forceClass);
                injectHostStyle(`.${forceClass} { ${state === ':hover' ? 'filter: brightness(0.9);' : ''} }`);
            } else {
                el.classList.remove(forceClass);
            }
        });
    });

    // Inject styles into host to force pseudo classes
    function injectHostStyle(cssRule) {
        let styleEl = document.getElementById('codex-injected-styles');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'codex-injected-styles';
            document.head.appendChild(styleEl);
        }
        if (!styleEl.innerHTML.includes(cssRule)) {
            styleEl.innerHTML += `\n${cssRule}`;
        }
    }


    function showToast(msg) {
        const existing = document.getElementById('codex-toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.id = 'codex-toast';
        toast.textContent = msg;
        Object.assign(toast.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: '#4FD1C5',
            color: '#1a202c',
            padding: '10px 20px',
            borderRadius: '8px',
            zIndex: '2147483647',
            fontFamily: 'system-ui, sans-serif',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(79, 209, 197, 0.3)',
            transition: 'all 0.3s ease',
            opacity: '0',
            transform: 'translateY(-10px)'
        });
        document.body.appendChild(toast);

        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateY(0)';
        });

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-10px)';
            setTimeout(() => toast.remove(), 300);
        }, 2000);
    }

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('mousedown', handleMouseDown, true);
    document.addEventListener('mousemove', handleMouseMove, true);
    document.addEventListener('mouseup', handleMouseUp, true);
    document.addEventListener('click', handleClick, true);

    let lastEscPress = 0;

    // Deactivation logic encapsulated
    function deactivateEditor() {
        if (!window.CodexVisualEditorActive) return;
        window.CodexVisualEditorActive = false;

        // Hide panel but keep listeners alive (they check CodexVisualEditorActive)
        const panel = shadow.querySelector('.editor-panel');
        if (panel) panel.style.display = 'none';

        if (window.CodexLastHighlight) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }

        if (window.CodexSelectedElement) {
            window.CodexSelectedElement.style.outline = '';
            window.CodexSelectedElement = null;
        }

        document.body.classList.remove('codex-drag-mode-active');
        showToast('Visual Editor: Paused (Press ESC x2 to re-enable)');
    }

    // Activation logic encapsulated
    function activateEditor() {
        if (window.CodexVisualEditorActive) return;
        window.CodexVisualEditorActive = true;
        window.CodexSelectedElement = null;

        if (window.CodexLastHighlight) {
            window.CodexLastHighlight.style.outline = '';
            window.CodexLastHighlight = null;
        }

        showToast('Visual Editor: Active. Click an element to edit.');
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const now = Date.now();
            if (window.CodexVisualEditorActive) {
                // Single ESC to close
                deactivateEditor();
                lastEscPress = now;
            } else {
                // Double ESC check when already closed
                if (now - lastEscPress < 500) {
                    activateEditor(); // Inform user to click icon due to injection limits
                }
                lastEscPress = now;
            }
        }
    }, true);

})();
