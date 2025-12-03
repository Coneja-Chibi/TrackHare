// =============================================================================
// MAIN PANEL - Panel rendering and entry display
// Matches CarrotKernel style for consistency
// =============================================================================

import { extension_settings } from '../../../../extensions.js';
import { delay } from '../../../../utils.js';
import { uiState } from './ui-state.js';
import { getEnhancedTriggerDetails, getDeepTriggerInfo } from './trigger-tracking.js';
import { isVectHareAvailable, getVectHareChunks, renderVectHareSection } from './vecthare-integration.js';
import { strategy, positionNames } from './constants.js';

// Re-export for public API
export { strategy } from './constants.js';
export { strategyDescriptions } from './constants.js';

// Reference to positionPanel (set by index.js)
let positionPanelFn = null;
export function setPositionPanelFn(fn) { positionPanelFn = fn; }

/**
 * Get strategy for an entry
 */
export function getStrategy(entry) {
    if (entry.triggerReason) return entry.triggerReason;
    const deepInfo = getDeepTriggerInfo(entry.uid);
    if (deepInfo?.reason) return deepInfo.reason;
    if (entry.constant) return 'constant';
    if (entry.vectorized) return 'vector';
    return 'normal';
}

/**
 * Get position name
 */
export function getPositionName(position) {
    return positionNames[position] || `Unknown (${position})`;
}

/**
 * Update badge count
 */
export async function updateBadge(newEntries) {
    const trigger = uiState.trigger;
    if (!trigger) return;

    const vhChunks = isVectHareAvailable() ? (getVectHareChunks().chunks?.length || 0) : 0;
    const total = newEntries.length + vhChunks;

    if (uiState.count !== total) {
        const anim = total === 0 ? 'out' : (uiState.count <= 0 ? 'in' : 'bounce');
        trigger.classList.add(`ck-badge--${anim}`);
        trigger.setAttribute('data-ck-badge-count', total.toString());
        await delay(anim === 'bounce' ? 1010 : 510);
        trigger.classList.remove(`ck-badge--${anim}`);
        uiState.count = total;
    } else if (new Set(newEntries).difference(new Set(uiState.entries)).size > 0) {
        trigger.classList.add('ck-badge--bounce');
        await delay(1010);
        trigger.classList.remove('ck-badge--bounce');
    }
    uiState.entries = newEntries;
}

/**
 * Get trigger emoji and reason text
 */
function getTriggerDisplay(entry) {
    const reason = entry.triggerReason || getStrategy(entry);

    const displays = {
        'constant': { emoji: '🔵', text: 'CONSTANT', color: '#6366f1' },
        'vector': { emoji: '🧠', text: 'VECTOR/RAG', color: '#8b5cf6' },
        'forced': { emoji: '⚡', text: 'FORCED', color: 'var(--ck-primary)' },
        'decorator': { emoji: '⚡', text: 'FORCED', color: 'var(--ck-primary)' },
        'suppressed': { emoji: '🚫', text: 'SUPPRESSED', color: '#64748b' },
        'sticky': { emoji: '📌', text: 'STICKY', color: '#ef4444' },
        'sticky_active': { emoji: '📌', text: 'STICKY', color: '#ef4444' },
        'persona': { emoji: '🪪', text: 'PERSONA', color: '#d946ef' },
        'persona_trigger': { emoji: '🪪', text: 'PERSONA', color: '#d946ef' },
        'character': { emoji: '🎭', text: 'CHARACTER', color: '#f59e0b' },
        'character_trigger': { emoji: '🎭', text: 'CHARACTER', color: '#f59e0b' },
        'scenario': { emoji: '🎬', text: 'SCENARIO', color: '#84cc16' },
        'scenario_trigger': { emoji: '🎬', text: 'SCENARIO', color: '#84cc16' },
        'authors_note': { emoji: '📝', text: 'AUTHOR\'S NOTE', color: '#8b5cf6' },
        'system': { emoji: '⚙️', text: 'SYSTEM', color: '#475569' },
        'secondary_key_match': { emoji: '🔗', text: 'SECONDARY KEYS', color: '#06b6d4' },
        'secondary_and_any': { emoji: '🔗', text: 'SECONDARY (AND ANY)', color: '#06b6d4' },
        'secondary_not_all': { emoji: '🔗', text: 'SECONDARY (NOT ALL)', color: '#06b6d4' },
        'secondary_not_any': { emoji: '🔗', text: 'SECONDARY (NOT ANY)', color: '#06b6d4' },
        'secondary_and_all': { emoji: '🔗', text: 'SECONDARY (AND ALL)', color: '#06b6d4' },
        'primary_key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
        'key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
        'normal_key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
        'normal': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
    };

    return displays[reason] || { emoji: '❓', text: reason?.toUpperCase() || 'UNKNOWN', color: '#64748b' };
}

/**
 * Main panel update
 */
export function updatePanel(entryList, newChat = false) {
    const panel = uiState.panel;
    if (!panel) return;
    panel.innerHTML = '';

    if (!entryList?.length) {
        panel.innerHTML = `
            <div class="ck-empty-state">
                <div class="ck-empty-state__icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                        <circle cx="12" cy="12" r="2" fill="none" stroke="#ff6b35" stroke-width="2"/>
                    </svg>
                </div>
                <div class="ck-empty-state__title">No WorldBook entries active</div>
                <div class="ck-empty-state__desc">Start chatting to trigger worldbook entries</div>
            </div>
        `;
        updateBadge([]);
        return;
    }

    if (extension_settings.TrackHare?.potatoMode) {
        renderPotatoMode(panel, entryList);
    } else {
        renderFullMode(panel, entryList);
    }
}

/**
 * Potato mode - simple, readable list (matches CarrotKernel)
 */
function renderPotatoMode(panel, entryList) {
    panel.classList.add('ck-potato-mode');
    panel.style.cssText = `
        position: fixed;
        background: var(--SmartThemeBlurTintColor);
        color: var(--SmartThemeBodyColor);
        border: 1px solid var(--SmartThemeBorderColor);
        border-radius: 8px;
        padding: 12px;
        max-height: 500px;
        overflow-y: auto;
        font-size: 13px;
        width: 350px;
    `;

    const header = document.createElement('div');
    header.textContent = `🧭 Active Entries (${entryList.length})`;
    header.style.cssText = `
        font-weight: 600;
        margin-bottom: 12px;
        padding-bottom: 8px;
        border-bottom: 2px solid var(--SmartThemeBorderColor);
        font-size: 14px;
    `;
    panel.appendChild(header);

    const grouped = groupEntries(entryList);

    for (const [worldName, entries] of Object.entries(grouped)) {
        const worldHeader = document.createElement('div');
        worldHeader.textContent = `📚 ${worldName} (${entries.length})`;
        worldHeader.style.cssText = `
            font-weight: 600;
            margin-top: 12px;
            margin-bottom: 6px;
            color: var(--SmartThemeQuoteColor);
            font-size: 12px;
        `;
        panel.appendChild(worldHeader);

        sortEntries(entries).forEach(entry => {
            const line = document.createElement('div');
            line.style.cssText = `
                padding: 6px 8px;
                margin: 2px 0;
                background: var(--black30a);
                border-left: 3px solid var(--SmartThemeQuoteColor);
                border-radius: 4px;
            `;

            const title = document.createElement('div');
            title.textContent = entry.comment || 'Untitled';
            title.style.cssText = 'font-weight: 500; margin-bottom: 2px;';

            const meta = document.createElement('div');
            meta.textContent = `${entry.content?.length || 0} chars • depth ${entry.depth || 0}`;
            meta.style.cssText = 'font-size: 11px; opacity: 0.7;';

            line.appendChild(title);
            line.appendChild(meta);
            panel.appendChild(line);
        });
    }
}

/**
 * Full mode with all features (matches CarrotKernel grid/list)
 */
function renderFullMode(panel, entryList) {
    // Header
    const header = document.createElement('div');
    header.className = 'ck-header';

    const icon = document.createElement('div');
    icon.className = 'ck-header__icon';
    icon.textContent = '🧭';

    const title = document.createElement('span');
    title.className = 'ck-header__title';
    title.textContent = 'TrackHare';

    const badge = document.createElement('span');
    badge.className = 'ck-header__badge';
    badge.textContent = entryList.length.toString();

    // Size toggle buttons
    const sizeControls = document.createElement('div');
    sizeControls.className = 'ck-size-controls';

    const modes = [
        {
            mode: 'compact',
            icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="2" rx="1"/><rect x="1" y="7" width="14" height="2" rx="1"/><rect x="1" y="12" width="14" height="2" rx="1"/></svg>',
            title: 'Compact mode - Color indicators only',
            cls: 'ck-panel--compact',
        },
        {
            mode: 'detailed',
            icon: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>',
            title: 'Detailed mode - Full information display',
            cls: '',
        },
    ];

    const sizeButtons = {};
    modes.forEach(({ mode, icon: iconSvg, title: btnTitle, cls }) => {
        const btn = document.createElement('button');
        btn.className = 'ck-size-toggle';
        btn.innerHTML = iconSvg;
        btn.title = btnTitle;
        btn.dataset.mode = mode;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.remove('ck-panel--compact');
            Object.values(sizeButtons).forEach(b => b.classList.remove('ck-size-toggle--active'));
            if (cls) panel.classList.add(cls);
            btn.classList.add('ck-size-toggle--active');
            if (positionPanelFn) setTimeout(positionPanelFn, 100);
        });

        sizeButtons[mode] = btn;
        sizeControls.appendChild(btn);
    });

    // Default to compact mode
    sizeButtons.compact.classList.add('ck-size-toggle--active');
    panel.classList.add('ck-panel--compact');

    header.appendChild(icon);
    header.appendChild(title);
    header.appendChild(sizeControls);
    header.appendChild(badge);
    panel.appendChild(header);

    // Content container
    const content = document.createElement('div');
    content.className = 'ck-content';

    const grouped = groupEntries(entryList);
    for (const [worldName, entries] of Object.entries(grouped)) {
        // World header
        const worldHeader = document.createElement('div');
        worldHeader.className = 'ck-world-header';

        const repoIcon = document.createElement('div');
        repoIcon.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="color: #ff6b35; opacity: 0.9;">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
            </svg>
        `;
        worldHeader.appendChild(repoIcon);

        const worldTitle = document.createElement('span');
        worldTitle.textContent = worldName;
        worldHeader.appendChild(worldTitle);

        const countBadge = document.createElement('span');
        countBadge.className = 'ck-header__badge';
        countBadge.textContent = entries.length.toString();
        countBadge.style.marginLeft = 'auto';
        worldHeader.appendChild(countBadge);

        content.appendChild(worldHeader);

        // Entries container
        const entriesContainer = document.createElement('div');
        entriesContainer.className = 'ck-entries-container';

        sortEntries(entries).forEach(entry => {
            entriesContainer.appendChild(renderEntry(entry));
        });

        content.appendChild(entriesContainer);
    }

    // VectHare section
    renderVectHareSection(content);

    panel.appendChild(content);
}

/**
 * Group entries by world
 */
function groupEntries(entryList) {
    if (!(extension_settings.TrackHare?.worldBookGroup ?? true)) {
        return { 'All Entries': entryList };
    }
    return entryList.reduce((acc, e) => {
        const key = e.world || 'Unknown';
        (acc[key] = acc[key] || []).push(e);
        return acc;
    }, {});
}

/**
 * Sort entries by preference
 */
function sortEntries(entries) {
    const method = extension_settings.TrackHare?.sortMethod || 'alpha';
    return [...entries].sort((a, b) => {
        if (method === 'chars') return (a.content?.length || 0) - (b.content?.length || 0);
        if (method === 'order') return (a.order || 0) - (b.order || 0);
        return (a.comment || '').localeCompare(b.comment || '');
    });
}

/**
 * Render single entry (matches CarrotKernel style)
 */
function renderEntry(entry) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'ck-entry';

    const entryStrategy = getStrategy(entry);
    entryDiv.dataset.strategy = entryStrategy;

    const triggerDisplay = getTriggerDisplay(entry);

    // Top row: Strategy icon + Title + Indicators
    const topRow = document.createElement('div');
    topRow.className = 'ck-entry__top-row';

    // Strategy icon
    const strategyDiv = document.createElement('div');
    strategyDiv.className = 'ck-entry__icon';
    strategyDiv.textContent = strategy[entryStrategy] || strategy.unknown;
    strategyDiv.title = 'Entry trigger strategy';
    topRow.appendChild(strategyDiv);

    // Title
    const titleDiv = document.createElement('div');
    titleDiv.className = 'ck-entry__title';
    titleDiv.textContent = entry.comment?.length ? entry.comment : (entry.key?.filter(k => k).join(', ') || 'Unnamed Entry');
    topRow.appendChild(titleDiv);

    // Indicators container
    const indicatorsDiv = document.createElement('div');
    indicatorsDiv.className = 'ck-entry__indicators';

    // Trigger indicator
    const triggerIndicator = document.createElement('span');
    triggerIndicator.className = 'ck-entry__trigger-indicator';
    triggerIndicator.textContent = triggerDisplay.emoji;
    triggerIndicator.title = `Triggered by: ${triggerDisplay.text}`;
    indicatorsDiv.appendChild(triggerIndicator);

    // Trigger reason text
    const triggerReasonText = document.createElement('span');
    triggerReasonText.className = 'ck-entry__trigger-reason';
    triggerReasonText.textContent = triggerDisplay.text;
    indicatorsDiv.appendChild(triggerReasonText);

    // Sticky indicator
    if (entry.sticky && entry.sticky !== 0) {
        const stickyDiv = document.createElement('span');
        stickyDiv.className = 'ck-entry__sticky';
        stickyDiv.textContent = `📌${entry.sticky}`;
        stickyDiv.title = entry.sticky > 0
            ? `Sticky: ${entry.sticky} turns remaining`
            : `Sticky: Expired ${Math.abs(entry.sticky)} turns ago`;
        indicatorsDiv.appendChild(stickyDiv);
    }

    topRow.appendChild(indicatorsDiv);
    entryDiv.appendChild(topRow);

    // Summary tags bar
    const summaryBar = document.createElement('div');
    summaryBar.className = 'ck-summary';

    const tags = [];

    // Core trigger reason tag
    tags.push(`<span class="ck-summary__tag" style="background: ${triggerDisplay.color}; color: white;">${triggerDisplay.emoji} ${triggerDisplay.text}</span>`);

    // Key count tag
    const keyCount = entry.key?.filter(k => k).length || 0;
    tags.push(`<span class="ck-summary__tag">🔑 ${keyCount}</span>`);

    // Sorting-related tags
    const sortMethod = extension_settings.TrackHare?.sortMethod || 'alpha';
    if (sortMethod === 'order') {
        tags.push(`<span class="ck-summary__tag" style="background: #6366f1; color: white;">#${entry.order || 0}</span>`);
    }
    if (sortMethod === 'chars') {
        const charCount = (entry.content || '').length;
        tags.push(`<span class="ck-summary__tag" style="background: #8b5cf6; color: white;">📝 ${charCount} chars</span>`);
    }

    // Probability tag (if not 100%)
    if (entry.probability && entry.probability < 100) {
        tags.push(`<span class="ck-summary__tag">🎲 ${entry.probability}%</span>`);
    }

    // Group tag
    if (entry.group) {
        tags.push(`<span class="ck-summary__tag">👥 ${entry.group}</span>`);
    }

    // Entry settings tags
    if (entry.entrySettings) {
        const settings = entry.entrySettings;
        if (settings.recursion?.delayUntilRecursion !== undefined && settings.recursion?.delayUntilRecursion !== false) {
            tags.push(`<span class="ck-summary__tag" title="Delayed until recursion">⏳ DELAYED</span>`);
        }
        if (settings.recursion?.excludeRecursion === true) {
            tags.push(`<span class="ck-summary__tag" title="Excludes recursion">🚫 NO-RECURSE</span>`);
        }
        if (settings.scanning?.scanPersona === true) {
            tags.push(`<span class="ck-summary__tag" title="Scans persona">🪪 PERSONA-SCAN</span>`);
        }
        if (settings.scanning?.scanCharacter === true) {
            tags.push(`<span class="ck-summary__tag" title="Scans character">🎭 CHAR-SCAN</span>`);
        }
    }

    summaryBar.innerHTML = tags.join('');
    entryDiv.appendChild(summaryBar);

    // Click to expand (add debug info)
    entryDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        entryDiv.classList.toggle('ck-entry--expanded');
    });

    return entryDiv;
}
