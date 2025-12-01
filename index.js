// =============================================================================
// CARROT COMPASS 🧭
// Enhanced worldbook tracking and trigger analysis system
// =============================================================================

import { chat, event_types, eventSource } from '../../../../script.js';
import { getContext } from '../../../extensions.js';

// Module imports
import { uiState } from './modules/ui-state.js';
import {
    createTriggerButton,
    createMainPanel,
    createConnectionLine,
    createConfigPanel,
    setupTriggerHandlers,
    setupPanelPositioning,
    positionPanel,
} from './modules/ui-components.js';
import {
    strategy,
    strategyDescriptions,
    getStrategy,
    updatePanel,
    updateBadge,
    setPositionPanelFn,
} from './modules/main-panel.js';
import {
    initVectHareIntegration,
    getVectHareLastSearch,
    getVectHareDebugData,
    getVectHareChunks,
    getVectHareChunkDetails,
    getVectHareActivationHistory,
    isVectHareAvailable,
    getLastVectHareSearchRaw,
} from './modules/vecthare-integration.js';
import {
    initPromptInspector,
    showPromptInspector,
    getLastPromptData,
    hasPromptData,
    getLastPromptDataRaw,
} from './modules/prompt-inspector.js';
import {
    initTokenItemizer,
    enableMarkers,
    disableMarkers,
    areMarkersEnabled,
    getLastItemization,
    hasItemizationData,
    getItemizationSummary,
    showTokenItemizer,
} from './modules/token-itemizer.js';
import {
    initTriggerTracking,
    getDeepTriggerInfo,
    getRecursionChain,
    getEnhancedTriggerDetails,
    getProbabilityResult,
    classifyTriggerReasonFromEntry,
    analyzeEntrySettings,
    analyzeTriggerSource,
    getDeepTriggerDataRaw,
    getRecursionChainRaw,
    getProbabilityResultsRaw,
} from './modules/trigger-tracking.js';

const extensionName = 'Carrot-Compass';

/**
 * Initialize all UI components
 */
function initUI() {
    // Create UI elements
    const trigger = createTriggerButton();
    const panel = createMainPanel();
    const connectionLine = createConnectionLine();
    const configPanel = createConfigPanel();

    // Store in shared state
    uiState.trigger = trigger;
    uiState.panel = panel;
    uiState.connectionLine = connectionLine;
    uiState.configPanel = configPanel;

    // Add to DOM
    document.body.appendChild(trigger);
    document.body.appendChild(connectionLine);
    document.body.appendChild(panel);
    document.body.appendChild(configPanel);

    // Setup handlers
    setupTriggerHandlers();
    setupPanelPositioning();

    // Give main-panel access to positionPanel
    setPositionPanelFn(positionPanel);

    // Initialize panel with empty state
    updatePanel([]);
}

/**
 * Setup event listeners for worldbook tracking
 */
function setupEventListeners() {
    // Standard worldbook activation
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, async (entryList) => {
        uiState.panel.innerHTML = 'Updating...';
        updateBadge(entryList.map(it => `${it.world}§§§${it.uid}`));

        const context = getContext();
        const authorNotePrompt = context?.extensionPrompts?.['2_floating_prompt'];
        const isAuthorNoteScanEnabled = authorNotePrompt?.scan === true;
        const authorNoteContent = authorNotePrompt?.value || '';

        for (const entry of entryList) {
            if (entry.triggerReason !== 'vector') {
                entry.triggerReason = classifyTriggerReasonFromEntry(entry, {
                    isAuthorNoteScanEnabled,
                    authorNoteContent,
                    context,
                    chat: chat || [],
                });
            }
            entry.entrySettings = analyzeEntrySettings(entry);
            entry.type = 'wi';
        }

        uiState.currentEntryList = [...entryList];
        updatePanel(entryList, true);
    });

    // Vector/RAG activation
    eventSource.on(event_types.WORLDINFO_FORCE_ACTIVATE, async (entryList) => {
        for (const entry of entryList) {
            entry.type = 'wi';
            entry.triggerReason = 'vector';
        }

        uiState.currentEntryList = [...entryList];
        updatePanel(entryList, true);
        updateBadge(entryList.map(it => `${it.world}§§§${it.uid}`));
    });
}

/**
 * Initialize Carrot Compass
 */
async function init() {
    console.log(`[${extensionName}] Initializing...`);

    try {
        // Initialize tracking modules
        initVectHareIntegration();
        initPromptInspector();
        initTriggerTracking();
        initTokenItemizer();

        // Initialize UI
        initUI();

        // Setup event listeners
        setupEventListeners();

        console.log(`[${extensionName}] Initialized successfully`);
    } catch (error) {
        console.error(`[${extensionName}] Failed to initialize:`, error);
    }
}

/**
 * Enable the tracker UI
 */
function enable() {
    if (uiState.trigger) uiState.trigger.style.display = '';
    if (uiState.panel) uiState.panel.style.display = '';
    if (uiState.configPanel) uiState.configPanel.style.display = '';
}

/**
 * Disable the tracker UI
 */
function disable() {
    if (uiState.trigger) uiState.trigger.style.display = 'none';
    if (uiState.panel) {
        uiState.panel.classList.remove('ck-panel--active');
        uiState.panel.style.display = 'none';
    }
    if (uiState.configPanel) {
        uiState.configPanel.classList.remove('ck-config-panel--active');
        uiState.configPanel.style.display = 'none';
    }
    if (uiState.connectionLine) {
        uiState.connectionLine.style.display = 'none';
    }
}

// Initialize when jQuery is ready
jQuery(async () => {
    await init();
});

// Public API
export const CarrotCompass = {
    init,
    enable,
    disable,
    // Strategy helpers
    strategy,
    strategyDescriptions,
    getStrategy,
    // Trigger tracking
    analyzeTriggerSource,
    getDeepTriggerInfo,
    getRecursionChain,
    getEnhancedTriggerDetails,
    getProbabilityResult,
    // VectHare integration
    getVectHareLastSearch,
    getVectHareDebugData,
    getVectHareChunks,
    getVectHareChunkDetails,
    getVectHareActivationHistory,
    isVectHareAvailable,
    // Prompt Inspector
    showPromptInspector,
    getLastPromptData,
    hasPromptData,
    // Token Itemizer
    enableMarkers,
    disableMarkers,
    areMarkersEnabled,
    getLastItemization,
    hasItemizationData,
    getItemizationSummary,
    showTokenItemizer,
    // Debug data access
    get deepTriggerData() { return getDeepTriggerDataRaw(); },
    get recursionChain() { return getRecursionChainRaw(); },
    get probabilityResults() { return getProbabilityResultsRaw(); },
    get vectHareSearch() { return getLastVectHareSearchRaw(); },
    get promptData() { return getLastPromptDataRaw(); },
    get itemization() { return getLastItemization(); },
};

export { init };
