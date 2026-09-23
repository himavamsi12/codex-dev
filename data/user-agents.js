// Ported from responsive-viewer-master/src/data/userAgents.ts

const userAgents = [
    {
        name: 'Google Chrome',
        value:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.142 Safari/537.36',
    },
    {
        name: 'Mozilla Firefox',
        value:
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.14; rv:66.0) Gecko/20100101 Firefox/66.0',
    },
    {
        name: 'Microsoft Edge',
        value:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.79 Safari/537.36 Edge/14.14393',
    },
    {
        name: 'iPhone (Safari)',
        value:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
    {
        name: 'Android (Chrome)',
        value:
            'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
    },
    {
        name: 'iPad (Safari)',
        value:
            'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    },
];

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = userAgents;
} else {
    window.USER_AGENTS = userAgents;
}
