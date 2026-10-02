#!/usr/bin/env node
// One-off runner: builds site/data/2026/*.json from data/raw/2026/*.json using
// the validated JS ETL port (site/netlify/functions/lib/etl.js). Mirrors the
// per-file layout build_processed.py / the earlier manual 2026 build already
// established (see the files already in site/data/2026/).
'use strict';
const fs = require('fs');
const path = require('path');
const { runEtl } = require('../site/netlify/functions/lib/etl.js');

const RAW = path.join(__dirname, '..', 'data', 'raw', '2026');
const OUT = path.join(__dirname, '..', 'site', 'data', '2026');

function loadRaw(name) {
  const p = path.join(RAW, `${name}.json`);
  if (!fs.existsSync(p)) { console.warn(`  (missing raw ${name}.json)`); return null; }
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

console.log('=== Running JS ETL port for season 2026 ===');
const out = runEtl(raw);

const files = {
  'team_season.json': out.team_season,
  'team_playoffs.json': out.team_playoffs,
  'team_games.json': out.team_games,
  'player_season.json': out.player_season,
  'player_playoffs.json': out.player_playoffs,
  'player_game_log.json': out.player_game_log,
  'rosters.json': out.rosters,
  'fouls_team_summary.json': out.fouls_team_summary,
  'players_msi_season.json': out.players_msi_season,
  'shot_zones.json': out.shot_zones,
  'league_averages.json': out.league_averages,
  'schedule.json': out.schedule,
};

for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data));
  const n = Array.isArray(data) ? data.length : (data && data.players ? data.players.length : Object.keys(data || {}).length);
  console.log(`wrote ${name} (${n})`);
}

console.log(`\nteam_season teams: ${out.team_season.length}`);
console.log(`player_season qualifier_games: ${out.player_season.qualifier_games}, players: ${out.player_season.players.length}`);
console.log(`team_games rows: ${out.team_games.length}`);
console.log(`player_game_log rows: ${out.player_game_log.length}`);
const maxRound = Math.max(...out.team_games.filter(g => g.phase === 'RS').map(g => g.round), 0);
console.log(`max RS round in team_games: ${maxRound}`);
