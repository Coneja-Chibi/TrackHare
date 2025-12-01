// =============================================================================
// UI COMPONENTS - Trigger button, config panel, and interaction handlers
// =============================================================================

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { uiState, DOUBLE_TAP_DELAY, DOUBLE_TAP_DISTANCE, MOVE_THRESHOLD, saveTriggerPosition, saveTriggerSize, loadTriggerPosition, loadTriggerSize } from './ui-state.js';
import { showPromptInspector } from './prompt-inspector.js';

// Carrot compass SVG icon
const CARROT_SVG = `
    <svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 30 34.286" preserveAspectRatio="xMidYMid meet">
        <path fill="var(--SmartThemeQuoteColor)" d="m6.316 -0.028 0.256 -0.002c0.232 -0.001 0.464 -0.002 0.696 -0.002 0.251 0 0.503 -0.002 0.754 -0.003 0.548 -0.002 1.096 -0.003 1.645 -0.004q0.515 -0.001 1.029 -0.002c0.952 -0.002 1.904 -0.004 2.856 -0.004l0.184 0 0.555 0 0.185 0c0.991 0 1.982 -0.003 2.973 -0.008q1.531 -0.006 3.061 -0.006c0.572 0 1.144 -0.001 1.715 -0.004Q22.956 -0.067 23.686 -0.065c0.248 0.001 0.496 0.001 0.743 -0.002C25.835 -0.08 27.082 0.066 28.192 1.004l0.11 0.092a34.152 34.152 0 0 1 0.713 0.613 5.156 5.156 0 0 0 0.233 0.189c0.39 0.305 0.698 0.687 0.789 1.184 0.014 0.233 0.016 0.463 0.013 0.697q0.001 0.135 0.002 0.269c0.001 0.245 0 0.49 -0.001 0.734 -0.001 0.265 0 0.529 0.001 0.794 0.001 0.518 0 1.036 -0.001 1.553a517.299 517.299 0 0 0 -0.001 1.81c0 1.077 -0.001 2.153 -0.004 3.229a993.147 993.147 0 0 0 -0.003 3.132 1664.129 1664.129 0 0 1 -0.001 3.777l0 0.181q-0.001 0.63 0 1.261 0.001 0.768 -0.002 1.537c-0.001 0.261 -0.002 0.523 -0.001 0.784q0.001 0.359 -0.002 0.718c-0.001 0.127 0 0.254 0.001 0.382 -0.005 0.466 -0.051 0.775 -0.304 1.17l-0.18 0.167c-0.581 0.628 -0.298 2.533 -0.268 3.34l0.007 0.201c0.024 0.934 0.024 0.934 0.412 1.754 0.341 0.431 0.316 0.796 0.321 1.335q0.002 0.137 0.005 0.274c0.016 0.589 -0.003 1.081 -0.364 1.567 -0.379 0.357 -0.745 0.552 -1.273 0.553l-0.246 0.001 -0.27 -0.001 -0.287 0.001c-0.263 0.001 -0.526 0.001 -0.789 0 -0.284 0 -0.567 0 -0.851 0.001q-0.834 0.001 -1.668 0.001 -0.678 0 -1.356 0l-0.195 0 -0.392 0q-1.84 0.001 -3.68 0c-1.121 0 -2.242 0 -3.363 0.002q-1.727 0.002 -3.454 0.002c-0.646 0 -1.292 0 -1.939 0.001q-0.826 0.001 -1.652 0c-0.281 0 -0.561 -0.001 -0.842 0q-0.386 0.001 -0.773 0c-0.136 0 -0.272 0 -0.408 0.001C4.452 34.302 2.913 33.596 1.674 32.344l-0.152 -0.148c-1.102 -1.139 -1.555 -2.786 -1.548 -4.329q0 -0.145 -0.001 -0.29c-0.001 -0.263 -0.001 -0.526 0 -0.789 0 -0.285 -0.001 -0.569 -0.001 -0.854 -0.001 -0.557 -0.001 -1.113 -0.001 -1.67q0 -0.679 0 -1.358l0 -0.196 0 -0.394c-0.001 -1.229 -0.001 -2.458 0 -3.687 0.001 -1.122 0 -2.245 -0.002 -3.367q-0.002 -1.732 -0.002 -3.464c0 -0.647 0 -1.295 -0.001 -1.942q-0.001 -0.827 0 -1.653c0.001 -0.281 0.001 -0.561 0 -0.842C-0.042 5.195 -0.042 5.195 0.268 4.286l0.058 -0.173C0.677 3.162 1.235 2.391 1.942 1.674l0.148 -0.151C3.205 0.462 4.807 -0.032 6.316 -0.028M21.362 2.679c-0.741 0.365 -1.234 0.866 -1.54 1.644 -0.252 0.784 -0.269 1.591 0.1 2.347C20.34 7.336 20.935 7.893 21.496 8.438l0.167 0.169c0.691 0.68 1.372 1.161 2.361 1.191 0.74 -0.017 1.283 -0.182 1.825 -0.691l0.096 -0.089c0.403 -0.353 0.403 -0.353 0.707 -0.783 0 -0.359 -0.335 -0.63 -0.573 -0.869 -0.333 -0.333 -0.653 -0.575 -1.101 -0.737l-0.132 -0.049C24.14 6.364 23.44 6.499 22.768 6.763l-0.201 0.134 0.071 -0.167c0.355 -0.872 0.439 -1.657 0.092 -2.558C22.458 3.619 21.966 3.197 21.496 2.813zm-8.571 6.629c0.058 0.31 0.244 0.468 0.464 0.68l0.12 0.119c0.127 0.125 0.254 0.249 0.382 0.373a118.862 118.862 0 0 1 0.381 0.373 37.098 37.098 0 0 0 0.238 0.232c0.233 0.228 0.405 0.401 0.441 0.73L14.816 11.987l0.001 0.172c-0.019 0.176 -0.053 0.284 -0.152 0.431 -0.19 0.063 -0.325 0.082 -0.523 0.088l-0.169 0.008c-0.53 -0.085 -0.911 -0.612 -1.267 -0.974l-0.185 -0.186A235.313 235.313 0 0 1 12.054 11.049l-0.134 -0.134c-0.187 0.219 -0.314 0.413 -0.417 0.681 -0.141 0.352 -0.292 0.696 -0.451 1.04l-0.072 0.157q-0.112 0.241 -0.223 0.482c-0.302 0.653 -0.603 1.305 -0.888 1.966 -0.126 0.29 -0.257 0.577 -0.392 0.863a36.563 36.563 0 0 0 -0.469 1.038c-0.225 0.518 -0.462 1.03 -0.703 1.54l-0.154 0.327 -0.16 0.339 -0.075 0.158 -0.073 0.153 -0.071 0.149c-0.071 0.146 -0.145 0.289 -0.22 0.433 -0.146 0.293 -0.193 0.528 -0.118 0.851 0.188 0.363 0.448 0.603 0.804 0.804l0.138 0.088c0.353 0.125 0.755 -0.143 1.071 -0.289l0.366 -0.167 0.187 -0.086c0.213 -0.097 0.427 -0.193 0.64 -0.289 0.161 -0.072 0.321 -0.145 0.482 -0.217a117.522 117.522 0 0 1 0.815 -0.364c0.202 -0.09 0.404 -0.18 0.606 -0.27q0.151 -0.067 0.303 -0.134c0.143 -0.063 0.285 -0.126 0.427 -0.19l0.13 -0.057c0.24 -0.109 0.39 -0.208 0.526 -0.436 -0.092 -0.103 -0.092 -0.103 -0.201 -0.201h-0.134l-0.053 -0.119c-0.087 -0.159 -0.179 -0.258 -0.309 -0.383l-0.134 -0.13q-0.14 -0.134 -0.28 -0.267c-0.488 -0.474 -0.488 -0.474 -0.502 -0.866l0.018 -0.152 0.015 -0.153c0.046 -0.166 0.107 -0.232 0.24 -0.341 0.152 -0.076 0.249 -0.082 0.419 -0.088l0.152 -0.008c0.407 0.07 0.705 0.415 0.984 0.699l0.114 0.115c0.119 0.12 0.238 0.241 0.357 0.362l0.243 0.245a231.027 231.027 0 0 1 0.442 0.447q0.151 0.153 0.303 0.305l0.199 -0.101c0.717 -0.361 1.437 -0.714 2.174 -1.033C19.584 17.106 20.89 16.228 21.563 14.531c0.081 -0.242 0.151 -0.486 0.218 -0.732l0.054 -0.188c0.184 -0.671 0.157 -1.228 -0.021 -1.897l-0.042 -0.169c-0.099 -0.387 -0.24 -0.738 -0.41 -1.099l-0.06 -0.139c-0.281 -0.644 -0.802 -1.171 -1.346 -1.602l-0.127 -0.104C19.214 8.117 18.564 7.84 17.813 7.634l-0.225 -0.073c-1.806 -0.453 -3.53 0.559 -4.797 1.747M4.796 26.472Q4.704 26.592 4.621 26.719l-0.084 0.126c-0.284 0.518 -0.268 1.185 -0.138 1.749 0.198 0.543 0.529 0.941 1.048 1.199 0.565 0.23 1.199 0.226 1.8 0.222l0.237 0q0.322 0 0.645 -0.001c0.233 -0.001 0.466 0 0.698 0q0.604 0 1.208 -0.001c0.582 -0.001 1.164 -0.001 1.746 -0.002q1.416 0 2.833 -0.002a3807.924 3807.924 0 0 1 3.774 -0.003c2.353 -0.001 4.705 -0.004 7.058 -0.007v-4.286a11307.589 11307.589 0 0 0 -8.085 -0.007l-0.172 0q-1.376 -0.001 -2.751 -0.003 -1.412 -0.002 -2.824 -0.002 -0.871 0 -1.742 -0.002 -0.598 -0.001 -1.195 -0.001c-0.23 0 -0.459 0 -0.689 -0.001 -0.25 -0.001 -0.499 -0.001 -0.749 0l-0.218 -0.001c-0.856 0.003 -1.618 0.121 -2.225 0.775"/>
    </svg>
`;

/**
 * Create the trigger button element
 */
export function createTriggerButton() {
    const trigger = document.createElement('div');
    trigger.classList.add('ck-trigger');
    trigger.title = '🧭 Carrot Compass\n---\nright click for options';
    trigger.innerHTML = CARROT_SVG;

    // Load saved position
    const savedPos = loadTriggerPosition();
    if (savedPos) {
        trigger.style.position = 'fixed';
        trigger.style.left = savedPos.left;
        trigger.style.top = savedPos.top;
        trigger.style.bottom = 'auto';
    }

    // Load saved size
    const savedSize = loadTriggerSize();
    if (savedSize) {
        trigger.style.width = savedSize.width;
        trigger.style.height = savedSize.height;
    }

    return trigger;
}

/**
 * Create the main panel element
 */
export function createMainPanel() {
    const panel = document.createElement('div');
    panel.classList.add('ck-panel');
    return panel;
}

/**
 * Create the connection line element
 */
export function createConnectionLine() {
    const connectionLine = document.createElement('div');
    connectionLine.classList.add('ck-connection');
    return connectionLine;
}

/**
 * Create the config panel element
 */
export function createConfigPanel() {
    const configPanel = document.createElement('div');
    configPanel.classList.add('ck-config-panel');

    // Initialize settings
    if (!extension_settings.CarrotCompass) {
        extension_settings.CarrotCompass = {};
    }

    // Header
    const header = document.createElement('div');
    header.classList.add('ck-config-header');
    header.innerHTML = '🧭 <span>Carrot Compass Settings</span>';
    configPanel.appendChild(header);

    // Settings rows
    const settings = [
        {
            label: '📚 Group by World',
            key: 'worldBookGroup',
            default: true,
            description: 'Group entries by their worldbook',
        },
        {
            label: '🔍 Debug Mode',
            key: 'worldBookDebug',
            default: false,
            description: 'Show detailed trigger information',
        },
        {
            label: '🥔 Potato Mode',
            key: 'potatoMode',
            default: false,
            description: 'Minimal UI for low-end devices',
        },
    ];

    settings.forEach(({ label, key, default: defaultVal, description }) => {
        const row = createSettingRow(label, key, defaultVal, description);
        configPanel.appendChild(row);
    });

    // Sort method dropdown
    const sortRow = createSortDropdown();
    configPanel.appendChild(sortRow);

    // Reposition button
    const repositionRow = createRepositionButton();
    configPanel.appendChild(repositionRow);

    // Prompt Inspector button
    const promptRow = createPromptInspectorButton();
    configPanel.appendChild(promptRow);

    return configPanel;
}

/**
 * Create a toggle setting row
 */
function createSettingRow(label, key, defaultVal, description) {
    const row = document.createElement('div');
    row.classList.add('ck-config-row');

    const labelEl = document.createElement('span');
    labelEl.classList.add('ck-config-label');
    labelEl.textContent = label;
    labelEl.title = description;

    const toggle = document.createElement('div');
    toggle.classList.add('ck-toggle');

    const currentValue = extension_settings.CarrotCompass?.[key] ?? defaultVal;
    if (currentValue) {
        toggle.classList.add('ck-toggle--active');
    }

    toggle.addEventListener('click', () => {
        const newValue = !extension_settings.CarrotCompass[key];
        extension_settings.CarrotCompass[key] = newValue;
        toggle.classList.toggle('ck-toggle--active', newValue);
        saveSettingsDebounced();
    });

    row.appendChild(labelEl);
    row.appendChild(toggle);
    return row;
}

/**
 * Create sort method dropdown
 */
function createSortDropdown() {
    const row = document.createElement('div');
    row.classList.add('ck-config-row');

    const label = document.createElement('span');
    label.classList.add('ck-config-label');
    label.textContent = '📊 Sort Method';

    const select = document.createElement('select');
    select.classList.add('ck-select');
    select.innerHTML = `
        <option value="alpha">Alphabetical</option>
        <option value="order">Insertion Order</option>
        <option value="chars">Character Count</option>
    `;
    select.value = extension_settings.CarrotCompass?.sortMethod || 'alpha';

    select.addEventListener('change', () => {
        extension_settings.CarrotCompass.sortMethod = select.value;
        saveSettingsDebounced();
    });

    row.appendChild(label);
    row.appendChild(select);
    return row;
}

/**
 * Create reposition button
 */
function createRepositionButton() {
    const row = document.createElement('div');
    row.classList.add('ck-config-row');
    row.style.cssText = 'cursor: pointer; transition: background 0.2s;';

    const label = document.createElement('span');
    label.classList.add('ck-config-label');
    label.textContent = '📍 Reposition Button';

    const hint = document.createElement('span');
    hint.style.cssText = 'font-size: 11px; opacity: 0.7;';
    hint.textContent = 'Click to enable';

    row.appendChild(label);
    row.appendChild(hint);

    row.addEventListener('click', () => {
        enableRepositionMode();
        uiState.configPanel?.classList.remove('ck-config-panel--active');
    });

    row.addEventListener('mouseenter', () => {
        row.style.background = 'rgba(255,107,53,0.15)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = '';
    });

    return row;
}

/**
 * Create prompt inspector button
 */
function createPromptInspectorButton() {
    const row = document.createElement('div');
    row.classList.add('ck-config-row');
    row.style.cssText = 'cursor: pointer; transition: background 0.2s; background: linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%);';

    const label = document.createElement('span');
    label.classList.add('ck-config-label');
    label.textContent = '📜 Prompt Inspector';

    const hint = document.createElement('span');
    hint.style.cssText = 'font-size: 11px; opacity: 0.7;';
    hint.textContent = 'View last prompt';

    row.appendChild(label);
    row.appendChild(hint);

    row.addEventListener('click', () => {
        showPromptInspector();
        uiState.configPanel?.classList.remove('ck-config-panel--active');
    });

    row.addEventListener('mouseenter', () => {
        row.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(59, 130, 246, 0.2) 100%)';
    });
    row.addEventListener('mouseleave', () => {
        row.style.background = 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%)';
    });

    return row;
}

/**
 * Setup click-outside handler to close panels
 */
function setupDocumentClickHandler(panelElement, isConfigPanel = false) {
    if (uiState.documentClickHandler) {
        document.removeEventListener('pointerdown', uiState.documentClickHandler);
    }

    uiState.documentClickHandler = (e) => {
        if (uiState.trigger?.contains(e.target)) return;
        if (!panelElement.contains(e.target)) {
            panelElement.classList.remove(isConfigPanel ? 'ck-config-panel--active' : 'ck-panel--active');
            document.removeEventListener('pointerdown', uiState.documentClickHandler);
            uiState.documentClickHandler = null;
        }
    };

    setTimeout(() => {
        document.addEventListener('pointerdown', uiState.documentClickHandler);
    }, 200);
}

/**
 * Setup all pointer event handlers for trigger button
 */
export function setupTriggerHandlers() {
    const trigger = uiState.trigger;
    const panel = uiState.panel;
    const configPanel = uiState.configPanel;

    if (!trigger || !panel || !configPanel) return;

    // Pointer down
    trigger.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        if (uiState.currentPointerId !== null) return;

        uiState.currentPointerId = e.pointerId;
        trigger.setPointerCapture(e.pointerId);

        uiState.startX = e.clientX;
        uiState.startY = e.clientY;
        uiState.hasMoved = false;

        if (uiState.repositionMode && !e.target.closest('.ck-resize-handle')) {
            uiState.state = 'dragging';
            const rect = trigger.getBoundingClientRect();
            uiState.offsetX = e.clientX - rect.left;
            uiState.offsetY = e.clientY - rect.top;
            trigger.style.cursor = 'grabbing';
            trigger.style.position = 'fixed';
            trigger.style.bottom = 'auto';
        }

        e.preventDefault();
    });

    // Pointer move
    trigger.addEventListener('pointermove', (e) => {
        if (e.pointerId !== uiState.currentPointerId) return;

        const deltaX = Math.abs(e.clientX - uiState.startX);
        const deltaY = Math.abs(e.clientY - uiState.startY);

        if (deltaX > MOVE_THRESHOLD || deltaY > MOVE_THRESHOLD) {
            uiState.hasMoved = true;
        }

        if (uiState.state === 'dragging') {
            trigger.style.left = `${e.clientX - uiState.offsetX}px`;
            trigger.style.top = `${e.clientY - uiState.offsetY}px`;
        }
    });

    // Pointer up
    trigger.addEventListener('pointerup', (e) => {
        if (e.pointerId !== uiState.currentPointerId) return;

        trigger.releasePointerCapture(e.pointerId);
        uiState.currentPointerId = null;

        if (uiState.state === 'dragging') {
            saveTriggerPosition();
            trigger.style.cursor = uiState.repositionMode ? 'move' : '';
            uiState.state = 'idle';
            return;
        }

        if (!uiState.hasMoved && !uiState.repositionMode) {
            handleTap(e);
        }

        uiState.state = 'idle';
    });

    // Context menu (right-click)
    trigger.addEventListener('contextmenu', (e) => {
        e.preventDefault();

        if (uiState.singleTapTimer) {
            clearTimeout(uiState.singleTapTimer);
            uiState.singleTapTimer = null;
        }

        uiState.hasMoved = true;

        if (panel.classList.contains('ck-panel--active')) {
            panel.classList.remove('ck-panel--active');
        }

        const wasActive = configPanel.classList.contains('ck-config-panel--active');
        configPanel.classList.toggle('ck-config-panel--active');

        if (!wasActive && configPanel.classList.contains('ck-config-panel--active')) {
            setupDocumentClickHandler(configPanel, true);
        }
    });
}

/**
 * Handle tap/click on trigger
 */
function handleTap(e) {
    const panel = uiState.panel;
    const configPanel = uiState.configPanel;

    const now = Date.now();
    const timeSinceLastTap = now - uiState.lastTapTime;
    const distanceFromLastTap = Math.sqrt(
        Math.pow(e.clientX - uiState.lastTapX, 2) +
        Math.pow(e.clientY - uiState.lastTapY, 2),
    );

    // Double-tap detection
    if (timeSinceLastTap < DOUBLE_TAP_DELAY && distanceFromLastTap < DOUBLE_TAP_DISTANCE) {
        if (uiState.singleTapTimer) {
            clearTimeout(uiState.singleTapTimer);
            uiState.singleTapTimer = null;
        }

        if (panel.classList.contains('ck-panel--active')) {
            panel.classList.remove('ck-panel--active');
        }

        const wasActive = configPanel.classList.contains('ck-config-panel--active');
        configPanel.classList.toggle('ck-config-panel--active');

        if (!wasActive && configPanel.classList.contains('ck-config-panel--active')) {
            setupDocumentClickHandler(configPanel, true);
        }

        if (navigator.vibrate) navigator.vibrate(50);
        uiState.lastTapTime = 0;
    } else {
        uiState.lastTapTime = now;
        uiState.lastTapX = e.clientX;
        uiState.lastTapY = e.clientY;

        if (uiState.singleTapTimer) {
            clearTimeout(uiState.singleTapTimer);
        }

        uiState.singleTapTimer = setTimeout(() => {
            if (configPanel.classList.contains('ck-config-panel--active')) {
                configPanel.classList.remove('ck-config-panel--active');
            }

            const wasActive = panel.classList.contains('ck-panel--active');
            panel.classList.toggle('ck-panel--active');

            if (!wasActive && panel.classList.contains('ck-panel--active')) {
                setupDocumentClickHandler(panel, false);
            }

            uiState.singleTapTimer = null;
        }, DOUBLE_TAP_DELAY);
    }
}

/**
 * Enable reposition mode for dragging/resizing trigger
 */
export function enableRepositionMode() {
    const trigger = uiState.trigger;
    if (!trigger) return;

    uiState.repositionMode = true;
    trigger.classList.add('ck-trigger--reposition');
    trigger.style.cursor = 'move';
    trigger.title = 'Drag to move • Corner to resize • Click outside to finish';

    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.classList.add('ck-resize-handle');
    resizeHandle.style.cssText = `
        position: absolute;
        bottom: -4px;
        right: -4px;
        width: 12px;
        height: 12px;
        background: var(--SmartThemeQuoteColor);
        border-radius: 50%;
        cursor: se-resize;
        z-index: 10001;
    `;
    trigger.appendChild(resizeHandle);
    trigger._resizeHandle = resizeHandle;

    // Resize handlers
    let startWidth, startHeight, resizeStartX, resizeStartY;

    resizeHandle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        uiState.state = 'resizing';
        startWidth = trigger.offsetWidth;
        startHeight = trigger.offsetHeight;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeHandle.setPointerCapture(e.pointerId);
    });

    resizeHandle.addEventListener('pointermove', (e) => {
        if (uiState.state !== 'resizing') return;
        const newWidth = Math.max(24, startWidth + (e.clientX - resizeStartX));
        const newHeight = Math.max(24, startHeight + (e.clientY - resizeStartY));
        trigger.style.width = `${newWidth}px`;
        trigger.style.height = `${newHeight}px`;
    });

    resizeHandle.addEventListener('pointerup', (e) => {
        if (uiState.state !== 'resizing') return;
        resizeHandle.releasePointerCapture(e.pointerId);
        uiState.state = 'idle';
        saveTriggerSize();
    });

    // Click outside to exit
    const exitHandler = (e) => {
        if (!trigger.contains(e.target)) {
            disableRepositionMode();
        }
    };
    trigger._exitClickHandler = exitHandler;
    document.addEventListener('pointerdown', exitHandler);
}

/**
 * Disable reposition mode
 */
export function disableRepositionMode() {
    const trigger = uiState.trigger;
    if (!trigger) return;

    uiState.repositionMode = false;
    trigger.classList.remove('ck-trigger--reposition');
    trigger.style.cursor = '';

    if (trigger._resizeHandle) {
        trigger._resizeHandle.remove();
        trigger._resizeHandle = null;
    }

    if (trigger._exitClickHandler) {
        document.removeEventListener('pointerdown', trigger._exitClickHandler);
        trigger._exitClickHandler = null;
    }
}

/**
 * Position the panel relative to trigger
 */
export function positionPanel() {
    const trigger = uiState.trigger;
    const panel = uiState.panel;
    const connectionLine = uiState.connectionLine;

    if (!trigger || !panel) return;

    const triggerRect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const currentWidth = panel.offsetWidth || 400;
    const maxWidth = Math.min(currentWidth, viewportWidth - 32);

    if (!panel.style.width || panel.style.width === 'auto') {
        panel.style.width = `${maxWidth}px`;
    }

    const leftPosition = Math.max(16, triggerRect.left);
    panel.style.left = `${leftPosition}px`;
    panel.style.right = 'auto';

    const spaceBelow = viewportHeight - triggerRect.bottom;
    const spaceAbove = triggerRect.top;
    const minPanelHeight = 300;
    const maxPanelHeight = Math.min(600, viewportHeight * 0.8);

    let panelTop;
    if (spaceBelow >= minPanelHeight + 20) {
        panelTop = triggerRect.bottom + 10;
        panel.style.top = `${panelTop}px`;
        panel.style.bottom = 'auto';
        panel.style.maxHeight = `${Math.min(maxPanelHeight, spaceBelow - 20)}px`;
    } else if (spaceAbove >= minPanelHeight + 20) {
        panel.style.bottom = `${viewportHeight - triggerRect.top + 10}px`;
        panel.style.top = 'auto';
        panel.style.maxHeight = `${Math.min(maxPanelHeight, spaceAbove - 20)}px`;
        panelTop = triggerRect.top - 10 - Math.min(maxPanelHeight, spaceAbove - 20);
    } else {
        panel.style.left = `${triggerRect.right + 15}px`;
        panelTop = Math.max(20, triggerRect.top - 50);
        panel.style.top = `${panelTop}px`;
        panel.style.bottom = 'auto';
        panel.style.maxHeight = `${viewportHeight - 40}px`;
    }

    // Position connection line
    if (connectionLine && panel.classList.contains('ck-panel--active')) {
        const triggerCenterX = triggerRect.left + triggerRect.width / 2;
        connectionLine.style.left = `${triggerCenterX - 1}px`;
        connectionLine.style.top = `${triggerRect.bottom - 2}px`;
        connectionLine.style.height = `${Math.abs(panelTop - triggerRect.bottom) + 4}px`;
        connectionLine.style.display = 'block';
    }
}

/**
 * Setup panel positioning observers
 */
export function setupPanelPositioning() {
    const panel = uiState.panel;
    if (!panel) return;

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                if (panel.classList.contains('ck-panel--active')) {
                    setTimeout(positionPanel, 0);
                }
            }
        });
    });
    observer.observe(panel, { attributes: true });

    window.addEventListener('resize', () => {
        if (panel.classList.contains('ck-panel--active')) {
            positionPanel();
        }
    });
}
