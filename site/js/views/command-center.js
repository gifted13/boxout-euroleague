// ============================================================================
// Command Center — the landing dashboard. Surfaces what's worth knowing
// today: league leaders, power rankings, standout recent performances, and
// a handful of data-backed insights computed live from the loaded season.
// ============================================================================

import { loadSeason, loadManifest, leaders, SEASON_LABELS } from '../data.js';
import { currentStreaks, standoutPerformances, biggestHomeAwaySplit, statOutliers, hotStreakPlayers, maxPlayedRound } from '../insights.js';
import { h, statTile, card, sectionHead, insightCard, badge, teamChip, avatarInitial, formPills, dataTable, favStar, skeletonCard, infoIcon, chartWithActions, leaderCard, ticketCard, playerStandoutCard, comboSelect } from '../components.js';
import { hbarChart, sparkline } from '../charts.js';
import { fmtNum, fmtInt, fmtPct, fmtSigned, fmtStat, fmtDate, fmtDateShort, titleCase, statLabel, hashColor } from '../format.js';
import { state, isFavoriteTeam, toggleFavoriteTeam, isFavoritePlayer, toggleFavoritePlayer } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t, currentLang } from '../i18n.js';
import * as account from '../account.js';

export async function renderCommandCenter(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  root.appendChild(wrap);

  // skeleton while loading
  const skelGrid = h('div', { class: 'grid grid-4' }, [skeletonCard(), skeletonCard(), skeletonCard(), skeletonCard()]);
  wrap.appendChild(skelGrid);

  let season, manifest;
  try {
    [season, manifest] = await Promise.all([loadSeason(state.season), loadManifest()]);
  } catch (err) {
    wrap.innerHTML = '';
    wrap.appendChild(h('div', { class: 'card' }, [
      h('h3', { style: 'margin-bottom:8px' }, t('nav.home')),
      h('div', { class: 'error-state' }, [h('div', { class: 'ic' }, '⚠'), h('h4', {}, t('cc.loadError')), h('div', { style: 'font-size:12px;margin-top:4px' }, String(err.message || err))]),
    ]));
    return;
  }
  wrap.innerHTML = '';

  const { team_season, player_season, team_games, player_game_log } = season;
  const players = player_season.players;
  const qualGames = player_season.qualifier_games;

  // ---------------- Header ----------------
  const standingsLeader = team_season.slice().sort((a, b) => b.win_pct - a.win_pct)[0];
  const roundsPlayed = Math.max(...team_games.filter(g => g.phase === 'RS').map(g => g.round), 0);
  wrap.appendChild(h('div', { style: 'display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:20px' }, [
    h('div', {}, [
      h('div', { class: 'eyebrow' }, t('cc.eyebrow')),
      h('h1', { style: 'font-size:26px;margin-top:4px' }, `EuroLeague ${SEASON_LABELS[state.season]}`),
    ]),
    h('div', { style: 'margin-left:auto;text-align:right;font-size:12px;color:var(--ink-muted)' }, [
      h('div', {}, t('cc.roundOf', { round: roundsPlayed, total: manifest.seasons.find(s => s.code === state.season)?.rs_rounds ?? '—' })),
      h('div', { style: 'margin-top:2px' }, t('cc.dataAsOf', { date: fmtDate(manifest.generated_at) })),
    ]),
  ]));

  // ---------------- Latest results strip ----------------
  const latestRoundGames = team_games.filter(g => g.phase === 'RS' && g.round === roundsPlayed && g.home);
  if (latestRoundGames.length) {
    const row = h('div', { class: 'ticket-row' });
    latestRoundGames.slice().sort((a, b) => a.date - b.date).forEach(g => {
      row.appendChild(ticketCard({
        roundLabel: g.round_name || t('common.round', { n: g.round }),
        dateLabel: fmtDateShort(g.date),
        teams: [
          { code: g.team, score: g.team_score, win: g.win },
          { code: g.opponent, score: g.opp_score, win: !g.win },
        ],
        onClick: () => navigate(`/team/${g.win ? g.team : g.opponent}`),
      }));
    });
    wrap.appendChild(row);
  }

  // ---------------- Headline stat tiles ----------------
  const topScorer = leaders(players, 'PTS', { limit: 1 })[0];
  const topVal = leaders(players, 'VAL', { limit: 1 })[0];
  const leagueAvg = season.league_averages;

  setAIContext('Command Center', {
    season: SEASON_LABELS[state.season],
    standings_top5: team_season.slice().sort((a, b) => b.win_pct - a.win_pct).slice(0, 5).map(t => ({ team: t.team_name, record: `${t.wins}-${t.losses}`, win_pct: t.win_pct, net_rtg: t.NET_RTG })),
    scoring_leaders: leaders(players, 'PTS', { limit: 5 }).map(p => ({ player: p.Player, team: p.Team, pts: p.PTS })),
    rebounding_leaders: leaders(players, 'TRB', { limit: 5 }).map(p => ({ player: p.Player, team: p.Team, reb: p.TRB })),
    assist_leaders: leaders(players, 'AST', { limit: 5 }).map(p => ({ player: p.Player, team: p.Team, ast: p.AST })),
    valuation_leaders: leaders(players, 'VAL', { limit: 5 }).map(p => ({ player: p.Player, team: p.Team, pir: p.VAL })),
    league_averages: leagueAvg,
  });
  wrap.appendChild(h('div', { class: 'grid grid-4' }, [
    statTile({
      label: t('cc.leagueLeader'), value: standingsLeader.team_code, unit: '',
      foot: `${standingsLeader.wins}–${standingsLeader.losses} · ${t('cc.winRate', { pct: fmtPct(standingsLeader.win_pct) })}`,
      onClick: () => navigate(`/team/${standingsLeader.team_code}`),
    }),
    statTile({
      label: t('cc.scoringLeader'), statKey: 'PTS', value: titleCase(topScorer.Player).split(' ').pop(), unit: fmtNum(topScorer.PTS) + ' PPG',
      foot: topScorer.Team, onClick: () => navigate(`/player/${topScorer.Player_ID}`),
    }),
    statTile({
      label: t('cc.leagueAvgPace'), statKey: 'PACE', value: fmtNum(leagueAvg.PACE), unit: t('cc.possPer40'),
      foot: t('cc.offRatingAvg', { val: fmtNum(leagueAvg.ORtg) }),
    }),
    statTile({
      label: t('cc.mostValuable'), statKey: 'VAL', value: titleCase(topVal.Player).split(' ').pop(), unit: fmtNum(topVal.VAL),
      foot: topVal.Team, onClick: () => navigate(`/player/${topVal.Player_ID}`),
    }),
  ]));

  // ---------------- Data-backed insights ----------------
  wrap.appendChild(sectionHead(t('cc.insightsHead'), { count: 4 }));
  const streaks = currentStreaks(team_games);
  const hottestStreak = [...streaks.entries()].filter(([, v]) => v.kind === true).sort((a, b) => b[1].streak - a[1].streak)[0];
  const coldestStreak = [...streaks.entries()].filter(([, v]) => v.kind === false).sort((a, b) => b[1].streak - a[1].streak)[0];
  const splits = biggestHomeAwaySplit(team_season, { limit: 1 })[0];
  const threeOutliers = statOutliers(team_season, 'FG3_PCT', { limit: 1 });
  // minGames defaults to 8 in insights.js (meant for a full season) — early
  // on, nobody has played 8 games yet, so scale it down to what's actually
  // possible this many rounds in, or this card silently never appears.
  const hotPlayers = hotStreakPlayers(player_game_log, players, 'PTS', { window: 5, limit: 1, minGames: Math.max(1, Math.min(8, roundsPlayed)) });

  const insightsGrid = h('div', { class: 'grid grid-2' });
  if (hottestStreak) {
    const [code, v] = hottestStreak;
    const tm = team_season.find(x => x.team_code === code);
    insightsGrid.appendChild(insightCard({
      eyebrow: t('cc.hotStreak'), tone: 'good',
      season: SEASON_LABELS[state.season],
      title: t('cc.hotStreakTitle', { team: tm.team_name, n: v.streak }),
      body: t('cc.hotStreakBody', { team: tm.team_name, wins: tm.wins, losses: tm.losses, n: v.streak, season: SEASON_LABELS[state.season] }),
      sourceNote: t('cc.sourceStreak'),
      onExplore: () => navigate(`/team/${code}`),
    }));
  }
  if (coldestStreak && coldestStreak[1].streak >= 3) {
    const [code, v] = coldestStreak;
    const tm = team_season.find(x => x.team_code === code);
    insightsGrid.appendChild(insightCard({
      eyebrow: t('cc.coldStreak'), tone: 'critical',
      season: SEASON_LABELS[state.season],
      title: t('cc.coldStreakTitle', { team: tm.team_name, n: v.streak }),
      body: t('cc.coldStreakBody', { team: tm.team_name, wins: tm.wins, losses: tm.losses, n: v.streak }),
      sourceNote: t('cc.sourceStreak'),
      onExplore: () => navigate(`/team/${code}`),
    }));
  }
  if (splits) {
    const homeBetter = splits.split > 0;
    insightsGrid.appendChild(insightCard({
      eyebrow: t('cc.homeAwaySplit'), tone: 'warning',
      season: SEASON_LABELS[state.season],
      title: t('cc.splitTitle', { team: splits.team_name, diff: fmtSigned(splits.split) }),
      body: t('cc.splitBody', { team: splits.team_name, home: fmtSigned(splits.net_rtg_home), away: fmtSigned(splits.net_rtg_away) }),
      sourceNote: t('cc.sourceSplits'),
      onExplore: () => navigate(`/team/${splits.team_code}`),
    }));
  }
  if (threeOutliers.hot[0]) {
    const tm = threeOutliers.hot[0];
    insightsGrid.appendChild(insightCard({
      eyebrow: t('cc.threeOutlier'), tone: 'accent',
      season: SEASON_LABELS[state.season],
      title: t('cc.threeOutlierTitle', { team: tm.team_name, pct: fmtPct(tm.FG3_PCT) }),
      body: t('cc.threeOutlierBody', { diff: fmtSigned((tm.FG3_PCT - threeOutliers.leagueAvg) * 100, 1), avg: fmtPct(threeOutliers.leagueAvg), z: tm.z.toFixed(1) }),
      sourceNote: t('cc.sourceThreeOutlier'),
      onExplore: () => navigate(`/team/${tm.team_code}`),
    }));
  }
  if (hotPlayers[0] && Math.abs(hotPlayers[0].diff) >= 1) {
    const p = hotPlayers[0].player;
    insightsGrid.appendChild(insightCard({
      eyebrow: t('cc.onAHeater'), tone: 'accent',
      season: SEASON_LABELS[state.season],
      title: t('cc.heaterTitle', { player: titleCase(p.Player), avg: fmtNum(hotPlayers[0].recentAvg) }),
      body: t('cc.heaterBody', { diff: fmtSigned(hotPlayers[0].diff), avg: fmtNum(hotPlayers[0].seasonAvg) }),
      sourceNote: t('cc.sourceHeater'),
      onExplore: () => navigate(`/player/${p.Player_ID}`),
    }));
  }
  wrap.appendChild(insightsGrid);

  // ---------------- AI Analysis (model-written, refreshed daily) ----------------
  // Separate from the deterministic insights above on purpose: those are
  // plain arithmetic (js/insights.js), this section is the one place in the
  // app where an LLM actually writes the prose, from a Netlify scheduled
  // function (netlify/functions/ai-insights.js) that writes ai_insights/
  // latest in Firestore once a day. Rendered as its own labeled section —
  // never mixed into the cards above — so it's always clear to the reader
  // which is which. Non-blocking: the rest of the dashboard doesn't wait on
  // this Firestore read, and the section simply stays absent if the doc
  // doesn't exist yet (function hasn't run) or the read fails.
  (async () => {
    try {
      const db = await account.getDb();
      if (!db) return;
      const snap = await db.doc('ai_insights/latest').get();
      if (!snap.exists) return;
      const aiDoc = snap.data();
      if (!aiDoc || !Array.isArray(aiDoc.items) || !aiDoc.items.length) return;
      // The doc isn't season-scoped in storage — it's whatever season the
      // function last targeted. Never render it for a different season than
      // the one currently on screen (was rendering unconditionally before).
      if (String(aiDoc.season) !== String(state.season)) return;
      const lang = currentLang();

      const aiSection = h('div', { style: 'margin-top:28px' });
      const head = sectionHead(t('cc.aiInsightsHead'), { count: aiDoc.items.length });
      head.appendChild(badge(t('cc.aiInsightsBadge'), 'accent'));
      aiSection.appendChild(head);
      aiSection.appendChild(h('p', { style: 'font-size:12.5px;color:var(--ink-muted);margin:-6px 0 12px;max-width:640px' }, t('cc.aiInsightsSubtitle')));
      const aiGrid = h('div', { class: 'grid grid-2' });
      aiDoc.items.forEach(item => {
        const pick = (field) => (item[field] && (item[field][lang] || item[field].en)) || '';
        aiGrid.appendChild(insightCard({
          eyebrow: pick('eyebrow'), tone: item.tone || 'accent',
          season: aiDoc.season_label || SEASON_LABELS[aiDoc.season],
          title: pick('title'), body: pick('body'), sourceNote: pick('sourceNote'),
        }));
      });
      aiSection.appendChild(aiGrid);
      if (aiDoc.generated_at) {
        aiSection.appendChild(h('div', { style: 'font-size:11px;color:var(--ink-muted);margin-top:8px' }, t('cc.aiInsightsUpdated', { date: fmtDate(new Date(aiDoc.generated_at).getTime()) })));
      }
      wrap.appendChild(aiSection);
    } catch { /* AI Analysis is supplementary — fail silently, rest of the page still works */ }
  })();

  // ---------------- Standout performances (pick any round played so far) ----------------
  const lastRound = maxPlayedRound(player_game_log);
  let standoutRound = lastRound;
  const standoutHeadSlot = h('div');
  const standoutRoundPicker = h('div', { style: 'width:220px;max-width:100%' }, [
    comboSelect({
      items: Array.from({ length: lastRound }, (_, i) => lastRound - i).map(n => ({ value: String(n), label: t('common.round', { n }) })),
      value: String(standoutRound),
      onChange: (v) => { standoutRound = Number(v); renderStandouts(); },
    }),
  ]);
  wrap.appendChild(h('div', { style: 'display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;margin-bottom:2px' }, [standoutHeadSlot, h('div', { style: 'margin-left:auto' }, [standoutRoundPicker])]));
  const standoutGrid = h('div', { class: 'grid grid-3' });
  wrap.appendChild(standoutGrid);
  function renderStandouts() {
    const standouts = standoutPerformances(player_game_log, team_games, { round: standoutRound, limit: 6 });
    standoutHeadSlot.innerHTML = '';
    standoutHeadSlot.appendChild(sectionHead(t('cc.standoutHead', { round: standoutRound }), { count: standouts.length }));
    standoutGrid.innerHTML = '';
    standouts.forEach(r => {
      const teamRow = team_season.find(x => x.team_code === r.Team);
      standoutGrid.appendChild(playerStandoutCard({ r, teamCode: teamRow ? teamRow.team_code : r.Team, onClick: () => navigate(`/player/${r.Player_ID}`) }));
    });
    if (!standouts.length) standoutGrid.appendChild(emptyStateStandouts());
  }
  function emptyStateStandouts() { return h('p', { style: 'font-size:12.5px;color:var(--ink-muted)' }, t('cc.noStandouts')); }
  renderStandouts();
  wrap.appendChild(h('div', { style: 'text-align:right;margin-top:6px;margin-bottom:8px' }, [
    h('button', { class: 'btn btn-ghost btn-sm', onclick: () => navigate('/standouts') }, t('cc.standoutsSeeAll')),
  ]));

  // ---------------- League leaders ----------------
  wrap.appendChild(sectionHead(t('cc.leagueLeaders')));
  const leaderStats = [
    { key: 'PTS', label: t('cc.catScoring') }, { key: 'TRB', label: t('cc.catRebounding') },
    { key: 'AST', label: t('cc.catAssists') }, { key: 'TS_PCT', label: statLabel('TS_PCT') },
  ];
  const leadersGrid = h('div', { class: 'grid grid-4' });
  leaderStats.forEach(ls => {
    const top5 = leaders(players, ls.key, { limit: 5 });
    if (!top5.length) return;
    const [first, ...restTop] = top5;
    leadersGrid.appendChild(leaderCard({
      label: `${ls.label} · ${t('cc.minGP', { n: qualGames })}`,
      leader: { name: titleCase(first.Player), sub: first.Team, code: first.Player_ID, value: first[ls.key], id: first.Player_ID },
      rest: restTop.map(p => ({ name: titleCase(p.Player), value: p[ls.key], id: p.Player_ID })),
      valueFmt: v => fmtStat(ls.key, v),
      onSelect: (item) => navigate(`/player/${item.id}`),
      onShowAll: () => navigate('/players'),
    }));
  });
  wrap.appendChild(leadersGrid);

  // ---------------- Team power rankings ----------------
  wrap.appendChild(sectionHead(t('cc.powerRankings'), { count: team_season.length, action: h('span', { class: 'sub', style: 'font-size:12px;color:var(--ink-muted);display:flex;align-items:center;gap:4px' }, [statLabel('NET_RTG'), infoIcon('NET_RTG')]) }));
  const ranked = team_season.slice().sort((a, b) => b.NET_RTG - a.NET_RTG);
  const topCode = ranked[0].team_code;
  wrap.appendChild(card([
    chartWithActions(hbarChart(ranked.map(tm => ({ label: tm.team_code, value: tm.NET_RTG })), {
      fmt: v => fmtSigned(v), highlightIndex: 0, color: 'var(--series-1)', width: 900,
    }), { filename: `euroleague_${state.season}_power_rankings.png`, question: t('cc.powerRankingsQuestion') }),
  ], {}));

  // ---------------- Form guide ----------------
  wrap.appendChild(sectionHead(t('cc.formGuide'), { count: team_season.length }));
  const formTable = dataTable(team_season, [
    { key: 'team_name', label: t('common.team'), align: 'left', primary: true, render: tm => {
      const link = h('span', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer', onclick: () => navigate(`/team/${tm.team_code}`) }, [
        teamChip(tm.team_name, tm.team_code),
      ]);
      return link;
    } },
    { key: 'wins', label: 'W-L', render: tm => `${tm.wins}–${tm.losses}` },
    { key: 'win_pct', label: 'Win%', render: tm => fmtPct(tm.win_pct) },
    { key: 'PPG', label: 'PPG', render: tm => fmtNum(tm.PPG) },
    { key: 'NET_RTG', label: 'NET', render: tm => fmtSigned(tm.NET_RTG) },
    { key: 'form', label: t('cc.last5'), sortable: false, render: tm => formPills(tm.last5_form) },
    { key: 'fav', label: '', sortable: false, render: tm => favStar(isFavoriteTeam(tm.team_code), (el) => { const on = toggleFavoriteTeam(tm.team_code); el.className = 'fav-star' + (on ? ' on' : ''); el.innerHTML = on ? '★' : '☆'; }) },
  ], { onRowClick: (tm) => navigate(`/team/${tm.team_code}`), initialSort: { key: 'win_pct', dir: 'desc' } });
  wrap.appendChild(formTable);
}
