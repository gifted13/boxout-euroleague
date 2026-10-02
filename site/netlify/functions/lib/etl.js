// ============================================================================
// EuroLeague Basketball Intelligence Platform — ETL / Analytics Engine (JS port)
//
// This is a faithful JavaScript port of scripts/build_processed.py (the
// pandas-based offline ETL that has always produced site/data/{season}/*.json).
// It is NOT wired into any Netlify Function — this site deploys as a
// manually-uploaded zip with no backend, and stats updates are a deliberate,
// human-reviewed step: a Claude session (or anyone with Node + the paid API)
// pulls fresh raw JSON, runs this against it, and the resulting
// site/data/{season}/*.json files are re-uploaded as part of the next
// deploy. It lives under netlify/functions/lib/ only so a Node script can
// require() it directly with no separate build step; nothing here runs at
// request time.
//
// Ported line-for-line against build_processed.py — see that file for the
// original. Where the raw API's field names have drifted since that script
// was written (confirmed empirically on 2026-09-24 — see readTeamsBB below),
// this port reads the CURRENT field name and falls back to the old one, so a
// future drift in the other direction doesn't silently break it either.
//
// No pandas/numpy here — every groupby/agg is hand-rolled below. Field-for-
// field, this produces the same JSON shape build_processed.py does; validated
// against site/data/2025/*.json in scripts/validate_etl.js.
// ============================================================================
'use strict';

const STAT_COLS = ["Points","FieldGoalsMade2","FieldGoalsAttempted2","FieldGoalsMade3",
  "FieldGoalsAttempted3","FreeThrowsMade","FreeThrowsAttempted",
  "OffensiveRebounds","DefensiveRebounds","TotalRebounds","Assistances",
  "Steals","Turnovers","BlocksFavour","BlocksAgainst","FoulsCommited",
  "FoulsReceived","Valuation"];

function pick(obj, ...keys) {
  for (const k of keys) { if (obj[k] !== undefined) return obj[k]; }
  return undefined;
}

function mmssToMinutes(s) {
  if (!s || typeof s !== 'string' || s.indexOf(':') === -1) return 0.0;
  const [m, sec] = s.split(':');
  const mm = parseInt(m, 10), ss = parseInt(sec, 10);
  if (Number.isNaN(mm) || Number.isNaN(ss)) return 0.0;
  return mm + ss / 60.0;
}

function safeDiv(a, b) { return b ? a / b : null; }

// Season 2026's games_report_season.date arrived as an ISO 8601 string
// ("2026-09-24T20:00:00") instead of the numeric epoch-ms seasons 2024/2025
// used — confirmed empirically 2026-09-25. Handles both so sorting never
// silently does NaN math on a string.
function dateMs(d) {
  if (typeof d === 'number') return d;
  if (typeof d === 'string') { const t = Date.parse(d); return Number.isNaN(t) ? 0 : t; }
  return 0;
}

/** Python's ast.literal_eval("['W','L']") -> ['W','L']; tolerant of non-list input. */
function parseForm(v) {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== 'string') return null;
  try {
    const items = v.trim().replace(/^\[|\]$/g, '').split(',')
      .map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(s => s.length);
    return items.length ? items : null;
  } catch { return null; }
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function sum(rows, col) { let s = 0; for (const r of rows) s += (Number(r[col]) || 0); return s; }
function mean(rows, col) { return rows.length ? sum(rows, col) / rows.length : 0; }
function uniqueCount(rows, col) { return new Set(rows.map(r => r[col])).size; }

/** Team season traditional averages from a slice of the (already-cleaned) player boxscore rows. */
function buildTeamTrad(boxSlice) {
  if (!boxSlice.length) return [];
  // team_game: one row per (Team, Gamecode), STAT_COLS summed across that team's players.
  const byTeamGame = groupBy(boxSlice, r => r.Team + '\u0000' + r.Gamecode);
  const teamGameRows = [];
  for (const [, rows] of byTeamGame) {
    const row = { Team: rows[0].Team, Gamecode: rows[0].Gamecode };
    for (const c of STAT_COLS) row[c] = sum(rows, c);
    teamGameRows.push(row);
  }
  const byTeam = groupBy(teamGameRows, r => r.Team);
  const out = [];
  for (const [team, rows] of byTeam) {
    const t = {
      Team: team, GP: rows.length,
      PPG: mean(rows, 'Points'),
      FGM2: mean(rows, 'FieldGoalsMade2'), FGA2: mean(rows, 'FieldGoalsAttempted2'),
      FGM3: mean(rows, 'FieldGoalsMade3'), FGA3: mean(rows, 'FieldGoalsAttempted3'),
      FTM: mean(rows, 'FreeThrowsMade'), FTA: mean(rows, 'FreeThrowsAttempted'),
      ORB: mean(rows, 'OffensiveRebounds'), DRB: mean(rows, 'DefensiveRebounds'),
      TRB: mean(rows, 'TotalRebounds'), AST: mean(rows, 'Assistances'),
      STL: mean(rows, 'Steals'), TOV: mean(rows, 'Turnovers'),
      BLK: mean(rows, 'BlocksFavour'), BLKA: mean(rows, 'BlocksAgainst'),
      PF: mean(rows, 'FoulsCommited'), PFR: mean(rows, 'FoulsReceived'),
      VAL: mean(rows, 'Valuation'),
    };
    t.FG2_PCT = safeDiv(t.FGM2, t.FGA2);
    t.FG3_PCT = safeDiv(t.FGM3, t.FGA3);
    t.FT_PCT = safeDiv(t.FTM, t.FTA);
    t.FGM_TOTAL = t.FGM2 + t.FGM3;
    t.FGA_TOTAL = t.FGA2 + t.FGA3;
    t.FG_PCT = safeDiv(t.FGM_TOTAL, t.FGA_TOTAL);
    out.push(t);
  }
  return out;
}

/** Player season per-game averages + shooting splits + derived metrics from a slice of played rows. */
function buildPlayerAgg(playedSlice, qualifierGames) {
  if (!playedSlice.length) return [];
  const byPlayer = groupBy(playedSlice, r => r.Player_ID);
  const out = [];
  for (const [pid, rows] of byPlayer) {
    const last = rows[rows.length - 1];
    const p = {
      Player_ID: pid, Player: last.Player, Team: last.Team,
      GP: uniqueCount(rows, 'Gamecode'),
      GS: sum(rows, 'IsStarter'),
      MIN: mean(rows, 'MinutesFloat'),
      PTS: mean(rows, 'Points'),
      FGM2: mean(rows, 'FieldGoalsMade2'), FGA2: mean(rows, 'FieldGoalsAttempted2'),
      FGM3: mean(rows, 'FieldGoalsMade3'), FGA3: mean(rows, 'FieldGoalsAttempted3'),
      FTM: mean(rows, 'FreeThrowsMade'), FTA: mean(rows, 'FreeThrowsAttempted'),
      ORB: mean(rows, 'OffensiveRebounds'), DRB: mean(rows, 'DefensiveRebounds'),
      TRB: mean(rows, 'TotalRebounds'), AST: mean(rows, 'Assistances'),
      STL: mean(rows, 'Steals'), TOV: mean(rows, 'Turnovers'),
      BLK: mean(rows, 'BlocksFavour'), BLKA: mean(rows, 'BlocksAgainst'),
      PF: mean(rows, 'FoulsCommited'), PFR: mean(rows, 'FoulsReceived'),
      VAL: mean(rows, 'Valuation'), PM: mean(rows, 'Plusminus'),
      Dorsal: last.Dorsal,
    };
    p.FG2_PCT = safeDiv(p.FGM2, p.FGA2);
    p.FG3_PCT = safeDiv(p.FGM3, p.FGA3);
    p.FT_PCT = safeDiv(p.FTM, p.FTA);
    p.FGM_TOTAL = p.FGM2 + p.FGM3;
    p.FGA_TOTAL = p.FGA2 + p.FGA3;
    p.FG_PCT = safeDiv(p.FGM_TOTAL, p.FGA_TOTAL);
    const tsDenom = 2 * (p.FGA_TOTAL + 0.44 * p.FTA);
    p.TS_PCT = tsDenom > 0 ? p.PTS / tsDenom : null;
    p.EFG_PCT = p.FGA_TOTAL > 0 ? (p.FGM2 + 1.5 * p.FGM3) / p.FGA_TOTAL : null;
    for (const col of ['PTS', 'TRB', 'AST', 'STL', 'BLK', 'TOV']) {
      p[`${col}_PER36`] = p.MIN > 0 ? (p[col] / p.MIN) * 36 : null;
    }
    if (qualifierGames != null) p.qualified = p.GP >= qualifierGames;
    out.push(p);
  }
  return out;
}

/**
 * Runs the full ETL for one season from raw API payloads (same shape as
 * data/raw/{season}/*.json) and returns the same set of datasets
 * build_processed.py writes as files, keyed the same way.
 */
function runEtl(raw) {
  const standings = raw.standings || [];
  const teamsAdv = raw.teams_advanced_stats || [];
  const teamsEff = raw.teams_efficiency_landscape || [];
  const teamsBB = raw.teams_buzzer_beaters || [];
  const shotZones = raw.shot_zones || {};
  const schedule = raw.schedule || [];
  const gamesReport = raw.games_report_season || [];
  const boxscoreRaw = raw.boxscore_players_season || [];
  const fouls = raw.fouls_analysis_season || [];
  const msi = raw.players_msi_season || [];

  // Synthetic per-team summary rows (Player_ID == "Total"/"Team") must be excluded
  // before any aggregation, or team/player totals get double-counted.
  const boxDf = boxscoreRaw.filter(r => r.Player_ID !== 'Total' && r.Player_ID !== 'Team')
    .map(r => ({ ...r, MinutesFloat: mmssToMinutes(r.Minutes), Played: mmssToMinutes(r.Minutes) > 0 }));

  const gamecodePhase = new Map();
  for (const r of boxDf) if (!gamecodePhase.has(r.Gamecode)) gamecodePhase.set(r.Gamecode, r.Phase);

  const boxRs = boxDf.filter(r => r.Phase === 'RS');
  const boxPost = boxDf.filter(r => r.Phase !== 'RS');

  // ---------- TEAM SEASON TRADITIONAL AVERAGES (Regular Season) ----------
  const teamTrad = buildTeamTrad(boxRs);
  const teamTradByCode = new Map(teamTrad.map(t => [t.Team, t]));
  const advByClub = new Map(teamsAdv.map(t => [t.club, t]));
  const effByIndex = new Map(teamsEff.map(t => [t.index, t]));
  // Confirmed live on 2026-09-24: current wire format is "Team"/"Buzzer Beaters"/
  // "Buzzer Chokers" (with spaces) — the old raw cache used "BuzzerBeaters"/
  // "BuzzerChokers". Support both. A trailing {Team: null} row is dropped.
  const bbByName = new Map(
    teamsBB.filter(t => pick(t, 'Team') != null)
      .map(t => [pick(t, 'Team'), {
        buzzer_beaters: pick(t, 'Buzzer Beaters', 'BuzzerBeaters'),
        buzzer_chokers: pick(t, 'Buzzer Chokers', 'BuzzerChokers'),
      }])
  );

  const formMap = new Map();
  const grSorted = gamesReport.slice().sort((a, b) => dateMs(a.date) - dateMs(b.date));
  for (const row of grSorted) {
    if (!row.played) continue;
    formMap.set(row['local.club.code'], row.localLast5Form);
    formMap.set(row['road.club.code'], row.roadLast5Form);
  }

  const teamSeason = standings.map(s => {
    const trad = teamTradByCode.get(s.team_code) || {};
    const adv = advByClub.get(s.team_code) || {};
    const eff = effByIndex.get(s.team_code) || {};
    const bb = bbByName.get(s.team_name) || {};
    const row = { ...s };
    for (const [k, v] of Object.entries(trad)) if (k !== 'Team') row[k] = v;
    for (const [k, v] of Object.entries(adv)) if (k !== 'club') row[k] = v;
    row.off_rtg_home = eff.off_rtg_home ?? null; row.def_rtg_home = eff.def_rtg_home ?? null; row.net_rtg_home = eff.net_rtg_home ?? null;
    row.off_rtg_away = eff.off_rtg_away ?? null; row.def_rtg_away = eff.def_rtg_away ?? null; row.net_rtg_away = eff.net_rtg_away ?? null;
    if (teamsBB.length) { row.buzzer_beaters = bb.buzzer_beaters ?? null; row.buzzer_chokers = bb.buzzer_chokers ?? null; }
    row.last5_form = parseForm(formMap.get(s.team_code));
    row.win_pct = safeDiv(s.wins, s.games_played);
    return row;
  });

  // ---------- TEAM PLAYOFFS/PLAY-IN/FINAL FOUR AVERAGES ----------
  const teamPostTrad = buildTeamTrad(boxPost);
  const nameByCode = new Map(standings.map(s => [s.team_code, s.team_name]));
  let teamPlayoffs = [];
  if (teamPostTrad.length) {
    const phaseCounts = new Map(); // team -> {phase: count of unique gamecodes}
    const allPhases = new Set();
    const seen = new Set();
    for (const r of boxPost) {
      const key = r.Team + '\u0000' + r.Gamecode;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!phaseCounts.has(r.Team)) phaseCounts.set(r.Team, {});
      const pc = phaseCounts.get(r.Team);
      pc[r.Phase] = (pc[r.Phase] || 0) + 1;
      allPhases.add(r.Phase);
    }
    // pandas' unstack(fill_value=0) zero-fills every phase seen anywhere in the
    // postseason data for every team, not just the phases that team played in.
    teamPlayoffs = teamPostTrad.map(t => {
      const { Team, ...rest } = t;
      const pc = phaseCounts.get(Team) || {};
      const filled = {};
      for (const ph of [...allPhases].sort()) filled[ph] = pc[ph] || 0;
      return { team_code: Team, team_name: nameByCode.get(Team) || null, ...rest, phase_games: filled };
    });
  }

  // ---------- TEAM GAME LOG (all phases) ----------
  const teamGames = [];
  for (const row of grSorted) {
    if (!row.played) continue;
    const base = { gamecode: row.Gamecode, round: row.Round, round_name: row.roundName, phase: row.Phase, date: row.date };
    teamGames.push({ ...base, team: row['local.club.code'], team_name: row['local.club.name'],
      opponent: row['road.club.code'], opponent_name: row['road.club.name'],
      home: true, team_score: row['local.score'], opp_score: row['road.score'],
      win: row['local.score'] > row['road.score'], form: parseForm(row.localLast5Form) });
    teamGames.push({ ...base, team: row['road.club.code'], team_name: row['road.club.name'],
      opponent: row['local.club.code'], opponent_name: row['local.club.name'],
      home: false, team_score: row['road.score'], opp_score: row['local.score'],
      win: row['road.score'] > row['local.score'], form: parseForm(row.roadLast5Form) });
  }

  // ---------- PLAYER SEASON AGGREGATES (Regular Season) ----------
  const playedRs = boxRs.filter(r => r.Played);
  const maxRound = boxRs.length ? Math.max(...boxRs.map(r => r.Round || 0)) : 34;
  const qualifierGames = Math.max(8, Math.floor(maxRound * 0.4));
  const playerAgg = buildPlayerAgg(playedRs, qualifierGames);

  // ---------- PLAYER PLAYOFFS/PLAY-IN/FINAL FOUR AGGREGATES ----------
  const playedPost = boxPost.filter(r => r.Played);
  const playerPostAgg = buildPlayerAgg(playedPost, null);

  // ---------- PLAYER GAME LOG (trimmed columns, sorted); ALL phases ----------
  const playedAll = boxDf.filter(r => r.Played);
  const logCols = ["Player_ID","Player","Team","Phase","Round","Gamecode","Home","IsStarter","MinutesFloat",
    "Points","FieldGoalsMade2","FieldGoalsAttempted2","FieldGoalsMade3","FieldGoalsAttempted3",
    "FreeThrowsMade","FreeThrowsAttempted","OffensiveRebounds","DefensiveRebounds","TotalRebounds",
    "Assistances","Steals","Turnovers","BlocksFavour","BlocksAgainst","FoulsCommited","Valuation","Plusminus"];
  const playerGameLog = playedAll
    .slice()
    .sort((a, b) => (a.Player_ID < b.Player_ID ? -1 : a.Player_ID > b.Player_ID ? 1 : a.Gamecode - b.Gamecode))
    .map(r => { const o = {}; for (const c of logCols) o[c === 'MinutesFloat' ? 'Minutes' : c] = r[c]; return o; });

  // ---------- ROSTERS (all phases) ----------
  const rosters = {};
  const byTeamAll = groupBy(playedAll, r => r.Team);
  for (const [team, rows] of byTeamAll) {
    const byPlayer = groupBy(rows, r => r.Player_ID);
    const list = [];
    for (const [pid, prows] of byPlayer) {
      const last = prows[prows.length - 1];
      list.push({ Player_ID: pid, Player: last.Player, Dorsal: last.Dorsal });
    }
    list.sort((a, b) => (a.Player < b.Player ? -1 : a.Player > b.Player ? 1 : 0));
    rosters[team] = list;
  }

  // ---------- FOULS SUMMARY PER TEAM (Regular Season) ----------
  let foulsTeamSummary = [];
  if (fouls.length) {
    const foulsRs = fouls.filter(r => gamecodePhase.get(r.GAMECODE) === 'RS');
    const byTeamF = groupBy(foulsRs, r => r.TEAM);
    const fpgByTeamGame = groupBy(foulsRs, r => r.TEAM + '\u0000' + r.GAMECODE);
    const fpgSumByTeamGame = new Map();
    for (const [key, rows] of fpgByTeamGame) fpgSumByTeamGame.set(key, sum(rows, 'Total_Fouls'));
    for (const [team, rows] of byTeamF) {
      const games = new Set(rows.map(r => r.GAMECODE));
      const perGameTotals = [...games].map(g => fpgSumByTeamGame.get(team + '\u0000' + g) || 0);
      const foulsPerGame = perGameTotals.length ? perGameTotals.reduce((a, b) => a + b, 0) / perGameTotals.length : 0;
      foulsTeamSummary.push({
        TEAM: team, games: games.size,
        fouls_to_FT_rate: mean(rows, 'Fouls_Lead_To_Free_Throws'),
        fouls_per_game: foulsPerGame,
      });
    }
  }

  // ---------- LEAGUE AVERAGES (Regular Season) ----------
  const qualifiedPlayers = playerAgg.filter(p => p.qualified);
  const leagueAverages = {
    PPG: mean(teamTrad, 'PPG'), FG_PCT: mean(teamTrad, 'FG_PCT'),
    FG3_PCT: mean(teamTrad, 'FG3_PCT'), FT_PCT: mean(teamTrad, 'FT_PCT'),
    TRB: mean(teamTrad, 'TRB'), AST: mean(teamTrad, 'AST'),
    STL: mean(teamTrad, 'STL'), TOV: mean(teamTrad, 'TOV'),
    PACE: teamsAdv.length ? mean(teamsAdv, 'PACE') : null,
    ORtg: teamsAdv.length ? mean(teamsAdv, 'ORtg') : null,
    player_PTS: mean(qualifiedPlayers, 'PTS'), player_TRB: mean(qualifiedPlayers, 'TRB'),
    player_AST: mean(qualifiedPlayers, 'AST'), player_TS_PCT: mean(qualifiedPlayers, 'TS_PCT'),
  };

  return {
    team_season: teamSeason,
    team_playoffs: teamPlayoffs,
    team_games: teamGames,
    player_season: { qualifier_games: qualifierGames, players: playerAgg },
    player_playoffs: playerPostAgg,
    player_game_log: playerGameLog,
    rosters,
    fouls_team_summary: foulsTeamSummary,
    players_msi_season: msi,
    shot_zones: shotZones,
    league_averages: leagueAverages,
    schedule,
  };
}

module.exports = { runEtl, mmssToMinutes, safeDiv, parseForm, buildTeamTrad, buildPlayerAgg };
