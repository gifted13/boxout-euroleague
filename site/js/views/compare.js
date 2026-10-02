// ============================================================================
// Compare Center — player vs player, team vs team, and either vs. the
// league average. Query params (?type=player&a=ID&b=ID) let a profile page
// deep-link in with one side pre-filled.
// ============================================================================

import { loadSeason, mean, qualifiedPool } from '../data.js';
import { h, card, sectionHead, badge, emptyState, skeletonCard, comboSelect, chartLegend } from '../components.js';
import { radarChart } from '../charts.js';
import { fmtStat, statLabel, titleCase, STAT_META } from '../format.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

const PLAYER_STATS = ['PTS', 'TRB', 'AST', 'STL', 'BLK', 'TOV', 'FG_PCT', 'FG3_PCT', 'FT_PCT', 'TS_PCT', 'EFG_PCT', 'PTS_PER36', 'TRB_PER36', 'AST_PER36', 'VAL', 'MIN'];
const TEAM_STATS = ['PPG', 'ORtg', 'DRtg', 'NET_RTG', 'PACE', 'eFG', 'TOV_PCT', 'ORB_PCT', 'AST_PCT', 'FT_per_FGA', 'win_pct'];
const RADAR_PLAYER = ['PTS', 'TRB', 'AST', 'STL', 'BLK', 'TS_PCT'];
const RADAR_TEAM = ['ORtg', 'PACE', 'AST_PCT', 'ORB_PCT', 'eFG', 'NET_RTG'];

export async function renderCompare(root, query) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);
  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('compare.loadError'))); return; }

  let type = query.get('type') === 'team' ? 'team' : 'player';
  let idA = query.get('a') || '';
  let idB = query.get('b') || '';
  let vsLeague = query.get('vs') === 'league';

  wrap.appendChild(h('div', {}, [h('div', { class: 'eyebrow' }, tt('nav.compare')), h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:20px' }, tt('compare.headToHead'))]));

  const controls = h('div', { class: 'card', style: 'display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:20px' });
  wrap.appendChild(controls);
  const resultSlot = h('div');
  wrap.appendChild(resultSlot);

  function buildControls() {
    controls.innerHTML = '';
    const typeToggle = h('div', { class: 'season-toggle', style: 'width:180px' }, [
      h('button', { class: type === 'player' ? 'active' : '', onclick: () => { type = 'player'; idA = ''; idB = ''; buildControls(); } }, tt('common.players')),
      h('button', { class: type === 'team' ? 'active' : '', onclick: () => { type = 'team'; idA = ''; idB = ''; buildControls(); } }, tt('common.teams')),
    ]);
    const pool = type === 'player' ? qualifiedPool(season.player_season.players).slice().sort((a, b) => a.Player.localeCompare(b.Player)) : season.team_season.slice().sort((a, b) => a.team_name.localeCompare(b.team_name));
    const idKey = type === 'player' ? 'Player_ID' : 'team_code';
    const labelFn = type === 'player' ? p => `${titleCase(p.Player)} (${p.Team})` : tm => tm.team_name;

    function select(labelText, value, onChange, disabled) {
      const items = pool.map(x => ({ value: x[idKey], label: labelFn(x), sub: type === 'player' ? '' : `${x.wins}–${x.losses}` }));
      const picker = comboSelect({
        items, value, disabled,
        placeholder: type === 'player' ? tt('players.searchPlaceholder') : tt('teams.searchPlaceholder'),
        onChange,
      });
      return h('div', {}, [h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, labelText), picker]);
    }

    controls.appendChild(h('div', {}, [h('div', { class: 'eyebrow', style: 'margin-bottom:6px' }, tt('compare.compareLabel')), typeToggle]));
    controls.appendChild(select(tt('compare.entityA'), idA, (v) => { idA = v; renderResult(); }));
    controls.appendChild(select(tt('compare.entityB'), idB, (v) => { idB = v; vsLeague = false; renderResult(); }, vsLeague));
    controls.appendChild(h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-secondary);padding-bottom:9px' }, [
      h('input', { type: 'checkbox', checked: vsLeague ? 'true' : null, onchange: (e) => { vsLeague = e.target.checked; buildControls(); renderResult(); } }),
      tt('compare.vsLeagueAverage'),
    ]));
    renderResult();
  }

  function getEntity(id) {
    if (type === 'player') return season.player_season.players.find(p => p.Player_ID === id);
    return season.team_season.find(t => t.team_code === id);
  }
  function leagueAvgEntity() {
    const pool = type === 'player' ? qualifiedPool(season.player_season.players) : season.team_season;
    const stats = type === 'player' ? PLAYER_STATS : TEAM_STATS;
    const avg = { [type === 'player' ? 'Player' : 'team_name']: tt('compare.leagueAverage'), [type === 'player' ? 'Team' : 'team_code']: '—' };
    stats.forEach(s => { avg[s] = mean(pool.map(x => x[s]).filter(v => v != null)); });
    return avg;
  }

  function renderResult() {
    resultSlot.innerHTML = '';
    const a = getEntity(idA);
    const b = vsLeague ? leagueAvgEntity() : getEntity(idB);
    if (!a || !b) { resultSlot.appendChild(emptyState(tt('compare.pickTwo', { type: type === 'player' ? tt('common.players').toLowerCase() : tt('common.teams').toLowerCase() }))); setAIContext('Compare Center', { note: 'No comparison selected yet.' }); return; }
    const stats = type === 'player' ? PLAYER_STATS : TEAM_STATS;
    const radarKeys = type === 'player' ? RADAR_PLAYER : RADAR_TEAM;
    const nameA = type === 'player' ? titleCase(a.Player) : a.team_name;
    const nameB = type === 'player' ? titleCase(b.Player) : b.team_name;

    setAIContext(`Compare Center: ${nameA} vs ${nameB}`, {
      type, a: Object.fromEntries(['Player', 'team_name', 'Team', 'team_code', ...stats].filter(k => a[k] !== undefined).map(k => [k, a[k]])),
      b: Object.fromEntries(['Player', 'team_name', 'Team', 'team_code', ...stats].filter(k => b[k] !== undefined).map(k => [k, b[k]])),
    });

    const pool = type === 'player' ? qualifiedPool(season.player_season.players) : season.team_season;
    const axes = radarKeys.map(k => ({ key: k, label: STAT_META[k]?.short || k, max: Math.max(...pool.map(x => x[k] || 0), a[k] || 0, b[k] || 0) * 1.05 }));

    resultSlot.appendChild(h('div', { class: 'grid grid-2' }, [
      card([radarChart(axes, [
        { name: nameA, color: 'var(--series-1)', values: a },
        { name: nameB, color: 'var(--series-2)', values: b },
      ], { size: 320 }),
      chartLegend([{ label: nameA, color: 'var(--series-1)' }, { label: nameB, color: 'var(--series-2)' }]),
      ], { title: tt('compare.shapeComparison') }),
      card([
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, stats.map(s => {
          const meta = STAT_META[s] || {};
          const lib = meta.hib === false;
          const av = a[s], bv = b[s];
          const aWins = av == null || bv == null ? false : (lib ? av < bv : av > bv);
          const bWins = av == null || bv == null ? false : (lib ? bv < av : bv > av);
          return h('div', { style: 'display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--line)' }, [
            h('div', { style: `text-align:right;font-family:var(--font-data);font-weight:700;font-size:13px;color:${aWins ? 'var(--good)' : 'var(--ink)'}` }, fmtStat(s, av)),
            h('div', { style: 'font-size:10.5px;color:var(--ink-muted);text-align:center;min-width:90px' }, statLabel(s)),
            h('div', { style: `text-align:left;font-family:var(--font-data);font-weight:700;font-size:13px;color:${bWins ? 'var(--good)' : 'var(--ink)'}` }, fmtStat(s, bv)),
          ]);
        })),
      ], { title: tt('compare.statByStat'), sub: tt('compare.greenIsBetter') }),
    ]));
  }

  buildControls();
}
