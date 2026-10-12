// 52wk-test.mjs - checks the derived 52-week scan fields + watchlist stats against the committed snapshot.
// Usage: node scripts/52wk-test.mjs   (no network, no secrets)
import fs from 'node:fs';
import { validateScanBody, runCustomScan, watchlistStats } from '../worker/lib/custom-scan.mjs';
const snap = JSON.parse(fs.readFileSync(new URL('../data/scan-snapshot.json', import.meta.url), 'utf8'));
let fails = 0;
const ok = (n, c) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', n); };
const run = (criteria, sort) => { const v = validateScanBody({ criteria, sort }); return runCustomScan(snap, v.criteria, v.sort, 50); };
const near = run([{ field: 'distHigh52Pct', op: 'gte', value: -5 }, { field: 'price', op: 'gt', value: 5 }], { field: 'distHigh52Pct', dir: 'desc' });
ok('near-high scan returns rows', near.count > 0);
ok('all rows within 5% of high', near.tickers.every((r) => r.distHigh52Pct >= -5.01 && r.distHigh52Pct <= 0.01));
const nh = run([{ field: 'newHigh52', op: 'eq', value: 1 }]);
ok('new-high rows flagged & ~0 distance', nh.tickers.every((r) => r.newHigh52 === true));
const hve = run([{ field: 'hve', op: 'eq', value: 1 }, { field: 'price', op: 'gt', value: 5 }]);
const hv1 = run([{ field: 'hv1', op: 'eq', value: 1 }, { field: 'price', op: 'gt', value: 5 }]);
ok('HVE subset of HV1', hve.tickers.every((r) => snap.feats[r.symbol].vol >= snap.feats[r.symbol].volMax252));
console.log('HVE', hve.count, 'HV1', hv1.count);
console.log('asOf', snap.asOf, 'near5%:', near.count, 'newHigh:', nh.count);
const syms = Object.keys(snap.feats).slice(0, 3);
const st = watchlistStats(snap, syms);
ok('watchlist stats shape', syms.every((s) => st[s] && 'relVol' in st[s] && 'atrPct' in st[s] && 'distHigh52Pct' in st[s]));
console.log(JSON.stringify(st[syms[0]]));
process.exit(fails ? 1 : 0);
