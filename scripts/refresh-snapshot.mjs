// refresh-snapshot.mjs — daily universe + scan-snapshot refresh.
// Rebuilds data/scan-snapshot.json (features for the custom-scan engine) and
// server/universe.json (search universe) from the Nasdaq API via the shared
// worker-compatible engine (worker/lib/scan-engine.mjs). Web-API only — no
// npm install needed.
//
// Usage:
//   node scripts/refresh-snapshot.mjs              # full refresh, writes files
//   node scripts/refresh-snapshot.mjs --limit 5    # smoke test: builds a tiny
//                                                   # snapshot in memory, writes nothing
//
// Designed to run in GitHub Actions (see .github/workflows/refresh-snapshot.yml).
// After the workflow commits, the new snapshot ships with the next deploy
// (prepare-worker-assets.mjs copies data/scan-snapshot.json into the worker bundle).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SNAP_PATH = path.join(ROOT, 'data', 'scan-snapshot.json');
const UNI_PATH = path.join(ROOT, 'server', 'universe.json');

const args = process.argv.slice(2);
const li = args.indexOf('--limit');
const limit = li >= 0 ? Math.max(1, parseInt(args[li + 1], 10) || 5) : 0;

const { buildSnapshot, fetchUniverse } = await import('../worker/lib/scan-engine.mjs');

let prev = null;
try { prev = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8')); } catch { /* first build */ }
if (limit) prev = null; // smoke test: never merge stale feats into a partial snapshot

console.log(`refresh-snapshot: starting${limit ? ` (LIMIT ${limit}, dry run)` : ''}…`);
const t0 = Date.now();
const snap = await buildSnapshot(prev, console.log, limit ? { limit } : {});
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`refresh-snapshot: snapshot built in ${secs}s — ${Object.keys(snap.feats).length} stocks, ` +
  `${Object.keys(snap.etfFeats || {}).length} ETFs, asOf ${snap.asOf}`);

if (limit) {
  console.log('refresh-snapshot: --limit set — not writing files (smoke test OK)');
  process.exit(0);
}

fs.writeFileSync(SNAP_PATH, JSON.stringify(snap));
console.log(`refresh-snapshot: wrote ${path.relative(ROOT, SNAP_PATH)}`);

// Universe file for search (server/universe.json, {s, n, e}). Reuse the same
// screener data the snapshot build just fetched — one extra pass, no new API.
const uni = await fetchUniverse();
const uniFile = uni.map((u) => ({ s: u.s, n: u.n, e: u.e || '' }));
fs.writeFileSync(UNI_PATH, JSON.stringify(uniFile));
console.log(`refresh-snapshot: wrote ${path.relative(ROOT, UNI_PATH)} (${uniFile.length} symbols)`);
console.log('refresh-snapshot: DONE');
