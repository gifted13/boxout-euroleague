// ============================================================================
// Trivia — a EuroLeague 2025-26 season quiz. See js/trivia-state.js for the
// lives/attempt-history model (local to this device) and how the
// leaderboard itself is now shared across everyone via Firestore.
// Questions come from data/trivia_questions.json, a bank pre-computed from
// the real season stats (js/views/coming-soon.js-style: this module reads
// a static file, it doesn't compute stats itself).
//
// Identity is NOT asked here: registration is mandatory before any route is
// reachable (see accountGate() in app.js), so by the time this renders,
// js/account.js always has an email + nickname on file. boot() below signs
// that identity straight into the trivia-state.js profile every time, so
// stats/lives/leaderboard rank stay tied to the one account the person
// already gave at the door. renderAuth() is kept only as a defensive
// fallback for the (normally unreachable) case where that account is
// somehow missing.
//
// leaderboard() is async (it reads Firestore) so renderHub()/renderResults()
// are too — every call site below shows a brief skeleton while it resolves,
// same pattern boot() already used for the questions bank.
// ============================================================================

import { loadTriviaQuestions } from '../data.js';
import { h, card, emptyState, skeletonCard, avatarInitial, toast, openModal } from '../components.js';
import { hashColor } from '../format.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { t as tt } from '../i18n.js';
import * as trivia from '../trivia-state.js';
import * as account from '../account.js';

function pick(bi) { return state.lang === 'el' ? bi.el : bi.en; }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function sampleQuestions(pool, n) {
  return shuffle(pool).slice(0, n).map(q => ({ ...q, options: shuffle(q.options) }));
}

function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export async function renderTrivia(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow trivia-wrap' });
  root.appendChild(wrap);

  let questionsBank = null;
  let leaveGuard = null; // set while a quiz attempt is live; consumes a life if the person navigates away

  function screen(el) { wrap.innerHTML = ''; wrap.appendChild(el); window.scrollTo({ top: 0 }); }

  function onHashChange() {
    if (location.hash.replace(/^#/, '') === '/trivia') return; // internal re-render, not a real navigation
    if (leaveGuard) { leaveGuard(); leaveGuard = null; }
  }
  window.addEventListener('hashchange', onHashChange);
  // Router re-dispatches on every hashchange even when the hash didn't
  // change (see router.js), so this cleanup only needs to fire once per
  // real departure; onHashChange is idempotent via the leaveGuard = null.

  // ---- Auth ----
  function renderAuth() {
    let email = '', nickname = '';
    const emailInput = h('input', { class: 'trivia-input', type: 'email', placeholder: tt('trivia.emailPlaceholder'), autocomplete: 'email' });
    const nickInput = h('input', { class: 'trivia-input', type: 'text', placeholder: tt('trivia.nicknamePlaceholder'), maxlength: '24', autocomplete: 'nickname' });
    const errEl = h('div', { style: 'color:var(--critical);font-size:12.5px;min-height:16px;margin-bottom:8px' });
    const submit = () => {
      email = emailInput.value.trim();
      nickname = nickInput.value.trim();
      if (!trivia.isValidEmail(email)) { errEl.textContent = tt('trivia.invalidEmail'); return; }
      if (!nickname) { errEl.textContent = tt('trivia.nicknameRequired'); return; }
      trivia.signIn(email, nickname);
      boot();
    };
    emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') nickInput.focus(); });
    nickInput.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    return h('div', {}, [
      h('div', { class: 'trivia-hero' }, [
        h('div', { class: 'eyebrow' }, tt('trivia.eyebrow')),
        h('h1', { style: 'font-size:24px;margin-top:6px' }, tt('trivia.title')),
        h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:420px;margin:8px auto 0' }, tt('trivia.intro')),
      ]),
      card([
        h('label', { style: 'font-size:11.5px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em' }, tt('trivia.emailLabel')),
        emailInput,
        h('label', { style: 'font-size:11.5px;font-weight:700;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em' }, tt('trivia.nicknameLabel')),
        nickInput,
        errEl,
        h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center', onclick: submit }, tt('trivia.signInCta')),
        h('p', { style: 'font-size:11px;color:var(--ink-muted);margin-top:12px;line-height:1.5' }, tt('trivia.localAccountNote')),
      ], { title: tt('trivia.signInHeading') }),
    ]);
  }

  // ---- Hub ----
  async function renderHub(profile) {
    const lives = profile.lives;
    const hearts = h('div', { class: 'trivia-lives' }, Array.from({ length: trivia.DAILY_LIVES }, (_, i) =>
      h('span', { class: 'heart' + (i < lives ? ' on' : '') }, i < lives ? '♥' : '♡')));

    const canPlay = lives > 0;
    const startBtn = h('button', {
      class: 'btn btn-primary', style: 'width:100%;justify-content:center;margin-top:14px',
      disabled: canPlay ? null : 'true',
      onclick: canPlay ? () => beginQuiz(profile) : null,
    }, canPlay ? tt('trivia.startCta') : tt('trivia.noLivesCta'));

    const statsRow = h('div', { style: 'display:flex;gap:0;margin-top:16px;border-top:1px solid var(--line);padding-top:14px' }, [
      h('div', { style: 'flex:1;text-align:center' }, [
        h('div', { style: 'font-family:var(--font-data);font-weight:800;font-size:20px' }, `${profile.bestScore}/${trivia.QUESTIONS_PER_ATTEMPT}`),
        h('div', { style: 'font-size:10.5px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em' }, tt('trivia.bestScore')),
      ]),
      h('div', { style: 'flex:1;text-align:center' }, [
        h('div', { style: 'font-family:var(--font-data);font-weight:800;font-size:20px' }, String(profile.totalCompletedAttempts)),
        h('div', { style: 'font-size:10.5px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.04em' }, tt('trivia.attemptsPlayed')),
      ]),
    ]);

    const hubCard = card([
      h('div', { style: 'text-align:center' }, [
        h('div', { style: 'font-size:15px;font-weight:700' }, tt('trivia.greeting', { name: profile.nickname })),
        h('div', { style: 'font-size:11.5px;color:var(--ink-muted);margin-top:4px' }, tt('trivia.livesToday', { n: lives, max: trivia.DAILY_LIVES })),
        hearts,
        h('div', { style: 'font-size:11px;color:var(--ink-muted);margin-top:6px' }, tt('trivia.resetNote')),
      ]),
      startBtn,
      statsRow,
      account.getAccount()
        ? h('button', { class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:10px', onclick: () => navigate('/myteam') }, tt('trivia.manageProfile'))
        : h('button', { class: 'btn btn-ghost btn-sm', style: 'width:100%;justify-content:center;margin-top:10px', onclick: () => { trivia.signOut(); screen(renderAuth()); } }, tt('trivia.switchProfile')),
    ]);

    const lb = await trivia.leaderboard();
    const lbCard = card(
      lb.length
        ? lb.map((p, i) => h('div', { class: 'trivia-lb-row' + (p.id === profile.id ? ' me' : '') }, [
            h('span', { class: 'trivia-lb-rank' }, String(i + 1)),
            avatarInitial(p.nickname, 26),
            h('span', { class: 'trivia-lb-name' }, p.nickname),
            h('span', { class: 'trivia-lb-score' }, `${p.bestScore}/${trivia.QUESTIONS_PER_ATTEMPT}`),
          ]))
        : emptyState(tt('trivia.noLeaderboard')),
      { title: tt('trivia.leaderboardTitle'), sub: tt('trivia.leaderboardScope') }
    );

    return h('div', {}, [
      h('div', { class: 'trivia-hero' }, [
        h('div', { class: 'eyebrow' }, tt('trivia.eyebrow')),
        h('h1', { style: 'font-size:24px;margin-top:6px' }, tt('trivia.title')),
      ]),
      hubCard,
      lbCard,
    ]);
  }

  // ---- Quiz ----
  function beginQuiz(profile) {
    const N = trivia.QUESTIONS_PER_ATTEMPT;
    const qList = sampleQuestions(questionsBank.questions, N);
    const session = { idx: 0, score: 0, answered: false, ended: false, timeLeft: trivia.TIME_LIMIT_SEC, startedAt: Date.now(), autoAdvanceTimer: null };
    session.timerHandle = setInterval(() => {
      session.timeLeft -= 1;
      updateTimerEl();
      if (session.timeLeft <= 0) { clearInterval(session.timerHandle); finishAttempt('timeout'); }
    }, 1000);

    leaveGuard = () => {
      if (session.ended) return;
      session.ended = true;
      clearInterval(session.timerHandle);
      clearTimeout(session.autoAdvanceTimer);
      const timeUsedSec = Math.min(trivia.TIME_LIMIT_SEC, Math.round((Date.now() - session.startedAt) / 1000));
      trivia.endAttempt({ completed: false, abandoned: true, score: session.score, total: N, timeUsedSec });
    };

    let timerEl = null;
    function updateTimerEl() {
      if (!timerEl) return;
      timerEl.textContent = fmtClock(Math.max(0, session.timeLeft));
      timerEl.classList.toggle('low', session.timeLeft <= 30);
    }

    function exitQuiz() {
      openModal({
        title: tt('trivia.exitConfirmTitle'),
        body: h('p', { style: 'font-size:13.5px;color:var(--ink-secondary)' }, tt('trivia.exitConfirmBody')),
        footer: [
          h('button', { class: 'btn btn-sm', onclick: (e) => e.target.closest('.overlay').remove() }, tt('common.cancel')),
          h('button', {
            class: 'btn btn-sm btn-primary', style: 'background:var(--critical);border-color:var(--critical)',
            onclick: async (e) => {
              e.target.closest('.overlay').remove();
              session.ended = true;
              clearInterval(session.timerHandle);
              clearTimeout(session.autoAdvanceTimer);
              leaveGuard = null;
              const timeUsedSec = Math.min(trivia.TIME_LIMIT_SEC, Math.round((Date.now() - session.startedAt) / 1000));
              const updated = trivia.endAttempt({ completed: false, abandoned: true, score: session.score, total: N, timeUsedSec });
              toast(tt('trivia.leftToast'));
              screen(skeletonCard());
              screen(await renderHub(updated));
            },
          }, tt('trivia.exitConfirmCta')),
        ],
      });
    }

    async function finishAttempt(reason) {
      session.ended = true;
      clearInterval(session.timerHandle);
      clearTimeout(session.autoAdvanceTimer);
      leaveGuard = null;
      const timeUsedSec = Math.min(trivia.TIME_LIMIT_SEC, Math.round((Date.now() - session.startedAt) / 1000));
      const updated = trivia.endAttempt({ completed: true, abandoned: false, score: session.score, total: N, timeUsedSec });
      screen(skeletonCard());
      screen(await renderResults(updated, { score: session.score, total: N, timeUsedSec, timedOut: reason === 'timeout' }));
    }

    function renderQuestion() {
      const q = qList[session.idx];
      session.answered = false;
      const optionEls = [];

      const optsWrap = h('div', {}, q.options.map(opt => {
        const isTeam = q.kind === 'team';
        const btn = h('button', { class: 'trivia-opt', onclick: () => choose(opt, btn) }, [
          isTeam
            ? h('span', { class: 'dot', style: `background:${hashColor(opt.code)}` })
            : avatarInitial(opt.name, 26),
          h('span', { style: 'flex:1;min-width:0' }, [
            h('span', {}, opt.name),
            !isTeam && opt.team ? h('span', { style: 'color:var(--ink-muted);font-weight:600;margin-left:6px' }, opt.team) : null,
          ]),
        ]);
        optionEls.push({ btn, opt });
        return btn;
      }));

      const explainEl = h('div', { class: 'trivia-explain' });
      const nextBtn = h('button', { class: 'btn btn-sm', style: 'display:none', onclick: () => advance() }, tt('trivia.nextCta'));

      function choose(chosenOpt, chosenBtn) {
        if (session.answered) return;
        session.answered = true;
        const correct = chosenOpt.code === q.correctCode;
        if (correct) session.score += 1;
        optionEls.forEach(({ btn, opt }) => {
          btn.disabled = true;
          if (opt.code === q.correctCode) btn.classList.add('correct');
          else if (opt.code === chosenOpt.code) btn.classList.add('wrong');
          else btn.classList.add('muted');
        });
        explainEl.textContent = pick(q.explanation);
        nextBtn.style.display = 'inline-flex';
        session.autoAdvanceTimer = setTimeout(advance, 3200);
      }

      function advance() {
        clearTimeout(session.autoAdvanceTimer);
        if (session.idx + 1 >= N) finishAttempt('done');
        else { session.idx += 1; renderQuestion(); }
      }

      const pct = Math.round((session.idx / N) * 100);
      timerEl = h('span', { class: 'trivia-timer' }, fmtClock(session.timeLeft));
      updateTimerEl();

      screen(h('div', {}, [
        h('div', { class: 'trivia-topbar' }, [
          h('span', { style: 'font-size:12px;font-weight:700;color:var(--ink-muted);white-space:nowrap' }, tt('trivia.questionOf', { n: session.idx + 1, total: N })),
          h('div', { class: 'trivia-progress' }, [h('div', { style: `width:${pct}%` })]),
          timerEl,
          h('button', { class: 'btn btn-icon btn-ghost btn-sm', title: tt('trivia.exitQuizTitle'), onclick: exitQuiz }, '✕'),
        ]),
        h('div', { class: 'trivia-q' }, pick(q.prompt)),
        optsWrap,
        explainEl,
        nextBtn,
      ]));
    }

    renderQuestion();
  }

  // ---- Results ----
  async function renderResults(profile, outcome) {
    const { score, total, timeUsedSec, timedOut } = outcome;
    const pctScore = score / total;
    let tier;
    if (pctScore >= 0.85) tier = tt('trivia.tierLegend');
    else if (pctScore >= 0.6) tier = tt('trivia.tierGood');
    else if (pctScore >= 0.4) tier = tt('trivia.tierOk');
    else tier = tt('trivia.tierRetry');

    const lb = await trivia.leaderboard();
    const rank = lb.findIndex(p => p.id === profile.id);

    return h('div', {}, [
      h('div', { class: 'trivia-hero' }, [
        h('div', { class: 'eyebrow' }, timedOut ? tt('trivia.timeUpEyebrow') : tt('trivia.doneEyebrow')),
        h('div', { class: 'trivia-score-big' }, `${score}/${total}`),
        h('h1', { style: 'font-size:20px' }, tier),
        h('p', { style: 'font-size:12.5px;color:var(--ink-muted);margin-top:4px' }, tt('trivia.timeUsed', { time: fmtClock(timeUsedSec) })),
      ]),
      rank >= 0 ? card(h('p', { style: 'text-align:center;font-size:13.5px' }, tt('trivia.deviceRank', { rank: rank + 1 }))) : null,
      card([
        h('div', { style: 'font-size:11.5px;color:var(--ink-muted);text-align:center;margin-bottom:6px' }, tt('trivia.livesLeft', { n: profile.lives })),
        h('button', { class: 'btn btn-primary', style: 'width:100%;justify-content:center', onclick: async () => { screen(skeletonCard()); screen(await renderHub(profile)); } }, tt('trivia.backToHub')),
      ]),
    ]);
  }

  // ---- Boot ----
  async function boot() {
    // Registration is mandatory before /trivia is even reachable (see
    // accountGate() in app.js), so this normally always finds an account
    // and signs it straight in — no prompt. Re-running signIn() on every
    // boot keeps the trivia profile's nickname in sync if it was changed
    // later from My Team.
    const acc = account.getAccount();
    if (acc) trivia.signIn(acc.email, acc.nickname);
    let profile = trivia.getActiveProfile();
    if (!profile) { screen(renderAuth()); return; }
    screen(skeletonCard());
    // Reconciles lives/stats with whatever's on file in Firestore for this
    // account, so the same account shows the same lives on every device
    // (not just the leaderboard) — see syncActiveProfileFromRemote's
    // comment in trivia-state.js.
    profile = await trivia.syncActiveProfileFromRemote();
    if (!questionsBank) {
      try { questionsBank = await loadTriviaQuestions(); }
      catch { screen(emptyState(tt('trivia.loadError'))); return; }
    }
    screen(await renderHub(profile));
  }

  await boot();
}
