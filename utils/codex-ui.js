// Shared UI primitives for every injected Codex Dev panel — one design-token
// set, one toast implementation, one icon set — instead of each tool
// reinventing its own (which had drifted: different --bg values, different
// toast easing/fonts across capture.js/feedback.js/seo-tools.js, etc).
//
// Loaded by popup.js before any tool script, guarded so re-injection is a
// no-op: `if (window.CodexUI) return;`
(function () {
    if (window.CodexUI) return;

    // ── Design tokens ──────────────────────────────────────────────────
    // Same values as tokens.css (used by popup.html/viewer.html, which are
    // real documents and can just <link> a stylesheet). Shadow-DOM panels
    // can't reach an external stylesheet's :root vars, so this string gets
    // injected directly into each panel's own <style> block instead.
    const TOKENS_CSS = `
        --cx-bg: #0e0f11;
        --cx-bg-alt: #121316;
        --cx-panel: #16171a;
        --cx-panel-alt: #1d1e22;
        --cx-hover: rgba(255,255,255,0.05);
        --cx-border: rgba(255,255,255,0.08);
        --cx-border-strong: rgba(255,255,255,0.14);
        --cx-text: #ececef;
        --cx-text-muted: #9b9ca4;
        --cx-text-faint: #6e7078;
        --cx-accent: #4fd1c5;
        --cx-accent-hover: #6adbd0;
        --cx-accent-text: #5fd8cc;
        --cx-accent-soft: rgba(79,209,197,0.12);
        --cx-accent-ring: rgba(79,209,197,0.35);
        --cx-on-accent: #07201d;
        --cx-purple: #4fd1c5;
        --cx-danger: #f07575;
        --cx-warning: #e8a64a;
        --cx-success: #5ccf8d;
        --cx-info: #6fb3ec;
        --cx-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 16px 40px -12px rgba(0,0,0,0.6);
        --cx-radius-sm: 6px;
        --cx-radius-md: 10px;
        --cx-radius-lg: 10px;
        --cx-radius-pill: 999px;
        --cx-space-1: 4px;
        --cx-space-2: 8px;
        --cx-space-3: 12px;
        --cx-space-4: 16px;
        --cx-space-6: 24px;
        --cx-ease: cubic-bezier(0.16, 1, 0.3, 1);
        --cx-font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI Variable Text', 'Segoe UI', system-ui, sans-serif;
        --cx-font-mono: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace;
    `;

    // A single .btn / .badge primitive every panel can extend, so buttons
    // don't get re-coded per-file (.preset-btn vs .control-btn vs ad hoc
    // inline styles all drifting independently).
    const COMPONENTS_CSS = `
        .cx-icon { flex-shrink: 0; display: inline-block; vertical-align: middle; }
        .cx-btn {
            font-family: var(--cx-font);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            background: var(--cx-accent);
            color: var(--cx-on-accent);
            border: 1px solid transparent;
            padding: 7px 14px;
            border-radius: var(--cx-radius-sm);
            cursor: pointer;
            font-weight: 600;
            font-size: 12px;
            transition: background 0.15s ease, transform 0.1s ease;
        }
        .cx-btn:hover { background: var(--cx-accent-hover); }
        .cx-btn:active { transform: scale(0.97); }
        .cx-btn.cx-btn-ghost {
            background: transparent;
            color: var(--cx-text);
            border-color: var(--cx-border-strong);
        }
        .cx-btn.cx-btn-ghost:hover { background: var(--cx-hover); }
        .cx-btn.cx-btn-danger { background: transparent; color: var(--cx-danger); border-color: rgba(240,117,117,0.35); }
        .cx-btn.cx-btn-danger:hover { background: rgba(240,117,117,0.1); }
        .cx-badge {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 1px 7px;
            border-radius: var(--cx-radius-pill);
            font-size: 10.5px;
            font-weight: 600;
            background: var(--cx-accent-soft);
            color: var(--cx-accent-text);
        }
    `;

    /**
     * Injects the shared tokens + component CSS into a shadow root (or any
     * node accepting appendChild(<style>)). Call once per panel, before
     * building the rest of that panel's own <style> block.
     */
    function injectTokens(root) {
        const style = document.createElement('style');
        style.textContent = `:host, :root { ${TOKENS_CSS} }\n${COMPONENTS_CSS}`;
        root.appendChild(style);
        return style;
    }

    // ── Toast ───────────────────────────────────────────────────────────
    // One implementation, reused id so repeated calls replace rather than
    // stack — replaces the 3+ independent toast()/_toast()/showToast()
    // copies that had drifted in font/easing across files.
    let toastTimer = null;
    function toast(msg, duration) {
        duration = duration || 2400;
        let el = document.getElementById('__codex_ui_toast');
        if (!el) {
            el = document.createElement('div');
            el.id = '__codex_ui_toast';
            Object.assign(el.style, {
                position: 'fixed',
                bottom: '28px',
                left: '50%',
                transform: 'translateX(-50%) translateY(14px)',
                background: '#16171a',
                color: '#ececef',
                border: '1px solid rgba(255,255,255,0.12)',
                padding: '9px 16px',
                borderRadius: '10px',
                zIndex: '2147483647',
                fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
                fontSize: '13px',
                fontWeight: '500',
                boxShadow: '0 16px 40px -12px rgba(0,0,0,0.55)',
                transition: 'opacity 0.3s cubic-bezier(0.16,1,0.3,1), transform 0.3s cubic-bezier(0.16,1,0.3,1)',
                opacity: '0',
                pointerEvents: 'none'
            });
            document.body.appendChild(el);
        }
        el.textContent = msg;
        clearTimeout(toastTimer);
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateX(-50%) translateY(0)';
        });
        toastTimer = setTimeout(() => {
            el.style.opacity = '0';
            el.style.transform = 'translateX(-50%) translateY(14px)';
        }, duration);
    }

    // ── Icons ───────────────────────────────────────────────────────────
    // Delegates to the shared Tabler line set in utils/icons.js (injected
    // alongside this file). Legacy names used by the panels map onto it.
    const ALIASES = {
        idea: 'bulb', question: 'help-circle', info: 'info-circle', pin: 'map-pin',
        image: 'photo', doc: 'file-text', close: 'x', layers: 'layers-subtract', move: 'arrows-move'
    };
    function icon(name, size) {
        size = size || 14;
        if (!window.CodexIcons) return '';
        return window.CodexIcons.svg(ALIASES[name] || name, size);
    }

    window.CodexUI = { tokens: TOKENS_CSS, injectTokens, toast, icon };
})();
