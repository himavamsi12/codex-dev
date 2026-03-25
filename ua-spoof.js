
// Client-side User Agent Spoofing
// Needs to run at document_start
(function () {
    chrome.storage.local.get(['userAgent'], function (result) {
        if (result.userAgent) {
            const actualCode = `
                Object.defineProperty(navigator, 'userAgent', {
                    get: function() { return "${result.userAgent}"; }
                });
                Object.defineProperty(navigator, 'platform', {
                    get: function() { return "iPhone"; } 
                });
                Object.defineProperty(navigator, 'vendor', {
                    get: function() { return "Apple Computer, Inc."; }
                });
            `;

            const script = document.createElement('script');
            script.textContent = actualCode;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        }
    });
})();
