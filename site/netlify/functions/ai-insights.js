// ============================================================================
// Scheduled "AI Analysis" — a handful of NEW, model-written insight cards to
// sit alongside the deterministic "Data-Backed Insights" on the Command
// Center (js/views/command-center.js's own streak/split/outlier/heater
// cards, computed with plain arithmetic in js/insights.js, no AI involved).
// This is the one place in the app that actually calls an LLM to write
// prose from the stats.
//
// Two triggers fire this same function:
//   1. A Netlify "Deploy succeeded" outgoing webhook — the real "new data
//      landed" event. There's no automated data pipeline in this project
//      (site/data/{season}/*.json is refreshed manually, by asking a Claude
//      session to re-run scripts/build_processed.py against fresh MCP data
//      and redeploy), but every one of those manual refreshes IS a Netlify
//      deploy, and Netlify can POST to any URL when one finishes — so
//      that's the actual "the site just got new data" signal to hook. Set
//      it up once: Netlify → Site configuration → Build & deploy → Deploy
//      notifications → Add notification → Outgoing webhook → event "Deploy
//      succeeded" → URL: https://<your-site>/.netlify/functions/ai-insights
//   2. The `schedule` cron in netlify.toml (daily) — a safety net in case
//      the webhook above isn't set up, misfires, or a deploy happens from
//      somewhere that skips it.
// Either way this function first compares the data's own manifest.json
// `generated_at` against the value it stored last time (see
// lastProcessedGeneratedAt() below) and does nothing — no Claude call, no
// Firestore write — if the data hasn't actually changed since the last
// run (pass ?force=1 on the URL to bypass this and regenerate anyway). That
// makes firing it on every deploy (even ones with no data changes, e.g. a
// pure UI fix) cheap and safe, and makes the daily cron a genuine no-op
// most days rather than a wasted API call.
//
// Writes its output to Firestore (ai_insights/latest, one doc, overwritten
// in full every run) rather than a static file, since a Netlify Function's
// filesystem is read-only/ephemeral — it can't edit the deployed site.
// js/views/command-center.js reads that doc client-side, same open-read
// pattern as every other collection here (see firestore.rules).
//
// Requires one secret, set as a Netlify environment variable:
//   ANTHROPIC_API_KEY — from console.anthropic.com (needs its own billing;
//     unrelated to any claude.ai login). Optional: ANTHROPIC_MODEL to
//     override the model id below, SITE_URL to override the auto-detected
//     site URL if process.env.URL isn't populated in this runtime.
// Nothing else needs configuring — Firestore writes use the same public
// web config already embedded in js/firebase-init.js (not a secret; the
// security boundary is firestore.rules, see that file's own header) over
// the plain REST API, so no Firebase service-account key is needed either.
// ============================================================================

const FIREBASE_PROJECT_ID = 'boxout-euroleague';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TEAMS_SENT = 20;
const MAX_PLAYERS_SENT = 60; // top players by VAL — plenty for the model to find real angles in, small enough to keep the call cheap

// Every headline the deterministic Command Center cards already cover
// (see js/views/command-center.js) — told to the model explicitly so it
// reaches for different angles instead of restating the same 4-5 findings
// in its own words.
const ALREADY_COVERED = [
  'a team\'s current win streak or loss streak',
  'the single biggest home/away net-rating split',
  'the single most extreme team 3-point shooting % vs league average',
  'a single player on the hottest scoring run over their last 5 games',
];

function siteBaseUrl() {
  return process.env.SITE_URL || process.env.URL || process.env.DEPLOY_PRIME_URL;
}

async function fetchJSON(path) {
  const base = siteBaseUrl();
  if (!base) throw new Error('No site URL available (set SITE_URL env var) — cannot fetch own data files.');
  const res = await fetch(`${base}${path}`);
  if (!res.ok) throw new Error(`Fetch ${path} failed: ${res.status}`);
  return res.json();
}

// Trims a team_season.json row down to the fields worth handing an LLM —
// full rows carry ~60 columns (see build_processed.py), most irrelevant to
// a short prose insight and just costing tokens.
function trimTeam(t) {
  return {
    team_code: t.team_code, team_name: t.team_name, position: t.position,
    wins: t.wins, losses: t.losses, point_diff: t.point_diff,
    PPG: round1(t.PPG), ORtg: round1(t.ORtg), DRtg: round1(t.DRtg), NET_RTG: round1(t.NET_RTG),
    PACE: round1(t.PACE), FG3_PCT: round3(t.FG3_PCT), FG2_PCT: round3(t.FG2_PCT), FT_PCT: round3(t.FT_PCT),
    TRB: round1(t.TRB), AST: round1(t.AST), TOV: round1(t.TOV), STL: round1(t.STL), BLK: round1(t.BLK),
    eFG: round3(t.eFG), TS_PCT: round3(t.TS_PCT), ORB_PCT: round3(t.ORB_PCT), TOV_PCT: round3(t.TOV_PCT),
    net_rtg_home: round1(t.net_rtg_home), net_rtg_away: round1(t.net_rtg_away),
  };
}
function trimPlayer(p) {
  return {
    Player: p.Player, Team: p.Team, GP: p.GP, PTS: round1(p.PTS), REB: round1(p.REB), AST: round1(p.AST),
    STL: round1(p.STL), BLK: round1(p.BLK), VAL: round1(p.VAL), FG_PCT: round3(p.FG_PCT), FG3_PCT: round3(p.FG3_PCT),
    TS_PCT: round3(p.TS_PCT), MIN: round1(p.MIN), qualified: !!p.qualified,
  };
}
function round1(n) { return typeof n === 'number' ? Math.round(n * 10) / 10 : n; }
function round3(n) { return typeof n === 'number' ? Math.round(n * 1000) / 1000 : n; }

function buildPrompt({ season, seasonLabel, teams, players, leagueAverages }) {
  const system = `You are the stats desk for BoxOut, a EuroLeague fan analytics site. You write short, punchy, factually GROUNDED insight cards from a JSON stats snapshot — never inventing or estimating a number that isn't derivable from the JSON given. If you compute something (a ratio, a rank, a gap), the inputs must all trace back to the JSON.

The site already shows these algorithmic findings, computed with plain arithmetic (NOT you) — do not restate any of them, find genuinely different angles:
${ALREADY_COVERED.map(s => `- ${s}`).join('\n')}

Good angles: an efficiency/record mismatch (a team over- or under-performing its point differential), a team or player leading a category by an unusually large margin, a surprising correlation between two stats, a team's identity (pace + shot selection) standing out from the league, a bench/depth signal if derivable, anything genuinely counter-intuitive in the numbers. Every claim must cite a specific number from the JSON.

Return STRICT JSON only, no markdown fences, no prose outside the JSON, matching exactly this shape:
{"items":[{"tone":"good|warning|critical|accent","eyebrow":{"el":"...","en":"..."},"title":{"el":"...","en":"..."},"body":{"el":"...","en":"..."},"sourceNote":{"el":"...","en":"..."}}]}

Write exactly 3 items. "tone" is "good" for a clearly positive/impressive finding, "critical" for a clearly negative/concerning one, "warning" for a mixed or cautionary one, "accent" for a neutral/interesting one. "eyebrow" is a 1-3 word category label (e.g. "Efficiency Gap" / "Απόδοση"). "title" is one short punchy sentence stating the finding with its key number. "body" is 1-2 sentences of context/explanation, still citing numbers. "sourceNote" is a short "Source: <field(s) used>" note, like "Source: team_season.NET_RTG vs point_diff". Provide both "el" (Greek) and "en" (English) for every text field — natural, fluent text in each language, not a literal translation of each other word-for-word, but conveying the same finding and numbers. Keep team/player names as given in the data (do not translate them). Keep each language's title under 100 characters and body under 220 characters.`;

  const user = `Season: ${seasonLabel} (season code ${season}).

TEAM_SEASON (regular season, one row per team):
${JSON.stringify(teams)}

TOP_PLAYERS (by Valuation/PIR, regular season):
${JSON.stringify(players)}

LEAGUE_AVERAGES:
${JSON.stringify(leagueAverages || {})}

Write the 3 insight items now, as strict JSON matching the schema described.`;

  return { system, user };
}

async function callClaude(system, user) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set — add it in Netlify env vars (see this file\'s header comment).');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Anthropic API ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || '').join('').trim();
  let parsed;
  try {
    // Strip an accidental ```json fence, just in case — the prompt asks for
    // none, but models sometimes add one anyway.
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`Model response wasn't valid JSON: ${String(err)} — raw: ${text.slice(0, 300)}`);
  }
  if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
    throw new Error('Model response JSON had no items[] array.');
  }
  return parsed.items;
}

// ---- Minimal Firestore REST field-value encoder --------------------------
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, toFirestoreValue(val)])) } };
  return { stringValue: String(v) };
}

// Reads the last-processed source manifest timestamp back out of
// ai_insights/latest, so the handler can skip regenerating when the
// underlying data hasn't actually changed since last time. Missing doc (no
// run yet) or any read error is treated as "no prior state" — proceed.
async function lastProcessedGeneratedAt() {
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ai_insights/latest`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null; // 404 on first-ever run, most commonly
    const doc = await res.json();
    return doc.fields && doc.fields.source_generated_at && doc.fields.source_generated_at.stringValue || null;
  } catch {
    return null;
  }
}

async function writeToFirestore(doc) {
  const fields = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, toFirestoreValue(v)]));
  const fieldNames = Object.keys(doc);
  const mask = fieldNames.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/ai_insights/latest?${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Firestore write ${res.status}: ${errBody.slice(0, 500)}`);
  }
}

exports.handler = async (event) => {
  try {
    const manifest = await fetchJSON('/data/manifest.json');
    const season = manifest.default_season;
    const seasonMeta = (manifest.seasons || []).find(s => s.code === season);
    const seasonLabel = seasonMeta ? seasonMeta.label : String(season);

    const force = event && event.queryStringParameters && event.queryStringParameters.force;
    if (!force) {
      const lastSeen = await lastProcessedGeneratedAt();
      if (lastSeen && lastSeen === manifest.generated_at) {
        return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: true, reason: 'data unchanged since last run', generated_at: manifest.generated_at }) };
      }
    }

    const [teamSeason, playerSeason, leagueAverages] = await Promise.all([
      fetchJSON(`/data/${season}/team_season.json`),
      fetchJSON(`/data/${season}/player_season.json`),
      fetchJSON(`/data/${season}/league_averages.json`).catch(() => null),
    ]);

    const teams = teamSeason.slice(0, MAX_TEAMS_SENT).map(trimTeam);
    const playersRaw = Array.isArray(playerSeason) ? playerSeason : (playerSeason.players || []);
    const players = playersRaw
      .filter(p => p.qualified)
      .sort((a, b) => (b.VAL || 0) - (a.VAL || 0))
      .slice(0, MAX_PLAYERS_SENT)
      .map(trimPlayer);

    const { system, user } = buildPrompt({ season, seasonLabel, teams, players, leagueAverages });
    const items = await callClaude(system, user);

    await writeToFirestore({
      generated_at: new Date().toISOString(),
      source_generated_at: manifest.generated_at, // what this run was based on — compared against next time to skip a no-op regeneration
      season,
      season_label: seasonLabel,
      items,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, count: items.length }) };
  } catch (err) {
    console.error('ai-insights failed:', err);
    // Deliberately don't touch Firestore on failure — the site keeps
    // showing the last successful run's cards rather than an empty section.
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String(err && err.message || err) }) };
  }
};
