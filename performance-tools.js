
class PerformanceTools {
    constructor() {
        this.tabId = null;
        this.isDebugging = false;
        // Device frames on other sites run in their own processes (out-of-process
        // iframes): throttling the viewer tab alone never reaches them. Auto-attach
        // gives each frame its own debugger session, and every setting is applied
        // to the tab and to each of those sessions.
        this.sessions = new Set();

        // Define Network Presets (Chrome DevTools defaults)
        this.networkPresets = {
            'online': {
                offline: false,
                latency: 0,
                downloadThroughput: -1,
                uploadThroughput: -1
            },
            'fast3g': {
                offline: false,
                latency: 150,
                downloadThroughput: 1.6 * 1024 * 1024 / 8, // 1.6 Mbps
                uploadThroughput: 750 * 1024 / 8           // 750 Kbps
            },
            'slow3g': {
                offline: false,
                latency: 400,
                downloadThroughput: 400 * 1024 / 8,        // 400 Kbps
                uploadThroughput: 400 * 1024 / 8           // 400 Kbps
            },
            'offline': {
                offline: true,
                latency: 0,
                downloadThroughput: 0,
                uploadThroughput: 0
            }
        };

        // CPU Presets
        this.cpuPresets = {
            '1': 1, // No throttling
            '4': 4, // 4x slowdown
            '6': 6  // 6x slowdown
        };

        this.currentNetwork = 'online';
        this.currentCpu = '1';
    }

    init() {
        // Get current tab ID
        chrome.tabs.getCurrent((tab) => {
            this.tabId = tab.id;
            this.attachUI();
        });

        // Listen for detach events (user closed warning banner)
        chrome.debugger.onDetach.addListener((source, reason) => {
            if (source.tabId === this.tabId && !source.sessionId) {
                console.log('Debugger detached:', reason);
                this.isDebugging = false;
                this.sessions.clear();
                this.updateUIState();
            }
        });

        // A device frame was created or reloaded: throttle it before it runs.
        chrome.debugger.onEvent.addListener((source, method, params) => {
            if (source.tabId !== this.tabId) return;
            if (method === 'Target.attachedToTarget') {
                const session = { tabId: this.tabId, sessionId: params.sessionId };
                // Workers (the page's own) only get network throttling; frames get both.
                const isFrame = /^(page|iframe)$/.test(params.targetInfo && params.targetInfo.type);
                this.sessions.add(params.sessionId);
                (isFrame ? this.prepare(session).then(() => this.applyTo(session)) : this.applyNetwork(session))
                    .catch(e => console.warn('Throttle frame:', e.message))
                    .finally(() => this.send(session, 'Runtime.runIfWaitingForDebugger').catch(() => {}));
            } else if (method === 'Target.detachedFromTarget') {
                this.sessions.delete(params.sessionId);
            }
        });
    }

    attachUI() {
        const headerRight = document.querySelector('.header-right');

        // Create Container
        const container = document.createElement('div');
        container.className = 'perf-controls';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.marginRight = '10px';
        container.style.alignItems = 'center';

        // Network Select
        const netSelect = document.createElement('select');
        netSelect.className = 'perf-select';
        netSelect.innerHTML = `
            <option value="online">Online</option>
            <option value="fast3g">Fast 3G</option>
            <option value="slow3g">Slow 3G</option>
            <option value="offline">Offline</option>
        `;
        netSelect.title = "Network Simulation";

        // CPU Select
        const cpuSelect = document.createElement('select');
        cpuSelect.className = 'perf-select';
        cpuSelect.innerHTML = `
            <option value="1">No CPU Throttle</option>
            <option value="4">4x Slowdown</option>
            <option value="6">6x Slowdown</option>
        `;
        cpuSelect.title = "CPU Throttling";

        // Append
        container.appendChild(netSelect);
        container.appendChild(cpuSelect);

        // Insert before Design Tools (Grid/Ruler)
        const firstBtn = headerRight.firstChild;
        headerRight.insertBefore(container, firstBtn);

        // Listeners
        netSelect.addEventListener('change', (e) => {
            this.currentNetwork = e.target.value;
            this.applySettings();
        });

        cpuSelect.addEventListener('change', (e) => {
            this.currentCpu = e.target.value;
            this.applySettings();
        });

        this.netSelect = netSelect;
        this.cpuSelect = cpuSelect;
    }

    send(target, method, params) {
        return new Promise((resolve, reject) => {
            chrome.debugger.sendCommand(target, method, params || {}, (res) => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve(res);
            });
        });
    }

    // Network emulation needs the Network domain; nested frames need auto-attach too.
    async prepare(target) {
        await this.send(target, 'Network.enable');
        await this.send(target, 'Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    }

    async attachDebugger() {
        if (this.isDebugging) return;
        const target = { tabId: this.tabId };
        await new Promise((resolve, reject) => {
            chrome.debugger.attach(target, "1.3", () => {
                if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
                else resolve();
            });
        });
        this.isDebugging = true;
        // Attaches to the frames already open as well (Target.attachedToTarget for each).
        await this.prepare(target);
    }

    async applyNetwork(target) {
        await this.send(target, 'Network.enable');
        await this.send(target, 'Network.emulateNetworkConditions', this.networkPresets[this.currentNetwork]);
    }

    async applyTo(target) {
        await this.send(target, 'Network.emulateNetworkConditions', this.networkPresets[this.currentNetwork]);
        await this.send(target, 'Emulation.setCPUThrottlingRate', { rate: this.cpuPresets[this.currentCpu] || 1 });
    }

    // One change at a time: two quick changes must not interleave attach/detach.
    applySettings() {
        this.queue = (this.queue || Promise.resolve()).then(() => this.applyNow());
        return this.queue;
    }

    async applyNow() {
        const isDefault = this.currentNetwork === 'online' && this.currentCpu === '1';

        if (isDefault) {
            // Detaching drops every emulation and removes Chrome's debugging banner.
            if (this.isDebugging) chrome.debugger.detach({ tabId: this.tabId }, () => void chrome.runtime.lastError);
            this.isDebugging = false;
            this.sessions.clear();
            return;
        }

        try {
            await this.attachDebugger();
            const targets = [{ tabId: this.tabId }].concat(Array.from(this.sessions, sessionId => ({ tabId: this.tabId, sessionId })));
            await Promise.all(targets.map(t => this.applyTo(t).catch(e => {
                if (!t.sessionId) throw e;
                // A worker (network only) or a frame that went away meanwhile
                return this.applyNetwork(t).catch(() => this.sessions.delete(t.sessionId));
            })));
        } catch (e) {
            console.error('Throttling failed:', e);
            const msg = /attached/i.test(e.message)
                ? 'Throttling needs the debugger, which DevTools or another tool is using. Close it and try again.'
                : 'Could not apply throttling: ' + e.message;
            if (window.CodexUI) CodexUI.toast(msg, 5000);
            this.updateUIState();
            if (this.isDebugging) chrome.debugger.detach({ tabId: this.tabId }, () => void chrome.runtime.lastError);
            this.isDebugging = false;
            this.sessions.clear();
        }
    }

    updateUIState() {
        // If detached externally, reset UI controls
        this.currentNetwork = 'online';
        this.currentCpu = '1';
        if (this.netSelect) this.netSelect.value = 'online';
        if (this.cpuSelect) this.cpuSelect.value = '1';
    }
}

window.PerformanceTools = new PerformanceTools();
