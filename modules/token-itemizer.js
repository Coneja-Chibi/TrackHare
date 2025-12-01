// =============================================================================
// TOKEN ITEMIZER - Marker injection for accurate prompt itemization
// Injects <<TAG>>content<</TAG>> markers, parses from final prompt
// =============================================================================

import { event_types, eventSource, extension_prompts } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';

/**
 * Whether marker injection is enabled
 * @type {boolean}
 */
let markersEnabled = false;

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
 * Friendly display names for all tags
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
    // Story string / character card
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
 * Wrap content with markers
 * @param {string} tag - Tag name
 * @param {string} content - Content to wrap
 * @returns {string}
 */
function wrap(tag, content) {
    if (!content?.trim()) return content;
    return `<<${tag}>>${content}<</${tag}>>`;
}

/**
 * Parse all markers from text
 * @param {string} text
 * @returns {Array<{tag: string, content: string}>}
 */
function parseMarkers(text) {
    if (!text) return [];

    const results = [];
    const regex = /<<([A-Z_0-9]+)>>([\s\S]*?)<<\/\1>>/g;
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
                name: DISPLAY_NAMES[tag] || tag.replace(/_/g, ' '),
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
            name: DISPLAY_NAMES[tag] || tag.replace(/_/g, ' '),
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
    const categoryMap = {
        'Character Card': ['CHAR', 'PERSONALITY', 'SCENARIO', 'PERSONA'],
        'World Info': ['WI_BEFORE', 'WI_AFTER'],
        'System Prompts': ['MAIN', 'JB', 'NSFW'],
        'Extensions': ['AN', 'MEMORY', 'VECTORS_CHAT', 'VECTORS_DATA', 'CHROMADB', 'VECTHARE', 'RAG'],
        'Other': ['EXAMPLES', 'ANCHOR_BEFORE', 'ANCHOR_AFTER'],
    };

    for (const [category, tags] of Object.entries(categoryMap)) {
        const sections = lastItemization.sections.filter(s => tags.includes(s.tag));
        if (sections.length > 0) {
            summary.categories[category] = {
                sections,
                tokens: sections.reduce((sum, s) => sum + s.tokens, 0),
            };
        }
    }

    // Any uncategorized
    const allKnownTags = Object.values(categoryMap).flat();
    const uncategorized = lastItemization.sections.filter(s => !allKnownTags.includes(s.tag));
    if (uncategorized.length > 0) {
        summary.categories['Uncategorized'] = {
            sections: uncategorized,
            tokens: uncategorized.reduce((sum, s) => sum + s.tokens, 0),
        };
    }

    return summary;
}

/**
 * Initialize the token itemizer
 */
export function initTokenItemizer() {
    // Inject markers at generation start (for extension_prompts)
    eventSource.on(event_types.GENERATION_STARTED, injectExtensionPromptMarkers);

    // Inject markers into story string params before combine
    eventSource.on(event_types.GENERATE_BEFORE_COMBINE_PROMPTS, injectStoryStringMarkers);

    // Capture itemization from final prompts
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, processChatCompletion);
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, processTextCompletion);

    // Clean up
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);

    console.log('[Carrot Compass] Token itemizer initialized');
}

// Export utilities
export { wrap, parseMarkers, stripMarkers, DISPLAY_NAMES };
