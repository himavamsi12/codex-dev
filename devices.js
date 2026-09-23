// Device presets database for responsive testing.
//
// Sizes are CSS viewport pixels (portrait), from Apple's published point
// sizes and Chrome DevTools' device presets. `frame` picks the mockup profile
// in device-frames.js (bezel, cutout, status bar, browser UI).

// Tabler outline icons (MIT), same set as utils/icons.js. Inlined because this
// file also loads in pages before icons.js and the markup travels in viewer URLs.
const DEVICE_ICONS = {
    mobile: "<svg class=\"cx-icon\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14z\"/><path d=\"M11 4h2\"/><path d=\"M12 17v.01\"/></svg>",
    tablet: "<svg class=\"cx-icon\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M5 4a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v16a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1v-16z\"/><path d=\"M11 17a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\"/></svg>",
    desktop: "<svg class=\"cx-icon\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z\"/><path d=\"M7 20h10\"/><path d=\"M9 16v4\"/><path d=\"M15 16v4\"/></svg>"
};

// [name, width, height, frame, brand]
const DEVICE_TABLE = {
    mobile: [
        // Apple
        ['iPhone SE (1st gen)', 320, 568, 'iphone-home', 'apple'],
        ['iPhone SE', 375, 667, 'iphone-home', 'apple'],
        ['iPhone 8 Plus', 414, 736, 'iphone-home', 'apple'],
        ['iPhone X', 375, 812, 'iphone-notch', 'apple'],
        ['iPhone XR', 414, 896, 'iphone-notch', 'apple'],
        ['iPhone 11', 414, 896, 'iphone-notch', 'apple'],
        ['iPhone 11 Pro', 375, 812, 'iphone-notch', 'apple'],
        ['iPhone 11 Pro Max', 414, 896, 'iphone-notch', 'apple'],
        ['iPhone 12 mini', 375, 812, 'iphone-notch', 'apple'],
        ['iPhone 12', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 12 Pro', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 12 Pro Max', 428, 926, 'iphone-notch', 'apple'],
        ['iPhone 13 mini', 375, 812, 'iphone-notch', 'apple'],
        ['iPhone 13', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 13 Pro', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 13 Pro Max', 428, 926, 'iphone-notch', 'apple'],
        ['iPhone 14', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 14 Plus', 428, 926, 'iphone-notch', 'apple'],
        ['iPhone 14 Pro', 393, 852, 'iphone-island', 'apple'],
        ['iPhone 14 Pro Max', 430, 932, 'iphone-island', 'apple'],
        ['iPhone 15', 393, 852, 'iphone-island', 'apple'],
        ['iPhone 15 Plus', 430, 932, 'iphone-island', 'apple'],
        ['iPhone 15 Pro', 393, 852, 'iphone-island', 'apple'],
        ['iPhone 15 Pro Max', 430, 932, 'iphone-island', 'apple'],
        ['iPhone 16e', 390, 844, 'iphone-notch', 'apple'],
        ['iPhone 16', 393, 852, 'iphone-island', 'apple'],
        ['iPhone 16 Plus', 430, 932, 'iphone-island', 'apple'],
        ['iPhone 16 Pro', 402, 874, 'iphone-island', 'apple'],
        ['iPhone 16 Pro Max', 440, 956, 'iphone-island', 'apple'],
        ['iPhone 17', 402, 874, 'iphone-island', 'apple'],
        ['iPhone Air', 420, 912, 'iphone-island', 'apple'],
        ['iPhone 17 Pro', 402, 874, 'iphone-island', 'apple'],
        ['iPhone 17 Pro Max', 440, 956, 'iphone-island', 'apple'],
        // Android
        ['Samsung Galaxy S20', 360, 800, 'android-punch', 'android'],
        ['Samsung Galaxy S20 Ultra', 412, 915, 'android-punch', 'android'],
        ['Samsung Galaxy S21', 360, 800, 'android-punch', 'android'],
        ['Samsung Galaxy S21 Ultra', 384, 854, 'android-punch', 'android'],
        ['Samsung Galaxy S22', 360, 780, 'android-punch', 'android'],
        ['Samsung Galaxy S22+', 384, 832, 'android-punch', 'android'],
        ['Samsung Galaxy S22 Ultra', 384, 824, 'android-punch', 'android'],
        ['Samsung Galaxy S23', 360, 780, 'android-punch', 'android'],
        ['Samsung Galaxy S23 Ultra', 384, 824, 'android-punch', 'android'],
        ['Samsung Galaxy S24', 360, 780, 'android-punch', 'android'],
        ['Samsung Galaxy S24 Ultra', 384, 832, 'android-punch', 'android'],
        ['Samsung Galaxy A12', 360, 800, 'android-punch', 'android'],
        ['Samsung Galaxy A51/71', 412, 914, 'android-punch', 'android'],
        ['Samsung Galaxy Z Flip3', 360, 880, 'android-punch', 'android'],
        ['Samsung Galaxy Z Fold5 (cover)', 344, 882, 'android-punch', 'android'],
        ['Google Pixel 5', 393, 851, 'android-punch', 'android'],
        ['Google Pixel 6', 412, 915, 'android-punch', 'android'],
        ['Google Pixel 6 Pro', 412, 892, 'android-punch', 'android'],
        ['Pixel 7', 412, 915, 'android-punch', 'android'],
        ['Google Pixel 7 Pro', 412, 892, 'android-punch', 'android'],
        ['Google Pixel 8', 412, 915, 'android-punch', 'android'],
        ['Google Pixel 8 Pro', 448, 998, 'android-punch', 'android'],
        ['OnePlus Nord 2', 412, 915, 'android-punch', 'android'],
        ['Xiaomi Mi 11i', 393, 873, 'android-punch', 'android'],
        ['Xiaomi 12', 393, 873, 'android-punch', 'android'],
        ['Huawei P30 Pro', 360, 780, 'android-punch', 'android'],
        ['Motorola Moto G Power', 412, 823, 'android-punch', 'android']
    ],
    tablet: [
        ['iPad Mini', 744, 1133, 'ipad', 'apple'],
        ['iPad (9th gen)', 810, 1080, 'ipad-home', 'apple'],
        ['iPad (10th gen)', 820, 1180, 'ipad', 'apple'],
        ['iPad Air', 820, 1180, 'ipad', 'apple'],
        ['iPad Pro 11"', 834, 1194, 'ipad', 'apple'],
        ['iPad Pro 12.9"', 1024, 1366, 'ipad', 'apple'],
        ['Samsung Galaxy Tab S4', 712, 1138, 'android-tablet', 'android'],
        ['Samsung Galaxy Tab S7', 800, 1280, 'android-tablet', 'android'],
        ['Surface Pro 7', 912, 1368, 'surface', 'other']
    ],
    desktop: [
        ['Laptop (1280x800)', 1280, 800, 'laptop', 'other'],
        ['Laptop (1366x768)', 1366, 768, 'laptop', 'other'],
        ['MacBook Air 13"', 1470, 956, 'laptop', 'apple'],
        ['MacBook Pro 14"', 1512, 982, 'laptop', 'apple'],
        ['MacBook Pro 16"', 1728, 1117, 'laptop', 'apple'],
        ['Desktop (1920x1080)', 1920, 1080, 'monitor', 'other'],
        ['iMac 24"', 2240, 1260, 'monitor', 'apple'],
        ['Desktop HD (2560x1440)', 2560, 1440, 'monitor', 'other'],
        ['Desktop 4K (3840x2160)', 3840, 2160, 'monitor', 'other']
    ]
};

const DEVICE_PRESETS = {};
Object.keys(DEVICE_TABLE).forEach(category => {
    DEVICE_PRESETS[category] = DEVICE_TABLE[category].map(([name, width, height, frame, brand]) => ({
        name, width, height, category, frame, brand,
        icon: DEVICE_ICONS[category]
    }));
});

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

// Catalog entry for a device object that came in through a URL (older links
// and the popup only carry name/size); custom devices pass through unchanged.
function resolveDevice(device) {
    const match = getAllDevices().find(d => d.name === device.name);
    return match ? { ...match } : { ...device };
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { DEVICE_PRESETS, getAllDevices, getDevicesByCategory, resolveDevice };
}
