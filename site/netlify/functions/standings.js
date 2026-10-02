// ============================================================================
// Live standings proxy — GET /.netlify/functions/standings?season=2025
//
// Also a FREE upstream endpoint (no token needed) — but unlike schedule, it
// requires a round_number, which the app doesn't otherwise track. This
// function figures out "as of the latest completed regular-season round"
// itself: it reads the live schedule (same upstream this site already
// calls from schedule.js) and finds the highest regular-season gameday
// with played:"true", then asks for standings as of that round. Before
// the season's first game, no round has been played yet, so it falls back
// to round 1 (the upstream still answers with everyone 0-0).
// ============================================================================

const SCHEDULE_URL = 'https://euroleague-advanced-api.eu/Euroleague/schedule';
const STANDINGS_URL = 'https://euroleague-advanced-api.eu/Euroleague/standings';
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

async function latestPlayedRound(season) {
  const res = await fetch(`${SCHEDULE_URL}?season=${season}`);
  if (!res.ok) return 1;
  const games = await res.json();
  const played = games.filter(g => g.round === 'RS' && g.played === 'true').map(g => g.gameday);
  return played.length ? Math.max(...played) : 1;
}

exports.handler = async (event) => {
  const season = parseInt(event.queryStringParameters && event.queryStringParameters.season, 10);
  if (!Number.isFinite(season) || season < 2000) {
    return { statusCode: 400, body: JSON.stringify({ error: 'season query param (e.g. ?season=2025) is required' }) };
  }
  const fresh = event.queryStringParameters && event.queryStringParameters.fresh;

  const cached = cache.get(season);
  if (!fresh && cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }, body: cached.body };
  }

  try {
    const round = await latestPlayedRound(season);
    const res = await fetch(`${STANDINGS_URL}?season=${season}&round_number=${round}&standings_type=basicstandings`);
    if (!res.ok) {
      if (cached) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: cached.body };
      return { statusCode: res.status, body: JSON.stringify({ error: `upstream ${res.status}` }) };
    }
    const body = await res.text();
    cache.set(season, { at: Date.now(), body });
    return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }, body };
  } catch (err) {
    if (cached) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: cached.body };
    return { statusCode: 502, body: JSON.stringify({ error: 'fetch failed', detail: String(err) }) };
  }
};
