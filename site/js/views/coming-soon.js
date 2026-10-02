// ============================================================================
// Season "coming soon" screen — shown for a season whose fixture list has
// been published but hasn't tipped off yet (see SEASON_START_DATES in
// data.js). There are no stats to compute yet, so every other route renders
// this instead of an empty/broken stat page. Shows the countdown, the
// confirmed start date, and the full round-by-round schedule (via the
// shared browser in schedule.js) — that same component starts showing
// scores automatically once a future republish fills in this season's
// results, so nothing here needs to change when the season actually starts.
// ============================================================================

import { loadSeason, SEASON_LABELS, SEASON_START_DATES, SEASONS, isUpcomingSeason } from '../data.js';
import { h, sectionHead, emptyState, skeletonCard } from '../components.js';
import { renderRoundSchedule } from './schedule.js';
import { state, setSeason } from '../state.js';
import { fmtDate } from '../format.js';
import { t } from '../i18n.js';

export async function renderSeasonComingSoon(root) {
  root.innerHTML = '';
  const wrap = h('div', { class: 'content-narrow' });
  wrap.appendChild(skeletonCard());
  root.appendChild(wrap);

  const season = state.season;
  const startDateStr = SEASON_START_DATES[season];
  const startMs = new Date(startDateStr + 'T00:00:00Z').getTime();
  const daysLeft = Math.max(0, Math.ceil((startMs - Date.now()) / 86400000));

  const scheduleData = await loadSeason(season).catch(() => null);
  wrap.innerHTML = '';

  wrap.appendChild(h('div', { style: 'text-align:center;padding:48px 16px 32px' }, [
    h('div', { class: 'eyebrow' }, `EuroLeague ${SEASON_LABELS[season]}`),
    h('div', { style: 'font-size:56px;font-weight:800;font-family:var(--font-data);margin-top:14px;line-height:1' }, String(daysLeft)),
    h('h1', { style: 'font-size:22px;margin-top:8px;margin-bottom:8px' }, t('comingSoon.title', { season: SEASON_LABELS[season] })),
    h('p', { style: 'font-size:13.5px;color:var(--ink-muted);max-width:460px;margin:0 auto' }, t('comingSoon.subtitle', { date: fmtDate(startMs) })),
    (() => {
      const fallback = SEASONS.find(s => !isUpcomingSeason(s));
      if (fallback == null) return null;
      return h('button', {
        class: 'btn btn-primary btn-sm', style: 'margin-top:20px',
        onclick: () => { setSeason(fallback); window.dispatchEvent(new Event('hashchange')); },
      }, t('comingSoon.viewCurrent', { season: SEASON_LABELS[fallback] }));
    })(),
  ]));

  const games = (scheduleData && Array.isArray(scheduleData.schedule)) ? scheduleData.schedule : [];
  if (!games.length) {
    wrap.appendChild(emptyState(t('comingSoon.noSchedule')));
    return;
  }

  wrap.appendChild(sectionHead(t('comingSoon.scheduleHead'), { count: games.length }));
  wrap.appendChild(h('p', { style: 'font-size:12px;color:var(--ink-muted);margin:-8px 0 14px' }, t('comingSoon.scoreNote')));
  const scheduleWrap = h('div');
  wrap.appendChild(scheduleWrap);
  renderRoundSchedule(scheduleWrap, { games, teamGames: scheduleData ? scheduleData.team_games : [] });
}
