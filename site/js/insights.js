// ============================================================================
// Insight computation — shared by the Command Center and the Analytics Lab.
// Every function here computes something FROM the loaded season data; none
// of it is pre-written copy. Text templates only fill in numbers that were
// just calculated, so every insight stays traceable back to a raw stat.
// ============================================================================

import { zscore, mean } from './data.js';

/** Current win/loss streak per team, computed from the RS game log (chronological). */
export function currentStreaks(teamGames) {
  const rs = teamGames.filter(g => g.phase === 'RS');
  const byTeam = new Map();
  rs.forEach(g => { if (!byTeam.has(g.team)) byTeam.set(g.team, []); byTeam.get(g.team).push(g); });
  const out = new Map();
  byTeam.forEach((games, team) => {
    games.sort((a, b) => a.gamecode - b.gamecode);
    let streak = 0, kind = null;
    for (let i = games.length - 1; i >= 0; i--) {
      const w = games[i].win;
      if (kind === null) { kind = w; streak = 1; }
      else if (w === kind) streak++;
      else break;
    }
    out.set(team, { streak, kind, games: games.length });
  });
  return out;
}

/** Standout individual performances (by Valuation) from an RS round or window.
 * Pass `round` for one specific round; otherwise the most recent `roundsBack`
 * round(s) played are used (the original behavior). */
export function standoutPerformances(playerGameLog, teamGames, { round, roundsBack = 1, limit = 6 } = {}) {
  const rs = playerGameLog.filter(r => r.Phase === 'RS');
  if (!rs.length) return [];
  const maxRound = Math.max(...rs.map(r => r.Round));
  let minR, maxR;
  if (round != null) { minR = maxR = round; }
  else { maxR = maxRound; minR = maxRound - roundsBack + 1; }
  const pool = rs.filter(r => r.Round >= minR && r.Round <= maxR);
  const oppLookup = new Map();
  teamGames.forEach(g => { oppLookup.set(`${g.team}_${g.gamecode}`, g); });
  return pool
    .slice()
    .sort((a, b) => b.Valuation - a.Valuation)
    .slice(0, limit)
    .map(r => ({ ...r, game: oppLookup.get(`${r.Team}_${r.Gamecode}`) }));
}

/** Highest RS round with any player_game_log rows — the "current" round for pickers. */
export function maxPlayedRound(playerGameLog) {
  const rs = playerGameLog.filter(r => r.Phase === 'RS');
  return rs.length ? Math.max(...rs.map(r => r.Round)) : 0;
}

/** Standout single-game TEAM performances, ranked by margin of victory (each
 * team-game row is that team's own perspective, so this naturally covers
 * both a home blowout and a road blowout as belonging to the team that did
 * it). Pass `round` for one specific round; omit it for every RS round
 * played so far this season ("season to date"). */
export function teamStandoutPerformances(teamGames, { round, limit = 6 } = {}) {
  let pool = teamGames.filter(g => g.phase === 'RS');
  if (round != null) pool = pool.filter(g => g.round === round);
  return pool
    .map(g => ({ ...g, margin: g.team_score - g.opp_score }))
    .sort((a, b) => b.margin - a.margin)
    .slice(0, limit);
}

/** Biggest home/away net-rating split among teams with both splits available. */
export function biggestHomeAwaySplit(teamSeason, { limit = 3 } = {}) {
  return teamSeason
    .filter(t => t.net_rtg_home != null && t.net_rtg_away != null)
    .map(t => ({ ...t, split: t.net_rtg_home - t.net_rtg_away }))
    .sort((a, b) => Math.abs(b.split) - Math.abs(a.split))
    .slice(0, limit);
}

/** Teams whose 3PT shooting (or any statKey) deviates most from league average, both directions. */
export function statOutliers(teamSeason, statKey, { limit = 3, lowerIsBetter = false } = {}) {
  const withZ = teamSeason
    .filter(t => t[statKey] != null)
    .map(t => ({ ...t, z: zscore(teamSeason, statKey, t[statKey]) }));
  const hot = withZ.slice().sort((a, b) => (lowerIsBetter ? a.z - b.z : b.z - a.z)).slice(0, limit);
  const cold = withZ.slice().sort((a, b) => (lowerIsBetter ? b.z - a.z : a.z - b.z)).slice(0, limit);
  return { hot, cold, leagueAvg: mean(teamSeason.map(t => t[statKey]).filter(v => v != null)) };
}

// player_season uses short stat keys (PTS, TRB, AST...); player_game_log keeps the
// API's original per-game field names. This maps the ones hotStreakPlayers can use.
const SEASON_TO_LOG_KEY = {
  PTS: 'Points', TRB: 'TotalRebounds', AST: 'Assistances', STL: 'Steals',
  BLK: 'BlocksFavour', TOV: 'Turnovers', VAL: 'Valuation', PF: 'FoulsCommited',
};

/** Deterministic, stats-based recap of a single team-game: each side's top
 * scorer plus whichever hustle stat (rebounds / assists / turnovers) swung
 * furthest in one team's favor — every number read straight from the
 * per-player boxscore log for that gamecode, nothing written by hand or by
 * an AI. Returns null if that game's boxscore rows aren't in the log. */
export function teamGameSummary(g, playerGameLog) {
  const phase = g.phase || 'RS';
  const rows = playerGameLog.filter(r => r.Gamecode === g.gamecode && r.Phase === phase);
  const mine = rows.filter(r => r.Team === g.team);
  const theirs = rows.filter(r => r.Team === g.opponent);
  if (!mine.length || !theirs.length) return null;
  const topScorer = arr => arr.slice().sort((a, b) => (b.Points || 0) - (a.Points || 0))[0];
  const myTop = topScorer(mine), oppTop = topScorer(theirs);
  const sum = (arr, key) => arr.reduce((s, r) => s + (r[key] || 0), 0);
  const myReb = sum(mine, 'TotalRebounds'), oppReb = sum(theirs, 'TotalRebounds');
  const myAst = sum(mine, 'Assistances'), oppAst = sum(theirs, 'Assistances');
  const myTov = sum(mine, 'Turnovers'), oppTov = sum(theirs, 'Turnovers');
  const candidates = [
    { type: 'reb', mine: myReb, opp: oppReb, diff: myReb - oppReb },
    { type: 'ast', mine: myAst, opp: oppAst, diff: myAst - oppAst },
    { type: 'tov', mine: myTov, opp: oppTov, diff: oppTov - myTov }, // fewer turnovers than the opponent is the favorable direction
  ];
  const swing = candidates.slice().sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))[0];
  return {
    myTop: { name: myTop.Player, pts: myTop.Points || 0 },
    oppTop: { name: oppTop.Player, pts: oppTop.Points || 0 },
    swing: { type: swing.type, mine: swing.mine, opp: swing.opp, favorable: swing.diff >= 0 },
  };
}

/** Player whose recent form (last N games) most exceeds their season average for a stat. */
export function hotStreakPlayers(playerGameLog, playerSeason, statKey, { window = 5, limit = 5, minGames = 8 } = {}) {
  const logKey = SEASON_TO_LOG_KEY[statKey];
  if (!logKey) return [];
  const byPlayer = new Map();
  playerGameLog.filter(r => r.Phase === 'RS').forEach(r => {
    if (!byPlayer.has(r.Player_ID)) byPlayer.set(r.Player_ID, []);
    byPlayer.get(r.Player_ID).push(r);
  });
  const out = [];
  byPlayer.forEach((games, pid) => {
    if (games.length < minGames) return;
    games.sort((a, b) => a.Round - b.Round);
    const recent = games.slice(-window);
    const seasonRow = playerSeason.find(p => p.Player_ID === pid);
    if (!seasonRow) return;
    const recentAvg = mean(recent.map(g => g[logKey] ?? 0));
    const seasonAvg = seasonRow[statKey];
    if (seasonAvg == null || seasonAvg < 2) return;
    out.push({ player: seasonRow, recentAvg, seasonAvg, diff: recentAvg - seasonAvg });
  });
  return out.sort((a, b) => b.diff - a.diff).slice(0, limit);
}
