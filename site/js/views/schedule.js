// ============================================================================
// Full round-by-round schedule browser — shared by two call sites:
//   - the "coming soon" screen (js/views/coming-soon.js), for the upcoming
//     season, where every game is still unplayed;
//   - the standalone Schedule page (renderSchedulePage below), for a season
//     that has already been played, with results filled in.
//
// schedule.json never carries a score, even for a finished game (checked
// against the raw feed directly) — a played game's result lives in
// team_games.json instead, one row per team per game. renderRoundSchedule
// joins them by round + home/away team code (schedule's own game id scheme
// doesn't line up with team_games' gamecode). So this same component
// automatically starts showing scores the moment a season's team_games
// dataset is populated — no code change needed once a future session
// republishes with real results, which is also why the "coming soon" screen
// can honestly say scores will appear here once the season is underway.
// ============================================================================

import { h, sectionHead, emptyState, comboSelect, teamCrestImg, skeletonCard } from '../components.js';
import { hashColor, gameTimeAthens, gameStartMs } from '../format.js';
import { loadSeason, isUpcomingSeason } from '../data.js';
import { state } from '../state.js';
import { t } from '../i18n.js';

function buildScoreLookup(teamGames) {
  const map = new Map();
  (teamGames || []).forEach(r => { if (r.home) map.set(`${r.round}_${r.team}_${r.opponent}`, r); });
  return map;
}

// The "current" round — the one worth defaulting the filter to and marking
// with a star — is the earliest round that isn't fully played yet (i.e. the
// round in progress, or the next one up during the gap between rounds). If
// every round is complete (season over), that's the last one.
export function currentRoundNumber(games) {
  const rounds = Array.from(new Set((games || []).map(g => g.gameday))).sort((a, b) => a - b);
  for (const r of rounds) {
    const roundGames = games.filter(g => g.gameday === r);
    const allPlayed = roundGames.every(g => g.played === true || g.played === 'true');
    if (!allPlayed) return r;
  }
  return rounds.length ? rounds[rounds.length - 1] : 1;
}

export function renderRoundSchedule(container, { games, teamGames = [], defaultRound } = {}) {
  container.innerHTML = '';
  if (!games || !games.length) { container.appendChild(emptyState(t('comingSoon.noSchedule'))); return; }

  const scoreByKey = buildScoreLookup(teamGames);
  const rounds = Array.from(new Set(games.map(g => g.gameday))).sort((a, b) => a - b);
  const currentRound = currentRoundNumber(games);
  let round = rounds.includes(defaultRound) ? defaultRound : (rounds.includes(currentRound) ? currentRound : rounds[0]);

  const headRow = h('div', { style: 'display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:2px' });
  const headSlot = h('div');
  const picker = h('div', { style: 'width:200px;max-width:100%' }, [
    comboSelect({
      items: rounds.map(n => ({ value: String(n), label: (n === currentRound ? '★ ' : '') + t('common.round', { n }) })),
      value: String(round),
      onChange: (v) => { round = Number(v); renderBody(); },
    }),
  ]);
  headRow.appendChild(headSlot);
  headRow.appendChild(h('div', { style: 'margin-left:auto' }, [picker]));
  container.appendChild(headRow);

  const gridSlot = h('div', { class: 'schedule-grid' });
  container.appendChild(gridSlot);

  function renderBody() {
    headSlot.innerHTML = '';
    headSlot.appendChild(sectionHead(t('common.round', { n: round })));
    gridSlot.innerHTML = '';
    const rows = games.filter(g => g.gameday === round).slice()
      .sort((a, b) => (gameStartMs(a) ?? 0) - (gameStartMs(b) ?? 0));
    if (!rows.length) { gridSlot.appendChild(emptyState(t('standouts.noGamesThisRound'))); return; }
    rows.forEach(g => {
      const homeRow = scoreByKey.get(`${round}_${g.homecode}_${g.awaycode}`);
      gridSlot.appendChild(scheduleTile({
        date: g.date,
        time: gameTimeAthens(g),
        teams: [
          { code: g.homecode, score: homeRow ? homeRow.team_score : undefined, win: homeRow ? homeRow.win : undefined },
          { code: g.awaycode, score: homeRow ? homeRow.opp_score : undefined, win: homeRow ? !homeRow.win : undefined },
        ],
      }));
    });
  }
  renderBody();
}

// A single square fixture tile for the schedule grid above — date up top,
// the two teams (crest + code, score once played) stacked in the middle,
// kickoff time along the bottom. Square by design (see the CSS): many of
// these tile side by side into one screen-filling grid, echoing the
// season-toggle's own square-button look, rather than the old horizontally
// -scrolling ticket strip (still used elsewhere — Command Center, My Team
// — where a compact row of a few upcoming/recent games fits better).
function scheduleTile({ date, time, teams }) {
  const tile = h('div', { class: 'schedule-tile' });
  tile.appendChild(h('div', { class: 'sc-date' }, date || ''));
  const teamsWrap = h('div', { class: 'sc-teams' });
  teams.forEach((tm, i) => {
    if (i === 1) teamsWrap.appendChild(h('div', { class: 'sc-vs' }, t('common.vs')));
    const crest = teamCrestImg(tm.code, { size: 20 });
    teamsWrap.appendChild(h('div', { class: 'sc-team' }, [
      crest || h('span', { class: 'sc-dot', style: `background:${hashColor(tm.code)}` }),
      h('span', { class: 'sc-code', style: tm.win ? 'color:var(--ink)' : 'color:var(--ink-muted)' }, tm.code),
      tm.score !== undefined ? h('span', { class: 'sc-score', style: tm.win ? 'font-weight:800' : 'font-weight:600' }, String(tm.score)) : null,
    ]));
  });
  tile.appendChild(teamsWrap);
  tile.appendChild(h('div', { class: 'sc-time' }, time || ''));
  return tile;
}

// ---------------------------------------------------------------------------
// Standalone /schedule route — only reached for a season that has already
// started (an upcoming season is intercepted earlier by seasonGate(), which
// shows the "coming soon" screen instead — that screen embeds this same
// round browser, see coming-soon.js).
// ---------------------------------------------------------------------------
export async function renderSchedulePage(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season || !Array.isArray(season.schedule) || !season.schedule.length) {
    wrap.appendChild(emptyState(t('comingSoon.noSchedule')));
    return;
  }

  wrap.appendChild(h('div', { style: 'margin-bottom:16px' }, [
    h('div', { class: 'eyebrow' }, t('schedule.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:4px' }, t('schedule.title')),
  ]));

  // No defaultRound passed here on purpose: renderRoundSchedule() defaults
  // to the current round (earliest not-fully-played round, i.e. the one in
  // progress or coming up next) on its own — see currentRoundNumber() above.
  const scheduleWrap = h('div');
  wrap.appendChild(scheduleWrap);
  renderRoundSchedule(scheduleWrap, { games: season.schedule, teamGames: season.team_games });
}
