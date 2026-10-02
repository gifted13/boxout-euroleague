// ============================================================================
// Live schedule/results proxy — GET /.netlify/functions/schedule?season=2025
//
// Runs server-side on Netlify (not in the visitor's browser), so this is
// also where a future paid-tier call would keep its token safe — this one
// specifically doesn't need one: /{competition}/schedule is a FREE endpoint
// on euroleague-advanced-api.eu (confirmed against its live OpenAPI spec),
// so no AuthorisationToken header is sent here.
//
// Response shape is an exact passthrough of the upstream API — the same
// lowercase field names (gameday, hometeam, homecode, played, ...) the app
// already expects from the old static data/{season}/schedule.json files
// (which were themselves a one-time passthrough of the same feed). That
// means js/data.js can swap the static file for this live endpoint with no
// change anywhere else in the app.
//
// A short in-memory cache avoids re-hitting the upstream API on every
// single page view (function instances are reused by Netlify between
// invocations, though this isn't guaranteed — worst case it just falls
// back to a live fetch). The super-admin's "Refresh data" button passes
// ?fresh=1 to force past this cache.
// ============================================================================

const UPSTREAM = 'https://euroleague-advanced-api.eu/Euroleague/schedule';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — short enough for live scores, long enough to spare the API on traffic bursts
const cache = new Map(); // season -> { at, data }

// NOTE: an earlier version of this function patched a handful of games'
// `startime` values by hand here, on the theory that the upstream feed was
// simply slow to pick up TV-driven reschedules. That theory turned out to be
// wrong — see js/format.js's SOURCE_TZ comment: `startime` was never the
// home team's own local time to begin with, it's Central European Time for
// every game, and the app was converting it incorrectly. That's now fixed at
// the conversion layer (the one place that needs to know it), so this
// function is back to a plain passthrough — no per-game patch list to
// maintain here.

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
    const res = await fetch(`${UPSTREAM}?season=${season}`);
    if (!res.ok) {
      // Serve a stale cached copy rather than nothing, if we have one.
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
