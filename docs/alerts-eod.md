# EOD alerts

End-of-day alerts, evaluated once per daily snapshot. No intraday or realtime data.

Types: price crosses a level (up: day high >= level, down: day low <= level), daily % change up/down,
unusual volume (relVol >= N), EMA20/EMA50 touch (day low <= EMA <= day high).
`ema50` is added to the snapshot by this change; EMA50 alerts are skipped (not fired) until the next refresh includes it.

Evaluation
- Cron (worker `scheduled`, `[triggers]` in `worker/wrangler.example.toml`): 07:30 UTC and 09:30 UTC daily.
  The 07:00 UTC refresh workflow commits the new snapshot and deploys the worker with it; the cron loads that snapshot and evaluates.
- An alert is checked at most once per snapshot `asOf`, and only against a snapshot newer than the one it was created on.
- One-shot alerts become `fired`; `repeat: daily` alerts stay active.
- Manual: `POST /api/alerts/evaluate` (Bearer). Body `{"force": true}` ignores the guards and tags events `manual`.

API (all Bearer-protected): `GET/POST /api/alerts`, `PUT/DELETE /api/alerts/:id`, `GET/DELETE /api/alerts/history`, `POST /api/alerts/evaluate`.
KV keys: `alerts:list`, `alerts:history` (last 300), `alerts:state`.

Delivery: in-app toast + badge on the alerts button (polled every 5 min while the app is open) and the history tab. No Discord push.

Test: `node scripts/alerts-test.mjs`
