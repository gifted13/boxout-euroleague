// ============================================================================
// Secure, authenticated proxy for the PAID tier of euroleague-advanced-api.eu
// — GET /.netlify/functions/advanced?path=/Euroleague/players/season&season=2025&...
//
// This is the one piece of the live-data setup that touches the paid API
// token. The token lives ONLY here, as the EUROLEAGUE_API_TOKEN environment
// variable set in the Netlify dashboard (Project configuration > Environment
// variables) — it is never present in any file that ships to the browser,
// and this function never echoes it back in a response. A visitor's browser
// only ever talks to this Netlify function, on Netlify's own server; the
// function is the only thing that ever sends the real AuthorisationToken
// header to euroleague-advanced-api.eu.
//
// `path` must be one of the protected paths documented at
// https://euroleague-advanced-api.eu/docs (e.g. /Euroleague/players/season,
// /Euroleague/teams/four-factors/season, /Euroleague/boxscore/players/game,
// ...) — every other query param is forwarded through unchanged, so the
// caller supplies whatever that specific endpoint needs (season, phase,
// stats_type, etc. — see the docs for each path's own parameters).
//
// This function is deliberately generic rather than one hand-written
// wrapper per dataset: the paid tier has dozens of parametrized endpoints,
// and only a live, deployed test pass (this sandbox can't reach this host
// at all — see the comment in js/data.js) can confirm each one's exact
// field names are what a given view expects. Shipping the secure plumbing
// now, and wiring specific views to specific paths as each is verified
// live, is safer than guessing every response shape blind.
// ============================================================================

const BASE = 'https://euroleague-advanced-api.eu';
const CACHE_TTL_MS = 15 * 60 * 1000; // deeper stats move less than the live schedule/standings do
const cache = new Map(); // cacheKey -> { at, status, body }

const ALLOWED_PATH = /^\/(Euroleague|Eurocup)\/[a-zA-Z0-9/_-]+$/;

exports.handler = async (event) => {
  const token = process.env.EUROLEAGUE_API_TOKEN;
  if (!token) {
    return { statusCode: 501, body: JSON.stringify({ error: 'EUROLEAGUE_API_TOKEN is not set in this site\'s environment variables yet' }) };
  }

  const params = event.queryStringParameters || {};
  const path = params.path;
  if (!path || !ALLOWED_PATH.test(path)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'path query param must look like /Euroleague/<endpoint>' }) };
  }

  const rest = new URLSearchParams(params);
  rest.delete('path');
  rest.delete('fresh');
  const qs = rest.toString();
  const cacheKey = path + '?' + qs;
  const fresh = params.fresh;

  const cached = cache.get(cacheKey);
  if (!fresh && cached && (Date.now() - cached.at) < CACHE_TTL_MS) {
    return { statusCode: cached.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' }, body: cached.body };
  }

  try {
    const res = await fetch(`${BASE}${path}${qs ? '?' + qs : ''}`, {
      headers: { AuthorisationToken: token },
    });
    const body = await res.text();
    if (res.ok) cache.set(cacheKey, { at: Date.now(), status: res.status, body });
    else if (cached) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: cached.body };
    return { statusCode: res.status, headers: { 'content-type': 'application/json' }, body };
  } catch (err) {
    if (cached) return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: cached.body };
    return { statusCode: 502, body: JSON.stringify({ error: 'fetch failed', detail: String(err) }) };
  }
};
