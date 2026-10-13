// Codex AI page: free daily usage. There is no API key to enter; the AI key
// lives on the Codex Dev server (backend/). background.js answers AI_USAGE.
CodexIcons.hydrate();

const usage = document.getElementById('usage');
const pill = document.getElementById('plan-state');

if (!(self.CODEX_HOSTED && self.CODEX_HOSTED.url)) {
    usage.textContent = 'Codex AI is not available in this version yet.';
    pill.textContent = 'Unavailable';
} else {
    chrome.runtime.sendMessage({ action: 'AI_USAGE' }).then(res => {
        usage.textContent = res && res.ok && res.quota
            ? `${res.quota.remaining} of ${res.quota.limit} free requests left today.`
            : 'Could not check today\'s usage. Check your connection.';
    }).catch(() => { usage.textContent = 'Could not check today\'s usage.'; });
    pill.classList.add('is-active');
}
