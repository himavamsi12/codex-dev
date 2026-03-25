// Device presets database for responsive testing
const DEVICE_PRESETS = {
    mobile: [
        {
            name: 'iPhone 14 Pro',
            width: 393,
            height: 852,
            category: 'mobile',
            userAgent: 'iPhone',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'iPhone SE',
            width: 375,
            height: 667,
            category: 'mobile',
            userAgent: 'iPhone',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'Samsung Galaxy S23',
            width: 360,
            height: 800,
            category: 'mobile',
            userAgent: 'Samsung Phone',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'Pixel 7',
            width: 412,
            height: 915,
            category: 'mobile',
            userAgent: 'Google Pixel',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        }
    ],
    tablet: [
        {
            name: 'iPad Pro 12.9"',
            width: 1024,
            height: 1366,
            category: 'tablet',
            userAgent: 'iPad',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'iPad Air',
            width: 820,
            height: 1180,
            category: 'tablet',
            userAgent: 'iPad',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'iPad Mini',
            width: 744,
            height: 1133,
            category: 'tablet',
            userAgent: 'iPad',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        },
        {
            name: 'Surface Pro 7',
            width: 912,
            height: 1368,
            category: 'tablet',
            userAgent: 'Microsoft Edge',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>'
        }
    ],
    desktop: [
        {
            name: 'Laptop (1366x768)',
            width: 1366,
            height: 768,
            category: 'desktop',
            userAgent: 'Google Chrome',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
        },
        {
            name: 'Desktop (1920x1080)',
            width: 1920,
            height: 1080,
            category: 'desktop',
            userAgent: 'Google Chrome',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
        },
        {
            name: 'Desktop HD (2560x1440)',
            width: 2560,
            height: 1440,
            category: 'desktop',
            userAgent: 'Google Chrome',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
        },
        {
            name: 'Desktop 4K (3840x2160)',
            width: 3840,
            height: 2160,
            category: 'desktop',
            userAgent: 'Google Chrome',
            icon: '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>'
        }
    ]
};

// Get all devices as a flat array
function getAllDevices() {
    return [
        ...DEVICE_PRESETS.mobile,
        ...DEVICE_PRESETS.tablet,
        ...DEVICE_PRESETS.desktop
    ];
}

// Get devices by category
function getDevicesByCategory(category) {
    return DEVICE_PRESETS[category] || [];
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEVICE_PRESETS, getAllDevices, getDevicesByCategory };
}
