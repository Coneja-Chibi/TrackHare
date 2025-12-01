// =============================================================================
// MAIN PANEL - Panel rendering and entry display
// =============================================================================

import { extension_settings } from '../../../../extensions.js';
import { delay } from '../../../../utils.js';
import { uiState } from './ui-state.js';
import { getEnhancedTriggerDetails, getDeepTriggerInfo } from './trigger-tracking.js';
import { isVectHareAvailable, getVectHareChunks, renderVectHareSection } from './vecthare-integration.js';
import { strategy, reasonDisplay, positionNames, reasonDescriptions } from './constants.js';

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
    if (entry.triggerAnalysis?.triggerReason) return entry.triggerAnalysis.triggerReason;
    const deepInfo = getDeepTriggerInfo(entry.uid);
    if (deepInfo?.reason) return deepInfo.reason;
    if (entry.constant) return 'constant';
    if (entry.vectorized) return 'vectorized';
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

    if (extension_settings.CarrotCompass?.potatoMode) {
        renderPotatoMode(panel, entryList);
    } else {
        renderFullMode(panel, entryList);
    }
}

/**
 * Potato mode - minimal UI
 */
function renderPotatoMode(panel, entryList) {
    panel.classList.add('ck-potato-mode');

    const header = document.createElement('div');
    header.className = 'ck-potato-header';
    header.textContent = `🥕 Active Entries (${entryList.length})`;
    panel.appendChild(header);

    const grouped = groupEntries(entryList);
    const sorted = sortEntries;

    for (const [world, entries] of Object.entries(grouped)) {
        const worldEl = document.createElement('div');
        worldEl.className = 'ck-potato-world';
        worldEl.textContent = `📚 ${world} (${entries.length})`;
        panel.appendChild(worldEl);

        sorted(entries).forEach(entry => {
            const el = document.createElement('div');
            el.className = 'ck-potato-entry';
            el.innerHTML = `
                <div class="ck-potato-entry__title">${entry.comment || 'Untitled'}</div>
                <div class="ck-potato-entry__meta">${entry.content?.length || 0} chars • depth ${entry.depth || 0}</div>
            `;
            panel.appendChild(el);
        });
    }
}

/**
 * Full mode with all features
 */
function renderFullMode(panel, entryList) {
    // Header
    const header = document.createElement('div');
    header.className = 'ck-header';
    header.innerHTML = `
        <div class="ck-header__icon">🧭</div>
        <span class="ck-header__title">Carrot Compass</span>
        <div class="ck-size-controls"></div>
        <span class="ck-header__badge">${entryList.length}</span>
    `;

    // Size toggle buttons
    const controls = header.querySelector('.ck-size-controls');
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

    modes.forEach(({ mode, icon, title, cls }) => {
        const btn = document.createElement('button');
        btn.className = 'ck-size-toggle';
        btn.innerHTML = icon;
        btn.title = title;
        btn.dataset.mode = mode;
        btn.onclick = (e) => {
            e.stopPropagation();
            panel.classList.remove('ck-panel--compact');
            controls.querySelectorAll('.ck-size-toggle').forEach(b => b.classList.remove('ck-size-toggle--active'));
            if (cls) panel.classList.add(cls);
            btn.classList.add('ck-size-toggle--active');
            if (positionPanelFn) setTimeout(positionPanelFn, 100);
        };
        if (mode === 'compact') btn.classList.add('ck-size-toggle--active');
        controls.appendChild(btn);
    });

    panel.classList.add('ck-panel--compact');
    panel.appendChild(header);

    // Content
    const content = document.createElement('div');
    content.className = 'ck-content';

    const grouped = groupEntries(entryList);
    for (const [world, entries] of Object.entries(grouped)) {
        // World header
        const worldHeader = document.createElement('div');
        worldHeader.className = 'ck-world-header';
        worldHeader.innerHTML = `
            <div class="ck-world-header__icon">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
                </svg>
            </div>
            <span>${world}</span>
            <span class="ck-header__badge" style="margin-left: auto;">${entries.length}</span>
        `;
        content.appendChild(worldHeader);

        // Entries
        const container = document.createElement('div');
        container.className = 'ck-entries-container';
        sortEntries(entries).forEach(entry => container.appendChild(renderEntry(entry)));
        content.appendChild(container);
    }

    // VectHare section
    renderVectHareSection(content);

    panel.appendChild(content);
}

/**
 * Group entries by world
 */
function groupEntries(entryList) {
    if (!(extension_settings.CarrotCompass?.worldBookGroup ?? true)) {
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
    const method = extension_settings.CarrotCompass?.sortMethod || 'alpha';
    return [...entries].sort((a, b) => {
        if (method === 'chars') return (a.content?.length || 0) - (b.content?.length || 0);
        if (method === 'order') return (a.order || 0) - (b.order || 0);
        return (a.comment || '').localeCompare(b.comment || '');
    });
}

/**
 * Render single entry
 */
function renderEntry(entry) {
    const el = document.createElement('div');
    el.className = 'ck-entry';
    el.dataset.strategy = getStrategy(entry);

    const details = getEnhancedTriggerDetails(entry);
    const display = reasonDisplay[details.reason] || reasonDisplay.activated;

    let emoji = display.emoji;
    let reason = display.text;
    if (details.recursionLevel > 0) {
        emoji = '🔄' + emoji;
        reason = `L${details.recursionLevel} → ${reason}`;
    }

    // Top row
    const topRow = document.createElement('div');
    topRow.className = 'ck-entry__top-row';
    topRow.innerHTML = `
        <div class="ck-entry__icon">${strategy[el.dataset.strategy] || '❓'}</div>
        <div class="ck-entry__title">${entry.comment || entry.key?.join(', ') || 'Unnamed'}</div>
        <div class="ck-entry__indicators">
            <span class="ck-entry__trigger-indicator" title="${buildTooltip(details, reason)}">${emoji}</span>
            <span class="ck-entry__trigger-reason">${reason}${details.matchedKeyword ? ` → "${details.matchedKeyword}"` : ''}</span>
            ${entry.sticky ? `<span class="ck-entry__sticky">📌${entry.sticky}</span>` : ''}
        </div>
    `;
    el.appendChild(topRow);

    // Summary tags
    const summary = document.createElement('div');
    summary.className = 'ck-summary';
    summary.innerHTML = buildTags(entry, details);
    el.appendChild(summary);

    // Debug container
    const debug = document.createElement('div');
    debug.className = 'ck-debug';
    debug.innerHTML = `<div class="ck-debug__content">${buildDebugContent(entry, details)}</div>`;
    el.appendChild(debug);

    // Click to expand
    el.onclick = (e) => {
        e.stopPropagation();
        const expanded = debug.style.maxHeight && debug.style.maxHeight !== '0px';
        debug.style.maxHeight = expanded ? '0' : debug.scrollHeight + 'px';
        el.classList.toggle('ck-entry--expanded', !expanded);
    };

    return el;
}

/**
 * Build tooltip text
 */
function buildTooltip(details, reason) {
    let text = `Trigger: ${reason}`;
    if (details.matchedKeyword) text += `\n🎯 Matched: "${details.matchedKeyword}"`;
    if (details.primaryKeys?.length) text += `\n🔑 Keys: ${details.primaryKeys.slice(0, 3).join(', ')}`;
    if (details.recursionLevel > 0) text += `\n🔄 Recursion L${details.recursionLevel}`;
    return text;
}

/**
 * Build summary tags HTML
 */
function buildTags(entry, details) {
    const tags = [];
    const r = entry.triggerReason;

    if (r && reasonDisplay[r]) {
        const d = reasonDisplay[r];
        tags.push(`<span class="ck-summary__tag" style="background:${d.color};color:white;">${d.emoji} ${d.text}</span>`);
    }

    tags.push(`<span class="ck-summary__tag">🔑 ${entry.key?.length || 0}</span>`);

    const sort = extension_settings.CarrotCompass?.sortMethod;
    if (sort === 'order') tags.push(`<span class="ck-summary__tag ck-tag--order">#${entry.order || 0}</span>`);
    if (sort === 'chars') tags.push(`<span class="ck-summary__tag ck-tag--chars">📝 ${(entry.content || '').length}</span>`);
    if (entry.probability && entry.probability < 100) tags.push(`<span class="ck-summary__tag">🎲 ${entry.probability}%</span>`);
    if (entry.group) tags.push(`<span class="ck-summary__tag">👥 ${entry.group}</span>`);

    const s = entry.entrySettings;
    if (s?.recursion?.delayUntilRecursion) tags.push('<span class="ck-summary__tag">⏳ DELAYED</span>');
    if (s?.recursion?.excludeRecursion) tags.push('<span class="ck-summary__tag">🚫 NO-RECURSE</span>');
    if (s?.scanning?.scanPersona) tags.push('<span class="ck-summary__tag">🪪 PERSONA</span>');
    if (s?.scanning?.scanCharacter) tags.push('<span class="ck-summary__tag">🎭 CHAR</span>');

    return tags.join('');
}

/**
 * Build debug content HTML
 */
function buildDebugContent(entry, details) {
    let html = '';

    if (entry.key?.length) {
        html += `<div class="ck-debug__section">
            <div class="ck-debug__heading">🔑 TRIGGER KEYS (${entry.key.length})</div>
            <div class="ck-debug__field">${entry.key.map(k => `<span class="ck-key-tag">${k}</span>`).join('')}</div>
        </div>`;
    }

    if (entry.content) {
        const preview = entry.content.length > 150 ? entry.content.substring(0, 150) + '...' : entry.content;
        html += `<div class="ck-debug__section">
            <div class="ck-debug__heading">📝 CONTENT</div>
            <div class="ck-debug__field">${preview}</div>
        </div>`;
    }

    const info = [];
    if (entry.position !== undefined) info.push(`📍 ${getPositionName(entry.position)}`);
    if (entry.depth !== undefined) info.push(`🏗️ Depth: ${entry.depth}`);
    if (entry.order !== undefined) info.push(`🔢 Order: ${entry.order}`);

    if (info.length) {
        html += `<div class="ck-debug__section">
            <div class="ck-debug__heading">🎯 ACTIVATION</div>
            <div class="ck-debug__field">${info.join(' • ')}</div>
        </div>`;
    }

    if (entry.triggerReason && reasonDescriptions[entry.triggerReason]) {
        html += `<div class="ck-debug__section">
            <div class="ck-debug__heading">🔬 WHY</div>
            <div class="ck-debug__field">${entry.triggerReason.toUpperCase()}: ${reasonDescriptions[entry.triggerReason]}</div>
        </div>`;
    }

    return html;
}
