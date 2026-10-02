// ============================================================================
// Favorites — quick access to starred teams and players.
// ============================================================================

import { loadSeason } from '../data.js';
import { h, sectionHead, dataTable, formPills, favStar, emptyState, skeletonCard, avatarInitial, badge, toast } from '../components.js';
import { fmtNum, fmtPct, fmtSigned, titleCase, fmtDate } from '../format.js';
import { state, toggleFavoriteTeam, toggleFavoritePlayer, runSavedView, removeSavedView } from '../state.js';
import { navigate } from '../router.js';
import { t as tt } from '../i18n.js';

export async function renderFavorites(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);
  const season = await loadSeason(state.season).catch(() => null);
  wrap.innerHTML = '';
  if (!season) { wrap.appendChild(emptyState(tt('favorites.loadError'))); return; }

  wrap.appendChild(h('div', {}, [h('div', { class: 'eyebrow' }, tt('favorites.eyebrow')), h('h1', { style: 'font-size:24px;margin-top:4px;margin-bottom:20px' }, tt('nav.favorites'))]));

  const favTeams = season.team_season.filter(t => state.favorites.teams.has(t.team_code));
  const favPlayers = season.player_season.players.filter(p => state.favorites.players.has(p.Player_ID));

  wrap.appendChild(sectionHead(tt('common.teams'), { count: favTeams.length }));
  if (favTeams.length) {
    wrap.appendChild(dataTable(favTeams, [
      { key: 'team_name', label: tt('common.team'), align: 'left', primary: true },
      { key: 'wins', label: 'W-L', render: t => `${t.wins}–${t.losses}` },
      { key: 'NET_RTG', label: 'NET', render: t => fmtSigned(t.NET_RTG) },
      { key: 'form', label: tt('cc.last5'), sortable: false, render: t => formPills(t.last5_form) },
      { key: 'fav', label: '', sortable: false, render: t => { const s = favStar(true, (elm) => { toggleFavoriteTeam(t.team_code); renderFavorites(root); }); return s; } },
    ], { onRowClick: (t) => navigate(`/team/${t.team_code}`) }));
  } else {
    wrap.appendChild(emptyState(tt('favorites.noTeams')));
  }

  wrap.appendChild(sectionHead(tt('common.players'), { count: favPlayers.length }));
  if (favPlayers.length) {
    wrap.appendChild(dataTable(favPlayers, [
      { key: 'Player', label: tt('common.player'), align: 'left', primary: true, render: p => h('span', { style: 'display:flex;align-items:center;gap:8px' }, [avatarInitial(p.Player, 24), titleCase(p.Player)]) },
      { key: 'Team', label: tt('common.team') },
      { key: 'PTS', label: 'PTS', render: p => fmtNum(p.PTS) },
      { key: 'VAL', label: 'PIR', render: p => fmtNum(p.VAL) },
      { key: 'fav', label: '', sortable: false, render: p => favStar(true, () => { toggleFavoritePlayer(p.Player_ID); renderFavorites(root); }) },
    ], { onRowClick: (p) => navigate(`/player/${p.Player_ID}`) }));
  } else {
    wrap.appendChild(emptyState(tt('favorites.noPlayers')));
  }

  wrap.appendChild(sectionHead(tt('favorites.savedViews'), { count: state.savedViews.length, action: h('span', { class: 'sub', style: 'font-size:11.5px;color:var(--ink-muted)' }, tt('favorites.reRunLive')) }));
  if (state.savedViews.length) {
    wrap.appendChild(h('div', { style: 'display:flex;flex-direction:column;gap:8px' }, state.savedViews.slice().sort((a, b) => b.createdAt - a.createdAt).map(v =>
      h('div', { class: 'card', style: 'display:flex;align-items:center;gap:12px;padding:14px 16px' }, [
        badge(v.type === 'explorer' ? tt('favorites.explorerType') : v.type, 'accent'),
        h('div', { style: 'flex:1;min-width:0' }, [
          h('div', { style: 'font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, v.name),
          h('div', { style: 'font-size:11.5px;color:var(--ink-muted);margin-top:2px' }, tt('favorites.savedOn', { date: fmtDate(v.createdAt) })),
        ]),
        h('button', { class: 'btn btn-sm', onclick: () => runSavedView(v) }, tt('common.run')),
        h('button', { class: 'btn btn-sm btn-ghost', onclick: () => { removeSavedView(v.id); toast(tt('favorites.deletedToast', { name: v.name })); renderFavorites(root); } }, '✕'),
      ])
    )));
  } else {
    wrap.appendChild(emptyState(tt('favorites.noSavedViews')));
  }
}
