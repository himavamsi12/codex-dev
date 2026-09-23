// Device mockups for the responsive viewer.
//
// Each viewport gets a hardware frame (bezel, notch / Dynamic Island /
// punch-hole, status bar) plus the browser UI a visitor would actually see
// (Safari's bottom bar on iPhone, Chrome's top bar on Android, a window bar
// on desktop). The page iframe sits in `.viewport-frame` and is sized to what
// is left over, so media queries see a realistic visible viewport.
//
// Browser-UI heights are approximations of current iOS Safari / Android Chrome
// with toolbars expanded. With frames off, the iframe gets the full device size.
//
// The DOM is built once per viewport; frame toggling and rotation only resize
// it (apply), so the iframe is never re-parented and never reloads.
(function () {
    'use strict';

    // pad: bezel [top, right, bottom, left] in portrait.
    // status/top/bottom: bar heights in portrait; `land` overrides for landscape.
    // land.sides: [left, right] letterbox insets. In landscape Safari and Chrome
    // keep page content out of the camera cutout area, so the page is narrower.
    const PROFILES = {
        'iphone-island': {
            kind: 'phone', os: 'ios', cutout: 'island', pad: [12, 12, 12, 12], screenRadius: 55,
            status: 54, top: 0, bottom: 130, homeIndicator: true, buttons: 'iphone',
            land: { status: 0, top: 48, bottom: 21, sides: [59, 59] }
        },
        'iphone-notch': {
            kind: 'phone', os: 'ios', cutout: 'notch', pad: [12, 12, 12, 12], screenRadius: 47,
            status: 47, top: 0, bottom: 130, homeIndicator: true, buttons: 'iphone',
            land: { status: 0, top: 48, bottom: 21, sides: [47, 47] }
        },
        'iphone-home': {
            kind: 'phone', os: 'ios', cutout: 'none', pad: [72, 14, 72, 14], screenRadius: 0,
            status: 20, top: 0, bottom: 96, homeButton: true, speaker: true, buttons: 'iphone',
            land: { status: 0, top: 48, bottom: 0 }
        },
        'android-punch': {
            kind: 'phone', os: 'android', cutout: 'punch', pad: [9, 9, 9, 9], screenRadius: 30,
            status: 28, top: 56, bottom: 24, gestureBar: true, buttons: 'android',
            land: { status: 24, top: 56, bottom: 0, sides: [28, 0] }
        },
        'ipad': {
            kind: 'tablet', os: 'ipados', cutout: 'none', pad: [20, 20, 20, 20], screenRadius: 18,
            status: 24, top: 50, bottom: 0, homeIndicator: true, buttons: 'ipad'
        },
        'ipad-home': {
            kind: 'tablet', os: 'ipados', cutout: 'none', pad: [60, 22, 60, 22], screenRadius: 0,
            status: 24, top: 50, bottom: 0, homeButton: true, buttons: 'ipad'
        },
        'android-tablet': {
            kind: 'tablet', os: 'android', cutout: 'none', pad: [18, 18, 18, 18], screenRadius: 12,
            status: 24, top: 56, bottom: 32, gestureBar: true, buttons: 'android'
        },
        'surface': {
            kind: 'tablet', os: 'windows', cutout: 'none', pad: [18, 18, 18, 18], screenRadius: 4,
            status: 0, top: 44, bottom: 0
        },
        'laptop': {
            kind: 'desktop', os: 'desktop', cutout: 'none', pad: [18, 18, 22, 18], screenRadius: 6,
            status: 0, top: 44, bottom: 0, base: 'laptop'
        },
        'monitor': {
            kind: 'desktop', os: 'desktop', cutout: 'none', pad: [14, 14, 14, 14], screenRadius: 4,
            status: 0, top: 44, bottom: 0, base: 'monitor'
        },
        // Custom sizes keep their exact viewport: decorative bezel, no browser UI.
        'generic-phone': {
            kind: 'phone', os: 'none', cutout: 'none', pad: [12, 12, 12, 12], screenRadius: 32,
            status: 0, top: 0, bottom: 0
        },
        'generic-tablet': {
            kind: 'tablet', os: 'none', cutout: 'none', pad: [18, 18, 18, 18], screenRadius: 14,
            status: 0, top: 0, bottom: 0
        },
        'generic-monitor': {
            kind: 'desktop', os: 'none', cutout: 'none', pad: [14, 14, 14, 14], screenRadius: 4,
            status: 0, top: 0, bottom: 0, base: 'monitor'
        }
    };

    function profileKey(device) {
        if (device.frame && PROFILES[device.frame]) return device.frame;
        const shortSide = Math.min(device.width, device.height);
        if (shortSide < 600) return 'generic-phone';
        if (shortSide < 1100 && device.height >= device.width) return 'generic-tablet';
        return 'generic-monitor';
    }

    function canRotate(device) {
        return PROFILES[profileKey(device)].kind !== 'desktop';
    }

    // Everything the DOM needs for one state: sizes in CSS px.
    function layout(device, state) {
        const p = PROFILES[profileKey(device)];
        const land = !!state.landscape && p.kind !== 'desktop';
        const screenW = land ? device.height : device.width;
        const screenH = land ? device.width : device.height;

        if (!state.frames) {
            return { profile: p, framed: false, landscape: land, screenW, screenH,
                pad: [0, 0, 0, 0], status: 0, top: 0, bottom: 0, sides: [0, 0],
                viewportW: screenW, viewportH: screenH, screenRadius: 0 };
        }

        const bars = land && p.land ? p.land : p;
        // Rotating the hardware 90deg counter-clockwise moves the top bezel to the left.
        const [t, r, b, l] = p.pad;
        const pad = land ? [r, b, l, t] : [t, r, b, l];
        const status = bars.status, top = bars.top, bottom = bars.bottom;
        const sides = (land && bars.sides) || [0, 0];

        return {
            profile: p, framed: true, landscape: land, screenW, screenH, pad,
            status, top, bottom, sides,
            viewportW: screenW - sides[0] - sides[1],
            viewportH: Math.max(0, screenH - status - top - bottom),
            screenRadius: p.screenRadius
        };
    }

    // ── DOM ────────────────────────────────────────────────────────────
    const icon = (name, size) => window.CodexIcons ? window.CodexIcons.svg(name, size) : '';

    function el(tag, cls, html) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (html) n.innerHTML = html;
        return n;
    }

    function statusBar(p) {
        const bar = el('div', 'dev-status');
        const time = p.os === 'android' ? '12:30' : '9:41';
        const icons = p.os === 'android'
            ? icon('wifi', 14) + icon('antenna-bars-5', 14) + icon('battery-4', 16)
            : icon('antenna-bars-5', 15) + icon('wifi', 15) + icon('battery-4', 19);
        bar.innerHTML = `<span class="dev-status-time">${time}</span><span class="dev-status-gap"></span><span class="dev-status-icons">${icons}</span>`;
        return bar;
    }

    function hostPill(extraCls) {
        return `<div class="dev-url ${extraCls || ''}">${icon('lock', 12)}<span class="dev-host"></span></div>`;
    }

    // Top browser bar: Android Chrome, iPad / landscape-iPhone Safari, desktop window.
    function topBar(p) {
        const bar = el('div', 'dev-topbar');
        if (p.os === 'android') {
            bar.classList.add('is-chrome');
            bar.innerHTML = `<span class="dev-tb-icon">${icon('home', 18)}</span>${hostPill()}<span class="dev-tabs-count">1</span><span class="dev-tb-icon">${icon('dots-vertical', 18)}</span>`;
        } else if (p.os === 'desktop' || p.os === 'windows') {
            bar.classList.add('is-window');
            const lights = p.os === 'desktop' ? '<span class="dev-lights"><i></i><i></i><i></i></span>' : '';
            bar.innerHTML = `${lights}<span class="dev-tb-icon">${icon('chevron-left', 16)}</span><span class="dev-tb-icon">${icon('chevron-right', 16)}</span><span class="dev-tb-icon">${icon('refresh', 15)}</span>${hostPill('is-wide')}`;
        } else {
            bar.classList.add('is-safari-top');
            bar.innerHTML = `<span class="dev-tb-icon">${icon('chevron-left', 18)}</span><span class="dev-tb-icon">${icon('chevron-right', 18)}</span>${hostPill('is-wide')}<span class="dev-tb-icon">${icon('upload', 17)}</span><span class="dev-tb-icon">${icon('copy', 17)}</span>`;
        }
        return bar;
    }

    // Bottom bar: iPhone Safari (address bar + toolbar) or Android gesture area.
    function bottomBar(p) {
        const bar = el('div', 'dev-bottombar');
        if (p.os === 'ios') {
            bar.classList.add('is-safari');
            bar.innerHTML = `
                <div class="dev-safari-address"><span class="dev-aa">AA</span><span class="dev-safari-host">${icon('lock', 12)}<span class="dev-host"></span></span>${icon('refresh', 16)}</div>
                <div class="dev-safari-tools">${icon('chevron-left', 20)}${icon('chevron-right', 20)}${icon('upload', 19)}${icon('book', 19)}${icon('copy', 19)}</div>`;
        } else {
            bar.classList.add('is-gesture');
        }
        return bar;
    }

    function build(device) {
        const key = profileKey(device);
        const p = PROFILES[key];

        const root = el('div', 'device-mockup');
        root.dataset.frame = key;
        root.dataset.kind = p.kind;
        root.dataset.os = p.os;

        const shell = el('div', 'device-shell');
        shell.dataset.buttons = p.buttons || 'none';
        const screen = el('div', 'device-screen');

        const status = p.status || (p.land && p.land.status) ? statusBar(p) : null;
        const top = p.top || (p.land && p.land.top) ? topBar(p) : null;
        const bottom = p.bottom || (p.land && p.land.bottom) ? bottomBar(p) : null;
        const frame = el('div', 'viewport-frame');

        if (status) screen.appendChild(status);
        if (top) screen.appendChild(top);
        screen.appendChild(frame);
        if (bottom) screen.appendChild(bottom);

        const cutout = p.cutout !== 'none' ? el('div', 'dev-cutout is-' + p.cutout) : null;
        if (cutout) screen.appendChild(cutout);
        const homeIndicator = p.homeIndicator ? el('div', 'dev-home-indicator') : null;
        if (homeIndicator) screen.appendChild(homeIndicator);

        shell.appendChild(screen);
        if (p.homeButton) shell.appendChild(el('div', 'dev-home-button'));
        if (p.speaker) shell.appendChild(el('div', 'dev-speaker'));
        root.appendChild(shell);

        const base = p.base === 'laptop' ? el('div', 'device-base', '<span></span>') : null;
        const stand = p.base === 'monitor' ? el('div', 'device-stand', '<span class="dev-neck"></span><span class="dev-foot"></span>') : null;
        if (base) root.appendChild(base);
        if (stand) root.appendChild(stand);

        function apply(state) {
            const L = layout(device, state);
            root.dataset.framed = String(L.framed);
            root.dataset.orientation = L.landscape ? 'landscape' : 'portrait';

            shell.style.padding = L.pad.map(v => v + 'px').join(' ');
            // Unframed: radii come from CSS so it matches the plain viewport look.
            const outer = L.screenRadius + Math.min(L.pad[0], L.pad[1]);
            shell.style.borderRadius = !L.framed ? '' : p.base === 'laptop' ? `${outer}px ${outer}px 4px 4px` : outer + 'px';

            screen.style.width = L.screenW + 'px';
            screen.style.height = L.screenH + 'px';
            screen.style.borderRadius = L.framed ? L.screenRadius + 'px' : '';

            const shellW = L.screenW + L.pad[1] + L.pad[3];
            if (base) base.style.width = Math.round(shellW * 1.14) + 'px';
            if (stand) {
                stand.querySelector('.dev-neck').style.cssText = `width:${Math.round(shellW * 0.1)}px;height:${Math.round(shellW * 0.06)}px`;
                stand.querySelector('.dev-foot').style.width = Math.round(shellW * 0.3) + 'px';
            }

            if (status) { status.style.height = L.status + 'px'; status.hidden = !L.status; }
            if (top) { top.style.height = L.top + 'px'; top.hidden = !L.top; }
            if (bottom) { bottom.style.height = L.bottom + 'px'; bottom.hidden = !L.bottom; }
            if (cutout) cutout.hidden = !L.framed;
            if (homeIndicator) homeIndicator.hidden = !L.framed;

            frame.style.width = L.viewportW + 'px';
            frame.style.height = L.viewportH + 'px';
            frame.style.marginLeft = L.sides[0] + 'px';
            return L;
        }

        function setHost(host) {
            root.querySelectorAll('.dev-host').forEach(n => { n.textContent = host; });
        }

        return { root, frame, apply, setHost };
    }

    window.DeviceFrames = { build, layout, profileKey, canRotate, PROFILES };
})();
