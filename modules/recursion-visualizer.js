// =============================================================================
// RECURSION VISUALIZER - Compact list with expandable details
// Shows activated entries with level badges and expandable trigger info
// Implements ST's key matching system for accurate trigger chain analysis
// =============================================================================

import { getRecursionChainRaw, getDeepTriggerInfo, getEnhancedTriggerDetails } from './trigger-tracking.js';
import { uiState } from './ui-state.js';
import { world_info_case_sensitive, world_info_match_whole_words, openWorldInfoEditor } from '../../../../../scripts/world-info.js';
import { selectiveLogicNames } from './constants.js';

// =============================================================================
// NAVIGATION HELPERS
// =============================================================================

/**
 * Open a lorebook and navigate to a specific entry
 * @param {string} worldName The lorebook name
 * @param {string} entryName The entry comment/name to search for
 */
function openLorebookEntry(worldName, entryName) {
    openWorldInfoEditor(worldName);
    setTimeout(() => {
        const searchInput = document.querySelector('#world_info_search');
        if (searchInput) {
            searchInput.value = entryName;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    }, 300);
}

// =============================================================================
// KEY MATCHING (adapted from ST's WorldInfoBuffer.matchKeys)
// =============================================================================

function parseRegexFromString(input) {
    let match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) return null;
    let [, pattern, flags] = match;
    if (pattern.match(/(^|[^\\])\//)) return null;
    pattern = pattern.replace('\\/', '/');
    try {
        return new RegExp(pattern, flags);
    } catch (e) {
        return null;
    }
}

function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

function transformString(str, entry) {
    const caseSensitive = entry.caseSensitive ?? world_info_case_sensitive;
    return caseSensitive ? str : str.toLowerCase();
}

function matchKey(haystack, needle, entry) {
    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) return keyRegex.test(haystack);

    haystack = transformString(haystack, entry);
    const transformedNeedle = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;

    if (matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);
        if (keyWords.length > 1) {
            return haystack.includes(transformedNeedle);
        } else {
            const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`);
            if (regex.test(haystack)) return true;
        }
    } else {
        return haystack.includes(transformedNeedle);
    }
    return false;
}

/**
 * Analyze recursion settings for an entry
 * These settings control how entries interact with the recursion system:
 * - excludeRecursion: Entry won't activate during recursion scans (only L0)
 * - preventRecursion: Entry's content won't be added to recurse buffer (won't trigger others)
 * - delayUntilRecursion: Entry only activates at specific recursion level
 */
function analyzeRecursionSettings(entry) {
    return {
        excludeRecursion: entry.excludeRecursion ?? false,
        preventRecursion: entry.preventRecursion ?? false,
        delayUntilRecursion: entry.delayUntilRecursion ?? 0,
        hasRecursionSettings: !!(entry.excludeRecursion || entry.preventRecursion || entry.delayUntilRecursion),
    };
}

/**
 * Check if entry matches secondary keys with selective logic
 * ST uses selectiveLogic values: 0=AND ANY, 1=NOT ALL, 2=NOT ANY, 3=AND ALL
 */
function checkSecondaryKeys(haystack, entry) {
    const secondaryKeys = entry.keysecondary || [];
    if (!secondaryKeys.length || !entry.selective) return { matches: true, logic: null };

    const logic = entry.selectiveLogic ?? 0;
    const matchResults = secondaryKeys.map(key => {
        if (!key?.trim()) return false;
        return matchKey(haystack, key.trim(), entry);
    });

    let matches = false;
    switch (logic) {
        case 0: // AND ANY - at least one secondary key must match
            matches = matchResults.some(r => r);
            break;
        case 1: // NOT ALL - not all secondary keys can match
            matches = !matchResults.every(r => r);
            break;
        case 2: // NOT ANY - no secondary keys can match
            matches = !matchResults.some(r => r);
            break;
        case 3: // AND ALL - all secondary keys must match
            matches = matchResults.every(r => r);
            break;
    }

    return {
        matches,
        logic: selectiveLogicNames[logic] || 'UNKNOWN',
        matchedKeys: secondaryKeys.filter((k, i) => matchResults[i]),
    };
}

function findTriggeringSources(sourceEntries, targetEntry) {
    const results = [];
    const keys = targetEntry.key || [];

    // Check if this entry even uses key matching
    const deepInfo = getDeepTriggerInfo(targetEntry.uid);
    if (deepInfo?.reason === 'constant' || deepInfo?.reason === 'decorator' || deepInfo?.reason === 'sticky') {
        // These don't need trigger sources - they activate for other reasons
        return results;
    }

    if (!keys.length) {
        console.debug(`[Carrot Compass] findTriggeringSources: target "${targetEntry.comment || targetEntry.uid}" has no keys`);
        return results;
    }

    for (const sourceEntry of sourceEntries) {
        // Skip entries that have preventRecursion - their content doesn't trigger others
        const sourceSettings = analyzeRecursionSettings(sourceEntry);
        if (sourceSettings.preventRecursion) {
            console.debug(`[Carrot Compass] findTriggeringSources: skipping "${sourceEntry.comment}" (preventRecursion=true)`);
            continue;
        }

        const content = sourceEntry.content || '';
        if (!content) {
            continue;
        }

        for (const key of keys) {
            if (!key?.trim()) continue;
            if (matchKey(content, key.trim(), targetEntry)) {
                // Also check secondary keys if selective
                const secondaryCheck = checkSecondaryKeys(content, targetEntry);

                if (secondaryCheck.matches) {
                    console.debug(`[Carrot Compass] findTriggeringSources: "${sourceEntry.comment}" content matched key "${key}" for "${targetEntry.comment}"`);
                    results.push({
                        entry: sourceEntry,
                        matchedKey: key.trim(),
                        secondaryLogic: secondaryCheck.logic,
                        matchedSecondaryKeys: secondaryCheck.matchedKeys,
                    });
                    break;
                }
            }
        }
    }

    if (results.length === 0) {
        console.debug(`[Carrot Compass] findTriggeringSources: no matches found for "${targetEntry.comment || targetEntry.uid}" with keys:`, keys);
    }

    return results;
}

// =============================================================================
// DATA BUILDING
// =============================================================================

function buildEntryList() {
    const recursionChain = getRecursionChainRaw();
    const entryList = uiState.currentEntryList || [];

    if (!entryList.length) {
        return { entries: [], hasRecursion: false, totalEntries: 0, levelStats: {} };
    }

    // Build flat list of entries with level info
    const entries = [];
    const levelMap = new Map(); // level -> entries at that level

    for (const entry of entryList) {
        const deepInfo = getDeepTriggerInfo(entry.uid);
        const chainInfo = recursionChain.get(entry.uid);
        const triggerDetails = getEnhancedTriggerDetails(entry);
        const recursionSettings = analyzeRecursionSettings(entry);

        // Prefer deepInfo.recursionLevel as it's set directly from WORLDINFO_SCAN_DONE
        // Fall back to chainInfo.level, then 0
        const level = deepInfo?.recursionLevel ?? chainInfo?.level ?? 0;

        const node = {
            uid: entry.uid,
            name: entry.comment || entry.key?.[0] || `Entry #${entry.uid}`,
            world: entry.world,
            level: level,
            keys: entry.key || [],
            secondaryKeys: entry.keysecondary || [],
            selective: entry.selective,
            selectiveLogic: entry.selectiveLogic,
            originalEntry: entry,
            triggeredBy: [],
            // Recursion settings
            recursionSettings,
            // Trigger details from tracking
            triggerReason: triggerDetails.reason,
            matchedKeyword: triggerDetails.matchedKeyword,
        };

        entries.push(node);

        if (!levelMap.has(node.level)) {
            levelMap.set(node.level, []);
        }
        levelMap.get(node.level).push(node);
    }

    // Do key matching to find trigger sources - look at ALL previous levels, not just immediate previous
    const sortedLevels = [...levelMap.keys()].sort((a, b) => a - b);

    for (let i = 1; i < sortedLevels.length; i++) {
        const currentLevel = sortedLevels[i];
        const currentNodes = levelMap.get(currentLevel);

        // Collect all entries from all previous levels as potential triggers
        const allPrevEntries = [];
        for (let j = 0; j < i; j++) {
            const prevEntries = levelMap.get(sortedLevels[j]).map(n => n.originalEntry);
            allPrevEntries.push(...prevEntries);
        }

        for (const node of currentNodes) {
            // Skip entries that shouldn't have triggers (constant, decorator, etc)
            if (['constant', 'decorator', 'sticky', 'vector'].includes(node.triggerReason)) {
                continue;
            }

            const sources = findTriggeringSources(allPrevEntries, node.originalEntry);
            node.triggeredBy = sources.map(src => ({
                name: src.entry.comment || src.entry.key?.[0] || `Entry #${src.entry.uid}`,
                matchedKey: src.matchedKey,
                world: src.entry.world,
                secondaryLogic: src.secondaryLogic,
                matchedSecondaryKeys: src.matchedSecondaryKeys,
            }));
        }
    }

    // Sort by level, then by name
    entries.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name);
    });

    const hasRecursion = sortedLevels.length > 1 || (sortedLevels.length === 1 && sortedLevels[0] > 0);

    // Build level stats
    const levelStats = {};
    for (const [level, nodes] of levelMap) {
        levelStats[level] = nodes.length;
    }

    return { entries, hasRecursion, totalEntries: entries.length, levelStats };
}

// =============================================================================
// RENDERING
// =============================================================================

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getLevelColor(level) {
    if (level === 0) return 'var(--ck-primary)';
    if (level === 1) return '#8b5cf6';
    return '#06b6d4';
}

/**
 * Get icon/badge for trigger reason
 */
function getTriggerReasonBadge(reason) {
    const badges = {
        constant: { icon: '🔵', label: 'CONST' },
        decorator: { icon: '⚡', label: 'FORCE' },
        sticky: { icon: '📌', label: 'STICKY' },
        vector: { icon: '🧠', label: 'RAG' },
        primary_key_match: { icon: '🟢', label: 'KEY' },
        secondary_and_any: { icon: '🟡', label: 'SEL' },
        secondary_and_all: { icon: '🟡', label: 'SEL' },
        secondary_not_any: { icon: '🟡', label: 'SEL' },
        secondary_not_all: { icon: '🟡', label: 'SEL' },
        key_match: { icon: '🟢', label: 'KEY' },
        key_match_selective: { icon: '🟡', label: 'SEL' },
        activated: { icon: '✓', label: '' },
    };
    return badges[reason] || { icon: '❓', label: '' };
}

/**
 * Render recursion settings badges
 */
function renderRecursionSettingsBadges(settings) {
    const badges = [];

    if (settings.excludeRecursion) {
        badges.push('<span class="ck-rv-setting-badge ck-rv-setting-badge--exclude" title="Exclude from recursion scans (L0 only)">⛔ excl</span>');
    }
    if (settings.preventRecursion) {
        badges.push('<span class="ck-rv-setting-badge ck-rv-setting-badge--prevent" title="Won\'t trigger other entries">🚫 prev</span>');
    }
    if (settings.delayUntilRecursion > 0) {
        badges.push(`<span class="ck-rv-setting-badge ck-rv-setting-badge--delay" title="Delays until recursion level ${settings.delayUntilRecursion}">⏳ L${settings.delayUntilRecursion}+</span>`);
    }

    return badges.join('');
}

function renderEntryRow(entry) {
    const hasDetails = entry.triggeredBy && entry.triggeredBy.length > 0;
    const hasRecursionSettings = entry.recursionSettings?.hasRecursionSettings;
    const isExpandable = hasDetails || hasRecursionSettings || (entry.keys.length > 0);
    const levelColor = getLevelColor(entry.level);
    const reasonBadge = getTriggerReasonBadge(entry.triggerReason);

    // Build details section
    let detailsHtml = '';

    if (isExpandable) {
        // Show trigger section - either found triggers or "unknown" for L1+ entries
        const isRecursive = entry.level > 0;
        const triggerSection = hasDetails ? `
            <div class="ck-rv-row__section">
                <div class="ck-rv-row__section-title">Triggered by:</div>
                ${entry.triggeredBy.map(src => `
                    <div class="ck-rv-trigger-source"
                          data-world="${escapeHtml(src.world)}"
                          data-entry="${escapeHtml(src.name)}">
                        <span class="ck-rv-trigger-arrow">←</span>
                        <strong>${escapeHtml(src.name)}</strong>
                        <span class="ck-rv-trigger-key">key: "${escapeHtml(src.matchedKey)}"</span>
                        ${src.secondaryLogic ? `<span class="ck-rv-trigger-logic">(${src.secondaryLogic})</span>` : ''}
                    </div>
                `).join('')}
            </div>
        ` : (isRecursive && entry.keys.length > 0 ? `
            <div class="ck-rv-row__section">
                <div class="ck-rv-row__section-title">Triggered by:</div>
                <div class="ck-rv-trigger-unknown">
                    Could not determine trigger source. Keys may have matched in chat context rather than entry content.
                </div>
            </div>
        ` : '');

        const keysSection = entry.keys.length > 0 ? `
            <div class="ck-rv-row__section">
                <div class="ck-rv-row__section-title">Primary keys:</div>
                <div class="ck-rv-keys">${entry.keys.filter(k => k).map(k => `<span class="ck-rv-key">${escapeHtml(k)}</span>`).join('')}</div>
                ${entry.selective && entry.secondaryKeys.length > 0 ? `
                    <div class="ck-rv-row__section-title">Secondary keys (${selectiveLogicNames[entry.selectiveLogic] || 'AND ANY'}):</div>
                    <div class="ck-rv-keys ck-rv-keys--secondary">${entry.secondaryKeys.filter(k => k).map(k => `<span class="ck-rv-key">${escapeHtml(k)}</span>`).join('')}</div>
                ` : ''}
            </div>
        ` : '';

        const settingsSection = hasRecursionSettings ? `
            <div class="ck-rv-row__section">
                <div class="ck-rv-row__section-title">Recursion settings:</div>
                <div class="ck-rv-settings">${renderRecursionSettingsBadges(entry.recursionSettings)}</div>
            </div>
        ` : '';

        detailsHtml = `
            <div class="ck-rv-row__details">
                ${triggerSection}
                ${keysSection}
                ${settingsSection}
            </div>
        `;
    }

    return `
        <div class="ck-rv-row ${isExpandable ? 'ck-rv-row--expandable' : ''}"
             data-world="${escapeHtml(entry.world)}"
             data-entry="${escapeHtml(entry.name)}">
            <div class="ck-rv-row__main">
                <span class="ck-rv-row__toggle">${isExpandable ? '▶' : ''}</span>
                <span class="ck-rv-row__reason" title="${entry.triggerReason}">${reasonBadge.icon}</span>
                <span class="ck-rv-row__name">${escapeHtml(entry.name)}</span>
                <span class="ck-rv-row__world">${escapeHtml(entry.world)}</span>
                ${hasRecursionSettings ? '<span class="ck-rv-row__settings-indicator" title="Has recursion settings">⚙️</span>' : ''}
                <span class="ck-rv-row__level" style="background: ${levelColor};">L${entry.level}</span>
            </div>
            ${detailsHtml}
        </div>
    `;
}

export function showRecursionVisualizer() {
    // Remove existing modal
    const existing = document.querySelector('.ck-recursion-modal');
    if (existing) existing.remove();

    const data = buildEntryList();

    // Build level stats display
    const levelStatsHtml = Object.entries(data.levelStats)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([level, count]) => `<span class="ck-rv-stat">L${level}: ${count}</span>`)
        .join('');

    const modal = document.createElement('div');
    modal.className = 'ck-recursion-modal';
    modal.innerHTML = `
        <div class="ck-recursion-modal__backdrop"></div>
        <div class="ck-recursion-modal__content ck-rv-modal">
            <div class="ck-rv-header">
                <span class="ck-rv-header__title">🔄 Recursion Visualizer</span>
                <span class="ck-rv-header__stats">${levelStatsHtml || 'No data'}</span>
                <button class="ck-rv-header__close">✕</button>
            </div>
            <div class="ck-rv-body"></div>
            <div class="ck-rv-footer">
                <div class="ck-rv-footer__levels">
                    <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: var(--ck-primary);"></span> L0</span>
                    <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: #8b5cf6;"></span> L1</span>
                    <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: #06b6d4;"></span> L2+</span>
                </div>
                <div class="ck-rv-footer__reasons">
                    <span class="ck-rv-legend">🔵 Const</span>
                    <span class="ck-rv-legend">🟢 Key</span>
                    <span class="ck-rv-legend">🟡 Selective</span>
                    <span class="ck-rv-legend">⚡ Forced</span>
                    <span class="ck-rv-legend">📌 Sticky</span>
                </div>
            </div>
        </div>
    `;

    const body = modal.querySelector('.ck-rv-body');

    if (!data.totalEntries) {
        body.innerHTML = `
            <div class="ck-rv-empty">
                <div class="ck-rv-empty__icon">🔍</div>
                <div class="ck-rv-empty__text">No entries activated</div>
                <div class="ck-rv-empty__hint">Generate a message to see activation data</div>
            </div>
        `;
    } else {
        body.innerHTML = `
            <div class="ck-rv-list">
                ${data.entries.map(entry => renderEntryRow(entry)).join('')}
            </div>
        `;
    }

    // Close handlers
    modal.querySelector('.ck-rv-header__close').onclick = () => modal.remove();
    modal.querySelector('.ck-recursion-modal__backdrop').onclick = () => modal.remove();

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);

    // Toggle expand/collapse on row click
    modal.querySelectorAll('.ck-rv-row--expandable .ck-rv-row__main').forEach(main => {
        main.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = main.closest('.ck-rv-row');
            row.classList.toggle('ck-rv-row--expanded');
            const toggle = row.querySelector('.ck-rv-row__toggle');
            toggle.textContent = row.classList.contains('ck-rv-row--expanded') ? '▼' : '▶';
        });
    });

    // Click on entry name to open lorebook
    modal.querySelectorAll('.ck-rv-row__name').forEach(nameEl => {
        nameEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = nameEl.closest('.ck-rv-row');
            const world = row.dataset.world;
            const entry = row.dataset.entry;
            if (world && entry) {
                modal.remove();
                openLorebookEntry(world, entry);
            }
        });
    });

    // Click on trigger source to open that entry
    modal.querySelectorAll('.ck-rv-trigger-source').forEach(src => {
        src.addEventListener('click', (e) => {
            e.stopPropagation();
            const world = src.dataset.world;
            const entry = src.dataset.entry;
            if (world && entry) {
                modal.remove();
                openLorebookEntry(world, entry);
            }
        });
    });
}

export function buildRecursionTree() {
    return buildEntryList();
}
