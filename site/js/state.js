// ============================================================================
// App-wide state: current season, sidebar state, favorites.
//
// Favorites/saved-views are meant to persist for a viewer across visits.
// Phase 1 stores them as a per-viewer convenience in localStorage (wrapped in
// try/catch per the artifact storage rules — it can legitimately come back
// empty in a private window or a fresh preview). A later phase can upgrade
// this to the `db` runtime capability for durable, cross-device storage
// without changing any call site below.
// ============================================================================

const LS_KEY = 'el_intel_state_v1';

function safeLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function safeSave(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

const stored = safeLoad();

export const state = {
  season: stored.season || 2025,
  favorites: { teams: new Set(stored.favTeams || []), players: new Set(stored.favPlayers || []) },
  savedViews: stored.savedViews || [],
  railOpen: false,
  theme: stored.theme || 'system',
  lang: stored.lang === 'el' ? 'el' : 'en',
};

if (typeof document !== 'undefined') {
  document.documentElement.lang = state.lang;
  // Apply a previously-chosen theme to the DOM as soon as this module
  // loads — setTheme() below only runs from a toggle click or a remote
  // settings sync, so without this a returning visitor's stored light/dark
  // choice would sit in state.theme but never reach the page until they
  // clicked the toggle again. 'system' needs no attribute (CSS already
  // falls back to prefers-color-scheme).
  if (state.theme === 'light' || state.theme === 'dark') document.documentElement.setAttribute('data-theme', state.theme);
}

const listeners = new Set();
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach(fn => fn(state)); persist(); }

function persist() {
  safeSave({
    season: state.season,
    favTeams: [...state.favorites.teams],
    favPlayers: [...state.favorites.players],
    savedViews: state.savedViews,
    theme: state.theme,
    lang: state.lang,
  });
}

export function setSeason(season) { state.season = season; notify(); }

export function setLang(lang) {
  state.lang = lang === 'el' ? 'el' : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = state.lang;
  notify();
}

export function toggleFavoriteTeam(code) {
  const s = state.favorites.teams;
  s.has(code) ? s.delete(code) : s.add(code);
  notify();
  return s.has(code);
}
export function toggleFavoritePlayer(id) {
  const s = state.favorites.players;
  s.has(id) ? s.delete(id) : s.add(id);
  notify();
  return s.has(id);
}
export function isFavoriteTeam(code) { return state.favorites.teams.has(code); }
export function isFavoritePlayer(id) { return state.favorites.players.has(id); }

export function addSavedView(view) {
  state.savedViews.push({ ...view, id: 'sv_' + Date.now(), createdAt: Date.now() });
  notify();
}
export function removeSavedView(id) {
  state.savedViews = state.savedViews.filter(v => v.id !== id);
  notify();
}

// A saved view is re-run live, not replayed from a snapshot: opening one hands its
// stored config to the target page via this one-shot handoff (read once, then cleared),
// and that page re-queries the CURRENT dataset with it, so the numbers are always fresh.
let pendingView = null;
export function runSavedView(view) { pendingView = view; navigateHook && navigateHook(view.path); }
export function consumePendingView(type) {
  if (pendingView && pendingView.type === type) { const v = pendingView; pendingView = null; return v; }
  return null;
}
let navigateHook = null;
export function _setNavigateHook(fn) { navigateHook = fn; }

export function setTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme === 'system' ? '' : theme);
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  notify();
}
