# Deploying the 7D platform to Cloudflare Workers

Target: `https://sevend-charts.mooshkriss2005.workers.dev/` (already live, currently a minimal page).

## What the repo contains (ready)
- `worker/index.mjs` — single Workers-compatible fetch handler (Web APIs only, no Node deps).
  Serves the API (`/api/*`, see `docs/api-contract.md`) and static assets.
- `worker/lib/` — route handlers, custom scan engine, KV/FileStore storage abstraction.
- `worker/wrangler.example.toml` — copy to `wrangler.toml` and fill in.
- `worker-assets/data/scan-snapshot.json` — prebuilt scan universe (4,480 stocks, refreshed 2026-10-12).
  The worker serves it as a static asset and loads it from its own origin on cold start.
- `dist/` — the built frontend (`npm run build` regenerates it).

## Steps (run by whoever holds the Cloudflare account — Instinct)
1. `npm i -g wrangler && wrangler login`
2. `cd ~/workspace/charts-platform` (or clone `github.com/moosh32/7digits-charts`)
3. `cp worker/wrangler.example.toml wrangler.toml` and set:
   - `name = "sevend-charts"`
   - `assets.directory` → the `dist/` folder (built frontend)
   - Create KV: `wrangler kv namespace create SEVEND_KV` → paste the `id` into `[[kv_namespaces]]`
   - `wrangler secret put API_SECRET` — any long random string. This is the Bearer token
     for watchlists/tabs/saved-scans. Without it those endpoints answer 503 and the app
     runs in localStorage-only mode.
4. Copy `worker-assets/data/scan-snapshot.json` → served automatically as `/data/scan-snapshot.json`
   (the worker fetches it from its own origin; refresh via `POST /api/snapshot/refresh` with the secret).
5. `npm run build && wrangler deploy`
6. Verify: `curl https://sevend-charts.mooshkriss2005.workers.dev/api/health`
   → `{ok:true, snapshot:{...}, kv:true}`.

## Daily data refresh (automatic)
`.github/workflows/refresh-snapshot.yml` runs daily at 07:00 UTC: rebuilds
`data/scan-snapshot.json` + `server/universe.json` from the Nasdaq API and
commits them. No action needed — but the new snapshot only reaches the live
worker on the next deploy, because `scripts/prepare-worker-assets.mjs` copies
the data files into the deploy bundle. So: before each `wrangler deploy`,
`git pull` first. Freshness is visible in the app: status bar shows
"נתונים: <date> · <N> מניות" (from `/api/health`), and every scan result
header shows its data date.

## In the app (Israel, one time)
Open the app → click the status-bar indicator (bottom, "מצב מקומי") → paste the same
`API_SECRET` value → the app switches to "מחובר לשרת" and watchlists/tabs/scans persist
server-side (KV). Do NOT add a `/api/config` endpoint that serves the secret — it would
nullify the Bearer auth.

## Notes
- No build step on the worker for the API (plain `.mjs`, no bundle needed).
- Bars come from Yahoo Finance (no key) server-side; TwelveData is an optional fallback
  (`TWELVEDATA_KEY` secret) for intraday.
- The old minimal page (`?s=NVDA` ticker page) is replaced by this deploy.
