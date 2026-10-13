(function () {
    console.log("[Codex Asset Extractor] Script Injected.");
    const HOST_ID = 'codex-asset-extractor-host';

    // ---------------------------------------------------------
    // 1. IFrame Worker Logic (Runs in all frames)
    // ---------------------------------------------------------
    const isTopFrame = window === window.top;
    console.log(`[Codex Asset Extractor] Running in ${isTopFrame ? 'TOP FRAME' : 'IFRAME'} (${window.location.href})`);

    function extractAssetsFromFrame() {
        const assets = new Map(); // URL -> Asset Data
        let assetCount = 0;

        function addAsset(url, type, sourceEl, extra) {
            if (!url || typeof url !== 'string') return;
            url = url.trim();
            if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;

            // Try to resolve relative URLs
            try { url = new URL(url, window.location.href).href; } catch (e) { return; }
            if (!/^https?:/.test(url)) return;

            if (!assets.has(url)) {
                let format = url.split('.').pop().split(/#|\?/)[0].toLowerCase();
                if (format.length > 5) format = 'unknown';
                if (!format && type === 'image') format = 'img';
                if ((format === 'unknown' || !format) && (type === 'video' || type === 'audio')) format = type;

                assets.set(url, Object.assign({
                    url: url,
                    type: type,
                    format: format,
                    frameUrl: window.location.href,
                    id: `asset-${Date.now()}-${assetCount++}`
                }, extra || {}));
            } else if (extra) {
                // Keep the richest details (e.g. a poster found later)
                const a = assets.get(url);
                Object.keys(extra).forEach(k => { if (a[k] == null) a[k] = extra[k]; });
            }
        }

        // querySelectorAll that also looks inside open shadow roots (web
        // components, custom video players)
        const shadowRoots = [];
        (function collectRoots(root) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
            let node = walker.nextNode();
            while (node) {
                if (node.shadowRoot && node.id !== HOST_ID) {
                    shadowRoots.push(node.shadowRoot);
                    collectRoots(node.shadowRoot);
                }
                node = walker.nextNode();
            }
        })(document);
        function deepQueryAll(selector) {
            const out = Array.from(document.querySelectorAll(selector));
            shadowRoots.forEach(r => { try { out.push(...r.querySelectorAll(selector)); } catch (e) { } });
            return out;
        }

        // 1. Images
        document.querySelectorAll('img').forEach(img => {
            addAsset(img.src, 'image', img);
            if (img.srcset) {
                img.srcset.split(',').forEach(part => {
                    const src = part.trim().split(' ')[0];
                    if (src) addAsset(src, 'image', img);
                });
            }
        });

        // 2. Videos & Audio (deep)
        const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv)(?:[?#]|$)/i;
        const AUDIO_EXT = /\.(mp3|m4a|aac|wav|oga|ogg|flac|opus)(?:[?#]|$)/i;
        const STREAM_EXT = /\.(m3u8|mpd)(?:[?#]|$)/i;
        // Pieces of an adaptive stream, not whole files
        const SEGMENT = /(?:[?&](?:range|bytestart|byteend|sq)=|\/(?:seg|segment|chunk|frag|fragment|init)[-_]?\d*[^/]*$)/i;
        const mediaKind = url => VIDEO_EXT.test(url) ? 'video' : AUDIO_EXT.test(url) ? 'audio' : STREAM_EXT.test(url) ? 'stream' : null;
        function addMedia(url, kind, extra) {
            if (!url) return;
            kind = kind || mediaKind(url);
            if (!kind) return;
            if (kind === 'stream') {
                extra = Object.assign({ stream: true }, extra);
                kind = 'video';
            }
            addAsset(url, kind, null, extra);
        }
        function addPoster(url) { if (url) addAsset(url, 'image', null); }

        deepQueryAll('video, audio').forEach(media => {
            const type = media.tagName.toLowerCase();
            const poster = type === 'video' ? (media.poster || media.getAttribute('data-poster') || '') : '';
            let extra;
            try { if (poster) extra = { poster: new URL(poster, location.href).href }; } catch (e) { }
            addPoster(poster);
            // currentSrc is the source the browser actually picked
            [media.currentSrc, media.src, media.getAttribute('data-src'), media.getAttribute('data-video-src')].forEach(u => {
                if (u) addMedia(u, mediaKind(u) || type, extra);
            });
            media.querySelectorAll('source').forEach(source => {
                const u = source.src || source.getAttribute('data-src') || source.getAttribute('data-srcset');
                if (u) addMedia(u, mediaKind(u) || type, extra);
            });
            media.querySelectorAll('track[src]').forEach(t => addAsset(t.src, 'subtitle', null, { format: 'vtt' }));
            // Streamed through MediaSource (blob: URL): no file to save, but
            // the page's network log below usually holds the playlist
            if ((media.currentSrc || media.src || '').startsWith('blob:')) {
                addAsset(location.href + '#codex-stream-' + assetCount, 'video', null, {
                    format: 'stream', streamOnly: true, poster: extra && extra.poster,
                    title: document.title || 'Streamed video'
                });
            }
        });

        // Lazy-loaded and background videos kept in data attributes
        const LAZY_ATTRS = ['data-src', 'data-video', 'data-video-src', 'data-video-url', 'data-bg-video', 'data-mp4', 'data-webm', 'data-hls', 'data-stream', 'data-url', 'data-file'];
        deepQueryAll(LAZY_ATTRS.map(a => '[' + a + ']').join(',')).forEach(el => {
            LAZY_ATTRS.forEach(attr => { const v = el.getAttribute(attr); if (v && v.length < 2048) addMedia(v); });
        });

        // Links straight to media files
        deepQueryAll('a[href]').forEach(a => addMedia(a.getAttribute('href')));

        // Social / SEO metadata
        document.querySelectorAll('meta[property^="og:video"], meta[property^="og:audio"], meta[name^="twitter:player:stream"]').forEach(m => {
            const v = m.getAttribute('content');
            if (v && /^(https?:)?\/\//.test(v) && !/:(type|width|height)$/.test(m.getAttribute('property') || '')) {
                addMedia(v, mediaKind(v) || (/audio/.test(m.getAttribute('property')) ? 'audio' : 'video'));
            }
        });
        document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
            try {
                const walk = o => {
                    if (!o || typeof o !== 'object') return;
                    if (Array.isArray(o)) { o.forEach(walk); return; }
                    if (/VideoObject|AudioObject/.test(o['@type'] || '')) {
                        const poster = Array.isArray(o.thumbnailUrl) ? o.thumbnailUrl[0] : o.thumbnailUrl;
                        if (o.contentUrl) addMedia(o.contentUrl, mediaKind(o.contentUrl) || (/Audio/.test(o['@type']) ? 'audio' : 'video'), { poster, title: o.name });
                        else if (o.embedUrl) addEmbed(o.embedUrl, o.name, poster);
                    }
                    Object.values(o).forEach(walk);
                };
                walk(JSON.parse(s.textContent));
            } catch (e) { }
        });

        // Embedded players (YouTube, Vimeo, ...). These can't be saved as a
        // file, but they are shown with a link.
        function addEmbed(src, title, poster) {
            let u;
            try { u = new URL(src, location.href); } catch (e) { return; }
            let provider = null, thumb = poster || null, watch = u.href;
            const yt = u.hostname.match(/(?:^|\.)(?:youtube(?:-nocookie)?\.com|youtu\.be)$/) &&
                (u.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/) || (u.searchParams.get('v') || '').match(/^([\w-]{11})$/) || (u.hostname === 'youtu.be' && u.pathname.match(/^\/([\w-]{11})/)));
            if (yt) {
                provider = 'youtube';
                thumb = thumb || 'https://i.ytimg.com/vi/' + yt[1] + '/hqdefault.jpg';
                watch = 'https://www.youtube.com/watch?v=' + yt[1];
            } else if (/(?:^|\.)vimeo\.com$/.test(u.hostname)) {
                const id = u.pathname.match(/\/(?:video\/)?(\d+)/);
                if (!id) return;
                provider = 'vimeo'; watch = 'https://vimeo.com/' + id[1];
            } else if (/(?:^|\.)(?:wistia\.(?:com|net)|loom\.com|dailymotion\.com|streamable\.com|player\.twitch\.tv|tiktok\.com|facebook\.com\/plugins\/video)/.test(u.hostname + u.pathname)) {
                provider = u.hostname.replace(/^(www|player|fast|embed)\./, '').split('.')[0];
            }
            if (!provider) return;
            addAsset(watch, 'video', null, { format: provider, embed: true, poster: thumb, title: title || null });
        }
        deepQueryAll('iframe[src], iframe[data-src], lite-youtube[videoid], [data-youtube-id], [data-video-id][data-provider]').forEach(el => {
            const id = el.getAttribute('videoid') || el.getAttribute('data-youtube-id');
            if (id) addEmbed('https://www.youtube.com/embed/' + id, el.getAttribute('title'));
            else addEmbed(el.getAttribute('src') || el.getAttribute('data-src'), el.getAttribute('title'));
        });

        // Everything the page has already downloaded: catches videos added by
        // JavaScript players and the playlists behind streamed (blob:) video
        try {
            performance.getEntriesByType('resource').forEach(entry => {
                const name = entry.name;
                if (!/^https?:/.test(name)) return;
                const kind = mediaKind(name) || (entry.initiatorType === 'video' || entry.initiatorType === 'audio' ? entry.initiatorType : null);
                if (!kind || (kind !== 'stream' && SEGMENT.test(name))) return;
                addMedia(name, kind);
            });
        } catch (e) { }
        // A real playlist or file was found: drop the "streamed video" placeholders
        const placeholders = Array.from(assets.values()).filter(a => a.streamOnly);
        if (placeholders.length && Array.from(assets.values()).some(a => a.stream || (a.type === 'video' && !a.streamOnly && !a.embed))) {
            placeholders.forEach(a => assets.delete(a.url));
        }

        // 3. Links (Icons, Stylesheets for fonts etc.)
        document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(link => {
            addAsset(link.href, 'image', link);
        });

        // Fonts preloads
        document.querySelectorAll('link[rel="preload"][as="font"]').forEach(link => {
            addAsset(link.href, 'font', link);
        });

        // Deep Fonts (CSS @font-face)
        try {
            Array.from(document.styleSheets).forEach(sheet => {
                try {
                    if (sheet.cssRules) {
                        Array.from(sheet.cssRules).forEach(rule => {
                            if (rule.type === CSSRule.FONT_FACE_RULE && rule.style.src) {
                                const urls = rule.style.src.match(/url\(['"]?(.*?)['"]?\)/g);
                                if (urls) {
                                    urls.forEach(u => {
                                        let cleanUrl = u.replace(/url\(['"]?(.*?)['"]?\)/, '$1');
                                        // Ignore data URIs for fonts to prevent huge blobs
                                        if (!cleanUrl.startsWith('data:')) {
                                            if (cleanUrl.startsWith('//')) cleanUrl = window.location.protocol + cleanUrl;
                                            addAsset(cleanUrl, 'font', null);
                                        }
                                    });
                                }
                            }
                        });
                    }
                } catch (e) { /* Ignore CORS stylesheet errors */ }
            });
        } catch (e) { }

        // 4. Background Images & Fonts via Computed Styles
        const allElements = document.querySelectorAll('*');
        allElements.forEach(el => {
            try {
                const style = window.getComputedStyle(el);

                // Background images
                const bgImage = style.backgroundImage;
                if (bgImage && bgImage !== 'none') {
                    const urls = bgImage.match(/url\(['"]?(.*?)['"]?\)/g);
                    if (urls) {
                        urls.forEach(u => {
                            const cleanUrl = u.replace(/url\(['"]?(.*?)['"]?\)/, '$1');
                            addAsset(cleanUrl, 'image', el);
                        });
                    }
                }

                // Cursor images
                const cursor = style.cursor;
                if (cursor && cursor.includes('url')) {
                    const urls = cursor.match(/url\(['"]?(.*?)['"]?\)/g);
                    if (urls) {
                        urls.forEach(u => {
                            const cleanUrl = u.replace(/url\(['"]?(.*?)['"]?\)/, '$1');
                            addAsset(cleanUrl, 'image', el);
                        });
                    }
                }

                // List style image
                const listImg = style.listStyleImage;
                if (listImg && listImg !== 'none') {
                    const match = listImg.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match) addAsset(match[1], 'image', el);
                }

            } catch (e) { /* Ignore CORS or security errors on style access */ }
        });

        // 5. Lottie animations. The file is JSON (or a zipped .lottie); the
        // <svg> the player draws is just the current frame. Collect likely
        // sources here; the top frame downloads and validates them.
        const LOTTIE_FILE = /\.(json|lottie)(?:[?#]|$)/i;
        function addLottie(value, trusted) {
            if (!value) return;
            value = value.trim();
            if (value.charAt(0) === '{') {
                // Inline animation JSON (e.g. <lottie-player src='{...}'>)
                const key = 'lottie-inline:' + value.length + ':' + value.slice(0, 64);
                if (!assets.has(key)) assets.set(key, { url: key, type: 'lottie', format: 'json', inlineJson: value, frameUrl: window.location.href, id: `asset-${Date.now()}-${assetCount++}` });
                return;
            }
            let url;
            try { url = new URL(value, window.location.href).href; } catch (e) { return; }
            if (!/^https?:/.test(url) || (!trusted && !LOTTIE_FILE.test(url))) return;
            const key = 'lottie:' + url;
            if (!assets.has(key)) {
                assets.set(key, {
                    url: url, type: 'lottie', format: /\.lottie(?:[?#]|$)/i.test(url) ? 'lottie' : 'json',
                    frameUrl: window.location.href, id: `asset-${Date.now()}-${assetCount++}`
                });
            }
        }
        document.querySelectorAll('lottie-player[src], dotlottie-player[src], dotlottie-wc[src], lottie-interactive[path]').forEach(el => {
            addLottie(el.getAttribute('src') || el.getAttribute('path'), true);
        });
        // Webflow, and common data-attribute conventions
        document.querySelectorAll('[data-animation-type="lottie"][data-src], [data-lottie-src], [data-lottie-path], [data-animation-path], [data-lottie], [data-anim-path]').forEach(el => {
            ['data-src', 'data-lottie-src', 'data-lottie-path', 'data-animation-path', 'data-lottie', 'data-anim-path'].forEach(attr => {
                const v = el.getAttribute(attr);
                if (v) addLottie(v, attr !== 'data-lottie' || /[./]/.test(v));
            });
        });
        // Files the page has already downloaded (lottie-web loads by XHR)
        try {
            performance.getEntriesByType('resource').forEach(entry => {
                if (LOTTIE_FILE.test(entry.name) && !/manifest\.json|\/wp-json\/|\/api\//i.test(entry.name)) addLottie(entry.name, false);
            });
        } catch (e) { }

        // Rendered by a Lottie player (lottie-web ids its defs __lottie_element_N)
        const isLottieSvg = svg => !!svg.querySelector('[id^="__lottie_element"]') ||
            !!(svg.parentElement && svg.parentElement.closest('lottie-player, dotlottie-player, dotlottie-wc, [data-animation-type="lottie"]'));

        // 6. Embedded SVGs and <use> tags
        document.querySelectorAll('svg').forEach(svg => {
            try {
                // A frame of a Lottie animation, not a real SVG asset. Keep it
                // only as a fallback preview in case the source can't be found.
                const lottieFrame = isLottieSvg(svg);
                if (lottieFrame && svg.parentElement && svg.parentElement.closest('svg')) return;
                // If it has no width/height and isn't a sprite master, skip
                const rect = svg.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0 && svg.children.length === 0) return;

                // Handle <use> tags pointing to external SVG sheets
                svg.querySelectorAll('use').forEach(use => {
                    const href = use.getAttribute('href') || use.getAttribute('xlink:href');
                    if (href && href.includes('.svg')) {
                        const cleanUrl = href.split('#')[0];
                        addAsset(cleanUrl, 'vector', use);
                    }
                });

                // Ensure it has basic namespace
                const serializer = new XMLSerializer();
                let source = serializer.serializeToString(svg);
                if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
                    source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
                }
                if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
                    source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
                }
                const encodedUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(source);

                if (lottieFrame) {
                    assets.set('lottie-frame:' + assetCount, {
                        url: encodedUrl, type: 'lottie', format: 'svg', unresolved: true, isDataUri: true,
                        frameUrl: window.location.href, id: `asset-${Date.now()}-${assetCount++}`
                    });
                    return;
                }

                assets.set(encodedUrl, {
                    url: encodedUrl,
                    type: 'vector',
                    format: 'svg',
                    frameUrl: window.location.href,
                    id: `asset-${Date.now()}-${assetCount++}`,
                    isDataUri: true
                });
            } catch (e) { }
        });

        const assetArray = Array.from(assets.values());

        if (!isTopFrame) {
            // Send back to top frame
            window.top.postMessage({ type: 'CODEX_ASSETS_FOUND', assets: assetArray }, '*');
        }

        return assetArray;
    }

    // Run extraction
    const localAssets = extractAssetsFromFrame();

    // ---------------------------------------------------------
    // 2. Top Frame UI Logic
    // ---------------------------------------------------------
    if (!isTopFrame) return;

    if (window.CodexAssetExtractorActive) {
        // Toggle OFF
        window.CodexAssetExtractorActive = false;
        if (window.__codexAssetMessageHandler) {
            window.removeEventListener('message', window.__codexAssetMessageHandler);
            window.__codexAssetMessageHandler = null;
        }
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        // Stop the Lottie previews (this world's player only, not the page's)
        try { if (globalThis.lottie && globalThis.lottie.destroy) globalThis.lottie.destroy(); } catch (e) { }
        return;
    }

    window.CodexAssetExtractorActive = true;
    let allDiscoveredAssets = [...localAssets];

    // Listen for iframe assets — stored on window so the toggle-OFF branch
    // above (which runs on the *next* fresh injection of this script) can
    // remove the exact same listener reference instead of leaking it.
    window.__codexAssetMessageHandler = function (event) {
        if (event.data && event.data.type === 'CODEX_ASSETS_FOUND') {
            const newAssets = event.data.assets || [];
            // Merge deduplicate based on URL
            const existingUrls = new Set(allDiscoveredAssets.map(a => a.url));
            newAssets.forEach(a => {
                if (!existingUrls.has(a.url)) {
                    allDiscoveredAssets.push(a);
                    existingUrls.add(a.url);
                }
            });
            renderAssetGrid();
            updateCounts();
            resolveLotties();
        }
    };
    window.addEventListener('message', window.__codexAssetMessageHandler);

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
    const ic = (name, size) => window.CodexUI ? window.CodexUI.icon(name, size || 14) : '';

    const style = document.createElement('style');
    style.textContent = `
        :host {
            --bg: #121316;
            --bg-panel: #16171a;
            --bg-inset: #1d1e22;
            --border: rgba(255,255,255,0.08);
            --border-strong: rgba(255,255,255,0.14);
            --text: #ececef;
            --text-muted: #9b9ca4;
            --accent: #4fd1c5;
            --accent-text: #5fd8cc;
            --accent-soft: rgba(79,209,197,0.12);
            --on-accent: #07201d;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
            color: var(--text);
            font-size: 13px;
            line-height: 1.5;
            box-sizing: border-box;
            -webkit-font-smoothing: antialiased;
        }

        :host * { box-sizing: border-box; }
        .cx-icon { flex-shrink: 0; display: inline-block; vertical-align: middle; }
        button { font-family: inherit; }
        :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

        .extractor-panel {
            position: fixed;
            top: 12px;
            right: 12px;
            width: 400px;
            height: calc(100vh - 24px);
            background: var(--bg);
            border: 1px solid var(--border-strong);
            border-radius: 10px;
            box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 24px 60px -16px rgba(0,0,0,0.7);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 10000;
            animation: panelIn 0.35s cubic-bezier(0.16,1,0.3,1);
        }
        @keyframes panelIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: none; } }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            height: 48px;
            padding: 0 10px 0 14px;
            border-bottom: 1px solid var(--border);
        }

        .header-title {
            font-weight: 650;
            font-size: 13.5px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .header-title .cx-icon { color: var(--accent-text); }

        .close-btn {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: none;
            border: 1px solid var(--border);
            border-radius: 6px;
            color: var(--text-muted);
            cursor: pointer;
            transition: color 0.15s, background 0.15s;
        }
        .close-btn:hover { color: var(--text); background: rgba(255,255,255,0.05); }

        .toolbar {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        .filter-btn {
            background: none;
            border: 1px solid var(--border);
            color: var(--text-muted);
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 550;
            cursor: pointer;
            transition: color 0.15s, background 0.15s, border-color 0.15s;
        }
        .filter-btn:hover { color: var(--text); }
        .filter-btn.active {
            background: var(--accent-soft);
            color: var(--accent-text);
            border-color: transparent;
        }

        .asset-grid {
            flex: 1;
            overflow-y: auto;
            padding: 14px;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 10px;
            align-content: flex-start;
            scrollbar-width: thin;
            scrollbar-color: var(--border-strong) transparent;
        }

        .asset-card {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: 10px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            position: relative;
            height: 196px;
            transition: border-color 0.15s;
        }
        .asset-card:hover { border-color: var(--border-strong); }

        .asset-preview {
            flex: 1;
            min-height: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            color: var(--text-muted);
            background-color: #18191c;
            background-image: linear-gradient(45deg, #202125 25%, transparent 25%), linear-gradient(-45deg, #202125 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #202125 75%), linear-gradient(-45deg, transparent 75%, #202125 75%);
            background-size: 16px 16px;
            background-position: 0 0, 0 8px, 8px -8px, -8px 0px;
        }

        .asset-preview img, .asset-preview video {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }

        .preview-label { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 12px; }

        .asset-info {
            padding: 8px 10px;
            font-size: 11.5px;
            border-top: 1px solid var(--border);
        }

        .asset-name {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 2px;
            font-weight: 500;
        }

        .asset-meta {
            display: flex;
            justify-content: space-between;
            align-items: center;
            color: var(--text-muted);
        }
        .asset-meta a { display: inline-flex; align-items: center; gap: 3px; color: var(--accent-text); text-decoration: none; }
        .asset-meta a:hover { text-decoration: underline; }
        .asset-actions { display: inline-flex; align-items: center; gap: 4px; }
        .asset-actions a, .asset-dl {
            display: inline-flex; align-items: center; justify-content: center; gap: 4px;
            height: 24px; padding: 0 7px; border-radius: 6px;
            border: 1px solid var(--border); background: transparent;
            color: var(--accent-text); font: inherit; font-size: 11.5px; font-weight: 600;
            cursor: pointer; text-decoration: none; transition: background 0.15s, border-color 0.15s;
        }
        .asset-actions a { padding: 0 5px; }
        .asset-actions a:hover, .asset-dl:hover { background: rgba(79,209,197,0.1); border-color: rgba(79,209,197,0.35); text-decoration: none; }
        .asset-dl:disabled { opacity: 0.5; cursor: default; }
        .asset-copy { padding: 0 5px; }
        .asset-copy.copied { color: #7ee2a8; border-color: rgba(126,226,168,0.4); }
        .asset-preview video { width: 100%; height: 100%; background: #000; }
        .asset-preview .audio-player { position: absolute; left: 6px; right: 6px; bottom: 6px; width: calc(100% - 12px); height: 32px; }
        .play-overlay {
            position: absolute; inset: 0; margin: auto; width: 44px; height: 44px; border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            background: rgba(0,0,0,0.6); color: #fff; border: 1px solid rgba(255,255,255,0.25);
            transition: transform 0.15s, background 0.15s;
        }
        .play-overlay:hover { transform: scale(1.08); background: rgba(0,0,0,0.8); }
        .badge.lottie { background: rgba(79,209,197,0.9); color: #07201d; font-weight: 600; }
        .asset-preview > div { width: 100%; height: 100%; }
        .lottie-card { height: 222px; }
        .lottie-meta { font-size: 11px; }
        .lottie-actions { display: flex; gap: 4px; margin-top: 6px; }
        .lottie-actions .asset-dl { flex: 1 1 0; min-width: 0; padding: 0 4px; }
        .lottie-actions:has(> :nth-child(3)) .cx-icon { display: none; }
        .filter-btn .count { font-size: 10px; opacity: 0.75; margin-left: 2px; }
        .filter-btn .spin { display: inline-block; width: 9px; height: 9px; margin-left: 4px; vertical-align: -1px;
            border: 1.5px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: cxspin 0.8s linear infinite; }
        @keyframes cxspin { to { transform: rotate(360deg); } }

        .badge {
            position: absolute;
            top: 6px;
            right: 6px;
            background: rgba(14,15,17,0.8);
            color: var(--text);
            padding: 1px 6px;
            border-radius: 999px;
            font-family: 'SF Mono', ui-monospace, Menlo, monospace;
            font-size: 10px;
            text-transform: uppercase;
        }

        .empty-state {
            grid-column: 1 / -1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            padding: 48px 0;
            color: var(--text-muted);
            text-align: center;
        }

        .footer {
            padding: 10px 14px;
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .btn-primary {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--accent);
            color: var(--on-accent);
            border: none;
            padding: 7px 14px;
            border-radius: 6px;
            font-size: 12.5px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s, transform 0.1s;
        }

        .btn-primary:hover { background: #6adbd0; }
        .btn-primary:active { transform: scale(0.97); }
        .btn-primary:disabled { background: var(--bg-inset); color: var(--text-muted); cursor: not-allowed; }

        .status-text {
            font-size: 12px;
            color: var(--text-muted);
        }

        /* Toast */
        .toast {
            position: absolute;
            bottom: 64px;
            left: 50%;
            transform: translateX(-50%) translateY(12px);
            background: var(--bg-inset);
            border: 1px solid var(--border-strong);
            color: var(--text);
            padding: 7px 14px;
            border-radius: 10px;
            font-size: 12px;
            font-weight: 500;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s cubic-bezier(0.16,1,0.3,1);
            box-shadow: 0 12px 30px -10px rgba(0,0,0,0.6);
            white-space: nowrap;
        }
        .toast.show {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    `;
    shadow.appendChild(style);

    const panel = document.createElement('div');
    panel.className = 'extractor-panel';
    panel.innerHTML = `
        <div class="header">
            <div class="header-title">${ic('photo', 16)}Asset Extractor</div>
            <button class="close-btn" id="close-panel" aria-label="Close">${ic('x', 16)}</button>
        </div>
        
        <div class="toolbar" id="filters">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="image">Images</button>
            <button class="filter-btn" data-filter="vector">Vectors (SVG)</button>
            <button class="filter-btn" data-filter="lottie">Lottie</button>
            <button class="filter-btn" data-filter="video">Video/Audio</button>
            <button class="filter-btn" data-filter="font">Fonts</button>
        </div>
        
        <div class="asset-grid" id="asset-grid">
            <!-- Assets injected here -->
        </div>
        
        <div class="footer">
            <div class="status-text" id="status-text">0 assets found</div>
            <button class="btn-primary" id="save-all-btn">${ic('download', 14)}Save All (ZIP)</button>
        </div>
        <div class="toast" id="toast">Extracting...</div>
    `;
    shadow.appendChild(panel);

    // Prevent scrolling
    panel.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
    panel.addEventListener('scroll', (e) => e.stopPropagation(), { passive: true });

    // Close logic
    shadow.getElementById('close-panel').addEventListener('click', () => {
        stopPreviews();
        window.CodexAssetExtractorActive = false;
        host.remove();
    });

    let currentFilter = 'all';

    // Filter logic
    const filterBtns = shadow.querySelectorAll('.filter-btn');
    const saveBtn = shadow.getElementById('save-all-btn');

    function updateSaveBtnLabel() {
        if (currentFilter === 'all') {
            saveBtn.innerHTML = ic('download', 14) + 'Save All Assets (ZIP)';
        } else {
            const filterName = currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1) + 's';
            saveBtn.innerHTML = ic('download', 14) + `Save ${filterName} (ZIP)`;
        }
    }

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderAssetGrid();
            updateSaveBtnLabel();
        });
    });

    function getFileName(url, format, isDataUri) {
        if (isDataUri) return "embedded-svg-" + Date.now() + ".svg";
        try {
            const pathname = new URL(url).pathname;
            const segments = pathname.split('/');
            let name = segments.pop() || 'asset';
            try { name = decodeURIComponent(name); } catch (e) { }
            if (!name.includes('.')) name += '.' + (format || 'bin');
            return name;
        } catch (e) {
            return `asset-${Date.now()}.${format || 'bin'}`;
        }
    }

    // Download a single asset. Chrome's downloads API (in the background
    // worker) fetches it, so assets on other domains work despite CORS;
    // a page-side fetch is the fallback.
    function downloadOne(asset, filename, btn) {
        btn.disabled = true;
        const done = (ok) => {
            btn.disabled = false;
            showToast(ok ? 'Downloading ' + filename : 'Could not download ' + filename, ok ? 1800 : 3000);
        };
        const fallback = async () => {
            try {
                const res = await fetch(asset.url, { credentials: 'omit' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const url = URL.createObjectURL(await res.blob());
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 5000);
                done(true);
            } catch (e) { done(false); }
        };
        try {
            chrome.runtime.sendMessage({ action: 'DOWNLOAD_ASSET', url: asset.url, filename }, res => {
                if (chrome.runtime.lastError || !res || !res.ok) fallback();
                else done(true);
            });
        } catch (e) { fallback(); }
    }

    // ---------------------------------------------------------
    // Lottie: find, validate, preview and export animations
    // ---------------------------------------------------------
    const send = (msg) => new Promise(resolve => {
        try {
            chrome.runtime.sendMessage(msg, res => resolve(chrome.runtime.lastError ? null : res));
        } catch (e) { resolve(null); }
    });
    const isLottieData = o => !!o && typeof o === 'object' && Array.isArray(o.layers) &&
        typeof o.fr === 'number' && typeof o.op === 'number' && 'v' in o;
    let lottieBusy = false, lottieRuntimeDone = false, lottieCounter = 0;
    let playingAnims = [];

    function lottieName(asset, data) {
        let base = '';
        if (asset.url && /^https?:/.test(asset.url)) {
            try { base = decodeURIComponent(new URL(asset.url).pathname.split('/').pop() || '').replace(/\.(json|lottie)$/i, ''); } catch (e) { }
        }
        if (!base && data && typeof data.nm === 'string') base = data.nm;
        base = (base || 'animation-' + (++lottieCounter)).replace(/[^\w.-]+/g, '_').slice(0, 80);
        return base;
    }

    // Accept a parsed animation: record its details for the card
    function acceptLottie(asset, data, jsonText) {
        asset.state = 'ok';
        asset.jsonText = jsonText || JSON.stringify(data);
        asset.meta = {
            w: data.w, h: data.h, fr: data.fr,
            seconds: Math.max(0, (data.op - (data.ip || 0)) / (data.fr || 30)),
            layers: data.layers.length
        };
        asset.baseName = asset.baseName || lottieName(asset, data);
    }

    async function unzipDotLottie(base64) {
        if (!window.JSZip) throw new Error('JSZip missing');
        const zip = await JSZip.loadAsync(base64, { base64: true });
        let file = null;
        try {
            const manifest = JSON.parse(await zip.file('manifest.json').async('string'));
            const id = manifest.animations && manifest.animations[0] && manifest.animations[0].id;
            if (id) file = zip.file('animations/' + id + '.json');
        } catch (e) { }
        if (!file) file = zip.file(/^(animations\/)?[^/]+\.json$/i).filter(f => !/manifest\.json$/i.test(f.name))[0];
        if (!file) throw new Error('No animation inside');
        const data = JSON.parse(await file.async('string'));
        // Embed images packed in the archive so the animation is self-contained
        if (Array.isArray(data.assets)) {
            for (const a of data.assets) {
                if (!a.p || a.e === 1 || /^data:/.test(a.p)) continue;
                const img = zip.file('images/' + a.p) || zip.file((a.u || '').replace(/^\//, '') + a.p);
                if (!img) continue;
                const ext = (a.p.split('.').pop() || 'png').toLowerCase();
                a.p = 'data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + await img.async('base64');
                a.u = ''; a.e = 1;
            }
        }
        return data;
    }

    async function checkLottie(asset) {
        asset.state = 'checking';
        try {
            if (asset.inlineJson) {
                const data = JSON.parse(asset.inlineJson);
                if (!isLottieData(data)) throw new Error('not lottie');
                acceptLottie(asset, data, asset.inlineJson);
                return;
            }
            const res = await send({ action: 'FETCH_LOTTIE', url: asset.url });
            if (!res || !res.ok) throw new Error(res && res.error || 'fetch failed');
            if (res.kind === 'zip') {
                const data = await unzipDotLottie(res.base64);
                if (!isLottieData(data)) throw new Error('not lottie');
                asset.format = 'lottie';
                asset.dotLottie = true;
                acceptLottie(asset, data);
            } else {
                const data = JSON.parse(res.text);
                if (!isLottieData(data)) throw new Error('not lottie');
                acceptLottie(asset, data, res.text);
            }
        } catch (e) {
            // Runtime copy (see below) is the fallback when the file itself can't be read
            if (asset.runtimeJson) {
                try { acceptLottie(asset, JSON.parse(asset.runtimeJson), asset.runtimeJson); asset.fromRuntimeOnly = true; return; } catch (err) { }
            }
            asset.state = 'bad';
        }
    }

    // Animations already playing on the page, read from the page's own Lottie
    // library. This also finds animations whose file isn't in the DOM.
    async function collectRuntimeLotties() {
        const res = await send({ action: 'GET_LOTTIE_RUNTIME' });
        const found = (res && res.animations) || [];
        const byUrl = new Map(allDiscoveredAssets.filter(a => a.type === 'lottie' && !a.unresolved).map(a => [a.url, a]));
        found.forEach(anim => {
            if (anim.path && byUrl.has(anim.path)) {
                byUrl.get(anim.path).runtimeJson = anim.json;
                return;
            }
            const url = anim.path || ('lottie-runtime:' + anim.json.length + ':' + (anim.name || ''));
            if (byUrl.has(url)) return;
            const asset = {
                url, type: 'lottie', format: 'json', frameUrl: anim.frameUrl,
                id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                runtimeJson: anim.json, baseName: anim.name ? String(anim.name).replace(/[^\w.-]+/g, '_').slice(0, 80) : ''
            };
            if (!anim.path) asset.inlineJson = anim.json;
            allDiscoveredAssets.push(asset);
            byUrl.set(url, asset);
        });
    }

    async function resolveLotties() {
        if (lottieBusy) { resolveLotties.again = true; return; }
        lottieBusy = true;
        setLottieStatus(true);
        try {
            if (!lottieRuntimeDone) { lottieRuntimeDone = true; await collectRuntimeLotties(); }
            const queue = allDiscoveredAssets.filter(a => a.type === 'lottie' && !a.unresolved && !a.state);
            let next = 0;
            const worker = async () => { while (next < queue.length) await checkLottie(queue[next++]); };
            await Promise.all([worker(), worker(), worker(), worker()]);
            // Remove files that turned out not to be animations
            allDiscoveredAssets = allDiscoveredAssets.filter(a => a.type !== 'lottie' || a.unresolved || a.state !== 'bad');
        } finally {
            lottieBusy = false;
            setLottieStatus(false);
            renderAssetGrid();
            updateCounts();
            if (resolveLotties.again) { resolveLotties.again = false; resolveLotties(); }
        }
    }

    function setLottieStatus(busy) {
        const btn = shadow.querySelector('.filter-btn[data-filter="lottie"]');
        if (!btn) return;
        const n = allDiscoveredAssets.filter(a => a.type === 'lottie' && a.state === 'ok').length;
        btn.innerHTML = 'Lottie' + (busy ? ' <span class="spin"></span>' : n ? ' <span class="count">' + n + '</span>' : '');
    }

    // Load the Lottie player into this (isolated) world once, on demand
    let lottieLib = null;
    function ensureLottiePlayer() {
        if (globalThis.lottie && globalThis.lottie.loadAnimation) return Promise.resolve(globalThis.lottie);
        if (!lottieLib) {
            lottieLib = send({ action: 'LOAD_LOTTIE_PLAYER' }).then(() => {
                if (!globalThis.lottie) throw new Error('Lottie player failed to load');
                return globalThis.lottie;
            });
            lottieLib.catch(() => { lottieLib = null; });
        }
        return lottieLib;
    }

    // External image paths inside the JSON are relative to the JSON file
    function withAbsoluteImages(data, baseUrl) {
        if (!Array.isArray(data.assets) || !/^https?:/.test(baseUrl || '')) return data;
        data.assets.forEach(a => {
            if (a.p && a.e !== 1 && !/^data:/.test(a.p)) {
                try { a.u = new URL(a.u || '', baseUrl).href; } catch (e) { }
            }
        });
        return data;
    }

    function stopPreviews() {
        playingAnims.forEach(a => { try { a.destroy(); } catch (e) { } });
        playingAnims = [];
    }

    function playPreview(asset, container) {
        ensureLottiePlayer().then(lib => {
            if (!container.isConnected) return;
            container.textContent = '';
            const anim = lib.loadAnimation({
                container, renderer: 'svg', loop: true, autoplay: true,
                animationData: withAbsoluteImages(JSON.parse(asset.jsonText), asset.url),
                rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: true }
            });
            playingAnims.push(anim);
        }).catch(() => {
            container.innerHTML = '<div class="preview-label">' + ic('photo-off', 22) + 'No preview</div>';
        });
    }

    function saveBlob(text, filename, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        showToast('Downloading ' + filename, 1800);
    }

    // A standalone page that plays the animation (player library included)
    async function saveLottieHtml(asset) {
        const res = await send({ action: 'GET_LOTTIE_LIB' });
        if (!res || !res.text) { showToast('Could not build the player file', 3000); return; }
        const data = withAbsoluteImages(JSON.parse(asset.jsonText), asset.url);
        const json = JSON.stringify(data).replace(/</g, '\\u003c');
        const m = asset.meta;
        const html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
            '<title>' + asset.baseName.replace(/[<&]/g, '') + '</title>\n' +
            '<style>html,body{margin:0;height:100%;background:#fff}body{display:grid;place-items:center}' +
            '#anim{width:min(100vw,' + (m.w || 800) + 'px);max-height:100vh;aspect-ratio:' + (m.w || 1) + '/' + (m.h || 1) + '}</style>\n' +
            '</head>\n<body>\n<div id="anim"></div>\n' +
            '<script>' + res.text.replace(/<\/script/gi, '<\\/script') + '<\/script>\n' +
            '<script>lottie.loadAnimation({container:document.getElementById("anim"),renderer:"svg",loop:true,autoplay:true,animationData:' + json + '});<\/script>\n' +
            '</body>\n</html>\n';
        saveBlob(html, asset.baseName + '.html', 'text/html');
    }

    function saveLottieJson(asset) {
        const filename = asset.baseName + '.json';
        // The original file when there is one (exactly as the site serves it)
        if (/^https?:/.test(asset.url) && !asset.dotLottie && asset.state === 'ok' && !asset.fromRuntimeOnly) {
            downloadOne(asset, filename, { disabled: false });
        } else {
            saveBlob(asset.jsonText, filename, 'application/json');
        }
    }

    function renderLottieCard(asset) {
        const card = document.createElement('div');
        card.className = 'asset-card lottie-card';
        const preview = document.createElement('div');
        preview.className = 'asset-preview';
        const badge = document.createElement('div');
        badge.className = 'badge lottie';
        const info = document.createElement('div');
        info.className = 'asset-info';

        if (asset.unresolved) {
            // Only the drawn frame is available
            const img = document.createElement('img');
            img.src = asset.url;
            preview.appendChild(img);
            badge.textContent = 'Lottie';
            info.innerHTML = '<div class="asset-name">Lottie frame</div>' +
                '<div class="asset-meta"><span title="The animation file is bundled inside the site\'s JavaScript, so only the current frame can be saved.">Source not found</span><div class="asset-actions"></div></div>';
            const btn = document.createElement('button');
            btn.className = 'asset-dl';
            btn.innerHTML = ic('download', 13) + 'SVG';
            btn.title = 'Save the current frame as SVG';
            btn.addEventListener('click', () => downloadOne(asset, 'lottie-frame-' + Date.now() + '.svg', btn));
            info.querySelector('.asset-actions').appendChild(btn);
        } else {
            playPreview(asset, preview);
            const m = asset.meta;
            badge.textContent = asset.dotLottie ? '.lottie' : 'Lottie';
            info.innerHTML = '<div class="asset-name"></div><div class="asset-meta lottie-meta"><span class="lottie-info"></span></div><div class="lottie-actions"></div>';
            info.querySelector('.asset-name').textContent = asset.baseName + (asset.dotLottie ? '.lottie' : '.json');
            info.querySelector('.asset-name').title = asset.url.startsWith('http') ? asset.url : asset.baseName;
            info.querySelector('.lottie-info').textContent = (m.w && m.h ? m.w + '×' + m.h + ' · ' : '') + m.seconds.toFixed(1) + 's · ' + Math.round(m.fr) + 'fps';
            const actions = info.querySelector('.lottie-actions');
            const add = (label, icon, title, fn) => {
                const b = document.createElement('button');
                b.className = 'asset-dl';
                b.innerHTML = ic(icon, 13) + label;
                b.title = title;
                b.addEventListener('click', fn);
                actions.appendChild(b);
            };
            add('JSON', 'download', 'Lottie JSON: use with any Lottie player, LottieFiles or After Effects (Bodymovin)', () => saveLottieJson(asset));
            if (asset.dotLottie) add('.lottie', 'download', 'The original .lottie file', () => downloadOne(asset, asset.baseName + '.lottie', { disabled: false }));
            add('HTML', 'player-play', 'A web page that plays the animation on its own', () => saveLottieHtml(asset));
            actions.appendChild(copyButton(asset, true));
        }
        card.appendChild(preview);
        card.appendChild(badge);
        card.appendChild(info);
        return card;
    }

    // What the grid shows (and the ZIP saves) for the current filter
    function visibleAssets() {
        const anyLottie = allDiscoveredAssets.some(a => a.type === 'lottie' && a.state === 'ok');
        return allDiscoveredAssets.filter(a => {
            if (a.type === 'lottie') {
                if (a.unresolved) return !anyLottie && !lottieBusy;
                if (a.state !== 'ok') return false;
            }
            if (currentFilter === 'all') return true;
            if (currentFilter === 'video' && (a.type === 'audio' || a.type === 'subtitle')) return true;
            return a.type === currentFilter;
        });
    }

    // Copy: SVG markup for embedded vectors, the address for everything else
    function copyPayload(asset) {
        if (asset.type === 'vector' && asset.isDataUri) {
            try { return { text: decodeURIComponent(asset.url.split(',').slice(1).join(',')), what: 'SVG code' }; } catch (e) { }
        }
        if (asset.type === 'lottie' && asset.jsonText) return { text: asset.jsonText, what: 'Lottie JSON' };
        return { text: asset.url, what: asset.embed ? 'Video link' : asset.stream ? 'Stream URL' : 'URL' };
    }

    async function copyText(text) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) { }
        // Fallback for pages where the async clipboard is blocked
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { }
        ta.remove();
        return ok;
    }

    function copyButton(asset, withLabel) {
        const p = copyPayload(asset);
        const btn = document.createElement('button');
        btn.className = 'asset-dl asset-copy';
        btn.title = 'Copy ' + p.what;
        btn.setAttribute('aria-label', btn.title);
        const idle = ic('copy', 13) + (withLabel ? 'Copy' : '');
        btn.innerHTML = idle;
        btn.addEventListener('click', async () => {
            const ok = await copyText(p.text);
            showToast(ok ? p.what + ' copied' : 'Could not copy', ok ? 1500 : 3000);
            if (!ok) return;
            btn.innerHTML = ic('check', 13) + (withLabel ? 'Copied' : '');
            btn.classList.add('copied');
            setTimeout(() => { btn.innerHTML = idle; btn.classList.remove('copied'); }, 1400);
        });
        return btn;
    }

    function renderAssetGrid() {
        const grid = shadow.getElementById('asset-grid');
        stopPreviews();
        grid.innerHTML = '';

        const filtered = visibleAssets();

        filtered.forEach(asset => {
            if (asset.type === 'lottie') { grid.appendChild(renderLottieCard(asset)); return; }
            const card = document.createElement('div');
            card.className = 'asset-card';

            const noFile = asset.embed || asset.streamOnly;
            const filename = noFile ? (asset.title || asset.url) : getFileName(asset.url, asset.format, asset.isDataUri);
            const typeSpan = document.createElement('span');
            typeSpan.textContent = asset.embed ? 'embed' : asset.stream ? 'stream' : asset.streamOnly ? 'streamed' : asset.type;

            // Container for preview
            const previewContainer = document.createElement('div');
            previewContainer.className = 'asset-preview';
            const label = (icon, text) => {
                const d = document.createElement('div');
                d.className = 'preview-label';
                d.innerHTML = ic(icon, 24);
                d.appendChild(document.createTextNode(text));
                return d;
            };
            const posterOr = (icon, text) => {
                if (!asset.poster) { previewContainer.appendChild(label(icon, text)); return; }
                const img = document.createElement('img');
                img.src = asset.poster;
                img.loading = 'lazy';
                img.onerror = () => img.replaceWith(label(icon, text));
                previewContainer.appendChild(img);
            };

            if (asset.type === 'image' || asset.type === 'vector') {
                const img = document.createElement('img');
                img.src = asset.url;
                img.loading = 'lazy';
                previewContainer.appendChild(img);
            } else if (asset.embed) {
                posterOr('player-play', asset.format);
                const play = document.createElement('a');
                play.className = 'play-overlay';
                play.href = asset.url;
                play.target = '_blank';
                play.rel = 'noopener noreferrer';
                play.title = 'Watch on ' + asset.format;
                play.innerHTML = ic('player-play', 22);
                previewContainer.appendChild(play);
            } else if (asset.streamOnly) {
                posterOr('player-play', 'Streamed, no direct file');
            } else if (asset.stream) {
                posterOr('player-play', asset.format === 'mpd' ? 'DASH stream' : 'HLS stream');
            } else if (asset.type === 'video') {
                // Playable right in the panel
                const video = document.createElement('video');
                video.src = asset.url;
                video.preload = 'metadata';
                video.controls = true;
                video.muted = true;
                video.playsInline = true;
                video.loop = true;
                if (asset.poster) video.poster = asset.poster;
                video.addEventListener('loadedmetadata', () => {
                    const d = video.duration;
                    const time = isFinite(d) ? Math.floor(d / 60) + ':' + String(Math.round(d % 60)).padStart(2, '0') : '';
                    typeSpan.textContent = [video.videoWidth ? video.videoWidth + '×' + video.videoHeight : 'video', time].filter(Boolean).join(' · ');
                });
                video.addEventListener('error', () => { video.replaceWith(label('photo-off', 'No preview')); });
                previewContainer.appendChild(video);
            } else if (asset.type === 'audio') {
                const audio = document.createElement('audio');
                audio.src = asset.url;
                audio.preload = 'none';
                audio.controls = true;
                audio.className = 'audio-player';
                previewContainer.appendChild(label('headphones', 'Audio'));
                previewContainer.appendChild(audio);
            } else if (asset.type === 'subtitle') {
                previewContainer.appendChild(label('file-text', 'Subtitles'));
            } else if (asset.type === 'font') {
                const fontDiv = document.createElement('div');
                fontDiv.style.fontSize = '32px';
                fontDiv.style.color = 'var(--text)';
                fontDiv.textContent = 'Aa';
                previewContainer.appendChild(fontDiv);
            } else {
                previewContainer.appendChild(label('help-circle', 'Unknown'));
            }

            // Badge
            const badge = document.createElement('div');
            badge.className = 'badge';
            badge.textContent = asset.format;

            // Info Section
            const info = document.createElement('div');
            info.className = 'asset-info';

            const nameDiv = document.createElement('div');
            nameDiv.className = 'asset-name';
            nameDiv.title = filename;
            nameDiv.textContent = filename;

            const metaDiv = document.createElement('div');
            metaDiv.className = 'asset-meta';
            const actions = document.createElement('div');
            actions.className = 'asset-actions';
            if (!noFile) {
                const saveOne = document.createElement('button');
                saveOne.className = 'asset-dl';
                saveOne.title = asset.stream ? 'Download the playlist file' : 'Download ' + filename;
                saveOne.setAttribute('aria-label', saveOne.title);
                saveOne.innerHTML = ic('download', 13) + 'Save';
                saveOne.addEventListener('click', () => downloadOne(asset, filename, saveOne));
                actions.appendChild(saveOne);
            }
            actions.appendChild(copyButton(asset));
            const openLink = document.createElement('a');
            openLink.href = asset.url;
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
            openLink.title = 'Open in new tab';
            openLink.setAttribute('aria-label', 'Open ' + filename + ' in new tab');
            openLink.innerHTML = ic('external-link', 13);
            if (asset.isDataUri) openLink.style.display = 'none';
            actions.appendChild(openLink);
            metaDiv.appendChild(typeSpan);
            metaDiv.appendChild(actions);

            info.appendChild(nameDiv);
            info.appendChild(metaDiv);

            // Assemble Card
            card.appendChild(previewContainer);
            card.appendChild(badge);
            card.appendChild(info);

            grid.appendChild(card);
        });

        if (filtered.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'empty-state';
            emptyState.innerHTML = ic('photo-off', 28) + `No ${currentFilter === 'all' ? '' : currentFilter} assets found.`;
            grid.appendChild(emptyState);
        }
    }

    function updateCounts() {
        const saved = currentFilter;
        currentFilter = 'all';
        const n = visibleAssets().length;
        currentFilter = saved;
        shadow.getElementById('status-text').textContent = `${n} total assets`;
    }

    function showToast(msg, duration = 2000) {
        const toast = shadow.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        if (duration > 0) {
            setTimeout(() => toast.classList.remove('show'), duration);
        }
    }

    // JSZip Download Logic
    saveBtn.addEventListener('click', async () => {
        if (!window.JSZip) {
            showToast("Error: JSZip not loaded", 3000);
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = 'Generating...';
        showToast('Fetching and zipping assets...', 0); // sticky

        try {
            const zip = new JSZip();
            const root = zip.folder("extracted_assets");

            const filtered = visibleAssets();

            let successCount = 0;
            let failCount = 0;

            const promises = filtered.map(async (asset) => {
                const filename = getFileName(asset.url, asset.format, asset.isDataUri);
                // Group into folders based on type
                const folderMap = {
                    'image': 'images',
                    'vector': 'svgs',
                    'video': 'media',
                    'audio': 'media',
                    'subtitle': 'media',
                    'font': 'fonts'
                };
                if (asset.type === 'lottie') {
                    if (asset.unresolved) { root.file('lottie/lottie-frame-' + asset.id + '.svg', decodeURIComponent(asset.url.split(',')[1] || '')); }
                    else root.file('lottie/' + asset.baseName + '.json', asset.jsonText);
                    successCount++;
                    return;
                }
                if (asset.embed || asset.streamOnly) return; // a link, not a file
                const folderName = folderMap[asset.type] || 'misc';
                const safeName = folderName + '/' + filename.replace(/[^a-z0-9.-]/gi, '_');

                try {
                    let blob;
                    if (asset.isDataUri) {
                        // Extract base64 from data URI and convert
                        const res = await fetch(asset.url);
                        blob = await res.blob();
                    } else {
                        // Standard fetch
                        const res = await fetch(asset.url, { mode: 'cors', credentials: 'omit' });
                        if (!res.ok) throw new Error("HTTP " + res.status);
                        blob = await res.blob();
                    }
                    root.file(safeName, blob);
                    successCount++;
                } catch (e) {
                    // Try no-cors fallback as a last resort (often yields opaque blobs which zip breaks on, but we try)
                    try {
                        const res = await fetch(asset.url, { mode: 'no-cors' });
                        const blob = await res.blob();
                        if (blob.size > 0) {
                            root.file(safeName, blob);
                            successCount++;
                        } else {
                            failCount++;
                        }
                    } catch (err) {
                        failCount++;
                    }
                }
            });

            await Promise.all(promises);

            shadow.getElementById('toast').classList.remove('show');
            setTimeout(() => showToast(`Zipped ${successCount} assets. (${failCount} failed to fetch)`, 4000), 300);

            const content = await zip.generateAsync({ type: "blob" });
            const url = URL.createObjectURL(content);
            const a = document.createElement("a");
            a.href = url;
            a.download = `codex_assets_${Date.now()}.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

        } catch (e) {
            shadow.getElementById('toast').classList.remove('show');
            setTimeout(() => showToast("Error generating ZIP", 3000), 300);
            console.error("ZIP Generation error:", e);
        } finally {
            saveBtn.disabled = false;
            updateSaveBtnLabel(); // Reset to contextual text instead of hardcoded
        }
    });

    // Initial render
    renderAssetGrid();
    updateCounts();
    updateSaveBtnLabel();
    resolveLotties();

})();
