// ============================================================================
// Standout Performances — a dedicated page for browsing the season's best
// single-game outputs. Two lenses: "Season to date" (every RS round played
// so far, team-level, ranked by game margin) and "By Round" (pick one round,
// see both team-level and player-level standouts for it).
// ============================================================================

import { loadSeason } from '../data.js';
import { teamStandoutPerformances, standoutPerformances, maxPlayedRound } from '../insights.js';
import { h, card, sectionHead, emptyState, skeletonCard, comboSelect, teamStandoutCard, playerStandoutCard } from '../components.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t } from '../i18n.js';

export async function renderStandouts(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);
  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(t('standouts.loadError'))); return; }

  const { team_games, team_season, player_game_log } = season;
  const lastRound = maxPlayedRound(player_game_log);

  wrap.appendChild(h('div', {}, [
    h('div', { class: 'eyebrow' }, t('standouts.eyebrow')),
    h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:6px' }, t('standouts.title')),
    h('p', { style: 'font-size:13px;color:var(--ink-muted);margin-bottom:20px' }, t('standouts.subtitle')),
  ]));

  const teamNameByCode = new Map(team_season.map(tm => [tm.team_code, tm.team_name]));
  function withTeamName(g) { return { ...g, team_name: teamNameByCode.get(g.team) || g.team, opponent_name: teamNameByCode.get(g.opponent) || g.opponent }; }

  // ---------------- Season to date: team standouts ----------------
  wrap.appendChild(sectionHead(t('standouts.seasonHead', { round: lastRound }), { count: 9 }));
  const seasonGrid = h('div', { class: 'grid grid-3' });
  teamStandoutPerformances(team_games, { limit: 9 }).forEach(g => {
    seasonGrid.appendChild(teamStandoutCard({ g: withTeamName(g), onClick: () => navigate(`/team/${g.team}`), playerGameLog: player_game_log }));
  });
  wrap.appendChild(seasonGrid);

  // ---------------- By round: team + player standouts ----------------
  let round = lastRound;
  const roundHeadSlot = h('div');
  const roundPicker = h('div', { style: 'width:220px;max-width:100%' }, [
    comboSelect({
      items: Array.from({ length: lastRound }, (_, i) => lastRound - i).map(n => ({ value: String(n), label: t('common.round', { n }) })),
      value: String(round),
      onChange: (v) => { round = Number(v); renderRound(); },
    }),
  ]);
  wrap.appendChild(h('div', { style: 'display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-top:24px;margin-bottom:2px' }, [
    roundHeadSlot, h('div', { style: 'margin-left:auto' }, [roundPicker]),
  ]));
  const teamRoundGrid = h('div', { class: 'grid grid-3' });
  const playerRoundHead = h('div');
  const playerRoundGrid = h('div', { class: 'grid grid-3' });
  wrap.appendChild(teamRoundGrid);
  wrap.appendChild(playerRoundHead);
  wrap.appendChild(playerRoundGrid);

  function renderRound() {
    roundHeadSlot.innerHTML = '';
    roundHeadSlot.appendChild(sectionHead(t('standouts.roundTeamHead', { round })));
    teamRoundGrid.innerHTML = '';
    const teamRows = teamStandoutPerformances(team_games, { round, limit: 6 });
    teamRows.forEach(g => teamRoundGrid.appendChild(teamStandoutCard({ g: withTeamName(g), onClick: () => navigate(`/team/${g.team}`), playerGameLog: player_game_log })));
    if (!teamRows.length) teamRoundGrid.appendChild(emptyState(t('standouts.noGamesThisRound')));

    playerRoundHead.innerHTML = '';
    playerRoundHead.appendChild(sectionHead(t('standouts.roundPlayerHead', { round }), { count: null }));
    playerRoundGrid.innerHTML = '';
    const playerRows = standoutPerformances(player_game_log, team_games, { round, limit: 6 });
    playerRows.forEach(r => {
      const teamRow = team_season.find(x => x.team_code === r.Team);
      playerRoundGrid.appendChild(playerStandoutCard({ r, teamCode: teamRow ? teamRow.team_code : r.Team, onClick: () => navigate(`/player/${r.Player_ID}`) }));
    });
    if (!playerRows.length) playerRoundGrid.appendChild(emptyState(t('standouts.noGamesThisRound')));

    setAIContext(t('nav.standouts'), {
      round,
      team_standouts: teamRows.map(g => ({ team: g.team_name, opponent: g.opponent_name, score: `${g.team_score}-${g.opp_score}`, margin: g.margin })),
      player_standouts: playerRows.map(r => ({ player: r.Player, team: r.Team, pts: r.Points, reb: r.TotalRebounds, ast: r.Assistances, pir: r.Valuation })),
    });
  }
  renderRound();
}
