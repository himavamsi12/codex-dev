// Background script to strip headers that block iframe embedding
// Uses declarativeNetRequest API (Manifest V3 compatible)

console.log('Responsive Viewer: Background script loaded');

// Define rules to remove headers that block iframe embedding
const rules = [
    {
        id: 1,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'X-Frame-Options', operation: 'remove' },
                { header: 'Frame-Options', operation: 'remove' }
            ]
        },
        condition: {
            resourceTypes: ['sub_frame'],
            urlFilter: '*'
        }
    },
    {
        id: 2,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'Content-Security-Policy', operation: 'remove' }
            ]
        },
        condition: {
            resourceTypes: ['sub_frame'],
            urlFilter: '*'
        }
    }
];

// Update dynamic rules on extension installation/update
chrome.runtime.onInstalled.addListener(() => {
    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: rules.map(rule => rule.id),
        addRules: rules
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Failed to add rules:', chrome.runtime.lastError);
        } else {
            console.log('Responsive Viewer: Header stripping rules installed successfully');
        }
    });
});


// Handle User Agent updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SET_USER_AGENT') {
        const userAgent = message.value;
        updateUserAgentRule(userAgent);
    }
});

function updateUserAgentRule(userAgent) {
    const ruleId = 999; // Reserved ID for UA rule

    if (!userAgent) {
        // Remove rule if no UA specified
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [ruleId],
            addRules: []
        }, () => {
            console.log('User Agent spoofing disabled');
        });
        return;
    }

    const rule = {
        id: ruleId,
        priority: 2,
        action: {
            type: 'modifyHeaders',
            requestHeaders: [
                { header: 'User-Agent', operation: 'set', value: userAgent }
            ]
        },
        condition: {
            // Apply to all urls
            urlFilter: '*',
            resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'script', 'image', 'stylesheet']
        }
    };

    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleId],
        addRules: [rule]
    }, () => {
        if (chrome.runtime.lastError) {
            console.error('Failed to update UA rule:', chrome.runtime.lastError);
        } else {
            console.log('User Agent set to:', userAgent);
        }
    });
}

console.log('Responsive Viewer: Header stripping enabled for all iframes');
