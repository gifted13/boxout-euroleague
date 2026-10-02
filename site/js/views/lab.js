// ============================================================================
// Analytics Lab — systematic, on-demand search of the dataset for outliers,
// correlations and story lines. Every result shows its backing data (z-score,
// r-value, raw stat) — nothing here is a canned statement.
// ============================================================================

import { loadSeason, zscore, pearson, mean, qualifiedPool } from '../data.js';
import { currentStreaks } from '../insights.js';
import { h, card, sectionHead, badge, emptyState, skeletonCard, chartWithActions } from '../components.js';
import { hbarChart, scatterChart } from '../charts.js';
import { fmtStat, statLabel, titleCase, STAT_META } from '../format.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

const TEAM_STATS = ['PPG', 'ORtg', 'DRtg', 'NET_RTG', 'PACE', 'eFG', 'TOV_PCT', 'FT_per_FGA', 'ORB_PCT', 'AST_PCT', 'FG3_PCT', 'FT_PCT', 'OPP_TOV_PCT', 'OPP_EFG'];
const PLAYER_STATS = ['PTS', 'TRB', 'AST', 'STL', 'BLK', 'TOV', 'TS_PCT', 'EFG_PCT', 'VAL', 'PTS_PER36'];

export async function renderLab(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);
  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('lab.loadError'))); return; }

  wrap.appendChild(h('div', {}, [h('div', { class: 'eyebrow' }, tt('nav.lab')), h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:6px' }, tt('lab.title')), h('p', { style: 'font-size:13px;color:var(--ink-muted);margin-bottom:24px' }, tt('lab.subtitle'))]));

  const streaksForAI = [...currentStreaks(season.team_games).entries()].map(([code, v]) => ({ team: code, ...v })).filter(s => s.streak >= 2);
  let lastScanner = null, lastCorr = null;
  function updateLabAIContext() {
    setAIContext('Analytics Lab', { outlier_scan: lastScanner, correlation: lastCorr, active_streaks: streaksForAI });
  }

  // ---------------- Outlier Scanner ----------------
  wrap.appendChild(sectionHead(tt('lab.outlierScanner')));
  const scanCard = h('div', { class: 'card' });
  wrap.appendChild(scanCard);
  let scanDataset = 'teams';
  let scanStat = 'NET_RTG';
  function buildScanner() {
    scanCard.innerHTML = '';
    const statList = scanDataset === 'teams' ? TEAM_STATS : PLAYER_STATS;
    if (!statList.includes(scanStat)) scanStat = statList[0];
    scanCard.appendChild(h('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:16px' }, [
      h('div', { class: 'season-toggle', style: 'width:160px' }, [
        h('button', { class: scanDataset === 'teams' ? 'active' : '', onclick: () => { scanDataset = 'teams'; buildScanner(); } }, tt('common.teams')),
        h('button', { class: scanDataset === 'players' ? 'active' : '', onclick: () => { scanDataset = 'players'; buildScanner(); } }, tt('common.players')),
      ]),
      h('select', {
        style: 'padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px',
        onchange: (e) => { scanStat = e.target.value; buildScanner(); },
      }, statList.map(s => h('option', { value: s, selected: s === scanStat ? 'true' : null }, statLabel(s)))),
    ]));
    const pool = scanDataset === 'teams' ? season.team_season : qualifiedPool(season.player_season.players);
    const nameKey = scanDataset === 'teams' ? 'team_name' : 'Player';
    const withZ = pool.map(r => ({ ...r, z: zscore(pool, scanStat, r[scanStat]) })).filter(r => !Number.isNaN(r.z));
    const sorted = withZ.slice().sort((a, b) => b.z - a.z);
    const top = sorted.slice(0, 6);
    const bottom = sorted.slice(-6).reverse();
    scanCard.appendChild(h('div', { class: 'grid grid-2' }, [
      h('div', {}, [
        h('div', { style: 'font-size:11.5px;font-weight:700;color:var(--good);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em' }, tt('lab.highestStat', { stat: statLabel(scanStat) })),
        hbarChart(top.map(r => ({ label: scanDataset === 'teams' ? r.team_code : titleCase(r[nameKey]).split(' ').pop(), value: r[scanStat] })), { fmt: v => fmtStat(scanStat, v), color: 'var(--good)', width: 440 }),
      ]),
      h('div', {}, [
        h('div', { style: 'font-size:11.5px;font-weight:700;color:var(--critical);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em' }, tt('lab.lowestStat', { stat: statLabel(scanStat) })),
        hbarChart(bottom.map(r => ({ label: scanDataset === 'teams' ? r.team_code : titleCase(r[nameKey]).split(' ').pop(), value: r[scanStat] })), { fmt: v => fmtStat(scanStat, v), color: 'var(--critical)', width: 440 }),
      ]),
    ]));
    scanCard.appendChild(h('p', { style: 'font-size:11.5px;color:var(--ink-muted);margin-top:14px' }, tt('lab.zScoreFooter', {
      n: pool.length,
      group: scanDataset === 'teams' ? tt('lab.groupTeams') : tt('lab.groupQualifiedPlayers'),
      topOutlier: top[0] ? tt('lab.topOutlier', { name: scanDataset === 'teams' ? top[0].team_name : titleCase(top[0].Player), z: top[0].z.toFixed(2) }) : '',
    })));
    lastScanner = {
      dataset: scanDataset, stat: statLabel(scanStat),
      highest: top.map(r => ({ name: scanDataset === 'teams' ? r.team_name : titleCase(r.Player), value: r[scanStat], z: +r.z.toFixed(2) })),
      lowest: bottom.map(r => ({ name: scanDataset === 'teams' ? r.team_name : titleCase(r.Player), value: r[scanStat], z: +r.z.toFixed(2) })),
    };
    updateLabAIContext();
  }
  buildScanner();

  // ---------------- Correlation Finder ----------------
  wrap.appendChild(sectionHead(tt('lab.correlationFinder'), { count: null, action: h('span', { class: 'sub', style: 'font-size:11.5px;color:var(--ink-muted)' }, tt('lab.teamLevelThisSeason')) }));
  const corrCard = h('div', { class: 'card' });
  wrap.appendChild(corrCard);
  let xKey = 'PACE', yKey = 'ORtg';
  function buildCorrelation() {
    corrCard.innerHTML = '';
    corrCard.appendChild(h('div', { style: 'display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:16px' }, [
      h('select', { style: 'padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px', onchange: (e) => { xKey = e.target.value; buildCorrelation(); } }, TEAM_STATS.map(s => h('option', { value: s, selected: s === xKey ? 'true' : null }, statLabel(s)))),
      h('span', { style: 'color:var(--ink-muted)' }, tt('common.vs') + '.'),
      h('select', { style: 'padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px', onchange: (e) => { yKey = e.target.value; buildCorrelation(); } }, TEAM_STATS.map(s => h('option', { value: s, selected: s === yKey ? 'true' : null }, statLabel(s)))),
    ]));
    const r = pearson(season.team_season, xKey, yKey);
    const strength = r === null ? '' : Math.abs(r) >= 0.7 ? tt('lab.strengthStrong') : Math.abs(r) >= 0.4 ? tt('lab.strengthModerate') : Math.abs(r) >= 0.2 ? tt('lab.strengthWeak') : tt('lab.strengthNone');
    const direction = r > 0 ? tt('lab.directionPositive') : tt('lab.directionNegative');
    corrCard.appendChild(h('div', { style: 'display:flex;align-items:center;gap:16px;margin-bottom:14px' }, [
      h('div', { style: 'font-family:var(--font-data);font-size:32px;font-weight:800' }, r === null ? '—' : r.toFixed(2)),
      h('div', { style: 'font-size:13px;color:var(--ink-secondary)' }, r === null ? tt('lab.notEnoughData') : tt('lab.correlationSentence', { statX: statLabel(xKey), statY: statLabel(yKey), strength, direction: r !== 0 ? direction : '', n: season.team_season.length })),
    ]));
    corrCard.appendChild(chartWithActions(scatterChart(season.team_season.map(t => ({ x: t[xKey], y: t[yKey], label: t.team_code })), {
      xLabel: statLabel(xKey), yLabel: statLabel(yKey), xFmt: v => fmtStat(xKey, v), yFmt: v => fmtStat(yKey, v), width: 700, height: 320,
    }), { filename: `euroleague_correlation_${xKey}_${yKey}.png`, question: tt('lab.correlationQuestion', { statX: statLabel(xKey), statY: statLabel(yKey), r: r === null ? 'n/a' : r.toFixed(2) }) }));
    lastCorr = { x: statLabel(xKey), y: statLabel(yKey), r: r === null ? null : +r.toFixed(3), teams_n: season.team_season.length };
    updateLabAIContext();
  }
  buildCorrelation();

  // ---------------- Story lines: full streak board ----------------
  wrap.appendChild(sectionHead(tt('lab.activeStreaksLeagueWide')));
  const streaks = [...currentStreaks(season.team_games).entries()].map(([code, v]) => ({ code, ...v })).filter(s => s.streak >= 2).sort((a, b) => (b.kind ? b.streak : -b.streak) - (a.kind ? a.streak : -a.streak));
  if (streaks.length) {
    wrap.appendChild(card([
      h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, streaks.map(s => {
        const tm = season.team_season.find(x => x.team_code === s.code);
        return h('div', { style: 'display:flex;align-items:center;gap:10px;cursor:pointer', onclick: () => navigate(`/team/${s.code}`) }, [
          badge(`${s.streak}${s.kind ? 'W' : 'L'}`, s.kind ? 'good' : 'critical'),
          h('span', { style: 'font-size:13px;font-weight:600' }, tm ? tm.team_name : s.code),
          h('span', { style: 'margin-left:auto;font-size:11.5px;color:var(--ink-muted)' }, `${tm.wins}–${tm.losses}`),
        ]);
      })),
    ]));
  } else {
    wrap.appendChild(emptyState(tt('lab.noActiveStreaks')));
  }
}
