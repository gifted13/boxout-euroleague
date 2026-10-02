// ============================================================================
// App bootstrap: shell chrome (rail nav, topbar) + router wiring.
// ============================================================================

import { route, navigate, startRouter, onAfterNavigate } from './router.js';
import { state, subscribe, setSeason, setLang, setTheme, _setNavigateHook } from './state.js';
import { SEASONS, SEASON_LABELS, loadManifest, clearCache, loadSeason, isUpcomingSeason } from './data.js';
import { h, toast } from './components.js';
import { t, LANGS, LANG_LABELS } from './i18n.js';
import { fmtDate } from './format.js';
import { renderCommandCenter } from './views/command-center.js';
import * as account from './account.js';

const content = document.getElementById('content');
const railEl = document.getElementById('rail');
const crumbEl = document.getElementById('crumb');
const railBackdropEl = document.getElementById('rail-backdrop');

// Small hand-authored stroke-icon set (24x24 viewBox, currentColor) so the
// rail nav's icons are real vector art matching each item's meaning, instead
// of a mix of unicode glyphs. Sized/colored entirely by .rail-link .ic's CSS
// (see app.css) — stroke="currentColor" is what lets hover/active states
// recolor them along with the rest of the label, no per-icon JS needed.
const NAV_ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/></svg>',
  schedule: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  teams: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/></svg>',
  players: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5"/></svg>',
  standouts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v4a4 4 0 0 1-8 0V4z"/><path d="M8 5H5a3 3 0 0 0 3 4M16 5h3a3 3 0 0 1-3 4"/><path d="M12 13v2.5M9.5 20h5M9.8 15.5h4.4v2a1 1 0 0 1-1 1h-2.4a1 1 0 0 1-1-1v-2z"/></svg>',
  compare: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h13M15 4l3.5 4L15 12"/><path d="M19 16H6M9 12l-3.5 4L9 20"/></svg>',
  explorer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/></svg>',
  lab: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h5M10.2 3v6.2L4.9 18.4a1.4 1.4 0 0 0 1.2 2.1h11.8a1.4 1.4 0 0 0 1.2-2.1L13.8 9.2V3"/><path d="M8 15h8"/></svg>',
  myteam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 21V4"/><path d="M5 4.5h13l-3 4 3 4H5"/></svg>',
  trivia: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.3 9.3a2.7 2.7 0 1 1 3.8 2.5c-1 .4-1.6 1.1-1.6 2.3"/><circle cx="12" cy="17" r=".65" fill="currentColor" stroke="none"/></svg>',
  favorites: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6L21 9.3l-4.5 4.3L17.6 20 12 16.8 6.4 20l1.1-6.4L3 9.3l6.4-.7L12 3z"/></svg>',
  profile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="10.2" r="3.2"/><path d="M6.3 18.5c1-2.6 3.1-4 5.7-4s4.7 1.4 5.7 4"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
};

const NAV_ITEMS = [
  { key: 'home', path: '/' },
  { key: 'schedule', path: '/schedule' },
  { key: 'teams', path: '/teams' },
  { key: 'players', path: '/players' },
  { key: 'standouts', path: '/standouts' },
  { key: 'compare', path: '/compare' },
  { key: 'explorer', path: '/explorer' },
  { key: 'lab', path: '/lab' },
  { key: 'myteam', path: '/myteam' },
  { key: 'trivia', path: '/trivia' },
  { key: 'favorites', path: '/favorites' },
  { key: 'profile', path: '/profile' },
  { key: 'admin', path: '/admin', adminOnly: true },
];

let currentNavKey = 'home';

function renderNav(activeKey) {
  currentNavKey = activeKey;
  const nav = document.getElementById('rail-nav');
  nav.innerHTML = '';
  NAV_ITEMS.filter(item => !item.adminOnly || account.isSuperAdmin()).forEach(item => {
    const children = [h('span', { class: 'ic', html: NAV_ICONS[item.key] || '' }), t('nav.' + item.key)];
    const link = h('div', {
      class: 'rail-link' + (item.key === activeKey ? ' active' : ''),
      onclick: () => { navigate(item.path); closeRailMobile(); },
    }, children);
    nav.appendChild(link);
  });
}

// Static chrome strings that don't live inside a route handler — re-applied
// on boot and every time the language toggle changes.
function renderChromeStrings() {
  const tagline = document.querySelector('.rail-brand .name small');
  if (tagline) tagline.textContent = t('brand.tagline');
  const searchLabel = document.querySelector('#search-trigger span');
  if (searchLabel) searchLabel.textContent = t('search.trigger');
  const langLabel = document.getElementById('lang-toggle-label');
  if (langLabel) langLabel.textContent = t('lang.toggleLabel');
  const themeLabel = document.getElementById('theme-toggle-label');
  if (themeLabel) themeLabel.textContent = t('theme.toggleLabel');
  const refreshBtn = document.getElementById('data-refresh');
  if (refreshBtn && !refreshBtn.disabled) refreshBtn.innerHTML = '↻ ' + t('data.refresh');
  if (refreshBtn) refreshBtn.title = t('data.refreshTitle');
}

function renderLangToggle() {
  const box = document.getElementById('lang-toggle');
  box.innerHTML = '';
  LANGS.forEach(l => {
    const btn = h('button', {
      class: state.lang === l ? 'active' : '',
      onclick: () => { if (state.lang !== l) { setLang(l); account.pushSettings(state.lang, state.theme); window.dispatchEvent(new Event('hashchange')); } },
    }, LANG_LABELS[l]);
    box.appendChild(btn);
  });
}

// Light/Dark picker. state.theme also allows 'system' (the default, before
// anyone has picked — see state.js), which this control doesn't offer as a
// third button: clicking either one here is an explicit choice that moves
// off 'system' for good, same as most apps' simple light/dark switches.
// While state.theme is still 'system', the currently-applied look (from
// the OS preference) is what's highlighted, so the toggle never opens on
// neither button selected.
function effectiveTheme() {
  if (state.theme === 'light' || state.theme === 'dark') return state.theme;
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function renderThemeToggle() {
  const box = document.getElementById('theme-toggle');
  if (!box) return;
  box.innerHTML = '';
  const current = effectiveTheme();
  ['light', 'dark'].forEach(mode => {
    const btn = h('button', {
      class: current === mode ? 'active' : '',
      onclick: () => { if (state.theme !== mode) { setTheme(mode); account.pushSettings(state.lang, state.theme); } },
    }, t('theme.' + mode));
    box.appendChild(btn);
  });
}

// "Refresh data" hits the same honesty ceiling as ever for a published,
// static artifact (see the comment on refreshData() below) — on top of
// that, BoxOut restricts it to the one super-admin account
// (account.ADMIN_EMAIL) so a re-request of the published JSON isn't
// something every visitor — or every user someone made an "admin"
// role — triggers. This is a UI convention, not real access control
// (there's no backend to enforce it against) — see the note in
// js/account.js.
function applyAdminVisibility() {
  const btn = document.getElementById('data-refresh');
  if (btn) btn.hidden = !account.isSuperAdmin();
}

// The sidebar (menu, search, season/language toggles) and its mobile
// hamburger stay hidden for as long as the account gate is showing — a
// visitor sees nothing but the sign-in/sign-up screen until they're
// actually in, exactly like the routes themselves already only render
// once accountGate() passes.
function setRailVisible(visible) {
  railEl.hidden = !visible;
  const toggleBtn = document.getElementById('rail-toggle');
  if (toggleBtn) toggleBtn.hidden = !visible;
  if (!visible) closeRailMobile();
}

// "Refresh data" now genuinely reaches the live API for the schedule (see
// netlify/functions/schedule.js and data.js's loadLiveSchedule): the
// { force: true } here does two things — clears this tab's in-memory cache
// (same as before) AND tells the live schedule/standings functions to
// bypass their own short server-side cache, so this always lands a real
// call to euroleague-advanced-api.eu for those, not a replay of the last
// one. The rest of a season's datasets (team/player stats) are the static,
// periodically rebuilt files scripts/build_processed.py produces — this
// re-requests those too, but they only change when that pipeline is next
// re-run by hand and redeployed. See data.refreshTitle in i18n.js for the
// copy that explains this honestly in the UI.
async function refreshData() {
  if (!account.isSuperAdmin()) return;
  const btn = document.getElementById('data-refresh');
  if (!btn || btn.disabled) return;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin">↻</span> ${t('data.refreshing')}`;
  try {
    clearCache();
    await Promise.all([loadManifest(), loadSeason(state.season, { force: true })]);
    await renderDataStatus();
    window.dispatchEvent(new Event('hashchange'));
    toast(t('data.refreshed'));
  } catch {
    toast(t('data.refreshFailed'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '↻ ' + t('data.refresh');
  }
}

function openRailMobile() { railEl.classList.add('open'); railBackdropEl.classList.add('show'); }
function closeRailMobile() { railEl.classList.remove('open'); railBackdropEl.classList.remove('show'); }
function toggleRailMobile() { railEl.classList.contains('open') ? closeRailMobile() : openRailMobile(); }

function setCrumb(text) { crumbEl.innerHTML = ''; crumbEl.appendChild(h('b', {}, text)); }

function renderSeasonToggle() {
  const box = document.getElementById('season-toggle');
  box.innerHTML = '';
  SEASONS.forEach(s => {
    // Short form ("26–27") so a 3rd (upcoming) season still fits the rail's
    // narrow toggle column — the full "2026–27" is used everywhere else.
    const shortLabel = SEASON_LABELS[s].replace(/\b20(\d{2})/g, '$1');
    // Dispatching a synthetic hashchange always re-invokes the current
    // route's handler (router.js's dispatch() doesn't check whether the
    // hash string actually changed), so this works uniformly for every
    // page — including routing through the upcoming-season gate below.
    const btn = h('button', {
      class: (state.season === s ? 'active' : '') + (isUpcomingSeason(s) ? ' upcoming' : ''),
      onclick: () => { setSeason(s); window.dispatchEvent(new Event('hashchange')); },
      title: isUpcomingSeason(s) ? t('data.comingSoonBadge') : undefined,
    }, shortLabel);
    box.appendChild(btn);
  });
}

async function renderDataStatus() {
  const box = document.getElementById('data-status');
  try {
    const manifest = await loadManifest();
    const gaps = manifest.known_gaps.length;
    box.innerHTML = '';
    box.appendChild(h('div', {}, [h('strong', {}, t('data.lastUpdated')), fmtDate(manifest.generated_at)]));
    box.appendChild(h('div', { style: 'margin-top:3px;cursor:pointer;text-decoration:underline dotted', onclick: showDataInfoModal }, t('data.gapsLink', { count: gaps })));
  } catch {
    box.textContent = t('data.unavailable');
  }
}

async function showDataInfoModal() {
  const { openModal } = await import('./components.js');
  const manifest = await loadManifest();
  openModal({
    title: t('modal.dataSourcesTitle'),
    wide: true,
    body: [
      h('p', { style: 'font-size:13px;color:var(--ink-secondary);margin-bottom:16px' }, manifest.refresh_note),
      h('h4', { style: 'font-size:13px;margin-bottom:8px' }, t('modal.datasets')),
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:20px' }, Object.entries(manifest.datasets).map(([k, v]) =>
        h('div', { style: 'font-size:12.5px' }, [h('strong', { style: 'font-family:var(--font-data)' }, k + ': '), h('span', { style: 'color:var(--ink-secondary)' }, v)])
      )),
      h('h4', { style: 'font-size:13px;margin-bottom:8px' }, t('modal.knownGaps')),
      h('div', { style: 'display:flex;flex-direction:column;gap:10px' }, manifest.known_gaps.map(g =>
        h('div', { style: 'padding:10px 12px;background:var(--bg-plane);border-radius:8px;font-size:12.5px' }, [
          h('div', { style: 'font-weight:700;margin-bottom:3px' }, g.item),
          h('div', { style: 'color:var(--ink-secondary)' }, g.reason),
        ])
      )),
    ],
  });
}

function wireTopbar() {
  document.getElementById('rail-toggle').addEventListener('click', toggleRailMobile);
  document.getElementById('rail-close').addEventListener('click', closeRailMobile);
  railBackdropEl.addEventListener('click', closeRailMobile);
  document.getElementById('search-trigger').addEventListener('click', openCommandPalette);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); }
    if (e.key === 'Escape' && railEl.classList.contains('open')) closeRailMobile();
  });
  document.getElementById('data-refresh').addEventListener('click', refreshData);
}

async function openCommandPalette() {
  const { openCommandPaletteImpl } = await import('./views/palette.js');
  openCommandPaletteImpl();
}

// ---------------- Account gate ----------------
// Registration (email + nickname + favorite team) is mandatory before any
// route renders its real content — every route below calls this first,
// exactly like seasonGate() just below it. There is no dismiss/guest path:
// see js/views/account-gate.js and js/account.js for why (My Team needs a
// favorite team on file, and Trivia needs an identity to reuse silently).
let lastSeenTouched = false;
async function accountGate() {
  ensureAccountSubscription();
  if (account.getAccount()) {
    setRailVisible(true); applyAdminVisibility();
    checkNewDataPopup();
    // Once per page load (accountGate() itself runs on every route change,
    // but this stays gated to the first one) — see account.touchLastSeen().
    if (!lastSeenTouched) { lastSeenTouched = true; account.touchLastSeen(); }
    return false;
  }
  setRailVisible(false);
  const { renderAccountGate } = await import('./views/account-gate.js');
  await renderAccountGate(content, () => window.dispatchEvent(new Event('hashchange')));
  return true;
}

// ---------------- "New data published" popup ----------------
// manifest.generated_at is BoxOut's one existing signal for "the backend
// pipeline republished with fresher stats" (already shown in the sidebar —
// see renderDataStatus()/showDataInfoModal() above), so it's also the
// natural trigger for this: the FIRST time a signed-in visitor's device
// sees a generated_at that's different from the one it last recorded, show
// a one-time popup, then remember this version so it never shows again for
// it. A brand-new visitor (nothing recorded yet) just gets the current
// version silently recorded — there's nothing "new" to announce relative to
// nothing. Deliberately NOT tied to the live schedule endpoint (that legitimately
// changes every few minutes during live games — popping up on every one of
// those would be noise, not news).
const SEEN_DATA_KEY = 'boxout_seen_data_version_v1';
let dataVersionChecked = false;
async function checkNewDataPopup() {
  if (dataVersionChecked) return;
  dataVersionChecked = true;
  let manifest;
  try { manifest = await loadManifest(); } catch { return; }
  if (!manifest || !manifest.generated_at) return;
  let seen = null;
  try { seen = localStorage.getItem(SEEN_DATA_KEY); } catch { /* ignore */ }
  if (seen && seen !== manifest.generated_at) {
    const { openModal } = await import('./components.js');
    let modalHandle;
    modalHandle = openModal({
      title: t('data.newDataTitle'),
      body: [h('p', { style: 'font-size:13.5px;color:var(--ink-secondary);line-height:1.55' }, t('data.newDataBody', { date: fmtDate(manifest.generated_at) }))],
      footer: h('button', { class: 'btn btn-primary btn-sm', onclick: () => modalHandle.close() }, t('common.gotIt')),
    });
  }
  try { localStorage.setItem(SEEN_DATA_KEY, manifest.generated_at); } catch { /* ignore */ }
}

// ---------------- Season gate ----------------
// An upcoming season (fixture list published, no games played yet — see
// SEASON_START_DATES in data.js) has nothing for any of these routes to
// show: loadSeason() would just come back with empty datasets. Every route
// below checks this first and renders the "coming soon" screen instead of
// an empty/broken page, while still setting the crumb/nav for wherever the
// person actually navigated to.
async function seasonGate() {
  if (!isUpcomingSeason(state.season)) return false;
  const { renderSeasonComingSoon } = await import('./views/coming-soon.js');
  await renderSeasonComingSoon(content);
  return true;
}

// ---------------- Routes ----------------
// Every route checks accountGate() first (mandatory registration), then
// seasonGate() where relevant — mirroring how seasonGate() itself is
// checked by every route that depends on a season's stats.
route('/', async () => {
  setCrumb(t('nav.home')); renderNav('home');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  await renderCommandCenter(content);
});

route('/schedule', async () => {
  setCrumb(t('nav.schedule')); renderNav('schedule');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderSchedulePage } = await import('./views/schedule.js');
  await renderSchedulePage(content);
});
route('/teams', async () => {
  setCrumb(t('nav.teams')); renderNav('teams');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderTeamsList } = await import('./views/teams.js');
  await renderTeamsList(content);
});
route('/team/:code', async (params) => {
  renderNav('teams');
  setCrumb(t('nav.teams'));
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderTeamProfile } = await import('./views/teams.js');
  await renderTeamProfile(content, params.code, setCrumb);
});
route('/players', async () => {
  setCrumb(t('nav.players')); renderNav('players');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderPlayersList } = await import('./views/players.js');
  await renderPlayersList(content);
});
route('/player/:id', async (params) => {
  renderNav('players');
  setCrumb(t('nav.players'));
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderPlayerProfile } = await import('./views/players.js');
  await renderPlayerProfile(content, params.id, setCrumb);
});
route('/standouts', async () => {
  setCrumb(t('nav.standouts')); renderNav('standouts');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderStandouts } = await import('./views/standouts.js');
  await renderStandouts(content);
});
route('/compare', async (params, query) => {
  setCrumb(t('nav.compare')); renderNav('compare');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderCompare } = await import('./views/compare.js');
  await renderCompare(content, query);
});
route('/explorer', async () => {
  setCrumb(t('nav.explorer')); renderNav('explorer');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderExplorer } = await import('./views/explorer.js');
  await renderExplorer(content);
});
route('/lab', async () => {
  setCrumb(t('nav.lab')); renderNav('lab');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderLab } = await import('./views/lab.js');
  await renderLab(content);
});
route('/myteam', async () => {
  setCrumb(t('nav.myteam')); renderNav('myteam');
  if (await accountGate()) return;
  // Not gated by seasonGate(): an upcoming season still has a meaningful
  // "My Team" view (the favorite team's upcoming fixtures) — see
  // js/views/my-team.js, which handles that case itself.
  const { renderMyTeam } = await import('./views/my-team.js');
  await renderMyTeam(content);
});
route('/trivia', async () => {
  // Not gated by seasonGate(): the quiz always plays against the fixed
  // 2025-26 question bank (data/trivia_questions.json), independent of
  // whichever season is selected in the toggle.
  setCrumb(t('nav.trivia')); renderNav('trivia');
  if (await accountGate()) return;
  const { renderTrivia } = await import('./views/trivia.js');
  await renderTrivia(content);
});
route('/favorites', async () => {
  setCrumb(t('nav.favorites')); renderNav('favorites');
  if (await accountGate()) return;
  if (await seasonGate()) return;
  const { renderFavorites } = await import('./views/favorites.js');
  await renderFavorites(content);
});
route('/profile', async () => {
  // Not gated by seasonGate(): account settings aren't tied to any season's stats.
  setCrumb(t('nav.profile')); renderNav('profile');
  if (await accountGate()) return;
  const { renderProfile } = await import('./views/profile.js');
  await renderProfile(content);
});
route('/admin', async () => {
  setCrumb(t('nav.admin')); renderNav('admin');
  if (await accountGate()) return;
  const { renderAdmin } = await import('./views/admin.js');
  await renderAdmin(content);
});

// One-time settings hydration: pulls this account's remembered
// language/theme (if any) from its shared db doc so a returning visit on a
// different device/browser picks them back up. No-ops without a db-backed
// approved account (see account.fetchRemoteSettings).
async function syncAccountSettingsOnce() {
  if (!account.getAccount()) return;
  const remote = await account.fetchRemoteSettings();
  if (!remote) return;
  if (remote.lang && remote.lang !== state.lang) setLang(remote.lang);
  if (remote.theme && remote.theme !== state.theme) setTheme(remote.theme);
}

// Live account status: approval/rejection/deletion by the admin, from any
// device, reaches this tab without a manual refresh — re-dispatching the
// current route re-runs accountGate(), which now reads the updated local
// mirror the subscription just wrote. subscribeAccountStatus() needs a
// local record to build its path from, and a first-time visitor has none
// at boot() — so this is re-checked from accountGate() on every route
// dispatch (cheap: it only does real work when the signed-in email
// changes), which is what actually catches the moment right after
// signUp()/signIn() create that first local record and let the new
// pending screen start listening for the admin's decision live, instead
// of only picking it up on a manual reload.
let accountSubGen = 0;
let accountUnsub = null;
let accountSubEmail = undefined; // undefined = never checked yet; null = checked, no account
async function ensureAccountSubscription() {
  const record = account.getLocalRecord();
  const email = record ? record.email : null;
  if (email === accountSubEmail) return;
  const myGen = ++accountSubGen;
  if (accountUnsub) { accountUnsub(); accountUnsub = null; }
  accountSubEmail = email;
  if (!email) return;
  const unsub = await account.subscribeAccountStatus(async () => {
    await syncAccountSettingsOnce();
    applyAdminVisibility();
    window.dispatchEvent(new Event('hashchange'));
  });
  if (myGen === accountSubGen) accountUnsub = unsub;
  else unsub();
}

// Mobile / in-app-webview viewport-height fallback. CSS `dvh` units (see
// .rail in css/app.css) already fix the main bug — a nominal 100vh in a
// browser with on-screen chrome (address bar, or an in-app browser's own
// toolbar, e.g. WhatsApp/Instagram) is taller than what's actually visible,
// so a box sized to 100vh runs off the bottom of the screen. dvh tracks the
// real visible viewport and is supported everywhere modern, but this keeps
// a `--vh` custom property (driven by window.innerHeight, which always
// reflects the true visible height) in sync as a second-tier fallback for
// any older engine inside an in-app browser that predates dvh support.
function setViewportHeightVar() {
  document.documentElement.style.setProperty('--vh', (window.innerHeight * 0.01) + 'px');
}

function boot() {
  setViewportHeightVar();
  window.addEventListener('resize', setViewportHeightVar);
  window.addEventListener('orientationchange', setViewportHeightVar);
  _setNavigateHook(navigate);
  setRailVisible(!!account.getAccount());
  renderNav('home');
  renderSeasonToggle();
  renderLangToggle();
  renderThemeToggle();
  renderChromeStrings();
  renderDataStatus();
  applyAdminVisibility();
  wireTopbar();
  subscribe(() => { renderSeasonToggle(); renderLangToggle(); renderThemeToggle(); renderChromeStrings(); renderDataStatus(); });
  // Keep a left-open Ask AI panel's "Looking at" label in sync with navigation.
  // Runs after the route has rendered and called setAIContext for the new
  // page (the ask-ai module is already loaded by then if the panel is open,
  // so this dynamic import is a cache hit, not a new network fetch).
  onAfterNavigate(async () => {
    const { refreshAskAIHeader } = await import('./views/ask-ai.js');
    refreshAskAIHeader();
  });
  syncAccountSettingsOnce();
  ensureAccountSubscription();
  startRouter();
}

boot();
