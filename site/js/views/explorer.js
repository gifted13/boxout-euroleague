// ============================================================================
// Data Explorer — a no-code builder for custom tables/rankings over the team
// or player datasets: pick columns, filter, sort, view as table or bar chart,
// export. Every field shown here maps 1:1 to a column in the processed data.
// ============================================================================

import { loadSeason, SEASON_LABELS } from '../data.js';
import { h, card, dataTable, emptyState, skeletonCard, chipFilter, openModal, toast } from '../components.js';
import { hbarChart } from '../charts.js';
import { fmtStat, statLabel, titleCase, STAT_META } from '../format.js';
import { state, addSavedView, consumePendingView } from '../state.js';
import { navigate } from '../router.js';
import { downloadCSV, downloadXLSX, downloadJSON } from '../export.js';
import { setAIContext } from '../ai-context.js';
import { t as tt } from '../i18n.js';

const TEAM_COLS = ['team_name', 'wins', 'losses', 'win_pct', 'PPG', 'ORtg', 'DRtg', 'NET_RTG', 'PACE', 'eFG', 'TOV_PCT', 'ORB_PCT', 'AST_PCT', 'FT_per_FGA', 'FG3_PCT', 'FT_PCT'];
const PLAYER_COLS = ['Player', 'Team', 'GP', 'MIN', 'PTS', 'TRB', 'AST', 'STL', 'BLK', 'TOV', 'FG_PCT', 'FG3_PCT', 'FT_PCT', 'TS_PCT', 'EFG_PCT', 'PTS_PER36', 'VAL'];

export async function renderExplorer(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);
  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('explorer.loadError'))); return; }

  wrap.appendChild(h('div', {}, [h('div', { class: 'eyebrow' }, tt('nav.explorer')), h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:6px' }, tt('explorer.title')), h('p', { style: 'font-size:13px;color:var(--ink-muted);margin-bottom:20px' }, tt('explorer.subtitle'))]));

  let dataset = 'players';
  let cols = new Set(['Player', 'Team', 'GP', 'PTS', 'TRB', 'AST', 'VAL']);
  let sortKey = 'PTS';
  // Off by default — same reasoning as the Players page: early in a season
  // qualifier_games sits at its floor (8) while every player has GP=1, so a
  // default-on qualified filter silently produces a zero-row table.
  let qualifiedOnly = false;
  let search = '';
  let viewMode = 'table';

  // A saved view handed off from Favorites re-runs live against the CURRENT
  // dataset — it restores the query config, not a snapshot of old numbers.
  const pending = consumePendingView('explorer');
  if (pending && pending.config) {
    const c = pending.config;
    if (c.dataset) dataset = c.dataset;
    if (Array.isArray(c.cols) && c.cols.length) cols = new Set(c.cols);
    if (c.sortKey) sortKey = c.sortKey;
    if (typeof c.qualifiedOnly === 'boolean') qualifiedOnly = c.qualifiedOnly;
    if (typeof c.search === 'string') search = c.search;
    if (c.viewMode) viewMode = c.viewMode;
    toast(tt('explorer.loadedView', { name: pending.name }));
  }

  const controls = h('div', { class: 'card', style: 'margin-bottom:20px;display:flex;flex-direction:column;gap:14px' });
  wrap.appendChild(controls);
  const resultSlot = h('div');
  wrap.appendChild(resultSlot);

  function availableCols() { return dataset === 'players' ? PLAYER_COLS : TEAM_COLS; }
  function baseRows() {
    if (dataset === 'players') {
      let rows = season.player_season.players;
      if (qualifiedOnly) rows = rows.filter(p => p.qualified);
      if (search) rows = rows.filter(p => p.Player.toLowerCase().includes(search.toLowerCase()) || p.Team.toLowerCase().includes(search.toLowerCase()));
      return rows;
    }
    let rows = season.team_season;
    if (search) rows = rows.filter(t => t.team_name.toLowerCase().includes(search.toLowerCase()));
    return rows;
  }

  function buildControls() {
    controls.innerHTML = '';
    controls.appendChild(h('div', { style: 'display:flex;gap:20px;flex-wrap:wrap;align-items:center' }, [
      h('div', { class: 'season-toggle', style: 'width:200px' }, [
        h('button', { class: dataset === 'players' ? 'active' : '', onclick: () => { dataset = 'players'; cols = new Set(['Player', 'Team', 'GP', 'PTS', 'TRB', 'AST', 'VAL']); sortKey = 'PTS'; render(); } }, tt('common.players')),
        h('button', { class: dataset === 'teams' ? 'active' : '', onclick: () => { dataset = 'teams'; cols = new Set(['team_name', 'wins', 'losses', 'PPG', 'NET_RTG']); sortKey = 'NET_RTG'; render(); } }, tt('common.teams')),
      ]),
      h('input', { placeholder: tt('explorer.filterByName'), style: 'padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px;min-width:200px', oninput: (e) => { search = e.target.value; renderResult(); } }),
      dataset === 'players' ? h('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--ink-secondary)' }, [
        h('input', { type: 'checkbox', checked: qualifiedOnly ? 'true' : null, onchange: (e) => { qualifiedOnly = e.target.checked; renderResult(); } }), tt('players.qualifiedOnly', { n: season.player_season.qualifier_games }),
      ]) : null,
      h('div', { class: 'season-toggle', style: 'width:160px;margin-left:auto' }, [
        h('button', { class: viewMode === 'table' ? 'active' : '', onclick: () => { viewMode = 'table'; renderResult(); } }, tt('explorer.table')),
        h('button', { class: viewMode === 'chart' ? 'active' : '', onclick: () => { viewMode = 'chart'; renderResult(); } }, tt('explorer.chart')),
      ]),
      h('button', { class: 'btn btn-sm', onclick: exportCSV }, '⤓ CSV'),
      h('button', { class: 'btn btn-sm', onclick: exportXLSX }, '⤓ Excel'),
      h('button', { class: 'btn btn-sm', onclick: exportJSON }, '⤓ JSON'),
      h('button', { class: 'btn btn-sm btn-ghost', onclick: openSaveViewModal }, '💾 ' + tt('explorer.saveView')),
    ]));
    controls.appendChild(h('div', {}, [
      h('div', { class: 'eyebrow', style: 'margin-bottom:8px' }, tt('explorer.columns')),
      chipFilter(availableCols().map(c => ({ value: c, label: statLabel(c) === c ? (c === 'Player' ? tt('common.player') : c === 'Team' || c === 'team_name' ? tt('common.team') : c) : statLabel(c) })), cols, (v) => {
        if (cols.has(v)) { if (cols.size > 1) cols.delete(v); } else cols.add(v);
        renderResult();
      }, { accent: true }),
    ]));
  }

  function exportHeadersAndRows() {
    const activeCols = availableCols().filter(c => cols.has(c));
    const rows = sortedRows();
    return { headers: activeCols.map(c => statLabel(c) === c ? c : statLabel(c)), body: rows.map(r => activeCols.map(c => r[c])), activeCols, rows };
  }
  function exportCSV() {
    const { headers, body } = exportHeadersAndRows();
    downloadCSV(`euroleague_${dataset}_${state.season}.csv`, headers, body);
  }
  function exportXLSX() {
    const { headers, body } = exportHeadersAndRows();
    downloadXLSX(`euroleague_${dataset}_${state.season}.xlsx`, `${dataset}_${state.season}`, headers, body);
  }
  function exportJSON() {
    const { activeCols, rows } = exportHeadersAndRows();
    downloadJSON(`euroleague_${dataset}_${state.season}.json`, rows.map(r => Object.fromEntries(activeCols.map(c => [c, r[c]]))));
  }

  function openSaveViewModal() {
    const input = h('input', {
      placeholder: tt('explorer.saveViewPlaceholder', { season: SEASON_LABELS[state.season] }),
      style: 'width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13px',
    });
    const { close } = openModal({
      title: tt('explorer.saveThisView'),
      body: [
        h('p', { style: 'font-size:12.5px;color:var(--ink-muted);margin-bottom:12px' }, tt('explorer.saveViewNote')),
        input,
      ],
      footer: [
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => close() }, tt('common.cancel')),
        h('button', { class: 'btn btn-sm btn-primary', onclick: () => {
          const name = input.value.trim();
          if (!name) { input.focus(); return; }
          addSavedView({
            type: 'explorer',
            path: '/explorer',
            name,
            config: { dataset, cols: [...cols], sortKey, qualifiedOnly, search, viewMode },
          });
          close();
          toast(tt('explorer.savedViewToast', { name }));
        } }, tt('common.save')),
      ],
    });
    setTimeout(() => input.focus(), 0);
  }

  function sortedRows() {
    return baseRows().slice().sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return av.localeCompare(bv);
      return (bv ?? -Infinity) - (av ?? -Infinity);
    });
  }

  function renderResult() {
    resultSlot.innerHTML = '';
    const activeCols = availableCols().filter(c => cols.has(c));
    if (!activeCols.length) { resultSlot.appendChild(emptyState(tt('explorer.pickColumn'))); return; }
    const rows = sortedRows();
    if (viewMode === 'table') {
      resultSlot.appendChild(dataTable(rows, activeCols.map(c => ({
        key: c,
        label: c === 'Player' ? tt('common.player') : c === 'Team' || c === 'team_name' ? tt('common.team') : statLabel(c),
        statKey: STAT_META[c] ? c : undefined,
        align: (c === 'Player' || c === 'Team' || c === 'team_name') ? 'left' : undefined,
        primary: c === 'Player' || c === 'team_name',
        render: r => {
          if (c === 'Player') return titleCase(r.Player);
          if (STAT_META[c]) return fmtStat(c, r[c]);
          return r[c];
        },
      })), {
        onRowClick: dataset === 'players' ? (r) => navigate(`/player/${r.Player_ID}`) : (r) => navigate(`/team/${r.team_code}`),
        initialSort: { key: sortKey, dir: 'desc' },
        rankFrom: 1,
        scrollMax: 640,
      }));
    } else {
      const metricCol = activeCols.find(c => STAT_META[c]) || sortKey;
      const nameKey = dataset === 'players' ? 'Player' : 'team_name';
      resultSlot.appendChild(card([hbarChart(rows.slice(0, 20).map(r => ({ label: dataset === 'players' ? titleCase(r[nameKey]).split(' ').pop() : r.team_code, value: r[metricCol] || 0 })), { fmt: v => fmtStat(metricCol, v), width: 900 })], { title: tt('explorer.top20By', { stat: statLabel(metricCol) }) }));
    }
    setAIContext(`Data Explorer: custom ${dataset} table`, {
      dataset, columns: activeCols, sorted_by: sortKey, row_count: rows.length,
      top_15_rows: rows.slice(0, 15).map(r => Object.fromEntries(activeCols.map(c => [c, r[c]]))),
    });
  }

  function render() { buildControls(); renderResult(); }
  render();
}
