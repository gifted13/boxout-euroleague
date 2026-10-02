#!/usr/bin/env node
// Validates lib/etl.js's JS port against the known-good site/data/{season}/*.json
// output (produced by build_processed.py from the same raw cache). Run with:
//   node scripts/validate_etl.js 2025
'use strict';
const fs = require('fs');
const path = require('path');
const { runEtl } = require('../site/netlify/functions/lib/etl.js');

const season = process.argv[2] || '2025';
const RAW = path.join(__dirname, '..', 'data', 'raw', season);
const KNOWN = path.join(__dirname, '..', 'site', 'data', season);

function loadRaw(name) {
  const p = path.join(RAW, `${name}.json`);
  if (!fs.existsSync(p)) { console.warn(`  (missing raw ${name}.json)`); return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function loadKnown(name) {
  const p = path.join(KNOWN, `${name}.json`);
  if (!fs.existsSync(p)) { console.warn(`  (missing known-good ${name}.json)`); return null; }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const raw = {
  standings: loadRaw('standings'),
  teams_advanced_stats: loadRaw('teams_advanced_stats'),
  teams_efficiency_landscape: loadRaw('teams_efficiency_landscape'),
  teams_buzzer_beaters: loadRaw('teams_buzzer_beaters'),
  shot_zones: loadRaw('shot_zones'),
  schedule: loadRaw('schedule'),
  games_report_season: loadRaw('games_report_season'),
  boxscore_players_season: loadRaw('boxscore_players_season'),
  fouls_analysis_season: loadRaw('fouls_analysis_season'),
  players_msi_season: loadRaw('players_msi_season'),
};

console.log(`\n=== Running JS ETL port for season ${season} ===`);
const t0 = Date.now();
const out = runEtl(raw);
console.log(`ETL ran in ${Date.now() - t0}ms\n`);

let failures = 0, warnings = 0;
function numEq(a, b, tol = 1e-6) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b;
}
function deepEq(a, b, tol) {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEq(v, b[i], tol));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!deepEq(a[k], b[k], tol)) return false;
    return true;
  }
  if (typeof a === 'number' || typeof b === 'number') return numEq(a, b, tol);
  return a === b;
}

function compareKeyedArrays(label, got, want, keyField, ignoreFields = []) {
  if (!want) { console.log(`SKIP ${label}: no known-good file`); return; }
  const gotMap = new Map(got.map(r => [r[keyField], r]));
  const wantMap = new Map(want.map(r => [r[keyField], r]));
  if (gotMap.size !== wantMap.size) {
    console.log(`FAIL ${label}: count mismatch got=${gotMap.size} want=${wantMap.size}`);
    failures++;
  }
  let rowFails = 0;
  for (const [key, wantRow] of wantMap) {
    const gotRow = gotMap.get(key);
    if (!gotRow) { console.log(`  FAIL ${label}[${key}]: missing in got`); rowFails++; continue; }
    for (const field of Object.keys(wantRow)) {
      if (ignoreFields.includes(field)) continue;
      if (!deepEq(gotRow[field], wantRow[field])) {
        console.log(`  FAIL ${label}[${key}].${field}: got=${JSON.stringify(gotRow[field])} want=${JSON.stringify(wantRow[field])}`);
        rowFails++;
        if (rowFails > 15) { console.log(`  ...(${label} truncating further row diffs)`); break; }
      }
    }
    if (rowFails > 15) break;
  }
  if (rowFails) failures++;
  else console.log(`OK   ${label}: ${gotMap.size} rows match (tol 1e-6)`);
}

// team_season
compareKeyedArrays('team_season', out.team_season, loadKnown('team_season'), 'team_code');

// team_playoffs
const teamPlayoffsKnown = loadKnown('team_playoffs');
compareKeyedArrays('team_playoffs', out.team_playoffs, teamPlayoffsKnown, 'team_code');

// team_games — no stable single key; compare as (team, gamecode) keyed
{
  const want = loadKnown('team_games');
  if (want) {
    const keyFn = r => `${r.team}\u0000${r.gamecode}`;
    const gotMap = new Map(out.team_games.map(r => [keyFn(r), r]));
    const wantMap = new Map(want.map(r => [keyFn(r), r]));
    let fails = gotMap.size !== wantMap.size ? 1 : 0;
    if (fails) console.log(`FAIL team_games: count mismatch got=${gotMap.size} want=${wantMap.size}`);
    let rowFails = 0;
    for (const [k, w] of wantMap) {
      const g = gotMap.get(k);
      if (!g) { rowFails++; console.log(`  FAIL team_games[${k}]: missing`); continue; }
      if (!deepEq(g, w)) { rowFails++; console.log(`  FAIL team_games[${k}]: ${JSON.stringify(g)} vs ${JSON.stringify(w)}`); }
      if (rowFails > 10) break;
    }
    if (fails || rowFails) failures++;
    else console.log(`OK   team_games: ${gotMap.size} rows match`);
  }
}

// player_season
{
  const want = loadKnown('player_season');
  if (want) {
    if (want.qualifier_games !== out.player_season.qualifier_games) {
      console.log(`FAIL player_season.qualifier_games: got=${out.player_season.qualifier_games} want=${want.qualifier_games}`);
      failures++;
    } else console.log(`OK   player_season.qualifier_games: ${want.qualifier_games}`);
    compareKeyedArrays('player_season.players', out.player_season.players, want.players, 'Player_ID');
  }
}

// player_playoffs
compareKeyedArrays('player_playoffs', out.player_playoffs, loadKnown('player_playoffs'), 'Player_ID');

// player_game_log — spot check count + a sample of rows (8700+ rows, full compare)
{
  const want = loadKnown('player_game_log');
  if (want) {
    if (out.player_game_log.length !== want.length) {
      console.log(`FAIL player_game_log: count got=${out.player_game_log.length} want=${want.length}`);
      failures++;
    } else {
      let rowFails = 0;
      for (let i = 0; i < want.length; i++) {
        if (!deepEq(out.player_game_log[i], want[i])) {
          rowFails++;
          if (rowFails <= 5) console.log(`  FAIL player_game_log[${i}]: ${JSON.stringify(out.player_game_log[i])} vs ${JSON.stringify(want[i])}`);
        }
      }
      if (rowFails) { console.log(`FAIL player_game_log: ${rowFails}/${want.length} rows differ`); failures++; }
      else console.log(`OK   player_game_log: all ${want.length} rows match`);
    }
  }
}

// rosters
{
  const want = loadKnown('rosters');
  if (want) {
    const teams = new Set([...Object.keys(out.rosters), ...Object.keys(want)]);
    let fails = 0;
    for (const team of teams) {
      const g = (out.rosters[team] || []).slice().sort((a, b) => a.Player_ID.localeCompare(b.Player_ID));
      const w = (want[team] || []).slice().sort((a, b) => a.Player_ID.localeCompare(b.Player_ID));
      if (!deepEq(g, w)) { fails++; console.log(`  FAIL rosters[${team}]: mismatch`); }
    }
    if (fails) failures++; else console.log(`OK   rosters: ${teams.size} teams match`);
  }
}

// fouls_team_summary
compareKeyedArrays('fouls_team_summary', out.fouls_team_summary, loadKnown('fouls_team_summary'), 'TEAM');

// league_averages
{
  const want = loadKnown('league_averages');
  if (want) {
    if (deepEq(out.league_averages, want)) console.log('OK   league_averages: matches');
    else { console.log('FAIL league_averages:', JSON.stringify(out.league_averages), 'vs', JSON.stringify(want)); failures++; }
  }
}

console.log(`\n=== ${failures === 0 ? 'ALL PASS' : failures + ' SECTION(S) FAILED'} ===\n`);
process.exit(failures === 0 ? 0 : 1);
