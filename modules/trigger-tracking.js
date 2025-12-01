// =============================================================================
// TRIGGER TRACKING - Log Parsing & Trigger Classification
// Accurate trigger tracking via console.debug capture and entry analysis
// =============================================================================

import { event_types, eventSource } from '../../../../../script.js';

// =============================================================================
// STATE VARIABLES
// =============================================================================

/** Deep tracking data for activated entries */
const deepTriggerData = new Map();

/** Recursion chain tracking */
const recursionChain = new Map();

/** Probability results (deprecated) */
const probabilityResults = new Map();

/** Current scan state */
let currentScanState = {
    active: false,
    recursionLevel: 0,
    entriesThisLoop: [],
};

/** Log capture state */
let logBuffer = [];
let originalConsoleDebug = null;
let isCapturing = false;

// =============================================================================
// LOG CAPTURE FUNCTIONS
// =============================================================================

/**
 * Start capturing console.debug logs (call at GENERATION_STARTED)
 */
function startLogCapture() {
    if (isCapturing) return;

    logBuffer = [];
    originalConsoleDebug = console.debug;
    isCapturing = true;

    console.debug = function(...args) {
        // Buffer WI-related logs
        if (typeof args[0] === 'string' && args[0].startsWith('[WI]')) {
            logBuffer.push({ args: [...args], timestamp: Date.now() });
        }
        // Always call original
        originalConsoleDebug.apply(console, args);
    };

    console.debug('[Carrot Compass] Log capture started');
}

/**
 * Stop capturing and restore original console.debug
 */
function stopLogCapture() {
    if (!isCapturing) return;

    if (originalConsoleDebug) {
        console.debug = originalConsoleDebug;
        originalConsoleDebug = null;
    }
    isCapturing = false;
}

/**
 * Parse buffered logs to extract matched keywords for specific UIDs
 * Called AFTER WORLDINFO_SCAN_DONE when we know which entries activated
 * @param {Set<number>} activatedUids - UIDs of entries that activated this loop
 * @returns {Map<number, object>} uid -> { matchedKeyword, keywordType, logReason }
 */
function parseBufferedLogs(activatedUids) {
    const results = new Map();

    for (const { args } of logBuffer) {
        const logText = args.filter(a => typeof a === 'string').join(' ');

        // Extract UID from log
        const uidMatch = logText.match(/\[WI\]\s*Entry\s+(\d+)/);
        if (!uidMatch) continue;

        const uid = parseInt(uidMatch[1]);
        if (!activatedUids.has(uid)) continue;

        // Already found info for this UID? Skip
        if (results.has(uid) && results.get(uid).matchedKeyword) continue;

        let info = results.get(uid) || {};

        // Parse activation reason and extract matched keyword
        if (logText.includes('activated by primary key match')) {
            const keyword = args.find((a, i) =>
                typeof a === 'string' &&
                i > 0 &&
                !a.startsWith('[WI]') &&
                !a.includes('activated by'),
            );
            info.matchedKeyword = keyword || null;
            info.keywordType = 'primary';
            info.logReason = 'primary_key_match';
        }
        else if (/activated\.\s*\(AND ANY\)/i.test(logText)) {
            const keyword = args.find((a, i) =>
                typeof a === 'string' &&
                i > 0 &&
                !a.startsWith('[WI]') &&
                !a.includes('activated') &&
                !a.includes('Found match'),
            );
            info.matchedKeyword = keyword || null;
            info.keywordType = 'secondary';
            info.logReason = 'secondary_and_any';
        }
        else if (/activated\.\s*\(NOT ALL\)/i.test(logText)) {
            info.keywordType = 'secondary';
            info.logReason = 'secondary_not_all';
        }
        else if (/activated\.\s*\(NOT ANY\)/i.test(logText)) {
            info.keywordType = 'secondary';
            info.logReason = 'secondary_not_any';
        }
        else if (/activated\.\s*\(AND ALL\)/i.test(logText)) {
            info.keywordType = 'secondary';
            info.logReason = 'secondary_and_all';
        }
        else if (logText.includes('activated because of constant')) {
            info.logReason = 'constant';
        }
        else if (logText.includes('activated because active sticky')) {
            info.logReason = 'sticky';
        }
        else if (logText.includes('@@activate decorator')) {
            info.logReason = 'decorator';
        }
        else if (logText.includes('externally activated')) {
            info.logReason = 'vector';
        }

        if (Object.keys(info).length > 0) {
            results.set(uid, info);
        }
    }

    return results;
}

// =============================================================================
// TRIGGER REASON DETECTION
// =============================================================================

/**
 * Determine trigger reason from entry properties (fallback when logs don't have it)
 * @param {object} entry The worldbook entry
 * @param {object} timedEffects The timed effects manager from ST
 * @returns {object} { reason: string, confident: boolean }
 */
export function determineTriggerReason(entry, timedEffects = null) {
    // 1. Constant entries - always activate
    if (entry.constant === true) {
        return { reason: 'constant', confident: true };
    }

    // 2. Vectorized/RAG entries
    if (entry.vectorized === true) {
        return { reason: 'vector', confident: true };
    }

    // 3. @@activate decorator
    if (entry.decorators && entry.decorators.includes('@@activate')) {
        return { reason: 'decorator', confident: true };
    }

    // 4. Sticky entries
    if (timedEffects && typeof timedEffects.isEffectActive === 'function') {
        if (timedEffects.isEffectActive('sticky', entry)) {
            return { reason: 'sticky', confident: true };
        }
    } else if (entry.sticky && entry.sticky > 0) {
        return { reason: 'sticky', confident: true };
    }

    // 5. Has keys - must have been triggered by key match
    const hasKeys = (entry.key && entry.key.length > 0) ||
                    (entry.keysecondary && entry.keysecondary.length > 0);
    if (hasKeys) {
        if (entry.selective && entry.keysecondary && entry.keysecondary.length > 0) {
            return { reason: 'key_match_selective', confident: true };
        }
        return { reason: 'key_match', confident: true };
    }

    return { reason: 'activated', confident: false };
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Setup WORLDINFO_SCAN_DONE listener - THE source of truth
 */
function setupScanDoneTracking() {
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, (args) => {
        const { state, new: newEntries, timedEffects } = args;

        const recursionLevel = Math.max(0, state.loopCount - 1);

        if (newEntries.successful && newEntries.successful.length > 0) {
            const activatedUids = new Set(newEntries.successful.map(e => e.uid));
            const logData = parseBufferedLogs(activatedUids);

            for (const entry of newEntries.successful) {
                const parsed = logData.get(entry.uid) || {};

                let reason = parsed.logReason;
                let confident = !!reason;

                if (!reason) {
                    const fallback = determineTriggerReason(entry, timedEffects);
                    reason = fallback.reason;
                    confident = fallback.confident;
                }

                deepTriggerData.set(entry.uid, {
                    uid: entry.uid,
                    timestamp: Date.now(),
                    recursionLevel: recursionLevel,
                    reason: reason,
                    confident: confident,
                    scanState: state.current,
                    loopCount: state.loopCount,
                    matchedKeyword: parsed.matchedKeyword || null,
                    keywordType: parsed.keywordType || null,
                    entryName: entry.comment || entry.uid,
                    world: entry.world,
                    primaryKeys: entry.key || [],
                    secondaryKeys: entry.keysecondary || [],
                    selectiveLogic: entry.selectiveLogic,
                    stickyDuration: entry.sticky || 0,
                    cooldown: entry.cooldown || 0,
                });

                if (state.loopCount > 1) {
                    const previousLoopEntries = currentScanState.entriesThisLoop || [];
                    recursionChain.set(entry.uid, {
                        triggeredBy: previousLoopEntries.map(e => e.uid),
                        level: recursionLevel,
                    });
                }
            }

            currentScanState.entriesThisLoop = [...newEntries.successful];
            logBuffer = [];
        }

        currentScanState.recursionLevel = recursionLevel;

        if (state.next === 0) {
            stopLogCapture();
            currentScanState.active = false;
        }
    });
}

/**
 * Setup generation tracking hooks
 */
function setupGenerationTracking() {
    eventSource.on(event_types.GENERATION_STARTED, () => {
        deepTriggerData.clear();
        recursionChain.clear();
        logBuffer = [];
        currentScanState = { active: true, recursionLevel: 0, entriesThisLoop: [] };
        startLogCapture();
    });

    eventSource.on(event_types.GENERATION_ENDED, () => {
        stopLogCapture();
    });
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get deep trigger info for an entry
 * @param {number} uid Entry UID
 * @returns {object|null}
 */
export function getDeepTriggerInfo(uid) {
    return deepTriggerData.get(uid) || null;
}

/**
 * Get recursion chain info for an entry
 * @param {number} uid Entry UID
 * @returns {object|null}
 */
export function getRecursionChain(uid) {
    return recursionChain.get(uid) || null;
}

/**
 * Get probability result (deprecated - always returns null)
 * @param {number} uid Entry UID
 * @returns {null}
 */
export function getProbabilityResult(uid) {
    return null;
}

/**
 * Get trigger reason for an entry
 * @param {object} entry The worldbook entry
 * @returns {string} Trigger reason
 */
export function getTriggerReason(entry) {
    const deepInfo = getDeepTriggerInfo(entry.uid);
    if (deepInfo && deepInfo.reason) {
        return deepInfo.reason;
    }
    const result = determineTriggerReason(entry, null);
    return result.reason;
}

/**
 * Get enhanced trigger details for an entry
 * @param {object} entry The worldbook entry
 * @returns {object} Enhanced trigger details
 */
export function getEnhancedTriggerDetails(entry) {
    const deepInfo = getDeepTriggerInfo(entry.uid);
    const chainInfo = getRecursionChain(entry.uid);

    if (deepInfo) {
        return {
            reason: deepInfo.reason,
            confident: deepInfo.confident,
            recursionLevel: deepInfo.recursionLevel || 0,
            loopCount: deepInfo.loopCount || 1,
            triggeredBy: chainInfo?.triggeredBy || [],
            isRecursive: (deepInfo.recursionLevel || 0) > 0,
            matchedKeyword: deepInfo.matchedKeyword || null,
            keywordType: deepInfo.keywordType || null,
            primaryKeys: deepInfo.primaryKeys || [],
            secondaryKeys: deepInfo.secondaryKeys || [],
            selectiveLogic: deepInfo.selectiveLogic,
            stickyDuration: deepInfo.stickyDuration || 0,
            cooldown: deepInfo.cooldown || 0,
            world: deepInfo.world,
            entryName: deepInfo.entryName,
        };
    }

    const triggerResult = determineTriggerReason(entry, null);
    return {
        reason: triggerResult.reason,
        confident: triggerResult.confident,
        recursionLevel: 0,
        loopCount: 1,
        triggeredBy: chainInfo?.triggeredBy || [],
        isRecursive: false,
        matchedKeyword: null,
        keywordType: null,
        primaryKeys: entry.key || [],
        secondaryKeys: entry.keysecondary || [],
        selectiveLogic: entry.selectiveLogic,
        stickyDuration: entry.sticky || 0,
        cooldown: entry.cooldown || 0,
        world: entry.world,
        entryName: entry.comment || entry.uid,
    };
}

/**
 * Classify trigger reason (wrapper for getTriggerReason)
 */
export function classifyTriggerReasonFromEntry(entry, contextData = {}) {
    return getTriggerReason(entry);
}

/**
 * Analyze entry settings/properties
 * @param {object} entry The worldbook entry
 * @returns {object} Entry settings breakdown
 */
export function analyzeEntrySettings(entry) {
    return {
        recursion: {
            delayUntilRecursion: entry.delayUntilRecursion,
            excludeRecursion: entry.excludeRecursion,
            preventRecursion: entry.preventRecursion,
        },
        scanning: {
            scanPersona: entry.scanPersona,
            scanCharacter: entry.scanCharacter,
            scanStory: entry.scanStory,
            scanAuthorNote: entry.scanAuthorNote || entry.scanAN,
            scanDepth: entry.scanDepth,
        },
        activation: {
            probability: entry.probability,
            group: entry.group,
            caseSensitive: entry.caseSensitive,
            selectiveLogic: entry.selectiveLogic,
        },
        positioning: {
            position: entry.position,
            depth: entry.depth,
            order: entry.order,
        },
    };
}

/**
 * Classify trigger type from analysis
 */
export function classifyTriggerType(entry, triggerAnalysis) {
    if (triggerAnalysis.triggeringMessages?.some(msg =>
        msg.messageSource === 'worldbook_content' ||
        msg.preview?.includes('[Lorebook]') ||
        msg.preview?.includes('Lorebook:'),
    )) {
        return 'recursive';
    }

    if (triggerAnalysis.triggerReason === 'decorator_activate') return 'forced';
    if (triggerAnalysis.triggerReason === 'decorator_suppress') return 'suppressed';
    if (triggerAnalysis.triggerReason === 'constant') return 'constant';
    if (triggerAnalysis.triggerReason === 'rag') return 'vector';
    if (triggerAnalysis.triggerReason === 'sticky_active') return 'sticky';
    if (triggerAnalysis.triggerReason === 'persona_trigger') return 'persona';
    if (triggerAnalysis.triggerReason === 'character_trigger') return 'character';
    if (triggerAnalysis.triggerReason === 'scenario_trigger') return 'scenario';

    if (triggerAnalysis.triggeringMessages?.length > 0) {
        const lastMsg = triggerAnalysis.lastMessage;
        if (lastMsg?.messageSource === 'system_injection') return 'system';
        if (lastMsg?.messageSource === 'authors_note') return 'authors_note';
        if (lastMsg?.messageSource === 'user_message') return 'user';
        if (lastMsg?.messageSource === 'character_message') return 'character';
    }

    return 'normal';
}

/**
 * Enhanced trigger source analysis
 * @param {object} entry The worldbook entry
 * @param {Array} recentMessages Recent chat messages
 * @returns {object} Analysis results
 */
export function analyzeTriggerSource(entry, recentMessages) {
    const analysis = {
        matchedKeys: [],
        triggeringMessages: [],
        lastMessage: null,
        allMatches: [],
        triggerReason: 'normal',
        triggerSource: 'unknown',
        triggerDetails: {},
    };

    // Check decorators
    if (entry.decorators && Array.isArray(entry.decorators)) {
        if (entry.decorators.includes('@@activate')) {
            analysis.triggerReason = 'decorator_activate';
            analysis.triggerSource = 'decorator';
            analysis.triggerDetails = { decorator: '@@activate', note: 'Force activated' };
            return analysis;
        }
        if (entry.decorators.includes('@@dont_activate')) {
            analysis.triggerReason = 'decorator_suppress';
            analysis.triggerSource = 'decorator';
            analysis.triggerDetails = { decorator: '@@dont_activate', note: 'Suppressed' };
            return analysis;
        }
    }

    // Check constant
    if (entry.constant === true) {
        analysis.triggerReason = 'constant';
        analysis.triggerSource = 'constant';
        analysis.triggerDetails = { note: 'Always active' };
        return analysis;
    }

    // Check vectorized
    if (entry.vectorized === true) {
        analysis.triggerReason = 'rag';
        analysis.triggerSource = 'vectorized';
        analysis.triggerDetails = { note: 'RAG/Vector activation' };
        return analysis;
    }

    // Check sticky
    if (entry.sticky && entry.sticky > 0) {
        analysis.triggerReason = 'sticky_active';
        analysis.triggerSource = 'sticky';
        analysis.triggerDetails = { stickyTurns: entry.sticky };
        return analysis;
    }

    // Check scanning contexts
    if (entry.matchPersonaDescription) {
        analysis.triggerReason = 'persona_trigger';
        analysis.triggerSource = 'persona';
    }
    if (entry.matchCharacterDescription) {
        analysis.triggerReason = 'character_trigger';
        analysis.triggerSource = 'character_card';
    }
    if (entry.matchScenario) {
        analysis.triggerReason = 'scenario_trigger';
        analysis.triggerSource = 'scenario';
    }

    if (!entry.key || !Array.isArray(entry.key) || entry.key.length === 0) {
        return { ...analysis, error: 'Entry has no keys defined' };
    }

    // Check messages for matches
    recentMessages.forEach((msg, index) => {
        if (!msg.mes) return;

        const messageContent = msg.mes.toLowerCase();
        const matchedKeysInMsg = [];

        entry.key.forEach(key => {
            if (key.startsWith('/') && key.endsWith('/')) {
                try {
                    const regex = new RegExp(key.slice(1, -1), 'gi');
                    const matches = [...messageContent.matchAll(regex)];
                    if (matches.length > 0) {
                        matchedKeysInMsg.push({ key, type: 'regex', matches: matches.map(m => m[0]) });
                    }
                } catch (e) {
                    if (messageContent.includes(key.toLowerCase())) {
                        matchedKeysInMsg.push({ key, type: 'literal_fallback', matches: [key] });
                    }
                }
            } else {
                if (messageContent.includes(key.toLowerCase())) {
                    matchedKeysInMsg.push({ key, type: 'literal', matches: [key] });
                }
            }
        });

        if (matchedKeysInMsg.length > 0) {
            let messageSource = 'chat_message';
            if (msg.is_system) messageSource = 'system_message';
            else if (msg.is_user) messageSource = 'user_message';
            else if (msg.name) messageSource = 'character_message';

            if (msg.mes.includes('System:')) messageSource = 'system_injection';
            else if (msg.mes.includes('Author\'s Note:')) messageSource = 'authors_note';
            else if (msg.mes.includes('Lorebook:')) messageSource = 'worldbook_content';

            analysis.triggeringMessages.push({
                index: recentMessages.length - 1 - index,
                sender: msg.name,
                isSystem: msg.is_system,
                preview: msg.mes.substring(0, 100) + (msg.mes.length > 100 ? '...' : ''),
                matchedKeys: matchedKeysInMsg,
                messageSource,
            });

            analysis.allMatches.push(...matchedKeysInMsg);

            if (index === recentMessages.length - 1) {
                analysis.lastMessage = { sender: msg.name, isSystem: msg.is_system, matchedKeys: matchedKeysInMsg, messageSource };
            }

            if (!analysis.triggerSource || analysis.triggerSource === 'unknown') {
                analysis.triggerSource = messageSource;
            }
        }
    });

    analysis.matchedKeys = [...new Set(analysis.allMatches.map(m => m.key))];
    return analysis;
}

/**
 * Get icon for message source
 */
export function getMessageSourceIcon(messageSource) {
    const icons = {
        'user_message': '👤',
        'character_message': '🎭',
        'system_message': '⚙️',
        'system_injection': '💉',
        'authors_note': '📝',
        'worldbook_content': '📚',
        'chat_message': '💬',
    };
    return icons[messageSource] || '❓';
}

/**
 * Get raw tracking data for debugging
 */
export function getDeepTriggerDataRaw() {
    return deepTriggerData;
}

export function getRecursionChainRaw() {
    return recursionChain;
}

export function getProbabilityResultsRaw() {
    return probabilityResults;
}

/**
 * Initialize trigger tracking system
 */
export function initTriggerTracking() {
    setupScanDoneTracking();
    setupGenerationTracking();
    console.log('[Carrot Compass] Trigger tracking system initialized');
}
