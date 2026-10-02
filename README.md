# BoxOut — EuroLeague Stats

BoxOut is a stats and analytics site for the EuroLeague, built as a static
site with a handful of Netlify Functions for data refresh and AI-generated
insights. It's deployed at [boxout-euroleague.netlify.app](https://boxout-euroleague.netlify.app).

## What's in this repo

- `site/` — the static front end (HTML/CSS/JS) and the Netlify Functions
  (`site/netlify/functions/`) that fetch data, compute standings, and
  generate deploys.
- `scripts/` — the ETL scripts that turn the raw API data into the JSON the
  site serves.
- `data/` — directory structure for raw/processed data (the data itself is
  not committed here — see below).

## Data source

Stats come from the EuroLeague Advanced API, a paid third-party
subscription. Because that data is licensed, not original to this project,
the raw and processed data files are not included in this repository (see
`.gitignore`) — only the code that fetches, transforms, and serves it. To
run this project yourself you'll need your own API credentials, set as the
`EUROLEAGUE_API_TOKEN` environment variable.

## Running locally

The site is static; the Netlify Functions need a Netlify dev environment
(`netlify dev`) with the following environment variables set:

- `EUROLEAGUE_API_TOKEN` — EuroLeague Advanced API token
- `ANTHROPIC_API_KEY` — optional, used by `netlify/functions/ai-insights.js`
  for AI-generated game insights

## License

MIT — see [LICENSE](LICENSE).

## Code of Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

---

This site is powered by [Netlify](https://www.netlify.com).
