// Feedback report: renders the pins saved by feedback.js (chrome.storage.local)
// as a printable page. Opened by background.js with ?key=<storage key>&page=<page>
// (an empty page means every page on the site).
const params = new URLSearchParams(location.search);
const KEY = params.get('key') || '';
const PAGE = params.get('page') || '';

const ic = (name, size) => CodexIcons.svg(name, size || 14);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const SEVERITY = {
    bug:        { label: 'Bug',        color: '#f07575', bg: 'rgba(240,117,117,0.12)', icon: 'bug' },
    suggestion: { label: 'Suggestion', color: '#e8a64a', bg: 'rgba(232,166,74,0.12)',  icon: 'bulb' },
    question:   { label: 'Question',   color: '#6fb3ec', bg: 'rgba(111,179,236,0.12)', icon: 'help-circle' },
    info:       { label: 'Info',       color: '#5ccf8d', bg: 'rgba(92,207,141,0.12)',  icon: 'info-circle' }
};
const severity = s => SEVERITY[s] || SEVERITY.info;

function breakpoint(w) {
    if (w < 480)  return { label: 'Mobile S', icon: 'device-mobile' };
    if (w < 768)  return { label: 'Mobile',   icon: 'device-mobile' };
    if (w < 1024) return { label: 'Tablet',   icon: 'device-tablet' };
    if (w < 1440) return { label: 'Desktop',  icon: 'device-desktop' };
    return                { label: 'Wide',     icon: 'device-desktop' };
}
function pageOf(pin) {
    if (pin.page) return pin.page;
    try { const u = new URL(pin.url); return u.origin + u.pathname + u.search; } catch (e) { return pin.url || ''; }
}

function pinHtml(pin, number) {
    const sv = severity(pin.severity);
    const bp = breakpoint(pin.viewportW);
    return `
    <div class="pin-section${pin.resolved ? ' resolved' : ''}" style="page-break-inside:avoid;">
        <div class="pin-header">
            <div class="pin-number" style="background:${sv.color}">${number}</div>
            <div class="pin-header-info">
                <span class="severity-badge" style="background:${sv.bg};color:${sv.color};">${ic(sv.icon, 13)}${sv.label}</span>
                <span class="bp-badge">${ic(bp.icon, 13)}${bp.label}, ${pin.viewportW}×${pin.viewportH}px</span>
                ${pin.resolved ? `<span class="status-badge">${ic('check', 13)}Resolved</span>` : ''}
            </div>
        </div>
        ${pin.screenshot && /^data:image\//.test(pin.screenshot) ? `<div class="screenshot-wrap"><img class="screenshot" src="${esc(pin.screenshot)}" alt="Screenshot of the annotated element"></div>` : ''}
        <div class="note-box">
            <div class="note-label">Feedback Note</div>
            <div class="note-text">${esc(pin.note)}</div>
        </div>
        <div class="pin-details">
            <div class="detail-row"><span class="detail-key">Element</span><code class="detail-val">${esc(pin.selector)}</code></div>
            <div class="detail-row"><span class="detail-key">Viewport</span><code class="detail-val">${pin.viewportW}×${pin.viewportH}px (${bp.label})</code></div>
            <div class="detail-row"><span class="detail-key">Page URL</span><code class="detail-val url">${esc(pin.url)}</code></div>
            <div class="detail-row"><span class="detail-key">Captured</span><code class="detail-val">${esc(new Date(pin.timestamp).toLocaleString())}</code></div>
        </div>
    </div>`;
}

function render(allPins) {
    const pins = PAGE ? allPins.filter(p => pageOf(p) === PAGE) : allPins;
    const report = document.getElementById('report');
    const site = KEY.replace(/^codex_fb_/, '');
    document.title = 'Feedback Report: ' + (site || 'site');
    document.getElementById('bar-title').textContent = document.title;

    if (!pins.length) {
        report.innerHTML = `<div class="content"><div class="empty">No feedback pins to show.</div></div>`;
        return;
    }

    const open = pins.filter(p => !p.resolved);
    const count = s => open.filter(p => p.severity === s).length;
    const pages = [...new Set(pins.map(pageOf))];

    // Number pins per page, in the order they were added (matches the markers)
    let body = '';
    pages.forEach(page => {
        const onPage = allPins.filter(p => pageOf(p) === page);
        if (pages.length > 1 || !PAGE) body += `<div class="page-title">${esc(page)}</div>`;
        body += pins.filter(p => pageOf(p) === page)
            .map(p => pinHtml(p, onPage.indexOf(p) + 1)).join('');
    });

    report.innerHTML = `
    <div class="cover">
        <div class="cover-content">
            <div class="cover-badge">Codex Dev Feedback Report</div>
            <div class="cover-title">Design &amp; UX<br>Feedback Report</div>
            <div class="cover-url">${ic('world', 18)}${esc(PAGE || site)}</div>
            <div class="cover-meta">
                <div class="cover-meta-item"><div class="cover-meta-num">${pins.length}</div><div class="cover-meta-label">Annotations</div></div>
                <div class="cover-meta-item"><div class="cover-meta-num">${open.length}</div><div class="cover-meta-label">Open</div></div>
                <div class="cover-meta-item"><div class="cover-meta-num">${new Set(pins.map(p => breakpoint(p.viewportW).label)).size}</div><div class="cover-meta-label">Breakpoints</div></div>
                ${pages.length > 1 ? `<div class="cover-meta-item"><div class="cover-meta-num">${pages.length}</div><div class="cover-meta-label">Pages</div></div>` : ''}
            </div>
            <div class="cover-grid">
                <div class="cover-stat"><div class="cover-stat-num" style="color:#f07575">${count('bug')}</div><div class="cover-stat-label">Bugs</div></div>
                <div class="cover-stat"><div class="cover-stat-num" style="color:#e8a64a">${count('suggestion')}</div><div class="cover-stat-label">Suggestions</div></div>
                <div class="cover-stat"><div class="cover-stat-num" style="color:#6fb3ec">${count('question')}</div><div class="cover-stat-label">Questions</div></div>
                <div class="cover-stat"><div class="cover-stat-num" style="color:#5ccf8d">${count('info')}</div><div class="cover-stat-label">Info</div></div>
            </div>
            <div class="cover-date" style="margin-top:28px;">Generated on ${esc(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }))}</div>
        </div>
    </div>
    <div class="content">
        <div class="section-title">Annotated Feedback (${pins.length} item${pins.length !== 1 ? 's' : ''})</div>
        ${body}
    </div>`;
}

CodexIcons.hydrate();
document.getElementById('print').addEventListener('click', () => window.print());

if (!/^codex_fb_/.test(KEY)) {
    render([]);
} else {
    chrome.storage.local.get(KEY, r => render(r[KEY] || []));
}
