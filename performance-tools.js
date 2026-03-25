
class PerformanceTools {
    constructor() {
        this.tabId = null;
        this.isDebugging = false;

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
            if (source.tabId === this.tabId) {
                console.log('Debugger detached:', reason);
                this.isDebugging = false;
                this.updateUIState();
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

    async attachDebugger() {
        if (this.isDebugging) return;
        return new Promise((resolve, reject) => {
            const target = { tabId: this.tabId };
            chrome.debugger.attach(target, "1.3", () => {
                if (chrome.runtime.lastError) {
                    console.error(chrome.runtime.lastError);
                    reject(chrome.runtime.lastError);
                    return;
                }
                this.isDebugging = true;
                resolve();
            });
        });
    }

    async applySettings() {
        // If settings are default, we might not need debugger attached? 
        // Actually, better to keep attached if user interacted, or detach if both are default.
        // For simplicity, we attach on first non-default usage.

        const isDefault = this.currentNetwork === 'online' && this.currentCpu === '1';

        if (!this.isDebugging && !isDefault) {
            await this.attachDebugger();
        }

        if (!this.isDebugging) return; // Should be attached now if needed

        const target = { tabId: this.tabId };

        // Apply Network
        const netProfile = this.networkPresets[this.currentNetwork];
        chrome.debugger.sendCommand(target, "Network.emulateNetworkConditions", netProfile);

        // Apply CPU
        const rate = parseInt(this.currentCpu);
        chrome.debugger.sendCommand(target, "Emulation.setCPUThrottlingRate", { rate: rate });

        // If back to defaults, we could detach to remove the banner
        if (isDefault) {
            chrome.debugger.detach(target, () => {
                this.isDebugging = false;
            });
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
