// ============================================================================
// Mandatory site-entry gate — a Sign in / Sign up chooser, shown in place of
// whatever route was requested (see accountGate() in app.js, called first
// thing by every route, and which also keeps the rail nav itself hidden
// until this passes) until account.getAccount() returns non-null.
//
// Screens:
//  - chooser        no local record at all: "Sign in" or "Sign up"
//  - sign-up form    email + password + confirm + nickname + team
//  - sign-in form    email + password, with a "forgot password?" action
//  - set-password    a legacy account (approved/pending before passwords
//                     existed) signing in for the first time since — same
//                     account, just needs a password on file now
//  - pending/rejected/banned  driven by the local record's status; a live
//                     db subscription (app.js) re-dispatches navigation the
//                     moment the admin decides, so the pending screen flips
//                     over on its own, and a live ban takes effect the same
//                     way for someone already using the site.
// ============================================================================

import { loadSeason, SEASONS, isUpcomingSeason } from '../data.js';
import { h, card, comboSelect, skeletonCard, emptyState, openModal } from '../components.js';
import { state } from '../state.js';
import * as account from '../account.js';
import { t as tt } from '../i18n.js';

// Three short lines for the brand panel — see brandPanel() below. Plain
// data so it's easy to add/reorder without touching layout code.
const BRAND_FEATURE_KEYS = ['accountGate.brandFeature1', 'accountGate.brandFeature2', 'accountGate.brandFeature3'];

// Full-bleed split screen: a fixed-dark "broadcast" brand panel and, next
// to it, a plain panel that holds whatever screen is showing (chooser,
// sign-up, sign-in, set-password, pending/rejected/banned). Rebuilt on
// every screen change along with the rest of .gate-shell — cheap, and it
// keeps every render* function below simple (append to the returned
// formInner, nothing else to manage).
function renderShell(root) {
  root.innerHTML = '';
  const brandPanel = h('div', { class: 'gate-brand-panel' }, [
    h('div', { class: 'gate-brand-mark' }, [
      h('img', { src: 'logos/boxout-icon.png', alt: 'BoxOut' }),
      h('div', { class: 'word' }, ['BoxOut', h('small', {}, tt('accountGate.brandEyebrow'))]),
    ]),
    h('div', { class: 'gate-brand-tagline' }, tt('accountGate.brandTagline')),
    h('div', { class: 'gate-brand-features' }, BRAND_FEATURE_KEYS.map(key => h('div', { class: 'gate-brand-feature' }, [
      h('span', { class: 'dot' }),
      h('span', {}, tt(key)),
    ]))),
  ]);
  const formInner = h('div', { class: 'gate-form-inner' });
  const formPanel = h('div', { class: 'gate-form-panel' }, [formInner]);
  root.appendChild(h('div', { class: 'gate-shell' }, [brandPanel, formPanel]));
  return formInner;
}

// A live password_resets subscription (see renderSignInForm's forgotBtn
// handler below) outlives a single render — accountGate() in app.js can
// call renderAccountGate() again (a fresh navigation) while one is still
// open. Tracking it at module scope, and tearing it down on every fresh
// entry into the gate, keeps that from leaking or firing into a stale form.
let activeResetUnsub = null;
function clearResetSubscription() {
  if (activeResetUnsub) { try { activeResetUnsub(); } catch { /* best-effort */ } activeResetUnsub = null; }
}

export async function renderAccountGate(root, onDone) {
  clearResetSubscription();
  const wrap = renderShell(root);

  const record = account.getLocalRecord();
  if (record && (record.status === 'pending' || record.status === 'rejected' || record.status === 'banned')) {
    renderStatusScreen(wrap, record.status, record, onDone);
    return;
  }

  await renderChooser(wrap, onDone);
}

function hero(wrap, titleKey, introKey) {
  wrap.appendChild(h('div', { class: 'trivia-hero' }, [
    h('div', { class: 'eyebrow' }, tt('accountGate.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:6px' }, tt(titleKey)),
    h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:440px;margin:8px auto 0' }, tt(introKey)),
  ]));
}

function fieldLabel(text) {
  return h('label', { style: 'font-size:11.5px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em;margin-top:10px;display:block' }, text);
}

// Full Terms & Conditions text — shown in a modal from the sign-up form's
// checkbox link (see tosCheckbox below). Includes the marketing-contact
// consent clause (accountGate.tosBody3) that the checkbox itself gates.
function openTermsModal() {
  const modalHandle = openModal({
    title: tt('accountGate.tosModalTitle'),
    body: [
      h('p', { style: 'font-size:13px;color:var(--ink-secondary);line-height:1.6;margin-bottom:10px' }, tt('accountGate.tosBody1')),
      h('p', { style: 'font-size:13px;color:var(--ink-secondary);line-height:1.6;margin-bottom:10px' }, tt('accountGate.tosBody2')),
      h('p', { style: 'font-size:13px;color:var(--ink-secondary);line-height:1.6;margin-bottom:10px' }, tt('accountGate.tosBody3')),
      h('p', { style: 'font-size:13px;color:var(--ink-secondary);line-height:1.6' }, tt('accountGate.tosBody4')),
    ],
    footer: h('button', { class: 'btn btn-primary btn-sm', onclick: () => modalHandle.close() }, tt('accountGate.tosClose')),
  });
}

// The mandatory acceptance checkbox itself — a labeled row with an inline
// link that opens the full text above. Returns the raw <input> so submit()
// can read .checked synchronously.
function tosCheckboxRow() {
  const box = h('input', { type: 'checkbox', id: 'tos-accept', style: 'width:16px;height:16px;flex-shrink:0;margin-top:1px' });
  const link = h('a', {
    href: '#', style: 'color:var(--accent,#2563eb)',
    onclick: (e) => { e.preventDefault(); openTermsModal(); },
  }, tt('accountGate.tosLinkText'));
  const row = h('label', {
    style: 'display:flex;align-items:flex-start;gap:8px;margin-top:14px;font-size:12.5px;color:var(--ink-secondary);cursor:pointer;line-height:1.5',
  }, [box, h('span', {}, [tt('accountGate.tosLabel') + ' ', link])]);
  return { row, box };
}

const STATUS_COPY = {
  pending: { title: 'accountGate.pendingTitle', body: 'accountGate.pendingBody', note: 'accountGate.pendingNote' },
  rejected: { title: 'accountGate.rejectedTitle', body: 'accountGate.rejectedBody', note: 'accountGate.rejectedNote' },
  banned: { title: 'accountGate.bannedTitle', body: 'accountGate.bannedBody', note: 'accountGate.bannedNote' },
};

function renderStatusScreen(wrap, kind, record, onDone) {
  const copy = STATUS_COPY[kind];
  wrap.appendChild(h('div', { class: 'trivia-hero' }, [
    h('div', { class: 'eyebrow' }, tt('accountGate.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:6px' }, tt(copy.title)),
    h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:440px;margin:8px auto 0' },
      tt(copy.body, { name: record.nickname })),
  ]));
  const body = [
    h('p', { style: 'font-size:13px;color:var(--ink-secondary);text-align:center' }, tt(copy.note)),
  ];
  const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-top:4px;text-align:center' });
  if (kind === 'rejected') {
    body.push(h('button', {
      class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:10px',
      onclick: async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        const res = await account.resubmitAfterRejection({ email: record.email, nickname: record.nickname, favoriteTeamCode: record.favoriteTeamCode });
        if (res.ok) { onDone(); return; }
        btn.disabled = false;
        errEl.textContent = tt('accountGate.genericError');
      },
    }, tt('accountGate.tryAgainCta')));
    body.push(errEl);
  }
  body.push(h('button', {
    class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:10px',
    onclick: () => { account.signOutAccount(); window.dispatchEvent(new Event('hashchange')); },
  }, tt('accountGate.useDifferentEmail')));
  wrap.appendChild(card(body));
}

// ---------------------------------------------------------------------------
// Chooser
// ---------------------------------------------------------------------------
function renderChooser(wrap, onDone, prefillEmail) {
  wrap.innerHTML = '';
  hero(wrap, 'accountGate.title', 'accountGate.intro');
  const signInBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center' }, tt('accountGate.signInCta'));
  const signUpBtn = h('button', { class: 'btn btn-ghost', style: 'width:100%;justify-content:center;margin-top:10px' }, tt('accountGate.signUpCta'));
  signInBtn.addEventListener('click', () => renderSignInForm(wrap, onDone, prefillEmail));
  signUpBtn.addEventListener('click', () => renderSignUpForm(wrap, onDone, prefillEmail));
  wrap.appendChild(card([signInBtn, signUpBtn], { title: tt('accountGate.chooseHeading') }));
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------
async function renderSignUpForm(wrap, onDone, prefillEmail) {
  wrap.innerHTML = '';
  wrap.appendChild(skeletonCard());

  const fallbackSeason = SEASONS.find(s => !isUpcomingSeason(s));
  const season = fallbackSeason != null ? await loadSeason(fallbackSeason).catch(() => null) : null;
  wrap.innerHTML = '';

  // Every club on the season's fixture list can be picked as a favorite from
  // day one — not just the ones team_season already has a row for.
  // team_season only gets a row once a team has actually played, so early in
  // a season (e.g. Round 1 still in progress) it's missing a handful of
  // clubs. Names come from team_season (properly cased) where available,
  // falling back to the schedule's own (ALL-CAPS) team name for a club that
  // hasn't played yet.
  const nameByCode = new Map(
    (season && Array.isArray(season.team_season) ? season.team_season : [])
      .map(t => [t.team_code, t.team_name])
  );
  const codesFromSchedule = new Map();
  (season && Array.isArray(season.schedule) ? season.schedule : []).forEach(g => {
    if (g.homecode && !codesFromSchedule.has(g.homecode)) codesFromSchedule.set(g.homecode, g.hometeam);
    if (g.awaycode && !codesFromSchedule.has(g.awaycode)) codesFromSchedule.set(g.awaycode, g.awayteam);
  });
  const teams = Array.from(codesFromSchedule.keys()).length
    ? Array.from(codesFromSchedule, ([team_code, scheduleName]) => ({
        team_code, team_name: nameByCode.get(team_code) || scheduleName,
      })).sort((a, b) => a.team_name.localeCompare(b.team_name))
    : (season && Array.isArray(season.team_season) ? season.team_season.slice() : [])
        .sort((a, b) => a.team_name.localeCompare(b.team_name));

  let favoriteTeamCode = null;
  const emailInput = h('input', { class: 'gate-input', type: 'email', placeholder: tt('accountGate.emailPlaceholder'), autocomplete: 'email', value: prefillEmail || '' });
  const pwInput = h('input', { class: 'gate-input', type: 'password', placeholder: tt('accountGate.passwordPlaceholder'), autocomplete: 'new-password' });
  const pwConfirmInput = h('input', { class: 'gate-input', type: 'password', placeholder: tt('accountGate.confirmPasswordPlaceholder'), autocomplete: 'new-password' });
  const nickInput = h('input', { class: 'gate-input', type: 'text', placeholder: tt('accountGate.nicknamePlaceholder'), maxlength: '24', autocomplete: 'nickname' });
  const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-top:4px' });

  let teamPicker = null;
  if (teams.length) {
    teamPicker = comboSelect({
      items: teams.map(t => ({ value: t.team_code, label: t.team_name })),
      value: favoriteTeamCode,
      placeholder: tt('accountGate.teamPlaceholder'),
      onChange: (v) => { favoriteTeamCode = v; },
    });
  }

  const { row: tosRow, box: tosCheckbox } = tosCheckboxRow();

  const submitBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:6px' }, tt('accountGate.signUpCta'));
  async function submit() {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    if (!account.isValidEmail(email)) { errEl.textContent = tt('accountGate.invalidEmail'); return; }
    if (password.length < 6) { errEl.textContent = tt('accountGate.passwordTooShort'); return; }
    if (password !== pwConfirmInput.value) { errEl.textContent = tt('accountGate.passwordMismatch'); return; }
    const nickname = nickInput.value.trim();
    if (!nickname) { errEl.textContent = tt('accountGate.nicknameRequired'); return; }
    if (teams.length && !favoriteTeamCode) { errEl.textContent = tt('accountGate.teamRequired'); return; }
    if (!tosCheckbox.checked) { errEl.textContent = tt('accountGate.tosRequired'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = tt('accountGate.submitting');
    const res = await account.signUp({ email, nickname, favoriteTeamCode, password, lang: state.lang, theme: state.theme, tosAccepted: tosCheckbox.checked });
    if (!res.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = tt('accountGate.signUpCta');
      if (res.error === 'already_registered') {
        errEl.innerHTML = '';
        errEl.appendChild(document.createTextNode(tt('accountGate.alreadyRegistered') + ' '));
        errEl.appendChild(h('a', { href: '#', style: 'color:var(--accent,#2563eb)', onclick: (e) => { e.preventDefault(); renderSignInForm(wrap, onDone, email); } }, tt('accountGate.signInCta')));
      } else if (res.error === 'wrong_admin_password') {
        errEl.textContent = tt('accountGate.wrongAdminPassword');
      } else if (res.error === 'tos_required') {
        errEl.textContent = tt('accountGate.tosRequired');
      } else {
        errEl.textContent = tt('accountGate.genericError');
      }
      return;
    }
    onDone();
  }
  submitBtn.addEventListener('click', submit);
  [emailInput, pwInput, pwConfirmInput, nickInput].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));

  hero(wrap, 'accountGate.signUpTitle', 'accountGate.signUpIntro');

  const fields = [
    fieldLabel(tt('accountGate.emailLabel')),
    emailInput,
    fieldLabel(tt('accountGate.passwordLabel')),
    pwInput,
    fieldLabel(tt('accountGate.confirmPasswordLabel')),
    pwConfirmInput,
    fieldLabel(tt('accountGate.nicknameLabel')),
    nickInput,
  ];
  if (teamPicker) {
    fields.push(fieldLabel(tt('accountGate.teamLabel')));
    fields.push(teamPicker);
  } else {
    fields.push(emptyState(tt('accountGate.teamsUnavailable')));
  }
  fields.push(tosRow);
  fields.push(errEl);
  fields.push(submitBtn);
  fields.push(h('button', {
    class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:8px',
    onclick: () => renderSignInForm(wrap, onDone, emailInput.value.trim()),
  }, tt('accountGate.haveAccountCta')));
  fields.push(h('p', { style: 'font-size:11px;color:var(--ink-muted);margin-top:12px;line-height:1.5' }, tt('accountGate.localAccountNote')));

  wrap.appendChild(card(fields, { title: tt('accountGate.formHeading') }));
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------
function renderSignInForm(wrap, onDone, prefillEmail) {
  wrap.innerHTML = '';

  const emailInput = h('input', { class: 'gate-input', type: 'email', placeholder: tt('accountGate.emailPlaceholder'), autocomplete: 'email', value: prefillEmail || '' });
  const pwInput = h('input', { class: 'gate-input', type: 'password', placeholder: tt('accountGate.passwordPlaceholder'), autocomplete: 'current-password' });
  const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-top:4px' });
  const forgotNoteEl = h('div', { style: 'color:var(--ink-muted);font-size:12px;min-height:16px;margin-top:2px' });

  const submitBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:6px' }, tt('accountGate.signInCta'));
  async function submit() {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    if (!account.isValidEmail(email)) { errEl.textContent = tt('accountGate.invalidEmail'); return; }
    if (!password) { errEl.textContent = tt('accountGate.passwordRequired'); return; }

    submitBtn.disabled = true;
    submitBtn.textContent = tt('accountGate.submitting');
    const res = await account.signIn({ email, password });
    if (!res.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = tt('accountGate.signInCta');
      if (res.error === 'not_found') {
        errEl.innerHTML = '';
        errEl.appendChild(document.createTextNode(tt('accountGate.emailNotFound') + ' '));
        errEl.appendChild(h('a', { href: '#', style: 'color:var(--accent,#2563eb)', onclick: (e) => { e.preventDefault(); renderSignUpForm(wrap, onDone, email); } }, tt('accountGate.signUpCta')));
      } else if (res.error === 'no_password_set') {
        renderSetPasswordForm(wrap, onDone, email);
      } else if (res.error === 'wrong_password') {
        errEl.textContent = tt('accountGate.wrongPassword');
      } else {
        errEl.textContent = tt('accountGate.genericError');
      }
      return;
    }
    clearResetSubscription();
    onDone();
  }
  submitBtn.addEventListener('click', submit);
  [emailInput, pwInput].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));

  // "Forgot password" only records a request — the super admin has to
  // click "Approve" in /admin before anyone can set a new password (see
  // account.requestPasswordReset). This subscribes live so the moment that
  // happens, this screen swaps itself for the set-your-own-password form —
  // no manual refresh, no re-typing the email.
  let resetSent = false;
  const forgotBtn = h('button', { class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:8px' }, tt('accountGate.forgotPasswordCta'));
  forgotBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!account.isValidEmail(email)) { errEl.textContent = tt('accountGate.invalidEmail'); return; }
    if (resetSent) return;
    forgotBtn.disabled = true;
    await account.requestPasswordReset(email);
    resetSent = true;
    forgotNoteEl.textContent = tt('accountGate.resetRequested');
    clearResetSubscription();
    activeResetUnsub = await account.subscribePasswordResetStatus(email, (status) => {
      if (status === 'approved') {
        clearResetSubscription();
        renderSetPasswordForm(wrap, onDone, email);
      }
    });
  });

  hero(wrap, 'accountGate.signInTitle', 'accountGate.signInIntro');

  const fields = [
    fieldLabel(tt('accountGate.emailLabel')),
    emailInput,
    fieldLabel(tt('accountGate.passwordLabel')),
    pwInput,
    errEl,
    submitBtn,
    forgotBtn,
    forgotNoteEl,
    h('button', {
      class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:2px',
      onclick: () => { clearResetSubscription(); renderSignUpForm(wrap, onDone, emailInput.value.trim()); },
    }, tt('accountGate.needAccountCta')),
  ];

  wrap.appendChild(card(fields, { title: tt('accountGate.signInFormHeading') }));
}

// ---------------------------------------------------------------------------
// Set-password (legacy account with no passwordHash yet)
// ---------------------------------------------------------------------------
function renderSetPasswordForm(wrap, onDone, email) {
  wrap.innerHTML = '';

  const pwInput = h('input', { class: 'gate-input', type: 'password', placeholder: tt('accountGate.passwordPlaceholder'), autocomplete: 'new-password' });
  const pwConfirmInput = h('input', { class: 'gate-input', type: 'password', placeholder: tt('accountGate.confirmPasswordPlaceholder'), autocomplete: 'new-password' });
  const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-top:4px' });

  const submitBtn = h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:6px' }, tt('accountGate.setPasswordCta'));
  async function submit() {
    const password = pwInput.value;
    if (password.length < 6) { errEl.textContent = tt('accountGate.passwordTooShort'); return; }
    if (password !== pwConfirmInput.value) { errEl.textContent = tt('accountGate.passwordMismatch'); return; }
    submitBtn.disabled = true;
    submitBtn.textContent = tt('accountGate.submitting');
    const res = await account.setInitialPassword({ email, password });
    if (!res.ok) {
      submitBtn.disabled = false;
      submitBtn.textContent = tt('accountGate.setPasswordCta');
      errEl.textContent = tt('accountGate.genericError');
      return;
    }
    onDone();
  }
  submitBtn.addEventListener('click', submit);
  [pwInput, pwConfirmInput].forEach(inp => inp.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));

  hero(wrap, 'accountGate.setPasswordTitle', 'accountGate.setPasswordIntro');

  const fields = [
    fieldLabel(tt('accountGate.emailLabel')),
    h('div', { style: 'font-size:13.5px;font-weight:600;padding:8px 0' }, email),
    fieldLabel(tt('accountGate.newPasswordLabel')),
    pwInput,
    fieldLabel(tt('accountGate.confirmPasswordLabel')),
    pwConfirmInput,
    errEl,
    submitBtn,
  ];

  wrap.appendChild(card(fields, { title: tt('accountGate.setPasswordFormHeading') }));
}
