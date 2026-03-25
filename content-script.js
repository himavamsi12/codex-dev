// Content script injected into all frames for sync scroll
(function () {
    'use strict';

    // Check if we're in an iframe
    const isInIframe = window !== window.top;

    if (!isInIframe) {
        return;
    }

    let frameId = null;
    let syncScrollEnabled = false;
    let isScrolling = false;
    let ticking = false;
    let scrollTimeout;

    // Use requestAnimationFrame + tiny debounce for smooth continuous updates
    window.addEventListener('scroll', function () {
        if (isScrolling) {
            return;
        }

        if (!syncScrollEnabled || !frameId) {
            return;
        }

        // Tiny debounce to smooth out jerkiness while keeping simultaneous feel
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            // Throttle to animation frames (60fps) for smooth continuous scrolling
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    // Calculate scroll percentage
                    const scrollPercentX = window.scrollX / Math.max(1, document.documentElement.scrollWidth - window.innerWidth);
                    const scrollPercentY = window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight);

                    // Send scroll position to parent immediately
                    window.parent.postMessage({
                        type: 'IFRAME_SCROLL',
                        frameId: frameId,
                        scrollPercentX: isNaN(scrollPercentX) ? 0 : scrollPercentX,
                        scrollPercentY: isNaN(scrollPercentY) ? 0 : scrollPercentY
                    }, '*');

                    ticking = false;
                });
                ticking = true;
            }
        }, 5); // 5ms - minimal delay to smooth jerkiness
    }, { passive: true });

    // Listen for sync scroll commands from parent
    window.addEventListener('message', function (event) {
        // Security: Only accept messages from chrome-extension origin
        if (!event.origin.startsWith('chrome-extension://')) {
            return;
        }

        if (event.data.type === 'ENABLE_SYNC_SCROLL') {
            // Receive frame ID from parent
            frameId = event.data.frameId;
            syncScrollEnabled = true;
            console.log('✅ Sync scroll enabled in frame:', frameId);
        } else if (event.data.type === 'DISABLE_SYNC_SCROLL') {
            syncScrollEnabled = false;
            console.log('❌ Sync scroll disabled in frame:', frameId);
        } else if (event.data.type === 'SYNC_SCROLL' && event.data.sourceFrameId !== frameId) {
            if (!syncScrollEnabled || !frameId) {
                return;
            }

            // Calculate target scroll position
            const targetX = event.data.scrollPercentX * Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
            const targetY = event.data.scrollPercentY * Math.max(0, document.documentElement.scrollHeight - window.innerHeight);

            // Set flag to prevent broadcasting
            isScrolling = true;

            // Scroll instantly for continuous feel
            window.scrollTo(
                isNaN(targetX) ? 0 : targetX,
                isNaN(targetY) ? 0 : targetY
            );

            // Reset flag immediately for next update
            isScrolling = false;
        } else if (event.data.type === 'GET_FULL_PAGE_DIMENSIONS') {
            // Send full page dimensions back to parent for screenshot
            window.parent.postMessage({
                type: 'FULL_PAGE_DIMENSIONS',
                scrollWidth: document.documentElement.scrollWidth,
                scrollHeight: document.documentElement.scrollHeight
            }, '*');
        } else if (event.data.type === 'SCROLL_TO_POSITION') {
            // Scroll to specific position for screenshot capture
            window.scrollTo(0, event.data.scrollY);
        } else if (event.data.type === 'FORCE_REPAINT') {
            // Force browser to repaint/reflow
            document.body.offsetHeight; // Trigger reflow
        }
    });

    console.log('🔧 Sync scroll content script loaded and waiting for frame ID');
})();
