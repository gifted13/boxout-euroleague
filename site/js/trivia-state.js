// ============================================================================
// Trivia game state — daily lives, attempt history and the leaderboard for
// the Trivia quiz, per account.
//
// Everything is kept in localStorage first (wrapped in try/catch — same
// pattern as favorites/saved views in state.js; it can legitimately come
// back empty in a private window or a fresh preview) so every read here
// (getActiveProfile(), endAttempt()) is instant and works fully offline —
// a quiz attempt in progress never waits on the network.
//
// Lives, best score and attempt totals ALSO mirror into Firestore's
// trivia_profiles/{id} collection (same id scheme as requests/{id} in
// account.js — a hash of the lowercased email; see firestore.rules), so the
// same account shows the same lives and stats on every device, and the
// leaderboard shows every member's best score, not just the device that
// earned it. pushProfile() pushes this device's state up after every
// mutation (best-effort, silent on failure — see the db plumbing note);
// syncActiveProfileFromRemote() pulls it back down once per boot;
// leaderboard() reads the shared collection for everyone's ranking. All
// three fall back to the old local-only behavior if Firestore isn't
// reachable (offline, or a no-Firebase local preview) so the page never
// just breaks — only cross-device consistency is lost, not the game.
// ============================================================================

const LS_KEY = 'el_intel_trivia_v1';
export const DAILY_LIVES = 5;
export const QUESTIONS_PER_ATTEMPT = 20;
export const TIME_LIMIT_SEC = 5 * 60;

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
const store = {
  activeProfileId: stored.activeProfileId || null,
  profiles: stored.profiles || {},
};
function persist() { safeSave(store); }

function todayStr() {
  // Local calendar date (not UTC) so "resets once a day" follows the
  // person's own day, not a server's.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

// A stable short id from the email (djb2-ish hash) — the same email always
// maps to the same local profile, so re-entering it finds existing stats
// rather than starting a fresh one.
function hashId(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return 'p_' + Math.abs(h).toString(36);
}

function ensureDailyReset(p) {
  const today = todayStr();
  if (p.lastResetDate !== today) {
    p.lives = DAILY_LIVES;
    p.lastResetDate = today;
  }
  return p;
}

export function getActiveProfile() {
  if (!store.activeProfileId) return null;
  const p = store.profiles[store.activeProfileId];
  if (!p) return null;
  const before = p.lastResetDate;
  ensureDailyReset(p);
  if (p.lastResetDate !== before) persist();
  return p;
}

export function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }

// ---------------------------------------------------------------------------
// Firestore sync — see file header. Mirrors account.js's getDb() exactly
// (same lazy import, same "null when the SDK isn't loaded" contract) so
// this module works identically in every context account.js already does.
// ---------------------------------------------------------------------------
let dbPromise = null;
function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const { getFirebaseDb } = await import('./firebase-init.js');
        return getFirebaseDb();
      } catch { return null; }
    })();
  }
  return dbPromise;
}
function profileDoc(db, id) { return db.doc('trivia_profiles/' + id); }

// Pushes this profile's current state — lives included, not just the
// leaderboard stats — up to Firestore. Called after every completed/
// abandoned attempt (endAttempt below, which is what changes lives) and
// once per boot via syncActiveProfileFromRemote() below. Fire-and-forget:
// never awaited by a caller, never throws — this device's own play is
// already saved locally regardless of whether this succeeds.
async function pushProfile(p) {
  const db = await getDb();
  if (!db) return;
  try {
    await profileDoc(db, p.id).set({
      id: p.id, email: p.email, nickname: p.nickname,
      lives: p.lives, lastResetDate: p.lastResetDate,
      bestScore: p.bestScore, bestPct: p.bestPct,
      totalAttempts: p.totalAttempts, totalCompletedAttempts: p.totalCompletedAttempts,
      totalCorrect: p.totalCorrect, totalQuestions: p.totalQuestions,
      lastPlayedAt: p.lastPlayedAt,
    });
  } catch { /* best-effort — see file header */ }
}

// Pulls the shared profile from Firestore and reconciles it into the local
// one, then returns the merged profile (persisted locally too) — this is
// what makes lives/stats match across every device signed into the same
// account, not just the leaderboard. Reconciliation is by lastPlayedAt:
// whichever copy (this device's local one, or the one in Firestore)
// reflects the most recent attempt wins, so a push that failed on a flaky
// connection can't silently hand back a life that was already spent on
// another device. Call once per boot (see js/views/trivia.js) — not on
// every hub redisplay within the same visit, which would just add network
// round trips for no benefit.
export async function syncActiveProfileFromRemote() {
  const p = getActiveProfile();
  if (!p) return null;
  const db = await getDb();
  if (db) {
    try {
      const snap = await profileDoc(db, p.id).get();
      if (snap.exists) {
        const remote = snap.data();
        if ((remote.lastPlayedAt || 0) > (p.lastPlayedAt || 0)) {
          Object.assign(p, {
            nickname: remote.nickname || p.nickname,
            lives: remote.lives, lastResetDate: remote.lastResetDate,
            lastPlayedAt: remote.lastPlayedAt,
            bestScore: remote.bestScore, bestPct: remote.bestPct,
            totalAttempts: remote.totalAttempts, totalCompletedAttempts: remote.totalCompletedAttempts,
            totalCorrect: remote.totalCorrect, totalQuestions: remote.totalQuestions,
          });
          ensureDailyReset(p); // remote's lastResetDate may be "yesterday" on THIS device's calendar
          persist();
        }
      }
    } catch { /* best-effort — keep the local copy as-is */ }
  }
  pushProfile(p); // make sure Firestore reflects whatever this device ended up with
  return p;
}

export function signIn(email, nickname) {
  const norm = normalizeEmail(email);
  const id = hashId(norm);
  let p = store.profiles[id];
  if (!p) {
    p = {
      id, email: norm, nickname: String(nickname || '').trim().slice(0, 24) || norm.split('@')[0],
      lives: DAILY_LIVES, lastResetDate: todayStr(),
      createdAt: Date.now(), lastPlayedAt: null,
      bestScore: 0, bestPct: 0,
      totalAttempts: 0, totalCompletedAttempts: 0,
      totalCorrect: 0, totalQuestions: 0,
      history: [],
    };
    store.profiles[id] = p;
  } else {
    if (nickname && nickname.trim()) p.nickname = nickname.trim().slice(0, 24);
    ensureDailyReset(p);
  }
  store.activeProfileId = id;
  persist();
  return p;
}

export function signOut() { store.activeProfileId = null; persist(); }

// Called exactly once per attempt, however it ends: finishing all 20
// (including via the 5-minute timer running out), or leaving mid-attempt.
// Completed attempts count toward best score / the leaderboard; an
// abandoned attempt still costs the life but isn't ranked.
export function endAttempt({ completed, abandoned, score, total, timeUsedSec }) {
  const p = getActiveProfile();
  if (!p) return null;
  p.lives = Math.max(0, p.lives - 1);
  p.lastPlayedAt = Date.now();
  p.history.unshift({ date: todayStr(), ts: Date.now(), score, total, timeUsedSec, completed: !!completed, abandoned: !!abandoned });
  p.history = p.history.slice(0, 25);
  p.totalAttempts += 1;
  if (completed) {
    p.totalCompletedAttempts += 1;
    p.totalCorrect += score;
    p.totalQuestions += total;
    const pct = total ? score / total : 0;
    if (score > p.bestScore || (score === p.bestScore && pct > p.bestPct)) {
      p.bestScore = score;
      p.bestPct = pct;
    }
  }
  persist();
  pushProfile(p); // best-effort, not awaited — see file header
  return p;
}

function sortRows(rows) {
  return rows
    .filter(p => p.totalCompletedAttempts > 0)
    .sort((a, b) => (b.bestScore - a.bestScore) || (b.bestPct - a.bestPct) || ((a.lastPlayedAt || 0) - (b.lastPlayedAt || 0)))
    .slice(0, 20);
}

// The leaderboard — every member (any device) who has completed at least
// one attempt, ranked by best score. Reads the shared trivia_profiles
// collection in Firestore so everyone sees the same ranking; falls back to
// this device's local list if Firestore isn't reachable (offline, or a
// no-Firebase local preview) so the page never just breaks. Async — see
// js/views/trivia.js for how the two call sites (hub, results) await it.
export async function leaderboard() {
  const db = await getDb();
  if (db) {
    try {
      const snap = await db.collection('trivia_profiles').orderBy('bestScore', 'desc').limit(50).get();
      const rows = [];
      snap.forEach(doc => rows.push(doc.data()));
      return sortRows(rows);
    } catch { /* fall through to the local-only list below */ }
  }
  return sortRows(Object.values(store.profiles));
}
