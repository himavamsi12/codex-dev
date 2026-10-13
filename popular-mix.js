// Popular Mix: the devices Quick Launch opens, and the devices Claude Code
// tests by default ("check responsive"). Saved in chrome.storage.local, edited
// in the popup or over MCP. Loaded by popup.html and background.js after
// devices.js.

const POPULAR_MIX_KEY = 'popularMix';
const POPULAR_MIX_MAX = 12;
const POPULAR_MIX_DEFAULT = ['iPhone 14 Pro', 'iPad Air', 'Desktop (1920x1080)'];

// Catalog names resolve to the current catalog entry; custom sizes keep their
// own size. Anything else (unknown names, bad sizes, duplicates) is dropped.
function cleanPopularMix(list) {
    if (!Array.isArray(list)) return [];
    const sizeOk = n => Number.isInteger(n) && n >= 200 && n <= 4000;
    const out = [];
    const seen = new Set();
    for (const item of list) {
        const name = typeof item === 'string' ? item : item && item.name;
        if (typeof name !== 'string' || seen.has(name)) continue;
        const match = getAllDevices().find(d => d.name === name);
        let device = null;
        if (match) device = { name: match.name, width: match.width, height: match.height, category: match.category };
        else if (item && typeof item === 'object' && sizeOk(item.width) && sizeOk(item.height) && name.length <= 60)
            device = { name, width: item.width, height: item.height, category: 'custom' };
        if (!device) continue;
        seen.add(name);
        out.push(device);
        if (out.length === POPULAR_MIX_MAX) break;
    }
    return out;
}

async function getPopularMix() {
    let saved;
    try { saved = (await chrome.storage.local.get(POPULAR_MIX_KEY))[POPULAR_MIX_KEY]; } catch (e) { /* storage unavailable */ }
    const devices = cleanPopularMix(saved);
    return devices.length
        ? { devices, isDefault: false }
        : { devices: cleanPopularMix(POPULAR_MIX_DEFAULT), isDefault: true };
}

// An empty list or null resets to the default three devices.
async function savePopularMix(list) {
    const devices = cleanPopularMix(list);
    if (devices.length) await chrome.storage.local.set({ [POPULAR_MIX_KEY]: devices });
    else await chrome.storage.local.remove(POPULAR_MIX_KEY);
    return getPopularMix();
}
