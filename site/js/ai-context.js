// ============================================================================
// Tiny store holding "what the user is currently looking at" — each view sets
// a compact, relevant data snapshot here (never the whole dataset) so the
// Ask AI panel can answer contextually without the user re-explaining.
// ============================================================================

let current = { page: 'Command Center', data: {} };

export function setAIContext(page, data) { current = { page, data }; }
export function getAIContext() { return current; }
