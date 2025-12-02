// =============================================================================
// RECURSION VISUALIZER - Level-based visualization for WI activation chains
// Shows entries grouped by recursion level (L0 → L1 → L2...)
// Includes key matching logic adapted from ST's world-info.js
// =============================================================================

import { getRecursionChainRaw, getDeepTriggerInfo } from './trigger-tracking.js';
import { uiState } from './ui-state.js';
import { world_info_case_sensitive, world_info_match_whole_words, openWorldInfoEditor } from '../../../../../scripts/world-info.js';

// =============================================================================
// NAVIGATION HELPERS
// =============================================================================

/**
 * Open a lorebook and navigate to a specific entry
 * @param {string} worldName The lorebook name
 * @param {string} entryName The entry comment/name to search for
 */
function openLorebookEntry(worldName, entryName) {
    // First open the lorebook
    openWorldInfoEditor(worldName);

    // Wait for the lorebook to load, then search for the entry
    setTimeout(() => {
        const searchInput = document.querySelector('#world_info_search');
        if (searchInput) {
            // Set the search value to find the entry
            searchInput.value = entryName;
            // Trigger input event to filter
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, 300); // Give it time to load
}

// =============================================================================
// KEY MATCHING (adapted from ST's WorldInfoBuffer.matchKeys)
// =============================================================================

/**
 * Parse regex from string (adapted from ST's parseRegexFromString)
 * @param {string} input The input string
 * @returns {RegExp|null} The regex or null if not valid regex format
 */
function parseRegexFromString(input) {
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    let [, pattern, flags] = match;

    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }

    pattern = pattern.replace('\\/', '/');

    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}

/**
 * Escape special regex characters (adapted from ST's escapeRegex)
 * @param {string} string The string to escape
 * @returns {string} The escaped string
 */
function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

/**
 * Transform string based on case sensitivity (adapted from ST's #transformString)
 * @param {string} str The string to transform
 * @param {object} entry The entry with case sensitivity settings
 * @returns {string} The transformed string
 */
function transformString(str, entry) {
    const caseSensitive = entry.caseSensitive ?? world_info_case_sensitive;
    return caseSensitive ? str : str.toLowerCase();
}

/**
 * Check if a key matches in the haystack (adapted from ST's matchKeys)
 * @param {string} haystack The text to search in
 * @param {string} needle The key to search for
 * @param {object} entry The entry with match settings
 * @returns {boolean} True if key matches
 */
function matchKey(haystack, needle, entry) {
    // If the needle is a regex, do regex pattern matching
    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) {
        return keyRegex.test(haystack);
    }

    // Otherwise do normal matching with entry settings
    haystack = transformString(haystack, entry);
    const transformedNeedle = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;

    if (matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);

        if (keyWords.length > 1) {
            return haystack.includes(transformedNeedle);
        } else {
            const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`);
            if (regex.test(haystack)) {
                return true;
            }
        }
    } else {
        return haystack.includes(transformedNeedle);
    }

    return false;
}

/**
 * Find which entries from sourceEntries have content that matches targetEntry's keys
 * @param {Array} sourceEntries Entries whose content we search in
 * @param {object} targetEntry Entry whose keys we're looking for
 * @returns {Array} Array of {entry, matchedKey} for entries that triggered targetEntry
 */
function findTriggeringSources(sourceEntries, targetEntry) {
    const results = [];
    const keys = targetEntry.key || [];

    for (const sourceEntry of sourceEntries) {
        const content = sourceEntry.content || '';
        if (!content) continue;

        for (const key of keys) {
            if (!key?.trim()) continue;

            if (matchKey(content, key.trim(), targetEntry)) {
                results.push({
                    entry: sourceEntry,
                    matchedKey: key.trim(),
                });
                break; // One match is enough to establish the link
            }
        }
    }

    return results;
}

// =============================================================================
// TREE BUILDING
// =============================================================================

/**
 * Build a level-based structure from recursion chain data
 * Groups entries by their recursion level and determines which specific entries triggered which
 * @returns {Object} Levels array and metadata
 */
function buildRecursionTree() {
    const recursionChain = getRecursionChainRaw();
    const entryList = uiState.currentEntryList || [];

    if (!entryList.length) {
        return { levels: [], hasRecursion: false, totalEntries: 0 };
    }

    // Build nodes with level info and keep reference to original entry
    const nodes = [];
    const nodesByUid = new Map();

    for (const entry of entryList) {
        const deepInfo = getDeepTriggerInfo(entry.uid);
        const chainInfo = recursionChain.get(entry.uid);

        const node = {
            uid: entry.uid,
            name: entry.comment || entry.key?.[0] || `Entry #${entry.uid}`,
            world: entry.world,
            level: chainInfo?.level || deepInfo?.recursionLevel || 0,
            reason: deepInfo?.reason || 'activated',
            matchedKeyword: deepInfo?.matchedKeyword,
            keys: entry.key || [],
            content: entry.content || '',
            originalEntry: entry, // Keep reference for key matching
            triggeredBy: [], // Will be populated with {name, matchedKey}
        };

        nodes.push(node);
        nodesByUid.set(entry.uid, node);
    }

    // Group by level
    const levelMap = new Map();
    for (const node of nodes) {
        if (!levelMap.has(node.level)) {
            levelMap.set(node.level, []);
        }
        levelMap.get(node.level).push(node);
    }

    // Now do key matching to find which specific entries triggered which
    const sortedLevelNums = [...levelMap.keys()].sort((a, b) => a - b);

    for (let i = 1; i < sortedLevelNums.length; i++) {
        const currentLevelNum = sortedLevelNums[i];
        const prevLevelNum = sortedLevelNums[i - 1];

        const currentLevelNodes = levelMap.get(currentLevelNum);
        const prevLevelNodes = levelMap.get(prevLevelNum);

        // Get the original entries for the previous level (for key matching)
        const prevLevelEntries = prevLevelNodes.map(n => n.originalEntry);

        for (const node of currentLevelNodes) {
            // Find which previous-level entries have content matching this entry's keys
            const triggeringSources = findTriggeringSources(prevLevelEntries, node.originalEntry);

            node.triggeredBy = triggeringSources.map(src => ({
                name: src.entry.comment || src.entry.key?.[0] || `Entry #${src.entry.uid}`,
                matchedKey: src.matchedKey,
                uid: src.entry.uid,
            }));
        }
    }

    // Convert to sorted array of levels
    const levels = [];
    for (const levelNum of sortedLevelNums) {
        const entries = levelMap.get(levelNum);
        // Sort entries within level by name
        entries.sort((a, b) => a.name.localeCompare(b.name));
        levels.push({
            level: levelNum,
            entries,
        });
    }

    // Check if there's any actual recursion (more than just level 0)
    const hasRecursion = levels.length > 1 || (levels.length === 1 && levels[0].level > 0);

    return { levels, hasRecursion, totalEntries: nodes.length, nodesByUid };
}

// =============================================================================
// RENDERING
// =============================================================================

/**
 * Render the recursion visualizer modal
 */
export function showRecursionVisualizer() {
    // Remove existing modal
    const existing = document.querySelector('.ck-recursion-modal');
    if (existing) existing.remove();

    const data = buildRecursionTree();

    // Create modal
    const modal = document.createElement('div');
    modal.className = 'ck-recursion-modal';
    modal.innerHTML = `
        <div class="ck-recursion-modal__backdrop"></div>
        <div class="ck-recursion-modal__content">
            <div class="ck-recursion-modal__header">
                <div class="ck-recursion-modal__title">
                    <span class="ck-recursion-modal__icon">🔄</span>
                    Recursion Visualizer
                </div>
                <button class="ck-recursion-modal__close">✕</button>
            </div>
            <div class="ck-recursion-modal__body"></div>
            <div class="ck-recursion-modal__footer">
                <div class="ck-recursion-modal__legend">
                    <span class="ck-legend-item"><span class="ck-legend-dot" style="background: var(--ck-primary);"></span> L0 (Direct)</span>
                    <span class="ck-legend-item"><span class="ck-legend-dot" style="background: #8b5cf6;"></span> L1 Recursion</span>
                    <span class="ck-legend-item"><span class="ck-legend-dot" style="background: #06b6d4;"></span> L2+ Recursion</span>
                </div>
            </div>
        </div>
    `;

    const body = modal.querySelector('.ck-recursion-modal__body');

    if (!data.totalEntries) {
        body.innerHTML = `
            <div class="ck-recursion-empty">
                <div class="ck-recursion-empty__icon">🔍</div>
                <div class="ck-recursion-empty__title">No entries activated</div>
                <div class="ck-recursion-empty__desc">Generate a message to see activation chains</div>
            </div>
        `;
    } else if (!data.hasRecursion) {
        // Single level - no recursion
        const level = data.levels[0];
        body.innerHTML = `
            <div class="ck-recursion-info">
                <div class="ck-recursion-info__icon">📋</div>
                <div class="ck-recursion-info__text">
                    <strong>${level.entries.length} entries activated</strong> - No recursion detected.
                    All entries triggered directly by chat content.
                </div>
            </div>
            <div class="ck-recursion-level">
                <div class="ck-recursion-level__entries">
                    ${level.entries.map(node => renderEntryNode(node, data.nodesByUid)).join('')}
                </div>
            </div>
        `;
    } else {
        // Multiple levels - show flow
        body.innerHTML = `
            <div class="ck-recursion-info">
                <div class="ck-recursion-info__icon">🔄</div>
                <div class="ck-recursion-info__text">
                    <strong>${data.totalEntries} entries</strong> activated across <strong>${data.levels.length} recursion levels</strong>.
                    Each level's content triggered the next level's entries.
                </div>
            </div>
            <div class="ck-recursion-flow">
                ${data.levels.map((level, idx) => renderLevel(level, idx, data.levels.length, data.nodesByUid)).join('')}
            </div>
        `;
    }

    // Close handlers
    modal.querySelector('.ck-recursion-modal__close').onclick = () => modal.remove();
    modal.querySelector('.ck-recursion-modal__backdrop').onclick = () => modal.remove();

    // Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);

    // Add click handlers for opening lorebook entries
    modal.querySelectorAll('.ck-recursion-node--clickable, .ck-recursion-source--clickable').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const worldName = el.dataset.world;
            const entryName = el.dataset.entry;
            if (worldName && entryName) {
                modal.remove(); // Close the modal first
                openLorebookEntry(worldName, entryName);
            }
        });
    });
}

/**
 * Render a recursion level with its entries
 */
function renderLevel(level, idx, totalLevels, nodesByUid) {
    const levelColor = level.level === 0 ? 'var(--ck-primary)' :
                       level.level === 1 ? '#8b5cf6' : '#06b6d4';
    const levelName = level.level === 0 ? 'Direct Match' : `Recursion L${level.level}`;
    const showArrow = idx < totalLevels - 1;

    return `
        <div class="ck-recursion-level" data-level="${level.level}">
            <div class="ck-recursion-level__header" style="border-color: ${levelColor};">
                <span class="ck-recursion-level__badge" style="background: ${levelColor};">L${level.level}</span>
                <span class="ck-recursion-level__name">${levelName}</span>
                <span class="ck-recursion-level__count">${level.entries.length} ${level.entries.length === 1 ? 'entry' : 'entries'}</span>
            </div>
            <div class="ck-recursion-level__entries">
                ${level.entries.map(node => renderEntryNode(node, nodesByUid)).join('')}
            </div>
        </div>
        ${showArrow ? `
            <div class="ck-recursion-arrow">
                <span>▼</span>
                <span class="ck-recursion-arrow__label">triggered</span>
            </div>
        ` : ''}
    `;
}

/**
 * Render a single entry node
 */
function renderEntryNode(node, nodesByUid) {
    const levelColor = node.level === 0 ? 'var(--ck-primary)' :
                       node.level === 1 ? '#8b5cf6' : '#06b6d4';

    // Build triggered-by info for recursed entries - make them clickable
    let triggeredByHtml = '';
    if (node.triggeredBy && node.triggeredBy.length > 0) {
        const sources = node.triggeredBy.map(src => {
            // Get the world name from the source node
            const sourceNode = nodesByUid?.get(src.uid);
            const worldName = sourceNode?.world || '';
            return `<span class="ck-recursion-source ck-recursion-source--clickable"
                          data-world="${escapeHtml(worldName)}"
                          data-entry="${escapeHtml(src.name)}"
                          title="Click to open in lorebook">← <strong>${escapeHtml(src.name)}</strong> (key: "${escapeHtml(src.matchedKey)}")</span>`;
        }).join('');
        triggeredByHtml = `<div class="ck-recursion-node__sources">${sources}</div>`;
    }

    // Make the main entry clickable too
    return `
        <div class="ck-recursion-node ck-recursion-node--flat ck-recursion-node--clickable"
             data-world="${escapeHtml(node.world)}"
             data-entry="${escapeHtml(node.name)}"
             title="Click to open in lorebook">
            <div class="ck-recursion-node__indicator" style="background: ${levelColor};"></div>
            <div class="ck-recursion-node__content">
                <div class="ck-recursion-node__name">${escapeHtml(node.name)}</div>
                <div class="ck-recursion-node__meta">
                    <span class="ck-recursion-node__world">${escapeHtml(node.world)}</span>
                    ${node.matchedKeyword ? `<span class="ck-recursion-node__keyword">matched: "${escapeHtml(node.matchedKeyword)}"</span>` : ''}
                </div>
                ${triggeredByHtml}
            </div>
        </div>
    `;
}

/**
 * @deprecated - kept for reference, now using level-based view
 */
function renderTreeNode_deprecated(node, depth) {
    const hasChildren = node.children.length > 0;
    const levelColor = node.level === 0 ? 'var(--ck-primary)' :
                       node.level === 1 ? '#8b5cf6' : '#06b6d4';

    const childrenHtml = hasChildren ? `
        <div class="ck-recursion-children">
            ${node.children.map(child => renderTreeNode(child, depth + 1)).join('')}
        </div>
    ` : '';

    return `
        <div class="ck-recursion-node ${hasChildren ? 'ck-recursion-node--parent' : ''}" data-level="${node.level}">
            <div class="ck-recursion-node__row">
                ${hasChildren ? '<span class="ck-recursion-node__toggle">▼</span>' : '<span class="ck-recursion-node__spacer"></span>'}
                <div class="ck-recursion-node__indicator" style="background: ${levelColor};"></div>
                <div class="ck-recursion-node__content">
                    <div class="ck-recursion-node__name">
                        ${escapeHtml(node.name)}
                        ${node.level > 0 ? `<span class="ck-recursion-node__level">L${node.level}</span>` : ''}
                    </div>
                    <div class="ck-recursion-node__meta">
                        <span class="ck-recursion-node__world">${escapeHtml(node.world)}</span>
                        ${node.matchedKeyword ? `<span class="ck-recursion-node__keyword">→ "${escapeHtml(node.matchedKeyword)}"</span>` : ''}
                        ${hasChildren ? `<span class="ck-recursion-node__children-count">${node.children.length} triggered</span>` : ''}
                    </div>
                </div>
            </div>
            ${childrenHtml}
        </div>
    `;
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// =============================================================================
// EXPORTS
// =============================================================================

export { buildRecursionTree };
