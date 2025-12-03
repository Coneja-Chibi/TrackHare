// =============================================================================
// TRIGGER TRACKING - Aggressive log parsing for recursion level detection
// Captures [WI] logs to determine which loop each entry activated in
// =============================================================================

import { event_types, eventSource } from '../../../../../script.js';

// =============================================================================
// STATE VARIABLES
// =============================================================================

/** Deep tracking data for activated entries - uid -> tracking info */
const deepTriggerData = new Map();

/** Recursion chain tracking - uid -> { level, triggeredBy } */
const recursionChain = new Map();

/** Current loop being processed */
let currentLoop = 0;

/** Entries activated in each loop - loop# -> Set of uids */
const entriesByLoop = new Map();

/** Log buffer for parsing */
let logBuffer = [];
let originalConsoleDebug = null;
let isCapturing = false;

// =============================================================================
// LOG CAPTURE - Aggressive parsing of [WI] logs
// =============================================================================

/**
 * Start capturing console.debug logs
 */
function startLogCapture() {
    if (isCapturing) return;

    // Reset state
    logBuffer = [];
    currentLoop = 0;
    entriesByLoop.clear();
    deepTriggerData.clear();
    recursionChain.clear();

    originalConsoleDebug = console.debug;
    isCapturing = true;

    console.debug = function (...args) {
        // Check if it's a WI log
        const firstArg = args[0];
        if (typeof firstArg === 'string' && firstArg.startsWith('[WI]')) {
            processWILog(args);
        }
        // Always call original
        originalConsoleDebug.apply(console, args);
    };

    console.debug('[TrackHare] Log capture started');
}

/**
 * Process a [WI] log line in real-time
 */
function processWILog(args) {
    const logText = args.map(a => typeof a === 'string' ? a : '').join(' ');

    // Detect loop start: "[WI] --- LOOP #X START ---"
    const loopMatch = logText.match(/\[WI\] --- LOOP #(\d+) START ---/);
    if (loopMatch) {
        currentLoop = parseInt(loopMatch[1], 10);
        if (!entriesByLoop.has(currentLoop)) {
            entriesByLoop.set(currentLoop, new Set());
        }
        console.debug(`[TrackHare] Detected loop #${currentLoop}`);
        return;
    }

    // Detect entry activation: "[WI] Entry XXX activated..."
    // The log format is: log('activated by...') which becomes console.debug('[WI] Entry {uid}', 'activated by...')
    const entryMatch = logText.match(/\[WI\] Entry (\d+)/);
    if (entryMatch && logText.includes('activated')) {
        const uid = parseInt(entryMatch[1], 10);
        const level = Math.max(0, currentLoop - 1); // Loop 1 = L0, Loop 2 = L1, etc.

        // Track this entry
        if (!entriesByLoop.has(currentLoop)) {
            entriesByLoop.set(currentLoop, new Set());
        }
        entriesByLoop.get(currentLoop).add(uid);

        // Determine activation reason from log text
        let reason = 'activated';
        if (logText.includes('@@activate decorator')) reason = 'decorator';
        else if (logText.includes('constant')) reason = 'constant';
        else if (logText.includes('sticky')) reason = 'sticky';
        else if (logText.includes('primary key match')) reason = 'primary_key_match';
        else if (logText.includes('AND ANY')) reason = 'secondary_and_any';
        else if (logText.includes('NOT ALL')) reason = 'secondary_not_all';
        else if (logText.includes('NOT ANY')) reason = 'secondary_not_any';
        else if (logText.includes('AND ALL')) reason = 'secondary_and_all';
        else if (logText.includes('prio winner')) reason = 'group_priority';
        else if (logText.includes('roll winner')) reason = 'group_random';

        // Extract matched keyword if present
        let matchedKeyword = null;
        // Look for the keyword in args (usually the 3rd argument for primary key match)
        if (args.length >= 3 && reason === 'primary_key_match') {
            matchedKeyword = typeof args[2] === 'string' ? args[2] : null;
        }

        // Store tracking data
        deepTriggerData.set(uid, {
            uid,
            recursionLevel: level,
            loopCount: currentLoop,
            reason,
            matchedKeyword,
            timestamp: Date.now(),
        });

        // Store in recursion chain
        const prevLoopUids = currentLoop > 1 ? [...(entriesByLoop.get(currentLoop - 1) || [])] : [];
        recursionChain.set(uid, {
            level,
            triggeredBy: prevLoopUids,
        });

        console.debug(`[TrackHare] Entry ${uid} activated at L${level} (loop ${currentLoop}), reason: ${reason}`);
    }
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

    console.debug(`[TrackHare] Capture stopped. Found entries in ${entriesByLoop.size} loops:`);
    for (const [loop, uids] of entriesByLoop) {
        console.debug(`  Loop ${loop} (L${loop - 1}): ${uids.size} entries`);
    }
}

// =============================================================================
// TRIGGER REASON DETECTION (fallback for entries not caught by logs)
// =============================================================================

/**
 * Determine trigger reason from entry properties
 */
export function determineTriggerReason(entry, timedEffects = null) {
    if (entry.constant === true) return { reason: 'constant', confident: true };
    if (entry.vectorized === true) return { reason: 'vector', confident: true };
    if (entry.decorators?.includes('@@activate')) return { reason: 'decorator', confident: true };

    if (timedEffects?.isEffectActive?.('sticky', entry)) {
        return { reason: 'sticky', confident: true };
    } else if (entry.sticky && entry.sticky > 0) {
        return { reason: 'sticky', confident: true };
    }

    const hasKeys = entry.key?.length > 0 || entry.keysecondary?.length > 0;
    if (hasKeys) {
        if (entry.selective && entry.keysecondary?.length > 0) {
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
 * Also listen to WORLDINFO_SCAN_DONE as a backup data source
 */
function setupScanDoneTracking() {
    eventSource.on(event_types.WORLDINFO_SCAN_DONE, (args) => {
        const { state, new: newEntries, timedEffects } = args;

        // Use loopCount from the event as verification
        const eventLoop = state.loopCount;
        const level = Math.max(0, eventLoop - 1);

        if (newEntries.successful?.length > 0) {
            for (const entry of newEntries.successful) {
                // Only update if we don't already have data from log parsing
                // or if log parsing gave a different loop (trust the event more)
                const existing = deepTriggerData.get(entry.uid);

                if (!existing || existing.loopCount !== eventLoop) {
                    let reason = existing?.reason || 'activated';
                    let confident = !!existing?.reason;

                    if (!existing?.reason) {
                        const fallback = determineTriggerReason(entry, timedEffects);
                        reason = fallback.reason;
                        confident = fallback.confident;
                    }

                    deepTriggerData.set(entry.uid, {
                        uid: entry.uid,
                        recursionLevel: level,
                        loopCount: eventLoop,
                        reason,
                        confident,
                        matchedKeyword: existing?.matchedKeyword || null,
                        timestamp: Date.now(),
                        entryName: entry.comment || entry.uid,
                        world: entry.world,
                    });

                    // Update recursion chain
                    const prevLoopUids = eventLoop > 1 ? [...(entriesByLoop.get(eventLoop - 1) || [])] : [];
                    recursionChain.set(entry.uid, {
                        level,
                        triggeredBy: prevLoopUids,
                    });

                    // Track in entriesByLoop
                    if (!entriesByLoop.has(eventLoop)) {
                        entriesByLoop.set(eventLoop, new Set());
                    }
                    entriesByLoop.get(eventLoop).add(entry.uid);
                }
            }
        }

        // Stop capture when scan is done
        if (state.next === 0) {
            stopLogCapture();
        }
    });
}

/**
 * Setup generation tracking hooks
 */
function setupGenerationTracking() {
    eventSource.on(event_types.GENERATION_STARTED, () => {
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
 */
export function getDeepTriggerInfo(uid) {
    return deepTriggerData.get(uid) || null;
}

/**
 * Get recursion chain info for an entry
 */
export function getRecursionChain(uid) {
    return recursionChain.get(uid) || null;
}

/**
 * Get probability result (deprecated)
 */
export function getProbabilityResult(uid) {
    return null;
}

/**
 * Get trigger reason for an entry
 */
export function getTriggerReason(entry) {
    const deepInfo = getDeepTriggerInfo(entry.uid);
    if (deepInfo?.reason) return deepInfo.reason;
    return determineTriggerReason(entry, null).reason;
}

/**
 * Get enhanced trigger details for an entry
 */
export function getEnhancedTriggerDetails(entry) {
    const deepInfo = getDeepTriggerInfo(entry.uid);
    const chainInfo = getRecursionChain(entry.uid);

    if (deepInfo) {
        return {
            reason: deepInfo.reason,
            confident: deepInfo.confident ?? true,
            recursionLevel: deepInfo.recursionLevel ?? 0,
            loopCount: deepInfo.loopCount ?? 1,
            triggeredBy: chainInfo?.triggeredBy || [],
            isRecursive: (deepInfo.recursionLevel ?? 0) > 0,
            matchedKeyword: deepInfo.matchedKeyword || null,
            world: deepInfo.world,
            entryName: deepInfo.entryName,
        };
    }

    const fallback = determineTriggerReason(entry, null);
    return {
        reason: fallback.reason,
        confident: fallback.confident,
        recursionLevel: 0,
        loopCount: 1,
        triggeredBy: [],
        isRecursive: false,
        matchedKeyword: null,
        world: entry.world,
        entryName: entry.comment || entry.uid,
    };
}

/**
 * Classify trigger reason (wrapper)
 */
export function classifyTriggerReasonFromEntry(entry, contextData = {}) {
    return getTriggerReason(entry);
}

/**
 * Analyze entry settings/properties
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
 * Analyze trigger source (for message-based analysis)
 */
export function analyzeTriggerSource(entry, recentMessages) {
    const analysis = {
        matchedKeys: [],
        triggeringMessages: [],
        triggerReason: 'normal',
        triggerSource: 'unknown',
    };

    // Check decorators
    if (entry.decorators?.includes('@@activate')) {
        analysis.triggerReason = 'decorator_activate';
        analysis.triggerSource = 'decorator';
        return analysis;
    }

    if (entry.constant === true) {
        analysis.triggerReason = 'constant';
        analysis.triggerSource = 'constant';
        return analysis;
    }

    if (entry.vectorized === true) {
        analysis.triggerReason = 'rag';
        analysis.triggerSource = 'vectorized';
        return analysis;
    }

    return analysis;
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
    return new Map(); // Deprecated
}

/**
 * Get entries by loop for debugging
 */
export function getEntriesByLoop() {
    return entriesByLoop;
}

/**
 * Initialize trigger tracking system
 */
export function initTriggerTracking() {
    setupScanDoneTracking();
    setupGenerationTracking();
    console.log('[TrackHare] Trigger tracking initialized (aggressive log parsing mode)');
}
