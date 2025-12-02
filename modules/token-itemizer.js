// =============================================================================
// TOKEN ITEMIZER - Marker injection for accurate prompt itemization
// Injects <<TAG>>content<</TAG>> markers, parses from final prompt
// =============================================================================

import { event_types, eventSource, extension_prompts, saveSettingsDebounced, main_api, setExtensionPrompt } from '../../../../../script.js';
// Import as namespace to allow monkeypatching exported functions
import * as scriptModule from '../../../../../script.js';
import { getContext, extension_settings } from '../../../../extensions.js';
// Import entire module to ensure live binding access
import * as openai from '../../../../openai.js';
// Import shared UI state for access to tracked WI entries
import { uiState } from './ui-state.js';
// Import tokenizer functions for custom tokenizer selection
import {
    tokenizers,
    getTextTokens,
    getFriendlyTokenizerName,
    getTokenizerBestMatch,
    guesstimate,
    CHARACTERS_PER_TOKEN_RATIO,
} from '../../../../tokenizers.js';

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
 * Whether the current generation is a dry run (skip marker injection)
 * @type {boolean}
 */
let isDryRun = false;

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
 * Original setExtensionPrompt function (stored for monkeypatch)
 * @type {Function|null}
 */
let originalSetExtensionPrompt = null;

/**
 * Whether the setExtensionPrompt monkeypatch has been applied
 * @type {boolean}
 */
let setExtensionPromptPatched = false;

/**
 * Original generateRaw function (stored for monkeypatch)
 * @type {Function|null}
 */
let originalGenerateRaw = null;

/**
 * Whether the generateRaw monkeypatch has been applied
 * @type {boolean}
 */
let generateRawPatched = false;

/**
 * Storage for quiet prompt content captured before it's cleared
 * @type {string|null}
 */
let capturedQuietPrompt = null;

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
 * Currently selected tokenizer for display/recalculation
 * null = use original tokenizer, otherwise a tokenizer ID from tokenizers enum
 * @type {number|null}
 */
let selectedTokenizer = null;

/**
 * The tokenizer that was used for the original itemization
 * Captured at generation time so we can show/restore it
 * @type {{id: number, name: string}|null}
 */
let originalTokenizer = null;

/**
 * Set of excluded section indices (for "what-if" calculations)
 * @type {Set<number>}
 */
let excludedSections = new Set();

/**
 * Set of excluded categories (for "what-if" calculations)
 * @type {Set<string>}
 */
let excludedCategories = new Set();

/**
 * Custom category display order (for drag-to-reorder in sidebar)
 * Array of category names in display order, or null to use default
 * @type {string[]|null}
 */
let categoryOrder = null;

/**
 * Whether to show breakdown in the context budget bar
 * @type {boolean}
 */
let showBudgetBreakdown = false;

/**
 * Known depth-injected prompts captured before generation
 * Used to identify character notes, author's note, etc. in chat history
 * @type {{authorNote: string|null, characterDepthPrompt: string|null, prefill: string|null}}
 */
let knownDepthPrompts = {
    authorNote: null,
    characterDepthPrompt: null,
    prefill: null, // "Start Reply With" content
};

/**
 * Shadow copy of wrapped prompts for itemization
 * We store wrapped versions here for our tracking, but never inject them into ST
 * Key: sanitized identifier, Value: { identifier, content (wrapped), originalContent, role, name }
 * @type {Map<string, {identifier: string, content: string, originalContent: string, role: string, name: string}>}
 */
let shadowWrappedPrompts = new Map();

/**
 * Track which sections are expanded in the itemizer UI
 * Preserved across modal rebuilds (e.g., when toggling breakdown)
 * Key: section index, Value: true if expanded
 * @type {Set<number>}
 */
let expandedSections = new Set();

/**
 * Track which categories are collapsed in the itemizer UI
 * Preserved across modal rebuilds (e.g., when toggling breakdown)
 * Key: category name, Value: true if collapsed
 * @type {Set<string>}
 */
let collapsedCategories = new Set();

/**
 * Get the current ST tokenizer info (what ST is actually using)
 * @returns {{id: number, name: string}}
 */
function getCurrentSTTokenizer() {
    try {
        const { tokenizerName, tokenizerId } = getFriendlyTokenizerName(main_api);
        return { id: tokenizerId, name: tokenizerName };
    } catch (e) {
        // Fallback - try to figure it out from best match
        try {
            const bestMatch = getTokenizerBestMatch(main_api);
            const found = AVAILABLE_TOKENIZERS.find(t => t.id === bestMatch);
            return { id: bestMatch, name: found?.name || 'Unknown' };
        } catch {
            return { id: tokenizers.NONE, name: 'Estimate' };
        }
    }
}

/**
 * Available tokenizers for the dropdown
 * Matches ST's tokenizer options from docs: https://docs.sillytavern.app/usage/prompts/tokenizer/
 * We can use any tokenizer for inspection regardless of API - we're just counting tokens locally
 * @type {Array<{id: number, key: string, name: string, group?: string}>}
 */
const AVAILABLE_TOKENIZERS = [
    // Estimation
    { id: tokenizers.NONE, key: 'none', name: 'None (~3.3 chars/token)', group: 'Estimation' },

    // Llama family
    { id: tokenizers.LLAMA, key: 'llama', name: 'LLaMA', group: 'LLaMA Family' },
    { id: tokenizers.LLAMA3, key: 'llama3', name: 'LLaMA 3', group: 'LLaMA Family' },

    // Mistral family
    { id: tokenizers.MISTRAL, key: 'mistral', name: 'Mistral v1', group: 'Mistral Family' },
    { id: tokenizers.NEMO, key: 'nemo', name: 'Mistral Nemo', group: 'Mistral Family' },

    // OpenAI / tiktoken
    { id: tokenizers.OPENAI, key: 'openai', name: 'OpenAI (cl100k/tiktoken)', group: 'OpenAI' },
    { id: tokenizers.GPT2, key: 'gpt2', name: 'GPT-2', group: 'OpenAI' },

    // Anthropic
    { id: tokenizers.CLAUDE, key: 'claude', name: 'Claude', group: 'Anthropic' },

    // NovelAI
    { id: tokenizers.NERD, key: 'nerd', name: 'NerdStash (Clio)', group: 'NovelAI' },
    { id: tokenizers.NERD2, key: 'nerd2', name: 'NerdStash v2 (Kayra)', group: 'NovelAI' },

    // Other models
    { id: tokenizers.YI, key: 'yi', name: 'Yi', group: 'Other Models' },
    { id: tokenizers.GEMMA, key: 'gemma', name: 'Gemma', group: 'Other Models' },
    { id: tokenizers.JAMBA, key: 'jamba', name: 'Jamba', group: 'Other Models' },
    { id: tokenizers.COMMAND_A, key: 'command_a', name: 'Command A', group: 'Other Models' },

    // These require one-time download in ST settings
    { id: tokenizers.QWEN2, key: 'qwen2', name: 'Qwen2', group: 'Downloadable', needsDownload: true },
    { id: tokenizers.COMMAND_R, key: 'command_r', name: 'Command R', group: 'Downloadable', needsDownload: true },
    { id: tokenizers.DEEPSEEK, key: 'deepseek', name: 'DeepSeek', group: 'Downloadable', needsDownload: true },
];

/**
 * Count tokens using a specific tokenizer
 * @param {string} text - Text to tokenize
 * @param {number|null} tokenizerType - Tokenizer ID, or null for ST default
 * @returns {Promise<number>} Token count
 */
async function countTokensWithTokenizer(text, tokenizerType = null) {
    if (!text || typeof text !== 'string') return 0;

    // Use ST's default if no specific tokenizer selected
    if (tokenizerType === null) {
        const context = getContext();
        if (context?.getTokenCountAsync) {
            return await context.getTokenCountAsync(text);
        }
        // Fallback to estimate
        return Math.ceil(text.length / CHARACTERS_PER_TOKEN_RATIO);
    }

    // Use estimate for "None" tokenizer
    if (tokenizerType === tokenizers.NONE) {
        return guesstimate(text);
    }

    try {
        // getTextTokens returns array of token IDs - length is the count
        const tokens = getTextTokens(tokenizerType, text);
        if (Array.isArray(tokens) && tokens.length > 0) {
            return tokens.length;
        }
        // Empty array for non-empty text means something went wrong
        if (Array.isArray(tokens) && tokens.length === 0 && text.length > 0) {
            // Check if this is a downloadable tokenizer
            const tok = AVAILABLE_TOKENIZERS.find(t => t.id === tokenizerType);
            if (tok?.needsDownload) {
                // First call might trigger download - the server auto-downloads if enabled
                // Give a helpful message either way
                console.warn('[Carrot Compass] Tokenizer returned empty - may be downloading or disabled');
                throw new Error(`${tok.name} returned no tokens. It may be downloading (try again in a moment) or downloads may be disabled in ST config.`);
            }
            console.warn('[Carrot Compass] Tokenizer returned empty array');
            return 0;
        }
        return tokens.length || 0;
    } catch (error) {
        const tok = AVAILABLE_TOKENIZERS.find(t => t.id === tokenizerType);
        if (tok?.needsDownload) {
            throw new Error(`${tok.name}: ${error.message || 'Failed'}. If downloading, wait a moment and try again.`);
        }
        console.warn('[Carrot Compass] Tokenizer error:', error);
        throw error;
    }
}

/**
 * Recalculate all token counts in itemization with a different tokenizer
 * @param {number|null} tokenizerType - Tokenizer ID to use
 * @returns {Promise<void>}
 */
async function recalculateTokenCounts(tokenizerType) {
    if (!lastItemization?.sections) return;

    console.log('[Carrot Compass] Recalculating tokens with tokenizer:', tokenizerType);

    let newTotal = 0;
    for (const section of lastItemization.sections) {
        // Store original tokens on first recalculation
        if (section.originalTokens === undefined) {
            section.originalTokens = section.tokens;
        }
        section.tokens = await countTokensWithTokenizer(section.content, tokenizerType);
        newTotal += section.tokens;
    }

    // Store original total on first recalculation
    if (lastItemization.originalTotalTokens === undefined) {
        lastItemization.originalTotalTokens = lastItemization.totalMarkedTokens;
    }

    lastItemization.totalMarkedTokens = newTotal;
    lastItemization.tokenizer = tokenizerType;
    lastItemization.recalculatedAt = Date.now();

    console.log('[Carrot Compass] Recalculated:', lastItemization.sections.length, 'sections,', newTotal, 'total tokens');
}

/**
 * Restore original token counts (when user selects original tokenizer)
 * @returns {Promise<void>}
 */
async function restoreOriginalTokenCounts() {
    if (!lastItemization?.sections) return;

    console.log('[Carrot Compass] Restoring original token counts');

    for (const section of lastItemization.sections) {
        if (section.originalTokens !== undefined) {
            section.tokens = section.originalTokens;
        }
    }

    if (lastItemization.originalTotalTokens !== undefined) {
        lastItemization.totalMarkedTokens = lastItemization.originalTotalTokens;
    }

    lastItemization.tokenizer = null;
    delete lastItemization.recalculatedAt;

    console.log('[Carrot Compass] Restored original counts');
}

/**
 * Calculate effective totals excluding selected sections/categories
 * @returns {{total: number, excluded: number, effective: number, excludedCount: number}}
 */
function calculateEffectiveTotals() {
    if (!lastItemization?.sections) {
        return { total: 0, excluded: 0, effective: 0, excludedCount: 0 };
    }

    let total = 0;
    let excluded = 0;
    let excludedCount = 0;

    lastItemization.sections.forEach((section, idx) => {
        total += section.tokens;

        // Check if this section is excluded directly or via category
        const isExcluded = excludedSections.has(idx) || excludedCategories.has(section.category);
        if (isExcluded) {
            excluded += section.tokens;
            excludedCount++;
        }
    });

    return {
        total,
        excluded,
        effective: total - excluded,
        excludedCount,
    };
}

/**
 * Reset exclusions, custom ordering, and UI state
 */
function resetExclusions() {
    excludedSections.clear();
    excludedCategories.clear();
    categoryOrder = null;
    showBudgetBreakdown = false;
    expandedSections.clear();
    collapsedCategories.clear();
}

/**
 * Get the name of the currently active tokenizer (for display)
 * @returns {string}
 */
function getSelectedTokenizerName() {
    if (selectedTokenizer === null) {
        // Show the original tokenizer that was used
        if (originalTokenizer) {
            return originalTokenizer.name;
        }
        // Fallback to current ST tokenizer
        const current = getCurrentSTTokenizer();
        return current.name;
    }
    const found = AVAILABLE_TOKENIZERS.find(t => t.id === selectedTokenizer);
    return found?.name || 'Unknown';
}

/**
 * Get the currently active tokenizer ID
 * @returns {number}
 */
function getActiveTokenizerId() {
    if (selectedTokenizer !== null) {
        return selectedTokenizer;
    }
    if (originalTokenizer) {
        return originalTokenizer.id;
    }
    return getCurrentSTTokenizer().id;
}

/**
 * Get the max context size from ST settings
 * @returns {number} Max context in tokens
 */
function getMaxContextSize() {
    try {
        // Try OpenAI settings first (most common)
        if (openai.oai_settings?.openai_max_context) {
            return openai.oai_settings.openai_max_context;
        }
        // Fallback - try to read from the UI element
        const contextEl = document.getElementById('openai_max_context');
        if (contextEl?.value) {
            return parseInt(contextEl.value, 10);
        }
        // Default fallback
        return 0;
    } catch (e) {
        console.debug('[Carrot Compass] Could not get max context:', e);
        return 0;
    }
}

/**
 * Dynamic mapping of identifier → friendly name (populated from promptManager)
 * @type {Map<string, string>}
 */
const identifierToName = new Map();

/**
 * Metadata storage for prompt properties
 * Maps sanitized tag → { isSystemPrompt, isMarker, isUserPrompt, originalIdentifier, sources }
 * @type {Map<string, Object>}
 */
const promptMetadata = new Map();

/**
 * Macro patterns that indicate content sources
 * Maps macro pattern → source category
 * These are detected BEFORE macro expansion to categorize preset prompts by what they inject
 */
const MACRO_SOURCES = {
    // User persona - highest priority for categorization
    '{{persona}}': 'persona',
    '{{personaDescription}}': 'persona',

    // Character card content
    '{{description}}': 'character',
    '{{personality}}': 'character',
    '{{scenario}}': 'character',
    '{{charDescription}}': 'character',
    '{{charPersonality}}': 'character',

    // Example dialogue
    '{{mesExamples}}': 'examples',
    '{{mesExamplesRaw}}': 'examples',

    // System instructions from character card
    '{{charPrompt}}': 'system',
    '{{charJailbreak}}': 'system',
    '{{charInstruction}}': 'system',
    '{{systemPrompt}}': 'system',

    // World info (in case someone uses these in custom prompts)
    '{{worldInfoBefore}}': 'worldinfo',
    '{{worldInfoAfter}}': 'worldinfo',

    // Name macros - these are used everywhere, so lowest priority
    // Only categorize if NO other sources detected
    '{{char}}': 'character_name',
    '{{user}}': 'user_name',
};

/**
 * Detect what sources a prompt template uses based on macros
 * @param {string} content - The prompt content (before macro expansion)
 * @returns {Set<string>} Set of source categories detected
 */
function detectMacroSources(content) {
    const sources = new Set();
    if (!content) return sources;

    for (const [macro, source] of Object.entries(MACRO_SOURCES)) {
        if (content.includes(macro)) {
            sources.add(source);
        }
    }

    return sources;
}

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
    // Depth-injected prompts (identified from content matching)
    'AUTHORSNOTE': 'Author\'s Note',
    'CHAR_DEPTH_PROMPT': 'Character Notes',
    // Prefill (Start Reply With)
    'PREFILL': 'Start Reply With',
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
 * Get a readable position name for a WI entry based on ST's position constants
 * @param {number} position - ST position value (0=before, 1=after, 2=ANTop, 3=ANBottom, 4=atDepth, etc.)
 * @param {number} depth - Depth value for atDepth entries
 * @returns {string} Position name like "BEFORE", "AFTER", "DEPTH_4"
 */
function getWIPositionName(position, depth) {
    // ST world info position constants
    switch (position) {
        case 0: return 'BEFORE';
        case 1: return 'AFTER';
        case 2: return 'AN_TOP';
        case 3: return 'AN_BOTTOM';
        case 4: return 'AT_DEPTH';
        case 5: return `DEPTH_${depth ?? 0}`;
        case 6: return 'BEFORE_CHAR';
        case 7: return 'AFTER_CHAR';
        default: return `POS_${position}`;
    }
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

    // Handle WI position tags (WI_BEFORE, WI_AFTER, WI_DEPTH_4, etc.)
    // These are now just position indicators - the actual name comes from the section.name field
    if (tag.startsWith('WI_')) {
        // Return a readable position name as fallback (actual entry name is in section.name)
        const positionPart = tag.substring(3); // Remove "WI_"
        return positionPart.replace(/_/g, ' ');
    }

    // Format tag as readable name (replace underscores, title case)
    return tag.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\b\w+/g, w => w.charAt(0) + w.slice(1).toLowerCase());
}

/**
 * Strip all markers from text
 * Matches our <<TAG>> and <</TAG>> format, including UUID-style identifiers with hyphens
 * @param {string} text
 * @returns {string}
 */
function stripMarkers(text) {
    if (!text) return text;
    return text.replace(/<<\/?[A-Z0-9_-]+>>/gi, '');
}

// =============================================================================
// INJECTION HOOKS
// =============================================================================

/**
 * Inject markers into extension_prompts on GENERATION_STARTED
 * Skips injection if this is a dry run
 */
function injectExtensionPromptMarkers() {
    if (!markersEnabled || isDryRun) return;

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
 * Skips injection if this is a dry run
 * @param {Object} data - Event data containing all prompt pieces
 */
function injectStoryStringMarkers(data) {
    if (!markersEnabled || isDryRun) return;

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

    // World Info - don't wrap the combined blobs, we'll add entries directly from uiState.currentEntryList
    // Just leave worldInfoBefore/After unwrapped - the processChatCompletion will handle WI entries separately

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

    // Now wrap ALL extension_prompts with markers
    // This catches everything extensions inject via setExtensionPrompt()
    for (const key of Object.keys(extension_prompts)) {
        const prompt = extension_prompts[key];
        if (!prompt?.value?.trim()) continue;
        if (originalExtPrompts.has(key)) continue; // Already wrapped

        // Store original for restoration
        originalExtPrompts.set(key, prompt.value);

        // Determine the tag based on the key
        let tag;
        if (key === 'DEPTH_PROMPT' || key.startsWith('DEPTH_PROMPT_')) {
            tag = 'CHAR_DEPTH_PROMPT';
        } else if (key === '2_floating_prompt') {
            tag = 'AUTHORSNOTE';
        } else if (key === '1_memory') {
            tag = 'MEMORY';
        } else if (key === '3_vectors') {
            tag = 'VECTORS_CHAT';
        } else if (key === '4_vectors_data_bank') {
            tag = 'VECTORS_DATA';
        } else if (key === 'chromadb') {
            tag = 'CHROMADB';
        } else if (key === 'vecthare' || key.startsWith('vecthare_')) {
            tag = 'VECTHARE';
        } else if (key === 'carrotkernel_rag') {
            tag = 'RAG';
        } else {
            // Generic extension prompt - use sanitized key as tag
            tag = `EXT_${key.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
        }

        prompt.value = wrap(tag, prompt.value);
        console.debug('[Carrot Compass] Wrapped extension prompt:', key, '->', tag);
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
// QUIET PROMPT & RAW PROMPT MONKEYPATCHES
// =============================================================================

/**
 * Apply monkeypatch to setExtensionPrompt to catch quiet prompts
 * Quiet prompts are set then immediately cleared, so we need to capture them at set-time
 */
function applySetExtensionPromptPatch() {
    if (setExtensionPromptPatched) return;

    // Store original function from the module
    originalSetExtensionPrompt = scriptModule.setExtensionPrompt;

    // Create patched version
    const patchedSetExtensionPrompt = function(key, value, ...args) {
        // Capture quiet prompts before they get cleared
        if (key === 'QUIET_PROMPT' && value?.trim() && markersEnabled && !isDryRun) {
            capturedQuietPrompt = value;
            // Wrap the value with our marker
            value = wrap('QUIET_PROMPT', value);
            console.debug('[Carrot Compass] Captured quiet prompt');
        }
        return originalSetExtensionPrompt.call(this, key, value, ...args);
    };

    // Apply the patch - reassign in script module
    // Note: This works because we imported as namespace (import * as scriptModule)
    try {
        Object.defineProperty(scriptModule, 'setExtensionPrompt', {
            value: patchedSetExtensionPrompt,
            writable: true,
            configurable: true,
        });
        setExtensionPromptPatched = true;
        console.log('[Carrot Compass] setExtensionPrompt monkeypatch applied');
    } catch (e) {
        // ES modules are frozen in strict mode, try window fallback
        console.warn('[Carrot Compass] Could not patch module export, trying window fallback');
        if (window.setExtensionPrompt) {
            window.setExtensionPrompt = patchedSetExtensionPrompt;
            setExtensionPromptPatched = true;
            console.log('[Carrot Compass] setExtensionPrompt patched via window');
        } else {
            console.error('[Carrot Compass] Failed to patch setExtensionPrompt');
        }
    }
}

/**
 * Apply monkeypatch to generateRaw to catch raw prompt generation
 * Raw prompts bypass the normal generation pipeline, so we need to intercept them here
 */
function applyGenerateRawPatch() {
    if (generateRawPatched) return;

    // Store original function from the module
    originalGenerateRaw = scriptModule.generateRaw;

    if (!originalGenerateRaw) {
        console.warn('[Carrot Compass] generateRaw not found in script module');
        return;
    }

    // Create patched version
    const patchedGenerateRaw = async function(params = {}) {
        // Wrap the prompt with our marker if markers are enabled
        if (markersEnabled && !isDryRun && params.prompt?.trim()) {
            params.prompt = wrap('RAW_PROMPT', params.prompt);
            console.debug('[Carrot Compass] Wrapped raw prompt');
        }
        return originalGenerateRaw.call(this, params);
    };

    // Apply the patch
    try {
        Object.defineProperty(scriptModule, 'generateRaw', {
            value: patchedGenerateRaw,
            writable: true,
            configurable: true,
        });
        generateRawPatched = true;
        console.log('[Carrot Compass] generateRaw monkeypatch applied');
    } catch (e) {
        // ES modules are frozen in strict mode, try window fallback
        console.warn('[Carrot Compass] Could not patch module export, trying window fallback');
        if (window.generateRaw) {
            window.generateRaw = patchedGenerateRaw;
            generateRawPatched = true;
            console.log('[Carrot Compass] generateRaw patched via window');
        } else {
            console.error('[Carrot Compass] Failed to patch generateRaw');
        }
    }
}

/**
 * Clear captured quiet prompt after generation
 */
function clearCapturedQuietPrompt() {
    capturedQuietPrompt = null;
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

    // Patch preparePrompt - this is where content gets finalized
    // We use a SHADOW COPY approach: store wrapped version for our tracking,
    // but return unwrapped content to ST so markers never reach the API
    pm.preparePrompt = function(prompt, original = null) {
        // IMPORTANT: Detect macro sources BEFORE calling originalPreparePrompt
        // because substituteParams() will expand the macros and we'll lose the template
        const macroSources = prompt?.content ? detectMacroSources(prompt.content) : new Set();

        const prepared = originalPreparePrompt(prompt, original);

        // Always store metadata for categorization (even for marker prompts we don't wrap)
        if (prepared?.identifier) {
            const sanitizedId = sanitizeTag(prepared.identifier);
            const displayName = prepared.name || DISPLAY_NAMES[sanitizedId] || prepared.identifier;
            identifierToName.set(sanitizedId, displayName);
            identifierToName.set(prepared.identifier, displayName);

            // Store metadata about this prompt for categorization
            // Include macro sources for smart categorization
            promptMetadata.set(sanitizedId, {
                isSystemPrompt: !!prepared.system_prompt,
                isMarker: !!prepared.marker,
                isUserPrompt: !prepared.system_prompt && !prepared.marker,
                originalIdentifier: prepared.identifier,
                name: displayName,
                role: prepared.role,
                macroSources: macroSources, // Set of source categories detected from macros
            });

            // SHADOW COPY: Store wrapped version for our tracking (if markers enabled and real generation)
            // The prepared.content stays UNWRAPPED - markers never go to ST/API
            if (markersEnabled && !isDryRun && prepared?.content?.trim() && !prepared.marker) {
                const wrappedContent = wrap(prepared.identifier, prepared.content);
                // Store in our shadow map for itemization
                shadowWrappedPrompts.set(sanitizedId, {
                    identifier: prepared.identifier,
                    content: wrappedContent,
                    originalContent: prepared.content,
                    role: prepared.role,
                    name: displayName,
                });
            }
        }

        // Return ORIGINAL content - no markers injected into actual prompt
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
 * Strip WI content from chat messages to prevent double-counting
 * ST depth-injects WI directly into chat message content, so we need to remove it
 * @param {string} content - The content to strip WI from
 * @returns {string} Content with WI removed
 */
function stripWIContentFromChat(content) {
    if (!content) return content;

    const entryList = uiState.currentEntryList || [];
    if (entryList.length === 0) return content;

    let result = content;

    // Remove each WI entry's content from the text
    for (const entry of entryList) {
        if (!entry.content) continue;

        // Only remove if content actually appears
        const index = result.indexOf(entry.content);
        if (index !== -1) {
            // Remove the WI content
            result = result.slice(0, index) + result.slice(index + entry.content.length);
            console.debug('[Carrot Compass] Stripped WI entry from chat:', entry.comment || entry.key?.[0] || `#${entry.uid}`);
        }
    }

    // Clean up any double newlines left behind
    result = result.replace(/\n{3,}/g, '\n\n');

    return result.trim();
}

/**
 * Check if content contains World Info that was injected at depth
 * Uses uiState.currentEntryList from the worldbook tracker
 * Returns array of { wiEntry, startIndex, endIndex } for each match
 * @param {string} content - Content to check
 * @returns {Array<{wiEntry: Object, startIndex: number, endIndex: number}>}
 */
function findInjectedWIContent(content) {
    const matches = [];
    const entryList = uiState.currentEntryList || [];
    if (!content || entryList.length === 0) return matches;

    for (const entry of entryList) {
        // Check if this WI content appears in the message
        // Try multiple sources for the content
        const wiContent = entry.content || entry.data?.content;
        if (!wiContent) continue;

        const index = content.indexOf(wiContent);
        if (index !== -1) {
            matches.push({
                wiEntry: {
                    uid: entry.uid,
                    world: entry.world,
                    comment: entry.comment || entry.key?.join(', ') || 'World Info Entry',
                    content: wiContent,
                    position: entry.position,
                    depth: entry.depth,
                },
                startIndex: index,
                endIndex: index + wiContent.length,
            });
        }
    }

    // Sort by start index
    matches.sort((a, b) => a.startIndex - b.startIndex);
    return matches;
}

/**
 * Identify known depth-injected prompts by content matching
 * Compares content against known Author's Note and Character Depth Prompt
 * @param {string} content - Content to identify
 * @returns {{tag: string, name: string}|null} Identified prompt info or null
 */
function identifyDepthPrompt(content) {
    const trimmed = content.trim();
    if (!trimmed) return null;

    // Normalize whitespace for comparison (collapse multiple spaces/newlines)
    const normalize = (str) => str.replace(/\s+/g, ' ').trim().toLowerCase();
    const normalizedContent = normalize(trimmed);

    // Check for Author's Note
    if (knownDepthPrompts.authorNote) {
        const normalizedAN = normalize(knownDepthPrompts.authorNote);
        // Check exact match, containment, or significant overlap
        if (normalizedContent === normalizedAN ||
            normalizedContent.includes(normalizedAN) ||
            normalizedAN.includes(normalizedContent) ||
            // Check if first 50 chars match (handles slight variations)
            (normalizedContent.length > 30 && normalizedAN.length > 30 &&
             normalizedContent.slice(0, 50) === normalizedAN.slice(0, 50))) {
            console.debug('[Carrot Compass] Identified Author\'s Note in chat history');
            return { tag: 'AUTHORSNOTE', name: 'Author\'s Note' };
        }
    }

    // Check for Character Depth Prompt (character notes)
    if (knownDepthPrompts.characterDepthPrompt) {
        const normalizedCDP = normalize(knownDepthPrompts.characterDepthPrompt);
        if (normalizedContent === normalizedCDP ||
            normalizedContent.includes(normalizedCDP) ||
            normalizedCDP.includes(normalizedContent) ||
            (normalizedContent.length > 30 && normalizedCDP.length > 30 &&
             normalizedContent.slice(0, 50) === normalizedCDP.slice(0, 50))) {
            console.debug('[Carrot Compass] Identified Character Depth Prompt in chat history');
            return { tag: 'CHAR_DEPTH_PROMPT', name: 'Character Notes' };
        }
    }

    return null;
}

/**
 * Extract nested markers and unmarked content from CHATHISTORY content
 * This handles depth-injected preset prompts that appear inside chat messages
 * @param {string} content - The CHATHISTORY content that may contain nested markers
 * @param {string} parentTag - The parent CHATHISTORY tag
 * @param {string} role - Message role
 * @param {Function} countTokens - Token counting function
 * @param {boolean} skipWI - If true, don't detect/split WI (we get it from tracker instead)
 * @returns {Promise<Array<Object>>} Array of section objects
 */
async function extractNestedContent(content, parentTag, role, countTokens, skipWI = false) {
    const sections = [];

    // If skipWI is true, strip out any WI content that was injected into chat
    // We get WI from the tracker, so we don't want to double-count it in CHATHISTORY
    let processedContent = content;
    if (skipWI) {
        processedContent = stripWIContentFromChat(content);
        if (processedContent !== content) {
            console.debug('[Carrot Compass] Stripped WI content from CHATHISTORY, remaining length:', processedContent.length);
        }
    }

    // If nothing left after stripping WI, skip this section
    if (!processedContent.trim()) {
        return sections;
    }

    // Find all nested markers within this content
    const nestedMarkers = parseMarkers(processedContent);

    if (nestedMarkers.length > 0) {
        console.debug('[Carrot Compass] Found', nestedMarkers.length, 'nested markers inside', parentTag, ':', nestedMarkers.map(m => m.tag));
    }

    if (nestedMarkers.length === 0) {
        // No nested markers - check if this is a known depth-injected prompt
        const tokens = await countTokens(processedContent);
        if (tokens > 0) {
            // Try to identify known depth prompts by content matching
            const identifiedPrompt = identifyDepthPrompt(processedContent);

            if (identifiedPrompt) {
                sections.push({
                    tag: identifiedPrompt.tag,
                    name: identifiedPrompt.name,
                    content: processedContent,
                    tokens,
                    preview: processedContent.length > 100 ? processedContent.slice(0, 100) + '...' : processedContent,
                    role,
                    isDepthInjected: true,
                });
            } else {
                // Check if this is injected WI content that wasn't stripped
                const wiMatches = findInjectedWIContent(processedContent);
                if (wiMatches.length > 0) {
                    // This is WI content - add as World Info entries
                    for (const match of wiMatches) {
                        const wiTokens = await countTokens(match.wiEntry.content);
                        sections.push({
                            tag: `WI_DEPTH_${match.wiEntry.uid}`,
                            name: match.wiEntry.comment || 'World Info',
                            content: match.wiEntry.content,
                            tokens: wiTokens,
                            preview: match.wiEntry.content.length > 100 ? match.wiEntry.content.slice(0, 100) + '...' : match.wiEntry.content,
                            role,
                            isWorldInfo: true,
                            isDepthInjected: true,
                            wiUid: match.wiEntry.uid,
                            wiWorld: match.wiEntry.world,
                        });
                        console.debug('[Carrot Compass] Identified depth-injected WI entry:', match.wiEntry.comment || match.wiEntry.uid);
                    }
                } else {
                    // Unknown content - keep as chat history
                    sections.push({
                        tag: parentTag,
                        name: getDisplayName(parentTag),
                        content: processedContent,
                        tokens,
                        preview: processedContent.length > 100 ? processedContent.slice(0, 100) + '...' : processedContent,
                        role,
                    });
                }
            }
        }
        return sections;
    }

    // Has nested markers - extract them properly
    // Build a map of marker positions in the processed content (WI already stripped if skipWI)
    const markerPositions = [];
    for (const marker of nestedMarkers) {
        // Find the full marker string position (including tags)
        const fullMarkerRegex = new RegExp(`<<${marker.tag}>>[\\s\\S]*?<<\\/${marker.tag}>>`, 'g');
        let match;
        while ((match = fullMarkerRegex.exec(processedContent)) !== null) {
            // Verify this is the right match by checking content
            if (match[0].includes(marker.content)) {
                markerPositions.push({
                    tag: marker.tag,
                    content: marker.content,
                    startIndex: match.index,
                    endIndex: match.index + match[0].length,
                    fullMatch: match[0],
                });
                break;
            }
        }
    }

    // Sort by position
    markerPositions.sort((a, b) => a.startIndex - b.startIndex);

    // Extract sections: unmarked content between markers + the markers themselves
    let lastEnd = 0;
    for (const pos of markerPositions) {
        // Add any unmarked content before this marker as chat
        if (pos.startIndex > lastEnd) {
            const unmarkedContent = processedContent.substring(lastEnd, pos.startIndex).trim();
            if (unmarkedContent) {
                // Recursively process, passing skipWI through
                const unmarkedSections = await extractNestedContent(unmarkedContent, parentTag, role, countTokens, skipWI);
                sections.push(...unmarkedSections);
            }
        }

        // Add the marker itself as its proper section
        const tokens = await countTokens(pos.content);
        sections.push({
            tag: pos.tag,
            name: getDisplayName(pos.tag),
            content: pos.content,
            tokens,
            preview: pos.content.length > 100 ? pos.content.slice(0, 100) + '...' : pos.content,
            role,
            isDepthInjected: true, // Mark that this was found inside CHATHISTORY
        });

        lastEnd = pos.endIndex;
    }

    // Add any remaining unmarked content after the last marker
    if (lastEnd < processedContent.length) {
        const remainingContent = processedContent.substring(lastEnd).trim();
        if (remainingContent) {
            const remainingSections = await extractNestedContent(remainingContent, parentTag, role, countTokens, skipWI);
            sections.push(...remainingSections);
        }
    }

    return sections;
}

/**
 * Process chat completion prompt and extract itemization
 * @param {Object} eventData
 */
async function processChatCompletion(eventData) {
    // Skip dry runs (token counting, chat loading, etc.)
    if (eventData.dryRun) return;

    const { chat } = eventData;
    if (!chat?.length) return;

    console.log('[Carrot Compass] Processing generation:', chat.length, 'messages, markersEnabled:', markersEnabled);
    console.debug('[Carrot Compass] Shadow prompts captured:', shadowWrappedPrompts.size);

    // No need to strip markers - we use shadow copy approach
    // Markers are never injected into actual prompts, only stored in shadowWrappedPrompts

    // Capture the tokenizer being used for this generation
    originalTokenizer = getCurrentSTTokenizer();
    selectedTokenizer = null; // Reset to show original
    console.debug('[Carrot Compass] Captured original tokenizer:', originalTokenizer.name, '(id:', originalTokenizer.id, ')');

    const context = getContext();
    const countTokens = context?.getTokenCountAsync || (t => Math.ceil(t.length / 4));

    // Capture known depth prompts for later identification in chat history
    // Use substituteParams to expand macros so we can match the actual content
    const substituteParams = context?.substituteParams || ((x) => x);

    // Author's Note from extension_prompts['2_floating_prompt']
    const authorNotePrompt = context?.extensionPrompts?.['2_floating_prompt'];
    const authorNoteRaw = authorNotePrompt?.value?.trim() || null;
    knownDepthPrompts.authorNote = authorNoteRaw ? substituteParams(authorNoteRaw).trim() : null;

    // Character Depth Prompt (character notes) from character data
    const charId = context?.characterId;
    const characters = context?.characters;
    if (charId !== undefined && characters?.[charId]?.data?.extensions?.depth_prompt?.prompt) {
        const cdpRaw = characters[charId].data.extensions.depth_prompt.prompt.trim();
        knownDepthPrompts.characterDepthPrompt = substituteParams(cdpRaw).trim();
    } else {
        knownDepthPrompts.characterDepthPrompt = null;
    }

    // Prefill ("Start Reply With") from power_user settings
    const prefillRaw = context?.powerUserSettings?.user_prompt_bias?.trim() || null;
    knownDepthPrompts.prefill = prefillRaw ? substituteParams(prefillRaw).trim() : null;

    console.debug('[Carrot Compass] Captured depth prompts (after macro substitution):', {
        hasAuthorNote: !!knownDepthPrompts.authorNote,
        authorNotePreview: knownDepthPrompts.authorNote?.slice(0, 50),
        hasCharDepthPrompt: !!knownDepthPrompts.characterDepthPrompt,
        charDepthPreview: knownDepthPrompts.characterDepthPrompt?.slice(0, 50),
        hasPrefill: !!knownDepthPrompts.prefill,
    });

    const itemization = {
        timestamp: Date.now(),
        sections: [],
        totalMarkedTokens: 0,
        rawMessages: chat.length,
        originalTokenizer: { ...originalTokenizer }, // Store in itemization too
    };

    // First, add World Info entries directly from uiState.currentEntryList
    // This gives us individual entries instead of ST's combined blobs
    const entryList = uiState.currentEntryList || [];
    for (const entry of entryList) {
        if (!entry.content) continue;

        const tokens = await countTokens(entry.content);
        const position = getWIPositionName(entry.position, entry.depth);

        itemization.sections.push({
            tag: `WI_${position}`,
            name: entry.comment || entry.key?.[0] || `World Info #${entry.uid}`,
            content: entry.content,
            tokens,
            preview: entry.content.length > 100 ? entry.content.slice(0, 100) + '...' : entry.content,
            role: 'system',
            isWorldInfo: true,
            wiPosition: position,
            wiUid: entry.uid,
            wiWorld: entry.world,
        });

        itemization.totalMarkedTokens += tokens;
    }

    if (entryList.length > 0) {
        console.debug('[Carrot Compass] Added', entryList.length, 'World Info entries from tracker');
    }

    // Use shadow wrapped prompts for itemization (no markers in actual chat)
    // This approach keeps prompts clean while still providing itemization data
    if (markersEnabled && shadowWrappedPrompts.size > 0) {
        for (const [sanitizedId, shadowData] of shadowWrappedPrompts) {
            const { identifier, content, originalContent, role, name } = shadowData;

            // Parse markers from our shadow wrapped content
            const markers = parseMarkers(content);

            for (const { tag, content: markerContent } of markers) {
                // Skip WORLDINFOBEFORE/WORLDINFOAFTER - we get WI entries directly from tracker
                if (tag === 'WORLDINFOBEFORE' || tag === 'WORLDINFOAFTER' || tag === 'WI_BEFORE' || tag === 'WI_AFTER') {
                    console.debug('[Carrot Compass] Skipping', tag, '- WI entries added from tracker');
                    continue;
                }

                // For CHATHISTORY markers, extract any nested markers (depth-injected prompts)
                if (tag.startsWith('CHATHISTORY')) {
                    const extractedSections = await extractNestedContent(markerContent, tag, role, countTokens, true);
                    for (const section of extractedSections) {
                        itemization.sections.push(section);
                        itemization.totalMarkedTokens += section.tokens;
                    }
                } else {
                    const tokens = await countTokens(markerContent);

                    itemization.sections.push({
                        tag,
                        name: getDisplayName(tag),
                        content: markerContent,
                        tokens,
                        preview: markerContent.length > 100 ? markerContent.slice(0, 100) + '...' : markerContent,
                        role,
                    });

                    itemization.totalMarkedTokens += tokens;
                }
            }
        }
        console.debug('[Carrot Compass] Processed', shadowWrappedPrompts.size, 'shadow wrapped prompts');
    }

    // Check for prefill (last assistant message) - this comes from actual chat, not shadow prompts
    const lastMessage = chat[chat.length - 1];
    if (lastMessage?.role === 'assistant' && knownDepthPrompts.prefill) {
        const content = typeof lastMessage.content === 'string' ? lastMessage.content : String(lastMessage.content || '');
        const trimmedContent = content.trim();
        const prefillMatch = trimmedContent === knownDepthPrompts.prefill ||
                             trimmedContent.includes(knownDepthPrompts.prefill) ||
                             knownDepthPrompts.prefill.includes(trimmedContent);
        if (prefillMatch && trimmedContent.length > 0) {
            const tokens = await countTokens(trimmedContent);
            itemization.sections.push({
                tag: 'PREFILL',
                name: 'Start Reply With',
                content: trimmedContent,
                tokens,
                preview: trimmedContent.length > 100 ? trimmedContent.slice(0, 100) + '...' : trimmedContent,
                role: 'assistant',
                isPrefill: true,
            });
            itemization.totalMarkedTokens += tokens;
            console.debug('[Carrot Compass] Identified prefill (Start Reply With):', trimmedContent.slice(0, 50));
        }
    }

    // Clear shadow prompts for next generation
    shadowWrappedPrompts.clear();

    lastItemization = itemization;
    resetExclusions(); // Clear any exclusions from previous generation

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

    // ALWAYS strip markers from prompt when markers are enabled
    // This ensures no <<TAG>> markers ever reach the API
    if (markersEnabled) {
        eventData.prompt = stripMarkers(prompt);
    }

    lastItemization = itemization;
    resetExclusions(); // Clear any exclusions from previous generation

    console.debug('[Carrot Compass] Text itemization:', itemization.sections.length, 'sections');
}

/**
 * Clean up after generation
 */
function onGenerationEnded() {
    restoreExtensionPrompts();
    clearCapturedQuietPrompt();
    isDryRun = false; // Reset dry run state
    // Shadow prompts are cleared in processChatCompletion after itemization
    // Note: WI entries are managed by uiState.currentEntryList (worldbook tracker)
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
 * Ensure CarrotCompass settings object exists
 */
function ensureSettings() {
    if (!extension_settings.CarrotCompass) {
        extension_settings.CarrotCompass = {};
    }
}

/**
 * Enable marker injection
 */
export function enableMarkers() {
    markersEnabled = true;
    ensureSettings();
    extension_settings.CarrotCompass.markersEnabled = true;
    saveSettingsDebounced();
    console.log('[Carrot Compass] Token markers enabled');
}

/**
 * Disable marker injection
 */
export function disableMarkers() {
    markersEnabled = false;
    restoreExtensionPrompts();
    ensureSettings();
    extension_settings.CarrotCompass.markersEnabled = false;
    saveSettingsDebounced();
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
 * Categorize a section based on its tag, metadata, macro sources, and name
 * Uses promptMetadata to distinguish between ST system prompts and user-defined presets
 * Uses macro detection to categorize preset prompts by their content sources
 * @param {Object} section - Section with tag, name properties
 * @returns {string} Category name
 */
function categorizeSection(section) {
    const tag = section.tag.toUpperCase();
    const name = (section.name || '').toLowerCase();
    const metadata = promptMetadata.get(tag);

    // Character Card - ST system marker prompts that pull from character data
    // These have marker: true and system_prompt: true in ST's preset system
    if (['CHARDESCRIPTION', 'CHAR', 'CHARPERSONALITY', 'PERSONALITY', 'SCENARIO', 'PERSONADESCRIPTION', 'PERSONA'].includes(tag)) {
        return 'Character Card';
    }

    // Character Depth Prompt (character notes) - identified from depth injection
    if (tag === 'CHAR_DEPTH_PROMPT') {
        return 'Character Card';
    }

    // World Info - both marker prompts, our custom WI markers, and depth-injected WI
    if (tag === 'WORLDINFOBEFORE' || tag === 'WORLDINFOAFTER' || tag.startsWith('WI_')) {
        return 'World Info';
    }

    // Check if section is explicitly marked as World Info (from depth injection detection)
    if (section.isWorldInfo) {
        return 'World Info';
    }

    // Chat History - messages from conversation (marker prompt)
    // But NOT if it was identified as something else (AUTHORSNOTE, CHAR_DEPTH_PROMPT)
    if (tag.startsWith('CHATHISTORY') || tag === 'CHATHISTORY') {
        return 'Chat History';
    }

    // Example Dialogue (marker prompt)
    if (tag === 'EXAMPLES' || tag === 'DIALOGUEEXAMPLES' || tag === 'DIALOGUEEXAMPLES') {
        return 'Example Dialogue';
    }

    // Prefill ("Start Reply With") - part of preset settings
    if (tag === 'PREFILL') {
        return 'Preset Prompts';
    }

    // Author's Note - user's personal instructions, categorized under Persona
    if (tag === 'AUTHORSNOTE' || tag === 'AN') {
        return 'Persona';
    }

    // Extensions - ST built-in extension prompts
    if (['SUMMARY', 'VECTORSMEMORY', 'VECTORSDATABANK', 'SMARTCONTEXT', 'IMPERSONATE', 'GROUPNUDGE'].includes(tag)) {
        return 'Extensions';
    }

    // Extension prompt markers we inject
    if (['MEMORY', 'VECTORS_CHAT', 'VECTORS_DATA', 'CHROMADB', 'VECTHARE', 'RAG', 'ANCHOR_BEFORE', 'ANCHOR_AFTER'].includes(tag)) {
        return 'Extensions';
    }

    // Quiet prompts - extensions that use quiet generation
    if (tag === 'QUIET_PROMPT') {
        return 'Extensions';
    }

    // Raw prompts - extensions that bypass normal generation pipeline
    if (tag === 'RAW_PROMPT') {
        return 'Extensions';
    }

    // Generic extension prompts (EXT_*) - any extension using setExtensionPrompt()
    if (tag.startsWith('EXT_')) {
        return 'Extensions';
    }

    // System markers - core system prompts (main prompt, jailbreak, NSFW toggle)
    // These are system_prompt: true but NOT marker prompts
    if (['MAIN', 'JAILBREAK', 'ENHANCEDEFINITIONS', 'NSFW'].includes(tag)) {
        return 'System Prompts';
    }

    // Use metadata to categorize if available
    if (metadata) {
        // If it's a system_prompt but not a marker, it's a system config prompt
        if (metadata.isSystemPrompt && !metadata.isMarker) {
            return 'System Prompts';
        }

        // SMART CATEGORIZATION: Use macro sources to determine what this prompt contains
        // This allows us to categorize UUID preset prompts based on WHAT they inject
        if (metadata.macroSources && metadata.macroSources.size > 0) {
            const sources = metadata.macroSources;

            // Persona takes priority - {{persona}} macro injects user persona
            if (sources.has('persona')) {
                return 'Persona';
            }

            // Character card content - description, personality, scenario
            if (sources.has('character')) {
                return 'Character Card';
            }

            // World info macros
            if (sources.has('worldinfo')) {
                return 'World Info';
            }

            // Example dialogue
            if (sources.has('examples')) {
                return 'Example Dialogue';
            }

            // System instructions from character
            if (sources.has('system')) {
                return 'System Prompts';
            }

            // Just character/user name substitution - likely a prompt template
            // Don't categorize based on just name macros since they're used everywhere
        }
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

    // Debug: Log available metadata
    console.debug('[Carrot Compass] Categorizing with metadata:', Object.fromEntries(promptMetadata));

    // Group sections by category
    for (const section of lastItemization.sections) {
        const category = categorizeSection(section);

        // Debug: Log categorization decision
        const metadata = promptMetadata.get(section.tag.toUpperCase());
        console.debug(`[Carrot Compass] Categorized "${section.tag}" → "${category}"`, metadata ? `(system_prompt: ${metadata.isSystemPrompt}, marker: ${metadata.isMarker})` : '(no metadata)');

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
    // Load saved marker state from settings
    ensureSettings();
    if (extension_settings.CarrotCompass.markersEnabled) {
        markersEnabled = true;
        console.log('[Carrot Compass] Restored markers enabled state from settings');
    }

    // Apply quiet prompt and raw prompt patches immediately
    // These need to be in place before any generation happens
    applySetExtensionPromptPatch();
    applyGenerateRawPatch();

    // Try to apply monkeypatch immediately (may fail if promptManager not ready)
    applyPromptManagerPatch();

    // If immediate patch failed, retry with backoff (catches early init timing)
    if (!monkeypatchApplied) {
        setTimeout(() => retryApplyPatch(5, 500), 100);
    }

    // Retry patch on generation start if not already applied
    // This ensures we catch promptManager after it's been initialized
    // Also track dry run state to avoid polluting dry run prompts with markers
    eventSource.on(event_types.GENERATION_STARTED, (args) => {
        // Track dry run state - args can be various formats depending on ST version
        isDryRun = args?.dryRun || args?.dry_run || false;
        if (isDryRun) {
            console.debug('[Carrot Compass] Dry run detected, skipping marker injection');
            return;
        }

        // Clear shadow prompts from any previous generation
        shadowWrappedPrompts.clear();

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

    // Note: WI entries are tracked by uiState.currentEntryList (worldbook tracker in index.js)
    // We use that shared state in findInjectedWIContent() to identify depth-injected WI

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
    // Varied warm palette with distinct hues
    'World Info': { bg: '#f4845f', icon: '📚' },        // Pinkish orange / salmon
    'Preset Prompts': { bg: '#e05297', icon: '✨' },    // Fuchsia / hot pink
    'Character Card': { bg: '#8b5cf6', icon: '🎭' },    // Vivid violet (distinct from pink)
    'Persona': { bg: '#d946ef', icon: '👤' },           // Magenta / orchid
    'Extensions': { bg: '#1d4ed8', icon: '🔌' },        // Deep vibrant blue
    'Chat History': { bg: '#6366f1', icon: '💬' },      // Indigo
    'System Prompts': { bg: '#ec4899', icon: '⚙️' },    // Pink
    'Example Dialogue': { bg: '#a855f7', icon: '📝' },  // Light purple
    'Other': { bg: '#4f46e5', icon: '📄' },             // Deep indigo
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
    'QUIET_PROMPT': '#0ea5e9',  // Sky blue - quiet/background operations
    'RAW_PROMPT': '#0284c7',    // Darker sky blue - raw direct prompts
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
    let categories = Object.entries(summary.categories);

    // Apply custom category order if set
    if (categoryOrder && categoryOrder.length > 0) {
        categories.sort((a, b) => {
            const aIdx = categoryOrder.indexOf(a[0]);
            const bIdx = categoryOrder.indexOf(b[0]);
            if (aIdx === -1 && bIdx === -1) return 0;
            if (aIdx === -1) return 1;
            if (bIdx === -1) return -1;
            return aIdx - bIdx;
        });
    }

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
    // Calculate effective totals (accounting for exclusions)
    const effectiveTotals = calculateEffectiveTotals();
    const hasExclusions = effectiveTotals.excludedCount > 0;

    centerHole.innerHTML = hasExclusions ? `
        <div style="font-size: 16px; font-weight: 700; color: #10b981;">${effectiveTotals.effective.toLocaleString()}</div>
        <div style="font-size: 9px; opacity: 0.5; text-decoration: line-through;">${summary.totalTokens.toLocaleString()}</div>
        <div style="font-size: 9px; color: #ef4444;">-${effectiveTotals.excluded.toLocaleString()}</div>
    ` : `
        <div style="font-size: 20px; font-weight: 700; color: var(--SmartThemeBodyColor);">${summary.totalTokens.toLocaleString()}</div>
        <div style="font-size: 10px; opacity: 0.7;">tokens</div>
    `;
    chart.appendChild(centerHole);
    chartContainer.appendChild(chart);

    // Legend with drag-to-reorder
    const legend = document.createElement('div');
    legend.style.cssText = 'display: flex; flex-direction: column; gap: 2px; margin-top: 16px;';

    // Drag state for legend items
    let draggedLegendItem = null;
    let draggedCategoryName = null;

    categories.forEach(([name, data], index) => {
        const maxContext = getMaxContextSize();
        const percentOfTotal = ((data.tokens / summary.totalTokens) * 100).toFixed(1);
        const percentOfMax = maxContext > 0 ? ((data.tokens / maxContext) * 100).toFixed(1) : null;
        const color = CATEGORY_COLORS[name]?.bg || '#64748b';
        const icon = CATEGORY_COLORS[name]?.icon || '📄';
        const isExcluded = excludedCategories.has(name);

        // Get next category color for gradient blend
        const nextCategory = categories[index + 1];
        const nextColor = nextCategory ? (CATEGORY_COLORS[nextCategory[0]]?.bg || '#64748b') : color;

        const legendItem = document.createElement('div');
        legendItem.draggable = true;
        legendItem.dataset.categoryName = name;
        // Subtle gradient blend from current color to next color
        const isFirst = index === 0;
        const isLast = index === categories.length - 1;
        legendItem.style.cssText = `
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            background: linear-gradient(180deg, ${color}15 0%, ${nextColor}15 100%);
            border-left: 3px solid ${color};
            border-radius: ${isFirst ? '6px 6px' : '0 0'} ${isLast ? '6px 6px' : '0 0'};
            cursor: grab;
            transition: all 0.2s;
            ${isExcluded ? 'opacity: 0.35;' : ''}
        `;

        // Compact design: clickable color swatch acts as toggle
        // When excluded: show darker/dimmed version of the color
        legendItem.innerHTML = `
            <div class="legend-toggle" title="Click to ${isExcluded ? 'include' : 'exclude'}" style="
                width: 14px;
                height: 14px;
                background: ${isExcluded ? color + '30' : color};
                border: 2px solid ${isExcluded ? color + '50' : color};
                border-radius: 3px;
                cursor: pointer;
                transition: all 0.2s;
                flex-shrink: 0;
            "></div>
            <span style="font-size: 13px;">${icon}</span>
            <span style="flex: 1; font-size: 12px; font-weight: 500; ${isExcluded ? 'text-decoration: line-through;' : ''}">${name}</span>
            <span style="font-size: 11px; opacity: 0.6;">${data.tokens.toLocaleString()}</span>
            <span style="font-size: 10px; background: ${color}25; color: ${color}; padding: 2px 5px; border-radius: 3px; font-weight: 600;">${percentOfTotal}%</span>
        `;

        // Toggle click handler - clicking the swatch toggles exclusion
        const toggle = legendItem.querySelector('.legend-toggle');
        toggle.addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            if (excludedCategories.has(name)) {
                excludedCategories.delete(name);
            } else {
                excludedCategories.add(name);
            }
            modal.remove();
            showTokenItemizer();
        });

        // Drag event handlers for category reordering
        legendItem.addEventListener('dragstart', (e) => {
            draggedLegendItem = legendItem;
            draggedCategoryName = name;
            legendItem.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', name);
        });

        legendItem.addEventListener('dragend', () => {
            legendItem.style.opacity = isExcluded ? '0.4' : '1';
            draggedLegendItem = null;
            draggedCategoryName = null;
            legend.querySelectorAll('[data-category-name]').forEach(el => {
                el.style.borderTop = '';
                el.style.borderBottom = '';
            });
        });

        legendItem.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedLegendItem && draggedLegendItem !== legendItem) {
                const rect = legendItem.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    legendItem.style.borderTop = `2px solid ${color}`;
                    legendItem.style.borderBottom = '';
                } else {
                    legendItem.style.borderTop = '';
                    legendItem.style.borderBottom = `2px solid ${color}`;
                }
            }
        });

        legendItem.addEventListener('dragleave', () => {
            legendItem.style.borderTop = '';
            legendItem.style.borderBottom = '';
        });

        legendItem.addEventListener('drop', (e) => {
            e.preventDefault();
            legendItem.style.borderTop = '';
            legendItem.style.borderBottom = '';

            if (draggedLegendItem && draggedLegendItem !== legendItem) {
                const rect = legendItem.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const insertBefore = e.clientY < midY;

                // Get or create category order
                let currentOrder = categoryOrder ? [...categoryOrder] : categories.map(c => c[0]);

                // Find positions
                const draggedPos = currentOrder.indexOf(draggedCategoryName);
                const targetName = legendItem.dataset.categoryName;
                let targetPos = currentOrder.indexOf(targetName);

                // Remove from old position
                if (draggedPos !== -1) {
                    currentOrder.splice(draggedPos, 1);
                }

                // Find new position
                targetPos = currentOrder.indexOf(targetName);
                const insertPos = insertBefore ? targetPos : targetPos + 1;

                // Insert at new position
                currentOrder.splice(insertPos, 0, draggedCategoryName);

                // Save the new order
                categoryOrder = currentOrder;

                // Refresh modal
                modal.remove();
                showTokenItemizer();
            }
        });

        legendItem.addEventListener('mouseenter', () => {
            if (!isExcluded) legendItem.style.background = `linear-gradient(180deg, ${color}25 0%, ${nextColor}25 100%)`;
        });
        legendItem.addEventListener('mouseleave', () => {
            legendItem.style.background = `linear-gradient(180deg, ${color}15 0%, ${nextColor}15 100%)`;
        });

        legend.appendChild(legendItem);
    });

    chartContainer.appendChild(legend);
    sidebar.appendChild(chartContainer);

    // Tokenizer selector section
    const tokenizerSection = document.createElement('div');
    tokenizerSection.className = 'ck-tokenizer-section';

    const tokenizerHeader = document.createElement('div');
    tokenizerHeader.className = 'ck-tokenizer-header';
    tokenizerHeader.innerHTML = `<span class="ck-tokenizer-header__icon">🔢</span> Tokenizer`;
    tokenizerSection.appendChild(tokenizerHeader);

    // Determine the currently active tokenizer ID
    const activeTokenizerId = getActiveTokenizerId();
    const activeTokenizerName = getSelectedTokenizerName();
    const isOriginalActive = originalTokenizer && activeTokenizerId === originalTokenizer.id;

    // Current tokenizer display
    const currentTokenizerDisplay = document.createElement('div');
    currentTokenizerDisplay.className = 'ck-tokenizer-current';
    currentTokenizerDisplay.innerHTML = `
        <div class="ck-tokenizer-current__name">${activeTokenizerName}</div>
        <div class="ck-tokenizer-current__status ${isOriginalActive ? 'ck-tokenizer-current__status--original' : 'ck-tokenizer-current__status--recalculated'}">
            ${isOriginalActive ? '✓ Original tokenizer' : '↻ Recalculated'}
        </div>
    `;
    tokenizerSection.appendChild(currentTokenizerDisplay);

    // Tokenizer dropdown
    const tokenizerSelect = document.createElement('select');
    tokenizerSelect.className = 'ck-tokenizer-select';

    // Organized list with section headers
    const tokenizerGroups = [
        { label: '─── Tiktoken (OpenAI) ───', disabled: true },
        { id: tokenizers.OPENAI, name: 'OpenAI (cl100k)' },
        { id: tokenizers.GPT2, name: 'GPT-2' },
        { label: '─── SentencePiece ───', disabled: true },
        { id: tokenizers.LLAMA, name: 'LLaMA' },
        { id: tokenizers.LLAMA3, name: 'LLaMA 3' },
        { id: tokenizers.MISTRAL, name: 'Mistral' },
        { id: tokenizers.NEMO, name: 'Mistral Nemo' },
        { id: tokenizers.YI, name: 'Yi' },
        { id: tokenizers.GEMMA, name: 'Gemma' },
        { id: tokenizers.JAMBA, name: 'Jamba' },
        { id: tokenizers.NERD, name: 'NerdStash (Clio)' },
        { id: tokenizers.NERD2, name: 'NerdStash v2 (Kayra)' },
        { label: '─── WebTokenizers ───', disabled: true },
        { id: tokenizers.CLAUDE, name: 'Claude' },
        { id: tokenizers.QWEN2, name: 'Qwen2', needsDownload: true },
        { id: tokenizers.COMMAND_R, name: 'Command R', needsDownload: true },
        { id: tokenizers.COMMAND_A, name: 'Command A' },
        { id: tokenizers.DEEPSEEK, name: 'DeepSeek', needsDownload: true },
        { label: '─── Estimation ───', disabled: true },
        { id: tokenizers.NONE, name: 'None (~3.3 chars/token)' },
    ];

    for (const item of tokenizerGroups) {
        const option = document.createElement('option');
        if (item.disabled) {
            option.disabled = true;
            option.textContent = item.label;
        } else {
            option.value = item.id.toString();
            const isOriginal = originalTokenizer && item.id === originalTokenizer.id;
            let label = item.name;
            if (isOriginal) label += ' ✓';
            if (item.needsDownload) label += ' ↓';
            option.textContent = label;
            if (item.id === activeTokenizerId) option.selected = true;
        }
        tokenizerSelect.appendChild(option);
    }

    // Handle tokenizer change
    tokenizerSelect.addEventListener('change', async () => {
        const value = tokenizerSelect.value;
        const newTokenizer = parseInt(value, 10);

        // Check if user selected the original tokenizer - restore original state
        const isSelectingOriginal = originalTokenizer && newTokenizer === originalTokenizer.id;

        // Show loading state
        tokenizerSelect.disabled = true;
        currentTokenizerDisplay.innerHTML = `
            <div class="ck-tokenizer-current__name">${isSelectingOriginal ? 'Restoring original...' : 'Recalculating...'}</div>
            <div class="ck-tokenizer-current__status">Please wait</div>
        `;

        try {
            if (isSelectingOriginal) {
                // Restore original - set to null so we use originalTokenizer data
                selectedTokenizer = null;
                // Restore original token counts from lastItemization.originalTokenizer
                await restoreOriginalTokenCounts();
            } else {
                selectedTokenizer = newTokenizer;
                await recalculateTokenCounts(newTokenizer);
            }

            // Refresh the modal to show new counts
            modal.remove();
            showTokenItemizer();
        } catch (error) {
            console.error('[Carrot Compass] Failed to recalculate tokens:', error);
            tokenizerSelect.disabled = false;
            currentTokenizerDisplay.innerHTML = `
                <div class="ck-tokenizer-current__name" style="color: #ef4444;">Error</div>
                <div class="ck-tokenizer-current__status">${error.message}</div>
            `;
            toastr.error('Failed to recalculate: ' + error.message, 'Carrot Compass');
        }
    });

    tokenizerSection.appendChild(tokenizerSelect);

    // Help text
    const helpText = document.createElement('div');
    helpText.className = 'ck-tokenizer-help';
    helpText.innerHTML = `
        <span class="ck-tokenizer-help__item ck-tokenizer-help__item--original">✓ original</span>
        <span class="ck-tokenizer-help__item ck-tokenizer-help__item--download">↓ needs download</span>
    `;
    tokenizerSection.appendChild(helpText);

    sidebar.appendChild(tokenizerSection);

    // Context Budget Section
    const maxContext = getMaxContextSize();
    if (maxContext > 0) {
        const budgetSection = document.createElement('div');
        budgetSection.style.cssText = `
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        `;

        // Title with breakdown toggle
        const budgetHeader = document.createElement('div');
        budgetHeader.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;';

        const budgetTitle = document.createElement('div');
        budgetTitle.style.cssText = 'font-weight: 600; font-size: 14px; color: var(--SmartThemeBodyColor); display: flex; align-items: center; gap: 8px;';
        budgetTitle.innerHTML = '<span>📊</span> Context Budget';

        // Breakdown toggle
        const breakdownToggleContainer = document.createElement('div');
        breakdownToggleContainer.style.cssText = 'display: flex; align-items: center; gap: 6px; font-size: 11px; opacity: 0.7;';
        const breakdownToggleBg = showBudgetBreakdown ? '#10b981' : 'rgba(255,255,255,0.2)';
        const breakdownKnob = showBudgetBreakdown ? 'translateX(12px)' : 'translateX(0)';
        breakdownToggleContainer.innerHTML = `
            <span>Breakdown</span>
            <div class="breakdown-toggle" style="
                width: 28px;
                height: 16px;
                background: ${breakdownToggleBg};
                border-radius: 8px;
                position: relative;
                cursor: pointer;
                transition: background 0.2s;
            ">
                <div style="
                    position: absolute;
                    top: 2px;
                    left: 2px;
                    width: 12px;
                    height: 12px;
                    background: white;
                    border-radius: 50%;
                    transition: transform 0.2s;
                    transform: ${breakdownKnob};
                    box-shadow: 0 1px 2px rgba(0,0,0,0.3);
                "></div>
            </div>
        `;

        const breakdownToggle = breakdownToggleContainer.querySelector('.breakdown-toggle');
        breakdownToggle.addEventListener('click', () => {
            showBudgetBreakdown = !showBudgetBreakdown;
            modal.remove();
            showTokenItemizer();
        });

        budgetHeader.appendChild(budgetTitle);
        budgetHeader.appendChild(breakdownToggleContainer);
        budgetSection.appendChild(budgetHeader);

        // Calculate budget values
        const effectiveTokens = hasExclusions ? effectiveTotals.effective : summary.totalTokens;
        const usedPercent = Math.min((effectiveTokens / maxContext) * 100, 100);
        const availableTokens = Math.max(maxContext - effectiveTokens, 0);

        // Determine color based on usage (matches warm palette)
        let usageColor = '#9d4edd'; // Violet (low usage)
        if (usedPercent > 90) usageColor = '#ef4444'; // Red (critical)
        else if (usedPercent > 75) usageColor = '#f97316'; // Orange (warning)
        else if (usedPercent > 50) usageColor = '#c44569'; // Rose (moderate)

        // Budget bar visualization
        const budgetBar = document.createElement('div');
        budgetBar.style.cssText = `
            height: 24px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 12px;
            overflow: hidden;
            position: relative;
            margin-bottom: 12px;
            display: flex;
        `;

        if (showBudgetBreakdown) {
            // Build colored segments for each category
            categories.forEach(([catName, catData]) => {
                const catColor = CATEGORY_COLORS[catName]?.bg || '#64748b';
                const catPercent = (catData.tokens / maxContext) * 100;
                const isExcluded = excludedCategories.has(catName);

                if (catPercent > 0 && !isExcluded) {
                    const segment = document.createElement('div');
                    segment.style.cssText = `
                        height: 100%;
                        width: ${catPercent}%;
                        background: ${catColor};
                        transition: width 0.3s ease;
                        position: relative;
                    `;
                    segment.title = `${catName}: ${catData.tokens.toLocaleString()} tk (${catPercent.toFixed(1)}%)`;
                    budgetBar.appendChild(segment);
                }
            });
        } else {
            // Simple single-color bar
            const usedBar = document.createElement('div');
            usedBar.style.cssText = `
                height: 100%;
                width: ${usedPercent}%;
                background: linear-gradient(90deg, ${usageColor} 0%, ${usageColor}cc 100%);
                border-radius: 12px 0 0 12px;
                transition: width 0.3s ease;
                display: flex;
                align-items: center;
                justify-content: ${usedPercent > 30 ? 'center' : 'flex-end'};
                padding: 0 8px;
            `;
            usedBar.innerHTML = usedPercent > 15 ? `<span style="font-size: 11px; font-weight: 600; color: white;">${usedPercent.toFixed(1)}%</span>` : '';
            budgetBar.appendChild(usedBar);
        }

        budgetSection.appendChild(budgetBar);

        // Budget stats
        const budgetStats = document.createElement('div');
        budgetStats.style.cssText = 'display: flex; flex-direction: column; gap: 6px; font-size: 12px;';

        if (showBudgetBreakdown) {
            // Show individual category breakdown with percentages of max context
            let breakdownHTML = '';
            categories.forEach(([catName, catData]) => {
                const catColor = CATEGORY_COLORS[catName]?.bg || '#64748b';
                const catPercent = ((catData.tokens / maxContext) * 100).toFixed(2);
                const isExcluded = excludedCategories.has(catName);
                if (!isExcluded && catData.tokens > 0) {
                    breakdownHTML += `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="display: flex; align-items: center; gap: 6px;">
                                <span style="width: 8px; height: 8px; background: ${catColor}; border-radius: 2px;"></span>
                                <span style="opacity: 0.8;">${catName}</span>
                            </span>
                            <span style="font-weight: 500; color: ${catColor};">${catPercent}%</span>
                        </div>
                    `;
                }
            });
            breakdownHTML += `
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 6px; margin-top: 4px; border-top: 1px solid rgba(255,255,255,0.1);">
                    <span style="opacity: 0.7;">Total Used</span>
                    <span style="font-weight: 600; color: ${usageColor};">${usedPercent.toFixed(2)}%</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="opacity: 0.7;">Available</span>
                    <span style="font-weight: 600; color: #10b981;">${(100 - usedPercent).toFixed(2)}%</span>
                </div>
            `;
            budgetStats.innerHTML = breakdownHTML;
        } else {
            // Simple used/available/max view
            budgetStats.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="opacity: 0.7;">Used</span>
                    <span style="font-weight: 600; color: ${usageColor};">${effectiveTokens.toLocaleString()} tk (${usedPercent.toFixed(1)}%)</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="opacity: 0.7;">Available</span>
                    <span style="font-weight: 600; color: #10b981;">${availableTokens.toLocaleString()} tk</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
                    <span style="opacity: 0.7;">Max Context</span>
                    <span style="font-weight: 500;">${maxContext.toLocaleString()} tk</span>
                </div>
            `;
        }
        budgetSection.appendChild(budgetStats);

        sidebar.appendChild(budgetSection);
    }

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

        // Category header (collapsible)
        const isCategoryExcluded = excludedCategories.has(categoryName);
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
            cursor: pointer;
            user-select: none;
            transition: background 0.2s;
            ${isCategoryExcluded ? 'opacity: 0.5;' : ''}
        `;

        // No toggle here - use sidebar for category exclusion. Just collapse icon + info
        categoryHeader.innerHTML = `
            <span class="category-collapse-icon" style="font-size: 10px; opacity: 0.6; transition: transform 0.2s;">▼</span>
            <span style="font-size: 18px;">${categoryIcon}</span>
            <span style="flex: 1; font-weight: 600; font-size: 14px; color: var(--SmartThemeBodyColor); ${isCategoryExcluded ? 'text-decoration: line-through;' : ''}">${categoryName}</span>
            <span style="background: ${categoryColor}; color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                ${categoryData.tokens.toLocaleString()} tokens
            </span>
            <span style="font-size: 12px; opacity: 0.7;">${categoryData.sections.length} section${categoryData.sections.length !== 1 ? 's' : ''}</span>
        `;

        // Hover effect
        categoryHeader.addEventListener('mouseenter', () => {
            if (!isCategoryExcluded) categoryHeader.style.background = `${categoryColor}25`;
        });
        categoryHeader.addEventListener('mouseleave', () => {
            categoryHeader.style.background = `${categoryColor}15`;
        });

        categorySection.appendChild(categoryHeader);

        // Sections within category
        const sectionsContainer = document.createElement('div');
        sectionsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 8px; padding-left: 20px;';

        // Use default section order (no custom ordering for individual sections)
        const orderedSections = [...categoryData.sections];

        orderedSections.forEach((section, sectionIdx) => {
            const tagColor = TAG_COLORS[section.tag] || categoryColor;
            // Find the global section index in lastItemization.sections
            const globalIdx = lastItemization.sections.findIndex(s => s === section);
            const isSectionExcluded = excludedSections.has(globalIdx) || isCategoryExcluded;

            const sectionEl = document.createElement('div');
            sectionEl.className = 'ck-itemizer-section';
            sectionEl.style.cssText = `
                background: rgba(255, 255, 255, 0.03);
                border: 1px solid rgba(255, 255, 255, 0.05);
                border-left: 3px solid ${tagColor};
                border-radius: 8px;
                overflow: hidden;
                transition: all 0.2s;
                ${isSectionExcluded ? 'opacity: 0.4;' : ''}
            `;

            // Section header - name prominent, UUID as subtle subtext
            const sectionHeader = document.createElement('div');
            sectionHeader.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                cursor: pointer;
                user-select: none;
            `;

            // Check if tag looks like a UUID (show it small) vs a readable tag (show it as badge)
            const isUUID = /^[A-F0-9]{8}_[A-F0-9]{4}_[A-F0-9]{4}_[A-F0-9]{4}_[A-F0-9]{12}$/.test(section.tag);

            // Check if this is a WI entry - use wiPosition from section data if available
            const isWI = section.isWorldInfo || section.tag.startsWith('WI_');
            const wiPositionBadge = section.wiPosition || (isWI ? section.tag.substring(3).replace(/_/g, ' ') : null);

            // No toggle boxes - use right-click/long-press for exclusion
            sectionHeader.innerHTML = `
                <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
                    <span style="font-size: 13px; font-weight: 600; color: var(--SmartThemeBodyColor); ${isSectionExcluded ? 'text-decoration: line-through;' : ''}">${section.name}</span>
                    ${isUUID ? `<span style="font-size: 9px; opacity: 0.4; font-family: monospace; letter-spacing: -0.5px;">${section.tag.toLowerCase().replace(/_/g, '-')}</span>` : ''}
                </div>
                ${wiPositionBadge ? `<span style="
                    background: ${tagColor}40;
                    color: ${tagColor};
                    padding: 3px 8px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                    border: 1px solid ${tagColor}60;
                ">${wiPositionBadge}</span>` : ''}
                ${!isUUID && !isWI ? `<span style="
                    background: ${tagColor};
                    color: white;
                    padding: 3px 6px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 600;
                    text-transform: uppercase;
                    letter-spacing: 0.3px;
                ">${section.tag}</span>` : ''}
                ${section.role ? `<span style="font-size: 10px; opacity: 0.5; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">${section.role}</span>` : ''}
                <span style="font-size: 12px; font-weight: 600; color: ${tagColor};">${section.tokens.toLocaleString()} tk</span>
                <span class="expand-icon" style="opacity: 0.4; transition: transform 0.2s; font-size: 10px;">▼</span>
            `;

            // Right-click context menu for exclusion
            sectionEl.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (excludedSections.has(globalIdx)) {
                    excludedSections.delete(globalIdx);
                } else {
                    excludedSections.add(globalIdx);
                }
                modal.remove();
                showTokenItemizer();
            });

            // Long-press for mobile/tablet (500ms hold)
            let longPressTimer = null;
            sectionEl.addEventListener('touchstart', (e) => {
                longPressTimer = setTimeout(() => {
                    e.preventDefault();
                    if (excludedSections.has(globalIdx)) {
                        excludedSections.delete(globalIdx);
                    } else {
                        excludedSections.add(globalIdx);
                    }
                    modal.remove();
                    showTokenItemizer();
                }, 500);
            });
            sectionEl.addEventListener('touchend', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });
            sectionEl.addEventListener('touchmove', () => {
                if (longPressTimer) {
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            });

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

            // Toggle collapse - use expandedSections to persist state across rebuilds
            const isExpanded = expandedSections.has(globalIdx);
            sectionContent.style.display = isExpanded ? 'block' : 'none';
            sectionHeader.querySelector('.expand-icon').style.transform = isExpanded ? 'rotate(180deg)' : 'rotate(0)';
            sectionEl.style.background = isExpanded ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)';

            sectionHeader.addEventListener('click', () => {
                const nowExpanded = !expandedSections.has(globalIdx);
                if (nowExpanded) {
                    expandedSections.add(globalIdx);
                } else {
                    expandedSections.delete(globalIdx);
                }
                sectionContent.style.display = nowExpanded ? 'block' : 'none';
                sectionHeader.querySelector('.expand-icon').style.transform = nowExpanded ? 'rotate(180deg)' : 'rotate(0)';
                sectionEl.style.background = nowExpanded ? 'rgba(255, 255, 255, 0.06)' : 'rgba(255, 255, 255, 0.03)';
            });

            sectionEl.appendChild(sectionHeader);
            sectionEl.appendChild(sectionContent);
            sectionsContainer.appendChild(sectionEl);
        });

        categorySection.appendChild(sectionsContainer);

        // Category collapse toggle - use collapsedCategories to persist state across rebuilds
        const isCategoryCollapsed = collapsedCategories.has(categoryName);
        sectionsContainer.style.display = isCategoryCollapsed ? 'none' : 'flex';
        const collapseIcon = categoryHeader.querySelector('.category-collapse-icon');
        if (collapseIcon) {
            collapseIcon.style.transform = isCategoryCollapsed ? 'rotate(-90deg)' : 'rotate(0)';
        }
        categoryHeader.style.marginBottom = isCategoryCollapsed ? '0' : '12px';

        categoryHeader.addEventListener('click', () => {
            const nowCollapsed = !collapsedCategories.has(categoryName);
            if (nowCollapsed) {
                collapsedCategories.add(categoryName);
            } else {
                collapsedCategories.delete(categoryName);
            }
            sectionsContainer.style.display = nowCollapsed ? 'none' : 'flex';
            const icon = categoryHeader.querySelector('.category-collapse-icon');
            if (icon) {
                icon.style.transform = nowCollapsed ? 'rotate(-90deg)' : 'rotate(0)';
            }
            categoryHeader.style.marginBottom = nowCollapsed ? '0' : '12px';
        });

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

    const buttonStyle = `
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: var(--SmartThemeBodyColor);
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 12px;
        transition: background 0.2s;
    `;

    // Helper to get raw prompt text from itemization
    const getRawPromptFromItemization = () => {
        if (!lastItemization?.sections) return '';
        return lastItemization.sections
            .map(s => s.content || '')
            .filter(c => c.length > 0)
            .join('\n\n');
    };

    // Helper to download file
    const downloadFile = (content, prefix, ext) => {
        const mimeType = ext === 'json' ? 'application/json' : 'text/plain';
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${prefix}-${Date.now()}.${ext}`;
        a.click();
        URL.revokeObjectURL(url);
        toastr.success('Exported!', 'Carrot Compass');
    };

    // Copy JSON button
    const copyJsonBtn = document.createElement('button');
    copyJsonBtn.innerHTML = '📋 Copy JSON';
    copyJsonBtn.title = 'Copy itemization data with full metadata';
    copyJsonBtn.style.cssText = buttonStyle;
    copyJsonBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(JSON.stringify(lastItemization, null, 2)).then(() => {
            toastr.success('JSON copied to clipboard!', 'Carrot Compass');
        });
    });

    // Copy Raw button
    const copyRawBtn = document.createElement('button');
    copyRawBtn.innerHTML = '📄 Copy Raw';
    copyRawBtn.title = 'Copy just the prompt text (no metadata)';
    copyRawBtn.style.cssText = buttonStyle;
    copyRawBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(getRawPromptFromItemization()).then(() => {
            toastr.success('Raw prompt copied!', 'Carrot Compass');
        });
    });

    // Export dropdown
    const exportBtn = document.createElement('button');
    exportBtn.innerHTML = '📥 Export';
    exportBtn.title = 'Export to file';
    exportBtn.style.cssText = buttonStyle;

    const exportMenu = document.createElement('div');
    exportMenu.style.cssText = `
        position: absolute;
        bottom: 100%;
        right: 0;
        margin-bottom: 4px;
        background: var(--SmartThemeBlurTintColor, #1a1a2e);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        overflow: hidden;
        display: none;
        min-width: 160px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    `;

    const menuItemStyle = `
        padding: 10px 14px;
        cursor: pointer;
        font-size: 12px;
        color: var(--SmartThemeBodyColor);
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background 0.15s;
    `;

    const exportJson = document.createElement('div');
    exportJson.innerHTML = '📋 With Metadata (.json)';
    exportJson.style.cssText = menuItemStyle;
    exportJson.addEventListener('mouseenter', () => exportJson.style.background = 'rgba(255,255,255,0.1)');
    exportJson.addEventListener('mouseleave', () => exportJson.style.background = 'transparent');
    exportJson.addEventListener('click', () => {
        downloadFile(JSON.stringify(lastItemization, null, 2), 'token-itemization', 'json');
        exportMenu.style.display = 'none';
    });

    const exportRaw = document.createElement('div');
    exportRaw.innerHTML = '📄 Raw Prompt (.txt)';
    exportRaw.style.cssText = menuItemStyle;
    exportRaw.addEventListener('mouseenter', () => exportRaw.style.background = 'rgba(255,255,255,0.1)');
    exportRaw.addEventListener('mouseleave', () => exportRaw.style.background = 'transparent');
    exportRaw.addEventListener('click', () => {
        downloadFile(getRawPromptFromItemization(), 'prompt-raw', 'txt');
        exportMenu.style.display = 'none';
    });

    exportMenu.appendChild(exportJson);
    exportMenu.appendChild(exportRaw);

    const exportWrapper = document.createElement('div');
    exportWrapper.style.cssText = 'position: relative;';
    exportWrapper.appendChild(exportBtn);
    exportWrapper.appendChild(exportMenu);

    exportBtn.addEventListener('click', () => {
        exportMenu.style.display = exportMenu.style.display === 'none' ? 'block' : 'none';
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!exportWrapper.contains(e.target)) {
            exportMenu.style.display = 'none';
        }
    });

    // Reset button (only show if there are customizations)
    const hasCustomizations = excludedSections.size > 0 || excludedCategories.size > 0 || categoryOrder !== null || showBudgetBreakdown;
    if (hasCustomizations) {
        const resetBtn = document.createElement('button');
        resetBtn.innerHTML = '↺ Reset';
        resetBtn.title = 'Reset exclusions and custom ordering';
        resetBtn.style.cssText = buttonStyle + 'background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4);';
        resetBtn.addEventListener('click', () => {
            resetExclusions();
            modal.remove();
            showTokenItemizer();
        });
        footerActions.appendChild(resetBtn);
    }

    footerActions.appendChild(copyJsonBtn);
    footerActions.appendChild(copyRawBtn);
    footerActions.appendChild(exportWrapper);

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
        selectedTokenizer: selectedTokenizer,
        selectedTokenizerName: getSelectedTokenizerName(),
    };
}

/**
 * Get available tokenizers for external use
 * @returns {Array<{id: number, key: string, name: string}>}
 */
export function getAvailableTokenizers() {
    return [...AVAILABLE_TOKENIZERS];
}

/**
 * Set the tokenizer to use for token counting
 * @param {number|null} tokenizerId - Tokenizer ID or null for ST default
 */
export function setTokenizer(tokenizerId) {
    selectedTokenizer = tokenizerId;
}

/**
 * Get currently selected tokenizer
 * @returns {number|null}
 */
export function getSelectedTokenizer() {
    return selectedTokenizer;
}

// Export utilities
export { wrap, parseMarkers, stripMarkers, DISPLAY_NAMES, AVAILABLE_TOKENIZERS };
