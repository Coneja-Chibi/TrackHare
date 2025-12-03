// =============================================================================
// RECURSION VISUALIZER - Trigger Chain Analysis
// Shows which entries fired and which triggered others
// Implements ST's key matching system with full recursion settings support
// =============================================================================

import { getDeepTriggerInfo, getEnhancedTriggerDetails } from './trigger-tracking.js';
import { uiState } from './ui-state.js';
import { world_info_case_sensitive, world_info_match_whole_words, openWorldInfoEditor } from '../../../../../scripts/world-info.js';
import { selectiveLogicNames } from './constants.js';

// =============================================================================
// NAVIGATION HELPERS
// =============================================================================

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
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
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

/**
 * Match a single key against content, respecting entry settings
 */
function matchKey(haystack, needle, entry) {
    if (!needle || !haystack) return false;

    const keyRegex = parseRegexFromString(needle);
    if (keyRegex) return keyRegex.test(haystack);

    const transformedHaystack = transformString(haystack, entry);
    const transformedNeedle = transformString(needle, entry);
    const matchWholeWords = entry.matchWholeWords ?? world_info_match_whole_words;

    if (matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);
        if (keyWords.length > 1) {
            return transformedHaystack.includes(transformedNeedle);
        } else {
            const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`);
            return regex.test(transformedHaystack);
        }
    } else {
        return transformedHaystack.includes(transformedNeedle);
    }
}

/**
 * Check if ANY primary key matches
 */
function matchPrimaryKeys(haystack, entry) {
    const keys = entry.key || [];
    for (const key of keys) {
        if (key?.trim() && matchKey(haystack, key.trim(), entry)) {
            return { matches: true, matchedKey: key.trim() };
        }
    }
    return { matches: false, matchedKey: null };
}

/**
 * Check secondary keys with selective logic
 * ST uses: 0=AND ANY, 1=NOT ALL, 2=NOT ANY, 3=AND ALL
 */
function checkSecondaryKeys(haystack, entry) {
    const secondaryKeys = entry.keysecondary || [];
    if (!secondaryKeys.length || !entry.selective) {
        return { passes: true, logic: null, matchedKeys: [] };
    }

    const logic = entry.selectiveLogic ?? 0;
    const matchResults = secondaryKeys.map(key => ({
        key: key?.trim(),
        matched: key?.trim() ? matchKey(haystack, key.trim(), entry) : false,
    }));

    const matchedKeys = matchResults.filter(r => r.matched).map(r => r.key);
    const anyMatched = matchResults.some(r => r.matched);
    const allMatched = matchResults.every(r => r.matched);

    let passes = false;
    switch (logic) {
        case 0: passes = anyMatched; break;      // AND ANY
        case 1: passes = !allMatched; break;     // NOT ALL
        case 2: passes = !anyMatched; break;     // NOT ANY
        case 3: passes = allMatched; break;      // AND ALL
    }

    return {
        passes,
        logic: selectiveLogicNames[logic] || 'AND ANY',
        matchedKeys,
    };
}

/**
 * Full key match check - primary + secondary logic
 */
function entryMatchesContent(haystack, targetEntry) {
    // Check primary keys first
    const primary = matchPrimaryKeys(haystack, targetEntry);
    if (!primary.matches) return { matches: false };

    // Check secondary keys if selective
    const secondary = checkSecondaryKeys(haystack, targetEntry);
    if (!secondary.passes) return { matches: false };

    return {
        matches: true,
        matchedKey: primary.matchedKey,
        secondaryLogic: secondary.logic,
        matchedSecondaryKeys: secondary.matchedKeys,
    };
}

// =============================================================================
// RECURSION SETTINGS ANALYSIS
// =============================================================================

function getRecursionSettings(entry) {
    return {
        excludeRecursion: entry.excludeRecursion ?? false,
        preventRecursion: entry.preventRecursion ?? false,
        delayUntilRecursion: entry.delayUntilRecursion ?? 0,
    };
}

/**
 * Check if source entry can trigger target entry based on recursion settings
 */
function canTrigger(sourceEntry, targetEntry) {
    const sourceSettings = getRecursionSettings(sourceEntry);
    const targetSettings = getRecursionSettings(targetEntry);

    // Source has preventRecursion - its content can't trigger others
    if (sourceSettings.preventRecursion) {
        return { canTrigger: false, reason: 'source has preventRecursion' };
    }

    // Target has excludeRecursion - it can't be triggered by other entries
    if (targetSettings.excludeRecursion) {
        return { canTrigger: false, reason: 'target has excludeRecursion' };
    }

    // Target has delayUntilRecursion - needs specific depth (we can't verify this without levels)
    // For now, we'll allow the match but note the setting

    return { canTrigger: true, reason: null };
}

// =============================================================================
// TRIGGER CHAIN BUILDING
// =============================================================================

function buildTriggerData() {
    const entryList = uiState.currentEntryList || [];

    if (!entryList.length) {
        return { entries: [], triggers: [], triggerers: [] };
    }

    // Build entry nodes with metadata
    const entries = entryList.map(entry => {
        const triggerDetails = getEnhancedTriggerDetails(entry);
        const recursionSettings = getRecursionSettings(entry);

        return {
            uid: entry.uid,
            name: entry.comment || entry.key?.[0] || `Entry #${entry.uid}`,
            world: entry.world,
            keys: (entry.key || []).filter(k => k),
            secondaryKeys: (entry.keysecondary || []).filter(k => k),
            selective: entry.selective,
            selectiveLogic: entry.selectiveLogic,
            content: entry.content || '',
            originalEntry: entry,
            recursionSettings,
            triggerReason: triggerDetails.reason,
            // Will be populated below
            triggeredBy: [],
            triggers: [],
        };
    });

    // Build trigger relationships by checking if any entry's content contains another's keys
    for (const target of entries) {
        // Skip entries that can't be triggered by recursion
        if (target.recursionSettings.excludeRecursion) continue;

        // Skip entries without keys (constant, decorator, etc.)
        if (!target.keys.length) continue;

        // Check each potential source
        for (const source of entries) {
            if (source.uid === target.uid) continue;

            // Check recursion settings
            const canTrig = canTrigger(source.originalEntry, target.originalEntry);
            if (!canTrig.canTrigger) continue;

            // Check if source content matches target keys
            const matchResult = entryMatchesContent(source.content, target.originalEntry);

            if (matchResult.matches) {
                target.triggeredBy.push({
                    uid: source.uid,
                    name: source.name,
                    world: source.world,
                    matchedKey: matchResult.matchedKey,
                    secondaryLogic: matchResult.secondaryLogic,
                    matchedSecondaryKeys: matchResult.matchedSecondaryKeys,
                });

                source.triggers.push({
                    uid: target.uid,
                    name: target.name,
                    world: target.world,
                    matchedKey: matchResult.matchedKey,
                });
            }
        }
    }

    // Categorize entries into mutually exclusive groups
    const triggerers = entries.filter(e => e.triggers.length > 0);
    const triggererUids = new Set(triggerers.map(e => e.uid));

    // Entries that are triggered but don't trigger others
    const triggeredOnly = entries.filter(e => e.triggeredBy.length > 0 && !triggererUids.has(e.uid));

    // Entries that neither trigger nor are triggered (standalone - constants, decorators, etc)
    const standalone = entries.filter(e => e.triggers.length === 0 && e.triggeredBy.length === 0);

    return { entries, triggerers, triggeredOnly, standalone };
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

function getTriggerReasonBadge(reason) {
    const badges = {
        constant: { icon: '🔵', title: 'Always active' },
        decorator: { icon: '⚡', title: 'Forced by decorator' },
        sticky: { icon: '📌', title: 'Sticky effect' },
        vector: { icon: '🧠', title: 'Vector/RAG match' },
        primary_key_match: { icon: '🟢', title: 'Key match' },
        key_match: { icon: '🟢', title: 'Key match' },
        key_match_selective: { icon: '🟡', title: 'Selective key match' },
        secondary_and_any: { icon: '🟡', title: 'Selective (AND ANY)' },
        secondary_and_all: { icon: '🟡', title: 'Selective (AND ALL)' },
        secondary_not_any: { icon: '🟡', title: 'Selective (NOT ANY)' },
        secondary_not_all: { icon: '🟡', title: 'Selective (NOT ALL)' },
        activated: { icon: '✓', title: 'Activated' },
    };
    return badges[reason] || { icon: '❓', title: 'Unknown' };
}

function renderSettingsBadges(settings) {
    const badges = [];
    if (settings.excludeRecursion) {
        badges.push(`<span class="ck-rv-badge ck-rv-badge--exclude" title="Won't activate from other entries">⛔ excl</span>`);
    }
    if (settings.preventRecursion) {
        badges.push(`<span class="ck-rv-badge ck-rv-badge--prevent" title="Content won't trigger others">🚫 prev</span>`);
    }
    if (settings.delayUntilRecursion > 0) {
        badges.push(`<span class="ck-rv-badge ck-rv-badge--delay" title="Delays until recursion ${settings.delayUntilRecursion}">⏳ delay</span>`);
    }
    return badges.join(' ');
}

function renderEntryRow(entry, showTriggeredBy = true) {
    const badge = getTriggerReasonBadge(entry.triggerReason);
    const hasTriggeredBy = entry.triggeredBy.length > 0;
    const hasTriggers = entry.triggers.length > 0;
    const hasSettings = entry.recursionSettings.excludeRecursion ||
                        entry.recursionSettings.preventRecursion ||
                        entry.recursionSettings.delayUntilRecursion > 0;
    const isExpandable = hasTriggeredBy || hasTriggers || entry.keys.length > 0 || hasSettings;

    let detailsHtml = '';
    if (isExpandable) {
        const triggeredBySection = showTriggeredBy && hasTriggeredBy ? `
            <div class="ck-rv-section">
                <div class="ck-rv-section__title">Triggered by:</div>
                ${entry.triggeredBy.map(src => `
                    <div class="ck-rv-trigger-link" data-world="${escapeHtml(src.world)}" data-entry="${escapeHtml(src.name)}">
                        <span class="ck-rv-arrow">←</span>
                        <strong>${escapeHtml(src.name)}</strong>
                        <span class="ck-rv-match">matched "${escapeHtml(src.matchedKey)}"</span>
                        ${src.secondaryLogic ? `<span class="ck-rv-logic">(${src.secondaryLogic})</span>` : ''}
                    </div>
                `).join('')}
            </div>
        ` : '';

        const triggersSection = hasTriggers ? `
            <div class="ck-rv-section">
                <div class="ck-rv-section__title">Triggers:</div>
                ${entry.triggers.map(tgt => `
                    <div class="ck-rv-trigger-link" data-world="${escapeHtml(tgt.world)}" data-entry="${escapeHtml(tgt.name)}">
                        <span class="ck-rv-arrow">→</span>
                        <strong>${escapeHtml(tgt.name)}</strong>
                        <span class="ck-rv-match">via "${escapeHtml(tgt.matchedKey)}"</span>
                    </div>
                `).join('')}
            </div>
        ` : '';

        const keysSection = entry.keys.length > 0 ? `
            <div class="ck-rv-section">
                <div class="ck-rv-section__title">Keys:</div>
                <div class="ck-rv-keys">${entry.keys.map(k => `<span class="ck-rv-key">${escapeHtml(k)}</span>`).join('')}</div>
                ${entry.selective && entry.secondaryKeys.length > 0 ? `
                    <div class="ck-rv-section__title">Secondary (${selectiveLogicNames[entry.selectiveLogic] || 'AND ANY'}):</div>
                    <div class="ck-rv-keys ck-rv-keys--secondary">${entry.secondaryKeys.map(k => `<span class="ck-rv-key">${escapeHtml(k)}</span>`).join('')}</div>
                ` : ''}
            </div>
        ` : '';

        const settingsSection = hasSettings ? `
            <div class="ck-rv-section">
                <div class="ck-rv-section__title">Recursion settings:</div>
                <div class="ck-rv-badges">${renderSettingsBadges(entry.recursionSettings)}</div>
            </div>
        ` : '';

        detailsHtml = `
            <div class="ck-rv-details">
                ${triggeredBySection}
                ${triggersSection}
                ${keysSection}
                ${settingsSection}
            </div>
        `;
    }

    return `
        <div class="ck-rv-entry ${isExpandable ? 'ck-rv-entry--expandable' : ''}"
             data-world="${escapeHtml(entry.world)}"
             data-entry="${escapeHtml(entry.name)}">
            <div class="ck-rv-entry__main">
                <span class="ck-rv-toggle">${isExpandable ? '▶' : ''}</span>
                <span class="ck-rv-reason" title="${badge.title}">${badge.icon}</span>
                <span class="ck-rv-name">${escapeHtml(entry.name)}</span>
                <span class="ck-rv-world">${escapeHtml(entry.world)}</span>
                ${hasTriggers ? `<span class="ck-rv-count" title="Triggers ${entry.triggers.length} entries">→${entry.triggers.length}</span>` : ''}
                ${hasTriggeredBy ? `<span class="ck-rv-count ck-rv-count--triggered" title="Triggered by ${entry.triggeredBy.length} entries">←${entry.triggeredBy.length}</span>` : ''}
            </div>
            ${detailsHtml}
        </div>
    `;
}

export function showRecursionVisualizer() {
    const existing = document.querySelector('.ck-recursion-modal');
    if (existing) existing.remove();

    const data = buildTriggerData();

    // Stats
    const totalEntries = data.entries.length;
    const triggerersCount = data.triggerers.length;
    const triggeredCount = data.triggered.length;

    const modal = document.createElement('div');
    modal.className = 'ck-recursion-modal';
    modal.innerHTML = `
        <div class="ck-recursion-modal__backdrop"></div>
        <div class="ck-recursion-modal__content">
            <div class="ck-rv-header">
                <span class="ck-rv-header__title">🔗 Trigger Chain Analysis</span>
                <div class="ck-rv-header__stats">
                    <span class="ck-rv-stat">${totalEntries} fired</span>
                    <span class="ck-rv-stat">${triggerersCount} trigger others</span>
                    <span class="ck-rv-stat">${triggeredCount} were triggered</span>
                </div>
                <button class="ck-rv-header__close">✕</button>
            </div>
            <div class="ck-rv-body"></div>
            <div class="ck-rv-footer">
                <span class="ck-rv-legend">🔵 Const</span>
                <span class="ck-rv-legend">🟢 Key</span>
                <span class="ck-rv-legend">🟡 Selective</span>
                <span class="ck-rv-legend">⚡ Forced</span>
                <span class="ck-rv-legend">📌 Sticky</span>
                <span class="ck-rv-legend">🧠 Vector</span>
            </div>
        </div>
    `;

    const body = modal.querySelector('.ck-rv-body');

    if (!totalEntries) {
        body.innerHTML = `
            <div class="ck-rv-empty">
                <div class="ck-rv-empty__icon">🔍</div>
                <div class="ck-rv-empty__text">No entries activated</div>
                <div class="ck-rv-empty__hint">Generate a message to see trigger analysis</div>
            </div>
        `;
    } else {
        // Group 1: Entries that trigger others (sorted by trigger count desc)
        const sortedTriggerers = [...data.triggerers].sort((a, b) => b.triggers.length - a.triggers.length);
        const triggerersHtml = data.triggerers.length > 0 ? `
            <div class="ck-rv-group">
                <div class="ck-rv-group__header">
                    <span class="ck-rv-group__icon">→</span>
                    <span class="ck-rv-group__title">Trigger other entries</span>
                    <span class="ck-rv-group__count">${data.triggerers.length}</span>
                </div>
                <div class="ck-rv-group__list">
                    ${sortedTriggerers.map(e => renderEntryRow(e, true)).join('')}
                </div>
            </div>
        ` : '';

        // Group 2: Entries triggered by others (but don't trigger anything themselves)
        const triggeredHtml = data.triggeredOnly.length > 0 ? `
            <div class="ck-rv-group">
                <div class="ck-rv-group__header">
                    <span class="ck-rv-group__icon">←</span>
                    <span class="ck-rv-group__title">Triggered by other entries</span>
                    <span class="ck-rv-group__count">${data.triggeredOnly.length}</span>
                </div>
                <div class="ck-rv-group__list">
                    ${data.triggeredOnly.map(e => renderEntryRow(e, true)).join('')}
                </div>
            </div>
        ` : '';

        // Group 3: Standalone entries (no trigger relationships)
        const standaloneHtml = data.standalone.length > 0 ? `
            <div class="ck-rv-group">
                <div class="ck-rv-group__header">
                    <span class="ck-rv-group__icon">◆</span>
                    <span class="ck-rv-group__title">Standalone (no chain)</span>
                    <span class="ck-rv-group__count">${data.standalone.length}</span>
                </div>
                <div class="ck-rv-group__list">
                    ${data.standalone.map(e => renderEntryRow(e, false)).join('')}
                </div>
            </div>
        ` : '';

        body.innerHTML = triggerersHtml + triggeredHtml + standaloneHtml;
    }

    // Event handlers
    modal.querySelector('.ck-rv-header__close').onclick = () => modal.remove();
    modal.querySelector('.ck-recursion-modal__backdrop').onclick = () => modal.remove();

    document.addEventListener('keydown', function escHandler(e) {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    });

    document.body.appendChild(modal);

    // Expand/collapse
    modal.querySelectorAll('.ck-rv-entry--expandable .ck-rv-entry__main').forEach(main => {
        main.addEventListener('click', (e) => {
            e.stopPropagation();
            const entry = main.closest('.ck-rv-entry');
            entry.classList.toggle('ck-rv-entry--expanded');
            const toggle = entry.querySelector('.ck-rv-toggle');
            toggle.textContent = entry.classList.contains('ck-rv-entry--expanded') ? '▼' : '▶';
        });
    });

    // Click entry name to open lorebook
    modal.querySelectorAll('.ck-rv-name').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const entry = el.closest('.ck-rv-entry');
            if (entry?.dataset.world && entry?.dataset.entry) {
                modal.remove();
                openLorebookEntry(entry.dataset.world, entry.dataset.entry);
            }
        });
    });

    // Click trigger links
    modal.querySelectorAll('.ck-rv-trigger-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.stopPropagation();
            if (link.dataset.world && link.dataset.entry) {
                modal.remove();
                openLorebookEntry(link.dataset.world, link.dataset.entry);
            }
        });
    });
}

export function buildRecursionTree() {
    return buildTriggerData();
}
