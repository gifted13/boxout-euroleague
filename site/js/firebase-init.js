// ============================================================================
// Real Firebase backend — replaces the Claude Artifact `db` capability that
// account.js originally used. That capability only works for viewers signed
// into claude.ai (and, in practice, only members of the artifact owner's
// claude.ai organization) — it cannot serve a genuinely public "anyone with
// the link" site. This module talks to a real Firebase project instead, so
// BoxOut works for any visitor, no Claude account involved.
//
// Deliberately uses the Firebase "compat" SDK (the classic firebase.foo()
// namespaced API, loaded as plain <script> tags in app.html) rather than the
// modern modular SDK. The compat SDK's DocumentReference/CollectionReference/
// DocumentSnapshot/QuerySnapshot shapes (doc().get/set/update/delete/
// onSnapshot, collection().onSnapshot/add/orderBy/limit, snap.exists as a
// property, snap.data() as a method) are — not by accident — exactly what
// account.js, admin.js and chat.js already call, because the Artifact `db`
// capability itself mirrored classic Firestore's API. That means this file
// is the ONLY thing that had to change to swap backends: getDb() below is a
// drop-in replacement, and nothing else in the app needed touching.
//
// Config values below (apiKey, projectId, etc.) are NOT secrets — Firebase's
// real security boundary is Firestore's server-side security rules
// (see firestore.rules in this project), not hiding this object. It's normal
// and expected for it to be readable in the published site's source.
// ============================================================================

const firebaseConfig = {
  apiKey: 'AIzaSyAJLMivP2KaB0rvVPsFGYG-SfnTE5Dc0MU',
  authDomain: 'boxout-euroleague.firebaseapp.com',
  projectId: 'boxout-euroleague',
  storageBucket: 'boxout-euroleague.firebasestorage.app',
  messagingSenderId: '301949456412',
  appId: '1:301949456412:web:42485f3bd570edb2a44fd9',
};

let appInstance = null;
function ensureApp() {
  if (typeof firebase === 'undefined') return null; // compat SDK <script> tags didn't load (offline, blocked, or a local preview without app.html's script tags)
  if (!appInstance) {
    appInstance = (firebase.apps && firebase.apps.length) ? firebase.apps[0] : firebase.initializeApp(firebaseConfig);
  }
  return appInstance;
}

// Same call shape as account.js's old getDb(): synchronous-ish, returns null
// (never throws) when Firebase isn't available in this context.
export function getFirebaseDb() {
  try {
    const app = ensureApp();
    return app ? firebase.firestore() : null;
  } catch { return null; }
}

// Used only for the super admin (see account.js's isAdminEmailAddress() /
// isSuperAdmin()) — establishes a REAL authenticated session so Firestore
// security rules can tell "the actual site owner" apart from any other
// visitor for privileged writes (approve/reject/ban/delete/role-change/
// reset-approve). Ordinary members never touch Firebase Auth at all; their
// accounts stay exactly the lightweight, no-real-auth model this app always
// used (see the PASSWORDS note in account.js).
export function getFirebaseAuth() {
  try {
    const app = ensureApp();
    return app ? firebase.auth() : null;
  } catch { return null; }
}
