// Line icon set for every Codex Dev surface (popup, viewer, injected panels).
// Vendored from Tabler Icons v3.19.0 (outline), MIT License,
// https://github.com/tabler/tabler-icons. Extensions cannot load remote code,
// so the path data lives here. To add an icon, copy the inner elements of
// icons/outline/<name>.svg (minus the empty "M0 0h24v24H0z" frame path).
(function () {
    if (window.CodexIcons) return;

    const PATHS = {
        "adjustments-horizontal": "<path d=\"M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M4 6l8 0\"/><path d=\"M16 6l4 0\"/><path d=\"M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M4 12l2 0\"/><path d=\"M10 12l10 0\"/><path d=\"M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0\"/><path d=\"M4 18l11 0\"/><path d=\"M19 18l1 0\"/>",
        "alert-triangle": "<path d=\"M12 9v4\"/><path d=\"M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z\"/><path d=\"M12 16h.01\"/>",
        "antenna-bars-5": "<path d=\"M6 18l0 -3\"/><path d=\"M10 18l0 -6\"/><path d=\"M14 18l0 -9\"/><path d=\"M18 18l0 -12\"/>",
        "arrow-autofit-height": "<path d=\"M12 20h-6a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h6\"/><path d=\"M18 14v7\"/><path d=\"M18 3v7\"/><path d=\"M15 18l3 3l3 -3\"/><path d=\"M15 6l3 -3l3 3\"/>",
        "arrows-move": "<path d=\"M18 9l3 3l-3 3\"/><path d=\"M15 12h6\"/><path d=\"M6 9l-3 3l3 3\"/><path d=\"M3 12h6\"/><path d=\"M9 18l3 3l3 -3\"/><path d=\"M12 15v6\"/><path d=\"M15 6l-3 -3l-3 3\"/><path d=\"M12 3v6\"/>",
        "battery-4": "<path d=\"M6 7h11a2 2 0 0 1 2 2v.5a.5 .5 0 0 0 .5 .5a.5 .5 0 0 1 .5 .5v3a.5 .5 0 0 1 -.5 .5a.5 .5 0 0 0 -.5 .5v.5a2 2 0 0 1 -2 2h-11a2 2 0 0 1 -2 -2v-6a2 2 0 0 1 2 -2\"/><path d=\"M7 10l0 4\"/><path d=\"M10 10l0 4\"/><path d=\"M13 10l0 4\"/><path d=\"M16 10l0 4\"/>",
        "book": "<path d=\"M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0\"/><path d=\"M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0\"/><path d=\"M3 6l0 13\"/><path d=\"M12 6l0 13\"/><path d=\"M21 6l0 13\"/>",
        "brand-android": "<path d=\"M4 10l0 6\"/><path d=\"M20 10l0 6\"/><path d=\"M7 9h10v8a1 1 0 0 1 -1 1h-8a1 1 0 0 1 -1 -1v-8a5 5 0 0 1 10 0\"/><path d=\"M8 3l1 2\"/><path d=\"M16 3l-1 2\"/><path d=\"M9 18l0 3\"/><path d=\"M15 18l0 3\"/>",
        "brand-apple": "<path d=\"M8.286 7.008c-3.216 0 -4.286 3.23 -4.286 5.92c0 3.229 2.143 8.072 4.286 8.072c1.165 -.05 1.799 -.538 3.214 -.538c1.406 0 1.607 .538 3.214 .538s4.286 -3.229 4.286 -5.381c-.03 -.011 -2.649 -.434 -2.679 -3.23c-.02 -2.335 2.589 -3.179 2.679 -3.228c-1.096 -1.606 -3.162 -2.113 -3.75 -2.153c-1.535 -.12 -3.032 1.077 -3.75 1.077c-.729 0 -2.036 -1.077 -3.214 -1.077z\"/><path d=\"M12 4a2 2 0 0 0 2 -2a2 2 0 0 0 -2 2\"/>",
        "bug": "<path d=\"M9 9v-1a3 3 0 0 1 6 0v1\"/><path d=\"M8 9h8a6 6 0 0 1 1 3v3a5 5 0 0 1 -10 0v-3a6 6 0 0 1 1 -3\"/><path d=\"M3 13l4 0\"/><path d=\"M17 13l4 0\"/><path d=\"M12 20l0 -6\"/><path d=\"M4 19l3.35 -2\"/><path d=\"M20 19l-3.35 -2\"/><path d=\"M4 7l3.75 2.4\"/><path d=\"M20 7l-3.75 2.4\"/>",
        "bulb": "<path d=\"M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7\"/><path d=\"M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3\"/><path d=\"M9.7 17l4.6 0\"/>",
        "camera": "<path d=\"M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2\"/><path d=\"M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\"/>",
        "check": "<path d=\"M5 12l5 5l10 -10\"/>",
        "chevron-left": "<path d=\"M15 6l-6 6l6 6\"/>",
        "chevron-right": "<path d=\"M9 6l6 6l-6 6\"/>",
        "circle-check": "<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"/><path d=\"M9 12l2 2l4 -4\"/>",
        "circle-x": "<path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"/><path d=\"M10 10l4 4m0 -4l-4 4\"/>",
        "click": "<path d=\"M3 12l3 0\"/><path d=\"M12 3l0 3\"/><path d=\"M7.8 7.8l-2.2 -2.2\"/><path d=\"M16.2 7.8l2.2 -2.2\"/><path d=\"M7.8 16.2l-2.2 2.2\"/><path d=\"M12 12l9 3l-4 2l-2 4l-3 -9\"/>",
        "copy": "<path d=\"M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z\"/><path d=\"M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1\"/>",
        "device-desktop": "<path d=\"M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z\"/><path d=\"M7 20h10\"/><path d=\"M9 16v4\"/><path d=\"M15 16v4\"/>",
        "device-imac": "<path d=\"M3 4a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-12z\"/><path d=\"M3 13h18\"/><path d=\"M8 21h8\"/><path d=\"M10 17l-.5 4\"/><path d=\"M14 17l.5 4\"/>",
        "device-laptop": "<path d=\"M3 19l18 0\"/><path d=\"M5 6m0 1a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1z\"/>",
        "device-mobile": "<path d=\"M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14z\"/><path d=\"M11 4h2\"/><path d=\"M12 17v.01\"/>",
        "device-tablet": "<path d=\"M5 4a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16z\"/><path d=\"M11 17a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\"/>",
        "devices": "<path d=\"M13 9a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-10z\"/><path d=\"M18 8v-3a1 1 0 0 0 -1 -1h-13a1 1 0 0 0 -1 1v12a1 1 0 0 0 1 1h9\"/><path d=\"M16 9h2\"/>",
        "dots-vertical": "<path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/>",
        "download": "<path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\"/><path d=\"M7 11l5 5l5 -5\"/><path d=\"M12 4l0 12\"/>",
        "external-link": "<path d=\"M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6\"/><path d=\"M11 13l9 -9\"/><path d=\"M15 4h5v5\"/>",
        "eye": "<path d=\"M10 12a2 2 0 1 0 4 0a2 2 0 0 0 -4 0\"/><path d=\"M21 12c-2.4 4 -5.4 6 -9 6c-3.6 0 -6.6 -2 -9 -6c2.4 -4 5.4 -6 9 -6c3.6 0 6.6 2 9 6\"/>",
        "eye-off": "<path d=\"M10.585 10.587a2 2 0 0 0 2.829 2.828\"/><path d=\"M16.681 16.673a8.717 8.717 0 0 1 -4.681 1.327c-3.6 0 -6.6 -2 -9 -6c1.272 -2.12 2.712 -3.678 4.32 -4.674m2.86 -1.146a9.055 9.055 0 0 1 1.82 -.18c3.6 0 6.6 2 9 6c-.666 1.11 -1.379 2.067 -2.138 2.87\"/><path d=\"M3 3l18 18\"/>",
        "file-download": "<path d=\"M14 3v4a1 1 0 0 0 1 1h4\"/><path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\"/><path d=\"M12 17v-6\"/><path d=\"M9.5 14.5l2.5 2.5l2.5 -2.5\"/>",
        "file-text": "<path d=\"M14 3v4a1 1 0 0 0 1 1h4\"/><path d=\"M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z\"/><path d=\"M9 9l1 0\"/><path d=\"M9 13l6 0\"/><path d=\"M9 17l6 0\"/>",
        "frame": "<path d=\"M4 7l16 0\"/><path d=\"M4 17l16 0\"/><path d=\"M7 4l0 16\"/><path d=\"M17 4l0 16\"/>",
        "frame-off": "<path d=\"M4 7h3m4 0h9\"/><path d=\"M4 17h13\"/><path d=\"M7 7v13\"/><path d=\"M17 4v9m0 4v3\"/><path d=\"M3 3l18 18\"/>",
        "headphones": "<path d=\"M4 13m0 2a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2z\"/><path d=\"M15 13m0 2a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2z\"/><path d=\"M4 15v-3a8 8 0 0 1 16 0v3\"/>",
        "help-circle": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M12 16v.01\"/><path d=\"M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483\"/>",
        "home": "<path d=\"M5 12l-2 0l9 -9l9 9l-2 0\"/><path d=\"M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7\"/><path d=\"M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6\"/>",
        "info-circle": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M12 9h.01\"/><path d=\"M11 12h1v4h1\"/>",
        "layers-subtract": "<path d=\"M8 4m0 2a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2z\"/><path d=\"M16 16v2a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2h2\"/>",
        "layout-grid": "<path d=\"M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/><path d=\"M14 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z\"/>",
        "link": "<path d=\"M9 15l6 -6\"/><path d=\"M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464\"/><path d=\"M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463\"/>",
        "lock": "<path d=\"M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z\"/><path d=\"M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\"/><path d=\"M8 11v-4a4 4 0 1 1 8 0v4\"/>",
        "map-pin": "<path d=\"M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\"/><path d=\"M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z\"/>",
        "marquee-2": "<path d=\"M4 6v-1a1 1 0 0 1 1 -1h1m5 0h2m5 0h1a1 1 0 0 1 1 1v1m0 5v2m0 5v1a1 1 0 0 1 -1 1h-1m-5 0h-2m-5 0h-1a1 1 0 0 1 -1 -1v-1m0 -5v-2\"/>",
        "message-circle": "<path d=\"M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1\"/>",
        "pencil": "<path d=\"M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4\"/><path d=\"M13.5 6.5l4 4\"/>",
        "photo": "<path d=\"M15 8h.01\"/><path d=\"M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z\"/><path d=\"M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5\"/><path d=\"M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3\"/>",
        "photo-off": "<path d=\"M15 8h.01\"/><path d=\"M7 3h11a3 3 0 0 1 3 3v11m-.856 3.099a2.991 2.991 0 0 1 -2.144 .901h-12a3 3 0 0 1 -3 -3v-12c0 -.845 .349 -1.608 .91 -2.153\"/><path d=\"M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5\"/><path d=\"M16.33 12.338c.574 -.054 1.155 .166 1.67 .662l3 3\"/><path d=\"M3 3l18 18\"/>",
        "player-play": "<path d=\"M7 4v16l13 -8z\"/>",
        "plus": "<path d=\"M12 5l0 14\"/><path d=\"M5 12l14 0\"/>",
        "pointer": "<path d=\"M7.904 17.563a1.2 1.2 0 0 0 2.228 .308l2.09 -3.093l4.907 4.907a1.067 1.067 0 0 0 1.509 0l1.047 -1.047a1.067 1.067 0 0 0 0 -1.509l-4.907 -4.907l3.113 -2.09a1.2 1.2 0 0 0 -.309 -2.228l-13.582 -3.904l3.904 13.563z\"/>",
        "printer": "<path d=\"M17 17h2a2 2 0 0 0 2 -2v-4a2 2 0 0 0 -2 -2h-14a2 2 0 0 0 -2 2v4a2 2 0 0 0 2 2h2\"/><path d=\"M17 9v-4a2 2 0 0 0 -2 -2h-6a2 2 0 0 0 -2 2v4\"/><path d=\"M7 13m0 2a2 2 0 0 1 2 -2h6a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-6a2 2 0 0 1 -2 -2z\"/>",
        "refresh": "<path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\"/><path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\"/>",
        "rotate-clockwise": "<path d=\"M4.05 11a8 8 0 1 1 .5 4m-.5 5v-5h5\"/>",
        "ruler-measure": "<path d=\"M19.875 12c.621 0 1.125 .512 1.125 1.143v5.714c0 .631 -.504 1.143 -1.125 1.143h-15.875a1 1 0 0 1 -1 -1v-5.857c0 -.631 .504 -1.143 1.125 -1.143h15.75z\"/><path d=\"M9 12v2\"/><path d=\"M6 12v3\"/><path d=\"M12 12v3\"/><path d=\"M18 12v3\"/><path d=\"M15 12v2\"/><path d=\"M3 3v4\"/><path d=\"M3 5h18\"/><path d=\"M21 3v4\"/>",
        "search": "<path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"/><path d=\"M21 21l-6 -6\"/>",
        "sparkles": "<path d=\"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z\"/>",
        "square": "<path d=\"M3 3m0 2a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2z\"/>",
        "target": "<path d=\"M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\"/><path d=\"M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0\"/><path d=\"M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\"/>",
        "trash": "<path d=\"M4 7l16 0\"/><path d=\"M10 11l0 6\"/><path d=\"M14 11l0 6\"/><path d=\"M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12\"/><path d=\"M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3\"/>",
        "upload": "<path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\"/><path d=\"M7 9l5 -5l5 5\"/><path d=\"M12 4l0 12\"/>",
        "wifi": "<path d=\"M12 18l.01 0\"/><path d=\"M9.172 15.172a4 4 0 0 1 5.656 0\"/><path d=\"M6.343 12.343a8 8 0 0 1 11.314 0\"/><path d=\"M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0\"/>",
        "world": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\"/><path d=\"M3.6 9h16.8\"/><path d=\"M3.6 15h16.8\"/><path d=\"M11.5 3a17 17 0 0 0 0 18\"/><path d=\"M12.5 3a17 17 0 0 1 0 18\"/>",
        "world-search": "<path d=\"M21 12a9 9 0 1 0 -9 9\"/><path d=\"M3.6 9h16.8\"/><path d=\"M3.6 15h7.9\"/><path d=\"M11.5 3a17 17 0 0 0 0 18\"/><path d=\"M12.5 3a16.984 16.984 0 0 1 2.574 8.62\"/><path d=\"M18 18m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0\"/><path d=\"M20.2 20.2l1.8 1.8\"/>",
        "x": "<path d=\"M18 6l-12 12\"/><path d=\"M6 6l12 12\"/>",
        "zoom-in": "<path d=\"M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0\"/><path d=\"M7 10l6 0\"/><path d=\"M10 7l0 6\"/><path d=\"M21 21l-6 -6\"/>"
    };

    const STROKE = 1.5;

    function svg(name, size) {
        size = size || 16;
        const paths = PATHS[name] || PATHS["info-circle"];
        return `<svg class="cx-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${STROKE}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    }

    // Replace <i data-icon="name" data-size="18"></i> placeholders in static pages.
    function hydrate(root) {
        (root || document).querySelectorAll("i[data-icon]").forEach(el => {
            el.outerHTML = svg(el.dataset.icon, +el.dataset.size || 16);
        });
    }

    window.CodexIcons = { svg, hydrate, names: Object.keys(PATHS) };
})();
