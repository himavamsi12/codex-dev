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
                background: 'linear-gradient(135deg,#4FD1C5,#9F7AEA)',
                color: '#000', padding: '10px 22px', borderRadius: '30px',
                zIndex: '2147483647', fontFamily: "'Outfit',system-ui,sans-serif",
                fontSize: '13px', fontWeight: '700', letterSpacing: '0.4px',
                boxShadow: '0 8px 28px rgba(79,209,197,0.45)',
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
        if (window.__cxSeo) {
            window.__cxSeo = false;
            var oh = document.getElementById(HID);
            if (oh) oh.remove();
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

        if (!document.getElementById('_cxfonts')) {
            var fl = document.createElement('link');
            fl.id = '_cxfonts'; fl.rel = 'stylesheet';
            fl.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap';
            document.head.appendChild(fl);
        }

        // ─── CSS ──────────────────────────────────────────────────────
        var style = document.createElement('style');
        style.textContent = `
        :host {
            --bg: rgba(11,12,18,0.98); --card: rgba(255,255,255,0.04);
            --border: rgba(255,255,255,0.09); --text: #e2e8f0; --muted: #94a3b8;
            --accent: #4FD1C5; --purple: #9F7AEA;
            --green: #48bb78; --orange: #ed8936; --red: #f56565; --blue: #63b3ed;
            font-family: 'Outfit', system-ui, sans-serif;
            color: var(--text); font-size: 13px; box-sizing: border-box;
        }
        :host * { box-sizing: border-box; }

        .panel {
            position: fixed; top: 14px; right: 14px;
            width: 460px; height: calc(100vh - 28px);
            background: var(--bg);
            backdrop-filter: blur(24px) saturate(160%);
            border: 1px solid var(--border); border-radius: 16px;
            box-shadow: 0 32px 80px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06);
            display: flex; flex-direction: column; overflow: hidden; z-index: 10000;
        }

        /* Header */
        .hdr {
            display: flex; justify-content: space-between; align-items: center;
            padding: 13px 18px; background: rgba(0,0,0,0.3);
            border-bottom: 1px solid var(--border); cursor: move; flex-shrink: 0; user-select: none;
        }
        .hdr-title {
            font-weight: 700; font-size: 14px;
            background: linear-gradient(135deg, var(--accent), var(--purple));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text; display: flex; align-items: center; gap: 8px;
        }
        .close-btn {
            background: rgba(255,255,255,0.06); border: 1px solid var(--border);
            color: var(--muted); -webkit-text-fill-color: var(--muted);
            cursor: pointer; font-size: 12px; padding: 4px 9px;
            border-radius: 6px; transition: all 0.18s; line-height: 1.4;
        }
        .close-btn:hover { color: #fff; -webkit-text-fill-color: #fff; background: rgba(255,255,255,0.1); }

        /* Tabs */
        .tabs {
            display: flex; background: rgba(0,0,0,0.2);
            border-bottom: 1px solid var(--border);
            overflow-x: auto; flex-shrink: 0; scrollbar-width: none;
        }
        .tabs::-webkit-scrollbar { display: none; }
        .tab {
            padding: 10px 12px; cursor: pointer; color: var(--muted);
            border-bottom: 2px solid transparent; font-weight: 600;
            font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.7px;
            white-space: nowrap; transition: all 0.18s; flex-shrink: 0;
        }
        .tab:hover { color: #fff; }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); background: rgba(79,209,197,0.04); }

        /* Content panes */
        .pane {
            display: none; flex: 1; overflow-y: auto; padding: 18px;
            min-height: 0; overscroll-behavior: contain;
            scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent;
        }
        .pane::-webkit-scrollbar { width: 4px; }
        .pane::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
        .pane.active { display: block; }

        /* Section header */
        .sec { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px;
            color: var(--accent); margin-bottom: 10px; margin-top: 20px;
            display: flex; justify-content: space-between; align-items: center; }
        .sec:first-child { margin-top: 0; }
        .sec-sub { font-size: 10px; font-weight: 400; color: var(--muted); text-transform: none; letter-spacing: 0; }

        /* ── AUDIT SUMMARY STRIP ── */
        .summary-strip {
            display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 18px;
        }
        .summary-card {
            background: var(--card); border: 1px solid var(--border); border-radius: 10px;
            padding: 12px 10px; text-align: center;
        }
        .summary-num { font-size: 26px; font-weight: 800; line-height: 1; }
        .summary-lbl { font-size: 9.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-top: 3px; }
        .s-fail .summary-num { color: var(--red); }
        .s-warn .summary-num { color: var(--orange); }
        .s-pass .summary-num { color: var(--green); }

        /* ── SEO SCORE RING ── */
        .score-section { display: flex; align-items: center; gap: 18px; margin-bottom: 18px;
            background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px; }
        .score-ring { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
        .score-ring svg { overflow: visible; }
        .ring-bg { fill: none; stroke: rgba(255,255,255,0.07); stroke-width: 6; }
        .ring-fg { fill: none; stroke-width: 6; stroke-linecap: round;
            transform: rotate(-90deg); transform-origin: 50% 50%;
            transition: stroke-dashoffset 1.2s ease-out, stroke 0.3s; }
        .ring-text { position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%);
            font-size: 18px; font-weight: 800; color: #fff; }
        .score-info { flex: 1; }
        .score-title { font-size: 15px; font-weight: 700; color: #fff; margin-bottom: 4px; }
        .score-desc { font-size: 12px; color: var(--muted); line-height: 1.5; }
        .score-grade { display: inline-block; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; margin-top: 6px; }

        /* ── AUDIT ISSUE CARDS ── */
        .audit-group { margin-bottom: 6px; }
        .audit-issue {
            background: var(--card); border: 1px solid var(--border);
            border-radius: 10px; padding: 12px 14px; margin-bottom: 6px;
            display: flex; align-items: flex-start; gap: 12px;
            transition: border-color 0.18s;
        }
        .audit-issue:hover { border-color: rgba(255,255,255,0.16); }
        .audit-issue.fail { border-left: 3px solid var(--red); }
        .audit-issue.warn { border-left: 3px solid var(--orange); }
        .audit-issue.pass { border-left: 3px solid var(--green); }
        .audit-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; line-height: 1; }
        .audit-body { flex: 1; min-width: 0; }
        .audit-title { font-weight: 600; color: #fff; font-size: 12.5px; margin-bottom: 3px; }
        .audit-desc { font-size: 11.5px; color: var(--muted); line-height: 1.55; }
        .audit-fix {
            font-size: 11px; color: var(--accent); margin-top: 6px; font-weight: 500;
            background: rgba(79,209,197,0.07); border: 1px solid rgba(79,209,197,0.15);
            border-radius: 5px; padding: 5px 9px; display: inline-block; line-height: 1.5;
        }
        .audit-value {
            font-family: 'JetBrains Mono', monospace; font-size: 10.5px;
            background: rgba(0,0,0,0.4); border: 1px solid var(--border);
            border-radius: 5px; padding: 5px 8px; margin-top: 6px;
            color: #81e6d9; word-break: break-all; white-space: pre-wrap; line-height: 1.5;
            display: block;
        }
        .audit-badge {
            display: inline-flex; align-items: center; font-size: 9.5px; font-weight: 700;
            padding: 2px 7px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; margin-top: 2px;
        }
        .ab-fail { background: rgba(245,101,101,0.14); color: #fc8181; border: 1px solid rgba(245,101,101,0.25); }
        .ab-warn { background: rgba(237,137,54,0.14);  color: #f6ad55; border: 1px solid rgba(237,137,54,0.25); }
        .ab-pass { background: rgba(72,187,120,0.14);  color: #68d391; border: 1px solid rgba(72,187,120,0.25); }
        .ab-info { background: rgba(99,179,237,0.14);  color: #63b3ed; border: 1px solid rgba(99,179,237,0.25); }

        /* Filter tabs */
        .filter-bar { display: flex; gap: 6px; margin-bottom: 14px; flex-wrap: wrap; }
        .filter-btn {
            background: var(--card); border: 1px solid var(--border); border-radius: 20px;
            color: var(--muted); padding: 4px 12px; font-size: 11px; font-weight: 600;
            cursor: pointer; white-space: nowrap; transition: all 0.18s;
        }
        .filter-btn:hover { color: #fff; }
        .filter-btn.active { background: rgba(79,209,197,0.1); color: var(--accent); border-color: var(--accent); }
        .filter-btn.f-fail.active { background: rgba(245,101,101,0.1); color: #fc8181; border-color: rgba(245,101,101,0.4); }
        .filter-btn.f-warn.active { background: rgba(237,137,54,0.1);  color: #f6ad55; border-color: rgba(237,137,54,0.4); }
        .filter-btn.f-pass.active { background: rgba(72,187,120,0.1);  color: #68d391; border-color: rgba(72,187,120,0.4); }

        /* ── SERP Preview ── */
        .serp { background: #fff; font-family: arial, sans-serif; padding: 14px 16px;
            border-radius: 10px; margin-bottom: 16px;
            box-shadow: 0 4px 18px rgba(0,0,0,0.3); }
        .serp-dom { display: flex; align-items: center; gap: 6px; color: #202124; font-size: 12px; margin-bottom: 3px; }
        .serp-fav { width: 18px; height: 18px; border-radius: 50%; background: #f1f3f4; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 700; color: #555; flex-shrink: 0; }
        .serp-domtxt { color: #202124; font-size: 13px; }
        .serp-title { color: #1a0dab; font-size: 19px; line-height: 1.3; margin-bottom: 3px; font-weight: 400; }
        .serp-desc { color: #4d5156; font-size: 13.5px; line-height: 1.58; word-wrap: break-word; }
        .serp-clip { color: #f56565; font-size: 10.5px; margin-top: 4px; font-family: 'Outfit', sans-serif; font-weight: 500; }

        /* Meta form */
        .mform { display: flex; flex-direction: column; gap: 12px; }
        .fg { display: flex; flex-direction: column; gap: 5px; }
        .fg-row { display: flex; justify-content: space-between; align-items: center; }
        .flbl { font-size: 10.5px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
        .fctr { font-size: 10px; font-weight: 700; color: var(--muted); }
        .finp { background: rgba(255,255,255,0.04); border: 1px solid var(--border); border-radius: 7px;
            padding: 8px 10px; color: #fff; font-family: 'Outfit', sans-serif; font-size: 12px;
            outline: none; transition: border-color 0.2s; width: 100%; }
        .finp:focus { border-color: var(--accent); }
        textarea.finp { resize: vertical; min-height: 64px; }

        /* Meta audit rows */
        .mrow { background: var(--card); border: 1px solid var(--border); border-radius: 9px; padding: 11px 13px; margin-bottom: 7px; }
        .mrow-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 7px; gap: 8px; }
        .mrow-name { font-weight: 600; color: #fff; font-size: 12px; }
        .mrow-val { font-family: 'JetBrains Mono', monospace; font-size: 11px;
            background: rgba(0,0,0,0.35); padding: 7px 10px; border-radius: 5px;
            border: 1px solid var(--border); word-break: break-all; white-space: pre-wrap;
            color: #81e6d9; line-height: 1.5; }
        .mrow-val.miss { color: var(--muted); font-style: italic; }

        /* Schema */
        .stabs { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; margin-bottom: 10px; scrollbar-width: none; }
        .stabs::-webkit-scrollbar { display: none; }
        .stab { background: var(--card); border: 1px solid var(--border); border-radius: 20px; color: var(--muted); padding: 4px 11px; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap; transition: all 0.18s; flex-shrink: 0; }
        .stab:hover { color: #fff; } .stab.active { background: rgba(79,209,197,0.1); color: var(--accent); border-color: var(--accent); }
        .cpybtn { background: var(--accent); color: #071515; border: none; padding: 7px 14px; border-radius: 6px; font-family: 'Outfit', sans-serif; font-weight: 700; font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: opacity 0.18s; margin-bottom: 10px; }
        .cpybtn:hover { opacity: 0.85; }
        .jscode { font-family: 'JetBrains Mono', monospace; background: #06070e; border: 1px solid var(--border); border-radius: 8px; padding: 12px; font-size: 11px; color: #a9f1e4; white-space: pre; overflow-x: auto; max-height: 280px; line-height: 1.6; }

        /* Headers */
        .hstats { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 12px; }
        .hschip { background: var(--card); border: 1px solid var(--border); border-radius: 6px; padding: 4px 9px; font-size: 11px; display: flex; align-items: center; gap: 5px; }
        .hchip-n { font-weight: 700; }
        .hdrs { display: flex; flex-direction: column; gap: 5px; }
        .hitem { display: flex; align-items: center; gap: 8px; padding: 7px 10px; border-radius: 7px; background: var(--card); border: 1px solid var(--border); cursor: pointer; transition: all 0.15s; }
        .hitem:hover { transform: translateX(3px); background: rgba(255,255,255,0.06); border-color: var(--accent); }
        .htag { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
        .h1t { background: rgba(252,129,129,0.18); color: #fc8181; border: 1px solid rgba(252,129,129,0.3); }
        .h2t { background: rgba(246,173,85,0.18);  color: #f6ad55; border: 1px solid rgba(246,173,85,0.3); }
        .h3t { background: rgba(246,224,94,0.18);  color: #f6e05e; border: 1px solid rgba(246,224,94,0.3); }
        .h4t { background: rgba(104,211,145,0.18); color: #68d391; border: 1px solid rgba(104,211,145,0.3); }
        .h5t { background: rgba(79,209,197,0.18);  color: #4fd1c5; border: 1px solid rgba(79,209,197,0.3); }
        .h6t { background: rgba(99,179,237,0.18);  color: #63b3ed; border: 1px solid rgba(99,179,237,0.3); }
        .htxt { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; font-size: 12px; color: #e2e8f0; min-width: 0; }
        .hwarn { font-size: 9px; font-weight: 800; padding: 1px 5px; border-radius: 3px; text-transform: uppercase; flex-shrink: 0; }
        .hw-d { background: rgba(245,101,101,0.18); color: #fc8181; border: 1px solid rgba(245,101,101,0.3); }
        .hw-e { background: rgba(237,137,54,0.18);  color: #f6ad55; border: 1px solid rgba(237,137,54,0.3); }
        .hw-s { background: rgba(159,122,234,0.18); color: #b794f4; border: 1px solid rgba(159,122,234,0.3); }

        /* Images / Links */
        .stat3 { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 14px; }
        .scard { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 8px; text-align: center; }
        .sval { font-size: 20px; font-weight: 800; color: #fff; }
        .slbl { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; margin-top: 2px; }
        .ilist, .llist { display: flex; flex-direction: column; gap: 8px; }
        .icard { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 10px; display: flex; gap: 10px; cursor: pointer; transition: border-color 0.18s; }
        .icard:hover { border-color: var(--accent); }
        .ithumb { width: 56px; height: 56px; border-radius: 6px; background: repeating-conic-gradient(#1a1a1a 0% 25%,#111 0% 50%) 0 0/8px 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid var(--border); flex-shrink: 0; }
        .ithumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
        .idet { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
        .isrc { font-size: 11px; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
        .imeta { font-size: 10px; color: var(--muted); }
        .lcard { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 9px 11px; display: flex; justify-content: space-between; align-items: center; gap: 8px; }
        .linfo { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
        .lurl { font-size: 11px; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-decoration: none; }
        .lurl:hover { text-decoration: underline; color: var(--accent); }
        .lmeta { display: flex; gap: 5px; }
        .ltag { font-size: 9px; font-weight: 700; color: var(--muted); text-transform: uppercase; }
        .ltag.ext { color: var(--orange); } .ltag.nf { color: var(--red); }
        .lstat { font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 4px; white-space: nowrap; flex-shrink: 0; }
        .ls-p { background: rgba(148,163,184,0.1); color: #94a3b8; }
        .ls-g { background: rgba(72,187,120,0.14); color: #68d391; border: 1px solid rgba(72,187,120,0.25); }
        .ls-o { background: rgba(237,137,54,0.14);  color: #f6ad55; border: 1px solid rgba(237,137,54,0.25); }
        .ls-r { background: rgba(245,101,101,0.14); color: #fc8181; border: 1px solid rgba(245,101,101,0.25); }

        .scrollbox { max-height: 240px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 10px; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
        .scrollbox::-webkit-scrollbar { width: 4px; } .scrollbox::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
        .chkbtn { background: linear-gradient(135deg, var(--purple) 0%,#6366f1 100%); color: #fff; border: none; padding: 9px 16px; border-radius: 8px; font-family: 'Outfit',sans-serif; font-weight: 700; font-size: 12px; cursor: pointer; width: 100%; margin-bottom: 14px; transition: opacity 0.18s; }
        .chkbtn:hover { opacity: 0.88; } .chkbtn:disabled { opacity: 0.45; cursor: not-allowed; }
        .rfbtn { background: rgba(79,209,197,0.1); border: 1px solid rgba(79,209,197,0.25); color: var(--accent); border-radius: 6px; padding: 4px 10px; font-size: 10px; font-weight: 700; cursor: pointer; font-family: 'Outfit',sans-serif; }
        .rfbtn:hover { background: rgba(79,209,197,0.2); }
        .empty { color: var(--muted); text-align: center; padding: 20px 10px; font-size: 12px; line-height: 1.7; }
        `;
        shadow.appendChild(style);

        // ─── HTML ─────────────────────────────────────────────────────
        var panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
        <div class="hdr" id="dh">
            <div class="hdr-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="-webkit-text-fill-color:unset;">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                </svg>
                Codex SEO Audit
            </div>
            <button class="close-btn" id="btn-cls">✕</button>
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
                <div class="summary-card s-fail"><div class="summary-num" id="cnt-fail">–</div><div class="summary-lbl">❌ Errors</div></div>
                <div class="summary-card s-warn"><div class="summary-num" id="cnt-warn">–</div><div class="summary-lbl">⚠ Warnings</div></div>
                <div class="summary-card s-pass"><div class="summary-num" id="cnt-pass">–</div><div class="summary-lbl">✓ Passed</div></div>
            </div>

            <div class="filter-bar">
                <button class="filter-btn active" data-f="all">All</button>
                <button class="filter-btn f-fail" data-f="fail">❌ Errors</button>
                <button class="filter-btn f-warn" data-f="warn">⚠ Warnings</button>
                <button class="filter-btn f-pass" data-f="pass">✓ Passed</button>
            </div>

            <div id="audit-issues"></div>
        </div>

        <!-- Meta Tab -->
        <div class="pane" id="t-meta">
            <div class="sec">Live SERP Preview</div>
            <div class="serp">
                <div class="serp-dom"><div class="serp-fav" id="sf">G</div><div class="serp-domtxt" id="su"></div></div>
                <div class="serp-title" id="stitle">Page Title</div>
                <div class="serp-desc" id="sdesc">Meta description here.</div>
                <div class="serp-clip" id="sclip" style="display:none;">⚠ May be truncated in search results</div>
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
            <button class="cpybtn" id="btn-cp">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy Template
            </button>
            <div class="jscode" id="sc-code"></div>
        </div>

        <!-- Headers Tab -->
        <div class="pane" id="t-headers">
            <div class="sec">Heading Structure <button class="rfbtn" id="btn-rh">↻ Refresh</button></div>
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
            <button class="chkbtn" id="btn-chk">⚡ Check HTTP Status of All Links</button>
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
            window.__cxSeo = false; host.remove();
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
        document.addEventListener('mousemove', function (e) { if (!drg) return; panel.style.left = (psl + e.clientX - dsx) + 'px'; panel.style.top = (pst + e.clientY - dsy) + 'px'; }, true);
        document.addEventListener('mouseup', function () { drg = false; }, true);
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

            // Helper to push a check result
            function check(status, category, icon, title, desc, extra) {
                // status: 'pass' | 'warn' | 'fail'
                checks.push({ status: status, category: category, icon: icon, title: title, desc: desc, extra: extra || null });
            }

            var title       = document.title || '';
            var charset     = document.characterSet || '';
            var lang        = document.documentElement.getAttribute('lang') || '';
            var desc        = (document.querySelector('meta[name="description"]') || {}).content || '';
            var canonical   = ga('link[rel="canonical"]', 'href');
            var robots      = ga('meta[name="robots"]', 'content');
            var viewport    = ga('meta[name="viewport"]', 'content');
            var ogTitle     = ga('meta[property="og:title"]', 'content');
            var ogDesc      = ga('meta[property="og:description"]', 'content');
            var ogImg       = ga('meta[property="og:image"]', 'content');
            var ogUrl       = ga('meta[property="og:url"]', 'content');
            var ogType      = ga('meta[property="og:type"]', 'content');
            var twCard      = ga('meta[name="twitter:card"]', 'content');
            var twTitle     = ga('meta[name="twitter:title"]', 'content');
            var twImg       = ga('meta[name="twitter:image"]', 'content');
            var h1s         = Array.from(document.querySelectorAll('h1'));
            var h2s         = Array.from(document.querySelectorAll('h2'));
            var imgs        = Array.from(document.querySelectorAll('img'));
            var scripts     = Array.from(document.querySelectorAll('script[src]'));
            var links       = Array.from(document.querySelectorAll('link'));
            var favicon     = document.querySelector('link[rel*="icon"]');
            var noindexRobots = robots.toLowerCase().includes('noindex');
            var nofollowRobots = robots.toLowerCase().includes('nofollow');
            var isHttps     = window.location.protocol === 'https:';
            var jsonLd      = document.querySelectorAll('script[type="application/ld+json"]');

            // ── CRITICAL SEO ───────────────────────────────────────────
            if (!title) {
                check('fail', 'seo', '❌', 'Missing Title Tag', 'The page has no <title> tag. This is one of the most important on-page SEO factors and affects how your page appears in search results.', { fix: 'Add <title>Your Page Title Here</title> inside the <head> tag.' });
            } else if (title.length < 30) {
                check('warn', 'seo', '⚠', 'Title Too Short', 'Title is only ' + title.length + ' characters. Short titles may not fully describe your page to search engines.', { value: title, fix: 'Expand the title to 30–60 characters to improve SERP display.' });
            } else if (title.length > 60) {
                check('warn', 'seo', '⚠', 'Title Too Long', 'Title is ' + title.length + ' characters. Google typically truncates titles over 60 characters in search results.', { value: title, fix: 'Shorten the title to 60 characters or fewer.' });
            } else {
                check('pass', 'seo', '✓', 'Title Tag', 'Title is ' + title.length + ' characters — within the optimal 30–60 range.', { value: title });
            }

            if (!desc) {
                check('fail', 'seo', '❌', 'Missing Meta Description', 'No <meta name="description"> found. Search engines often use this as the page snippet in results, affecting click-through rate.', { fix: 'Add <meta name="description" content="120–160 char description"> in the <head>.' });
            } else if (desc.length < 120) {
                check('warn', 'seo', '⚠', 'Meta Description Too Short', 'Description is only ' + desc.length + ' characters. A longer description provides more context for search engines.', { value: desc, fix: 'Expand the description to 120–160 characters.' });
            } else if (desc.length > 160) {
                check('warn', 'seo', '⚠', 'Meta Description Too Long', 'Description is ' + desc.length + ' characters. Google will truncate it after ~160 characters, cutting off your message.', { value: desc, fix: 'Shorten the description to 160 characters or fewer.' });
            } else {
                check('pass', 'seo', '✓', 'Meta Description', 'Description is ' + desc.length + ' characters — well within the 120–160 optimal range.', { value: desc });
            }

            if (!canonical) {
                check('warn', 'seo', '⚠', 'No Canonical URL', 'No <link rel="canonical"> found. Without this, search engines may index duplicate versions of this page.', { fix: 'Add <link rel="canonical" href="https://yourdomain.com/this-page"> in the <head>.' });
            } else {
                check('pass', 'seo', '✓', 'Canonical URL', 'Canonical URL is set correctly.', { value: canonical });
            }

            if (h1s.length === 0) {
                check('fail', 'seo', '❌', 'No H1 Heading Found', 'This page has no H1 heading. H1 is a strong on-page SEO signal that tells search engines the main topic of the page.', { fix: 'Add exactly one H1 tag as the primary heading of the page.' });
            } else if (h1s.length > 1) {
                check('warn', 'seo', '⚠', 'Multiple H1 Headings (' + h1s.length + ')', 'Found ' + h1s.length + ' H1 tags. Use exactly one H1 per page for clear document structure.', { value: h1s.map(function (h) { return h.textContent.trim(); }).join('\n'), fix: 'Keep only one H1 and convert the rest to H2.' });
            } else {
                var h1txt = h1s[0].textContent.trim();
                check('pass', 'seo', '✓', 'Single H1 Heading', 'One H1 found with clear content.', { value: h1txt });
            }

            if (h2s.length === 0) {
                check('warn', 'seo', '⚠', 'No H2 Headings Found', 'No H2 headings found. H2 tags help structure your content and improve crawlability.', { fix: 'Add H2 headings to break your content into logical sections.' });
            } else {
                check('pass', 'seo', '✓', 'H2 Headings Present', h2s.length + ' H2 heading(s) found.', null);
            }

            // ── TECHNICAL ─────────────────────────────────────────────
            if (!isHttps) {
                check('fail', 'tech', '❌', 'Not Served Over HTTPS', 'The page is served over HTTP. HTTPS is a confirmed Google ranking signal and required for user trust and security.', { fix: 'Install an SSL certificate and redirect all HTTP traffic to HTTPS.' });
            } else {
                check('pass', 'tech', '✓', 'HTTPS Enabled', 'Page is served securely over HTTPS.', null);
            }

            if (!viewport) {
                check('fail', 'tech', '❌', 'Missing Viewport Meta Tag', 'No viewport tag found. Without it, mobile devices will render the page at desktop width, making it unreadable on phones.', { fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">' });
            } else if (!viewport.includes('width=device-width')) {
                check('warn', 'tech', '⚠', 'Viewport Not Mobile-Friendly', 'Viewport is set but does not include width=device-width. This may cause mobile rendering issues.', { value: viewport, fix: 'Change to: <meta name="viewport" content="width=device-width, initial-scale=1">' });
            } else {
                check('pass', 'tech', '✓', 'Viewport Tag', 'Viewport is correctly configured for mobile devices.', { value: viewport });
            }

            if (!charset) {
                check('warn', 'tech', '⚠', 'Charset Not Detected', 'No charset declaration detected. A missing charset can cause text rendering issues across browsers.', { fix: 'Add <meta charset="UTF-8"> as the first element inside <head>.' });
            } else if (charset.toLowerCase() !== 'utf-8') {
                check('warn', 'tech', '⚠', 'Non-UTF-8 Charset', 'Charset is set to ' + charset + '. UTF-8 is the recommended universal charset.', { value: charset, fix: 'Change to <meta charset="UTF-8">.' });
            } else {
                check('pass', 'tech', '✓', 'Charset (UTF-8)', 'Page is using UTF-8 encoding — the recommended standard.', null);
            }

            if (!lang) {
                check('warn', 'tech', '⚠', 'Missing Language Attribute', 'The <html> tag has no lang attribute. This is important for accessibility tools and search engines identifying content language.', { fix: 'Add lang="en" (or your language code) to the <html> tag: <html lang="en">' });
            } else {
                check('pass', 'tech', '✓', 'Language Attribute', 'Page language is declared as "' + lang + '".', null);
            }

            if (!favicon) {
                check('warn', 'tech', '⚠', 'No Favicon Found', 'No favicon link tag detected. Favicons improve brand recognition in browser tabs and bookmarks.', { fix: 'Add <link rel="icon" href="/favicon.ico"> or <link rel="icon" href="/favicon.png" type="image/png"> in the <head>.' });
            } else {
                check('pass', 'tech', '✓', 'Favicon', 'Favicon is linked.', null);
            }

            // Render-blocking scripts
            var blocking = scripts.filter(function (s) { return !s.hasAttribute('defer') && !s.hasAttribute('async') && s.getAttribute('type') !== 'module'; });
            if (blocking.length > 0) {
                check('warn', 'tech', '⚠', 'Render-Blocking Scripts (' + blocking.length + ')', blocking.length + ' script(s) loaded synchronously in the <head> without defer or async. This delays page rendering.', { value: blocking.slice(0, 5).map(function (s) { return s.getAttribute('src'); }).join('\n'), fix: 'Add the defer or async attribute to non-critical scripts.' });
            } else {
                check('pass', 'tech', '✓', 'No Render-Blocking Scripts', 'All scripts use defer, async, or are loaded as modules.', null);
            }

            // Robots
            if (noindexRobots) {
                check('fail', 'tech', '❌', 'Page Set to noindex', 'The robots meta tag includes "noindex" — search engines will NOT index this page!', { value: robots, fix: 'Remove noindex from the robots meta tag unless this page should intentionally be hidden from search.' });
            } else if (robots) {
                check('pass', 'tech', '✓', 'Robots Meta Tag', 'Robots tag is present and does not block indexing.', { value: robots });
            } else {
                check('pass', 'tech', '✓', 'Robots (Default)', 'No robots tag — search engines will use the default: index, follow.', null);
            }

            if (nofollowRobots) {
                check('warn', 'tech', '⚠', 'Page Set to nofollow', 'The robots meta tag includes "nofollow" — search engines will not follow links on this page.', { value: robots, fix: 'Remove nofollow if you want links on this page to pass SEO value.' });
            }

            // ── OPEN GRAPH ────────────────────────────────────────────
            if (!ogTitle) {
                check('warn', 'og', '⚠', 'Missing og:title', 'No Open Graph title found. When sharing this page on Facebook, LinkedIn, Slack, or similar platforms, the title will be missing or incorrect.', { fix: 'Add <meta property="og:title" content="Your Page Title">.' });
            } else {
                check('pass', 'og', '✓', 'OG Title', 'og:title is set.', { value: ogTitle });
            }

            if (!ogDesc) {
                check('warn', 'og', '⚠', 'Missing og:description', 'No Open Graph description. Social media preview cards will have no description text.', { fix: 'Add <meta property="og:description" content="A 1–2 sentence description">.' });
            } else {
                check('pass', 'og', '✓', 'OG Description', 'og:description is set.', { value: ogDesc });
            }

            if (!ogImg) {
                check('fail', 'og', '❌', 'Missing og:image', 'No Open Graph image. Links shared on social media will appear without a preview image — significantly reducing click-through rates.', { fix: 'Add <meta property="og:image" content="https://yourdomain.com/og-image.jpg">. Recommended size: 1200×630px.' });
            } else {
                check('pass', 'og', '✓', 'OG Image', 'og:image is set.', { value: ogImg });
            }

            if (!ogUrl) {
                check('warn', 'og', '⚠', 'Missing og:url', 'No og:url defined. Social platforms use this to group likes and shares across URL variants.', { fix: 'Add <meta property="og:url" content="https://yourdomain.com/this-page">.' });
            } else {
                check('pass', 'og', '✓', 'OG URL', 'og:url is set.', { value: ogUrl });
            }

            if (!ogType) {
                check('warn', 'og', '⚠', 'Missing og:type', 'No og:type defined. Social platforms default to "website" but it is best to be explicit.', { fix: 'Add <meta property="og:type" content="website"> (or "article" for blog posts, "product" for e-commerce, etc.).' });
            } else {
                check('pass', 'og', '✓', 'OG Type', 'og:type is set to "' + ogType + '".', null);
            }

            // ── TWITTER CARD ──────────────────────────────────────────
            if (!twCard) {
                check('warn', 'og', '⚠', 'Missing twitter:card', 'No Twitter/X card meta tag. Shared links on X (Twitter) will not show a rich card preview.', { fix: 'Add <meta name="twitter:card" content="summary_large_image">.' });
            } else {
                check('pass', 'og', '✓', 'Twitter Card', 'twitter:card is set to "' + twCard + '".', null);
            }

            if (!twTitle) {
                check('warn', 'og', '⚠', 'Missing twitter:title', 'No twitter:title tag. Twitter may fall back to og:title but it is best practice to define it explicitly.', { fix: 'Add <meta name="twitter:title" content="Your Page Title">.' });
            } else {
                check('pass', 'og', '✓', 'Twitter Title', 'twitter:title is set.', null);
            }

            if (!twImg) {
                check('warn', 'og', '⚠', 'Missing twitter:image', 'No twitter:image tag. X (Twitter) will not show a preview image when this URL is shared.', { fix: 'Add <meta name="twitter:image" content="https://yourdomain.com/og-image.jpg">.' });
            } else {
                check('pass', 'og', '✓', 'Twitter Image', 'twitter:image is set.', null);
            }

            // ── STRUCTURED DATA ────────────────────────────────────────
            if (jsonLd.length === 0 && document.querySelectorAll('[itemscope]').length === 0) {
                check('warn', 'tech', '⚠', 'No Structured Data (Schema)', 'No JSON-LD or Microdata schema markup found. Schema helps search engines understand your content and can unlock rich results (star ratings, FAQs, etc.).', { fix: 'Use the Schema tab above to generate and add JSON-LD markup.' });
            } else {
                check('pass', 'tech', '✓', 'Structured Data Found', jsonLd.length + ' JSON-LD schema block(s) detected.', null);
            }

            // ── IMAGES ────────────────────────────────────────────────
            var noAltImgs = imgs.filter(function (i) { return !i.hasAttribute('alt'); });
            var emptyAltImgs = imgs.filter(function (i) { return i.hasAttribute('alt') && i.getAttribute('alt').trim() === '' && !i.getAttribute('role'); });
            var noSizeImgs = imgs.filter(function (i) { return !i.getAttribute('width') || !i.getAttribute('height'); });
            var eagerImgs = imgs.filter(function (i) { var r = i.getBoundingClientRect(); return r.top > window.innerHeight && i.getAttribute('loading') !== 'lazy'; });

            if (noAltImgs.length > 0) {
                check('fail', 'a11y', '❌', 'Images Missing Alt Text (' + noAltImgs.length + ')', noAltImgs.length + ' image(s) have no alt attribute. This makes them inaccessible to screen readers and blind users.', { value: noAltImgs.slice(0, 3).map(function (i) { return i.getAttribute('src') || 'Unknown src'; }).join('\n'), fix: 'Add descriptive alt="..." text to every image. Use alt="" only for purely decorative images.' });
            } else {
                check('pass', 'a11y', '✓', 'All Images Have Alt Attributes', 'Every image has an alt attribute.', null);
            }

            if (noSizeImgs.length > 0) {
                check('warn', 'perf', '⚠', 'Images Without Explicit Dimensions (' + noSizeImgs.length + ')', noSizeImgs.length + ' image(s) are missing width/height attributes. This causes layout shifts (CLS) as the page loads.', { fix: 'Add width and height attributes to all img tags matching the intrinsic image size.' });
            } else {
                check('pass', 'perf', '✓', 'All Images Have Dimensions', 'All images have width and height attributes.', null);
            }

            if (eagerImgs.length > 0) {
                check('warn', 'perf', '⚠', 'Off-Screen Images Not Lazy-Loaded (' + eagerImgs.length + ')', eagerImgs.length + ' below-the-fold image(s) load eagerly. This wastes bandwidth on initial page load.', { fix: 'Add loading="lazy" to images that are not in the initial viewport.' });
            } else {
                check('pass', 'perf', '✓', 'Off-Screen Images Lazy-Loaded', 'Off-screen images use lazy loading.', null);
            }

            // ── CONTENT ───────────────────────────────────────────────
            var textLen = (document.body && document.body.innerText) ? document.body.innerText.replace(/\s+/g,' ').trim().length : 0;
            if (textLen < 300) {
                check('warn', 'content', '⚠', 'Thin Content', 'The page has very little text content (~' + textLen + ' characters). Search engines prefer pages with substantial, meaningful content.', { fix: 'Add more relevant, unique content — aim for at least 300+ words on important pages.' });
            } else {
                check('pass', 'content', '✓', 'Content Length', 'Page has substantial text content (~' + textLen + ' characters).', null);
            }

            // Check for duplicate title and H1
            if (title && h1s.length === 1) {
                var h1txt2 = h1s[0].textContent.trim().toLowerCase();
                if (title.toLowerCase() === h1txt2) {
                    check('warn', 'content', '⚠', 'Title and H1 Are Identical', 'The page title and H1 heading have the same text. While not a hard rule, differentiated title/H1 can target a wider range of keywords.', { fix: 'Consider making the H1 a slight variation of the title to target additional keyword variations.' });
                }
            }

            // Internal links
            var internalLinks = Array.from(document.querySelectorAll('a[href]')).filter(function (a) {
                var href = a.getAttribute('href') || '';
                return href.startsWith('/') || href.startsWith(window.location.origin) || href.startsWith('#');
            });
            if (internalLinks.length === 0) {
                check('warn', 'content', '⚠', 'No Internal Links', 'No internal links found on this page. Internal links help search engines discover content and pass SEO authority across your site.', { fix: 'Add relevant internal links to other pages on your site.' });
            } else {
                check('pass', 'content', '✓', 'Internal Links (' + internalLinks.length + ')', internalLinks.length + ' internal link(s) found — good for crawlability.', null);
            }

            // ── RENDER RESULTS ──────────────────────────────────────
            var fails = checks.filter(function (c) { return c.status === 'fail'; }).length;
            var warns = checks.filter(function (c) { return c.status === 'warn'; }).length;
            var passes = checks.filter(function (c) { return c.status === 'pass'; }).length;
            var total = checks.length;
            var score = Math.round((passes / total) * 100);

            // Ring
            var ringEl = shadow.getElementById('ring');
            var ringTxt = shadow.getElementById('ring-score');
            var circ = 188.5;
            var ringColor = score >= 80 ? '#48bb78' : score >= 50 ? '#ed8936' : '#f56565';
            ringEl.style.stroke = ringColor;
            ringEl.style.strokeDasharray = circ + ' ' + circ;
            ringTxt.textContent = score;
            setTimeout(function () { ringEl.style.strokeDashoffset = circ - (score / 100) * circ; }, 80);

            var grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor';
            var gradeBg = score >= 90 ? 'rgba(72,187,120,0.14)' : score >= 75 ? 'rgba(79,209,197,0.14)' : score >= 50 ? 'rgba(237,137,54,0.14)' : 'rgba(245,101,101,0.14)';
            var gradeColor = score >= 90 ? '#68d391' : score >= 75 ? '#4fd1c5' : score >= 50 ? '#f6ad55' : '#fc8181';
            shadow.getElementById('score-title').textContent = 'SEO Score: ' + score + '/100';
            shadow.getElementById('score-desc').textContent = fails + ' critical error' + (fails !== 1 ? 's' : '') + ', ' + warns + ' warning' + (warns !== 1 ? 's' : '') + ', ' + passes + ' passed checks out of ' + total + ' total.';
            var gradeEl = shadow.getElementById('score-grade');
            gradeEl.textContent = grade;
            Object.assign(gradeEl.style, { background: gradeBg, color: gradeColor, border: '1px solid ' + ringColor + '55' });

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
                    var group = visible.filter(function (c) { return c.status === st; });
                    group.forEach(function (c) {
                        var d = document.createElement('div');
                        d.className = 'audit-issue ' + c.status;
                        var extra = '';
                        if (c.extra) {
                            if (c.extra.value) extra += '<code class="audit-value">' + esc(c.extra.value) + '</code>';
                            if (c.extra.fix) extra += '<span class="audit-fix">💡 ' + esc(c.extra.fix) + '</span>';
                        }
                        d.innerHTML = '<div class="audit-icon">' + c.icon + '</div>' +
                            '<div class="audit-body"><div class="audit-title">' + esc(c.title) + '</div>' +
                            '<div class="audit-desc">' + esc(c.desc) + '</div>' + extra + '</div>';
                        container.appendChild(d);
                    });
                });
            }

            renderChecks('all');

            // Filter buttons
            shadow.querySelectorAll('.filter-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    shadow.querySelectorAll('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                    renderChecks(btn.dataset.f);
                });
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // META TAB
        // ═══════════════════════════════════════════════════════════════
        function runMeta() {
            var title = document.title || '';
            var desc = (document.querySelector('meta[name="description"]') || {}).content || '';
            var charset = document.characterSet || '';
            var canonical = ga('link[rel="canonical"]', 'href');
            var robots = ga('meta[name="robots"]', 'content');
            var viewport = ga('meta[name="viewport"]', 'content');
            var lang = document.documentElement.getAttribute('lang') || '';
            var ogTitle = ga('meta[property="og:title"]', 'content');
            var ogDesc = ga('meta[property="og:description"]', 'content');
            var ogImg = ga('meta[property="og:image"]', 'content');
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
                { n: 'Title Tag', v: title || 'Not set', ok: title.length >= 30 && title.length <= 60, msg: !title ? 'Missing' : 'Length: ' + title.length + ' (30–60 optimal)' },
                { n: 'Meta Description', v: desc || 'Not set', ok: desc.length >= 120 && desc.length <= 160, msg: !desc ? 'Missing' : 'Length: ' + desc.length + ' (120–160 optimal)' },
                { n: 'Charset', v: charset || 'Not detected', ok: charset.toLowerCase() === 'utf-8', msg: 'Should be UTF-8' },
                { n: 'Canonical URL', v: canonical || 'Not set', ok: !!canonical, msg: 'Missing — may cause duplicate content' },
                { n: 'Viewport', v: viewport || 'Not set', ok: viewport.includes('width=device-width'), msg: 'Missing or incorrect' },
                { n: 'Robots', v: robots || 'index, follow (default)', ok: !robots.includes('noindex'), msg: 'noindex set!' },
                { n: 'Language (lang attr)', v: lang || 'Not set', ok: !!lang, msg: 'Missing on <html> tag' },
                { n: 'og:title', v: ogTitle || 'Not set', ok: !!ogTitle, msg: 'Missing' },
                { n: 'og:description', v: ogDesc || 'Not set', ok: !!ogDesc, msg: 'Missing' },
                { n: 'og:image', v: ogImg || 'Not set', ok: !!ogImg, msg: 'Missing — social cards will be imageless' },
                { n: 'og:url', v: ogUrl || 'Not set', ok: !!ogUrl, msg: 'Missing' },
                { n: 'og:type', v: ogType || 'Not set', ok: !!ogType, msg: 'Missing (use "website" or "article")' },
                { n: 'twitter:card', v: twCard || 'Not set', ok: !!twCard, msg: 'Missing' },
                { n: 'twitter:title', v: twTitle || 'Not set', ok: !!twTitle, msg: 'Missing' },
                { n: 'twitter:image', v: twImg || 'Not set', ok: !!twImg, msg: 'Missing' },
                { n: 'HTTPS', v: window.location.protocol === 'https:' ? 'Yes' : 'No — using HTTP', ok: window.location.protocol === 'https:', msg: 'Switch to HTTPS' }
            ];

            var mlist = shadow.getElementById('mlist'); mlist.innerHTML = '';
            rows.forEach(function (row) {
                var d = document.createElement('div'); d.className = 'mrow';
                d.innerHTML = '<div class="mrow-head"><span class="mrow-name">' + esc(row.n) + '</span>' +
                    '<span class="audit-badge ' + (row.ok ? 'ab-pass' : 'ab-warn') + '">' + (row.ok ? '✓ OK' : '⚠ ' + esc(row.msg)) + '</span></div>' +
                    '<div class="mrow-val' + (row.v === 'Not set' ? ' miss' : '') + '">' + esc(row.v) + '</div>';
                mlist.appendChild(d);
            });
        }

        // ═══════════════════════════════════════════════════════════════
        // SCHEMA TAB
        // ═══════════════════════════════════════════════════════════════
        function runSchema() {
            var scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            var found = scripts.map(function (s) {
                var raw = s.textContent || ''; var parsed = null; var valid = true;
                try { parsed = JSON.parse(raw); } catch (e) { valid = false; }
                return { raw: raw, parsed: parsed, valid: valid };
            });
            var microdata = document.querySelectorAll('[itemscope]').length;
            shadow.getElementById('sc-cnt').textContent = found.length + ' JSON-LD' + (microdata ? ' + ' + microdata + ' Microdata' : '');
            var fl = shadow.getElementById('sc-found'); fl.innerHTML = '';
            if (!found.length && !microdata) {
                fl.innerHTML = '<div class="empty">🔍 No structured data found on this page.<br>Use the generator below to create Schema markup.</div>';
            } else {
                found.forEach(function (s, i) {
                    var type = (s.parsed && s.parsed['@type']) || 'Structured Data';
                    var d = document.createElement('div'); d.className = 'mrow'; d.style.marginBottom = '8px';
                    d.innerHTML = '<div class="mrow-head"><span class="mrow-name">' + esc(type) + ' (' + (i + 1) + ')</span>' +
                        '<span class="audit-badge ' + (s.valid ? 'ab-pass' : 'ab-fail') + '">' + (s.valid ? '✓ Valid JSON-LD' : '✕ Invalid JSON') + '</span></div>' +
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
                    var o = btn.innerHTML; btn.textContent = '✓ Copied!';
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
                var tid = '_cxh' + idx; el.setAttribute('data-cxh', tid);
                outline.push({ lv: lv, text: isEmpty ? '(empty)' : text, isEmpty: isEmpty, isDup: isDup, isSkip: isSkip, tid: tid });
            });
            var sh = '';
            ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].forEach(function (tag) { if (counts[tag]) sh += '<div class="hschip"><span class="htag ' + tag + 't">' + tag.toUpperCase() + '</span><span class="hchip-n">' + counts[tag] + '</span></div>'; });
            if (counts.h1 > 1) sh += '<div class="hschip" style="border-color:rgba(245,101,101,0.3);color:#fc8181;font-size:10px;font-weight:700;">⚠ Multiple H1s</div>';
            if (counts.h1 === 0) sh += '<div class="hschip" style="border-color:rgba(245,101,101,0.3);color:#fc8181;font-size:10px;font-weight:700;">⚠ No H1</div>';
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
                    var t = document.querySelector('[data-cxh="' + h.tid + '"]');
                    if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); var p = t.style.outline; t.style.outline = '3px solid #9F7AEA'; t.style.outlineOffset = '3px'; setTimeout(function () { t.style.outline = p; t.style.outlineOffset = ''; }, 1800); toast('→ ' + h.text.substring(0, 28)); }
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
                var src = img.src || img.getAttribute('src') || '';
                var hasAlt = img.hasAttribute('alt'), alt = img.getAttribute('alt') || '', isD = hasAlt && alt.trim() === '';
                if (!hasAlt) noAlt++; if (isD) dec++;
                var w = img.naturalWidth || parseInt(img.getAttribute('width')) || 0, h = img.naturalHeight || parseInt(img.getAttribute('height')) || 0;
                if (!w || !h) { var r = img.getBoundingClientRect(); w = Math.round(r.width); h = Math.round(r.height); }
                var tid = '_cxi' + idx; img.setAttribute('data-cxi', tid);
                var fname = src.startsWith('data:') ? 'Inline Data URI' : (src.split('/').pop().split('?')[0] || 'image');
                var ab = !hasAlt ? '<span class="audit-badge ab-fail" style="margin-top:3px;">⚠ Missing alt</span>' : isD ? '<span class="audit-badge ab-warn" style="margin-top:3px;">Decorative</span>' : '<div style="font-size:11px;color:#81e6d9;margin-top:2px;">Alt: "' + esc(alt) + '"</div>';
                var card = document.createElement('div'); card.className = 'icard';
                card.innerHTML = '<div class="ithumb"><img src="' + esc(src) + '" loading="lazy" onerror="this.style.opacity=\'0.15\'" alt="' + esc(alt) + '"></div>' +
                    '<div class="idet"><div class="isrc" title="' + esc(src) + '">' + esc(fname) + '</div>' +
                    '<div class="imeta">' + (w && h ? w + '×' + h + 'px' : 'Size unknown') + (img.getAttribute('loading') === 'lazy' ? ' · lazy' : ' · eager') + '</div>' + ab + '</div>';
                card.addEventListener('click', function () {
                    var t = document.querySelector('[data-cxi="' + tid + '"]');
                    if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); var p = t.style.outline; t.style.outline = '3px solid #4FD1C5'; t.style.outlineOffset = '3px'; setTimeout(function () { t.style.outline = p; t.style.outlineOffset = ''; }, 1800); }
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
            var anchors = Array.from(document.querySelectorAll('a[href]'));
            var inCnt = 0, exCnt = 0; linksData = [];
            var origin = window.location.origin;
            anchors.forEach(function (a, idx) {
                var href = a.getAttribute('href') || '', resolved = '';
                try { resolved = new URL(href, window.location.href).href; } catch (e) { resolved = href; }
                var isInt = resolved.startsWith(origin) || href.startsWith('/') || href.startsWith('#') || href.startsWith('.');
                var isNF = (a.getAttribute('rel') || '').includes('nofollow');
                if (isInt) inCnt++; else exCnt++;
                linksData.push({ url: resolved, href: href, isInt: isInt, isNF: isNF, idx: idx });
            });
            shadow.getElementById('li').textContent = inCnt;
            shadow.getElementById('le').textContent = exCnt;
            shadow.getElementById('lb').textContent = '0';
            var cont = shadow.getElementById('llist'); cont.innerHTML = '';
            if (!linksData.length) { cont.innerHTML = '<div class="empty">No links found on this page.</div>'; return; }
            linksData.forEach(function (item) {
                var card = document.createElement('div'); card.className = 'lcard';
                card.innerHTML = '<div class="linfo"><a href="' + esc(item.url) + '" class="lurl" target="_blank" title="' + esc(item.url) + '">' + esc(item.url) + '</a>' +
                    '<div class="lmeta"><span class="ltag' + (item.isInt ? '' : ' ext') + '">' + (item.isInt ? 'Internal' : 'External') + '</span>' +
                    (item.isNF ? '<span class="ltag nf">Nofollow</span>' : '') + '</div></div>' +
                    '<div class="lstat ls-p" id="ls-' + item.idx + '">–</div>';
                cont.appendChild(card);
            });
            var btn = shadow.getElementById('btn-chk');
            btn.onclick = function () {
                btn.disabled = true; btn.textContent = 'Checking ' + linksData.length + ' links…';
                var done = 0, broken = 0, total = linksData.length;
                if (!total) { btn.disabled = false; btn.textContent = '⚡ Check HTTP Status'; return; }
                function onDone() { done++; shadow.getElementById('lb').textContent = broken; if (done >= total) { btn.disabled = false; btn.textContent = '↻ Recheck Links'; toast('Checked ' + total + ' links · ' + broken + ' broken'); } }
                linksData.forEach(function (item) {
                    var badge = shadow.getElementById('ls-' + item.idx);
                    if (badge) { badge.textContent = '…'; badge.className = 'lstat ls-p'; }
                    var ctrl = new AbortController(), tmr = setTimeout(function () { ctrl.abort(); }, 8000);
                    fetch(item.url, { method: 'HEAD', signal: ctrl.signal, cache: 'no-cache', redirect: 'follow' })
                        .then(function (r) { clearTimeout(tmr); var s = r.status; if (badge) { badge.textContent = s; badge.className = 'lstat ' + (s >= 200 && s < 300 ? 'ls-g' : s >= 300 && s < 400 ? 'ls-o' : 'ls-r'); } if (s >= 400) broken++; onDone(); })
                        .catch(function (err) { clearTimeout(tmr); var ab = err && err.name === 'AbortError'; if (badge) { badge.className = 'lstat ' + (ab ? 'ls-o' : 'ls-r'); badge.textContent = ab ? 'TIMEOUT' : 'ERR'; } if (!ab) broken++; onDone(); });
                });
            };
        }

        // ─── BOOT ─────────────────────────────────────────────────────
        try { runAudit(); }   catch (e) { console.error('[Codex SEO] Audit:', e); }
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
