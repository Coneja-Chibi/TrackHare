// =============================================================================
// PROMPT INSPECTOR - Itemized Prompt Viewer
// Captures and displays the exact prompt sent to the AI with source labels
// =============================================================================

import { event_types, eventSource } from '../../../../../script.js';

/**
 * Last captured prompt data
 * @type {Object|null}
 */
let lastPromptData = null;


/**
 * Get the last captured prompt data
 * @returns {Object|null}
 */
export function getLastPromptData() {
    return lastPromptData;
}

/**
 * Get raw prompt data for debugging
 * @returns {Object|null}
 */
export function getLastPromptDataRaw() {
    return lastPromptData;
}

/**
 * Check if prompt data is available
 * @returns {boolean}
 */
export function hasPromptData() {
    return lastPromptData !== null;
}

/**
 * Format chat messages for display with source labels
 * @param {Array} messages Chat completion messages array
 * @returns {Array} Formatted messages with metadata
 */
function formatChatMessages(messages) {
    if (!Array.isArray(messages)) return [];

    return messages.map((msg, index) => {
        // Determine source based on role and content patterns
        let source = 'unknown';
        let sourceColor = '#64748b';
        let sourceIcon = '❓';

        const role = msg.role || 'unknown';
        const content = msg.content || '';
        const name = msg.name || '';

        // Identify source based on patterns
        if (role === 'system') {
            if (content.includes('[Start a new Chat]') || index === 0) {
                source = 'System Prompt';
                sourceColor = '#6366f1';
                sourceIcon = '⚙️';
            } else if (name === 'example_assistant' || name === 'example_user') {
                source = 'Example Dialogue';
                sourceColor = '#8b5cf6';
                sourceIcon = '💬';
            } else if (content.includes('NSFW') || content.includes('mature')) {
                source = 'NSFW Prompt';
                sourceColor = '#ec4899';
                sourceIcon = '🔞';
            } else if (content.includes('[Circumstances and samples of')) {
                source = 'Character Card';
                sourceColor = '#f59e0b';
                sourceIcon = '🎭';
            } else {
                source = 'System';
                sourceColor = '#6366f1';
                sourceIcon = '⚙️';
            }
        } else if (role === 'user') {
            if (name === 'example_user') {
                source = 'Example (User)';
                sourceColor = '#8b5cf6';
                sourceIcon = '💬';
            } else {
                source = 'User Message';
                sourceColor = '#10b981';
                sourceIcon = '👤';
            }
        } else if (role === 'assistant') {
            if (name === 'example_assistant') {
                source = 'Example (Assistant)';
                sourceColor = '#8b5cf6';
                sourceIcon = '💬';
            } else {
                source = 'Assistant Message';
                sourceColor = '#3b82f6';
                sourceIcon = '🤖';
            }
        }

        // Check for special injections
        if (content.includes('[World Info:') || content.includes('### World Info')) {
            source = 'World Info';
            sourceColor = '#f97316';
            sourceIcon = '📚';
        } else if (content.includes('Author\'s Note') || content.includes('[Note:')) {
            source = 'Author\'s Note';
            sourceColor = '#a855f7';
            sourceIcon = '📝';
        } else if (content.includes('Past events:') || content.includes('[RAG Context]')) {
            source = 'VectHare RAG';
            sourceColor = '#8b5cf6';
            sourceIcon = '🐰';
        }

        return {
            index,
            role,
            name: name || role,
            content,
            source,
            sourceColor,
            sourceIcon,
            tokenEstimate: Math.ceil(content.length / 4), // Rough estimate
        };
    });
}

/**
 * Parse text completion prompt into sections
 * @param {string} prompt Raw prompt text
 * @returns {Array} Sections with source labels
 */
function parseTextPromptSections(prompt) {
    if (!prompt) return [];

    const sections = [];

    // Common section markers to look for
    const markers = [
        { pattern: /\[Start a new Chat\]/gi, source: 'Chat Start Marker', color: '#64748b', icon: '🏷️' },
        { pattern: /### Instruction:/gi, source: 'Instruction', color: '#6366f1', icon: '⚙️' },
        { pattern: /### Input:/gi, source: 'Input', color: '#10b981', icon: '📥' },
        { pattern: /### Response:/gi, source: 'Response Marker', color: '#3b82f6', icon: '📤' },
        { pattern: /\[World Info:[^\]]*\]/gi, source: 'World Info', color: '#f97316', icon: '📚' },
        { pattern: /\[Author's Note:[^\]]*\]/gi, source: 'Author\'s Note', color: '#a855f7', icon: '📝' },
        { pattern: /Past events:\n/gi, source: 'VectHare RAG', color: '#8b5cf6', icon: '🐰' },
        { pattern: /<user>|<\|user\|>|\[USER\]/gi, source: 'User Turn', color: '#10b981', icon: '👤' },
        { pattern: /<assistant>|<\|assistant\|>|\[ASSISTANT\]/gi, source: 'Assistant Turn', color: '#3b82f6', icon: '🤖' },
        { pattern: /<system>|<\|system\|>|\[SYSTEM\]/gi, source: 'System', color: '#6366f1', icon: '⚙️' },
    ];

    // Split by newlines and analyze
    const lines = prompt.split('\n');
    let currentSection = { content: '', source: 'Prompt', color: '#64748b', icon: '📄', startLine: 0 };

    lines.forEach((line, lineIndex) => {
        let matched = false;

        for (const marker of markers) {
            if (marker.pattern.test(line)) {
                // Save previous section if it has content
                if (currentSection.content.trim()) {
                    sections.push({ ...currentSection });
                }

                // Start new section
                currentSection = {
                    content: line + '\n',
                    source: marker.source,
                    color: marker.color,
                    icon: marker.icon,
                    startLine: lineIndex,
                };
                matched = true;
                break;
            }
        }

        if (!matched) {
            currentSection.content += line + '\n';
        }
    });

    // Add final section
    if (currentSection.content.trim()) {
        sections.push(currentSection);
    }

    return sections;
}

/**
 * Show the prompt inspector modal
 */
export function showPromptInspector() {
    if (!lastPromptData) {
        toastr.info('No prompt data captured yet. Send a message first!', 'Carrot Compass');
        return;
    }

    // Remove existing modal
    const existing = document.getElementById('ck-prompt-inspector-modal');
    if (existing) existing.remove();

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'ck-prompt-inspector-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
    `;

    const container = document.createElement('div');
    container.style.cssText = `
        background: var(--SmartThemeBlurTintColor, #1a1a2e);
        border-radius: 16px;
        width: 90%;
        max-width: 1200px;
        height: 85vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
        padding: 16px 24px;
        background: linear-gradient(135deg, rgba(255, 107, 53, 0.2) 0%, rgba(139, 92, 246, 0.2) 100%);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        align-items: center;
        justify-content: space-between;
    `;

    const titleArea = document.createElement('div');
    titleArea.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 24px;">📜</span>
            <div>
                <h2 style="margin: 0; font-size: 18px; font-weight: 600; color: var(--SmartThemeBodyColor);">Prompt Inspector</h2>
                <small style="opacity: 0.7;">${lastPromptData.type === 'chat_completion' ? 'Chat Completion API' : 'Text Completion API'} • ${new Date(lastPromptData.timestamp).toLocaleTimeString()}</small>
            </div>
        </div>
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        border: none;
        color: var(--SmartThemeBodyColor);
        width: 36px;
        height: 36px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 18px;
        transition: background 0.2s;
    `;
    closeBtn.addEventListener('click', () => modal.remove());
    closeBtn.addEventListener('mouseenter', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.2)');
    closeBtn.addEventListener('mouseleave', () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)');

    header.appendChild(titleArea);
    header.appendChild(closeBtn);

    // Content area
    const content = document.createElement('div');
    content.style.cssText = `
        flex: 1;
        overflow-y: auto;
        padding: 0;
    `;

    if (lastPromptData.type === 'chat_completion') {
        // Chat completion format - show messages
        const messages = formatChatMessages(lastPromptData.messages);
        let totalTokens = 0;

        messages.forEach((msg, idx) => {
            totalTokens += msg.tokenEstimate;

            const msgDiv = document.createElement('div');
            msgDiv.style.cssText = `
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                transition: background 0.2s;
            `;

            // Message header with source label
            const msgHeader = document.createElement('div');
            msgHeader.style.cssText = `
                padding: 12px 24px;
                background: rgba(0, 0, 0, 0.2);
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                user-select: none;
            `;

            msgHeader.innerHTML = `
                <span style="font-size: 16px;">${msg.sourceIcon}</span>
                <span style="
                    background: ${msg.sourceColor};
                    color: white;
                    padding: 4px 10px;
                    border-radius: 6px;
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                ">${msg.source}</span>
                <span style="
                    background: rgba(255, 255, 255, 0.1);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    font-family: monospace;
                ">${msg.role}${msg.name && msg.name !== msg.role ? ` (${msg.name})` : ''}</span>
                <span style="margin-left: auto; opacity: 0.5; font-size: 11px;">
                    ~${msg.tokenEstimate} tokens • #${idx + 1}
                </span>
                <span class="expand-icon" style="opacity: 0.5; transition: transform 0.2s;">▼</span>
            `;

            // Message content (collapsible)
            const msgContent = document.createElement('div');
            msgContent.style.cssText = `
                padding: 16px 24px;
                background: rgba(0, 0, 0, 0.1);
                display: block;
            `;

            const pre = document.createElement('pre');
            pre.style.cssText = `
                margin: 0;
                white-space: pre-wrap;
                word-break: break-word;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 13px;
                line-height: 1.5;
                color: var(--SmartThemeBodyColor);
                max-height: 400px;
                overflow-y: auto;
            `;
            pre.textContent = msg.content || '(empty)';
            msgContent.appendChild(pre);

            // Toggle collapse
            let collapsed = idx > 2; // Collapse all but first 3 by default
            if (collapsed) {
                msgContent.style.display = 'none';
                msgHeader.querySelector('.expand-icon').style.transform = 'rotate(-90deg)';
            }

            msgHeader.addEventListener('click', () => {
                collapsed = !collapsed;
                msgContent.style.display = collapsed ? 'none' : 'block';
                msgHeader.querySelector('.expand-icon').style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0)';
            });

            msgDiv.appendChild(msgHeader);
            msgDiv.appendChild(msgContent);
            content.appendChild(msgDiv);
        });

        // Add total tokens footer
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 12px 24px;
            background: rgba(139, 92, 246, 0.1);
            text-align: center;
            font-size: 13px;
        `;
        footer.innerHTML = `<strong>Total:</strong> ${messages.length} messages • ~${totalTokens} tokens (estimated)`;
        content.appendChild(footer);

    } else {
        // Text completion format - show sections
        const sections = parseTextPromptSections(lastPromptData.prompt);

        if (sections.length === 0) {
            // Just show raw prompt
            const rawDiv = document.createElement('div');
            rawDiv.style.padding = '24px';
            const pre = document.createElement('pre');
            pre.style.cssText = `
                margin: 0;
                white-space: pre-wrap;
                word-break: break-word;
                font-family: 'Consolas', 'Monaco', monospace;
                font-size: 13px;
                line-height: 1.5;
            `;
            pre.textContent = lastPromptData.prompt;
            rawDiv.appendChild(pre);
            content.appendChild(rawDiv);
        } else {
            sections.forEach((section, idx) => {
                const sectionDiv = document.createElement('div');
                sectionDiv.style.cssText = `
                    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
                `;

                const sectionHeader = document.createElement('div');
                sectionHeader.style.cssText = `
                    padding: 12px 24px;
                    background: rgba(0, 0, 0, 0.2);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    cursor: pointer;
                `;
                sectionHeader.innerHTML = `
                    <span style="font-size: 16px;">${section.icon}</span>
                    <span style="
                        background: ${section.color};
                        color: white;
                        padding: 4px 10px;
                        border-radius: 6px;
                        font-size: 11px;
                        font-weight: 600;
                    ">${section.source}</span>
                    <span style="margin-left: auto; opacity: 0.5; font-size: 11px;">
                        Line ${section.startLine + 1} • ~${Math.ceil(section.content.length / 4)} tokens
                    </span>
                    <span class="expand-icon" style="opacity: 0.5;">▼</span>
                `;

                const sectionContent = document.createElement('div');
                sectionContent.style.cssText = `
                    padding: 16px 24px;
                    background: rgba(0, 0, 0, 0.1);
                `;

                const pre = document.createElement('pre');
                pre.style.cssText = `
                    margin: 0;
                    white-space: pre-wrap;
                    word-break: break-word;
                    font-family: monospace;
                    font-size: 13px;
                    line-height: 1.5;
                    max-height: 300px;
                    overflow-y: auto;
                `;
                pre.textContent = section.content;
                sectionContent.appendChild(pre);

                let collapsed = idx > 2;
                if (collapsed) {
                    sectionContent.style.display = 'none';
                    sectionHeader.querySelector('.expand-icon').style.transform = 'rotate(-90deg)';
                }

                sectionHeader.addEventListener('click', () => {
                    collapsed = !collapsed;
                    sectionContent.style.display = collapsed ? 'none' : 'block';
                    sectionHeader.querySelector('.expand-icon').style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0)';
                });

                sectionDiv.appendChild(sectionHeader);
                sectionDiv.appendChild(sectionContent);
                content.appendChild(sectionDiv);
            });
        }
    }

    // Footer with actions
    const actionsBar = document.createElement('div');
    actionsBar.style.cssText = `
        padding: 12px 24px;
        background: rgba(0, 0, 0, 0.3);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        display: flex;
        gap: 12px;
        justify-content: flex-end;
    `;

    const copyBtn = document.createElement('button');
    copyBtn.innerHTML = '📋 Copy Full Prompt';
    copyBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: var(--SmartThemeBodyColor);
        padding: 8px 16px;
        border-radius: 8px;
        cursor: pointer;
        font-size: 13px;
        transition: background 0.2s;
    `;
    copyBtn.addEventListener('click', () => {
        let textToCopy = '';
        if (lastPromptData.type === 'chat_completion') {
            textToCopy = JSON.stringify(lastPromptData.messages, null, 2);
        } else {
            textToCopy = lastPromptData.prompt;
        }
        navigator.clipboard.writeText(textToCopy).then(() => {
            toastr.success('Copied to clipboard!', 'Carrot Compass');
        });
    });

    actionsBar.appendChild(copyBtn);

    container.appendChild(header);
    container.appendChild(content);
    container.appendChild(actionsBar);
    modal.appendChild(container);

    // Close on backdrop click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });

    // Close on Escape
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            modal.remove();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(modal);
}

/**
 * Initialize Prompt Inspector - sets up event listeners
 */
export function initPromptInspector() {
    // Capture prompt data from GENERATE_AFTER_COMBINE_PROMPTS event (text completion APIs)
    eventSource.on(event_types.GENERATE_AFTER_COMBINE_PROMPTS, (data) => {
        if (data.dryRun) return;

        lastPromptData = {
            type: 'text_completion',
            prompt: data.prompt,
            timestamp: Date.now(),
            api: 'text',
        };
        console.debug('[Carrot Compass] Captured text completion prompt');
    });

    // Capture prompt data from CHAT_COMPLETION_PROMPT_READY event (OpenAI-style APIs)
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (data) => {
        if (data.dryRun) return;

        lastPromptData = {
            type: 'chat_completion',
            messages: data.chat,
            timestamp: Date.now(),
            api: 'openai',
        };
        console.debug('[Carrot Compass] Captured chat completion prompt:', data.chat?.length, 'messages');
    });

    console.log('[Carrot Compass] Prompt Inspector initialized');
}
