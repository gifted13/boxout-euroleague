// ============================================================================
// Teams: list + full team profile (Overview / Performance / Advanced /
// Trends / Splits / Roster / Games / Comparisons / Historical / Insights)
// ============================================================================

import { loadSeason, SEASONS, SEASON_LABELS, percentile, leaders } from '../data.js';
import { currentStreaks, biggestHomeAwaySplit, statOutliers } from '../insights.js';
import {
  h, card, sectionHead, statTile, badge, formPills, dataTable, tabs, favStar,
  infoIcon, skeletonCard, emptyState, teamChip, entityHero, chartLegend,
} from '../components.js';
import { lineChart, hbarChart, radarChart, pctBar, statRing } from '../charts.js';
import { fmtNum, fmtPct, fmtSigned, fmtStat, statLabel, titleCase, STAT_META, hashColor } from '../format.js';
import { state, isFavoriteTeam, toggleFavoriteTeam } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

// ---------------------------------------------------------------------------
// Teams list
// ---------------------------------------------------------------------------
export async function renderTeamsList(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('teams.loadError'))); return; }
  const { team_season } = season;

  let query = '';
  const header = h('div', { style: 'display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap' }, [
    h('div', {}, [h('div', { class: 'eyebrow' }, tt('teams.allClubs')), h('h1', { style: 'font-size:24px;margin-top:4px' }, `${SEASON_LABELS[state.season]} ${tt('nav.teams')}`)]),
    h('input', {
      placeholder: tt('teams.searchPlaceholder'), style: 'margin-left:auto;padding:8px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font-size:13px;min-width:220px',
      oninput: (e) => { query = e.target.value; renderTable(); },
    }),
  ]);
  wrap.appendChild(header);
  const tableSlot = h('div');
  wrap.appendChild(tableSlot);

  function renderTable() {
    tableSlot.innerHTML = '';
    const rows = team_season.filter(t => t.team_name.toLowerCase().includes(query.toLowerCase()));
    tableSlot.appendChild(dataTable(rows, [
      { key: 'team_name', label: tt('common.team'), align: 'left', primary: true, render: t => teamChip(t.team_name, t.team_code) },
      { key: 'wins', label: 'W-L', sortVal: t => t.win_pct, render: t => `${t.wins}–${t.losses}` },
      { key: 'win_pct', label: 'Win%', statKey: 'win_pct', render: t => fmtPct(t.win_pct) },
      { key: 'PPG', label: 'PPG', statKey: 'PPG', render: t => fmtNum(t.PPG) },
      { key: 'ORtg', label: 'ORTG', statKey: 'ORtg', render: t => fmtNum(t.ORtg) },
      { key: 'DRtg', label: 'DRTG', statKey: 'DRtg', render: t => fmtNum(t.DRtg) },
      { key: 'NET_RTG', label: 'NET', statKey: 'NET_RTG', render: t => fmtSigned(t.NET_RTG) },
      { key: 'PACE', label: 'PACE', statKey: 'PACE', render: t => fmtNum(t.PACE) },
      { key: 'form', label: tt('cc.last5'), sortable: false, render: t => formPills(t.last5_form) },
      { key: 'fav', label: '', sortable: false, render: t => favStar(isFavoriteTeam(t.team_code), (elm) => { const on = toggleFavoriteTeam(t.team_code); elm.className = 'fav-star' + (on ? ' on' : ''); elm.innerHTML = on ? '★' : '☆'; }) },
    ], { onRowClick: (t) => navigate(`/team/${t.team_code}`), initialSort: { key: 'win_pct', dir: 'desc' } }));
  }
  renderTable();
}

// ---------------------------------------------------------------------------
// Team profile
// ---------------------------------------------------------------------------
function TABS() {
  return [
    { key: 'overview', label: tt('teams.tabOverview') }, { key: 'performance', label: tt('teams.tabPerformance') },
    { key: 'advanced', label: tt('teams.tabAdvanced') }, { key: 'trends', label: tt('teams.tabTrends') },
    { key: 'splits', label: tt('teams.tabSplits') }, { key: 'roster', label: tt('teams.tabRoster') },
    { key: 'games', label: tt('teams.tabGames') }, { key: 'comparisons', label: tt('teams.tabComparisons') },
    { key: 'historical', label: tt('teams.tabHistorical') }, { key: 'insights', label: tt('teams.tabInsights') },
  ];
}

export async function renderTeamProfile(root, code, setCrumb) {
  root.innerHTML = '';
  setCrumb(tt('nav.teams'));
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = await loadSeason(state.season).catch(() => null);
  if (!season) { wrap.innerHTML = ''; wrap.appendChild(emptyState(tt('teams.loadErrorProfile'))); return; }
  const team = season.team_season.find(t => t.team_code === code);
  wrap.innerHTML = '';
  if (!team) { wrap.appendChild(emptyState(tt('teams.notFound', { code, season: SEASON_LABELS[state.season] }))); return; }
  setCrumb(`${tt('nav.teams')} / ${team.team_name}`);
  setAIContext(`Team Profile: ${team.team_name}`, { team, league_averages: season.league_averages });

  // ----- header -----
  const star = favStar(isFavoriteTeam(code), (elm) => { const on = toggleFavoriteTeam(code); elm.className = 'fav-star' + (on ? ' on' : ''); elm.innerHTML = on ? '★' : '☆'; });
  star.style.cssText = 'font-size:22px;color:#fff;opacity:.9';
  wrap.appendChild(h('div', { style: 'margin-bottom:20px' }, [
    entityHero({
      crestText: team.team_code,
      crestColor: hashColor(team.team_code),
      crestLogo: team.team_code,
      name: h('span', { style: 'display:flex;align-items:center;gap:12px' }, [team.team_name, star]),
      meta: tt('teams.heroMeta', { pos: team.position, wins: team.wins, losses: team.losses, pct: fmtPct(team.win_pct), season: SEASON_LABELS[state.season] }),
      side: [
        h('span', { style: 'background:rgba(255,255,255,.22);color:#fff;font-family:var(--font-data);font-weight:800;font-size:12px;padding:4px 10px;border-radius:var(--radius-sm)' }, `NET ${fmtSigned(team.NET_RTG)}`),
        formPills(team.last5_form),
      ],
    }),
  ]));

  const tabSlot = h('div');
  const tabBar = h('div', { style: 'margin-bottom:20px' }, [tabs(TABS(), 'overview', (key) => renderTab(key))]);
  wrap.appendChild(tabBar);
  wrap.appendChild(tabSlot);

  function setActiveTabUI(key) {
    tabBar.innerHTML = '';
    tabBar.appendChild(tabs(TABS(), key, renderTab));
  }

  function renderTab(key) {
    setActiveTabUI(key);
    tabSlot.innerHTML = '';
    const renderers = {
      overview: tabOverview, performance: tabPerformance, advanced: tabAdvanced, trends: tabTrends,
      splits: tabSplits, roster: tabRoster, games: tabGames, comparisons: tabComparisons,
      historical: tabHistorical, insights: tabInsights,
    };
    tabSlot.appendChild(renderers[key](team, season, renderTab));
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

function tabOverview(team, season, goToTab) {
  const wrap = h('div');
  const pool = season.team_season;
  const ptsAgainst = team.points_against / team.games_played;
  const ringRow = h('div', { class: 'card', style: 'display:flex;justify-content:space-around;flex-wrap:wrap;gap:20px;padding:var(--sp-6) var(--sp-5)' }, [
    (() => { const pct = percentile(pool, 'PPG', team.PPG); return statRing({ value: fmtNum(team.PPG), label: tt('teams.pointsFor'), pct, color: pct >= 66 ? 'var(--good)' : pct <= 33 ? 'var(--critical)' : 'var(--accent-2)' }); })(),
    (() => { const pctLow = percentile(pool, 'points_against', team.points_against, true); return statRing({ value: fmtNum(ptsAgainst), label: tt('teams.pointsAgainst'), pct: pctLow, color: pctLow >= 66 ? 'var(--good)' : pctLow <= 33 ? 'var(--critical)' : 'var(--accent-2)' }); })(),
    (() => { const pct = percentile(pool, 'ORtg', team.ORtg); return statRing({ value: fmtNum(team.ORtg), label: statLabel('ORtg'), pct, color: pct >= 66 ? 'var(--good)' : pct <= 33 ? 'var(--critical)' : 'var(--accent-2)' }); })(),
    (() => { const pctLow = percentile(pool, 'DRtg', team.DRtg, true); return statRing({ value: fmtNum(team.DRtg), label: statLabel('DRtg'), pct: pctLow, color: pctLow >= 66 ? 'var(--good)' : pctLow <= 33 ? 'var(--critical)' : 'var(--accent-2)' }); })(),
  ]);
  wrap.appendChild(ringRow);
  wrap.appendChild(h('p', { style: 'font-size:11px;color:var(--ink-muted);text-align:center;margin-top:8px' }, tt('teams.arcFillNote', { n: pool.length })));
  wrap.appendChild(sectionHead(tt('teams.pointDiffTrend')));
  const games = season.team_games.filter(g => g.team === team.team_code && g.phase === 'RS').sort((a, b) => a.round - b.round);
  let cum = 0;
  const points = games.map(g => { cum += (g.team_score - g.opp_score); return { x: g.round, y: g.team_score - g.opp_score, cum }; });
  wrap.appendChild(card([lineChart(
    [{ name: tt('teams.margin'), color: 'var(--series-1)', points: points.map(p => ({ x: p.x, y: p.y })) }],
    { yFmt: v => fmtSigned(v, 0), xFmt: v => tt('common.round', { n: v }), height: 200 },
  )], { title: tt('teams.marginByRound'), sub: tt('teams.marginByRoundSub') }));

  wrap.appendChild(sectionHead(tt('teams.rosterSnapshot'), { action: h('button', { class: 'btn btn-sm btn-ghost', onclick: () => goToTab('roster') }, tt('teams.fullRoster')) }));
  const roster = (season.rosters[team.team_code] || []).slice();
  const topByVal = roster
    .map(r => season.player_season.players.find(p => p.Player_ID === r.Player_ID))
    .filter(Boolean)
    .sort((a, b) => b.VAL - a.VAL)
    .slice(0, 5);
  wrap.appendChild(card([
    h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, topByVal.map(p => h('div', {
      style: 'display:flex;align-items:center;gap:10px;cursor:pointer', onclick: () => navigate(`/player/${p.Player_ID}`),
    }, [
      h('div', { style: 'flex:1;min-width:0' }, [
        h('div', { style: 'font-size:13px;font-weight:600' }, titleCase(p.Player)),
        h('div', { style: 'font-size:11px;color:var(--ink-muted)' }, `${fmtNum(p.PTS)} PTS · ${fmtNum(p.TRB)} REB · ${fmtNum(p.AST)} AST`),
      ]),
      badge(fmtNum(p.VAL) + ' PIR', 'accent'),
    ]))),
  ]));
  return wrap;
}

function tabPerformance(team, season) {
  const wrap = h('div');
  const pool = season.team_season;
  const stats = ['PPG', 'FG_PCT', 'FG2_PCT', 'FG3_PCT', 'FT_PCT', 'TRB', 'ORB', 'DRB', 'AST', 'STL', 'BLK', 'TOV', 'PF'];
  wrap.appendChild(card(stats.map(s => statPercentileRow(s, team, pool)), { title: tt('teams.traditionalAverages'), sub: `${SEASON_LABELS[state.season]} · ${tt('teams.percentileAmongTeams', { n: pool.length })}` }));
  return wrap;
}

function tabAdvanced(team, season) {
  const wrap = h('div');
  const pool = season.team_season;
  const stats = ['ORtg', 'DRtg', 'NET_RTG', 'PACE', 'eFG', 'TOV_PCT', 'FT_per_FGA', 'ORB_PCT', 'AST_PCT', 'OPP_TOV_PCT', 'OPP_ORB_PCT', 'OPP_EFG'];
  wrap.appendChild(card(stats.map(s => statPercentileRow(s, team, pool)), { title: tt('teams.fourFactor'), sub: tt('teams.percentileAmongAllTeams') }));
  return wrap;
}

function tabTrends(team, season) {
  const wrap = h('div');
  const games = season.team_games.filter(g => g.team === team.team_code && g.phase === 'RS').sort((a, b) => a.round - b.round);
  // rolling 5-game scoring average
  const roll = games.map((g, i) => {
    const slice = games.slice(Math.max(0, i - 4), i + 1);
    const avg = slice.reduce((a, b) => a + b.team_score, 0) / slice.length;
    const avgOpp = slice.reduce((a, b) => a + b.opp_score, 0) / slice.length;
    return { x: g.round, y: avg, yOpp: avgOpp };
  });
  wrap.appendChild(card([lineChart([
    { name: tt('teams.pointsForRolling'), color: 'var(--series-1)', points: roll.map(p => ({ x: p.x, y: p.y })) },
    { name: tt('teams.pointsAgainstRolling'), color: 'var(--series-8)', points: roll.map(p => ({ x: p.x, y: p.yOpp })) },
  ], { yFmt: v => fmtNum(v, 0), xFmt: v => tt('common.round', { n: v }), height: 220 }),
    chartLegend([{ label: tt('teams.pointsForRolling'), color: 'var(--series-1)' }, { label: tt('teams.pointsAgainstRolling'), color: 'var(--series-8)' }]),
  ], { title: tt('teams.rollingScoringTrend') }));

  const streaks = currentStreaks(season.team_games);
  const cur = streaks.get(team.team_code);
  if (cur) {
    wrap.appendChild(card([
      h('div', { style: 'font-size:14px' }, [
        tt('teams.currentlyOn') + ' ', h('strong', { style: `color:${cur.kind ? 'var(--good)' : 'var(--critical)'}` }, tt(cur.kind ? 'teams.winningStreakN' : 'teams.losingStreakN', { n: cur.streak })), '.',
      ]),
    ], { title: tt('teams.currentStreak') }));
  }
  return wrap;
}

function tabSplits(team, season) {
  const wrap = h('div');
  wrap.appendChild(h('div', { class: 'grid grid-2' }, [
    card([
      h('div', { class: 'grid grid-3' }, [
        statTile({ label: statLabel('ORtg'), value: fmtNum(team.off_rtg_home) }),
        statTile({ label: statLabel('DRtg'), value: fmtNum(team.def_rtg_home) }),
        statTile({ label: statLabel('NET_RTG'), value: fmtSigned(team.net_rtg_home) }),
      ]),
    ], { title: tt('teams.home') }),
    card([
      h('div', { class: 'grid grid-3' }, [
        statTile({ label: statLabel('ORtg'), value: fmtNum(team.off_rtg_away) }),
        statTile({ label: statLabel('DRtg'), value: fmtNum(team.def_rtg_away) }),
        statTile({ label: statLabel('NET_RTG'), value: fmtSigned(team.net_rtg_away) }),
      ]),
    ], { title: tt('players.away') }),
  ]));
  wrap.appendChild(sectionHead(tt('teams.clutchMoments')));
  wrap.appendChild(card([
    h('div', { class: 'grid grid-2' }, [
      statTile({ label: tt('teams.buzzerBeaters'), value: String(team.buzzer_beaters ?? 0), foot: tt('teams.buzzerBeatersFoot') }),
      statTile({ label: tt('teams.buzzerChokers'), value: String(team.buzzer_chokers ?? 0), foot: tt('teams.buzzerChokersFoot') }),
    ]),
  ]));
  const fouls = season.fouls_team_summary.find(f => f.TEAM === team.team_code);
  if (fouls) {
    wrap.appendChild(sectionHead(tt('teams.foulTendencies')));
    wrap.appendChild(card([
      h('div', { class: 'grid grid-2' }, [
        statTile({ label: tt('teams.foulsPerGame'), value: fmtNum(fouls.fouls_per_game) }),
        statTile({ label: tt('teams.foulsToFtRate'), value: fmtNum(fouls.fouls_to_FT_rate, 2) }),
      ]),
    ]));
  }
  return wrap;
}

function tabRoster(team, season) {
  const wrap = h('div');
  const roster = season.rosters[team.team_code] || [];
  const rows = roster.map(r => season.player_season.players.find(p => p.Player_ID === r.Player_ID)).filter(Boolean);
  wrap.appendChild(dataTable(rows, [
    { key: 'Player', label: tt('common.player'), align: 'left', primary: true, render: p => titleCase(p.Player) },
    { key: 'Dorsal', label: '#', render: p => p.Dorsal ?? '—' },
    { key: 'GP', label: 'GP' },
    { key: 'MIN', label: 'MIN', render: p => fmtNum(p.MIN) },
    { key: 'PTS', label: 'PTS', render: p => fmtNum(p.PTS) },
    { key: 'TRB', label: 'REB', render: p => fmtNum(p.TRB) },
    { key: 'AST', label: 'AST', render: p => fmtNum(p.AST) },
    { key: 'TS_PCT', label: 'TS%', render: p => fmtPct(p.TS_PCT) },
    { key: 'VAL', label: 'PIR', render: p => fmtNum(p.VAL) },
  ], { onRowClick: (p) => navigate(`/player/${p.Player_ID}`), initialSort: { key: 'MIN', dir: 'desc' } }));
  return wrap;
}

function tabGames(team, season) {
  const wrap = h('div');
  let phaseFilter = 'RS';
  const chipRow = h('div', { class: 'chip-row', style: 'margin-bottom:14px' });
  ['RS', 'PI', 'PO', 'FF', 'ALL'].forEach(ph => {
    const chip = h('span', { class: 'chip' + (phaseFilter === ph ? ' active' : ''), onclick: () => { phaseFilter = ph; update(); } }, ph === 'ALL' ? tt('common.allPhases') : ph);
    chipRow.appendChild(chip);
  });
  wrap.appendChild(chipRow);
  const tableSlot = h('div');
  wrap.appendChild(tableSlot);
  function update() {
    [...chipRow.children].forEach((c, i) => c.className = 'chip' + (['RS', 'PI', 'PO', 'FF', 'ALL'][i] === phaseFilter ? ' active' : ''));
    const games = season.team_games.filter(g => g.team === team.team_code && (phaseFilter === 'ALL' || g.phase === phaseFilter)).sort((a, b) => b.gamecode - a.gamecode);
    tableSlot.innerHTML = '';
    tableSlot.appendChild(dataTable(games, [
      { key: 'round_name', label: tt('common.round', { n: '' }).trim(), align: 'left', sortVal: g => g.gamecode, render: g => `${g.round_name}${g.phase !== 'RS' ? ' (' + g.phase + ')' : ''}` },
      { key: 'opponent_name', label: tt('players.opponent'), align: 'left', render: g => `${g.home ? tt('common.vs') : tt('common.at')} ${g.opponent_name}` },
      { key: 'team_score', label: tt('standouts.score'), render: g => `${g.team_score}–${g.opp_score}` },
      { key: 'win', label: tt('teams.result'), render: g => badge(g.win ? tt('teams.w') : tt('teams.l'), g.win ? 'good' : 'critical'), sortVal: g => g.win ? 1 : 0 },
    ], { initialSort: { key: 'round_name', dir: 'desc' }, scrollMax: 520 }));
  }
  update();
  return wrap;
}

function tabComparisons(team, season) {
  const wrap = h('div');
  const axes = [
    { key: 'ORtg', label: 'OFF RTG', max: Math.max(...season.team_season.map(t => t.ORtg)) },
    { key: 'DRtg_inv', label: 'DEF RTG', max: Math.max(...season.team_season.map(t => 130 - t.DRtg)) },
    { key: 'PACE', label: 'PACE', max: Math.max(...season.team_season.map(t => t.PACE)) },
    { key: 'AST_PCT', label: 'AST%', max: Math.max(...season.team_season.map(t => t.AST_PCT)) },
    { key: 'ORB_PCT', label: 'OREB%', max: Math.max(...season.team_season.map(t => t.ORB_PCT)) },
    { key: 'eFG', label: 'eFG%', max: Math.max(...season.team_season.map(t => t.eFG)) },
  ];
  const leagueAvgEntity = {
    name: tt('players.leagueAvg'), color: 'var(--chart-muted)',
    values: Object.fromEntries(axes.map(a => [a.key, a.key === 'DRtg_inv' ? 130 - (season.league_averages.ORtg ?? 115) : (season.team_season.reduce((s, t) => s + (a.key === 'DRtg_inv' ? 130 - t.DRtg : t[a.key]), 0) / season.team_season.length)])),
  };
  const teamEntity = {
    name: team.team_code, color: 'var(--accent)',
    values: Object.fromEntries(axes.map(a => [a.key, a.key === 'DRtg_inv' ? 130 - team.DRtg : team[a.key]])),
  };
  wrap.appendChild(card([
    radarChart(axes, [leagueAvgEntity, teamEntity], { size: 340 }),
    chartLegend([{ label: leagueAvgEntity.name, color: leagueAvgEntity.color }, { label: team.team_name, color: teamEntity.color }]),
  ], { title: tt('players.vsLeagueAvg', { player: team.team_name }), sub: tt('teams.largerIsBetter') }));
  wrap.appendChild(card([
    h('p', { style: 'font-size:13px;color:var(--ink-secondary)' }, tt('teams.compareCta', { code: team.team_code })),
    h('button', { class: 'btn btn-primary btn-sm', style: 'margin-top:10px', onclick: () => navigate(`/compare?type=team&a=${team.team_code}`) }, tt('teams.openInCompare')),
  ]));
  return wrap;
}

function tabHistorical(team, season) {
  const wrap = h('div');
  const otherSeason = SEASONS.find(s => s !== state.season);
  const box = h('div');
  wrap.appendChild(box);
  box.appendChild(skeletonCard());
  loadSeason(otherSeason).then(other => {
    box.innerHTML = '';
    const prior = other.team_season.find(t => t.team_code === team.team_code);
    if (!prior) {
      box.appendChild(card([h('p', { style: 'font-size:13px;color:var(--ink-secondary)' }, tt('teams.noPriorRecord', { team: team.team_name, season: SEASON_LABELS[otherSeason] }))], { title: tt('teams.vsSeason', { season: SEASON_LABELS[otherSeason] }) }));
      return;
    }
    const rows = [
      [tt('teams.record'), `${team.wins}–${team.losses}`, `${prior.wins}–${prior.losses}`],
      ['Win %', fmtPct(team.win_pct), fmtPct(prior.win_pct)],
      ['PPG', fmtNum(team.PPG), fmtNum(prior.PPG)],
      ['ORtg', fmtNum(team.ORtg), fmtNum(prior.ORtg)],
      ['DRtg', fmtNum(team.DRtg), fmtNum(prior.DRtg)],
      [statLabel('NET_RTG'), fmtSigned(team.NET_RTG), fmtSigned(prior.NET_RTG)],
      [statLabel('PACE'), fmtNum(team.PACE), fmtNum(prior.PACE)],
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

function tabInsights(team, season) {
  const wrap = h('div', { class: 'grid grid-2' });
  const streaks = currentStreaks(season.team_games);
  const cur = streaks.get(team.team_code);
  if (cur && cur.streak >= 2) {
    wrap.appendChild(h('div', { class: 'insight-card' }, [
      h('div', { class: 'kicker' }, badge(cur.kind ? tt('cc.hotStreak') : tt('cc.coldStreak'), cur.kind ? 'good' : 'critical')),
      h('h4', {}, tt(cur.kind ? 'teams.winningStreakN' : 'teams.losingStreakN', { n: cur.streak })),
      h('div', { class: 'body-text' }, tt('teams.computedFromLog')),
    ]));
  }
  const splits = biggestHomeAwaySplit([team], { limit: 1 })[0];
  if (splits) {
    wrap.appendChild(h('div', { class: 'insight-card' }, [
      h('div', { class: 'kicker' }, badge(tt('cc.homeAwaySplit'), 'warning')),
      h('h4', {}, tt('teams.netRatingGap', { diff: fmtSigned(splits.split) })),
      h('div', { class: 'body-text' }, tt('teams.homeVsRoad', { home: fmtSigned(splits.net_rtg_home), away: fmtSigned(splits.net_rtg_away) })),
    ]));
  }
  ['FG3_PCT', 'TOV_PCT', 'ORB_PCT', 'PACE'].forEach(key => {
    const { hot } = statOutliers(season.team_season, key, { limit: 20, lowerIsBetter: STAT_META[key]?.hib === false });
    const idx = hot.findIndex(t => t.team_code === team.team_code);
    if (idx >= 0 && idx < 3 && Math.abs(hot[idx].z) > 1) {
      wrap.appendChild(h('div', { class: 'insight-card' }, [
        h('div', { class: 'kicker' }, badge(tt('teams.statisticalOutlier'), 'accent')),
        h('h4', {}, tt('teams.rankInLeague', { rank: idx + 1, stat: statLabel(key) })),
        h('div', { class: 'body-text' }, tt('teams.zFromMean', { val: fmtStat(key, hot[idx][key]), z: hot[idx].z.toFixed(1) })),
      ]));
    }
  });
  if (!wrap.children.length) wrap.appendChild(emptyState('No statistically significant outliers detected for this team right now.'));
  return wrap;
}
