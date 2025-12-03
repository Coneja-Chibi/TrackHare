// =============================================================================
// UI STATE - Shared state for TrackHare UI components
// =============================================================================

/**
 * Shared UI state - holds DOM references and component state
 */
export const uiState = {
    // DOM Elements (set during init)
    trigger: null,
    panel: null,
    configPanel: null,
    connectionLine: null,

    // Interaction state
    state: 'idle', // 'idle' | 'dragging' | 'resizing'
    repositionMode: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0,
    hasMoved: false,
    currentPointerId: null,

    // Double-tap detection
    lastTapTime: 0,
    lastTapX: 0,
    lastTapY: 0,
    singleTapTimer: null,

    // Click outside handler
    documentClickHandler: null,

    // Entry tracking
    entries: [],
    count: -1,
    currentEntryList: [],
    currentChat: [],
};

// Constants
export const DOUBLE_TAP_DELAY = 300; // ms
export const DOUBLE_TAP_DISTANCE = 30; // px
export const MOVE_THRESHOLD = 10; // px

/**
 * Reset interaction state
 */
export function resetInteractionState() {
    uiState.state = 'idle';
    uiState.hasMoved = false;
    uiState.currentPointerId = null;
}

/**
 * Save trigger position to localStorage
 */
export function saveTriggerPosition() {
    if (!uiState.trigger) return;
    const rect = uiState.trigger.getBoundingClientRect();
    localStorage.setItem('ck-trigger-position', JSON.stringify({
        left: `${rect.left}px`,
        top: `${rect.top}px`,
    }));
}

/**
 * Save trigger size to localStorage
 */
export function saveTriggerSize() {
    if (!uiState.trigger) return;
    localStorage.setItem('ck-trigger-size', JSON.stringify({
        width: uiState.trigger.style.width,
        height: uiState.trigger.style.height,
    }));
}

/**
 * Load trigger position from localStorage
 */
export function loadTriggerPosition() {
    const saved = localStorage.getItem('ck-trigger-position');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return null;
        }
    }
    return null;
}

/**
 * Load trigger size from localStorage
 */
export function loadTriggerSize() {
    const saved = localStorage.getItem('ck-trigger-size');
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            return null;
        }
    }
    return null;
}
