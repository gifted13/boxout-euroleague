// ============================================================================
// Site-wide "account" — the mandatory sign-in gate shown once per device,
// before any page (or the nav menu itself) is reachable (see accountGate()
// in app.js).
//
// BoxOut is backed by a real Firebase project (see firebase-init.js), not
// the Claude Artifact `db` capability it started with — that capability only
// serves viewers signed into claude.ai, which can't support a genuinely
// public "anyone with the link" site. An account is a real, shared record:
// signing up writes a "requests/<id>" document (status: approved immediately
// — no admin review step, see signUp() below — plus a hashed password and a
// tosAccepted flag) that anyone with the link can see. The super admin (see
// isSuperAdmin() below) can still ban, delete, or change anyone's cosmetic
// role from the /admin control panel afterwards. Once signed up, signing in
// with the same email + password from any device picks the same account
// back up.
//
// getDb() resolves null when the real Firebase SDK isn't available in this
// context (e.g. app.html's <script> tags didn't load — offline, or a local
// preview that doesn't include them). Sign-up/sign-in still work there
// against the local mirror only, so the app stays testable outside the real
// runtime.
//
// PASSWORDS — read this before changing anything below. BoxOut is a public
// page with no backend server. Every password check here (hashing included)
// runs entirely in the viewer's own browser, against a hash that — once
// stored in Firestore — is readable by anyone who opens dev tools or calls
// the Firestore API directly, not only by the person it belongs to (see the
// header of firestore.rules for the full accepted trade-off). Hashing stops
// a casual "view source" from handing a password over directly; it is not
// real authentication, and it was built this way with that limitation
// explicitly accepted (see the project notes) rather than left unstated.
// Nobody should be told this is safe to reuse from anywhere else. The ONE
// exception is the super admin: isSuperAdmin()/syncSuperAdminAuth() below
// also establish a REAL Firebase Auth session for that one account, because
// Firestore's security rules need one real identity to trust for
// admin-only writes — see firestore.rules.
//
// ACCOUNT MODEL
// - A small local mirror lives in localStorage (LS_KEY) so most reads
//   (getAccount(), isAdmin()) are synchronous and don't touch the network on
//   every call. It's a per-viewer convenience, wrapped in try/catch — it can
//   legitimately come back empty (private window, cleared storage).
// - The `requests/<hash of email>` document in Firestore, when available, is
//   the shared source of truth for status/role/nickname/favoriteTeamCode/
//   passwordHash/lang/theme. subscribeAccountStatus() mirrors it into
//   localStorage live and asks the app to re-render when something the gate
//   or nav cares about changes.
// - getAccount() returns non-null ONLY for an approved account — every
//   other call site in the app (My Team, Trivia, Chat) can keep treating a
//   non-null getAccount() as "fully ready to use", exactly as before.
// - A legacy account approved before passwords existed simply has no
//   passwordHash on file yet; signIn() below reports that distinctly
//   ('no_password_set') so the gate can offer a one-time "set your
//   password" step instead of a hard failure.
// ============================================================================

// The one account that always bootstraps as super admin — the seed of trust
// the whole approval system starts from (only the super admin can open
// /admin to approve anyone else, per isSuperAdmin() below). Unlike every
// other account in this app, this one IS backed by real enforcement:
// Firestore's security rules (firestore.rules) only grant admin-only writes
// to a real, separately-authenticated Firebase Auth session for this exact
// email (see syncSuperAdminAuth() below) — not to anything the client claims
// about itself. `role` (member/admin) is a different, purely cosmetic thing
// the super admin can hand out to anyone from /admin; it grants no access.
export const ADMIN_EMAIL = 'tzografos_@hotmail.gr';

const LS_KEY = 'el_intel_account_v1';

function safeLoad() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function safeSave(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}

const store = safeLoad();

export function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()); }
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

// A stable id from the email (djb2-ish hash) — also the db document id, so
// re-using the same email always finds the same account/request.
export function docIdForEmail(email) {
  const norm = normalizeEmail(email);
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  return 'p_' + Math.abs(h).toString(36);
}

// ---------------------------------------------------------------------------
// db plumbing — one resolution per page load, shared by account.js,
// admin.js and chat.js. Backed by a real Firebase project (see
// firebase-init.js) rather than the Claude Artifact `db` capability BoxOut
// started with: that capability only serves viewers signed into claude.ai,
// which can't support a genuinely public "anyone with the link" site. The
// switch happens ENTIRELY here — requestDoc/resetDoc and every call site in
// admin.js/chat.js/the rest of this file are unchanged, because Firestore's
// classic API (what firebase-init.js exposes) is what this shape was always
// modeled on.
// ---------------------------------------------------------------------------
let dbPromise = null;
export function getDb() {
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
export function requestDoc(db, email) { return db.doc('requests/' + docIdForEmail(email)); }
export function resetDoc(db, email) { return db.doc('password_resets/' + docIdForEmail(email)); }

// ---------------------------------------------------------------------------
// Password hashing — SHA-256 via the Web Crypto API. See the file header:
// this is a disclosed speed bump, not real authentication.
// ---------------------------------------------------------------------------
async function sha256Hex(value) {
  try {
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}
export async function hashPassword(password) { return await sha256Hex(password); }
async function passwordMatches(password, hash) {
  if (!hash) return false;
  const h = await sha256Hex(password);
  return !!h && h === hash;
}

// The fixed password that unlocks ADMIN_EMAIL's very first sign-up (the
// bootstrap admin/super admin), so auto-approving that one address needs
// more than just knowing/guessing it. It also becomes that account's
// ordinary sign-in password from then on — the super admin can change it
// later like anyone else, via the "forgot password" flow (see
// requestPasswordReset/adminApprovePasswordReset/setInitialPassword below),
// without losing super-admin status, which is tied to the email itself
// (see isSuperAdmin()), not to this password. Only the hash is kept here.
const ADMIN_BOOTSTRAP_HASH = 'af405d456d964cad22a17c29e6b266c1fcc612d5cd7bf79cea78d7d04b0049b2';

export function isAdminEmailAddress(email) { return normalizeEmail(email) === normalizeEmail(ADMIN_EMAIL); }

// Best-effort: keeps a real Firebase Auth session in sync with the super
// admin's account here, so Firestore's security rules (see firestore.rules)
// can recognize the real site owner for privileged writes — approve/reject/
// ban/delete/role-change/reset-approve. Ordinary members never touch
// Firebase Auth at all; only ADMIN_EMAIL does, from signUp()/signIn()/
// changePassword() below. Failure here is silent and non-fatal: the app
// account still works normally either way, but admin-only Firestore writes
// would then be rejected by the security rules until this succeeds again
// (most likely cause: the Firebase Auth user's password — set once, by hand,
// in the Firebase console's Authentication > Users tab — has drifted out of
// sync with the app's own password; changePassword() below tries to keep
// the two in lockstep going forward).
async function syncSuperAdminAuth(email, password) {
  if (!isAdminEmailAddress(email)) return;
  try {
    const { getFirebaseAuth } = await import('./firebase-init.js');
    const auth = getFirebaseAuth();
    if (!auth) return;
    await auth.signInWithEmailAndPassword(normalizeEmail(email), password);
  } catch { /* best-effort — see note above */ }
}

// ---------------------------------------------------------------------------
// Local mirror
// ---------------------------------------------------------------------------

// The raw local record, whatever its status (pending/approved/rejected) —
// used by account-gate.js to decide which screen to show. Most of the rest
// of the app should use getAccount() instead.
export function getLocalRecord() {
  if (!store.email) return null;
  return { email: store.email, nickname: store.nickname, favoriteTeamCode: store.favoriteTeamCode, status: store.status || 'approved', role: store.role || 'member', avatarColor: store.avatarColor || null };
}

// Non-null ONLY for a fully approved account — the contract every other
// call site in the app already relies on. A banned account (status
// 'banned') deliberately falls through the same door as pending/rejected:
// it just isn't 'approved', so getAccount() is null and accountGate() in
// app.js shows the matching status screen instead of the app.
export function getAccount() {
  const r = getLocalRecord();
  if (!r || r.status !== 'approved') return null;
  return { email: r.email, nickname: r.nickname, favoriteTeamCode: r.favoriteTeamCode, role: r.role, avatarColor: r.avatarColor };
}

export function isAdmin() {
  const r = getLocalRecord();
  return !!r && r.status === 'approved' && r.role === 'admin';
}

// The single hardcoded super-admin account — the ONLY account that can open
// /admin, see the ban/approve/reset controls, or use the "refresh data"
// button. Deliberately independent of the `role` field: `role` (member/
// admin) is a cosmetic label the super admin can hand out to anyone, with
// no actual dashboard access attached to it anymore.
export function isSuperAdmin() {
  const r = getLocalRecord();
  return !!r && r.status === 'approved' && isAdminEmailAddress(r.email);
}

function setLocal(fields) {
  Object.assign(store, fields);
  safeSave(store);
}

// ---------------------------------------------------------------------------
// Sign up — a brand-new email only. Returns { ok:false, error } for the
// gate to turn into localized copy: 'already_registered' (switch the caller
// to sign-in instead) or 'wrong_admin_password' (ADMIN_EMAIL's bootstrap
// check failed). Otherwise { ok:true, record }.
// ---------------------------------------------------------------------------
// tosAccepted must be true — signup is open (no admin approval step), but
// accepting the Terms & Conditions (which includes the marketing-contact
// consent clause — see accountGate.tosBody3 in i18n.js) is still mandatory,
// enforced both here and server-side in firestore.rules' requests/ create
// rule, so it can't be bypassed by calling the Firestore API directly.
export async function signUp({ email, nickname, favoriteTeamCode, password, lang, theme, tosAccepted }) {
  const norm = normalizeEmail(email);
  const nick = String(nickname || '').trim().slice(0, 24);
  const isAdminEmail = isAdminEmailAddress(norm);
  const db = await getDb();

  if (!tosAccepted) return { ok: false, error: 'tos_required' };

  if (db) {
    try {
      const existing = await requestDoc(db, norm).get();
      if (existing.exists) return { ok: false, error: 'already_registered' };
    } catch { /* best-effort — fall through and try to create it */ }
  } else if (store.email === norm) {
    return { ok: false, error: 'already_registered' };
  }

  if (isAdminEmail) {
    const bootstrapOk = await passwordMatches(password, ADMIN_BOOTSTRAP_HASH);
    if (!bootstrapOk) return { ok: false, error: 'wrong_admin_password' };
    // Must authenticate as the real super admin via Firebase Auth BEFORE
    // creating this doc — the security rules only allow a status:'approved'
    // /role:'admin' create for ADMIN_EMAIL while request.auth already proves
    // it's really them (see firestore.rules), otherwise anyone could race
    // to create this doc themselves and claim admin status.
    await syncSuperAdminAuth(norm, password);
  }

  const passwordHash = await hashPassword(password);
  const role = isAdminEmail ? 'admin' : 'member';
  // Signup is open — every new account is 'approved' immediately, no admin
  // review step. (The /admin panel's ban/delete/role controls still work on
  // any approved account afterwards — see js/views/admin.js.)
  const status = 'approved';
  const tosAcceptedAt = Date.now();
  setLocal({ email: norm, nickname: nick, favoriteTeamCode, status, role, passwordHash });
  if (!db) return { ok: true, record: getLocalRecord() };
  try {
    await requestDoc(db, norm).set({
      email: norm, nickname: nick, favoriteTeamCode, status, role, passwordHash,
      requestedAt: Date.now(), createdAt: Date.now(), lang, theme,
      tosAccepted: true, tosAcceptedAt,
    });
  } catch { /* best-effort — the local record still drives the UI either way */ }
  return { ok: true, record: getLocalRecord() };
}

// ---------------------------------------------------------------------------
// Sign in — an existing email. Never resets an approved/pending/rejected
// account back to pending; it just picks up whatever status is on file.
// error is one of: 'not_found', 'no_password_set' (a legacy account — the
// gate should offer setInitialPassword() instead), 'wrong_password'.
// ---------------------------------------------------------------------------
export async function signIn({ email, password }) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  let data = null;
  if (db) {
    try {
      const snap = await requestDoc(db, norm).get();
      if (snap.exists) data = snap.data();
    } catch { /* treat as not found — best effort */ }
  } else if (store.email === norm) {
    data = { nickname: store.nickname, favoriteTeamCode: store.favoriteTeamCode, status: store.status, role: store.role, passwordHash: store.passwordHash };
  }
  if (!data) return { ok: false, error: 'not_found' };
  if (!data.passwordHash) return { ok: false, error: 'no_password_set' };
  const match = await passwordMatches(password, data.passwordHash);
  if (!match) return { ok: false, error: 'wrong_password' };
  await syncSuperAdminAuth(norm, password);
  setLocal({ email: norm, nickname: data.nickname, favoriteTeamCode: data.favoriteTeamCode, status: data.status || 'approved', role: data.role || 'member', passwordHash: data.passwordHash });
  return { ok: true, record: getLocalRecord() };
}

// Sets a password for an EXISTING account — the legacy-account migration
// step (signIn() returned 'no_password_set') and also the self-service step
// of the "forgot password" flow: once the super admin approves a reset
// request (adminApprovePasswordReset below), the user calls this directly
// to set their own new password. Never creates a new account.
export async function setInitialPassword({ email, password }) {
  const norm = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const db = await getDb();
  if (!db) {
    if (store.email !== norm) return { ok: false, error: 'not_found' };
    setLocal({ passwordHash });
    return { ok: true, record: getLocalRecord() };
  }
  try {
    const ref = requestDoc(db, norm);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'not_found' };
    const data = snap.data();
    await ref.update({ passwordHash });
    setLocal({ email: norm, nickname: data.nickname, favoriteTeamCode: data.favoriteTeamCode, status: data.status || 'approved', role: data.role || 'member', passwordHash });
    // Also clears any pending/approved password-reset request for this
    // account — this is the self-service step of that flow (see
    // requestPasswordReset/adminApprovePasswordReset below), so once the
    // user has actually set their new password there's nothing left open.
    try { await resetDoc(db, norm).delete(); } catch { /* best-effort */ }
    return { ok: true, record: getLocalRecord() };
  } catch { return { ok: false, error: 'network' }; }
}

// Rejected accounts can ask for a second look without re-entering a
// password — same account, same credentials, just back in the pending
// queue with whatever nickname/team they resubmit. Only works on an
// existing (rejected) record; never creates a new one.
export async function resubmitAfterRejection({ email, nickname, favoriteTeamCode }) {
  const norm = normalizeEmail(email);
  const nick = String(nickname || '').trim().slice(0, 24);
  const db = await getDb();
  if (!db) {
    setLocal({ nickname: nick, favoriteTeamCode, status: 'approved' });
    return { ok: true, record: getLocalRecord() };
  }
  try {
    const ref = requestDoc(db, norm);
    const snap = await ref.get();
    if (!snap.exists) return { ok: false, error: 'not_found' };
    await ref.update({ nickname: nick, favoriteTeamCode, status: 'pending', requestedAt: Date.now() });
    setLocal({ nickname: nick, favoriteTeamCode, status: 'pending' });
    return { ok: true, record: getLocalRecord() };
  } catch { return { ok: false, error: 'network' }; }
}

// "Forgot password" — records a request the super admin sees in /admin
// (BoxOut has no way to actually send email from a published, backend-less
// page). Best-effort and silent about whether the email is real, same as
// most real reset flows. status starts 'pending'; the super admin's
// "Approve" click (adminApprovePasswordReset below) flips it to 'approved',
// which is what lets the user set their own new password — the admin never
// sees or types the new password themselves.
export async function requestPasswordReset(email) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  if (!db) return { ok: true };
  try {
    await resetDoc(db, norm).set({ email: norm, status: 'pending', requestedAt: Date.now() });
    return { ok: true };
  } catch { return { ok: false }; }
}

// Live updates on a single password_resets/<id> doc, used by the pre-auth
// "forgot password" screen so it can move from "waiting for admin" straight
// to the user's own set-new-password form the moment the super admin
// approves — no polling, no manual refresh. onChange(status|null) fires
// with the current status ('pending'/'approved') or null once the request
// doc is gone (dismissed, or already completed via setInitialPassword).
export async function subscribePasswordResetStatus(email, onChange) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  if (!db) return () => {};
  return resetDoc(db, norm).onSnapshot((snap) => {
    onChange(snap.exists ? (snap.data().status || 'pending') : null);
  }, () => { /* terminal db error — leave the last-known state on screen */ });
}

// Super-admin-only: approves a pending "forgot password" request so the
// user can set their own new password (the gate's account-gate.js reacts to
// this via subscribePasswordResetStatus and swaps in the set-password
// form). Deliberately never touches the account's passwordHash itself.
export async function adminApprovePasswordReset(email) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  if (!db) return { ok: false, error: 'no_db' };
  try {
    await resetDoc(db, norm).update({ status: 'approved', approvedAt: Date.now() });
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
}

// Super-admin-only: dismisses a reset request without approving it (e.g. it
// looks bogus) — just deletes the request doc.
export async function adminDismissPasswordReset(email) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  if (!db) return { ok: false, error: 'no_db' };
  try {
    await resetDoc(db, norm).delete();
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
}

// Super-admin-only: changes an already-approved user's role (member/admin)
// at any time — not just at initial approval. `role` is purely a cosmetic
// label from here on; it grants no dashboard access (see isSuperAdmin()).
export async function adminSetRole(email, role) {
  const norm = normalizeEmail(email);
  const db = await getDb();
  if (!db) return { ok: false, error: 'no_db' };
  try {
    await requestDoc(db, norm).update({ role });
    return { ok: true };
  } catch { return { ok: false, error: 'network' }; }
}

// Re-reads the shared request doc once (used right after signing in/up,
// and by accountGate() as a cheap catch-up when no live subscription is
// running yet) and reconciles it into the local mirror.
export async function refreshFromRemote() {
  const r = getLocalRecord();
  if (!r) return null;
  const db = await getDb();
  if (!db) return r;
  try {
    const snap = await requestDoc(db, r.email).get();
    if (!snap.exists) { clearLocal(); return null; }
    const data = snap.data();
    setLocal({ nickname: data.nickname, favoriteTeamCode: data.favoriteTeamCode, status: data.status, role: data.role || 'member', avatarColor: data.avatarColor || null });
    return getLocalRecord();
  } catch { return r; }
}

// Live updates: call once (from app.js boot()) when a local record exists.
// Fires onChange() whenever status/role/nickname/team/existence changes in
// a way the gate or nav needs to react to (approval landing, a role
// change, rejection, an admin deleting the account) — never on a no-op
// delivery, so the caller can just re-dispatch navigation without guarding
// against redundant re-renders.
export async function subscribeAccountStatus(onChange) {
  const r = getLocalRecord();
  if (!r) return () => {};
  const db = await getDb();
  if (!db) return () => {};
  let prevSignature = JSON.stringify([r.status, r.role, r.nickname, r.favoriteTeamCode, r.avatarColor]);
  return requestDoc(db, r.email).onSnapshot((snap) => {
    if (!snap.exists) {
      if (getLocalRecord()) { clearLocal(); onChange(); }
      return;
    }
    const data = snap.data();
    const signature = JSON.stringify([data.status, data.role, data.nickname, data.favoriteTeamCode, data.avatarColor || null]);
    if (signature === prevSignature) return;
    prevSignature = signature;
    setLocal({ nickname: data.nickname, favoriteTeamCode: data.favoriteTeamCode, status: data.status, role: data.role || 'member', avatarColor: data.avatarColor || null });
    onChange();
  }, () => { /* terminal db error — the local mirror stays as the last-known state */ });
}

// One-time read of the account's remembered language/theme, used right
// after the gate passes to hydrate this device with settings made
// elsewhere. Returns null when unavailable/unset — callers should treat
// that as "nothing to change here".
export async function fetchRemoteSettings() {
  const r = getLocalRecord();
  if (!r) return null;
  const db = await getDb();
  if (!db) return null;
  try {
    const snap = await requestDoc(db, r.email).get();
    if (!snap.exists) return null;
    const data = snap.data();
    return { lang: data.lang, theme: data.theme };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Profile edits (My Team, Profile)
// ---------------------------------------------------------------------------

export async function updateFavoriteTeam(code) {
  setLocal({ favoriteTeamCode: code });
  await pushUpdate({ favoriteTeamCode: code });
  return getAccount();
}

export async function updateNickname(nickname) {
  const nick = String(nickname || '').trim().slice(0, 24);
  if (!nick) return getAccount();
  setLocal({ nickname: nick });
  await pushUpdate({ nickname: nick });
  return getAccount();
}

// `color` is one of format.js's AVATAR_HUES tokens (or null to go back to
// the deterministic hash color) — see js/views/profile.js for the picker.
export async function updateAvatarColor(color) {
  setLocal({ avatarColor: color || null });
  await pushUpdate({ avatarColor: color || null });
  return getAccount();
}

async function pushUpdate(fields) {
  const r = getLocalRecord();
  if (!r) return;
  const db = await getDb();
  if (!db) return;
  try { await requestDoc(db, r.email).update(fields); } catch { /* best-effort */ }
}

// Change the signed-in account's own password — requires the current one
// to match on file first (this device is already trusted, but a second
// factor on an actual credential change is cheap insurance against, say, a
// shared/unlocked browser). error is 'wrong_password' or 'not_found'
// (no local record to act on).
export async function changePassword({ currentPassword, newPassword }) {
  const r = getLocalRecord();
  if (!r) return { ok: false, error: 'not_found' };
  const db = await getDb();
  let hash = store.passwordHash;
  if (db) {
    try {
      const snap = await requestDoc(db, r.email).get();
      if (!snap.exists) return { ok: false, error: 'not_found' };
      hash = snap.data().passwordHash;
    } catch { return { ok: false, error: 'network' }; }
  }
  const match = await passwordMatches(currentPassword, hash);
  if (!match) return { ok: false, error: 'wrong_password' };
  const passwordHash = await hashPassword(newPassword);
  setLocal({ passwordHash });
  if (isAdminEmailAddress(r.email)) await syncSuperAdminPassword(r.email, currentPassword, newPassword);
  if (!db) return { ok: true };
  try { await requestDoc(db, r.email).update({ passwordHash }); return { ok: true }; } catch { return { ok: false, error: 'network' }; }
}

// Keeps the super admin's real Firebase Auth password in lockstep with the
// app's own password whenever they change it here — otherwise the two would
// drift apart and syncSuperAdminAuth() above would start silently failing on
// every future sign-in, quietly locking the super admin out of admin-only
// Firestore writes even though the app itself still lets them "sign in".
// Firebase requires a fresh sign-in right before a password change, hence
// re-authenticating with the (already-verified) current password first.
async function syncSuperAdminPassword(email, currentPassword, newPassword) {
  try {
    const { getFirebaseAuth } = await import('./firebase-init.js');
    const auth = getFirebaseAuth();
    if (!auth) return;
    await auth.signInWithEmailAndPassword(normalizeEmail(email), currentPassword);
    if (auth.currentUser) await auth.currentUser.updatePassword(newPassword);
  } catch { /* best-effort — see syncSuperAdminAuth()'s note above */ }
}

// Best-effort, fire-and-forget sync of language/theme onto the account's
// shared doc so a returning visit on another device picks them back up.
// Called from app.js whenever either changes; no-ops without an approved,
// db-backed account, and never blocks the UI.
let lastPushedSettings = null;
export function pushSettings(lang, theme) {
  const r = getLocalRecord();
  if (!r || r.status !== 'approved') return;
  const sig = lang + '|' + theme;
  if (sig === lastPushedSettings) return;
  lastPushedSettings = sig;
  getDb().then(db => { if (db) requestDoc(db, r.email).update({ lang, theme }).catch(() => {}); });
}

// Best-effort, fire-and-forget: stamps "lastSeenAt" on the account's shared
// doc so the super admin can see, per member, when they last opened the
// site (rendered in /admin — see admin.js). Called once per page load from
// app.js's accountGate(), never awaited and never blocks routing — same
// minimal, no-op-safe shape as pushSettings() above.
export function touchLastSeen() {
  const r = getLocalRecord();
  if (!r || r.status !== 'approved') return;
  getDb().then(db => { if (db) requestDoc(db, r.email).update({ lastSeenAt: Date.now() }).catch(() => {}); });
}

// ---------------------------------------------------------------------------
// Sign out (this device only — the shared request/account document is
// untouched, so signing in again with the same email + password finds it)
// ---------------------------------------------------------------------------
function clearLocal() {
  delete store.email; delete store.nickname; delete store.favoriteTeamCode; delete store.status; delete store.role; delete store.passwordHash; delete store.avatarColor;
  safeSave(store);
}
export function signOutAccount() { clearLocal(); }
