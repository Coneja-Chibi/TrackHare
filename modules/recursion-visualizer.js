// =============================================================================
// RECURSION VISUALIZER - Compact list with expandable details
// Shows activated entries with level badges and expandable trigger info
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

function findTriggeringSources(sourceEntries, targetEntry) {
    const results = [];
    const keys = targetEntry.key || [];

    for (const sourceEntry of sourceEntries) {
        const content = sourceEntry.content || '';
        if (!content) continue;

        for (const key of keys) {
            if (!key?.trim()) continue;
            if (matchKey(content, key.trim(), targetEntry)) {
                results.push({ entry: sourceEntry, matchedKey: key.trim() });
                break;
            }
        }
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
        return { entries: [], hasRecursion: false, totalEntries: 0 };
    }

    // Build flat list of entries with level info
    const entries = [];
    const levelMap = new Map(); // level -> entries at that level

    for (const entry of entryList) {
        const deepInfo = getDeepTriggerInfo(entry.uid);
        const chainInfo = recursionChain.get(entry.uid);

        // Prefer deepInfo.recursionLevel as it's set directly from WORLDINFO_SCAN_DONE
        // Fall back to chainInfo.level, then 0
        const level = deepInfo?.recursionLevel ?? chainInfo?.level ?? 0;

        const node = {
            uid: entry.uid,
            name: entry.comment || entry.key?.[0] || `Entry #${entry.uid}`,
            world: entry.world,
            level: level,
            keys: entry.key || [],
            originalEntry: entry,
            triggeredBy: [],
        };

        entries.push(node);

        if (!levelMap.has(node.level)) {
            levelMap.set(node.level, []);
        }
        levelMap.get(node.level).push(node);
    }

    // Do key matching to find trigger sources
    const sortedLevels = [...levelMap.keys()].sort((a, b) => a - b);

    for (let i = 1; i < sortedLevels.length; i++) {
        const currentLevel = sortedLevels[i];
        const prevLevel = sortedLevels[i - 1];
        const currentNodes = levelMap.get(currentLevel);
        const prevEntries = levelMap.get(prevLevel).map(n => n.originalEntry);

        for (const node of currentNodes) {
            const sources = findTriggeringSources(prevEntries, node.originalEntry);
            node.triggeredBy = sources.map(src => ({
                name: src.entry.comment || src.entry.key?.[0] || `Entry #${src.entry.uid}`,
                matchedKey: src.matchedKey,
                world: src.entry.world,
            }));
        }
    }

    // Sort by level, then by name
    entries.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        return a.name.localeCompare(b.name);
    });

    const hasRecursion = sortedLevels.length > 1 || (sortedLevels.length === 1 && sortedLevels[0] > 0);

    return { entries, hasRecursion, totalEntries: entries.length };
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

function renderEntryRow(entry) {
    const hasDetails = entry.triggeredBy && entry.triggeredBy.length > 0;
    const levelColor = getLevelColor(entry.level);

    const detailsHtml = hasDetails ? `
        <div class="ck-rv-row__details">
            <div class="ck-rv-row__trigger-info">
                ${entry.triggeredBy.map(src => `
                    <span class="ck-rv-trigger-source"
                          data-world="${escapeHtml(src.world)}"
                          data-entry="${escapeHtml(src.name)}">
                        ← <strong>${escapeHtml(src.name)}</strong>
                        <span class="ck-rv-trigger-key">(key: "${escapeHtml(src.matchedKey)}")</span>
                    </span>
                `).join('')}
            </div>
        </div>
    ` : '';

    return `
        <div class="ck-rv-row ${hasDetails ? 'ck-rv-row--expandable' : ''}"
             data-world="${escapeHtml(entry.world)}"
             data-entry="${escapeHtml(entry.name)}">
            <div class="ck-rv-row__main">
                <span class="ck-rv-row__toggle">${hasDetails ? '▶' : ''}</span>
                <span class="ck-rv-row__name">${escapeHtml(entry.name)}</span>
                <span class="ck-rv-row__world">${escapeHtml(entry.world)}</span>
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

    const modal = document.createElement('div');
    modal.className = 'ck-recursion-modal';
    modal.innerHTML = `
        <div class="ck-recursion-modal__backdrop"></div>
        <div class="ck-recursion-modal__content ck-rv-modal">
            <div class="ck-rv-header">
                <span class="ck-rv-header__title">🔄 Recursion Visualizer</span>
                <span class="ck-rv-header__count">${data.totalEntries} entries</span>
                <button class="ck-rv-header__close">✕</button>
            </div>
            <div class="ck-rv-body"></div>
            <div class="ck-rv-footer">
                <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: var(--ck-primary);"></span> L0 Direct</span>
                <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: #8b5cf6;"></span> L1</span>
                <span class="ck-rv-legend"><span class="ck-rv-legend__dot" style="background: #06b6d4;"></span> L2+</span>
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
