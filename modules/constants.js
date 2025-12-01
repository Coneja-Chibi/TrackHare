// =============================================================================
// CONSTANTS - Strategy icons, descriptions, and static mappings
// =============================================================================

// Strategy icons for entry trigger types
export const strategy = {
    constant: '🔵',
    normal: '🟢',
    vectorized: '🔗',
    vector: '🔗',
    rag: '🧠',
    decorator_activate: '⚡',
    decorator_suppress: '🚫',
    sticky: '📌',
    sticky_active: '📌',
    primary_key_match: '🟢',
    secondary_and_any: '🟡',
    secondary_not_all: '🟡',
    secondary_not_any: '🟡',
    secondary_and_all: '🟡',
    secondary_key_match: '🟡',
    normal_key_match: '🟢',
    persona: '👁️',
    persona_trigger: '👁️',
    character: '🎭',
    character_trigger: '🎭',
    scenario: '🎬',
    scenario_trigger: '🎬',
    system: '⚡',
    recursive: '🔄',
    unknown: '❓',
};

// Strategy descriptions for tooltips
export const strategyDescriptions = {
    constant: 'Always active (constant)',
    normal: 'Keyword match',
    vectorized: 'Vector/semantic match',
    vector: 'Vector/semantic match',
    primary_key_match: 'Primary keyword matched',
    secondary_and_any: 'Secondary keyword (AND ANY)',
    secondary_not_all: 'Secondary keyword (NOT ALL)',
    secondary_not_any: 'Secondary keyword (NOT ANY)',
    secondary_and_all: 'Secondary keyword (AND ALL)',
    secondary_key_match: 'Secondary keyword matched',
    sticky: 'Sticky effect active',
    decorator_activate: '@@activate decorator',
    persona: 'Matched in persona',
    character: 'Matched in character data',
    scenario: 'Matched in scenario',
    system: 'System activated',
    recursive: 'Triggered by recursion',
    unknown: 'Unknown trigger',
};

// Trigger reason display mapping
export const reasonDisplay = {
    'constant': { emoji: '🔵', text: 'CONSTANT', color: '#6366f1' },
    'vector': { emoji: '🧠', text: 'VECTOR', color: '#8b5cf6' },
    'decorator': { emoji: '⚡', text: 'FORCED', color: 'var(--ck-primary)' },
    'sticky': { emoji: '📌', text: 'STICKY', color: '#ef4444' },
    'key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
    'key_match_selective': { emoji: '🟡', text: 'KEY + LOGIC', color: '#f59e0b' },
    'primary_key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
    'secondary_and_any': { emoji: '🟡', text: 'KEY (AND ANY)', color: '#f59e0b' },
    'secondary_not_all': { emoji: '🟡', text: 'KEY (NOT ALL)', color: '#f59e0b' },
    'secondary_not_any': { emoji: '🟡', text: 'KEY (NOT ANY)', color: '#f59e0b' },
    'secondary_and_all': { emoji: '🟡', text: 'KEY (AND ALL)', color: '#f59e0b' },
    'activated': { emoji: '✓', text: 'ACTIVATED', color: '#10b981' },
    'forced': { emoji: '⚡', text: 'FORCED', color: 'var(--ck-primary)' },
    'suppressed': { emoji: '🚫', text: 'SUPPRESSED', color: '#64748b' },
    'secondary_key_match': { emoji: '🔗', text: 'SECONDARY KEYS', color: '#06b6d4' },
    'system': { emoji: '⚙️', text: 'SYSTEM', color: '#475569' },
    'persona': { emoji: '👁️', text: 'PERSONA', color: '#d946ef' },
    'character': { emoji: '🎭', text: 'CHARACTER', color: '#f59e0b' },
    'scenario': { emoji: '🎬', text: 'SCENARIO', color: '#84cc16' },
    'authors_note': { emoji: '📝', text: 'AUTHOR\'S NOTE', color: '#8b5cf6' },
    'normal_key_match': { emoji: '🟢', text: 'KEY MATCH', color: '#10b981' },
};

// Position name mapping
export const positionNames = {
    0: 'Before Character',
    1: 'After Character',
    2: 'Author\'s Note Top',
    3: 'Author\'s Note Bottom',
    4: 'At Depth',
    5: 'Extension Module Top',
    6: 'Extension Module Bottom',
};

// Selective logic names
export const selectiveLogicNames = {
    0: 'AND ANY',
    1: 'NOT ALL',
    2: 'NOT ANY',
    3: 'AND ALL',
};

// Reason descriptions for debug display
export const reasonDescriptions = {
    'forced': 'Force activated by @@activate decorator',
    'suppressed': 'Suppressed by @@dont_activate decorator',
    'constant': 'Always active constant entry',
    'vector': 'Triggered by RAG/Vector similarity',
    'sticky': 'Active due to sticky effect',
    'persona': 'Keys found in user persona',
    'character': 'Keys found in character card',
    'scenario': 'Keys found in scenario text',
    'authors_note': 'Keys found in Author\'s Note',
    'normal_key_match': 'Standard key-based trigger',
};
