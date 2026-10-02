// ============================================================================
// Reusable UI components — plain DOM builders (no framework). Every function
// returns a detached element you can append wherever needed.
// ============================================================================

import { STAT_META, fmtStat, statLabel, statDesc, statFormula, initials, hashColor, fmtSigned, fmtNum, fmtInt, titleCase } from './format.js';
import { fuzzyMatch } from './data.js';
import { teamGameSummary } from './insights.js';
import { t } from './i18n.js';

export function h(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== undefined && attrs[k] !== null) n.setAttribute(k, attrs[k]);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c === null || c === undefined || c === false) return;
    n.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(c) : c);
  });
  return n;
}

// ----------------------------------------------------------------------------
// Info tooltip (ⓘ) — the stat explanation system, usable on any stat anywhere.
// ----------------------------------------------------------------------------
let activePopover = null;
function closePopover() { if (activePopover) { activePopover.remove(); activePopover = null; } }
document.addEventListener('scroll', closePopover, true);
document.addEventListener('click', (e) => { if (activePopover && !e.target.closest('.popover') && !e.target.closest('.info-ic')) closePopover(); });
window.addEventListener('hashchange', closePopover);

export function infoIcon(statKey) {
  const meta = STAT_META[statKey];
  const ic = h('i', { class: 'info-ic', tabindex: '0', role: 'button', 'aria-label': `${t('common.about')} ${statLabel(statKey)}` }, 'i');
  const show = (ev) => {
    ev.stopPropagation();
    closePopover();
    if (!meta) return;
    const pop = h('div', { class: 'popover' }, [
      h('strong', {}, statLabel(statKey)),
      h('div', { style: 'margin-top:4px' }, statDesc(statKey)),
      statFormula(statKey) ? h('code', { class: 'formula' }, statFormula(statKey)) : null,
    ]);
    document.body.appendChild(pop);
    const r = ic.getBoundingClientRect();
    const pw = 280;
    let left = Math.min(r.left, window.innerWidth - pw - 16);
    left = Math.max(8, left);
    let top = r.bottom + 8;
    if (top + 120 > window.innerHeight) top = r.top - 8 - 100;
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    activePopover = pop;
  };
  ic.addEventListener('mouseenter', show);
  ic.addEventListener('click', show);
  ic.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') show(e); });
  ic.addEventListener('mouseleave', () => setTimeout(() => { if (activePopover && !activePopover.matches(':hover')) closePopover(); }, 250));
  return ic;
}

// ----------------------------------------------------------------------------
// Stat tile
// ----------------------------------------------------------------------------
export function statTile({ label, statKey, value, unit, delta, deltaGood, foot, onClick }) {
  const tile = h('div', { class: 'stat-tile' + (onClick ? '' : ''), onclick: onClick });
  if (onClick) tile.style.cursor = 'pointer';
  tile.appendChild(h('div', { class: 'label' }, [label || statLabel(statKey), statKey ? infoIcon(statKey) : null]));
  tile.appendChild(h('div', { class: 'value' }, [value, unit ? h('span', { class: 'unit' }, unit) : null]));
  if (delta !== undefined && delta !== null) {
    const up = deltaGood !== undefined ? deltaGood : delta >= 0;
    tile.appendChild(h('div', { class: 'delta ' + (up ? 'up' : 'down') }, `${up ? '▲' : '▼'} ${typeof delta === 'string' ? delta : fmtSigned(delta)}`));
  }
  if (foot) tile.appendChild(h('div', { class: 'foot' }, foot));
  return tile;
}

// ----------------------------------------------------------------------------
// Badges / chips / form pills / team chip / avatar
// ----------------------------------------------------------------------------
export function badge(text, tone = 'neutral') {
  return h('span', { class: `badge badge-${tone}` }, text);
}

export function formPills(form) {
  if (!form || !form.length) return h('span', { class: 'eyebrow' }, '—');
  return h('span', { class: 'form-pill-row' }, form.map(r => h('span', { class: 'form-pill ' + (r === 'W' ? 'w' : 'l') }, r)));
}

// ----------------------------------------------------------------------------
// Real team crest logos — bundled as static files (see the Artifact `files`
// map at publish time): logos/<code>.png, transparent-background PNGs, one
// per current EuroLeague club. Every other team-identity spot in the app
// (this file's team-dot/hashColor treatment, and hashColor(code) inline
// elsewhere) stays as the graceful fallback for a code that isn't one of
// these 20 clubs, or if the image itself fails to load — so a roster change
// or a code this season doesn't recognize never breaks a screen.
// ----------------------------------------------------------------------------
const TEAM_LOGO_CODES = new Set(['ASV', 'BAR', 'BAS', 'DUB', 'HTA', 'IST', 'MAD', 'MCO', 'MIL', 'MUN', 'OLY', 'PAM', 'PAN', 'PAR', 'PRS', 'RED', 'TEL', 'ULK', 'VIR', 'ZAL']);
export function hasTeamLogo(code) { return !!code && TEAM_LOGO_CODES.has(code); }
export function teamCrestImg(code, { size = 22, alt } = {}) {
  if (!hasTeamLogo(code)) return null;
  const img = h('img', {
    src: `logos/${code}.png`, alt: alt || code,
    style: `width:${size}px;height:${size}px;object-fit:contain;flex:none;display:block`,
  });
  // A code we believe has a logo can still fail to load (a bad publish, a
  // slow/offline fetch) — swap in the usual color dot rather than leaving a
  // broken-image icon.
  img.addEventListener('error', () => {
    const dot = h('span', { style: `width:${Math.round(size * 0.45)}px;height:${Math.round(size * 0.45)}px;border-radius:2px;background:${hashColor(code)};flex:none;display:inline-block` });
    img.replaceWith(dot);
  });
  return img;
}

export function teamChip(teamName, teamCode) {
  const crest = teamCrestImg(teamCode, { size: 16 });
  return h('span', { class: 'team-chip' }, [
    crest || h('span', { class: 'team-dot', style: `background:${hashColor(teamCode || teamName)}` }),
    teamName,
  ]);
}

// `color` overrides the deterministic hash color — used for a member whose
// account has a chosen avatarColor on file (see account.js/profile.js);
// omit it to keep the auto-derived color, as every non-account caller
// (players, trivia opponents, etc.) already does.
export function avatarInitial(name, size = 34, color = null) {
  const av = h('div', { class: 'avatar-initial' }, initials(name));
  av.style.background = color || hashColor(name);
  av.style.width = av.style.height = size + 'px';
  av.style.fontSize = Math.round(size * 0.38) + 'px';
  return av;
}

// ----------------------------------------------------------------------------
// Leader card — a stat category's top entity plus a short ranked list below
// it, echoing a broadcast "league leaders" module. `leader`/`rest` items:
// {name, sub, code, value}. `code` (a team code or player id) seeds the
// diagonal avatar color so the same entity always gets the same color.
// ----------------------------------------------------------------------------
export function leaderCard({ label, leader, rest = [], onSelect, onShowAll, valueFmt = v => v } = {}) {
  const c = h('div', { class: 'leader-card' });
  c.appendChild(h('div', { class: 'lc-label' }, label));
  if (leader) {
    const tint = hashColor(leader.code || leader.name);
    c.appendChild(h('div', { class: 'lc-leader', style: `--lc-tint:${tint}`, onclick: onSelect ? () => onSelect(leader) : null }, [
      h('div', { class: 'lc-avatar', style: `background:${tint}` }, initials(leader.name)),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { class: 'lc-name' }, leader.name),
        leader.sub ? h('div', { style: 'font-size:11px;color:var(--ink-muted)' }, leader.sub) : null,
      ]),
      h('div', { class: 'lc-value' }, valueFmt(leader.value)),
    ]));
  }
  rest.forEach((r, i) => {
    c.appendChild(h('div', { class: 'lc-row', onclick: onSelect ? () => onSelect(r) : null }, [
      h('span', { class: 'n' }, String(i + 2)),
      h('span', { class: 'nm' }, r.name),
      h('span', { class: 'v' }, valueFmt(r.value)),
    ]));
  });
  if (onShowAll) c.appendChild(h('div', { class: 'lc-foot', onclick: onShowAll }, t('common.showAll')));
  return c;
}

// ----------------------------------------------------------------------------
// Entity hero — diagonal color-block profile header for a team or player,
// standing in for a photo banner since everything here renders from data.
// ----------------------------------------------------------------------------
export function entityHero({ crestText, crestColor, crestLogo, name, meta, side, corner } = {}) {
  const hero = h('div', { class: 'entity-hero' });
  hero.appendChild(h('div', { class: 'topo-accent' }));
  const crestImg = teamCrestImg(crestLogo, { size: 46 });
  hero.appendChild(h('div', { class: 'crest', style: crestColor ? `color:${crestColor}` : '' }, crestImg || h('span', {}, crestText)));
  hero.appendChild(h('div', { class: 'eh-main' }, [
    h('div', { class: 'eh-name' }, name),
    meta ? h('div', { class: 'eh-meta' }, meta) : null,
  ]));
  // A small badge in the corner, standing in for the team crest that sits
  // beside a player's photo on the official site — a real crest when
  // `corner.logo` names a club we have one for, else the data-driven
  // color+initials fallback.
  if (corner) {
    const cornerImg = teamCrestImg(corner.logo, { size: 26 });
    hero.appendChild(h('div', { class: 'eh-corner-crest', style: cornerImg ? '' : `color:${corner.color || 'var(--accent-strong)'}` }, cornerImg || corner.text));
  }
  if (side) hero.appendChild(h('div', { class: 'eh-side' }, side));
  return hero;
}

// ----------------------------------------------------------------------------
// Chart legend — a row of colored-swatch + label pairs for any chart with
// 2+ series/entities that isn't already direct-labeled (radar comparisons,
// multi-series line charts). Per the dataviz mark spec: a legend is always
// present for 2+ series, none needed for a single one.
// ----------------------------------------------------------------------------
export function chartLegend(entries) {
  return h('div', { style: 'display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:8px;font-size:12px' },
    entries.map(e => h('span', { style: 'display:flex;align-items:center;gap:5px;min-width:0' }, [
      h('span', { style: `width:10px;height:10px;border-radius:2px;background:${e.color};display:inline-block;flex:none` }),
      h('span', { style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, e.label),
    ])));
}

// ----------------------------------------------------------------------------
// Fixture ticket — a single game card for the horizontal results/schedule
// strip. `teams`: [{code, name, score, win}] home then away.
// ----------------------------------------------------------------------------
export function ticketCard({ roundLabel, dateLabel, teams, onClick } = {}) {
  const c = h('div', { class: 'ticket-card', onclick: onClick, style: onClick ? 'cursor:pointer' : '' });
  c.appendChild(h('div', { class: 'tk-round' }, roundLabel));
  if (dateLabel) c.appendChild(h('div', { class: 'tk-date' }, dateLabel));
  teams.forEach(t => {
    const crest = teamCrestImg(t.code, { size: 16 });
    c.appendChild(h('div', { class: 'tk-team' }, [
      crest || h('span', { class: 'dot', style: `background:${hashColor(t.code || t.name)}` }),
      h('span', { class: 'code', style: t.win ? 'color:var(--ink)' : 'color:var(--ink-muted)' }, t.code || t.name),
      t.score !== undefined ? h('span', { style: `margin-left:auto;font-family:var(--font-data);font-weight:${t.win ? 800 : 600}` }, String(t.score)) : null,
    ]));
  });
  return c;
}

// ----------------------------------------------------------------------------
// Standout-performance cards — a single game's headline numbers. Player
// version keys off Valuation (PIR); team version off game margin. Shared by
// the Command Center and the Standouts page so both stay visually identical.
// ----------------------------------------------------------------------------
export function playerStandoutCard({ r, teamCode, onClick }) {
  const g = r.game;
  return h('div', { class: 'card card-tinted', style: `cursor:pointer;--tint:${hashColor(r.Team)}`, onclick: onClick }, [
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      avatarInitial(r.Player, 34),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { style: 'font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, titleCase(r.Player)),
        h('div', { style: 'font-size:11.5px;color:var(--ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, `${teamCode || r.Team}${g ? ' ' + t('common.vs') + ' ' + g.opponent : ''}`),
      ]),
      badge(fmtNum(r.Valuation, 0) + ' PIR', 'accent'),
    ]),
    h('hr', { class: 'hairline', style: 'margin:12px 0' }),
    h('div', { style: 'display:flex;gap:18px;font-family:var(--font-data)' }, [
      h('div', {}, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, 'PTS'), h('div', { style: 'font-weight:700;font-size:16px' }, fmtInt(r.Points))]),
      h('div', {}, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, 'REB'), h('div', { style: 'font-weight:700;font-size:16px' }, fmtInt(r.TotalRebounds))]),
      h('div', {}, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, 'AST'), h('div', { style: 'font-weight:700;font-size:16px' }, fmtInt(r.Assistances))]),
      g ? h('div', { style: 'margin-left:auto;text-align:right' }, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, g.win ? t('game.win') : t('game.loss')), h('div', { style: `font-weight:700;font-size:14px;color:${g.win ? 'var(--good)' : 'var(--critical)'}` }, `${g.team_score}–${g.opp_score}`)]) : null,
    ]),
  ]);
}

// Builds the "what happened in this game" recap line from the real boxscore
// log (see insights.js#teamGameSummary) — deterministic, not AI-written.
// `playerGameLog` is optional so any older call site that doesn't pass it
// just gets a card with no recap line, rather than an error.
function gameSummaryText(g, playerGameLog) {
  if (!playerGameLog) return null;
  const s = teamGameSummary(g, playerGameLog);
  if (!s) return null;
  const teamName = g.team_name || g.team;
  const oppName = g.opponent_name || g.opponent;
  const swingKeys = {
    reb: ['game.summaryRebWon', 'game.summaryRebLost'],
    ast: ['game.summaryAstWon', 'game.summaryAstLost'],
    tov: ['game.summaryTovWon', 'game.summaryTovLost'],
  };
  const [wonKey, lostKey] = swingKeys[s.swing.type];
  return [
    t('game.summaryTop', { name: titleCase(s.myTop.name), pts: fmtInt(s.myTop.pts) }),
    t('game.summaryOpp', { name: titleCase(s.oppTop.name), opp: oppName, pts: fmtInt(s.oppTop.pts) }),
    t(s.swing.favorable ? wonKey : lostKey, { team: teamName, mine: s.swing.mine, opp: s.swing.opp }),
  ].join(' ');
}

export function teamStandoutCard({ g, onClick, playerGameLog }) {
  const crest = teamCrestImg(g.team, { size: 22 });
  const summary = gameSummaryText(g, playerGameLog);
  return h('div', { class: 'card card-tinted', style: `cursor:pointer;--tint:${hashColor(g.team)}`, onclick: onClick }, [
    h('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      crest || h('span', { style: `width:10px;height:10px;border-radius:50%;flex:none;background:${hashColor(g.team)}` }),
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { style: 'font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, g.team_name || g.team),
        h('div', { style: 'font-size:11.5px;color:var(--ink-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, `${g.round_name || t('common.round', { n: g.round })} · ${g.home ? t('common.vs') : t('common.at')} ${g.opponent_name || g.opponent}`),
      ]),
      badge(fmtSigned(g.margin, 0), g.margin >= 0 ? 'good' : 'critical'),
    ]),
    h('hr', { class: 'hairline', style: 'margin:12px 0' }),
    h('div', { style: 'display:flex;gap:18px;font-family:var(--font-data);align-items:center' }, [
      h('div', {}, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, t('standouts.score')), h('div', { style: 'font-weight:700;font-size:16px' }, `${g.team_score}–${g.opp_score}`)]),
      h('div', { style: 'margin-left:auto;text-align:right' }, [h('div', { style: 'color:var(--ink-muted);font-size:10px' }, g.win ? t('game.win') : t('game.loss')), h('div', { style: `font-weight:700;font-size:14px;color:${g.win ? 'var(--good)' : 'var(--critical)'}` }, g.win ? '✓' : '✕')]),
    ]),
    summary ? h('p', { style: 'font-size:11.5px;color:var(--ink-secondary);line-height:1.5;margin-top:10px' }, summary) : null,
  ]);
}

export function favStar(isOn, onToggle) {
  const star = h('span', { class: 'fav-star' + (isOn ? ' on' : ''), html: isOn ? '★' : '☆', role: 'button', 'aria-label': t('common.toggleFavorite') });
  star.addEventListener('click', (e) => { e.stopPropagation(); onToggle(star); });
  return star;
}

// ----------------------------------------------------------------------------
// Sortable data table
// columns: [{key, label, statKey, fmt(row), align, sortFn, sticky}]
// ----------------------------------------------------------------------------
export function dataTable(rows, columns, { onRowClick, rankFrom, initialSort, scrollMax } = {}) {
  const wrap = h('div', { class: 'table-wrap' });
  if (scrollMax) { wrap.style.maxHeight = scrollMax + 'px'; wrap.style.overflowY = 'auto'; }
  const table = h('table', { class: 'dtable' });
  let sortKey = initialSort ? initialSort.key : null;
  let sortDir = initialSort ? initialSort.dir : 'desc';

  function render() {
    table.innerHTML = '';
    const thead = h('thead');
    const trh = h('tr');
    if (rankFrom !== undefined) trh.appendChild(h('th', {}, '#'));
    columns.forEach(col => {
      const th = h('th', {
        class: sortKey === col.key ? 'sorted' : '',
        style: col.align === 'left' ? 'text-align:left' : '',
        title: col.statKey ? statLabel(col.statKey) : null,
        onclick: col.sortable === false ? null : () => {
          if (sortKey === col.key) sortDir = sortDir === 'desc' ? 'asc' : 'desc';
          else { sortKey = col.key; sortDir = 'desc'; }
          render();
        },
      }, [col.label, col.statKey ? infoIcon(col.statKey) : null, sortKey === col.key ? h('span', { class: 'arrow' }, sortDir === 'desc' ? '↓' : '↑') : null]);
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    let sorted = rows.slice();
    if (sortKey) {
      const col = columns.find(c => c.key === sortKey);
      sorted.sort((a, b) => {
        const av = col.sortVal ? col.sortVal(a) : a[sortKey];
        const bv = col.sortVal ? col.sortVal(b) : b[sortKey];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return sortDir === 'desc' ? (bv > av ? 1 : -1) : (av > bv ? 1 : -1);
      });
    }
    const tbody = h('tbody');
    sorted.forEach((row, i) => {
      const tr = h('tr', { class: onRowClick ? 'clickable' : '', onclick: onRowClick ? () => onRowClick(row) : null });
      if (rankFrom !== undefined) tr.appendChild(h('td', { class: 'rank' }, String(i + rankFrom)));
      columns.forEach(col => {
        const td = h('td', { class: col.primary ? 'primary' : '', style: col.align === 'left' ? 'text-align:left' : '' });
        const content = col.render ? col.render(row) : (col.fmt ? col.fmt(row) : row[col.key]);
        if (content instanceof Node) td.appendChild(content); else td.textContent = content;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }
  render();
  wrap.appendChild(table);
  return wrap;
}

// ----------------------------------------------------------------------------
// Searchable combobox — a typeahead picker for choosing one entity out of a
// long list (players, teams). Replaces a plain <select>, which forces
// scanning an unsorted, unsearchable native list when there are 100+
// options. Type to filter (fuzzy, across label + sub); click or Enter to
// pick; Escape or an outside click closes it.
// items: [{value, label, sub}]
// ----------------------------------------------------------------------------
export function comboSelect({ items, value, onChange, placeholder = t('common.typeToSearch'), disabled = false }) {
  const wrap = h('div', { class: 'combo' + (disabled ? ' combo-disabled' : '') });
  const selected = items.find(i => i.value === value);
  const input = h('input', {
    class: 'combo-input',
    placeholder,
    value: selected ? selected.label : '',
    disabled: disabled ? 'true' : null,
    autocomplete: 'off',
  });
  const panel = h('div', { class: 'combo-panel' });
  panel.hidden = true;
  wrap.appendChild(input);
  wrap.appendChild(panel);

  let hlIndex = -1;
  let currentList = [];

  function renderPanel(query) {
    const q = (query || '').trim();
    currentList = (q ? items.filter(i => fuzzyMatch(i.label, q) || (i.sub && fuzzyMatch(i.sub, q))) : items).slice(0, 60);
    hlIndex = -1;
    panel.innerHTML = '';
    if (!currentList.length) { panel.appendChild(h('div', { class: 'combo-empty' }, t('common.noMatches'))); return; }
    currentList.forEach((item, i) => {
      const row = h('div', {
        class: 'palette-item combo-item',
        onmousedown: (e) => { e.preventDefault(); pick(item); },
      }, [h('span', {}, item.label), item.sub ? h('span', { class: 'meta' }, item.sub) : null]);
      panel.appendChild(row);
    });
    // Typing a query that narrows to a match should let Enter commit it
    // immediately, the way a search box normally works — so the top result
    // is highlighted by default whenever there's an active query.
    if (q) highlight(0);
  }
  function highlight(i) {
    const rows = panel.querySelectorAll('.combo-item');
    rows.forEach(r => r.classList.remove('hl'));
    if (i >= 0 && rows[i]) { rows[i].classList.add('hl'); rows[i].scrollIntoView({ block: 'nearest' }); }
    hlIndex = i;
  }
  function pick(item) {
    input.value = item.label;
    close();
    onChange(item.value);
  }
  function openPanel() {
    if (disabled) return;
    panel.hidden = false;
    wrap.classList.add('open');
    renderPanel(input.value === (selected ? selected.label : '') ? '' : input.value);
  }
  function close() { panel.hidden = true; wrap.classList.remove('open'); }

  input.addEventListener('focus', () => { input.select(); openPanel(); });
  input.addEventListener('input', () => renderPanel(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.blur(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); if (panel.hidden) openPanel(); highlight(Math.min(hlIndex + 1, currentList.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(hlIndex - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (hlIndex >= 0 && currentList[hlIndex]) pick(currentList[hlIndex]); }
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  return wrap;
}

// ----------------------------------------------------------------------------
// Cards / sections
// ----------------------------------------------------------------------------
export function card(children, { title, sub, flush } = {}) {
  const c = h('div', { class: 'card' + (flush ? ' card-flush' : '') });
  if (title) c.appendChild(h('div', { class: 'card-title-row' }, [h('h3', {}, title), sub ? h('span', { class: 'sub' }, sub) : null]));
  (Array.isArray(children) ? children : [children]).forEach(ch => ch && c.appendChild(ch));
  return c;
}

export function sectionHead(title, { count, action } = {}) {
  return h('div', { class: 'section-head' }, [
    h('h2', {}, title),
    count !== undefined && count !== null ? h('span', { class: 'count' }, String(count)) : null,
    h('span', { class: 'spacer' }),
    action || null,
  ]);
}

export function insightCard({ eyebrow, tone = 'neutral', title, body, sourceNote, chart, onExplore, season, shareable = true }) {
  const c = h('div', { class: 'insight-card' });
  c.appendChild(h('div', { class: 'kicker' }, [badge(eyebrow, tone)]));
  c.appendChild(h('h4', {}, title));
  if (chart) c.appendChild(chart);
  c.appendChild(h('div', { class: 'body-text' }, body));
  const foot = h('div', { class: 'source-note', style: 'display:flex;align-items:center;flex-wrap:wrap;gap:6px' }, [
    h('span', { style: 'min-width:0' }, sourceNote || ''),
  ]);
  if (shareable) {
    const shareBtn = h('button', {
      class: 'btn btn-ghost btn-sm', style: 'margin-left:auto', title: t('common.shareGraphicTitle'),
      onclick: async () => { const { openShareCard } = await import('./content-mode.js'); openShareCard({ eyebrow, title, body, sourceNote, season }); },
    }, '⌘ ' + t('common.share'));
    foot.appendChild(shareBtn);
  }
  if (onExplore) {
    const btn = h('button', { class: 'btn btn-ghost btn-sm', style: shareable ? '' : 'margin-left:auto', onclick: onExplore }, t('common.explore'));
    foot.appendChild(btn);
  }
  c.appendChild(foot);
  return c;
}

// ----------------------------------------------------------------------------
// Chart action toolbar — download PNG / ask AI about this chart. Wraps any
// chart element (an <svg> or a container div holding one) plus a small
// button row. Used on the highest-traffic charts (power rankings, radar
// comparisons, correlation scatter) as the reference implementation of the
// "rich chart interactions" requirement.
// ----------------------------------------------------------------------------
export function chartWithActions(chartEl, { filename = 'chart.png', question, contextLabel } = {}) {
  const wrap = h('div', {});
  wrap.appendChild(chartEl);
  const bar = h('div', { style: 'display:flex;gap:6px;margin-top:10px;justify-content:flex-end' });
  const svg = chartEl.tagName === 'svg' ? chartEl : chartEl.querySelector('svg');
  if (svg) {
    bar.appendChild(h('button', {
      class: 'btn btn-ghost btn-sm', title: t('common.downloadPng'),
      onclick: async () => { const { downloadSVGAsPNG } = await import('./export.js'); downloadSVGAsPNG(svg, filename); },
    }, '⤓ PNG'));
  }
  if (question) {
    bar.appendChild(h('button', {
      class: 'btn btn-ghost btn-sm', title: t('common.askAiAboutChart'),
      onclick: async () => {
        const { openAskAI } = await import('./views/ask-ai.js');
        openAskAI();
        setTimeout(() => {
          const input = document.querySelector('[data-ai-input]');
          if (input) { input.value = question; input.focus(); }
        }, 60);
      },
    }, '✦ ' + t('askai.trigger')));
  }
  wrap.appendChild(bar);
  return wrap;
}

// ----------------------------------------------------------------------------
// Tabs
// ----------------------------------------------------------------------------
export function tabs(items, activeKey, onChange) {
  const row = h('div', { class: 'tabs' });
  items.forEach(it => {
    const btn = h('button', { class: 'tab-btn' + (it.key === activeKey ? ' active' : ''), onclick: () => onChange(it.key) }, it.label);
    row.appendChild(btn);
  });
  return row;
}

// ----------------------------------------------------------------------------
// Chip filter row
// ----------------------------------------------------------------------------
export function chipFilter(options, activeSet, onToggle, { multi = true, accent = false } = {}) {
  const row = h('div', { class: 'chip-row' });
  options.forEach(opt => {
    const isActive = activeSet.has(opt.value);
    const chip = h('span', { class: 'chip' + (accent ? ' accent' : '') + (isActive ? ' active' : '') }, opt.label);
    // Toggle this chip's own look right from the tap, reading activeSet back
    // AFTER onToggle runs — onToggle may refuse the change (e.g. Data
    // Explorer won't drop the last remaining column), so this always
    // reflects what actually happened rather than assuming it took effect.
    chip.addEventListener('click', () => {
      onToggle(opt.value);
      chip.classList.toggle('active', activeSet.has(opt.value));
    });
    row.appendChild(chip);
  });
  return row;
}

// ----------------------------------------------------------------------------
// Loading / empty / error states
// ----------------------------------------------------------------------------
export function skeletonBlock(h1 = 16, w = '100%') {
  const b = h('div', { class: 'skel' });
  b.style.height = h1 + 'px';
  b.style.width = w;
  return b;
}
export function skeletonCard() {
  return h('div', { class: 'card' }, [
    skeletonBlock(12, '40%'),
    h('div', { style: 'height:12px' }),
    skeletonBlock(28, '70%'),
    h('div', { style: 'height:8px' }),
    skeletonBlock(10, '55%'),
  ]);
}
export function emptyState(text, icon = '□') {
  return h('div', { class: 'empty-state' }, [h('div', { class: 'ic' }, icon), h('h4', {}, text)]);
}
export function errorState(text, onRetry) {
  const st = h('div', { class: 'error-state' }, [h('div', { class: 'ic' }, '⚠'), h('h4', {}, text)]);
  if (onRetry) st.appendChild(h('button', { class: 'btn btn-sm', style: 'margin-top:8px', onclick: onRetry }, t('common.retry')));
  return st;
}

// ----------------------------------------------------------------------------
// Modal
// ----------------------------------------------------------------------------
export function openModal({ title, body, wide, footer, onClose }) {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const modal = h('div', { class: 'modal' + (wide ? ' modal-wide' : '') });
  if (title) modal.appendChild(h('div', { class: 'modal-header' }, [h('h3', {}, title), h('span', { style: 'margin-left:auto' }), h('button', { class: 'btn btn-icon btn-ghost', onclick: () => close() }, '✕')]));
  const bodyWrap = h('div', { class: 'modal-body' });
  (Array.isArray(body) ? body : [body]).forEach(b => bodyWrap.appendChild(b));
  modal.appendChild(bodyWrap);
  if (footer) modal.appendChild(h('div', { class: 'modal-foot' }, footer));
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); if (onClose) onClose(); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  return { close, overlay, modal };
}

// ----------------------------------------------------------------------------
// Toast
// ----------------------------------------------------------------------------
let toastStack = null;
export function toast(msg) {
  if (!toastStack) { toastStack = h('div', { class: 'toast-stack' }); document.body.appendChild(toastStack); }
  const t = h('div', { class: 'toast' }, msg);
  toastStack.appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s ease'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 2400);
}
