// ============================================================================
// Data Layer — loads the processed (Analytics Engine output) JSON, caches it,
// and exposes derived-query helpers. This is the ONLY module that touches
// fetch(); every view reads through here so there is one place that knows
// what "raw" vs "derived" means.
//
// Layer boundary: everything in site/data/{season}/*.json was computed once,
// offline, by scripts/build_processed.py from the raw euroleague_paid API
// response (see site/data/manifest.json for exactly which fields are direct
// API passthrough vs. derived). This module adds no new statistics of its
// own — only filtering, sorting, ranking and percentile math over what the
// ETL already computed.
// ============================================================================

export const SEASONS = [2026, 2025, 2024];
export const SEASON_LABELS = { 2026: '2026–27', 2025: '2025–26', 2024: '2024–25' };

// Seasons whose EuroLeague fixture list has been published but which haven't
// tipped off yet — no boxscore/standings data exists for these, so the app
// shows a "coming soon" screen instead of trying to render empty stat pages.
// Confirmed against the live schedule API (see js/views/coming-soon.js).
export const SEASON_START_DATES = { 2026: '2026-09-24' };
// A season stops being "upcoming" once its start date has actually arrived —
// not merely because it HAS a start date. The earlier version of this
// function returned true forever for any season listed in
// SEASON_START_DATES, which would have permanently shown "coming soon" for
// 2026 even after real games (and real data) existed, since the key is
// never removed. Comparing against the clock is what actually flips the
// site over automatically at tip-off.
export function isUpcomingSeason(season) {
  const startDate = SEASON_START_DATES[season];
  if (!startDate) return false;
  return Date.now() < new Date(startDate + 'T00:00:00Z').getTime();
}

const cache = new Map();

// Drops every cached fetch so the next load re-requests the published JSON
// files instead of replaying what's in memory. This is what the "Refresh
// data" control calls — see the note on why that's the honest ceiling for
// a static, published artifact (js/app.js, refreshData()).
export function clearCache() { cache.clear(); }

// `force: true` (used by the super-admin's "Refresh data" button, see
// js/app.js's refreshData()) skips the in-memory read AND, for live
// endpoints, appends a cache-busting query param so the server-side
// function cache (see netlify/functions/schedule.js) is bypassed too — a
// plain clearCache() alone would only empty this browser-side cache, not
// the 5-minute cache that function keeps to spare the upstream API.
async function fetchJSON(path, { force = false } = {}) {
  if (!force && cache.has(path)) return cache.get(path);
  const url = force ? path + (path.includes('?') ? '&' : '?') + 'fresh=1&t=' + Date.now() : path;
  const p = fetch(url).then(r => {
    if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
    return r.json();
  }).catch(err => {
    cache.delete(path);
    throw err;
  });
  cache.set(path, p);
  return p;
}

export function loadManifest() { return fetchJSON('data/manifest.json'); }

// Live schedule/results — see netlify/functions/schedule.js. A server-side
// function (not the browser) calls euroleague-advanced-api.eu directly, so
// this always reflects the real feed, not a snapshot baked in at deploy
// time. Same field shape as the old static data/{season}/schedule.json, so
// nothing else that reads a season's `schedule` array needed to change.
function loadLiveSchedule(season, opts) {
  return fetchJSON(`/.netlify/functions/schedule?season=${season}`, opts);
}

// Live standings — see netlify/functions/standings.js. Not part of the
// per-season dataset bundle (loadSeason() below) because nothing currently
// reads a `standings` key there; call this directly wherever a live
// standings table is wanted. Falls back to [] on failure so a caller can
// render nothing rather than throw.
export function loadStandings(season, opts) {
  return fetchJSON(`/.netlify/functions/standings?season=${season}`, opts).catch(() => []);
}

// Authenticated paid-tier proxy — see netlify/functions/advanced.js. The
// real API token never leaves that function; this just calls it. `path` is
// the upstream path (e.g. '/Euroleague/players/season') and `params` are
// that endpoint's own query params (season, phase, stats_type, ...) — see
// https://euroleague-advanced-api.eu/docs for what each path needs.
export function loadAdvanced(path, params = {}, opts) {
  const qs = new URLSearchParams({ path, ...params }).toString();
  return fetchJSON(`/.netlify/functions/advanced?${qs}`, opts);
}

// A pre-computed bank of trivia questions (season leaders + near-miss decoys),
// built once from the processed season stats — see js/views/trivia.js for
// how it's sampled into a 20-question attempt.
export function loadTriviaQuestions() { return fetchJSON('data/trivia_questions.json'); }

const DATASETS = [
  'team_season', 'team_playoffs', 'team_games', 'player_season', 'player_playoffs',
  'player_game_log', 'rosters', 'fouls_team_summary', 'players_msi_season',
  'shot_zones', 'schedule', 'league_averages',
];

function loadDataset(season, name, opts) {
  // 'schedule' has its own dedicated live proxy (loadLiveSchedule above).
  // Every other dataset is a static file published as part of this site's
  // deploy — see data/manifest.json for what each one is and how it was
  // built (scripts/build_processed.py, run by hand against freshly-pulled
  // data, with the resulting site/data/{season}/*.json files re-uploaded).
  if (name === 'schedule') return loadLiveSchedule(season, opts);
  return fetchJSON(`data/${season}/${name}.json`, opts);
}

/** Load every dataset for a season in parallel; returns a keyed object. */
export async function loadSeason(season, opts) {
  const key = `season:${season}`;
  if (!(opts && opts.force) && cache.has(key)) return cache.get(key);
  const p = Promise.all(DATASETS.map(name => loadDataset(season, name, opts).catch(err => {
    console.warn(`[data] ${season}/${name} failed to load`, err);
    return name === 'player_season' ? { qualifier_games: 0, players: [] } : (name === 'shot_zones' || name === 'rosters' ? {} : []);
  }))).then(results => {
    const out = {};
    DATASETS.forEach((name, i) => { out[name] = results[i]; });
    return out;
  });
  cache.set(key, p);
  return p;
}

// ----------------------------------------------------------------------------
// Derived query helpers
// ----------------------------------------------------------------------------

export function teamByCode(teamSeason, code) {
  return teamSeason.find(t => t.team_code === code);
}

export function playerById(players, id) {
  return players.find(p => p.Player_ID === id);
}

/** Ranked leaderboard for a stat. lowerIsBetter stats (TOV, PF, DRtg) sort ascending.
 * `qualifiedOnly` filters to `qualified` rows, but only when that leaves at
 * least one row — early in a season (qualifier_games=8, everyone GP<8) it
 * never does, so this falls back to the full pool instead of returning an
 * empty leaderboard (which crashed callers that assume a top-1 result). */
export function leaders(rows, statKey, { qualifiedOnly = true, limit = 10, lowerIsBetter = false } = {}) {
  let pool = rows.filter(r => r[statKey] !== null && r[statKey] !== undefined && !Number.isNaN(r[statKey]));
  if (qualifiedOnly && pool.some(r => 'qualified' in r)) {
    const qualified = pool.filter(r => r.qualified);
    if (qualified.length) pool = qualified;
  }
  pool = pool.slice().sort((a, b) => lowerIsBetter ? a[statKey] - b[statKey] : b[statKey] - a[statKey]);
  return pool.slice(0, limit);
}

/** The `qualified` subset of a player list, falling back to the full list
 * when the qualified subset is empty (early season: qualifier_games=8 but
 * nobody has played 8 games yet). Used anywhere a percentile/comparison
 * pool needs to never be empty. */
export function qualifiedPool(players) {
  const qualified = players.filter(p => p.qualified);
  return qualified.length ? qualified : players;
}

/** Percentile (0-100) of `value` within `pool` for `statKey`. */
export function percentile(pool, statKey, value, lowerIsBetter = false) {
  const vals = pool.map(r => r[statKey]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  if (!vals.length || value === null || value === undefined) return null;
  const below = vals.filter(v => lowerIsBetter ? v > value : v < value).length;
  return Math.round((below / vals.length) * 100);
}

export function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
export function stdev(arr) { const m = mean(arr); return arr.length ? Math.sqrt(mean(arr.map(v => (v - m) ** 2))) : 0; }

/** z-score of value vs pool for statKey — used by the Analytics Lab to flag outliers. */
export function zscore(pool, statKey, value) {
  const vals = pool.map(r => r[statKey]).filter(v => v !== null && v !== undefined && !Number.isNaN(v));
  const m = mean(vals), sd = stdev(vals);
  if (!sd) return 0;
  return (value - m) / sd;
}

/** Pearson correlation coefficient between two stat keys across a pool of rows. */
export function pearson(pool, keyX, keyY) {
  const pairs = pool.map(r => [r[keyX], r[keyY]]).filter(([x, y]) => x !== null && x !== undefined && y !== null && y !== undefined && !Number.isNaN(x) && !Number.isNaN(y));
  const n = pairs.length;
  if (n < 3) return null;
  const xs = pairs.map(p => p[0]), ys = pairs.map(p => p[1]);
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; num += dx * dy; dx2 += dx * dx; dy2 += dy * dy; }
  const denom = Math.sqrt(dx2 * dy2);
  return denom ? num / denom : 0;
}

export function last5(games) {
  return games.slice().sort((a, b) => a.round - b.round).slice(-5);
}

/** Simple fuzzy-ish substring match used by search & command palette. */
export function fuzzyMatch(hay, needle) {
  if (!needle) return true;
  hay = (hay || '').toLowerCase();
  needle = needle.toLowerCase().trim();
  if (!needle) return true;
  return hay.includes(needle);
}

export function playerDisplayTeam(teamSeason, code) {
  const t = teamByCode(teamSeason, code);
  return t ? t.team_name : code;
}
