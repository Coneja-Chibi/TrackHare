// =============================================================================
// TOKEN ITEMIZER - Marker injection for accurate prompt itemization
// Injects <<TAG>>content<</TAG>> markers, parses from final prompt
// =============================================================================

import { event_types, eventSource, extension_prompts } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
// Import entire module to ensure live binding access
import * as openai from '../../../../openai.js';

/**
 * Get promptManager dynamically (it's null at load time, created later by ST)
 * @returns {Object|null}
 */
function getPromptManager() {
    return openai.promptManager;
}

/**
 * Whether marker injection is enabled
 * @type {boolean}
 */
let markersEnabled = false;

/**
 * Whether the monkeypatch has been applied
 * @type {boolean}
 */
let monkeypatchApplied = false;

/**
 * Original getPromptCollection function (stored for restoration)
 * @type {Function|null}
 */
let originalGetPromptCollection = null;

/**
 * Original preparePrompt function (stored for restoration)
 * @type {Function|null}
 */
let originalPreparePrompt = null;

/**
 * Track original extension_prompts values for restoration
 * @type {Map<string, string>}
 */
let originalExtPrompts = new Map();

/**
 * Last captured itemization data
 * @type {Object|null}
 */
let lastItemization = null;

/**
 * Last captured prompt manager data
 * @type {Object|null}
 */
let lastPromptManagerData = null;

/**
 * Dynamic mapping of identifier → friendly name (populated from promptManager)
 * @type {Map<string, string>}
 */
const identifierToName = new Map();

/**
 * Marker mappings for extension_prompts
 */
const EXT_PROMPT_TAGS = {
    '1_memory': 'MEMORY',
    '2_floating_prompt': 'AN',
    '3_vectors': 'VECTORS_CHAT',
    '4_vectors_data_bank': 'VECTORS_DATA',
    'chromadb': 'CHROMADB',
    'vecthare': 'VECTHARE',
    'carrotkernel_rag': 'RAG',
};

/**
 * Friendly display names for known tags (fallback for extension prompts and story string)
 */
const DISPLAY_NAMES = {
    // Extension prompts
    'MEMORY': 'Summary/Memory',
    'AN': 'Author\'s Note',
    'VECTORS_CHAT': 'Vectors (Chat)',
    'VECTORS_DATA': 'Vectors (Data Bank)',
    'CHROMADB': 'Smart Context',
    'VECTHARE': 'VectHare',
    'RAG': 'RAG Context',
    // Story string / character card (from GENERATE_BEFORE_COMBINE_PROMPTS)
    'CHAR': 'Character Description',
    'PERSONALITY': 'Personality',
    'PERSONA': 'Persona',
    'SCENARIO': 'Scenario',
    // World info
    'WI_BEFORE': 'World Info (Before)',
    'WI_AFTER': 'World Info (After)',
    // System prompts
    'MAIN': 'Main Prompt',
    'JB': 'Jailbreak/Post-History',
    'NSFW': 'NSFW/Auxiliary Prompt',
    // Other
    'EXAMPLES': 'Example Dialogue',
    'ANCHOR_BEFORE': 'Anchor (Before)',
    'ANCHOR_AFTER': 'Anchor (After)',
};

/**
 * Sanitize identifier for use as marker tag
 * Converts to uppercase and replaces non-alphanumeric with underscores
 * @param {string} identifier
 * @returns {string}
 */
function sanitizeTag(identifier) {
    if (!identifier) return 'UNKNOWN';
    return identifier.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * Wrap content with markers
 * @param {string} tag - Tag name (will be sanitized)
 * @param {string} content - Content to wrap
 * @returns {string}
 */
function wrap(tag, content) {
    if (!content?.trim()) return content;
    const safeTag = sanitizeTag(tag);
    return `<<${safeTag}>>${content}<</${safeTag}>>`;
}

/**
 * Parse all markers from text
 * Handles any alphanumeric identifier with underscores
 * @param {string} text
 * @returns {Array<{tag: string, content: string}>}
 */
function parseMarkers(text) {
    if (!text) return [];

    const results = [];
    // Match any uppercase alphanumeric tag with underscores
    const regex = /<<([A-Z0-9_]+)>>([\s\S]*?)<<\/\1>>/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        results.push({
            tag: match[1],
            content: match[2],
        });
    }

    return results;
}

/**
 * Get display name for a tag
 * Checks identifierToName map first, then DISPLAY_NAMES, then formats the tag itself
 * @param {string} tag - The marker tag
 * @returns {string}
 */
function getDisplayName(tag) {
    // Check dynamic mapping from promptManager (identifier → name)
    if (identifierToName.has(tag)) {
        return identifierToName.get(tag);
    }
    // Also check lowercase version (original identifier before sanitization)
    const lowerTag = tag.toLowerCase();
    if (identifierToName.has(lowerTag)) {
        return identifierToName.get(lowerTag);
    }
    // Check static DISPLAY_NAMES
    if (DISPLAY_NAMES[tag]) {
        return DISPLAY_NAMES[tag];
    }
    // Format tag as readable name (replace underscores, title case)
    return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\b\w+/g, w => w.charAt(0) + w.slice(1).toLowerCase());
}

/**
 * Strip all markers from text
 * @param {string} text
 * @returns {string}
 */
function stripMarkers(text) {
    if (!text) return text;
    return text.replace(/<<\/?[A-Z_0-9]+>>/g, '');
}

// =============================================================================
// INJECTION HOOKS
// =============================================================================

/**
 * Inject markers into extension_prompts on GENERATION_STARTED
 */
function injectExtensionPromptMarkers() {
    if (!markersEnabled) return;

    originalExtPrompts.clear();

    for (const [key, prompt] of Object.entries(extension_prompts)) {
        if (prompt?.value?.trim()) {
            originalExtPrompts.set(key, prompt.value);
            const tag = EXT_PROMPT_TAGS[key] || key.toUpperCase().replace(/[^A-Z0-9]/g, '_');
            prompt.value = wrap(tag, prompt.value);
        }
    }

    console.debug('[Carrot Compass] Injected markers into', originalExtPrompts.size, 'extension prompts');
}

/**
 * Inject markers into story string params on GENERATE_BEFORE_COMBINE_PROMPTS
 * @param {Object} data - Event data containing all prompt pieces
 */
function injectStoryStringMarkers(data) {
    if (!markersEnabled) return;

    // Character card fields
    if (data.description?.trim()) {
        data.description = wrap('CHAR', data.description);
    }
    if (data.personality?.trim()) {
        data.personality = wrap('PERSONALITY', data.personality);
    }
    if (data.persona?.trim()) {
        data.persona = wrap('PERSONA', data.persona);
    }
    if (data.scenario?.trim()) {
        data.scenario = wrap('SCENARIO', data.scenario);
    }

    // World Info
    if (data.worldInfoBefore?.trim()) {
        data.worldInfoBefore = wrap('WI_BEFORE', data.worldInfoBefore);
    }
    if (data.worldInfoAfter?.trim()) {
        data.worldInfoAfter = wrap('WI_AFTER', data.worldInfoAfter);
    }

    // Anchors (extension prompts injected at specific positions)
    if (data.beforeScenarioAnchor?.trim()) {
        data.beforeScenarioAnchor = wrap('ANCHOR_BEFORE', data.beforeScenarioAnchor);
    }
    if (data.afterScenarioAnchor?.trim()) {
        data.afterScenarioAnchor = wrap('ANCHOR_AFTER', data.afterScenarioAnchor);
    }

    // System prompts
    if (data.main?.trim()) {
        data.main = wrap('MAIN', data.main);
    }
    if (data.jailbreak?.trim()) {
        data.jailbreak = wrap('JB', data.jailbreak);
    }

    // Example messages
    if (data.mesExmString?.trim()) {
        data.mesExmString = wrap('EXAMPLES', data.mesExmString);
    }

    console.debug('[Carrot Compass] Injected story string markers');
}

/**
 * Restore original extension_prompts values
 */
function restoreExtensionPrompts() {
    for (const [key, value] of originalExtPrompts) {
        if (extension_prompts[key]) {
            extension_prompts[key].value = value;
        }
    }
    originalExtPrompts.clear();
}

// =============================================================================
// PROMPTMANAGER MONKEYPATCH
// =============================================================================

/**
 * Apply monkeypatch to promptManager methods
 * - getPromptCollection: captures identifier → name mappings
 * - preparePrompt: wraps content with markers (this is where content is finalized)
 */
function applyPromptManagerPatch() {
    if (monkeypatchApplied) return;

    const pm = getPromptManager();
    if (!pm) {
        // promptManager might not be initialized yet - retry later
        console.debug('[Carrot Compass] promptManager not available yet, will retry on GENERATION_STARTED');
        return;
    }

    console.log('[Carrot Compass] promptManager found, applying patches...');

    // Store original functions
    originalGetPromptCollection = pm.getPromptCollection.bind(pm);
    originalPreparePrompt = pm.preparePrompt.bind(pm);

    // Patch getPromptCollection - just capture identifier → name mappings
    pm.getPromptCollection = function(type) {
        const collection = originalGetPromptCollection(type);

        if (collection?.collection) {
            for (const prompt of collection.collection) {
                if (!prompt) continue;

                // Store mapping of identifier → name
                if (prompt.identifier && prompt.name) {
                    const sanitizedId = sanitizeTag(prompt.identifier);
                    identifierToName.set(sanitizedId, prompt.name);
                    identifierToName.set(prompt.identifier, prompt.name);
                }
            }
        }

        return collection;
    };

    // Patch preparePrompt - this is where content gets finalized, so wrap here
    pm.preparePrompt = function(prompt, original = null) {
        // Log BEFORE calling original - this confirms patch is working
        console.log('[Carrot Compass] preparePrompt INTERCEPTED:', prompt?.identifier || 'unknown');

        const prepared = originalPreparePrompt(prompt, original);

        // Debug: log all prompts passing through
        console.log('[Carrot Compass] preparePrompt called:', {
            identifier: prepared?.identifier,
            name: prepared?.name,
            hasContent: !!prepared?.content?.trim(),
            contentLength: prepared?.content?.length || 0,
            marker: prepared?.marker,
            markersEnabled,
        });

        if (markersEnabled && prepared?.content?.trim() && !prepared.marker) {
            // Store mapping for this prompt (use identifier as fallback name)
            if (prepared.identifier) {
                const sanitizedId = sanitizeTag(prepared.identifier);
                const displayName = prepared.name || DISPLAY_NAMES[sanitizedId] || prepared.identifier;
                identifierToName.set(sanitizedId, displayName);
                identifierToName.set(prepared.identifier, displayName);
            }

            // Wrap content with markers
            prepared.content = wrap(prepared.identifier, prepared.content);
            console.log('[Carrot Compass] WRAPPED prompt:', prepared.identifier, '→', identifierToName.get(prepared.identifier) || prepared.identifier);
        }

        return prepared;
    };

    monkeypatchApplied = true;
    console.log('[Carrot Compass] Applied promptManager monkeypatches (getPromptCollection + preparePrompt)');
}

/**
 * Remove the monkeypatch and restore original functions
 * Exported for potential cleanup use
 */
export function removePromptManagerPatch() {
    if (!monkeypatchApplied) return;

    const pm = getPromptManager();
    if (!pm) return;

    if (originalGetPromptCollection) {
        pm.getPromptCollection = originalGetPromptCollection;
        originalGetPromptCollection = null;
    }
    if (originalPreparePrompt) {
        pm.preparePrompt = originalPreparePrompt;
        originalPreparePrompt = null;
    }

    monkeypatchApplied = false;
    console.log('[Carrot Compass] Removed promptManager monkeypatches');
}

// =============================================================================
// PROMPT PROCESSING
// =============================================================================

/**
 * Process chat completion prompt and extract itemization
 * @param {Object} eventData
 */
async function processChatCompletion(eventData) {
    if (eventData.dryRun) return;

    const { chat } = eventData;
    if (!chat?.length) return;

    const context = getContext();
    const countTokens = context?.getTokenCountAsync || (t => Math.ceil(t.length / 4));

    const itemization = {
        timestamp: Date.now(),
        sections: [],
        totalMarkedTokens: 0,
        rawMessages: chat.length,
    };

    // Scan all messages for markers
    for (const message of chat) {
        if (!message.content) continue;

        const content = typeof message.content === 'string' ? message.content : String(message.content);
        const markers = parseMarkers(content);

        for (const { tag, content: markerContent } of markers) {
            const tokens = await countTokens(markerContent);

            itemization.sections.push({
                tag,
                name: getDisplayName(tag),
                content: markerContent,
                tokens,
                preview: markerContent.length > 100 ? markerContent.slice(0, 100) + '...' : markerContent,
                role: message.role,
            });

            itemization.totalMarkedTokens += tokens;
        }
    }

    lastItemization = itemization;

    console.debug('[Carrot Compass] Itemization:', itemization.sections.length, 'sections,', itemization.totalMarkedTokens, 'tokens');
    console.debug('[Carrot Compass] Identifier mappings:', Object.fromEntries(identifierToName));
}

/**
 * Process text completion prompt
 * @param {Object} eventData
 */
async function processTextCompletion(eventData) {
    if (eventData.dryRun) return;

    const { prompt } = eventData;
    if (!prompt) return;

    const context = getContext();
    const countTokens = context?.getTokenCountAsync || (t => Math.ceil(t.length / 4));

    const itemization = {
        timestamp: Date.now(),
        sections: [],
        totalMarkedTokens: 0,
        isTextCompletion: true,
    };

    const markers = parseMarkers(prompt);

    for (const { tag, content: markerContent } of markers) {
        const tokens = await countTokens(markerContent);

        itemization.sections.push({
            tag,
            name: getDisplayName(tag),
            content: markerContent,
            tokens,
            preview: markerContent.length > 100 ? markerContent.slice(0, 100) + '...' : markerContent,
        });

        itemization.totalMarkedTokens += tokens;
    }

    lastItemization = itemization;

    console.debug('[Carrot Compass] Text itemization:', itemization.sections.length, 'sections');
}

/**
 * Clean up after generation
 */
function onGenerationEnded() {
    restoreExtensionPrompts();
}

/**
 * Capture prompt manager data after CHAT_COMPLETION_PROMPT_READY
 * This gives us native ST token counts per prompt identifier
 */
function capturePromptManagerData() {
    const pm = getPromptManager();
    if (!pm) {
        console.debug('[Carrot Compass] promptManager not available');
        return;
    }

    try {
        // Get token counts per identifier from ST's native system
        const counts = pm.tokenHandler?.counts || {};

        console.debug('[Carrot Compass] Native ST token counts:', counts);

        // Get the prompt collection to get content and metadata
        const prompts = [];
        const serviceSettings = pm.serviceSettings;

        if (serviceSettings?.prompts) {
            for (const prompt of serviceSettings.prompts) {
                if (!prompt.identifier) continue;

                const tokenCount = counts[prompt.identifier] || 0;
                if (tokenCount === 0 && !prompt.content?.trim()) continue;

                prompts.push({
                    identifier: prompt.identifier,
                    name: prompt.name || prompt.identifier,
                    content: prompt.content || '',
                    tokens: tokenCount,
                    role: prompt.role || 'system',
                    enabled: prompt.enabled !== false,
                    system_prompt: prompt.system_prompt || false,
                    injection_position: prompt.injection_position,
                    injection_depth: prompt.injection_depth,
                    marker: prompt.marker || false,
                });
            }
        }

        // Also add counts that aren't in serviceSettings.prompts (system prompts like charDescription)
        const knownIdentifiers = new Set(prompts.map(p => p.identifier));
        for (const [identifier, tokenCount] of Object.entries(counts)) {
            if (!knownIdentifiers.has(identifier) && tokenCount > 0) {
                prompts.push({
                    identifier,
                    name: DISPLAY_NAMES[sanitizeTag(identifier)] || identifier,
                    content: '', // We don't have the content for these
                    tokens: tokenCount,
                    role: 'system',
                    enabled: true,
                    system_prompt: true,
                    marker: false,
                });
            }
        }

        lastPromptManagerData = {
            timestamp: Date.now(),
            counts: { ...counts },
            prompts,
            totalTokens: Object.values(counts).reduce((sum, n) => sum + n, 0),
        };

        console.debug('[Carrot Compass] Captured prompt manager data:', prompts.length, 'prompts,', lastPromptManagerData.totalTokens, 'total tokens');
        console.debug('[Carrot Compass] Prompts:', prompts.map(p => `${p.identifier}: ${p.tokens}`));
    } catch (error) {
        console.error('[Carrot Compass] Failed to capture prompt manager data:', error);
    }
}

/**
 * Get the last captured prompt manager data
 * @returns {Object|null}
 */
export function getPromptManagerData() {
    return lastPromptManagerData;
}

/**
 * Check if prompt manager data is available
 * @returns {boolean}
 */
export function hasPromptManagerData() {
    return lastPromptManagerData?.prompts?.length > 0;
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Enable marker injection
 */
export function enableMarkers() {
    markersEnabled = true;
    console.log('[Carrot Compass] Token markers enabled');
}

/**
 * Disable marker injection
 */
export function disableMarkers() {
    markersEnabled = false;
    restoreExtensionPrompts();
    console.log('[Carrot Compass] Token markers disabled');
}

/**
 * @returns {boolean}
 */
export function areMarkersEnabled() {
    return markersEnabled;
}

/**
 * @returns {Object|null}
 */
export function getLastItemization() {
    return lastItemization;
}

/**
 * @returns {boolean}
 */
export function hasItemizationData() {
    return lastItemization?.sections?.length > 0;
}

/**
 * Categorize a section based on its tag and name
 * @param {Object} section - Section with tag, name properties
 * @returns {string} Category name
 */
function categorizeSection(section) {
    const tag = section.tag.toUpperCase();
    const name = (section.name || '').toLowerCase();

    // Character Card - ST system identifiers
    if (['CHARDESCRIPTION', 'CHARPERSONALITY', 'SCENARIO', 'PERSONADESCRIPTION'].includes(tag)) {
        return 'Character Card';
    }

    // World Info
    if (tag === 'WORLDINFOBEFORE' || tag === 'WORLDINFOAFTER' || tag.startsWith('WI_')) {
        return 'World Info';
    }

    // Chat History - messages from conversation
    if (tag.startsWith('CHATHISTORY')) {
        return 'Chat History';
    }

    // Extensions - ST built-in extension prompts
    if (['SUMMARY', 'AUTHORSNOTE', 'VECTORSMEMORY', 'VECTORSDATABANK', 'SMARTCONTEXT', 'IMPERSONATE', 'BIAS', 'GROUPNUDGE'].includes(tag)) {
        return 'Extensions';
    }

    // System markers (main prompt, jailbreak)
    if (['MAIN', 'JAILBREAK', 'ENHANCEDEFINITIONS', 'NSFW'].includes(tag)) {
        return 'System Prompts';
    }

    // Extension prompt markers we inject
    if (['AN', 'MEMORY', 'VECTORS_CHAT', 'VECTORS_DATA', 'CHROMADB', 'VECTHARE', 'RAG'].includes(tag)) {
        return 'Extensions';
    }

    // Example dialogues
    if (tag === 'EXAMPLES' || tag === 'DIALOGUEEXAMPLES') {
        return 'Example Dialogue';
    }

    // Check if it looks like a UUID (user-defined preset prompt)
    // UUID pattern: 8 chars - 4 chars - 4 chars - 4 chars - 12 chars (with underscores instead of dashes)
    const uuidPattern = /^[A-F0-9]{8}_[A-F0-9]{4}_[A-F0-9]{4}_[A-F0-9]{4}_[A-F0-9]{12}$/;
    if (uuidPattern.test(tag)) {
        return 'Preset Prompts';
    }

    // Fallback - anything else goes to Other
    return 'Other';
}

/**
 * Get summary grouped by category
 * @returns {Object|null}
 */
export function getItemizationSummary() {
    if (!lastItemization) return null;

    const summary = {
        timestamp: lastItemization.timestamp,
        totalTokens: lastItemization.totalMarkedTokens,
        categories: {},
    };

    // Group sections by category
    for (const section of lastItemization.sections) {
        const category = categorizeSection(section);

        if (!summary.categories[category]) {
            summary.categories[category] = {
                sections: [],
                tokens: 0,
            };
        }

        summary.categories[category].sections.push(section);
        summary.categories[category].tokens += section.tokens;
    }

    return summary;
}

/**
 * Retry applying the monkeypatch with exponential backoff
 * @param {number} attempts - Number of attempts remaining
 * @param {number} delay - Current delay in ms
 */
function retryApplyPatch(attempts = 5, delay = 500) {
    if (monkeypatchApplied) return;

    applyPromptManagerPatch();

    if (!monkeypatchApplied && attempts > 1) {
        console.debug(`[Carrot Compass] Retrying monkeypatch in ${delay}ms (${attempts - 1} attempts remaining)`);
        setTimeout(() => retryApplyPatch(attempts - 1, delay * 2), delay);
    }
}

/**
 * Initialize the token itemizer
 */
export function initTokenItemizer() {
    // Try to apply monkeypatch immediately (may fail if promptManager not ready)
    applyPromptManagerPatch();

    // If immediate patch failed, retry with backoff (catches early init timing)
    if (!monkeypatchApplied) {
        setTimeout(() => retryApplyPatch(5, 500), 100);
    }

    // Retry patch on generation start if not already applied
    // This ensures we catch promptManager after it's been initialized
    eventSource.on(event_types.GENERATION_STARTED, () => {
        if (!monkeypatchApplied) {
            console.log('[Carrot Compass] Attempting monkeypatch on GENERATION_STARTED...');
            applyPromptManagerPatch();
        }
        injectExtensionPromptMarkers();
    });

    // Also try on CHAT_COMPLETION_SETTINGS_READY - this fires when OpenAI settings are loaded
    eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, () => {
        if (!monkeypatchApplied) {
            console.log('[Carrot Compass] Attempting monkeypatch on CHAT_COMPLETION_SETTINGS_READY...');
            applyPromptManagerPatch();
        }
    });

    // Inject markers into story string params before combine
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, injectStoryStringMarkers);

    // Capture itemization from final prompts
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, processChatCompletion);
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, processTextCompletion);

    // Capture prompt manager data (always, regardless of marker state)
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, capturePromptManagerData);

    // Clean up
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    console.log('[Carrot Compass] Token itemizer initialized');
}

// =============================================================================
// UI DISPLAY
// =============================================================================

/**
 * Category colors for visual grouping
 */
const CATEGORY_COLORS = {
    'Character Card': { bg: '#f59e0b', icon: '🎭' },
    'World Info': { bg: '#f97316', icon: '📚' },
    'System Prompts': { bg: '#6366f1', icon: '⚙️' },
    'Extensions': { bg: '#8b5cf6', icon: '🔌' },
    'Chat History': { bg: '#64748b', icon: '💬' },
    'Preset Prompts': { bg: '#10b981', icon: '✨' },
    'Example Dialogue': { bg: '#06b6d4', icon: '📝' },
    'Other': { bg: '#475569', icon: '📄' },
};

/**
 * Tag-specific colors
 */
const TAG_COLORS = {
    'CHAR': '#f59e0b',
    'PERSONALITY': '#eab308',
    'SCENARIO': '#84cc16',
    'PERSONA': '#d946ef',
    'WI_BEFORE': '#f97316',
    'WI_AFTER': '#ea580c',
    'MAIN': '#6366f1',
    'JB': '#ef4444',
    'NSFW': '#ec4899',
    'AN': '#a855f7',
    'MEMORY': '#06b6d4',
    'VECTORS_CHAT': '#3b82f6',
    'VECTORS_DATA': '#2563eb',
    'CHROMADB': '#10b981',
    'VECTHARE': '#8b5cf6',
    'RAG': '#14b8a6',
    'EXAMPLES': '#64748b',
};

/**
 * Show the token itemization modal
 */
export function showTokenItemizer() {
    if (!lastItemization || lastItemization.sections.length === 0) {
        toastr.info('No itemization data yet. Enable markers and send a message first!', 'Carrot Compass');
        return;
    }

    // Remove existing modal
    const existing = document.getElementById('ck-token-itemizer-modal');
    if (existing) existing.remove();

    const summary = getItemizationSummary();

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'ck-token-itemizer-modal';
    modal.className = 'ck-itemizer-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        backdrop-filter: blur(4px);
    `;

    const container = document.createElement('div');
    container.className = 'ck-itemizer-container';
    container.style.cssText = `
        background: var(--SmartThemeBlurTintColor, #1a1a2e);
        border-radius: 16px;
        width: 95%;
        max-width: 1400px;
        height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    // Header
    const header = document.createElement('div');
    header.className = 'ck-itemizer-header';
    header.style.cssText = `
        padding: 16px 24px;
        background: linear-gradient(135deg, rgba(255, 107, 53, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
    `;

    const titleArea = document.createElement('div');
    titleArea.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 24px;">📊</span>
            <div>
                <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--SmartThemeBodyColor);">Token Itemization</h2>
                <small style="opacity: 0.7;">${lastItemization.sections.length} sections • ${lastItemization.totalMarkedTokens.toLocaleString()} tokens tracked • ${new Date(lastItemization.timestamp).toLocaleTimeString()}</small>
            </div>
        </div>
    `;

    const headerControls = document.createElement('div');
    headerControls.style.cssText = 'display: flex; align-items: center; gap: 12px;';

    // Toggle markers button
    const toggleBtn = document.createElement('button');
    toggleBtn.innerHTML = markersEnabled ? '🔴 Markers ON' : '⚪ Markers OFF';
    toggleBtn.style.cssText = `
        background: ${markersEnabled ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 255, 255, 0.1)'};
        border: 1px solid ${markersEnabled ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255, 255, 255, 0.2)'};
        color: var(--SmartThemeBodyColor);
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.2s;
    `;
    toggleBtn.addEventListener('click', () => {
        if (markersEnabled) {
            disableMarkers();
            toggleBtn.innerHTML = '⚪ Markers OFF';
            toggleBtn.style.background = 'rgba(255, 255, 255, 0.1)';
            toggleBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        } else {
            enableMarkers();
            toggleBtn.innerHTML = '🔴 Markers ON';
            toggleBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            toggleBtn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
        }
    });
    headerControls.appendChild(toggleBtn);

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: var(--SmartThemeBodyColor);
        width: 36px;
        height: 36px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
        transition: background 0.2s;
    `;
    closeBtn.addEventListener('click', () => modal.remove());
    headerControls.appendChild(closeBtn);

    header.appendChild(titleArea);
    header.appendChild(headerControls);

    // Main content with two columns
    const mainContent = document.createElement('div');
    mainContent.style.cssText = `
        flex: 1;
        display: flex;
        overflow: hidden;
    `;

    // Left sidebar - category summary with pie chart
    const sidebar = document.createElement('div');
    sidebar.className = 'ck-itemizer-sidebar';
    sidebar.style.cssText = `
        width: 320px;
        background: rgba(0, 0, 0, 0.2);
        border-right: 1px solid rgba(255, 255, 255, 0.05);
        padding: 20px;
        overflow-y: auto;
        flex-shrink: 0;
    `;

    // Token pie chart (CSS-based)
    const chartContainer = document.createElement('div');
    chartContainer.style.cssText = `
        margin-bottom: 24px;
        text-align: center;
    `;

    const chartTitle = document.createElement('div');
    chartTitle.style.cssText = 'font-weight: 600; margin-bottom: 16px; font-size: 14px; color: var(--SmartThemeBodyColor);';
    chartTitle.textContent = 'Token Distribution';
    chartContainer.appendChild(chartTitle);

    // Build pie chart with CSS conic-gradient
    const chart = document.createElement('div');
    const categories = Object.entries(summary.categories);
    let gradientParts = [];
    let currentAngle = 0;

    categories.forEach(([name, data]) => {
        const percentage = (data.tokens / summary.totalTokens) * 100;
        const endAngle = currentAngle + (percentage * 3.6); // 360 / 100 = 3.6
        const color = CATEGORY_COLORS[name]?.bg || '#64748b';
        gradientParts.push(`${color} ${currentAngle}deg ${endAngle}deg`);
        currentAngle = endAngle;
    });

    chart.style.cssText = `
        width: 180px;
        height: 180px;
        border-radius: 50%;
        background: conic-gradient(${gradientParts.join(', ')});
        margin: 0 auto 16px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        position: relative;
    `;

    // Center hole for donut effect
    const centerHole = document.createElement('div');
    centerHole.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 100px;
        height: 100px;
        border-radius: 50%;
        background: var(--SmartThemeBlurTintColor, #1a1a2e);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    `;
    centerHole.innerHTML = `
        <div style="font-size: 20px; font-weight: 700; color: var(--SmartThemeBodyColor);">${summary.totalTokens.toLocaleString()}</div>
        <div style="font-size: 10px; opacity: 0.7;">tokens</div>
    `;
    chart.appendChild(centerHole);
    chartContainer.appendChild(chart);

    // Legend
    const legend = document.createElement('div');
    legend.style.cssText = 'display: flex; flex-direction: column; gap: 8px; margin-top: 16px;';

    categories.forEach(([name, data]) => {
        const percentage = ((data.tokens / summary.totalTokens) * 100).toFixed(1);
        const color = CATEGORY_COLORS[name]?.bg || '#64748b';
        const icon = CATEGORY_COLORS[name]?.icon || '📄';

        const legendItem = document.createElement('div');
        legendItem.style.cssText = `
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.03);
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
        `;
        legendItem.innerHTML = `
            <div style="width: 12px; height: 12px; border-radius: 3px; background: ${color}; flex-shrink: 0;"></div>
            <span style="font-size: 14px;">${icon}</span>
            <span style="flex: 1; font-size: 13px; font-weight: 500;">${name}</span>
            <span style="font-size: 12px; opacity: 0.7;">${data.tokens.toLocaleString()}</span>
            <span style="font-size: 11px; background: ${color}20; color: ${color}; padding: 2px 6px; border-radius: 4px; font-weight: 600;">${percentage}%</span>
        `;

        legendItem.addEventListener('mouseenter', () => {
            legendItem.style.background = 'rgba(255, 255, 255, 0.08)';
        });
        legendItem.addEventListener('mouseleave', () => {
            legendItem.style.background = 'rgba(255, 255, 255, 0.03)';
        });

        legend.appendChild(legendItem);
    });

    chartContainer.appendChild(legend);
    sidebar.appendChild(chartContainer);

    // Right content - detailed sections
    const content = document.createElement('div');
    content.className = 'ck-itemizer-content';
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 20px;
    `;

    // Render each category
    categories.forEach(([categoryName, categoryData]) => {
        const categoryColor = CATEGORY_COLORS[categoryName]?.bg || '#64748b';
        const categoryIcon = CATEGORY_COLORS[categoryName]?.icon || '📄';

        const categorySection = document.createElement('div');
        categorySection.className = 'ck-itemizer-category';
        categorySection.style.cssText = 'margin-bottom: 24px;';

        // Category header
        const categoryHeader = document.createElement('div');
        categoryHeader.style.cssText = `
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px 16px;
            background: ${categoryColor}15;
            border-left: 4px solid ${categoryColor};
            border-radius: 8px;
            margin-bottom: 12px;
        `;
        categoryHeader.innerHTML = `
            <span style="font-size: 18px;">${categoryIcon}</span>
            <span style="flex: 1; font-weight: 600; font-size: 14px; color: var(--SmartThemeBodyColor);">${categoryName}</span>
            <span style="background: ${categoryColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                ${categoryData.tokens.toLocaleString()} tokens
            </span>
            <span style="font-size: 12px; opacity: 0.7;">${categoryData.sections.length} section${categoryData.sections.length !== 1 ? 's' : ''}</span>
        `;
        categorySection.appendChild(categoryHeader);

        // Sections within category
        const sectionsContainer = document.createElement('div');
        sectionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding-left: 20px;';

        categoryData.sections.forEach(section => {
            const tagColor = TAG_COLORS[section.tag] || categoryColor;

            const sectionEl = document.createElement('div');
            sectionEl.className = 'ck-itemizer-section';
            sectionEl.style.cssText = `
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-left: 3px solid ${tagColor};
                border-radius: 8px;
                overflow: hidden;
                transition: all 0.2s;
            `;

            // Section header
            const sectionHeader = document.createElement('div');
            sectionHeader.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                cursor: pointer;
                user-select: none;
            `;
            sectionHeader.innerHTML = `
                <span style="
                    background: ${tagColor};
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 10px;
                    font-weight: 700;
                    text-transform: uppercase;
                    letter-spacing: 0.5px;
                ">${section.tag}</span>
                <span style="flex: 1; font-size: 13px; font-weight: 500; color: var(--SmartThemeBodyColor);">${section.name}</span>
                ${section.role ? `<span style="font-size: 11px; opacity: 0.5; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${section.role}</span>` : ''}
                <span style="font-size: 12px; font-weight: 600; color: ${tagColor};">${section.tokens.toLocaleString()} tk</span>
                <span class="expand-icon" style="opacity: 0.4; transition: transform 0.2s; font-size: 10px;">▼</span>
            `;

            // Section content (collapsed by default)
            const sectionContent = document.createElement('div');
            sectionContent.style.cssText = `
                display: none;
                padding: 0 16px 16px;
                border-top: 1px solid rgba(255, 255, 255, 0.05);
            `;

            const pre = document.createElement('pre');
            pre.style.cssText = `
                margin: 12px 0 0;
                padding: 12px;
                background: rgba(0, 0, 0, 0.3);
                border-radius: 6px;
                white-space: pre-wrap;
                word-break: break-word;
                font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
                font-size: 12px;
                line-height: 1.5;
                color: var(--SmartThemeBodyColor);
                max-height: 300px;
                overflow-y: auto;
            `;
            pre.textContent = section.content;
            sectionContent.appendChild(pre);

            // Copy button
            const copyBtn = document.createElement('button');
            copyBtn.innerHTML = '📋 Copy';
            copyBtn.style.cssText = `
                margin-top: 8px;
                background: rgba(255, 255, 255, 0.1);
                border: 1px solid rgba(255, 255, 255, 0.2);
                color: var(--SmartThemeBodyColor);
                padding: 6px 12px;
                border-radius: 6px;
                cursor: pointer;
                font-size: 11px;
                transition: all 0.2s;
            `;
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(section.content).then(() => {
                    copyBtn.innerHTML = '✓ Copied!';
                    setTimeout(() => { copyBtn.innerHTML = '📋 Copy'; }, 1500);
                });
            });
            sectionContent.appendChild(copyBtn);

            // Toggle collapse
            let collapsed = true;
            sectionHeader.addEventListener('click', () => {
                collapsed = !collapsed;
                sectionContent.style.display = collapsed ? 'none' : 'block';
                sectionHeader.querySelector('.expand-icon').style.transform = collapsed ? 'rotate(0)' : 'rotate(180deg)';
                sectionEl.style.background = collapsed ? 'rgba(255, 255, 255, 0.03)' : 'rgba(255, 255, 255, 0.06)';
            });

            sectionEl.appendChild(sectionHeader);
            sectionEl.appendChild(sectionContent);
            sectionsContainer.appendChild(sectionEl);
        });

        categorySection.appendChild(sectionsContainer);
        content.appendChild(categorySection);
    });

    mainContent.appendChild(sidebar);
    mainContent.appendChild(content);

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = `
        padding: 12px 24px;
        background: rgba(0, 0, 0, 0.3);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
    `;

    const footerInfo = document.createElement('div');
    footerInfo.style.cssText = 'font-size: 12px; opacity: 0.7;';
    footerInfo.innerHTML = `
        <span style="color: ${markersEnabled ? '#10b981' : '#ef4444'};">●</span>
        Marker injection: <strong>${markersEnabled ? 'Enabled' : 'Disabled'}</strong>
        ${!markersEnabled ? ' — Enable markers and regenerate to track tokens' : ''}
    `;

    const footerActions = document.createElement('div');
    footerActions.style.cssText = 'display: flex; gap: 12px;';

    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = '📥 Export JSON';
    exportBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: var(--SmartThemeBodyColor);
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
    `;
    exportBtn.addEventListener('click', () => {
        const data = JSON.stringify(lastItemization, null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `token-itemization-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Exported itemization data', 'Carrot Compass');
    });
    footerActions.appendChild(exportBtn);

    footer.appendChild(footerInfo);
    footer.appendChild(footerActions);

    container.appendChild(header);
    container.appendChild(mainContent);
    container.appendChild(footer);
    modal.appendChild(container);

    // Close handlers
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);
}

/**
 * Check if monkeypatch is currently applied
 * @returns {boolean}
 */
export function isMonkeypatchApplied() {
    return monkeypatchApplied;
}

/**
 * Get diagnostic info for debugging
 * @returns {Object}
 */
export function getTokenItemizerStatus() {
    const pm = getPromptManager();
    return {
        monkeypatchApplied,
        markersEnabled,
        promptManagerAvailable: !!pm,
        lastItemizationSections: lastItemization?.sections?.length || 0,
        lastPromptManagerPrompts: lastPromptManagerData?.prompts?.length || 0,
        identifierMappingsCount: identifierToName.size,
    };
}

// Export utilities
export { wrap, parseMarkers, stripMarkers, DISPLAY_NAMES };
