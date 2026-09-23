// Codex AI settings: the user's own API key and model for each provider,
// stored in chrome.storage.local ('codexAi'). background.js reads it for AI
// requests:
//   { provider: 'anthropic' | 'openai',
//     anthropic: { apiKey, model }, openai: { apiKey, model } }
CodexIcons.hydrate();

const $ = id => document.getElementById(id);
const keyInput = $('api-key');
const modelSelect = $('model');
const status = $('status');
const providerInputs = [...document.querySelectorAll('input[name="provider"]')];

const PROVIDERS = {
    anthropic: {
        name: 'Anthropic',
        lib: CodexAI,
        keyLabel: 'Anthropic API key',
        placeholder: 'sk-ant-...',
        keyPattern: /^sk-ant-/,
        keyHint: 'Anthropic keys start with sk-ant-',
        keyHelp: 'Create one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. It is stored only in this browser and sent only to Anthropic.',
        modelHelp: 'Opus gives the best results for layout changes. Sonnet and Haiku are faster and cost less.',
    },
    openai: {
        name: 'OpenAI',
        lib: CodexOpenAI,
        keyLabel: 'OpenAI API key',
        placeholder: 'sk-...',
        keyPattern: /^sk-/,
        keyHint: 'OpenAI keys start with sk-',
        keyHelp: 'Create one at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>. A ChatGPT Plus or Pro subscription does not include API access, so the account needs API billing. The key is stored only in this browser and sent only to OpenAI.',
        modelHelp: 'GPT-5 gives the best results for layout changes. Press Test key to load every model your key can use.',
    },
};

let settings = null;     // normalized settings, as saved
let shown = 'anthropic'; // provider currently shown in the form

function showStatus(message, kind) {
    status.textContent = message;
    status.className = 'status' + (kind ? ' is-' + kind : '');
    status.hidden = !message;
}

// Older versions stored a single Anthropic key as { apiKey, model }
function normalize(raw) {
    raw = raw || {};
    const out = {
        provider: raw.provider === 'openai' ? 'openai' : 'anthropic',
        anthropic: { ...(raw.anthropic || {}) },
        openai: { ...(raw.openai || {}) },
    };
    if (raw.apiKey && !out.anthropic.apiKey) out.anthropic = { apiKey: raw.apiKey, model: raw.model };
    return out;
}
async function loadSettings() {
    const { codexAi } = await chrome.storage.local.get('codexAi');
    settings = normalize(codexAi);
}
async function saveSettings() {
    await chrome.storage.local.set({ codexAi: settings });
}

function setPlanState() {
    const pill = $('plan-state');
    const conf = settings[shown];
    const active = !!conf.apiKey && settings.provider === shown;
    pill.textContent = active ? 'Active' : conf.apiKey ? 'Key saved' : 'Not set up';
    pill.classList.toggle('is-active', active);
}

function fillModels(provider, extraIds) {
    const p = PROVIDERS[provider];
    const current = settings[provider].model || p.lib.DEFAULT_MODEL;
    const options = p.lib.MODELS.map(m => ({ id: m.id, label: m.label }));
    const ids = new Set(options.map(o => o.id));
    // The user's own model list (OpenAI, after Test key) and their saved choice
    [...(extraIds || settings[provider].models || []), current].forEach(id => {
        if (id && !ids.has(id)) { ids.add(id); options.push({ id, label: id }); }
    });
    modelSelect.textContent = '';
    options.forEach(o => {
        const option = document.createElement('option');
        option.value = o.id;
        option.textContent = o.label;
        modelSelect.appendChild(option);
    });
    modelSelect.value = current;
}

// Switch the form to one provider
function show(provider) {
    shown = provider;
    const p = PROVIDERS[provider];
    providerInputs.forEach(i => { i.checked = i.value === provider; });
    $('key-label').textContent = p.keyLabel;
    keyInput.placeholder = p.placeholder;
    keyInput.value = settings[provider].apiKey || '';
    keyInput.removeAttribute('aria-invalid');
    $('key-help').innerHTML = p.keyHelp;
    $('model-help').textContent = p.modelHelp;
    fillModels(provider);
    setPlanState();
}

providerInputs.forEach(input => input.addEventListener('change', async () => {
    show(input.value);
    // Switching to a provider that already has a key makes it active at once
    if (settings[input.value].apiKey && settings.provider !== input.value) {
        settings.provider = input.value;
        await saveSettings();
        setPlanState();
        showStatus(`Codex AI now uses ${PROVIDERS[input.value].name}.`, 'ok');
    } else {
        showStatus('', null);
    }
}));

function readKey() {
    const key = keyInput.value.trim();
    keyInput.removeAttribute('aria-invalid');
    if (!key) {
        keyInput.setAttribute('aria-invalid', 'true');
        showStatus(`Enter your ${PROVIDERS[shown].name} API key first.`, 'error');
        return null;
    }
    return key;
}

$('settings-form').addEventListener('submit', async e => {
    e.preventDefault();
    const apiKey = readKey();
    if (!apiKey) return;
    const p = PROVIDERS[shown];
    settings[shown] = { ...settings[shown], apiKey, model: modelSelect.value };
    settings.provider = shown;
    await saveSettings();
    setPlanState();
    const looksRight = p.keyPattern.test(apiKey);
    showStatus(looksRight
        ? `Saved. Codex AI now uses ${p.name} and is ready in the Design Inspector.`
        : `Saved. This does not look like an ${p.name} key (${p.keyHint}). Use Test key to check it.`, looksRight ? 'ok' : 'error');
});

$('test').addEventListener('click', async () => {
    const apiKey = readKey();
    if (!apiKey) return;
    const provider = shown;
    const p = PROVIDERS[provider];
    const button = $('test');
    button.disabled = true;
    showStatus('Testing your key...', null);
    try {
        if (provider === 'openai') {
            // Load the models this key can actually use
            const models = await p.lib.listModels(apiKey);
            const chosen = modelSelect.value;
            settings.openai.models = models;
            fillModels('openai', models);
            modelSelect.value = models.includes(chosen) ? chosen
                : models.includes(p.lib.DEFAULT_MODEL) ? p.lib.DEFAULT_MODEL : (models[0] || chosen);
            if (settings.openai.apiKey) await saveSettings();
            showStatus(models.length
                ? `It works. ${models.length} models available; ${modelSelect.value} is selected. Press Save to use it.`
                : 'The key works, but it has no chat models Codex AI can use.', models.length ? 'ok' : 'error');
        } else {
            const result = await p.lib.testKey({ apiKey, model: modelSelect.value });
            showStatus(`It works. ${result.model} replied.`, 'ok');
        }
    } catch (err) {
        showStatus(p.lib.describeError(err).message, 'error');
    } finally {
        button.disabled = false;
    }
});

$('remove').addEventListener('click', async () => {
    const p = PROVIDERS[shown];
    settings[shown] = {};
    // Fall back to the other provider if it still has a key
    const other = shown === 'anthropic' ? 'openai' : 'anthropic';
    if (settings.provider === shown && settings[other].apiKey) settings.provider = other;
    await saveSettings();
    show(shown);
    showStatus(settings[settings.provider].apiKey
        ? `${p.name} key removed. Codex AI now uses ${PROVIDERS[settings.provider].name}.`
        : `${p.name} key removed from this browser. Codex AI is off until you add a key.`, null);
});

$('toggle-key').addEventListener('click', e => {
    const showing = keyInput.type === 'text';
    keyInput.type = showing ? 'password' : 'text';
    e.currentTarget.textContent = showing ? 'Show' : 'Hide';
    e.currentTarget.setAttribute('aria-pressed', String(!showing));
});

loadSettings().then(() => show(settings.provider));
