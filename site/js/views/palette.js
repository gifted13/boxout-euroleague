// ============================================================================
// Global Command Palette (Cmd/Ctrl+K) — fuzzy search across teams, players,
// and app pages/actions, all in one place.
// ============================================================================

import { loadSeason, fuzzyMatch } from '../data.js';
import { h } from '../components.js';
import { titleCase } from '../format.js';
import { state } from '../state.js';
import { navigate } from '../router.js';
import { t as tt } from '../i18n.js';

function PAGES() {
  return [
    { label: tt('nav.home'), path: '/' }, { label: tt('nav.teams'), path: '/teams' },
    { label: tt('nav.players'), path: '/players' }, { label: tt('nav.standouts'), path: '/standouts' },
    { label: tt('nav.compare'), path: '/compare' },
    { label: tt('nav.explorer'), path: '/explorer' }, { label: tt('nav.lab'), path: '/lab' },
    { label: tt('nav.favorites'), path: '/favorites' },
  ];
}

export async function openCommandPaletteImpl() {
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } });
  const modal = h('div', { class: 'modal' });
  const input = h('input', { placeholder: tt('palette.searchPlaceholder'), autofocus: 'true' });
  modal.appendChild(h('div', { class: 'palette-input-row' }, [h('span', { style: 'color:var(--ink-muted)' }, '⌕'), input, h('kbd', { style: 'font-size:10.5px;border:1px solid var(--line);border-radius:4px;padding:2px 5px;color:var(--ink-muted)' }, 'ESC')]));
  const resultsEl = h('div', { class: 'palette-results' });
  modal.appendChild(resultsEl);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  setTimeout(() => input.focus(), 30);

  const season = await loadSeason(state.season).catch(() => null);
  const teamItems = season ? season.team_season.map(t => ({ type: 'Team', label: t.team_name, sub: `${t.wins}–${t.losses}`, action: () => navigate(`/team/${t.team_code}`) })) : [];
  const playerItems = season ? season.player_season.players.map(p => ({ type: 'Player', label: titleCase(p.Player), sub: p.Team, action: () => navigate(`/player/${p.Player_ID}`) })) : [];
  const pageItems = PAGES().map(p => ({ type: 'Page', label: p.label, sub: '', action: () => navigate(p.path) }));

  function renderResults(query) {
    resultsEl.innerHTML = '';
    let groups;
    if (!query) {
      groups = [{ label: tt('palette.pages'), items: pageItems }];
    } else {
      groups = [
        { label: tt('palette.pages'), items: pageItems.filter(i => fuzzyMatch(i.label, query)) },
        { label: tt('common.teams'), items: teamItems.filter(i => fuzzyMatch(i.label, query)).slice(0, 8) },
        { label: tt('common.players'), items: playerItems.filter(i => fuzzyMatch(i.label, query) || fuzzyMatch(i.sub, query)).slice(0, 8) },
      ];
    }
    let any = false;
    groups.forEach(g => {
      if (!g.items.length) return;
      any = true;
      resultsEl.appendChild(h('div', { class: 'palette-group-label' }, g.label));
      g.items.forEach(item => {
        const row = h('div', { class: 'palette-item', onclick: () => { item.action(); close(); } }, [
          h('span', {}, item.label),
          h('span', { class: 'meta' }, item.sub),
        ]);
        resultsEl.appendChild(row);
      });
    });
    if (!any) resultsEl.appendChild(h('div', { style: 'padding:20px;text-align:center;color:var(--ink-muted);font-size:13px' }, tt('common.noMatches')));
  }
  renderResults('');
  input.addEventListener('input', (e) => renderResults(e.target.value));
}
