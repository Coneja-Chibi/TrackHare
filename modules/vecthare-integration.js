// =============================================================================
// VECTHARE INTEGRATION - RAG/Vector Search Tracking
// Captures VectHare search results, scores, and injection data
// =============================================================================

import { event_types, eventSource } from '../../../../../script.js';

/**
 * VectHare tracking data - stores the last search results
 * @type {Object|null}
 */
let lastVectHareSearch = null;

/**
 * VectHare debug data - detailed pipeline stages
 * @type {Object|null}
 */
let lastVectHareDebug = null;

/**
 * Get VectHare's last search data from window global
 * @returns {Object|null} { chunks, query, timestamp, settings }
 */
export function getVectHareLastSearch() {
    // Try to get fresh data from VectHare's window global
    if (window.VectHare_LastSearch) {
        lastVectHareSearch = window.VectHare_LastSearch;
    }
    return lastVectHareSearch;
}

/**
 * Get VectHare's detailed debug data (if search-debug module is loaded)
 * @returns {Object|null} Full debug data with stages, chunk fates, trace log
 */
export function getVectHareDebugData() {
    // Try to dynamically import from VectHare if available
    try {
        // VectHare stores debug data via setLastSearchDebug, we can access via getLastSearchDebug
        // But since it's in a separate module, we check for window export first
        if (window.VectHare_DebugData) {
            lastVectHareDebug = window.VectHare_DebugData;
        }
    } catch (e) {
        console.debug('[TrackHare] VectHare debug data not available:', e);
    }
    return lastVectHareDebug;
}

/**
 * Get all VectHare chunk data for display
 * @returns {Object} { chunks: Array, query: string, timestamp: number, stats: Object }
 */
export function getVectHareChunks() {
    const search = getVectHareLastSearch();
    if (!search) return { chunks: [], query: '', timestamp: 0, stats: {} };

    return {
        chunks: search.chunks || [],
        query: search.query || '',
        timestamp: search.timestamp || 0,
        stats: {
            totalChunks: search.chunks?.length || 0,
            threshold: search.settings?.threshold || 0,
            topK: search.settings?.topK || 0,
            decayEnabled: search.settings?.temporal_decay?.enabled || false,
        },
    };
}

/**
 * Get detailed info for a specific VectHare chunk
 * @param {string} hash - The chunk hash
 * @returns {Object|null} Chunk details with score, text, keywords, decay info
 */
export function getVectHareChunkDetails(hash) {
    const search = getVectHareLastSearch();
    if (!search?.chunks) return null;

    const chunk = search.chunks.find(c => c.hash === hash);
    if (!chunk) return null;

    return {
        hash: chunk.hash,
        text: chunk.text || '',
        score: chunk.score || 0,
        originalScore: chunk.originalScore || chunk.score || 0,
        keywordBoost: chunk.keywordBoost || 1.0,
        matchedKeywords: chunk.matchedKeywords || chunk.matchedKeywordsWithWeights || [],
        decayApplied: chunk.decayApplied || false,
        decayMultiplier: chunk.decayMultiplier || 1.0,
        messageAge: chunk.messageAge,
        messageIndex: chunk.index,
        collection: chunk.collection || chunk.collectionId,
        metadata: chunk.metadata || {},
    };
}

/**
 * Get VectHare activation history for a chunk
 * @param {string} hash - The chunk hash
 * @returns {Object|null} Activation history { count, lastActivation }
 */
export function getVectHareActivationHistory(hash) {
    if (!window.VectHare_ActivationHistory) return null;
    return window.VectHare_ActivationHistory[hash] || null;
}

/**
 * Check if VectHare is available and has data
 * @returns {boolean}
 */
export function isVectHareAvailable() {
    return !!(window.VectHare_LastSearch || window.VectHare_ActivationHistory);
}

/**
 * Hook to capture VectHare data after generation
 * This is called alongside our worldbook tracking
 */
function captureVectHareData() {
    // Capture current VectHare state
    if (window.VectHare_LastSearch) {
        lastVectHareSearch = { ...window.VectHare_LastSearch };
        console.debug('[TrackHare] Captured VectHare search data:', {
            chunkCount: lastVectHareSearch.chunks?.length || 0,
            query: lastVectHareSearch.query?.substring(0, 50) + '...',
        });
    }
}

/**
 * Initialize VectHare integration - sets up event listeners
 */
export function initVectHareIntegration() {
    // Hook VectHare capture into generation events
    eventSource.on(event_types.GENERATION_ENDED, () => {
        // Small delay to ensure VectHare has finished processing
        setTimeout(captureVectHareData, 100);
    });

    console.log('[TrackHare] VectHare integration initialized');
}

/**
 * Get the raw lastVectHareSearch for debugging
 * @returns {Object|null}
 */
export function getLastVectHareSearchRaw() {
    return lastVectHareSearch;
}

// =============================================================================
// VECTHARE UI RENDERING
// =============================================================================

/**
 * Render VectHare section into content container
 * @param {HTMLElement} content - Container to append to
 */
export function renderVectHareSection(content) {
    if (!isVectHareAvailable()) return;

    const vhData = getVectHareChunks();
    if (!vhData.chunks || vhData.chunks.length === 0) return;

    // Header
    const header = document.createElement('div');
    header.className = 'ck-world-header ck-vecthare-header';
    header.innerHTML = `
        <div><span style="color: #8b5cf6; font-size: 14px;">🐰</span></div>
        <span>VectHare RAG Chunks</span>
        <span class="ck-header__badge ck-vecthare-badge" style="margin-left: auto;">${vhData.chunks.length}</span>
    `;
    content.appendChild(header);

    // Chunks container
    const container = document.createElement('div');
    container.className = 'ck-entries-container ck-vecthare-container';

    const sortedChunks = [...vhData.chunks].sort((a, b) => (b.score || 0) - (a.score || 0));
    sortedChunks.forEach(chunk => container.appendChild(renderVectHareChunk(chunk)));
    content.appendChild(container);

    // Query footer
    if (vhData.query) {
        const footer = document.createElement('div');
        footer.className = 'ck-vecthare-query';
        const preview = vhData.query.length > 100 ? vhData.query.substring(0, 100) + '...' : vhData.query;
        footer.innerHTML = `
            <strong>🔍 Query:</strong> ${preview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}<br>
            <small style="opacity: 0.7;">Threshold: ${vhData.stats.threshold} • Top K: ${vhData.stats.topK}</small>
        `;
        footer.title = vhData.query;
        content.appendChild(footer);
    }
}

/**
 * Render a single VectHare chunk
 * @param {Object} chunk - Chunk data
 * @returns {HTMLElement}
 */
function renderVectHareChunk(chunk) {
    const el = document.createElement('div');
    el.className = 'ck-entry ck-vecthare-entry';
    el.dataset.strategy = 'vector';

    const scorePercent = Math.round((chunk.score || 0) * 100);
    const scoreClass = scorePercent >= 70 ? 'high' : scorePercent >= 40 ? 'medium' : 'low';
    const textPreview = chunk.text ? (chunk.text.length > 60 ? chunk.text.substring(0, 60) + '...' : chunk.text) : '(no text)';

    // Top row
    const topRow = document.createElement('div');
    topRow.className = 'ck-entry__top-row';
    topRow.innerHTML = `
        <div class="ck-entry__icon" title="Similarity: ${(chunk.score || 0).toFixed(3)}">🧠</div>
        <div class="ck-entry__title" title="${chunk.text || ''}">${textPreview}</div>
        <div class="ck-entry__indicators">
            <span class="ck-score-badge ck-score-badge--${scoreClass}">${(chunk.score || 0).toFixed(4)}</span>
            ${chunk.keywordBoost && chunk.keywordBoost !== 1.0 ? `<span class="ck-boost-badge">×${chunk.keywordBoost.toFixed(1)}</span>` : ''}
        </div>
    `;
    el.appendChild(topRow);

    // Summary
    const summary = document.createElement('div');
    summary.className = 'ck-summary';
    summary.innerHTML = `
        <span class="ck-summary__tag ck-tag--vector" style="font-family: monospace;">Score: ${(chunk.score || 0).toFixed(4)}</span>
        ${chunk.index !== undefined ? `<span class="ck-summary__tag">📍 Msg #${chunk.index}</span>` : ''}
    `;
    el.appendChild(summary);

    return el;
}
