(function () {
    'use strict';

    // ─── Schema Templates ─────────────────────────────────────────────
    var schemaTemplates = {
        Article: `{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "Your Article Headline",\n  "image": ["https://example.com/image.jpg"],\n  "author": { "@type": "Person", "name": "Author Name" },\n  "publisher": { "@type": "Organization", "name": "Publisher", "logo": { "@type": "ImageObject", "url": "https://example.com/logo.png" } },\n  "datePublished": "2024-01-01",\n  "description": "Short description."\n}`,
        Product:  `{\n  "@context": "https://schema.org",\n  "@type": "Product",\n  "name": "Product Name",\n  "image": ["https://example.com/product.jpg"],\n  "description": "Product description.",\n  "offers": { "@type": "Offer", "priceCurrency": "USD", "price": "9.99", "availability": "https://schema.org/InStock" },\n  "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": "89" }\n}`,
        FAQ:      `{\n  "@context": "https://schema.org",\n  "@type": "FAQPage",\n  "mainEntity": [\n    { "@type": "Question", "name": "Your question?", "acceptedAnswer": { "@type": "Answer", "text": "Answer here." } }\n  ]\n}`,
        Event:    `{\n  "@context": "https://schema.org",\n  "@type": "Event",\n  "name": "Event Name",\n  "startDate": "2024-08-15T19:00",\n  "location": { "@type": "Place", "name": "Venue", "address": { "@type": "PostalAddress", "addressLocality": "City", "addressCountry": "US" } }\n}`,
        Org:      `{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Org Name",\n  "url": "https://example.com",\n  "logo": "https://example.com/logo.png",\n  "sameAs": ["https://twitter.com/handle"]\n}`
    };

    // ─── Toast ────────────────────────────────────────────────────────
    function toast(msg, dur) {
        if (window.CodexUI) { window.CodexUI.toast(msg, dur); return; }
        dur = dur || 2800;
        try {
            var old = document.getElementById('_cxst');
            if (old) old.remove();
            var el = document.createElement('div');
            el.id = '_cxst';
            el.textContent = msg;
            Object.assign(el.style, {
                position: 'fixed', bottom: '28px', left: '50%',
                transform: 'translateX(-50%) translateY(14px)',
                background: '#16171a', border: '1px solid rgba(255,255,255,0.12)',
                color: '#ececef', padding: '9px 16px', borderRadius: '10px',
                zIndex: '2147483647', fontFamily: 'system-ui,sans-serif',
                fontSize: '13px', fontWeight: '500',
                boxShadow: '0 16px 40px -12px rgba(0,0,0,0.55)',
                transition: 'all 0.3s cubic-bezier(0.175,0.885,0.32,1.275)',
                opacity: '0', pointerEvents: 'none'
            });
            document.body.appendChild(el);
            requestAnimationFrame(function () {
                el.style.opacity = '1';
                el.style.transform = 'translateX(-50%) translateY(0)';
            });
            if (window._cxt) clearTimeout(window._cxt);
            window._cxt = setTimeout(function () {
                el.style.opacity = '0';
                el.style.transform = 'translateX(-50%) translateY(14px)';
                setTimeout(function () { if (el.parentNode) el.remove(); }, 320);
            }, dur);
        } catch (e) { }
    }

    // ─── Toggle ───────────────────────────────────────────────────────
    try {
        var HID = 'codex-seo-v3';
        // Toggle off only when the panel is really there (a page re-render
        // may have removed it, in which case open a fresh one)
        var oh = document.getElementById(HID);
        if (oh) {
            window.__cxSeo = false;
            oh.remove();
            if (window.__cxSeoDragMove) {
                document.removeEventListener('mousemove', window.__cxSeoDragMove, true);
                document.removeEventListener('mouseup', window.__cxSeoDragUp, true);
                window.__cxSeoDragMove = null;
                window.__cxSeoDragUp = null;
            }
            toast('SEO Tools: OFF');
            return;
        }
        window.__cxSeo = true;

        // ─── Shadow DOM ───────────────────────────────────────────────
        var host = document.createElement('div');
        host.id = HID;
        Object.assign(host.style, { position: 'fixed', left: '0', top: '0', width: '0', height: '0', zIndex: '2147483647' });
        document.body.appendChild(host);
        var shadow = host.attachShadow({ mode: 'open' });
        function ic(name, size) { return window.CodexUI ? window.CodexUI.icon(name, size || 14) : ''; }
        var STATUS_ICON = { fail: 'circle-x', warn: 'alert-triangle', pass: 'circle-check' };


        // ─── CSS ──────────────────────────────────────────────────────
        var style = document.createElement('style');
        style.textContent = `
        :host {
            --bg: #121316; --card: #16171a; --card-2: #1d1e22; --hover: rgba(255,255,255,0.05);
            --border: rgba(255,255,255,0.08); --border-strong: rgba(255,255,255,0.14);
            --text: #ececef; --muted: #9b9ca4; --faint: #6e7078;
            --accent: #4fd1c5; --accent-text: #5fd8cc; --accent-soft: rgba(79,209,197,0.12); --on-accent: #07201d;
            --green: #5ccf8d; --orange: #e8a64a; --red: #f07575; --blue: #6fb3ec;
            --mono: 'SF Mono', 'JetBrains Mono', ui-monospace, Menlo, monospace;
            --ease: cubic-bezier(0.16, 1, 0.3, 1);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            color: var(--text); font-size: 13px; box-sizing: border-box; -webkit-font-smoothing: antialiased;
        }
        :host * { box-sizing: border-box; }
        .cx-icon { flex-shrink: 0; display: inline-block; vertical-align: middle; }
        button { font-family: inherit; }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        .panel {
            position: fixed; top: 12px; right: 12px;
            width: 440px; height: calc(100vh - 24px);
            background: var(--bg);
            border: 1px solid var(--border-strong); border-radius: 10px;
            box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -16px rgba(0,0,0,0.7);
            display: flex; flex-direction: column; overflow: hidden; z-index: 10000;
            animation: panelIn 0.35s var(--ease);
        }
        @keyframes panelIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }

        /* Header */
        .hdr {
            display: flex; justify-content: space-between; align-items: center;
            height: 48px; padding: 0 10px 0 14px;
            border-bottom: 1px solid var(--border); cursor: move; flex-shrink: 0; user-select: none;
        }
        .hdr-title { font-weight: 650; font-size: 13.5px; display: flex; align-items: center; gap: 8px; }
        .hdr-title .cx-icon { color: var(--accent-text); }
        .close-btn {
            width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
            background: none; border: 1px solid var(--border); border-radius: 6px;
            color: var(--muted); cursor: pointer; transition: color 0.15s, background 0.15s;
        }
        .close-btn:hover { color: var(--text); background: var(--hover); }

        /* Tabs */
        .tabs {
            display: flex; gap: 2px; padding: 0 8px;
            border-bottom: 1px solid var(--border);
            overflow-x: auto; flex-shrink: 0; scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar { display: none; }
        .tab {
            padding: 10px 10px 9px; cursor: pointer; color: var(--muted);
            border-bottom: 2px solid transparent; font-weight: 550; font-size: 12px;
            white-space: nowrap; transition: color 0.15s, border-color 0.15s; flex-shrink: 0;
        }
        .tab:hover { color: var(--text); }
        .tab.active { color: var(--text); border-bottom-color: var(--accent); }

        /* Content panes */
        .pane {
            display: none; flex: 1; overflow-y: auto; padding: 16px;
            min-height: 0; overscroll-behavior: contain;
            scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent;
        }
        .pane::-webkit-scrollbar { width: 6px; }
        .pane::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
        .pane.active { display: block; }

        /* Section header */
        .sec { font-size: 12px; font-weight: 600; color: var(--text); margin: 20px 0 8px;
            display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .sec:first-child { margin-top: 0; }
        .sec-sub { font-size: 11.5px; font-weight: 400; color: var(--muted); }

        /* Audit summary */
        .summary-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
        .summary-card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
        .summary-num { font-family: var(--mono); font-size: 20px; font-weight: 600; line-height: 1.1; }
        .summary-lbl { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); margin-top: 4px; }
        .s-fail .summary-num, .s-fail .cx-icon { color: var(--red); }
        .s-warn .summary-num, .s-warn .cx-icon { color: var(--orange); }
        .s-pass .summary-num, .s-pass .cx-icon { color: var(--green); }

        /* Score ring */
        .score-section { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; }
        .score-ring { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
        .score-ring svg { overflow: visible; width: 64px; height: 64px; }
        .ring-bg { fill: none; stroke: var(--border-strong); stroke-width: 5; }
        .ring-fg { fill: none; stroke-width: 5; stroke-linecap: round;
            transform: rotate(-90deg); transform-origin: 50% 50%;
            transition: stroke-dashoffset 1.2s var(--ease), stroke 0.3s; }
        .ring-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
            font-family: var(--mono); font-size: 17px; font-weight: 600; color: var(--text); }
        .score-info { flex: 1; min-width: 0; }
        .score-title { font-size: 14px; font-weight: 650; margin-bottom: 2px; }
        .score-desc { font-size: 12px; color: var(--muted); line-height: 1.5; }
        .score-grade { display: inline-block; font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 999px; margin-top: 6px; }
        .score-grade:empty { display: none; }

        /* Audit issues */
        .audit-group { margin-bottom: 6px; }
        .audit-issue {
            display: flex; align-items: flex-start; gap: 10px;
            padding: 11px 12px; margin-bottom: 6px;
            background: var(--card); border: 1px solid var(--border); border-radius: 10px;
            transition: border-color 0.15s;
        }
        .audit-issue:hover { border-color: var(--border-strong); }
        .audit-icon { display: flex; flex-shrink: 0; margin-top: 1px; }
        .audit-issue.fail .audit-icon { color: var(--red); }
        .audit-issue.warn .audit-icon { color: var(--orange); }
        .audit-issue.pass .audit-icon { color: var(--green); }
        .audit-body { flex: 1; min-width: 0; }
        .audit-title { font-weight: 600; font-size: 12.5px; margin-bottom: 2px; }
        .audit-desc { font-size: 12px; color: var(--muted); line-height: 1.55; }
        .audit-fix {
            display: flex; align-items: flex-start; gap: 6px;
            margin-top: 8px; font-size: 11.5px; line-height: 1.5; color: var(--text);
        }
        .audit-fix .cx-icon { color: var(--accent-text); margin-top: 1px; }
        .audit-show {
            display: inline-flex; align-items: center; gap: 5px; margin-top: 8px;
            background: transparent; border: 1px solid var(--border-strong); border-radius: 6px;
            color: var(--accent-text); font: inherit; font-size: 11.5px; font-weight: 600;
            padding: 3px 9px; cursor: pointer;
        }
        .audit-show:hover { background: var(--hover); }
        .audit-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
        .audit-value {
            display: block; margin-top: 8px; padding: 6px 8px;
            font-family: var(--mono); font-size: 11px; line-height: 1.5;
            background: var(--card-2); border: 1px solid var(--border); border-radius: 6px;
            color: var(--text); word-break: break-all; white-space: pre-wrap;
        }
        .audit-badge {
            display: inline-flex; align-items: center; gap: 4px; font-size: 10.5px; font-weight: 600;
            padding: 1px 7px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; margin-top: 2px;
        }
        .ab-fail { background: rgba(240,117,117,0.12); color: var(--red); }
        .ab-warn { background: rgba(232,166,74,0.12); color: var(--orange); }
        .ab-pass { background: rgba(92,207,141,0.12); color: var(--green); }
        .ab-info { background: rgba(111,179,236,0.12); color: var(--blue); }

        /* Filter bar */
        .filter-bar { display: flex; gap: 2px; padding: 3px; margin-bottom: 12px;
            background: var(--card-2); border: 1px solid var(--border); border-radius: 10px; }
        .filter-btn {
            flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
            background: none; border: none; border-radius: 7px;
            color: var(--muted); padding: 6px 8px; font-size: 12px; font-weight: 550;
            cursor: pointer; white-space: nowrap; transition: color 0.15s, background 0.15s;
        }
        .filter-btn:hover { color: var(--text); }
        .filter-btn.active { background: var(--card); color: var(--text); box-shadow: 0 0 0 1px var(--border-strong); }
        .filter-btn.f-fail .cx-icon { color: var(--red); }
        .filter-btn.f-warn .cx-icon { color: var(--orange); }
        .filter-btn.f-pass .cx-icon { color: var(--green); }

        /* SERP preview (mimics Google, stays light) */
        .serp { background: #fff; font-family: arial, sans-serif; padding: 14px 16px; border-radius: 10px; margin-bottom: 8px; }
        .serp-dom { display: flex; align-items: center; gap: 6px; color: #202124; font-size: 12px; margin-bottom: 3px; }
        .serp-fav { width: 18px; height: 18px; border-radius: 50%; background: #f1f3f4; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #555; flex-shrink: 0; }
        .serp-domtxt { color: #202124; font-size: 13px; }
        .serp-title { color: #1a0dab; font-size: 19px; line-height: 1.3; margin-bottom: 3px; font-weight: 400; }
        .serp-desc { color: #4d5156; font-size: 13.5px; line-height: 1.58; word-wrap: break-word; }
        .serp-clip { display: flex; align-items: center; gap: 5px; color: #c93c3c; font-size: 11.5px; margin-top: 6px; font-family: -apple-system, system-ui, sans-serif; }

        /* Meta form */
        .mform { display: flex; flex-direction: column; gap: 12px; }
        .fg { display: flex; flex-direction: column; gap: 6px; }
        .fg-row { display: flex; justify-content: space-between; align-items: center; }
        .flbl { font-size: 12px; font-weight: 500; color: var(--muted); }
        .fctr { font-family: var(--mono); font-size: 11px; color: var(--muted); }
        .finp { background: var(--card); border: 1px solid var(--border-strong); border-radius: 6px;
            padding: 8px 10px; color: var(--text); font-family: inherit; font-size: 12.5px;
            outline: none; transition: border-color 0.15s, box-shadow 0.15s; width: 100%; }
        .finp:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(79,209,197,0.3); }
        .finp::placeholder { color: var(--muted); opacity: 0.7; }
        textarea.finp { resize: vertical; min-height: 64px; }

        /* Meta rows */
        .mrow { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; margin-bottom: 6px; }
        .mrow-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 8px; }
        .mrow-name { font-weight: 600; font-size: 12px; }
        .mrow-val { font-family: var(--mono); font-size: 11px; line-height: 1.5;
            background: var(--card-2); padding: 6px 8px; border-radius: 6px;
            border: 1px solid var(--border); word-break: break-all; white-space: pre-wrap; color: var(--text); }
        .mrow-val.miss { color: var(--muted); font-style: italic; }

        /* Schema */
        .stabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 10px; scrollbar-width: none; }
        .stabs::-webkit-scrollbar { display: none; }
        .stab { background: none; border: 1px solid var(--border); border-radius: 999px; color: var(--muted); padding: 4px 11px; font-size: 12px; font-weight: 550; cursor: pointer; white-space: nowrap; transition: color 0.15s, border-color 0.15s, background 0.15s; flex-shrink: 0; }
        .stab:hover { color: var(--text); }
        .stab.active { background: var(--accent-soft); color: var(--accent-text); border-color: transparent; }
        .cpybtn { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 10px; background: var(--accent); color: var(--on-accent); border: none; padding: 7px 12px; border-radius: 6px; font-weight: 600; font-size: 12px; cursor: pointer; transition: background 0.15s, transform 0.1s; }
        .cpybtn:hover { background: #6adbd0; }
        .cpybtn:active { transform: scale(0.97); }
        .jscode { font-family: var(--mono); background: var(--card-2); border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 11px; color: var(--text); white-space: pre; overflow-x: auto; max-height: 280px; line-height: 1.6; }

        /* Headings */
        .hstats { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
        .hschip { display: flex; align-items: center; gap: 5px; background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px; font-size: 11.5px; }
        .hschip.is-bad { color: var(--red); border-color: rgba(240,117,117,0.35); }
        .hchip-n { font-family: var(--mono); font-weight: 600; }
        .hdrs { display: flex; flex-direction: column; gap: 2px; }
        .hitem { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; transition: background 0.15s; }
        .hitem:hover { background: var(--hover); }
        .htag { font-family: var(--mono); font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 4px; flex-shrink: 0; background: var(--card-2); color: var(--muted); border: 1px solid var(--border); }
        .h1t { color: var(--accent-text); border-color: rgba(79,209,197,0.35); }
        .htxt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 12px; min-width: 0; }
        .hwarn { font-size: 10.5px; font-weight: 600; padding: 1px 6px; border-radius: 999px; flex-shrink: 0; }
        .hw-d { background: rgba(240,117,117,0.12); color: var(--red); }
        .hw-e { background: rgba(232,166,74,0.12); color: var(--orange); }
        .hw-s { background: rgba(111,179,236,0.12); color: var(--blue); }

        /* Images / Links */
        .stat3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 12px; }
        .scard { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; }
        .sval { font-family: var(--mono); font-size: 18px; font-weight: 600; }
        .slbl { font-size: 11.5px; color: var(--muted); margin-top: 2px; }
        .ilist, .llist { display: flex; flex-direction: column; gap: 6px; }
        .icard { display: flex; gap: 10px; padding: 8px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; cursor: pointer; transition: border-color 0.15s; }
        .icard:hover { border-color: var(--border-strong); }
        .ithumb { width: 52px; height: 52px; border-radius: 6px; background: repeating-conic-gradient(#202125 0% 25%,#18191c 0% 50%) 0 0/8px 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--border); flex-shrink: 0; }
        .ithumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .idet { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .isrc { font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .imeta { font-size: 11px; color: var(--muted); }
        .lcard { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
        .linfo { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .lurl { display: block; font-size: 12px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
        .lurl:hover { text-decoration: underline; color: var(--accent-text); }
        .lmeta { display: flex; align-items: center; gap: 6px; }
        .ltag { font-size: 10.5px; font-weight: 500; color: var(--muted); }
        .ltag.ext { color: var(--orange); } .ltag.nf { color: var(--red); }
        .lshow { display: inline-flex; align-items: center; padding: 1px 3px; background: none; border: none; color: var(--muted); cursor: pointer; border-radius: 4px; }
        .lshow:hover { color: var(--accent-text); background: var(--hover); }
        .lstat { font-family: var(--mono); font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 999px; white-space: nowrap; flex-shrink: 0; }
        .ls-p { background: var(--card-2); color: var(--muted); }
        .ls-g { background: rgba(92,207,141,0.12); color: var(--green); }
        .ls-o { background: rgba(232,166,74,0.12); color: var(--orange); }
        .ls-r { background: rgba(240,117,117,0.12); color: var(--red); }

        .scrollbox { max-height: 260px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border-strong) transparent; }
        .scrollbox::-webkit-scrollbar { width: 6px; } .scrollbox::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 999px; }
        .chkbtn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-bottom: 12px; background: var(--accent); color: var(--on-accent); border: none; padding: 8px 14px; border-radius: 6px; font-weight: 600; font-size: 12.5px; cursor: pointer; transition: background 0.15s, transform 0.1s; }
        .chkbtn:hover { background: #6adbd0; } .chkbtn:active { transform: scale(0.98); }
        .chkbtn:disabled { opacity: 0.5; cursor: not-allowed; }
        .rfbtn { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--border); color: var(--muted); border-radius: 6px; padding: 3px 8px; font-size: 11.5px; font-weight: 500; cursor: pointer; transition: color 0.15s, background 0.15s; }
        .rfbtn:hover { color: var(--text); background: var(--hover); }
        .empty { color: var(--muted); text-align: center; padding: 24px 12px; font-size: 12.5px; line-height: 1.6; }
        `;
        shadow.appendChild(style);

        // ─── HTML ─────────────────────────────────────────────────────
        var panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
        <div class="hdr" id="dh">
            <div class="hdr-title">${ic('world-search', 16)}Codex SEO Audit</div>
            <button class="close-btn" id="btn-cls" aria-label="Close">${ic('x', 16)}</button>
        </div>
        <div class="tabs">
            <div class="tab active" data-t="audit">Audit</div>
            <div class="tab" data-t="meta">Meta</div>
            <div class="tab" data-t="schema">Schema</div>
            <div class="tab" data-t="headers">Headers</div>
            <div class="tab" data-t="images">Images</div>
            <div class="tab" data-t="links">Links</div>
        </div>

        <!-- Audit Tab -->
        <div class="pane active" id="t-audit">
            <div class="score-section">
                <div class="score-ring">
                    <svg width="72" height="72" viewBox="0 0 72 72">
                        <circle class="ring-bg" cx="36" cy="36" r="30"/>
                        <circle class="ring-fg" id="ring" cx="36" cy="36" r="30" stroke-dasharray="188.5" stroke-dashoffset="188.5"/>
                    </svg>
                    <div class="ring-text" id="ring-score">–</div>
                </div>
                <div class="score-info">
                    <div class="score-title" id="score-title">Analysing page…</div>
                    <div class="score-desc" id="score-desc">Running SEO checks on this page</div>
                    <span class="score-grade" id="score-grade"></span>
                </div>
            </div>

            <div class="summary-strip">
                <div class="summary-card s-fail"><div class="summary-num" id="cnt-fail">–</div><div class="summary-lbl">${ic(STATUS_ICON.fail, 13)}Errors</div></div>
                <div class="summary-card s-warn"><div class="summary-num" id="cnt-warn">–</div><div class="summary-lbl">${ic(STATUS_ICON.warn, 13)}Warnings</div></div>
                <div class="summary-card s-pass"><div class="summary-num" id="cnt-pass">–</div><div class="summary-lbl">${ic(STATUS_ICON.pass, 13)}Passed</div></div>
            </div>

            <div class="filter-bar">
                <button class="filter-btn active" data-f="all">All</button>
                <button class="filter-btn f-fail" data-f="fail">${ic(STATUS_ICON.fail, 13)}Errors</button>
                <button class="filter-btn f-warn" data-f="warn">${ic(STATUS_ICON.warn, 13)}Warnings</button>
                <button class="filter-btn f-pass" data-f="pass">${ic(STATUS_ICON.pass, 13)}Passed</button>
            </div>

            <div id="audit-issues"></div>
            <div class="audit-actions">
                <button class="rfbtn" id="btn-rerun">${ic('refresh', 13)}Re-run audit</button>
                <button class="rfbtn" id="btn-copy-report">${ic('copy', 13)}Copy report</button>
            </div>
        </div>

        <!-- Meta Tab -->
        <div class="pane" id="t-meta">
            <div class="sec">Live SERP Preview</div>
            <div class="serp">
                <div class="serp-dom"><div class="serp-fav" id="sf">G</div><div class="serp-domtxt" id="su"></div></div>
                <div class="serp-title" id="stitle">Page Title</div>
                <div class="serp-desc" id="sdesc">Meta description here.</div>
                <div class="serp-clip" id="sclip" style="display:none;">${ic('alert-triangle', 13)}May be truncated in search results</div>
            </div>
            <div class="sec">Edit &amp; Validate</div>
            <div class="mform">
                <div class="fg">
                    <div class="fg-row"><span class="flbl">Title Tag</span><span class="fctr" id="ct">0/60</span></div>
                    <input type="text" class="finp" id="it" placeholder="Page title…">
                </div>
                <div class="fg">
                    <div class="fg-row"><span class="flbl">Meta Description</span><span class="fctr" id="cd">0/160</span></div>
                    <textarea class="finp" id="id" placeholder="Page description…"></textarea>
                </div>
            </div>
            <div class="sec" style="margin-top:18px;">All Meta Tags</div>
            <div id="mlist"></div>
        </div>

        <!-- Schema Tab -->
        <div class="pane" id="t-schema">
            <div class="sec">Structured Data Found <span class="sec-sub" id="sc-cnt">0 schemas</span></div>
            <div id="sc-found" style="margin-bottom:18px;"></div>
            <div class="sec">Schema Generator</div>
            <div class="stabs">
                <button class="stab active" data-st="Article">Article</button>
                <button class="stab" data-st="Product">Product</button>
                <button class="stab" data-st="FAQ">FAQPage</button>
                <button class="stab" data-st="Event">Event</button>
                <button class="stab" data-st="Org">Organization</button>
            </div>
            <button class="cpybtn" id="btn-cp">${ic('copy', 14)}Copy Template</button>
            <div class="jscode" id="sc-code"></div>
        </div>

        <!-- Headers Tab -->
        <div class="pane" id="t-headers">
            <div class="sec">Heading Structure <button class="rfbtn" id="btn-rh">${ic('refresh', 13)}Refresh</button></div>
            <div class="hstats" id="hstats"></div>
            <div class="hdrs" id="hlist"></div>
        </div>

        <!-- Images Tab -->
        <div class="pane" id="t-images">
            <div class="sec">Images Audit</div>
            <div class="stat3">
                <div class="scard"><div class="sval" id="it2">0</div><div class="slbl">Total</div></div>
                <div class="scard"><div class="sval" id="ina" style="color:var(--red);">0</div><div class="slbl">No Alt</div></div>
                <div class="scard"><div class="sval" id="idec" style="color:var(--orange);">0</div><div class="slbl">Decorative</div></div>
            </div>
            <div class="scrollbox ilist" id="ilist"></div>
        </div>

        <!-- Links Tab -->
        <div class="pane" id="t-links">
            <div class="sec">Links Audit</div>
            <div class="stat3">
                <div class="scard"><div class="sval" id="li">0</div><div class="slbl">Internal</div></div>
                <div class="scard"><div class="sval" id="le" style="color:var(--orange);">0</div><div class="slbl">External</div></div>
                <div class="scard"><div class="sval" id="lb" style="color:var(--red);">0</div><div class="slbl">Broken</div></div>
            </div>
            <button class="chkbtn" id="btn-chk">${ic('link', 14)}Check HTTP Status of All Links</button>
            <div class="scrollbox llist" id="llist"></div>
        </div>
        `;
        shadow.appendChild(panel);

        // ─── Tab switching ─────────────────────────────────────────────
        shadow.querySelectorAll('.tab').forEach(function (tab) {
            tab.addEventListener('click', function () {
                shadow.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
                shadow.querySelectorAll('.pane').forEach(function (p) { p.classList.remove('active'); });
                tab.classList.add('active');
                var p = shadow.getElementById('t-' + tab.dataset.t);
                if (p) p.classList.add('active');
            });
        });
        shadow.getElementById('btn-cls').addEventListener('click', function () {
            window.__cxSeo = false;
            if (window.__cxSeoDragMove) {
                document.removeEventListener('mousemove', window.__cxSeoDragMove, true);
                document.removeEventListener('mouseup', window.__cxSeoDragUp, true);
                window.__cxSeoDragMove = null;
                window.__cxSeoDragUp = null;
            }
            host.remove();
        });

        // ─── Drag ─────────────────────────────────────────────────────
        var drg = false, dsx, dsy, psl, pst;
        shadow.getElementById('dh').addEventListener('mousedown', function (e) {
            if (e.target.closest('#btn-cls')) return;
            drg = true; dsx = e.clientX; dsy = e.clientY;
            var r = panel.getBoundingClientRect(); psl = r.left; pst = r.top;
            panel.style.right = 'auto'; panel.style.left = psl + 'px'; panel.style.top = pst + 'px';
            e.preventDefault();
        });
        if (window.__cxSeoDragMove) {
            document.removeEventListener('mousemove', window.__cxSeoDragMove, true);
            document.removeEventListener('mouseup', window.__cxSeoDragUp, true);
        }
        window.__cxSeoDragMove = function (e) { if (!drg) return; panel.style.left = (psl + e.clientX - dsx) + 'px'; panel.style.top = (pst + e.clientY - dsy) + 'px'; };
        window.__cxSeoDragUp = function () { drg = false; };
        document.addEventListener('mousemove', window.__cxSeoDragMove, true);
        document.addEventListener('mouseup', window.__cxSeoDragUp, true);
        panel.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });

        // ─── Helpers ─────────────────────────────────────────────────
        function esc(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }
        function ga(sel, attr) { var el = document.querySelector(sel); return (el && el.getAttribute(attr)) || ''; }
        function setCounter(id, n, min, max) {
            var el = shadow.getElementById(id); if (!el) return;
            el.textContent = n + '/' + max;
            el.style.color = (n >= min && n <= max) ? 'var(--green)' : (n > max ? 'var(--red)' : (n > 0 ? 'var(--orange)' : 'var(--muted)'));
        }

        // ═══════════════════════════════════════════════════════════════
        // FULL SEO AUDIT ENGINE
        // ═══════════════════════════════════════════════════════════════
        function runAudit() {
            var checks = [];

            // status: 'pass' | 'warn' | 'fail'. weight: how much the check
            // counts toward the score (3 = critical, 2 = important, 1 = normal).
            // extra.els: page elements the "Show" button points at.
            function check(status, category, title, desc, extra, weight) {
                checks.push({ status: status, category: category, title: title, desc: desc, extra: extra || null, weight: weight || 1 });
            }

            var here        = new URL(window.location.href);
            var title       = clean(document.title);
            var charset     = document.characterSet || '';
            var lang        = (document.documentElement.getAttribute('lang') || '').trim();
            var descEls     = metaAll('meta[name="description" i]');
            var desc        = descEls.length ? clean(descEls[0].getAttribute('content')) : '';
            var canonEls    = Array.from(document.querySelectorAll('link[rel~="canonical" i]'));
            var canonical   = canonEls.length ? (canonEls[0].getAttribute('href') || '').trim() : '';
            var robots      = robotsDirectives();
            var viewport    = ga('meta[name="viewport" i]', 'content');
            var ogTitle     = ga('meta[property="og:title"]', 'content');
            var ogDesc      = ga('meta[property="og:description"]', 'content');
            var ogImg       = ga('meta[property="og:image"]', 'content') || ga('meta[property="og:image:url"]', 'content');
            var ogUrl       = ga('meta[property="og:url"]', 'content');
            var ogType      = ga('meta[property="og:type"]', 'content');
            var twCard      = ga('meta[name="twitter:card"]', 'content');
            var twTitle     = ga('meta[name="twitter:title"]', 'content');
            var twImg       = ga('meta[name="twitter:image"]', 'content');
            var h1s         = Array.from(document.querySelectorAll('h1')).filter(isShown);
            var h2s         = Array.from(document.querySelectorAll('h2')).filter(isShown);
            var imgs        = Array.from(document.querySelectorAll('img')).filter(isShown);
            var favicon     = document.querySelector('link[rel~="icon" i], link[rel="shortcut icon" i], link[rel~="apple-touch-icon" i]');
            var isHttps     = here.protocol === 'https:';

            // ── CRITICAL SEO ───────────────────────────────────────────
            var titleCount = document.querySelectorAll('head title').length;
            if (!title) {
                check('fail', 'seo', 'Missing Title Tag', 'The page has no <title>. It is one of the most important on-page SEO factors and is the headline shown in search results.', { fix: 'Add <title>Your Page Title Here</title> inside the <head> tag.' }, 3);
            } else if (title.length < 30) {
                check('warn', 'seo', 'Title Too Short', 'Title is only ' + title.length + ' characters. Short titles may not fully describe your page to search engines.', { value: title, fix: 'Expand the title to 30–60 characters.' }, 3);
            } else if (title.length > 60) {
                check('warn', 'seo', 'Title Too Long', 'Title is ' + title.length + ' characters. Google usually cuts titles off after about 60 characters.', { value: title, fix: 'Shorten the title to 60 characters or fewer, with the key words first.' }, 3);
            } else {
                check('pass', 'seo', 'Title Tag', 'Title is ' + title.length + ' characters, within the optimal 30–60 range.', { value: title }, 3);
            }
            if (titleCount > 1) {
                check('warn', 'seo', 'Multiple Title Tags (' + titleCount + ')', 'The <head> contains ' + titleCount + ' <title> tags. Search engines use only one and may pick the wrong one.', { fix: 'Keep a single <title> tag.' }, 1);
            }

            if (!desc) {
                check('fail', 'seo', 'Missing Meta Description', 'No <meta name="description"> found. Search engines often use it as the snippet under your title, which affects click-through rate.', { fix: 'Add <meta name="description" content="120–160 character summary"> in the <head>.' }, 2);
            } else if (desc.length < 70) {
                check('warn', 'seo', 'Meta Description Too Short', 'Description is only ' + desc.length + ' characters. A longer description gives searchers more reason to click.', { value: desc, fix: 'Expand the description to 120–160 characters.' }, 2);
            } else if (desc.length > 160) {
                check('warn', 'seo', 'Meta Description Too Long', 'Description is ' + desc.length + ' characters. Google cuts it off after about 160 characters.', { value: desc, fix: 'Shorten the description to 160 characters or fewer.' }, 2);
            } else {
                check('pass', 'seo', 'Meta Description', 'Description is ' + desc.length + ' characters' + (desc.length < 120 ? ' (120–160 is ideal).' : ', within the optimal 120–160 range.'), { value: desc }, 2);
            }
            if (descEls.length > 1) {
                check('warn', 'seo', 'Multiple Meta Descriptions (' + descEls.length + ')', 'The page has ' + descEls.length + ' description tags. Search engines may ignore all of them.', { fix: 'Keep a single <meta name="description">.' }, 1);
            }

            if (!canonical) {
                check('warn', 'seo', 'No Canonical URL', 'No <link rel="canonical"> found. Without it, search engines may index duplicate versions of this page (with tracking parameters, trailing slashes, etc.).', { fix: 'Add <link rel="canonical" href="' + here.origin + here.pathname + '"> in the <head>.' }, 2);
            } else {
                var canonUrl = toUrl(canonical);
                if (canonEls.length > 1) {
                    check('fail', 'seo', 'Multiple Canonical Tags (' + canonEls.length + ')', 'The page declares ' + canonEls.length + ' canonical URLs. Google ignores all of them when they conflict.', { value: canonEls.map(function (l) { return l.getAttribute('href'); }).join('\n'), fix: 'Keep exactly one <link rel="canonical">.' }, 2);
                } else if (!canonUrl) {
                    check('fail', 'seo', 'Invalid Canonical URL', 'The canonical URL could not be parsed.', { value: canonical, fix: 'Use a full absolute URL, e.g. https://example.com/page.' }, 2);
                } else if (!/^https?:\/\/|^\/\//i.test(canonical)) {
                    check('warn', 'seo', 'Relative Canonical URL', 'The canonical URL is relative. Google accepts it, but an absolute URL avoids mistakes.', { value: canonical, fix: 'Use the absolute form: ' + canonUrl.href }, 2);
                } else if (stripHash(canonUrl.href) !== stripHash(here.href)) {
                    check('warn', 'seo', 'Canonical Points Elsewhere', 'The canonical URL is different from this page\'s address, so search engines will index that URL instead of this one. That is right for duplicates, but wrong for the main version of a page.', { value: canonUrl.href, fix: 'Make sure the canonical is this page\'s preferred URL.' }, 2);
                } else {
                    check('pass', 'seo', 'Canonical URL', 'Canonical URL points to this page.', { value: canonUrl.href }, 2);
                }
            }

            var h1Texts = h1s.map(function (h) { return clean(h.textContent); });
            if (h1s.length === 0) {
                check('fail', 'seo', 'No H1 Heading Found', 'This page has no visible H1. The H1 tells search engines and readers the main topic of the page.', { fix: 'Add exactly one H1 as the primary heading of the page.' }, 3);
            } else if (h1Texts.some(function (t) { return !t; })) {
                check('fail', 'seo', 'Empty H1 Heading', 'An H1 has no text (it may contain only an image without alt text).', { els: h1s.filter(function (h, i) { return !h1Texts[i]; }), fix: 'Give the H1 descriptive text.' }, 3);
            } else if (h1s.length > 1) {
                check('warn', 'seo', 'Multiple H1 Headings (' + h1s.length + ')', 'Found ' + h1s.length + ' H1 tags. One H1 per page gives the clearest structure.', { value: h1Texts.join('\n'), els: h1s, fix: 'Keep one H1 and turn the rest into H2s.' }, 2);
            } else {
                check('pass', 'seo', 'Single H1 Heading', 'One H1 found.', { value: h1Texts[0], els: h1s }, 3);
            }

            if (h2s.length === 0) {
                check('warn', 'seo', 'No H2 Headings Found', 'H2 headings break content into sections that search engines and readers can scan.', { fix: 'Add H2 headings for the main sections of your content.' }, 1);
            } else {
                check('pass', 'seo', 'H2 Headings Present', h2s.length + ' H2 heading(s) found.', null, 1);
            }

            var skips = headingSkips();
            if (skips.length) {
                check('warn', 'seo', 'Skipped Heading Levels (' + skips.length + ')', 'Headings jump levels (for example H2 straight to H4). A logical order helps search engines and screen readers understand the structure.', { value: skips.slice(0, 5).map(function (s) { return 'H' + s.from + ' → H' + s.to + ': ' + s.text; }).join('\n'), els: skips.map(function (s) { return s.el; }), fix: 'Use heading levels in order. See the Headers tab for the full outline.' }, 1);
            } else if (h1s.length || h2s.length) {
                check('pass', 'seo', 'Heading Order', 'Heading levels are used in order without skipping.', null, 1);
            }

            // ── INDEXING ──────────────────────────────────────────────
            if (robots.noindex) {
                check('fail', 'tech', 'Page Set to noindex', 'The ' + robots.source + ' tag tells search engines NOT to index this page.', { value: robots.raw, fix: 'Remove noindex unless this page should be hidden from search.' }, 3);
            } else if (robots.raw) {
                check('pass', 'tech', 'Robots Meta Tag', 'Robots directives do not block indexing.', { value: robots.raw }, 3);
            } else {
                check('pass', 'tech', 'Robots (Default)', 'No robots meta tag, so search engines use the default: index, follow.', null, 3);
            }
            if (robots.nofollow) {
                check('warn', 'tech', 'Page Set to nofollow', 'Search engines will not follow any links on this page.', { value: robots.raw, fix: 'Remove nofollow if links on this page should pass value.' }, 1);
            }

            if (!isHttps) {
                check(here.hostname === 'localhost' || here.hostname === '127.0.0.1' ? 'warn' : 'fail', 'tech', 'Not Served Over HTTPS', 'The page is served over ' + here.protocol.replace(':', '').toUpperCase() + '. HTTPS is a Google ranking signal and browsers mark HTTP pages as not secure.', { fix: 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.' }, 3);
            } else {
                var mixed = Array.from(document.querySelectorAll('img[src^="http:" i], script[src^="http:" i], link[rel~="stylesheet" i][href^="http:" i], iframe[src^="http:" i], video[src^="http:" i], audio[src^="http:" i], source[src^="http:" i]'));
                if (mixed.length) {
                    check('warn', 'tech', 'Mixed Content (' + mixed.length + ')', mixed.length + ' resource(s) load over insecure HTTP on this HTTPS page. Browsers block or flag them.', { value: mixed.slice(0, 5).map(function (el) { return el.getAttribute('src') || el.getAttribute('href'); }).join('\n'), fix: 'Load every resource over https://.' }, 2);
                } else {
                    check('pass', 'tech', 'HTTPS Enabled', 'Page is served securely over HTTPS with no mixed content.', null, 3);
                }
            }

            if (!viewport) {
                check('fail', 'tech', 'Missing Viewport Meta Tag', 'Without a viewport tag, phones render the page at desktop width. Google indexes the mobile version of pages.', { fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">' }, 3);
            } else if (!/width\s*=\s*device-width/i.test(viewport)) {
                check('warn', 'tech', 'Viewport Not Mobile-Friendly', 'The viewport tag does not include width=device-width, which can break mobile rendering.', { value: viewport, fix: 'Change to: <meta name="viewport" content="width=device-width, initial-scale=1">' }, 3);
            } else if (/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0+)?(?![\d.])/i.test(viewport)) {
                check('warn', 'a11y', 'Zoom Disabled', 'The viewport prevents pinch-zoom, which is an accessibility problem for people with low vision.', { value: viewport, fix: 'Remove user-scalable=no and maximum-scale=1.' }, 1);
            } else {
                check('pass', 'tech', 'Viewport Tag', 'Viewport is correctly configured for mobile devices.', { value: viewport }, 3);
            }

            if (charset.toLowerCase() !== 'utf-8') {
                check('warn', 'tech', 'Non-UTF-8 Charset', 'The page is decoded as ' + (charset || 'an unknown charset') + '. UTF-8 is the recommended universal encoding.', { value: charset, fix: 'Add <meta charset="UTF-8"> as the first element in <head> and save files as UTF-8.' }, 1);
            } else {
                check('pass', 'tech', 'Charset (UTF-8)', 'Page is decoded as UTF-8.', null, 1);
            }

            if (!lang) {
                check('warn', 'tech', 'Missing Language Attribute', 'The <html> tag has no lang attribute. Screen readers and search engines use it to identify the page language.', { fix: 'Add your language code to the <html> tag, e.g. <html lang="en">' }, 1);
            } else if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(lang)) {
                check('warn', 'tech', 'Invalid Language Code', '"' + lang + '" is not a valid language code.', { value: lang, fix: 'Use a BCP 47 code such as en, en-US or fr.' }, 1);
            } else {
                check('pass', 'tech', 'Language Attribute', 'Page language is declared as "' + lang + '".', null, 1);
            }

            if (!favicon) {
                check('warn', 'tech', 'No Favicon Link', 'No favicon <link> found. Google shows favicons next to mobile search results and browsers show them in tabs.', { fix: 'Add <link rel="icon" href="/favicon.png" type="image/png"> in the <head>.' }, 1);
            } else {
                check('pass', 'tech', 'Favicon', 'Favicon is linked.', { value: favicon.getAttribute('href') }, 1);
            }

            // Render-blocking scripts: classic scripts in <head> without defer/async
            var blocking = Array.from(document.querySelectorAll('head script[src]')).filter(function (s) {
                var type = (s.getAttribute('type') || '').trim().toLowerCase();
                var isJs = !type || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
                return isJs && !s.hasAttribute('defer') && !s.hasAttribute('async');
            });
            if (blocking.length > 0) {
                check('warn', 'perf', 'Render-Blocking Scripts (' + blocking.length + ')', blocking.length + ' script(s) in <head> load without defer or async, which delays the first paint.', { value: blocking.slice(0, 5).map(function (s) { return s.getAttribute('src'); }).join('\n'), fix: 'Add defer (or async for independent scripts) to scripts in <head>.' }, 1);
            } else {
                check('pass', 'perf', 'No Render-Blocking Scripts', 'Scripts in <head> use defer, async or modules.', null, 1);
            }

            // ── OPEN GRAPH / SOCIAL ─────────────────────────────────────
            if (!ogTitle) {
                check('warn', 'og', 'Missing og:title', 'No Open Graph title. Facebook, LinkedIn, Slack and others may show a wrong or empty title when the page is shared.', { fix: 'Add <meta property="og:title" content="Your Page Title">.' }, 1);
            } else {
                check('pass', 'og', 'OG Title', 'og:title is set.', { value: ogTitle }, 1);
            }
            if (!ogDesc) {
                check('warn', 'og', 'Missing og:description', 'No Open Graph description, so share previews have no summary text.', { fix: 'Add <meta property="og:description" content="A 1–2 sentence description">.' }, 1);
            } else {
                check('pass', 'og', 'OG Description', 'og:description is set.', { value: ogDesc }, 1);
            }
            if (!ogImg) {
                check('warn', 'og', 'Missing og:image', 'No Open Graph image, so links shared on social media appear without a preview image.', { fix: 'Add <meta property="og:image" content="https://yourdomain.com/og-image.jpg"> (1200×630 px recommended).' }, 2);
            } else if (!/^https?:\/\//i.test(ogImg)) {
                check('warn', 'og', 'og:image Is Not an Absolute URL', 'Social platforms need a full URL for og:image; relative paths are not loaded.', { value: ogImg, fix: 'Use an absolute URL such as ' + (toUrl(ogImg) ? toUrl(ogImg).href : 'https://yourdomain.com/og-image.jpg') + '.' }, 2);
            } else {
                check('pass', 'og', 'OG Image', 'og:image is set.', { value: ogImg }, 2);
            }
            if (!ogUrl) {
                check('warn', 'og', 'Missing og:url', 'No og:url. Social platforms use it to merge shares across URL variants.', { fix: 'Add <meta property="og:url" content="' + here.origin + here.pathname + '">.' }, 1);
            } else {
                check('pass', 'og', 'OG URL', 'og:url is set.', { value: ogUrl }, 1);
            }
            if (!ogType) {
                check('warn', 'og', 'Missing og:type', 'No og:type. Platforms assume "website", but being explicit is best practice.', { fix: 'Add <meta property="og:type" content="website"> ("article" for posts, "product" for shops).' }, 1);
            } else {
                check('pass', 'og', 'OG Type', 'og:type is "' + ogType + '".', null, 1);
            }

            // X (Twitter) falls back to og:title / og:image, so those count too
            if (!twCard) {
                check('warn', 'og', 'Missing twitter:card', 'Without twitter:card, links shared on X show as a small plain link instead of a rich card.', { fix: 'Add <meta name="twitter:card" content="summary_large_image">.' }, 1);
            } else {
                check('pass', 'og', 'Twitter Card', 'twitter:card is "' + twCard + '".', null, 1);
            }
            if (!twTitle && !ogTitle) {
                check('warn', 'og', 'Missing twitter:title', 'No twitter:title or og:title for X to show.', { fix: 'Add <meta name="twitter:title" content="Your Page Title"> (or og:title).' }, 1);
            } else {
                check('pass', 'og', 'Twitter Title', twTitle ? 'twitter:title is set.' : 'X will use og:title.', null, 1);
            }
            if (!twImg && !ogImg) {
                check('warn', 'og', 'Missing twitter:image', 'No twitter:image or og:image, so X shows no preview image.', { fix: 'Add <meta name="twitter:image" content="https://yourdomain.com/og-image.jpg"> (or og:image).' }, 1);
            } else {
                check('pass', 'og', 'Twitter Image', twImg ? 'twitter:image is set.' : 'X will use og:image.', null, 1);
            }

            // ── STRUCTURED DATA ────────────────────────────────────────
            var ld = jsonLdBlocks();
            var badLd = ld.filter(function (b) { return !b.valid; });
            var microdata = document.querySelectorAll('[itemscope]').length;
            if (badLd.length) {
                check('fail', 'tech', 'Invalid JSON-LD (' + badLd.length + ')', badLd.length + ' structured data block(s) contain invalid JSON, so search engines ignore them.', { value: badLd.map(function (b) { return b.error; }).join('\n'), fix: 'Fix the JSON syntax (check the Schema tab), then test at search.google.com/test/rich-results.' }, 2);
            } else if (!ld.length && !microdata) {
                check('warn', 'tech', 'No Structured Data (Schema)', 'No JSON-LD or Microdata found. Schema helps search engines understand your content and can unlock rich results (ratings, FAQs, breadcrumbs).', { fix: 'Use the Schema tab to copy a JSON-LD template.' }, 1);
            } else {
                var types = [];
                ld.forEach(function (b) { types = types.concat(b.types); });
                check('pass', 'tech', 'Structured Data Found', [ld.length ? ld.length + ' JSON-LD block(s)' : '', microdata ? microdata + ' Microdata item(s)' : ''].filter(Boolean).join(' and ') + ' detected.', types.length ? { value: types.join(', ') } : null, 1);
            }

            // ── IMAGES ────────────────────────────────────────────────
            var noAltImgs = imgs.filter(function (i) { return !i.hasAttribute('alt') && i.getAttribute('role') !== 'presentation' && i.getAttribute('aria-hidden') !== 'true'; });
            if (noAltImgs.length > 0) {
                check('fail', 'a11y', 'Images Missing Alt Text (' + noAltImgs.length + ')', noAltImgs.length + ' image(s) have no alt attribute. Screen readers cannot describe them and search engines cannot understand them.', { value: noAltImgs.slice(0, 3).map(imgName).join('\n'), els: noAltImgs, fix: 'Add descriptive alt="..." text. Use alt="" only for purely decorative images.' }, 2);
            } else if (imgs.length) {
                check('pass', 'a11y', 'All Images Have Alt Attributes', 'Every visible image has an alt attribute.', null, 2);
            }

            // CLS: width/height attributes, or a CSS aspect-ratio, reserve space
            var noSizeImgs = imgs.filter(function (i) {
                if (i.getAttribute('width') && i.getAttribute('height')) return false;
                var cs = getComputedStyle(i);
                if (cs.aspectRatio && cs.aspectRatio !== 'auto') return false;
                if (cs.position === 'absolute' || cs.position === 'fixed') return false;
                return true;
            });
            if (noSizeImgs.length > 0) {
                check('warn', 'perf', 'Images Without Dimensions (' + noSizeImgs.length + ')', noSizeImgs.length + ' image(s) have no width/height attributes or CSS aspect-ratio, so the layout shifts as they load (CLS).', { value: noSizeImgs.slice(0, 3).map(imgName).join('\n'), els: noSizeImgs, fix: 'Add width and height attributes matching the image\'s intrinsic size.' }, 1);
            } else if (imgs.length) {
                check('pass', 'perf', 'All Images Have Dimensions', 'Every image reserves its space before loading.', null, 1);
            }

            // Below the fold = further down the document than the first screen,
            // regardless of where the user has scrolled to
            var eagerImgs = imgs.filter(function (i) {
                var r = i.getBoundingClientRect();
                return r.top + window.scrollY > window.innerHeight && i.getAttribute('loading') !== 'lazy';
            });
            if (eagerImgs.length > 0) {
                check('warn', 'perf', 'Off-Screen Images Not Lazy-Loaded (' + eagerImgs.length + ')', eagerImgs.length + ' image(s) below the first screen load immediately, slowing the initial page load.', { value: eagerImgs.slice(0, 3).map(imgName).join('\n'), els: eagerImgs, fix: 'Add loading="lazy" to images that are not visible on the first screen.' }, 1);
            } else if (imgs.length) {
                check('pass', 'perf', 'Off-Screen Images Lazy-Loaded', 'No below-the-fold image loads eagerly.', null, 1);
            }

            // ── CONTENT ───────────────────────────────────────────────
            var bodyText = document.body ? clean(document.body.innerText) : '';
            var words = bodyText ? bodyText.split(' ').filter(function (w) { return /[\p{L}\p{N}]/u.test(w); }).length : 0;
            if (words < 300) {
                check('warn', 'content', 'Thin Content', 'The page has about ' + words + ' words of visible text. Search engines favour pages with substantial, useful content.', { fix: 'Aim for at least 300 words of unique content on pages you want to rank.' }, 2);
            } else {
                check('pass', 'content', 'Content Length', 'About ' + words + ' words of visible text.', null, 2);
            }

            // Links: resolve every href and compare origins
            var linkInfo = classifyLinks();
            if (linkInfo.internal.length === 0) {
                check('warn', 'content', 'No Internal Links', 'No links to other pages on this site. Internal links help search engines discover content and share ranking value.', { fix: 'Link to related pages on your site.' }, 1);
            } else {
                check('pass', 'content', 'Internal Links (' + linkInfo.internal.length + ')', linkInfo.internal.length + ' link(s) to other pages on this site' + (linkInfo.external.length ? ' and ' + linkInfo.external.length + ' external.' : '.'), null, 1);
            }

            var emptyLinks = linkInfo.all.filter(function (a) { return !accessibleName(a); });
            if (emptyLinks.length) {
                check('fail', 'a11y', 'Links Without Text (' + emptyLinks.length + ')', emptyLinks.length + ' link(s) have no text, image alt or aria-label. Screen readers announce them as just "link" and search engines get no anchor text.', { value: emptyLinks.slice(0, 3).map(function (a) { return a.getAttribute('href'); }).join('\n'), els: emptyLinks, fix: 'Add visible text, an aria-label, or alt text to the image inside the link.' }, 1);
            }

            var vague = /^(click here|here|read more|more|learn more|link|this|go|details|continue)$/i;
            var vagueLinks = linkInfo.all.filter(function (a) { return vague.test(clean(a.textContent).replace(/[.…»›→]+$/, '')) && !a.getAttribute('aria-label'); });
            if (vagueLinks.length) {
                check('warn', 'content', 'Non-Descriptive Link Text (' + vagueLinks.length + ')', vagueLinks.length + ' link(s) use generic text like "click here" or "read more", which tells search engines nothing about the target.', { value: uniq(vagueLinks.map(function (a) { return clean(a.textContent); })).join(', '), els: vagueLinks, fix: 'Describe the destination, e.g. "Read the pricing guide".' }, 1);
            }

            if (title && h1s.length === 1 && title.toLowerCase() === h1Texts[0].toLowerCase()) {
                check('warn', 'content', 'Title and H1 Are Identical', 'The title and H1 are the same. That is fine, but slightly different wording lets you target more search phrases.', { fix: 'Consider making the H1 a variation of the title.' }, 0.5);
            }

            return checks;
        }

        // ── Audit helpers ────────────────────────────────────────────
        function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
        function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }
        function metaAll(sel) { return Array.from(document.querySelectorAll(sel)); }
        function toUrl(href) { try { return new URL(href, window.location.href); } catch (e) { return null; } }
        function stripHash(href) { return href.split('#')[0].replace(/\/$/, ''); }
        // Rendered on the page (display:none has no boxes) and not part of this panel
        function isShown(el) {
            return !el.closest('#' + HID) && el.getClientRects().length > 0;
        }
        function imgName(img) {
            var src = img.currentSrc || img.getAttribute('src') || '';
            return src.startsWith('data:') ? '(inline data URI)' : (src || '(no src)');
        }
        function robotsDirectives() {
            // robots applies to every crawler; googlebot only to Google
            var parts = [], sources = [];
            metaAll('meta[name="robots" i], meta[name="googlebot" i]').forEach(function (m) {
                var c = (m.getAttribute('content') || '').toLowerCase();
                if (c) { parts.push(c); sources.push(m.getAttribute('name').toLowerCase()); }
            });
            var all = parts.join(',').split(',').map(function (s) { return s.trim(); });
            return {
                raw: parts.join(' | '),
                source: 'meta ' + (sources.length ? uniq(sources).join('/') : 'robots'),
                noindex: all.indexOf('noindex') !== -1 || all.indexOf('none') !== -1,
                nofollow: all.indexOf('nofollow') !== -1 || all.indexOf('none') !== -1
            };
        }
        function headingSkips() {
            var skips = [], prev = 0;
            Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(isShown).forEach(function (el) {
                var lv = +el.tagName.charAt(1), text = clean(el.textContent);
                if (!text) return;
                if (prev && lv > prev + 1) skips.push({ from: prev, to: lv, text: text.slice(0, 60), el: el });
                prev = lv;
            });
            return skips;
        }
        function jsonLdBlocks() {
            return metaAll('script[type="application/ld+json" i]').map(function (s) {
                var raw = s.textContent || '';
                try {
                    var parsed = JSON.parse(raw);
                    return { raw: raw, parsed: parsed, valid: true, types: schemaTypes(parsed) };
                } catch (e) {
                    return { raw: raw, parsed: null, valid: false, error: e.message, types: [] };
                }
            });
        }
        function schemaTypes(node) {
            var out = [];
            (function walk(n) {
                if (Array.isArray(n)) { n.forEach(walk); return; }
                if (!n || typeof n !== 'object') return;
                if (n['@type']) out = out.concat(n['@type']);
                if (n['@graph']) walk(n['@graph']);
            })(node);
            return uniq(out.map(String));
        }
        // Every <a href> on the page (outside this panel), classified by
        // resolving the href against the page URL.
        function classifyLinks() {
            var res = { all: [], internal: [], external: [], other: [] };
            document.querySelectorAll('a[href]').forEach(function (a) {
                if (a.closest('#' + HID)) return;
                res.all.push(a);
                var kind = linkKind(a.getAttribute('href'));
                if (kind === 'internal') res.internal.push(a);
                else if (kind === 'external') res.external.push(a);
                else res.other.push(a);
            });
            return res;
        }
        // 'internal' | 'external' | 'anchor' (same page) | 'other' (mailto:, tel:, javascript:)
        function linkKind(href) {
            var raw = (href || '').trim();
            if (!raw || raw.charAt(0) === '#') return 'anchor';
            var u = toUrl(raw);
            if (!u || !/^https?:$/.test(u.protocol)) return 'other';
            if (u.origin !== window.location.origin) {
                // www.example.com and example.com are the same site
                var a = u.hostname.replace(/^www\./, ''), b = window.location.hostname.replace(/^www\./, '');
                return a === b ? 'internal' : 'external';
            }
            return stripHash(u.href) === stripHash(window.location.href) ? 'anchor' : 'internal';
        }
        function accessibleName(a) {
            if (clean(a.textContent)) return true;
            if (a.getAttribute('aria-label') || a.getAttribute('title')) return true;
            if (a.getAttribute('aria-labelledby')) return true;
            return Array.from(a.querySelectorAll('img[alt], svg title, [aria-label]')).some(function (el) {
                return clean(el.getAttribute('alt') || el.getAttribute('aria-label') || el.textContent);
            });
        }
        // Scroll to and flash a page element
        function flash(el) {
            if (!el || !el.isConnected) { toast('That element is no longer on the page'); return; }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            var o = el.style.getPropertyValue('outline'), op = el.style.getPropertyPriority('outline');
            var oo = el.style.getPropertyValue('outline-offset'), oop = el.style.getPropertyPriority('outline-offset');
            el.style.setProperty('outline', '3px solid #4FD1C5', 'important');
            el.style.setProperty('outline-offset', '3px', 'important');
            setTimeout(function () {
                el.style.setProperty('outline', o, op);
                el.style.setProperty('outline-offset', oo, oop);
            }, 1800);
        }

        function showAudit() {
            var checks = runAudit();
            var fails = checks.filter(function (c) { return c.status === 'fail'; }).length;
            var warns = checks.filter(function (c) { return c.status === 'warn'; }).length;
            var passes = checks.filter(function (c) { return c.status === 'pass'; }).length;
            var total = checks.length;
            // Weighted score: a pass earns the check's full weight, a warning
            // half, a failure nothing, so critical problems cost the most.
            var earned = 0, possible = 0;
            checks.forEach(function (c) {
                possible += c.weight;
                earned += c.weight * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0);
            });
            var score = possible ? Math.round((earned / possible) * 100) : 0;

            // Ring
            var ringEl = shadow.getElementById('ring');
            var ringTxt = shadow.getElementById('ring-score');
            var circ = 188.5;
            var ringColor = score >= 80 ? '#5ccf8d' : score >= 50 ? '#e8a64a' : '#f07575';
            ringEl.style.stroke = ringColor;
            ringEl.style.strokeDasharray = circ + ' ' + circ;
            ringTxt.textContent = score;
            setTimeout(function () { ringEl.style.strokeDashoffset = circ - (score / 100) * circ; }, 80);

            var grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';
            var gradeBg = score >= 90 ? 'rgba(92,207,141,0.12)' : score >= 75 ? 'rgba(79,209,197,0.12)' : score >= 50 ? 'rgba(232,166,74,0.12)' : 'rgba(240,117,117,0.12)';
            var gradeColor = score >= 90 ? '#5ccf8d' : score >= 75 ? '#5fd8cc' : score >= 50 ? '#e8a64a' : '#f07575';
            shadow.getElementById('score-title').textContent = 'SEO Score: ' + score + '/100';
            shadow.getElementById('score-desc').textContent = fails + ' error' + (fails !== 1 ? 's' : '') + ', ' + warns + ' warning' + (warns !== 1 ? 's' : '') + ' and ' + passes + ' passed, out of ' + total + ' checks. Errors on important checks cost the most.';
            var gradeEl = shadow.getElementById('score-grade');
            gradeEl.textContent = grade;
            Object.assign(gradeEl.style, { background: gradeBg, color: gradeColor });

            shadow.getElementById('cnt-fail').textContent = fails;
            shadow.getElementById('cnt-warn').textContent = warns;
            shadow.getElementById('cnt-pass').textContent = passes;

            // Render issue cards
            function renderChecks(filter) {
                var container = shadow.getElementById('audit-issues');
                container.innerHTML = '';
                var visible = filter === 'all' ? checks : checks.filter(function (c) { return c.status === filter; });
                if (visible.length === 0) {
                    container.innerHTML = '<div class="empty">No items in this category.</div>';
                    return;
                }
                // Group: fail first, then warn, then pass
                ['fail', 'warn', 'pass'].forEach(function (st) {
                    // Most important first within each group
                    var group = visible.filter(function (c) { return c.status === st; })
                        .sort(function (x, y) { return y.weight - x.weight; });
                    group.forEach(function (c) {
                        var d = document.createElement('div');
                        d.className = 'audit-issue ' + c.status;
                        var extra = '';
                        if (c.extra) {
                            if (c.extra.value) extra += '<code class="audit-value">' + esc(c.extra.value) + '</code>';
                            if (c.extra.fix && c.status !== 'pass') extra += '<span class="audit-fix">' + ic('bulb', 14) + '<span>' + esc(c.extra.fix) + '</span></span>';
                            if (c.extra.els && c.extra.els.length && c.status !== 'pass') extra += '<button class="audit-show">' + ic('target', 13) + '<span>Show on page' + (c.extra.els.length > 1 ? ' (1/' + c.extra.els.length + ')' : '') + '</span></button>';
                        }
                        d.innerHTML = '<div class="audit-icon">' + ic(STATUS_ICON[c.status], 16) + '</div>' +
                            '<div class="audit-body"><div class="audit-title">' + esc(c.title) + '</div>' +
                            '<div class="audit-desc">' + esc(c.desc) + '</div>' + extra + '</div>';
                        var show = d.querySelector('.audit-show');
                        if (show) {
                            // Each click steps to the next matching element
                            var n = 0;
                            show.addEventListener('click', function () {
                                var els = c.extra.els;
                                flash(els[n % els.length]);
                                n++;
                                if (els.length > 1) show.lastChild.textContent = 'Show on page (' + ((n % els.length) + 1) + '/' + els.length + ')';
                            });
                        }
                        container.appendChild(d);
                    });
                });
            }

            // Filter buttons (onclick so a re-run replaces, not stacks, handlers)
            var activeFilter = shadow.querySelector('.filter-btn.active');
            renderChecks(activeFilter ? activeFilter.dataset.f : 'all');
            shadow.querySelectorAll('.filter-btn').forEach(function (btn) {
                btn.onclick = function () {
                    shadow.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    renderChecks(btn.dataset.f);
                };
            });

            shadow.getElementById('btn-rerun').onclick = function () { showAudit(); toast('Audit re-run'); };
            shadow.getElementById('btn-copy-report').onclick = function () {
                var mark = { fail: '✗', warn: '!', pass: '✓' };
                var lines = ['SEO audit: ' + window.location.href, 'Score: ' + score + '/100 (' + grade + ')', fails + ' errors, ' + warns + ' warnings, ' + passes + ' passed', ''];
                ['fail', 'warn', 'pass'].forEach(function (st) {
                    checks.filter(function (c) { return c.status === st; }).forEach(function (c) {
                        lines.push(mark[st] + ' ' + c.title + ': ' + c.desc);
                        if (c.extra && c.extra.fix && st !== 'pass') lines.push('    Fix: ' + c.extra.fix);
                    });
                });
                navigator.clipboard.writeText(lines.join('\n'))
                    .then(function () { toast('Audit report copied'); })
                    .catch(function () { toast('Copy failed'); });
            };
        }

        // ═══════════════════════════════════════════════════════════════
        // META TAB
        // ═══════════════════════════════════════════════════════════════
        function runMeta() {
            var title = clean(document.title);
            var desc = clean(ga('meta[name="description" i]', 'content'));
            var charset = document.characterSet || '';
            var canonical = ga('link[rel~="canonical" i]', 'href');
            var robots = robotsDirectives();
            var viewport = ga('meta[name="viewport" i]', 'content');
            var lang = document.documentElement.getAttribute('lang') || '';
            var ogTitle = ga('meta[property="og:title"]', 'content');
            var ogDesc = ga('meta[property="og:description"]', 'content');
            var ogImg = ga('meta[property="og:image"]', 'content') || ga('meta[property="og:image:url"]', 'content');
            var ogUrl = ga('meta[property="og:url"]', 'content');
            var ogType = ga('meta[property="og:type"]', 'content');
            var twCard = ga('meta[name="twitter:card"]', 'content');
            var twTitle = ga('meta[name="twitter:title"]', 'content');
            var twImg = ga('meta[name="twitter:image"]', 'content');

            var domain = window.location.hostname;
            var path = window.location.pathname;
            shadow.getElementById('sf').textContent = domain.charAt(0).toUpperCase();
            shadow.getElementById('su').textContent = domain + (path !== '/' ? ' › ' + path.split('/').filter(Boolean).join(' › ') : '');
            shadow.getElementById('stitle').textContent = title || '(No title set)';
            shadow.getElementById('sdesc').textContent = desc || '(No meta description)';

            var itEl = shadow.getElementById('it'), idEl = shadow.getElementById('id');
            itEl.value = title; idEl.value = desc;
            setCounter('ct', title.length, 30, 60); setCounter('cd', desc.length, 120, 160);

            function upClip() { var cl = shadow.getElementById('sclip'); if (cl) cl.style.display = (itEl.value.length > 60 || idEl.value.length > 160) ? 'block' : 'none'; }
            upClip();
            itEl.addEventListener('input', function () { shadow.getElementById('stitle').textContent = itEl.value || '(No title)'; setCounter('ct', itEl.value.length, 30, 60); upClip(); });
            idEl.addEventListener('input', function () { shadow.getElementById('sdesc').textContent = idEl.value || '(No desc)'; setCounter('cd', idEl.value.length, 120, 160); upClip(); });

            var rows = [
                { n: 'Title Tag', v: title || 'Not set', ok: title.length >= 30 && title.length <= 60, bad: !title, msg: !title ? 'Missing' : title.length + ' chars (30–60 optimal)' },
                { n: 'Meta Description', v: desc || 'Not set', ok: desc.length >= 120 && desc.length <= 160, bad: !desc, msg: !desc ? 'Missing' : desc.length + ' chars (120–160 optimal)' },
                { n: 'Charset', v: charset || 'Not detected', ok: charset.toLowerCase() === 'utf-8', msg: 'Should be UTF-8' },
                { n: 'Canonical URL', v: canonical ? (toUrl(canonical) || { href: canonical }).href : 'Not set', ok: !!canonical, msg: 'Missing (risk of duplicate content)' },
                { n: 'Viewport', v: viewport || 'Not set', ok: /width\s*=\s*device-width/i.test(viewport), bad: !viewport, msg: viewport ? 'Missing width=device-width' : 'Missing' },
                { n: 'Robots', v: robots.raw || 'index, follow (default)', ok: !robots.noindex, bad: robots.noindex, msg: 'noindex: hidden from search' },
                { n: 'Language (lang attr)', v: lang || 'Not set', ok: !!lang, msg: 'Missing on <html> tag' },
                { n: 'og:title', v: ogTitle || 'Not set', ok: !!ogTitle, msg: 'Missing' },
                { n: 'og:description', v: ogDesc || 'Not set', ok: !!ogDesc, msg: 'Missing' },
                { n: 'og:image', v: ogImg || 'Not set', ok: !!ogImg, msg: 'Missing — social cards will be imageless' },
                { n: 'og:url', v: ogUrl || 'Not set', ok: !!ogUrl, msg: 'Missing' },
                { n: 'og:type', v: ogType || 'Not set', ok: !!ogType, msg: 'Missing (use "website" or "article")' },
                { n: 'twitter:card', v: twCard || 'Not set', ok: !!twCard, msg: 'Missing' },
                { n: 'twitter:title', v: twTitle || (ogTitle ? 'Uses og:title' : 'Not set'), ok: !!(twTitle || ogTitle), msg: 'Missing' },
                { n: 'twitter:image', v: twImg || (ogImg ? 'Uses og:image' : 'Not set'), ok: !!(twImg || ogImg), msg: 'Missing' },
                { n: 'HTTPS', v: window.location.protocol === 'https:' ? 'Yes' : 'No, using ' + window.location.protocol.replace(':', '').toUpperCase(), ok: window.location.protocol === 'https:', bad: true, msg: 'Switch to HTTPS' }
            ];

            var mlist = shadow.getElementById('mlist'); mlist.innerHTML = '';
            rows.forEach(function (row) {
                var d = document.createElement('div'); d.className = 'mrow';
                d.innerHTML = '<div class="mrow-head"><span class="mrow-name">' + esc(row.n) + '</span>' +
                    '<span class="audit-badge ' + (row.ok ? 'ab-pass' : row.bad ? 'ab-fail' : 'ab-warn') + '">' + (row.ok ? 'OK' : esc(row.msg)) + '</span></div>' +
                    '<div class="mrow-val' + (row.v === 'Not set' ? ' miss' : '') + '">' + esc(row.v) + '</div>';
                mlist.appendChild(d);
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // SCHEMA TAB
        // ═══════════════════════════════════════════════════════════════
        function runSchema() {
            var found = jsonLdBlocks();
            var microdata = document.querySelectorAll('[itemscope]').length;
            shadow.getElementById('sc-cnt').textContent = found.length + ' JSON-LD' + (microdata ? ' + ' + microdata + ' Microdata' : '');
            var fl = shadow.getElementById('sc-found'); fl.innerHTML = '';
            if (!found.length && !microdata) {
                fl.innerHTML = '<div class="empty">No structured data found on this page.<br>Use the generator below to create Schema markup.</div>';
            } else {
                found.forEach(function (s, i) {
                    var type = s.types.length ? s.types.join(', ') : 'Structured Data';
                    var d = document.createElement('div'); d.className = 'mrow'; d.style.marginBottom = '8px';
                    d.innerHTML = '<div class="mrow-head"><span class="mrow-name">' + esc(type) + ' (' + (i + 1) + ')</span>' +
                        '<span class="audit-badge ' + (s.valid ? 'ab-pass' : 'ab-fail') + '">' + (s.valid ? 'Valid JSON' : 'Invalid JSON') + '</span></div>' +
                        (s.valid ? '' : '<div class="mrow-val miss" style="margin-bottom:6px;">' + esc(s.error) + '</div>') +
                        '<div class="jscode" style="max-height:140px;margin-top:0;">' + esc(s.raw.trim()) + '</div>';
                    fl.appendChild(d);
                });
            }
            var code = shadow.getElementById('sc-code'); code.textContent = schemaTemplates.Article;
            shadow.querySelectorAll('.stab').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    shadow.querySelectorAll('.stab').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    code.textContent = schemaTemplates[btn.dataset.st] || '';
                });
            });
            shadow.getElementById('btn-cp').addEventListener('click', function () {
                var btn = shadow.getElementById('btn-cp');
                navigator.clipboard.writeText(code.textContent).then(function () {
                    var o = btn.innerHTML; btn.innerHTML = ic('check', 14) + 'Copied';
                    setTimeout(function () { btn.innerHTML = o; }, 1500);
                }).catch(function () { toast('Copy failed'); });
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // HEADERS TAB
        // ═══════════════════════════════════════════════════════════════
        function buildHeaders() {
            var els = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
            var list = shadow.getElementById('hlist'), stats = shadow.getElementById('hstats');
            list.innerHTML = ''; stats.innerHTML = '';
            if (!els.length) { list.innerHTML = '<div class="empty">No heading tags (H1–H6) found on this page.</div>'; return; }
            var counts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 }, seen = {}, prev = 0, outline = [];
            els.forEach(function (el, idx) {
                var lv = parseInt(el.tagName.charAt(1));
                counts['h' + lv]++;
                var text = (el.textContent || el.innerText || '').replace(/\s+/g, ' ').trim();
                var isEmpty = !text, isDup = false, isSkip = prev > 0 && lv > prev + 1;
                if (!isEmpty) { var k = text.toLowerCase(); if (seen[k]) isDup = true; else seen[k] = true; }
                if (!isEmpty) prev = lv;
                outline.push({ lv: lv, text: isEmpty ? '(empty)' : text, isEmpty: isEmpty, isDup: isDup, isSkip: isSkip, el: el });
            });
            var sh = '';
            ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (tag) { if (counts[tag]) sh += '<div class="hschip"><span class="htag ' + tag + 't">' + tag.toUpperCase() + '</span><span class="hchip-n">' + counts[tag] + '</span></div>'; });
            if (counts.h1 > 1) sh += '<div class="hschip is-bad">' + ic('alert-triangle', 13) + 'Multiple H1s</div>';
            if (counts.h1 === 0) sh += '<div class="hschip is-bad">' + ic('alert-triangle', 13) + 'No H1</div>';
            stats.innerHTML = sh;
            outline.forEach(function (h) {
                var item = document.createElement('div'); item.className = 'hitem';
                item.style.marginLeft = ((h.lv - 1) * 14) + 'px';
                var w = '';
                if (h.isEmpty) w += '<span class="hwarn hw-e">EMPTY</span>';
                if (h.isDup) w += '<span class="hwarn hw-d">DUP</span>';
                if (h.isSkip) w += '<span class="hwarn hw-s">SKIP</span>';
                item.innerHTML = '<span class="htag h' + h.lv + 't">H' + h.lv + '</span><span class="htxt" title="' + esc(h.text) + '">' + esc(h.text) + '</span>' + w;
                item.addEventListener('click', function () {
                    flash(h.el);
                    toast('→ ' + h.text.substring(0, 28));
                });
                list.appendChild(item);
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // IMAGES TAB
        // ═══════════════════════════════════════════════════════════════
        function runImages() {
            var imgs = Array.from(document.querySelectorAll('img'));
            var noAlt = 0, dec = 0;
            shadow.getElementById('it2').textContent = imgs.length;
            var cont = shadow.getElementById('ilist'); cont.innerHTML = '';
            if (!imgs.length) { cont.innerHTML = '<div class="empty">No images found on this page.</div>'; shadow.getElementById('ina').textContent = '0'; shadow.getElementById('idec').textContent = '0'; return; }
            imgs.forEach(function (img, idx) {
                var src = img.currentSrc || img.src || img.getAttribute('src') || '';
                var hasAlt = img.hasAttribute('alt'), alt = img.getAttribute('alt') || '', isD = hasAlt && alt.trim() === '';
                if (!hasAlt) noAlt++; if (isD) dec++;
                var w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0, h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
                if (!w || !h) { var r = img.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height); }
                var fname = src.startsWith('data:') ? 'Inline Data URI' : (src.split('/').pop().split('?')[0] || 'image');
                var ab = !hasAlt ? '<span class="audit-badge ab-fail" style="margin-top:3px;">Missing alt</span>' : isD ? '<span class="audit-badge ab-warn" style="margin-top:3px;">Decorative</span>' : '<div class="imeta">Alt: "' + esc(alt) + '"</div>';
                var card = document.createElement('div'); card.className = 'icard';
                card.innerHTML = '<div class="ithumb"><img src="' + esc(src) + '" loading="lazy" alt="' + esc(alt) + '"></div>' +
                    '<div class="idet"><div class="isrc" title="' + esc(src) + '">' + esc(fname) + '</div>' +
                    '<div class="imeta">' + (w && h ? w + '×' + h + 'px' : 'Size unknown') + (img.getAttribute('loading') === 'lazy' ? ' · lazy' : ' · eager') + '</div>' + ab + '</div>';
                card.querySelector('.ithumb img').addEventListener('error', function () { this.style.opacity = '0.15'; });
                card.addEventListener('click', function () {
                    flash(img);
                });
                cont.appendChild(card);
            });
            shadow.getElementById('ina').textContent = noAlt;
            shadow.getElementById('idec').textContent = dec;
        }

        // ═══════════════════════════════════════════════════════════════
        // LINKS TAB
        // ═══════════════════════════════════════════════════════════════
        var linksData = [];
        function runLinks() {
            var info = classifyLinks();
            var byUrl = {};
            linksData = [];
            // One row per distinct target (ignoring #fragments), so a link
            // repeated in the header and footer is listed and checked once
            info.all.forEach(function (a) {
                var href = a.getAttribute('href') || '';
                var kind = linkKind(href);
                var u = toUrl(href);
                var key = kind === 'internal' || kind === 'external' ? u.href.split('#')[0] : href;
                if (byUrl[key]) { byUrl[key].count++; byUrl[key].els.push(a); return; }
                var rel = (a.getAttribute('rel') || '').toLowerCase().split(/\s+/);
                var item = {
                    url: key, kind: kind, count: 1, els: [a], idx: linksData.length,
                    isNF: rel.indexOf('nofollow') !== -1 || rel.indexOf('ugc') !== -1 || rel.indexOf('sponsored') !== -1,
                    checkable: kind === 'internal' || kind === 'external'
                };
                byUrl[key] = item;
                linksData.push(item);
            });
            shadow.getElementById('li').textContent = info.internal.length;
            shadow.getElementById('le').textContent = info.external.length;
            shadow.getElementById('lb').textContent = '0';
            var cont = shadow.getElementById('llist'); cont.innerHTML = '';
            if (!linksData.length) { cont.innerHTML = '<div class="empty">No links found on this page.</div>'; return; }
            var LABEL = { internal: 'Internal', external: 'External', anchor: 'Same page', other: 'Non-web' };
            linksData.forEach(function (item) {
                var card = document.createElement('div'); card.className = 'lcard';
                var isWeb = item.checkable;
                card.innerHTML = '<div class="linfo">' +
                    (isWeb ? '<a href="' + esc(item.url) + '" class="lurl" target="_blank" rel="noopener noreferrer" title="' + esc(item.url) + '">' + esc(item.url) + '</a>'
                           : '<span class="lurl" title="' + esc(item.url) + '">' + esc(item.url) + '</span>') +
                    '<div class="lmeta"><span class="ltag' + (item.kind === 'external' ? ' ext' : '') + '">' + LABEL[item.kind] + '</span>' +
                    (item.count > 1 ? '<span class="ltag">×' + item.count + '</span>' : '') +
                    (item.isNF ? '<span class="ltag nf">Nofollow</span>' : '') +
                    '<button class="lshow" title="Show on page">' + ic('target', 12) + '</button></div></div>' +
                    '<div class="lstat ls-p" id="ls-' + item.idx + '">' + (isWeb ? '–' : 'skip') + '</div>';
                var n = 0;
                card.querySelector('.lshow').addEventListener('click', function () { flash(item.els[n++ % item.els.length]); });
                cont.appendChild(card);
            });

            var btn = shadow.getElementById('btn-chk');
            btn.onclick = function () {
                var queue = linksData.filter(function (i) { return i.checkable; });
                var total = queue.length, done = 0, broken = 0;
                if (!total) { toast('No web links to check'); return; }
                btn.disabled = true;
                btn.textContent = 'Checking 0/' + total + '…';
                shadow.getElementById('lb').textContent = '0';

                function setBadge(item, text, cls, tip) {
                    var badge = shadow.getElementById('ls-' + item.idx);
                    if (!badge) return;
                    badge.textContent = text;
                    badge.className = 'lstat ' + cls;
                    badge.title = tip || '';
                }
                // The request runs in the extension's background worker, which
                // is not bound by the page's CORS rules, so cross-site links get
                // a real HTTP status instead of a false "error".
                function checkOne(item) {
                    return new Promise(function (resolve) {
                        setBadge(item, '…', 'ls-p');
                        try {
                            chrome.runtime.sendMessage({ type: 'CHECK_LINK', url: item.url }, function (res) {
                                if (chrome.runtime.lastError || !res) res = { status: 0, error: (chrome.runtime.lastError && chrome.runtime.lastError.message) || 'No response' };
                                resolve(res);
                            });
                        } catch (e) { resolve({ status: 0, error: e.message }); }
                    }).then(function (res) {
                        var s = res.status;
                        if (res.timeout) setBadge(item, 'TIMEOUT', 'ls-o', 'No response within 10 seconds');
                        else if (!s) { broken++; setBadge(item, 'ERR', 'ls-r', res.error || 'Network error'); }
                        else if (s >= 400) {
                            // 401/403/429 usually mean "blocked for bots", not missing
                            if (s === 401 || s === 403 || s === 429) setBadge(item, s, 'ls-o', 'The server refused the check. The page may still work in a browser.');
                            else { broken++; setBadge(item, s, 'ls-r'); }
                        } else if (res.redirected) setBadge(item, s + ' ↪', 'ls-o', 'Redirects to ' + res.finalUrl);
                        else setBadge(item, s, 'ls-g');
                        done++;
                        btn.textContent = 'Checking ' + done + '/' + total + '…';
                        shadow.getElementById('lb').textContent = broken;
                    });
                }
                // A few at a time so big pages don't flood the network
                var next = 0;
                function worker() {
                    if (next >= queue.length) return Promise.resolve();
                    return checkOne(queue[next++]).then(worker);
                }
                var workers = [];
                for (var w = 0; w < Math.min(6, total); w++) workers.push(worker());
                Promise.all(workers).then(function () {
                    btn.disabled = false;
                    btn.innerHTML = ic('refresh', 14) + 'Recheck Links';
                    toast('Checked ' + total + ' links · ' + broken + ' broken');
                });
            };
        }

        // ─── BOOT ─────────────────────────────────────────────────────
        try { showAudit(); }  catch (e) { console.error('[Codex SEO] Audit:', e); }
        try { runMeta(); }    catch (e) { console.error('[Codex SEO] Meta:', e); }
        try { runSchema(); }  catch (e) { console.error('[Codex SEO] Schema:', e); }
        try { buildHeaders(); } catch (e) { console.error('[Codex SEO] Headers:', e); }
        shadow.getElementById('btn-rh').addEventListener('click', function () { buildHeaders(); toast('Headers refreshed'); });
        try { runImages(); }  catch (e) { console.error('[Codex SEO] Images:', e); }
        try { runLinks(); }   catch (e) { console.error('[Codex SEO] Links:', e); }

        toast('SEO Audit complete!', 2500);

    } catch (globalErr) {
        console.error('[Codex SEO Tools Error]', globalErr);
    }
})();
