// ============================================================================
// "My Team" — a personalized page built around the favorite team chosen at
// the mandatory registration gate (js/views/account-gate.js), reading it
// from js/account.js. Standout stats, streak and next game for that one
// team, plus a control to change it.
// ============================================================================

import { loadSeason, SEASONS, SEASON_LABELS, percentile, isUpcomingSeason } from '../data.js';
import { currentStreaks, teamStandoutPerformances } from '../insights.js';
import {
  h, card, sectionHead, statTile, emptyState, skeletonCard, entityHero,
  comboSelect, ticketCard, formPills, teamStandoutCard,
} from '../components.js';
import { fmtNum, fmtSigned, fmtPct, hashColor, statLabel, fmtStat, STAT_META, gameTimeAthens, gameStartMs } from '../format.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import * as account from '../account.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

// key stat tiles for the hero strip — `low: true` means lower is better
// (DRtg); `low: null` means the stat is context, not good/bad (PACE), so no
// percentile note is shown for it.
const HERO_STATS = [
  { key: 'PPG', low: false },
  { key: 'ORtg', low: false },
  { key: 'DRtg', low: true },
  { key: 'NET_RTG', low: false },
  { key: 'PACE', low: null },
];

function teamPickerRow(teams, currentCode, onPick) {
  return h('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px' }, [
    h('div', { style: 'width:260px;max-width:100%' }, [
      comboSelect({
        items: teams.map(t => ({ value: t.team_code, label: t.team_name })),
        value: currentCode,
        onChange: onPick,
      }),
    ]),
    h('span', { style: 'font-size:11.5px;color:var(--ink-muted)' }, tt('myteam.changeTeamHint')),
  ]);
}

// ---------------------------------------------------------------------------
// Banter — a short, teasing first-person note addressing the fan by
// nickname. The roast line is picked from whichever real, currently-true
// thing about their team is most roastable — a live losing streak, a recent
// blowout loss, a genuinely bad percentile stat, or (if nothing else bites)
// a below-.500 record — never invented, always traceable to real numbers,
// same as the deterministic insights elsewhere in the app. Plus a special
// jab if they're riding for Panathinaikos or Olympiacos, EuroLeague's oldest
// rivalry (each gets ribbed with the other's real record, in both directions).
// ---------------------------------------------------------------------------
const BANTER_STAT_POOL = ['DRtg', 'TOV_PCT', 'FG3_PCT', 'FT_PCT', 'ORB_PCT', 'OPP_EFG', 'ORtg', 'eFG'];

function worstTeamStat(team, pool) {
  let worst = null;
  BANTER_STAT_POOL.forEach(key => {
    const meta = STAT_META[key];
    if (!meta || team[key] == null) return;
    const pct = percentile(pool, key, team[key], meta.hib === false);
    if (pct == null) return;
    if (!worst || pct < worst.pct) worst = { key, pct, value: team[key] };
  });
  return worst;
}

// Worst single-game loss this season (biggest negative margin), for the
// "still recovering from that beatdown" angle.
function worstLoss(teamCode, teamGames) {
  const losses = (teamGames || []).filter(g => g.team === teamCode && g.phase === 'RS' && !g.win);
  if (!losses.length) return null;
  return losses.slice().sort((a, b) => (a.team_score - a.opp_score) - (b.team_score - b.opp_score))[0];
}

const RIVALS = { PAN: 'OLY', OLY: 'PAN' };

// Picks the single most roastable, real thing about this team right now.
// Priority: an active skid > a recent blowout loss > a genuinely bad stat
// (bottom 40%) > a losing record > (team's actually fine) the worst-ranked
// stat anyway, so there's always at least a light jab.
function roastLine(team, season) {
  const streaks = currentStreaks(season.team_games);
  const cur = streaks.get(team.team_code);
  if (cur && cur.kind === false && cur.streak >= 2) {
    return tt('myteam.banterSkid', { n: cur.streak });
  }
  const loss = worstLoss(team.team_code, season.team_games);
  if (loss && (loss.opp_score - loss.team_score) >= 15) {
    return tt('myteam.banterBlowout', {
      margin: loss.opp_score - loss.team_score,
      opp: loss.opponent_name || loss.opponent,
      round: loss.round_name || tt('common.round', { n: loss.round }),
    });
  }
  const worst = worstTeamStat(team, season.team_season);
  if (worst && worst.pct <= 40) {
    return tt('myteam.banterWorst', { stat: statLabel(worst.key), pct: worst.pct, value: fmtStat(worst.key, worst.value) });
  }
  if (team.win_pct < 0.5) {
    return tt('myteam.banterRecord', { wins: team.wins, losses: team.losses, pos: team.position });
  }
  if (worst) {
    return tt('myteam.banterWorst', { stat: statLabel(worst.key), pct: worst.pct, value: fmtStat(worst.key, worst.value) });
  }
  return null;
}

function banterCard(acc, team, season) {
  const parts = [tt('myteam.banterIntro', { name: acc.nickname, team: team.team_name })];
  const roast = roastLine(team, season);
  if (roast) parts.push(roast);
  const rivalCode = RIVALS[team.team_code];
  if (rivalCode) {
    const rival = (season.team_season || []).find(t => t.team_code === rivalCode);
    if (rival) {
      parts.push(tt(team.team_code === 'PAN' ? 'myteam.banterRivalAsPAN' : 'myteam.banterRivalAsOLY', {
        rivalWins: rival.wins, rivalLosses: rival.losses, rivalPos: rival.position,
      }));
    }
  }
  return card(h('p', { style: 'font-size:13.5px;color:var(--ink-secondary);line-height:1.55' }, parts.join(' ')), { title: tt('myteam.banterTitle') });
}

export async function renderMyTeam(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const acc = account.getAccount();
  if (!acc) { wrap.innerHTML = ''; wrap.appendChild(emptyState(tt('myteam.noAccount'))); return; }

  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('myteam.loadError'))); return; }

  // The team list for the "change team" picker always comes from a season
  // that actually has a schedule (an upcoming season doesn't), so the
  // picker works no matter which season is currently toggled. It's built
  // from the schedule (every club fixtured this season) rather than
  // team_season, which only gets a row once a club has actually played —
  // early in a season (e.g. a round still in progress) that can be missing
  // a handful of clubs. Names come from team_season (properly cased) where
  // available, falling back to the schedule's own ALL-CAPS name otherwise.
  const pickerSeasonNum = isUpcomingSeason(state.season) ? SEASONS.find(s => !isUpcomingSeason(s)) : state.season;
  const pickerSeason = pickerSeasonNum === state.season ? season : await loadSeason(pickerSeasonNum).catch(() => null);
  const pickerNameByCode = new Map(
    (pickerSeason && Array.isArray(pickerSeason.team_season) ? pickerSeason.team_season : [])
      .map(t => [t.team_code, t.team_name])
  );
  const pickerCodesFromSchedule = new Map();
  (pickerSeason && Array.isArray(pickerSeason.schedule) ? pickerSeason.schedule : []).forEach(g => {
    if (g.homecode && !pickerCodesFromSchedule.has(g.homecode)) pickerCodesFromSchedule.set(g.homecode, g.hometeam);
    if (g.awaycode && !pickerCodesFromSchedule.has(g.awaycode)) pickerCodesFromSchedule.set(g.awaycode, g.awayteam);
  });
  const pickerTeams = pickerCodesFromSchedule.size
    ? Array.from(pickerCodesFromSchedule, ([team_code, scheduleName]) => ({
        team_code, team_name: pickerNameByCode.get(team_code) || scheduleName,
      })).sort((a, b) => a.team_name.localeCompare(b.team_name))
    : (pickerSeason && Array.isArray(pickerSeason.team_season) ? pickerSeason.team_season.slice() : [])
        .sort((a, b) => a.team_name.localeCompare(b.team_name));

  function changeTeam(code) {
    account.updateFavoriteTeam(code);
    renderMyTeam(root);
  }

  wrap.appendChild(h('div', { style: 'margin-bottom:4px' }, [
    h('div', { class: 'eyebrow' }, tt('myteam.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:14px' }, tt('myteam.title', { name: acc.nickname })),
  ]));
  if (pickerTeams.length) wrap.appendChild(teamPickerRow(pickerTeams, acc.favoriteTeamCode, changeTeam));

  const team = (season.team_season || []).find(t => t.team_code === acc.favoriteTeamCode);

  // ---- Upcoming season (or no stats yet for this team this season) ----
  if (isUpcomingSeason(state.season) || !team) {
    const teamName = (pickerTeams.find(t => t.team_code === acc.favoriteTeamCode) || {}).team_name || acc.favoriteTeamCode;
    wrap.appendChild(card(
      h('p', { style: 'font-size:13.5px;color:var(--ink-secondary)' }, tt('myteam.upcomingNote', { team: teamName, season: SEASON_LABELS[state.season] })),
      { title: teamName }
    ));
    const games = (season.schedule || []).filter(g => g.homecode === acc.favoriteTeamCode || g.awaycode === acc.favoriteTeamCode);
    if (games.length) {
      const next = games.slice().sort((a, b) => (gameStartMs(a) ?? 0) - (gameStartMs(b) ?? 0)).slice(0, 6);
      wrap.appendChild(sectionHead(tt('myteam.upcomingFixturesHead'), { count: next.length }));
      const row = h('div', { class: 'ticket-row' });
      next.forEach(g => row.appendChild(ticketCard({
        roundLabel: tt('common.round', { n: g.gameday }),
        dateLabel: `${g.date} · ${gameTimeAthens(g)}`,
        teams: [{ code: g.homecode }, { code: g.awaycode }],
      })));
      wrap.appendChild(row);
    } else {
      wrap.appendChild(emptyState(tt('comingSoon.noSchedule')));
    }
    return;
  }

  setAIContext(`My Team: ${team.team_name}`, { team, league_averages: season.league_averages });

  // ---- Hero ----
  wrap.appendChild(entityHero({
    crestText: team.team_code,
    crestColor: hashColor(team.team_code),
    crestLogo: team.team_code,
    name: team.team_name,
    meta: tt('teams.heroMeta', { pos: team.position, wins: team.wins, losses: team.losses, pct: fmtPct(team.win_pct), season: SEASON_LABELS[state.season] }),
    side: [
      h('span', { style: 'background:rgba(255,255,255,.22);color:#fff;font-family:var(--font-data);font-weight:800;font-size:12px;padding:4px 10px;border-radius:var(--radius-sm)' }, `NET ${fmtSigned(team.NET_RTG)}`),
      formPills(team.last5_form),
    ],
  }));

  // ---- Banter ----
  wrap.appendChild(h('div', { style: 'margin-top:16px' }, [banterCard(acc, team, season)]));

  // ---- Standout stats with league percentile ----
  wrap.appendChild(sectionHead(tt('myteam.statsHead')));
  const statsGrid = h('div', { class: 'grid grid-3', style: 'margin-bottom:20px' });
  HERO_STATS.forEach(({ key, low }) => {
    const val = team[key];
    let foot = null;
    if (low !== null && val != null) {
      const pct = percentile(season.team_season, key, val, low);
      if (pct != null) foot = tt('myteam.betterThan', { pct });
    }
    statsGrid.appendChild(statTile({ statKey: key, value: key === 'NET_RTG' ? fmtSigned(val) : fmtNum(val), foot }));
  });
  wrap.appendChild(statsGrid);

  // ---- Streak ----
  const streaks = currentStreaks(season.team_games);
  const myStreak = streaks.get(team.team_code);
  if (myStreak && myStreak.streak > 0) {
    wrap.appendChild(card(
      h('p', { style: 'font-size:13.5px;text-align:center' },
        tt(myStreak.kind ? 'myteam.streakWin' : 'myteam.streakLoss', { n: myStreak.streak })),
    ));
  }

  // ---- Next game ----
  const upcoming = (season.schedule || [])
    .filter(g => (g.homecode === team.team_code || g.awaycode === team.team_code) && g.played !== 'true')
    .sort((a, b) => (gameStartMs(a) ?? 0) - (gameStartMs(b) ?? 0));
  if (upcoming.length) {
    wrap.appendChild(sectionHead(tt('myteam.nextGameHead')));
    const row = h('div', { class: 'ticket-row', style: 'margin-bottom:20px' });
    row.appendChild(ticketCard({
      roundLabel: tt('common.round', { n: upcoming[0].gameday }),
      dateLabel: `${upcoming[0].date} · ${gameTimeAthens(upcoming[0])}`,
      teams: [{ code: upcoming[0].homecode }, { code: upcoming[0].awaycode }],
    }));
    wrap.appendChild(row);
  }

  // ---- Standout performances ----
  const myGames = (season.team_games || []).filter(g => g.team === team.team_code);
  const standouts = teamStandoutPerformances(myGames, { limit: 4 });
  wrap.appendChild(sectionHead(tt('myteam.standoutsHead')));
  if (standouts.length) {
    const grid = h('div', { class: 'grid grid-2', style: 'margin-bottom:20px' });
    standouts.forEach(g => grid.appendChild(teamStandoutCard({
      g, onClick: () => navigate(`/team/${team.team_code}`), playerGameLog: season.player_game_log,
    })));
    wrap.appendChild(grid);
  } else {
    wrap.appendChild(emptyState(tt('myteam.noStandouts')));
  }

  wrap.appendChild(h('div', { style: 'text-align:center;margin-top:8px' }, [
    h('button', { class: 'btn btn-primary', onclick: () => navigate(`/team/${team.team_code}`) }, tt('myteam.viewFullProfile')),
  ]));

  wrap.appendChild(h('div', { style: 'text-align:center;margin-top:16px' }, [
    h('span', {
      style: 'font-size:11.5px;color:var(--ink-muted);cursor:pointer;text-decoration:underline dotted',
      onclick: () => navigate('/profile'),
    }, tt('myteam.notYou')),
  ]));
}
