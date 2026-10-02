// ============================================================================
// Players: list + full player profile (Overview / Game Log / Trends /
// Shooting / Splits / Comparisons / Historical / Insights)
// ============================================================================

import { loadSeason, SEASONS, SEASON_LABELS, percentile, mean, qualifiedPool } from '../data.js';
import { hotStreakPlayers } from '../insights.js';
import {
  h, card, sectionHead, statTile, badge, dataTable, tabs, favStar,
  infoIcon, skeletonCard, emptyState, avatarInitial, entityHero, chartLegend,
} from '../components.js';
import { lineChart, radarChart, pctBar, statRing } from '../charts.js';
import { fmtNum, fmtPct, fmtSigned, fmtInt, fmtStat, statLabel, titleCase, STAT_META, initials, hashColor } from '../format.js';
import { state, isFavoritePlayer, toggleFavoritePlayer } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

// ---------------------------------------------------------------------------
// Players list
// ---------------------------------------------------------------------------
export async function renderPlayersList(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('players.loadError'))); return; }
  const players = season.player_season.players;

  let query = '';
  // Defaults OFF: qualifier_games is max(8, 40% of rounds played), so early
  // in a season (e.g. Round 1) it's pinned at 8 while everyone has GP=1 —
  // an "on" default would show an empty table until ~Round 20. The chip
  // still lets anyone flip it on once there's enough of a season to make
  // "qualified" leaderboards meaningful.
  let qualifiedOnly = false;
  wrap.appendChild(h('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap' }, [
    h('div', {}, [h('div', { class: 'eyebrow' }, tt('players.allPlayers')), h('h1', { style: 'font-size:24px;margin-top:4px' }, `${SEASON_LABELS[state.season]} ${tt('nav.players')}`)]),
    h('input', {
      placeholder: tt('players.searchPlaceholder'), style: 'margin-left:auto;padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font-size:13px;min-width:220px',
      oninput: (e) => { query = e.target.value; renderTable(); },
    }),
  ]));
  const chipRow = h('div', { class: 'chip-row', style: 'margin-bottom:16px' }, [
    h('span', { class: 'chip accent' + (qualifiedOnly ? ' active' : ''), onclick: (e) => { qualifiedOnly = !qualifiedOnly; e.target.classList.toggle('active'); renderTable(); } }, tt('players.qualifiedOnly', { n: season.player_season.qualifier_games })),
  ]);
  wrap.appendChild(chipRow);
  const tableSlot = h('div');
  wrap.appendChild(tableSlot);

  function renderTable() {
    tableSlot.innerHTML = '';
    let rows = players.filter(p => p.Player.toLowerCase().includes(query.toLowerCase()) || p.Team.toLowerCase().includes(query.toLowerCase()));
    if (qualifiedOnly) rows = rows.filter(p => p.qualified);
    tableSlot.appendChild(dataTable(rows, [
      { key: 'Player', label: tt('common.player'), align: 'left', primary: true, render: p => h('span', { style: 'display:flex;align-items:center;gap:8px' }, [avatarInitial(p.Player, 24), titleCase(p.Player)]) },
      { key: 'Team', label: tt('common.team') },
      { key: 'GP', label: 'GP', statKey: 'GP' },
      { key: 'MIN', label: 'MIN', statKey: 'MIN', render: p => fmtNum(p.MIN) },
      { key: 'PTS', label: 'PTS', statKey: 'PTS', render: p => fmtNum(p.PTS) },
      { key: 'TRB', label: 'REB', statKey: 'TRB', render: p => fmtNum(p.TRB) },
      { key: 'AST', label: 'AST', statKey: 'AST', render: p => fmtNum(p.AST) },
      { key: 'TS_PCT', label: 'TS%', statKey: 'TS_PCT', render: p => fmtPct(p.TS_PCT) },
      { key: 'VAL', label: 'PIR', statKey: 'VAL', render: p => fmtNum(p.VAL) },
      { key: 'fav', label: '', sortable: false, render: p => favStar(isFavoritePlayer(p.Player_ID), (elm) => { const on = toggleFavoritePlayer(p.Player_ID); elm.className = 'fav-star' + (on ? ' on' : ''); elm.innerHTML = on ? '★' : '☆'; }) },
    ], { onRowClick: (p) => navigate(`/player/${p.Player_ID}`), initialSort: { key: 'PTS', dir: 'desc' }, scrollMax: 640 }));
  }
  renderTable();
}

// ---------------------------------------------------------------------------
// Player profile
// ---------------------------------------------------------------------------
function TABS() {
  return [
    { key: 'overview', label: tt('teams.tabOverview') }, { key: 'gamelog', label: tt('players.tabGameLog') },
    { key: 'trends', label: tt('teams.tabTrends') }, { key: 'shooting', label: tt('players.tabShooting') },
    { key: 'splits', label: tt('teams.tabSplits') }, { key: 'comparisons', label: tt('teams.tabComparisons') },
    { key: 'historical', label: tt('teams.tabHistorical') }, { key: 'insights', label: tt('teams.tabInsights') },
  ];
}

export async function renderPlayerProfile(root, id, setCrumb) {
  root.innerHTML = '';
  setCrumb(tt('nav.players'));
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = await loadSeason(state.season).catch(() => null);
  if (!season) { wrap.innerHTML = ''; wrap.appendChild(emptyState(tt('players.loadErrorProfile'))); return; }
  const player = season.player_season.players.find(p => p.Player_ID === id);
  wrap.innerHTML = '';
  if (!player) { wrap.appendChild(emptyState(tt('players.notFound', { id, season: SEASON_LABELS[state.season] }))); return; }
  const teamRow = season.team_season.find(t => t.team_code === player.Team);
  setCrumb(`${tt('nav.players')} / ${titleCase(player.Player)}`);
  setAIContext(`Player Profile: ${titleCase(player.Player)} (${player.Team})`, { player, team: teamRow, league_averages: season.league_averages });

  const star = favStar(isFavoritePlayer(id), (elm) => { const on = toggleFavoritePlayer(id); elm.className = 'fav-star' + (on ? ' on' : ''); elm.innerHTML = on ? '★' : '☆'; });
  star.style.cssText = 'font-size:22px;color:#fff;opacity:.9';
  const qualBadgeText = player.qualified ? tt('players.qualified') : tt('players.belowThreshold', { gp: player.GP, n: season.player_season.qualifier_games });
  wrap.appendChild(h('div', { style: 'margin-bottom:20px' }, [
    entityHero({
      crestText: initials(player.Player),
      crestColor: hashColor(player.Player),
      name: h('span', { style: 'display:flex;align-items:center;gap:12px' }, [titleCase(player.Player), star]),
      meta: h('span', { style: 'display:flex;align-items:center;gap:6px;cursor:pointer' }, [
        h('span', { onclick: () => navigate(`/team/${player.Team}`), style: 'text-decoration:underline;text-decoration-color:rgba(255,255,255,.5)' }, teamRow ? teamRow.team_name : player.Team),
        `· #${player.Dorsal ?? '—'} · ${SEASON_LABELS[state.season]}`,
      ]),
      // A small team-crest badge in the corner — the data-driven stand-in
      // for the real team logo that sits beside a player's photo on the
      // official site.
      corner: { logo: player.Team, text: player.Team, color: hashColor(player.Team) },
      side: [
        h('span', { style: `background:rgba(255,255,255,.22);color:#fff;font-family:var(--font-data);font-weight:700;font-size:11.5px;padding:5px 11px;border-radius:var(--radius-sm)` }, qualBadgeText),
      ],
    }),
  ]));

  const tabSlot = h('div');
  const tabBar = h('div', { style: 'margin-bottom:20px' }, [tabs(TABS(), 'overview', (key) => renderTab(key))]);
  wrap.appendChild(tabBar);
  wrap.appendChild(tabSlot);

  function renderTab(key) {
    tabBar.innerHTML = ''; tabBar.appendChild(tabs(TABS(), key, renderTab));
    tabSlot.innerHTML = '';
    const renderers = { overview: tabOverview, gamelog: tabGameLog, trends: tabTrends, shooting: tabShooting, splits: tabSplits, comparisons: tabComparisons, historical: tabHistorical, insights: tabInsights };
    tabSlot.appendChild(renderers[key](player, season));
  }
  renderTab('overview');
}

function statPercentileRow(statKey, row, pool) {
  const meta = STAT_META[statKey] || {};
  const lib = meta.hib === false;
  const pct = percentile(pool, statKey, row[statKey], lib);
  return h('div', { style: 'display:flex;align-items:center;gap:12px;padding:7px 0' }, [
    h('div', { style: 'width:150px;font-size:12px;color:var(--ink-secondary);display:flex;align-items:center;gap:5px;flex:none' }, [statLabel(statKey), infoIcon(statKey)]),
    h('div', { style: 'flex:1' }, pctBar(pct ?? 50, { color: pct >= 66 ? 'var(--good)' : pct <= 33 ? 'var(--critical)' : 'var(--series-1)' })),
    h('div', { style: 'width:64px;text-align:right;font-family:var(--font-data);font-weight:700;font-size:12.5px' }, fmtStat(statKey, row[statKey])),
    h('div', { style: 'width:38px;text-align:right;font-size:10.5px;color:var(--ink-muted)' }, pct != null ? `P${pct}` : '—'),
  ]);
}

function tabOverview(player, season) {
  const wrap = h('div');
  // Percentile pool: the qualified subset, but falling back to every player
  // who's appeared this season when nobody's qualified yet (early season) —
  // so these rings still show something real instead of going blank until
  // ~Round 20.
  const pool = qualifiedPool(season.player_season.players);
  const ringStat = (key, label) => {
    const pct = pool.length > 1 ? percentile(pool, key, player[key], STAT_META[key]?.hib === false) : null;
    return statRing({ value: fmtNum(player[key]), label, pct, color: pct != null && pct >= 66 ? 'var(--good)' : pct != null && pct <= 33 ? 'var(--critical)' : 'var(--accent-2)' });
  };
  const ringRow = h('div', { class: 'card', style: 'display:flex;justify-content:space-around;flex-wrap:wrap;gap:20px;padding:var(--sp-6) var(--sp-5)' }, [
    ringStat('PTS', statLabel('PTS')), ringStat('TRB', statLabel('TRB')), ringStat('AST', statLabel('AST')), ringStat('VAL', tt('players.valuation')),
  ]);
  wrap.appendChild(ringRow);
  wrap.appendChild(h('p', { style: 'font-size:11px;color:var(--ink-muted);text-align:center;margin-top:8px' },
    pool.length > 1 ? tt('players.arcFillNote', { n: pool.length }) : tt('players.notEnoughGames', { n: season.player_season.qualifier_games })));
  wrap.appendChild(sectionHead(tt('players.percentileHead'), { count: tt('players.playersCount', { n: pool.length }) }));
  wrap.appendChild(card(['PTS', 'TRB', 'AST', 'STL', 'BLK', 'TS_PCT', 'TOV'].map(s => statPercentileRow(s, player, pool))));
  return wrap;
}

function playerGames(player, season) {
  return season.player_game_log.filter(r => r.Player_ID === player.Player_ID);
}

function tabGameLog(player, season) {
  const wrap = h('div');
  let phaseFilter = 'RS';
  const chipRow = h('div', { class: 'chip-row', style: 'margin-bottom:14px' });
  ['RS', 'PI', 'PO', 'FF', 'ALL'].forEach(ph => chipRow.appendChild(h('span', { class: 'chip' + (phaseFilter === ph ? ' active' : ''), onclick: () => { phaseFilter = ph; update(); } }, ph === 'ALL' ? tt('common.allPhases') : ph)));
  wrap.appendChild(chipRow);
  const tableSlot = h('div');
  wrap.appendChild(tableSlot);
  const oppLookup = new Map();
  season.team_games.forEach(g => oppLookup.set(`${g.team}_${g.gamecode}`, g));
  function update() {
    [...chipRow.children].forEach((c, i) => c.className = 'chip' + (['RS', 'PI', 'PO', 'FF', 'ALL'][i] === phaseFilter ? ' active' : ''));
    const games = playerGames(player, season).filter(r => phaseFilter === 'ALL' || r.Phase === phaseFilter).sort((a, b) => b.Gamecode - a.Gamecode);
    tableSlot.innerHTML = '';
    tableSlot.appendChild(dataTable(games, [
      { key: 'Round', label: tt('players.rd'), render: r => r.Round },
      { key: 'opp', label: tt('players.opponent'), align: 'left', sortable: false, render: r => { const g = oppLookup.get(`${r.Team}_${r.Gamecode}`); return g ? `${g.home ? tt('common.vs') : tt('common.at')} ${g.opponent}` : '—'; } },
      { key: 'Minutes', label: 'MIN', render: r => fmtNum(r.Minutes) },
      { key: 'Points', label: 'PTS' },
      { key: 'TotalRebounds', label: 'REB' },
      { key: 'Assistances', label: 'AST' },
      { key: 'Valuation', label: 'PIR' },
    ], { initialSort: { key: 'Round', dir: 'desc' }, scrollMax: 520 }));
  }
  update();
  return wrap;
}

function tabTrends(player, season) {
  const wrap = h('div');
  const games = playerGames(player, season).filter(r => r.Phase === 'RS').sort((a, b) => a.Round - b.Round);
  if (games.length < 2) return emptyState(tt('players.notEnoughForTrend'));
  const roll = games.map((g, i) => {
    const slice = games.slice(Math.max(0, i - 4), i + 1);
    return { x: g.Round, pts: mean(slice.map(s => s.Points)), val: mean(slice.map(s => s.Valuation)) };
  });
  wrap.appendChild(card([lineChart([
    { name: tt('players.pointsRolling'), color: 'var(--series-1)', points: roll.map(p => ({ x: p.x, y: p.pts })) },
  ], { yFmt: v => fmtNum(v, 1), xFmt: v => tt('common.round', { n: v }), height: 200 })], { title: tt('players.scoringTrend'), sub: tt('players.rolling5') }));
  wrap.appendChild(card([lineChart([
    { name: tt('players.pirRolling'), color: 'var(--accent)', points: roll.map(p => ({ x: p.x, y: p.val })) },
  ], { yFmt: v => fmtNum(v, 1), xFmt: v => tt('common.round', { n: v }), height: 200 })], { title: tt('players.impactTrend'), sub: tt('players.rolling5') }));
  return wrap;
}

function tabShooting(player, season) {
  const wrap = h('div');
  wrap.appendChild(h('div', { class: 'grid grid-3' }, [
    statTile({ label: statLabel('FG2_PCT'), statKey: 'FG2_PCT', value: fmtPct(player.FG2_PCT), foot: tt('players.perGame', { made: fmtNum(player.FGM2), att: fmtNum(player.FGA2) }) }),
    statTile({ label: statLabel('FG3_PCT'), statKey: 'FG3_PCT', value: fmtPct(player.FG3_PCT), foot: tt('players.perGame', { made: fmtNum(player.FGM3), att: fmtNum(player.FGA3) }) }),
    statTile({ label: statLabel('FT_PCT'), statKey: 'FT_PCT', value: fmtPct(player.FT_PCT), foot: tt('players.perGame', { made: fmtNum(player.FTM), att: fmtNum(player.FTA) }) }),
    statTile({ label: statLabel('TS_PCT'), statKey: 'TS_PCT', value: fmtPct(player.TS_PCT) }),
    statTile({ label: statLabel('EFG_PCT'), statKey: 'EFG_PCT', value: fmtPct(player.EFG_PCT) }),
    statTile({ label: statLabel('FG_PCT'), statKey: 'FG_PCT', value: fmtPct(player.FG_PCT) }),
  ]));
  wrap.appendChild(sectionHead(tt('players.per36Head')));
  wrap.appendChild(card([
    h('div', { style: 'display:flex;flex-direction:column' }, ['PTS_PER36', 'TRB_PER36', 'AST_PER36', 'STL_PER36', 'BLK_PER36', 'TOV_PER36'].map(s => statPercentileRow(s, player, qualifiedPool(season.player_season.players)))),
  ]));
  const zones = season.shot_zones || {};
  const mentions = [];
  ['leading_scorers', 'leading_attempts', 'leading_fg_pct'].forEach(listKey => {
    (zones[listKey] || []).forEach(z => { if (z.PLAYER === player.Player) mentions.push({ listKey, ...z }); });
  });
  if (mentions.length) {
    wrap.appendChild(sectionHead(tt('players.shotZoneLeaderboards')));
    wrap.appendChild(card([
      h('div', { style: 'display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--ink-secondary)' }, mentions.map(m =>
        h('div', {}, tt('players.leadsZone', {
          zone: m.ZONE,
          metric: m.listKey === 'leading_scorers' ? tt('players.totalPoints') : m.listKey === 'leading_attempts' ? tt('players.attempts') : 'FG%',
          detail: m.listKey === 'leading_fg_pct' ? fmtPct(m.FGPCT) : m.listKey === 'leading_scorers' ? m.POINTS + ' ' + tt('players.pts') : m.FGT + ' ' + tt('players.att'),
        }))
      )),
    ], { title: tt('players.shotZoneRecognition'), sub: tt('players.shotZoneSub') }));
  }
  return wrap;
}

function tabSplits(player, season) {
  const games = playerGames(player, season).filter(r => r.Phase === 'RS');
  const home = games.filter(g => g.Home);
  const away = games.filter(g => !g.Home);
  const avg = (arr, key) => arr.length ? mean(arr.map(g => g[key])) : null;
  const wrap = h('div', { class: 'grid grid-2' });
  wrap.appendChild(card([
    h('div', { class: 'grid grid-3' }, [
      statTile({ label: statLabel('PTS'), value: fmtNum(avg(home, 'Points')) }),
      statTile({ label: statLabel('TRB'), value: fmtNum(avg(home, 'TotalRebounds')) }),
      statTile({ label: statLabel('AST'), value: fmtNum(avg(home, 'Assistances')) }),
    ]),
  ], { title: tt('teams.home'), sub: tt('players.gamesCount', { n: home.length }) }));
  wrap.appendChild(card([
    h('div', { class: 'grid grid-3' }, [
      statTile({ label: statLabel('PTS'), value: fmtNum(avg(away, 'Points')) }),
      statTile({ label: statLabel('TRB'), value: fmtNum(avg(away, 'TotalRebounds')) }),
      statTile({ label: statLabel('AST'), value: fmtNum(avg(away, 'Assistances')) }),
    ]),
  ], { title: tt('players.away'), sub: tt('players.gamesCount', { n: away.length }) }));
  return wrap;
}

function tabComparisons(player, season) {
  const wrap = h('div');
  const pool = qualifiedPool(season.player_season.players);
  const axes = [
    { key: 'PTS', label: 'PTS', max: Math.max(...pool.map(p => p.PTS)) },
    { key: 'TRB', label: 'REB', max: Math.max(...pool.map(p => p.TRB)) },
    { key: 'AST', label: 'AST', max: Math.max(...pool.map(p => p.AST)) },
    { key: 'STL', label: 'STL', max: Math.max(...pool.map(p => p.STL)) },
    { key: 'BLK', label: 'BLK', max: Math.max(...pool.map(p => p.BLK)) },
    { key: 'TS_PCT', label: 'TS%', max: Math.max(...pool.map(p => p.TS_PCT)) },
  ];
  const leagueAvgEntity = { name: tt('players.leagueAvgQualified'), color: 'var(--chart-muted)', values: Object.fromEntries(axes.map(a => [a.key, mean(pool.map(p => p[a.key]))])) };
  const playerEntity = { name: titleCase(player.Player), color: 'var(--accent)', values: Object.fromEntries(axes.map(a => [a.key, player[a.key]])) };
  wrap.appendChild(card([
    radarChart(axes, [leagueAvgEntity, playerEntity], { size: 340 }),
    chartLegend([{ label: leagueAvgEntity.name, color: leagueAvgEntity.color }, { label: playerEntity.name, color: playerEntity.color }]),
  ], { title: tt('players.vsLeagueAvg', { player: titleCase(player.Player) }), sub: tt('players.qualifiedOnlySub') }));
  wrap.appendChild(card([
    h('p', { style: 'font-size:13px;color:var(--ink-secondary)' }, tt('players.compareCta')),
    h('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:10px', onclick: () => navigate(`/compare?type=player&a=${player.Player_ID}`) }, tt('teams.openInCompare')),
  ]));
  return wrap;
}

function tabHistorical(player, season) {
  const wrap = h('div');
  const otherSeason = SEASONS.find(s => s !== state.season);
  const box = h('div');
  wrap.appendChild(box);
  box.appendChild(skeletonCard());
  loadSeason(otherSeason).then(other => {
    box.innerHTML = '';
    const prior = other.player_season.players.find(p => p.Player_ID === player.Player_ID);
    if (!prior) {
      box.appendChild(card([h('p', { style: 'font-size:13px;color:var(--ink-secondary)' }, tt('players.noPriorRecord', { season: SEASON_LABELS[otherSeason] }))], { title: tt('teams.vsSeason', { season: SEASON_LABELS[otherSeason] }) }));
      return;
    }
    const rows = [
      ['GP', player.GP, prior.GP], ['MIN', fmtNum(player.MIN), fmtNum(prior.MIN)],
      ['PTS', fmtNum(player.PTS), fmtNum(prior.PTS)], ['REB', fmtNum(player.TRB), fmtNum(prior.TRB)],
      ['AST', fmtNum(player.AST), fmtNum(prior.AST)], ['TS%', fmtPct(player.TS_PCT), fmtPct(prior.TS_PCT)],
      ['PIR', fmtNum(player.VAL), fmtNum(prior.VAL)],
    ];
    box.appendChild(card([
      h('div', { class: 'table-wrap' }, [h('table', { class: 'dtable' }, [
        h('thead', {}, [h('tr', {}, [h('th', { style: 'text-align:left' }, tt('common.metric')), h('th', {}, SEASON_LABELS[state.season]), h('th', {}, SEASON_LABELS[otherSeason])])]),
        h('tbody', {}, rows.map(r => h('tr', {}, [h('td', { style: 'text-align:left' }, r[0]), h('td', {}, r[1]), h('td', {}, r[2])]))),
      ])]),
    ], { title: tt('teams.seasonOverSeason', { a: SEASON_LABELS[state.season], b: SEASON_LABELS[otherSeason] }) }));
  });
  return wrap;
}

function tabInsights(player, season) {
  const wrap = h('div', { class: 'grid grid-2' });
  const hot = hotStreakPlayers(season.player_game_log, season.player_season.players, 'PTS', { limit: 200, minGames: 1 });
  const mine = hot.find(h2 => h2.player.Player_ID === player.Player_ID);
  if (mine && Math.abs(mine.diff) >= 2) {
    wrap.appendChild(h('div', { class: 'insight-card' }, [
      h('div', { class: 'kicker' }, badge(mine.diff > 0 ? tt('cc.onAHeater') : tt('players.coolingOff'), mine.diff > 0 ? 'good' : 'warning')),
      h('h4', {}, tt('players.avgPpgLast5', { avg: fmtNum(mine.recentAvg) })),
      h('div', { class: 'body-text' }, tt('players.vsSeasonAvg', { diff: fmtSigned(mine.diff), avg: fmtNum(mine.seasonAvg) })),
    ]));
  }
  const pool = qualifiedPool(season.player_season.players);
  ['TS_PCT', 'VAL', 'AST'].forEach(key => {
    const pct = percentile(pool, key, player[key]);
    if (pct != null && pct >= 90) {
      wrap.appendChild(h('div', { class: 'insight-card' }, [
        h('div', { class: 'kicker' }, badge(tt('players.eliteTier'), 'accent')),
        h('h4', {}, tt('players.topPctInStat', { pct: 100 - pct, stat: statLabel(key) })),
        h('div', { class: 'body-text' }, tt('players.ranksInPercentile', { val: fmtStat(key, player[key]), pct, n: pool.length })),
      ]));
    }
  });
  if (!wrap.children.length) wrap.appendChild(emptyState(tt('players.noSignals')));
  return wrap;
}
