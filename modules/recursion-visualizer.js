// =============================================================================
// RECURSION VISUALIZER - Call stack style visualization for WI activation chains
// Shows trigger chains: Entry A → Entry B → Entry C
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
// CHAIN BUILDING
// =============================================================================

/**
 * Build trigger chains from the entry list
 * Returns an array of chains, where each chain is an array of steps
 * Each step: { entry, triggeredBy, matchedKey }
 */
function buildTriggerChains() {
    const recursionChain = getRecursionChainRaw();
    const entryList = uiState.currentEntryList || [];

    if (!entryList.length) {
        return { chains: [], noChainEntries: [], totalEntries: 0 };
    }

    // Build node map with level info
    const nodesByUid = new Map();
    const levelMap = new Map();

    for (const entry of entryList) {
        const deepInfo = getDeepTriggerInfo(entry.uid);
        const chainInfo = recursionChain.get(entry.uid);
        const level = chainInfo?.level || deepInfo?.recursionLevel || 0;

        const node = {
            uid: entry.uid,
            name: entry.comment || entry.key?.[0] || `Entry #${entry.uid}`,
            world: entry.world,
            level,
            keys: entry.key || [],
            content: entry.content || '',
            originalEntry: entry,
            triggeredBy: null, // { node, matchedKey }
            triggers: [],      // nodes this entry triggers
        };

        nodesByUid.set(entry.uid, node);
        if (!levelMap.has(level)) levelMap.set(level, []);
        levelMap.get(level).push(node);
    }

    // Build trigger relationships using key matching
    const sortedLevels = [...levelMap.keys()].sort((a, b) => a - b);

    for (let i = 1; i < sortedLevels.length; i++) {
        const currentLevel = sortedLevels[i];
        const prevLevel = sortedLevels[i - 1];
        const currentNodes = levelMap.get(currentLevel);
        const prevNodes = levelMap.get(prevLevel);
        const prevEntries = prevNodes.map(n => n.originalEntry);

        for (const node of currentNodes) {
            const sources = findTriggeringSources(prevEntries, node.originalEntry);
            if (sources.length > 0) {
                // Take the first source as the primary trigger
                const src = sources[0];
                const sourceNode = nodesByUid.get(src.entry.uid);
                node.triggeredBy = { node: sourceNode, matchedKey: src.matchedKey };
                sourceNode.triggers.push(node);
            }
        }
    }

    // Build chains by following from L0 entries down
    const chains = [];
    const visitedInChain = new Set();

    function buildChain(startNode) {
        const chain = [];
        let current = startNode;

        // Walk up to find the root
        while (current.triggeredBy) {
            current = current.triggeredBy.node;
        }

        // Now walk down from root, building the chain
        function walkDown(node, path) {
            const step = {
                entry: node,
                triggeredBy: node.triggeredBy ? node.triggeredBy.node : null,
                matchedKey: node.triggeredBy ? node.triggeredBy.matchedKey : null,
            };
            path.push(step);
            visitedInChain.add(node.uid);

            if (node.triggers.length === 0) {
                // End of chain
                chains.push([...path]);
            } else {
                // Continue down each branch
                for (const triggered of node.triggers) {
                    walkDown(triggered, path);
                }
            }
            path.pop();
        }

        walkDown(current, []);
    }

    // Start from all L0 nodes that have triggers
    const l0Nodes = levelMap.get(0) || [];
    for (const node of l0Nodes) {
        if (node.triggers.length > 0 && !visitedInChain.has(node.uid)) {
            buildChain(node);
        }
    }

    // Entries with no chain (L0 with no triggers, or orphaned)
    const noChainEntries = [];
    for (const node of nodesByUid.values()) {
        if (!visitedInChain.has(node.uid)) {
            noChainEntries.push(node);
        }
    }

    return { chains, noChainEntries, totalEntries: entryList.length, nodesByUid };
}

// =============================================================================
// RENDERING
// =============================================================================

export function showRecursionVisualizer() {
    const existing = document.querySelector('.ck-recursion-modal');
    if (existing) existing.remove();

    const data = buildTriggerChains();

    const modal = document.createElement('div');
    modal.className = 'ck-recursion-modal';
    modal.innerHTML = `
        <div class="ck-recursion-modal__backdrop"></div>
        <div class="ck-recursion-modal__content">
            <div class="ck-recursion-modal__header">
                <div class="ck-recursion-modal__title">
                    <span class="ck-recursion-modal__icon">🔗</span>
                    Trigger Chains
                </div>
                <button class="ck-recursion-modal__close">✕</button>
            </div>
            <div class="ck-recursion-modal__body"></div>
        </div>
    `;

    const body = modal.querySelector('.ck-recursion-modal__body');

    if (!data.totalEntries) {
        body.innerHTML = `
            <div class="ck-chain-empty">
                <div class="ck-chain-empty__icon">🔍</div>
                <div class="ck-chain-empty__title">No entries activated</div>
                <div class="ck-chain-empty__desc">Generate a message to see trigger chains</div>
            </div>
        `;
    } else if (data.chains.length === 0) {
        body.innerHTML = `
            <div class="ck-chain-section">
                <div class="ck-chain-section__header">
                    <span class="ck-chain-section__title">No Recursion</span>
                    <span class="ck-chain-section__count">${data.noChainEntries.length} entries</span>
                </div>
                <div class="ck-chain-section__content">
                    ${data.noChainEntries.map(node => renderStandaloneEntry(node)).join('')}
                </div>
            </div>
        `;
    } else {
        let chainsHtml = data.chains.map((chain, idx) => renderChain(chain, idx + 1)).join('');

        let noChainHtml = '';
        if (data.noChainEntries.length > 0) {
            noChainHtml = `
                <div class="ck-chain-section ck-chain-section--no-chain">
                    <div class="ck-chain-section__header">
                        <span class="ck-chain-section__title">Direct Only (No Recursion)</span>
                        <span class="ck-chain-section__count">${data.noChainEntries.length}</span>
                    </div>
                    <div class="ck-chain-section__content ck-chain-section__content--compact">
                        ${data.noChainEntries.map(node => renderStandaloneEntry(node)).join('')}
                    </div>
                </div>
            `;
        }

        body.innerHTML = chainsHtml + noChainHtml;
    }

    // Close handlers
    modal.querySelector('.ck-recursion-modal__close').onclick = () => modal.remove();
    modal.querySelector('.ck-recursion-modal__backdrop').onclick = () => modal.remove();

    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);

    // Click handlers for entries
    modal.querySelectorAll('[data-world][data-entry]').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const worldName = el.dataset.world;
            const entryName = el.dataset.entry;
            if (worldName && entryName) {
                modal.remove();
                openLorebookEntry(worldName, entryName);
            }
        });
    });
}

function renderChain(chain, chainNum) {
    const stepsHtml = chain.map((step, idx) => renderChainStep(step, idx, chain.length)).join('');

    return `
        <div class="ck-chain-section">
            <div class="ck-chain-section__header">
                <span class="ck-chain-section__title">Chain ${chainNum}</span>
                <span class="ck-chain-section__count">${chain.length} entries</span>
            </div>
            <div class="ck-chain-section__content">
                ${stepsHtml}
            </div>
        </div>
    `;
}

function renderChainStep(step, idx, totalSteps) {
    const isFirst = idx === 0;
    const isLast = idx === totalSteps - 1;
    const node = step.entry;

    let connectorHtml = '';
    if (!isFirst) {
        connectorHtml = `
            <div class="ck-chain-connector">
                <div class="ck-chain-connector__line"></div>
                <div class="ck-chain-connector__label">via "${escapeHtml(step.matchedKey)}"</div>
            </div>
        `;
    }

    return `
        ${connectorHtml}
        <div class="ck-chain-step ${isFirst ? 'ck-chain-step--root' : ''} ${isLast ? 'ck-chain-step--leaf' : ''}"
             data-world="${escapeHtml(node.world)}"
             data-entry="${escapeHtml(node.name)}">
            <div class="ck-chain-step__marker">
                ${isFirst ? '▼' : isLast ? '●' : '└▶'}
            </div>
            <div class="ck-chain-step__content">
                <div class="ck-chain-step__name">${escapeHtml(node.name)}</div>
                <div class="ck-chain-step__world">${escapeHtml(node.world)}</div>
            </div>
        </div>
    `;
}

function renderStandaloneEntry(node) {
    return `
        <div class="ck-chain-standalone"
             data-world="${escapeHtml(node.world)}"
             data-entry="${escapeHtml(node.name)}">
            <span class="ck-chain-standalone__name">${escapeHtml(node.name)}</span>
            <span class="ck-chain-standalone__world">${escapeHtml(node.world)}</span>
        </div>
    `;
}

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

export { buildTriggerChains as buildRecursionTree };
