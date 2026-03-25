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

        function addAsset(url, type, sourceEl) {
            if (!url || url.startsWith('data:') || url.startsWith('blob:')) return;

            // Try to resolve relative URLs
            try { url = new URL(url, window.location.href).href; } catch (e) { return; }

            if (!assets.has(url)) {
                let format = url.split('.').pop().split(/#|\?/)[0].toLowerCase();
                if (format.length > 5) format = 'unknown';
                if (!format && type === 'image') format = 'img';

                assets.set(url, {
                    url: url,
                    type: type,
                    format: format,
                    frameUrl: window.location.href,
                    id: `asset-${Date.now()}-${assetCount++}`
                });
            }
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

        // 2. Videos & Audio
        document.querySelectorAll('video, audio').forEach(media => {
            const type = media.tagName.toLowerCase();
            if (media.src) addAsset(media.src, type, media);

            media.querySelectorAll('source').forEach(source => {
                if (source.src) addAsset(source.src, type, source);
            });
        });

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

        // 5. Embedded SVGs and <use> tags
        document.querySelectorAll('svg').forEach(svg => {
            try {
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
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        return;
    }

    window.CodexAssetExtractorActive = true;
    let allDiscoveredAssets = [...localAssets];

    // Listen for iframe assets
    window.addEventListener('message', function (event) {
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
        }
    });

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
            --bg: #1a202c;
            --bg-panel: #2d3748;
            --border: #4a5568;
            --text: #e2e8f0;
            --text-muted: #a0aec0;
            --accent: #4FD1C5;
            font-family: system-ui, -apple-system, sans-serif;
            color: var(--text);
            font-size: 14px;
            line-height: 1.5;
            box-sizing: border-box;
        }

        :host * {
            box-sizing: border-box;
        }
        
        .extractor-panel {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 400px;
            height: calc(100vh - 40px);
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 10000;
        }

        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-panel);
            border-bottom: 1px solid var(--border);
        }

        .header-title {
            font-weight: 600;
            font-size: 14px;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .close-btn {
            background: none;
            border: none;
            color: var(--text-muted);
            cursor: pointer;
            padding: 4px;
            font-size: 16px;
        }
        
        .close-btn:hover { color: #fff; }

        .toolbar {
            padding: 12px 16px;
            background: var(--bg-panel);
            border-bottom: 1px solid var(--border);
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
        }
        
        .filter-btn {
            background: var(--bg);
            border: 1px solid var(--border);
            color: var(--text-muted);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
        }
        
        .filter-btn.active {
            background: rgba(79, 209, 197, 0.2);
            color: var(--accent);
            border-color: var(--accent);
        }

        .asset-grid {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 12px;
            align-content: flex-start;
        }

        .asset-card {
            background: var(--bg-panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
            position: relative;
            height: 200px;
        }
        
        .asset-preview {
            flex: 1;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            background-image: linear-gradient(45deg, #111 25%, transparent 25%), linear-gradient(-45deg, #111 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #111 75%), linear-gradient(-45deg, transparent 75%, #111 75%);
            background-size: 20px 20px;
            background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        }
        
        .asset-preview img, .asset-preview video {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        }
        
        .asset-info {
            padding: 8px;
            font-size: 11px;
        }
        
        .asset-name {
            color: #fff;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin-bottom: 4px;
        }
        
        .asset-meta {
            display: flex;
            justify-content: space-between;
            color: var(--text-muted);
        }
        
        .badge {
            position: absolute;
            top: 4px;
            right: 4px;
            background: rgba(0,0,0,0.7);
            color: #fff;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 10px;
            text-transform: uppercase;
        }

        .footer {
            padding: 12px 16px;
            background: var(--bg-panel);
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .btn-primary {
            background: var(--accent);
            color: #000;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .btn-primary:hover { background: #3eb1a6; }
        .btn-primary:disabled { background: #4a5568; color: #a0aec0; cursor: not-allowed; }
        
        .status-text {
            font-size: 12px;
            color: var(--text-muted);
        }
        
        /* Toast */
        .toast {
            position: absolute;
            bottom: 70px;
            left: 50%;
            transform: translateX(-50%) translateY(20px);
            background: var(--accent);
            color: #000;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            opacity: 0;
            pointer-events: none;
            transition: all 0.3s;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
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
            <div class="header-title">
                <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="8.5" cy="8.5" r="1.5"></circle>
                    <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                Asset Extractor
            </div>
            <button class="close-btn" id="close-panel">✕</button>
        </div>
        
        <div class="toolbar" id="filters">
            <button class="filter-btn active" data-filter="all">All</button>
            <button class="filter-btn" data-filter="image">Images</button>
            <button class="filter-btn" data-filter="vector">Vectors (SVG)</button>
            <button class="filter-btn" data-filter="video">Video/Audio</button>
            <button class="filter-btn" data-filter="font">Fonts</button>
        </div>
        
        <div class="asset-grid" id="asset-grid">
            <!-- Assets injected here -->
        </div>
        
        <div class="footer">
            <div class="status-text" id="status-text">0 assets found</div>
            <button class="btn-primary" id="save-all-btn">Save All (ZIP)</button>
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
        window.CodexAssetExtractorActive = false;
        host.remove();
    });

    let currentFilter = 'all';

    // Filter logic
    const filterBtns = shadow.querySelectorAll('.filter-btn');
    const saveBtn = shadow.getElementById('save-all-btn');

    function updateSaveBtnLabel() {
        if (currentFilter === 'all') {
            saveBtn.textContent = 'Save All Assets (ZIP)';
        } else {
            const filterName = currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1) + 's';
            saveBtn.textContent = `Save ${filterName} (ZIP)`;
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
            if (!name.includes('.')) name += '.' + (format || 'bin');
            return name;
        } catch (e) {
            return `asset - ${Date.now()}.${format || 'bin'} `;
        }
    }

    function renderAssetGrid() {
        const grid = shadow.getElementById('asset-grid');
        grid.innerHTML = '';

        const filtered = allDiscoveredAssets.filter(a => {
            if (currentFilter === 'all') return true;
            if (currentFilter === 'video' && a.type === 'audio') return true;
            return a.type === currentFilter;
        });

        filtered.forEach(asset => {
            const card = document.createElement('div');
            card.className = 'asset-card';

            const filename = getFileName(asset.url, asset.format, asset.isDataUri);

            // Container for preview
            const previewContainer = document.createElement('div');
            previewContainer.className = 'asset-preview';

            if (asset.type === 'image' || asset.type === 'vector') {
                const img = document.createElement('img');
                img.src = asset.url;
                img.loading = 'lazy';
                previewContainer.appendChild(img);
            } else if (asset.type === 'video') {
                const video = document.createElement('video');
                video.src = asset.url;
                video.preload = 'metadata';
                previewContainer.appendChild(video);
            } else if (asset.type === 'audio') {
                const audioDiv = document.createElement('div');
                audioDiv.style.color = 'var(--text-muted)';
                audioDiv.textContent = '🎧 Audio';
                previewContainer.appendChild(audioDiv);
            } else if (asset.type === 'font') {
                const fontDiv = document.createElement('div');
                fontDiv.style.fontSize = '32px';
                fontDiv.style.color = 'var(--text)';
                fontDiv.textContent = 'Aa';
                previewContainer.appendChild(fontDiv);
            } else {
                const unkDiv = document.createElement('div');
                unkDiv.style.color = 'var(--text-muted)';
                unkDiv.textContent = '? Unknown';
                previewContainer.appendChild(unkDiv);
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
            const typeSpan = document.createElement('span');
            typeSpan.textContent = asset.type;
            const openLink = document.createElement('a');
            openLink.href = asset.url;
            openLink.target = '_blank';
            openLink.style.cssText = 'color:var(--accent); text-decoration:none;';
            openLink.textContent = 'Open';
            metaDiv.appendChild(typeSpan);
            metaDiv.appendChild(openLink);

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
            emptyState.style.cssText = 'grid-column: 1 / -1; text-align:center; padding: 40px 0; color: var(--text-muted);';
            emptyState.textContent = `No ${currentFilter === 'all' ? '' : currentFilter} assets found.`;
            grid.appendChild(emptyState);
        }
    }

    function updateCounts() {
        shadow.getElementById('status-text').textContent = `${allDiscoveredAssets.length} total assets`;
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

            const filtered = allDiscoveredAssets.filter(a => {
                if (currentFilter === 'all') return true;
                if (currentFilter === 'video' && a.type === 'audio') return true;
                return a.type === currentFilter;
            });

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
                    'font': 'fonts'
                };
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

})();
