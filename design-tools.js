
class DesignTools {
    constructor() {
        this.rulerEnabled = false;
        this.gridEnabled = false;

        // Configuration
        this.gridSize = 20; // 20px grid
    }

    init() {
        this.attachHeaderControls();
    }

    attachHeaderControls() {
        const headerRight = document.querySelector('.header-right');

        // Grid Button
        const gridBtn = document.createElement('button');
        gridBtn.className = 'control-btn';
        gridBtn.id = 'toggle-grid';
        gridBtn.title = 'Toggle Grid Overlay';
        gridBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="3" y1="15" x2="21" y2="15"></line>
                <line x1="9" y1="3" x2="9" y2="21"></line>
                <line x1="15" y1="3" x2="15" y2="21"></line>
            </svg>
        `;

        // Ruler Button
        const rulerBtn = document.createElement('button');
        rulerBtn.className = 'control-btn';
        rulerBtn.id = 'toggle-ruler';
        rulerBtn.title = 'Toggle Ruler';
        rulerBtn.innerHTML = `
            <svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 6H3"></path>
                <path d="M21 12H3"></path>
                <path d="M21 18H3"></path>
                <path d="M5 6v12"></path>
                <path d="M9 6v12"></path>
                <path d="M13 6v12"></path>
                <path d="M17 6v12"></path>
            </svg>
        `;

        headerRight.appendChild(gridBtn);
        headerRight.appendChild(rulerBtn);

        // Event Listeners
        gridBtn.addEventListener('click', () => {
            this.toggleGrid();
            gridBtn.classList.toggle('active', this.gridEnabled);
        });

        rulerBtn.addEventListener('click', () => {
            this.toggleRuler();
            rulerBtn.classList.toggle('active', this.rulerEnabled);
        });
    }

    // --- GRID FEATURES ---

    toggleGrid() {
        this.gridEnabled = !this.gridEnabled;
        const frames = document.querySelectorAll('.viewport-frame');

        frames.forEach(frame => {
            if (this.gridEnabled) {
                this.addGridToFrame(frame);
            } else {
                this.removeGridFromFrame(frame);
            }
        });
    }

    addGridToFrame(frame) {
        if (frame.querySelector('.grid-overlay')) return;

        const grid = document.createElement('div');
        grid.className = 'grid-overlay';
        frame.appendChild(grid);
    }

    removeGridFromFrame(frame) {
        const grid = frame.querySelector('.grid-overlay');
        if (grid) grid.remove();
    }

    // --- RULER FEATURES ---

    toggleRuler() {
        this.rulerEnabled = !this.rulerEnabled;
        const frames = document.querySelectorAll('.viewport-frame');

        frames.forEach(frame => {
            if (this.rulerEnabled) {
                this.addRulerToFrame(frame);
            } else {
                this.removeRulerFromFrame(frame);
            }
        });
    }

    addRulerToFrame(frame) {
        if (frame.querySelector('.ruler-overlay')) return;

        // Use scrollWidth/Height to cover entire content if scrolled, 
        // OR use offsetWidth/Height if we just want the visible frame.
        // Usually rulers are on the 'frame' so they scroll with it? 
        // If the frame has overflow:hidden and iframe scrolls, the ruler should be on top.
        // We will match the frame size.
        const width = parseInt(frame.style.width);
        const height = parseInt(frame.style.height);

        const overlay = document.createElement('div');
        overlay.className = 'ruler-overlay';

        const rulerX = document.createElement('div');
        rulerX.className = 'ruler-x';
        this.drawTicks(rulerX, width, 'x');

        const rulerY = document.createElement('div');
        rulerY.className = 'ruler-y';
        this.drawTicks(rulerY, height, 'y');

        // Guides (Crosshairs)
        const guideX = document.createElement('div');
        guideX.className = 'ruler-guide-x';
        const guideY = document.createElement('div');
        guideY.className = 'ruler-guide-y';

        // Label
        const label = document.createElement('div');
        label.className = 'ruler-label';
        label.style.display = 'none';

        overlay.appendChild(rulerX);
        overlay.appendChild(rulerY);
        overlay.appendChild(guideX);
        overlay.appendChild(guideY);
        overlay.appendChild(label);
        frame.appendChild(overlay);

        // Event Listeners for Mouse Tracking
        this.addMouseListeners(frame, guideX, guideY, label);
    }

    addMouseListeners(frame, guideX, guideY, label) {
        const onMouseMove = (e) => {
            const rect = frame.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Update positions
            guideX.style.left = `${x}px`;
            guideX.style.display = 'block';

            guideY.style.top = `${y}px`;
            guideY.style.display = 'block';

            // Update Label
            label.textContent = `X: ${Math.round(x)} Y: ${Math.round(y)}`;
            label.style.left = `${x + 10}px`;
            label.style.top = `${y + 10}px`;
            label.style.display = 'block';
        };

        const onMouseLeave = () => {
            guideX.style.display = 'none';
            guideY.style.display = 'none';
            label.style.display = 'none';
        };

        frame.addEventListener('mousemove', onMouseMove);
        frame.addEventListener('mouseleave', onMouseLeave);

        // Store listeners for removal
        frame._rulerListeners = { onMouseMove, onMouseLeave };
    }

    removeRulerFromFrame(frame) {
        const overlay = frame.querySelector('.ruler-overlay');
        if (overlay) overlay.remove();

        // Remove listeners
        if (frame._rulerListeners) {
            frame.removeEventListener('mousemove', frame._rulerListeners.onMouseMove);
            frame.removeEventListener('mouseleave', frame._rulerListeners.onMouseLeave);
            delete frame._rulerListeners;
        }
    }

    drawTicks(container, length, axis) {
        // Major ticks every 100px
        for (let i = 0; i <= length; i += 100) {
            const mark = document.createElement('div');
            mark.className = 'tick-major';
            mark.dataset.label = i;

            if (axis === 'x') {
                mark.style.left = i + 'px';
            } else {
                mark.style.top = i + 'px';
            }
            container.appendChild(mark);

            // Minor ticks every 10px
            for (let j = 1; j < 10; j++) {
                if (i + j * 10 > length) break;
                const sub = document.createElement('div');
                sub.className = 'tick-minor';
                if (axis === 'x') {
                    sub.style.left = (i + j * 10) + 'px';
                } else {
                    sub.style.top = (i + j * 10) + 'px';
                }
                container.appendChild(sub);
            }
        }
    }

    // Public method to be called when new viewport is added
    applyToNewViewport(frame) {
        if (this.gridEnabled) {
            this.addGridToFrame(frame);
        }
        if (this.rulerEnabled) {
            this.addRulerToFrame(frame);
        }
    }
}

// Export singleton
window.DesignTools = new DesignTools();
