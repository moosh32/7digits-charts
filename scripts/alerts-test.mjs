// alerts-test.mjs - unit + API-level test of the EOD alert evaluation path.
// Usage: node scripts/alerts-test.mjs   (no network, no secrets)
import * as A from '../worker/lib/alerts.mjs';

const mem = new Map();
const store = { get: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null), set: async (k, v) => { mem.set(k, JSON.stringify(v)); }, del: async (k) => { mem.delete(k); } };
let snap = { asOf: '2026-10-12T04:00:00.000Z', feats: {
    AAA: { price: 100, chg: 6.2, relVol: 2.4, dayHigh: 101, dayLow: 97, ema20: 98, ema50: 90 },
    BBB: { price: 50, chg: -1, relVol: 0.8, dayHigh: 51, dayLow: 49, ema20: 55 },
    CCC: { price: 10, chg: 0, relVol: 1, dayHigh: 10.5, dayLow: 9.5 },
} };
const deps = { store, getSnapshot: () => snap };
let fails = 0;
const ok = (name, c) => { if (!c) fails++; console.log(c ? 'PASS' : 'FAIL', name); };
const mk = async (b) => (await A.hAlertsCreate(b, deps)).body;

// created on today's snapshot; none may fire on it (guard: only NEWER snapshots)
const a1 = await mk({ symbol: 'aaa', type: 'price_up', value: 100.5 });
const a2 = await mk({ symbol: 'AAA', type: 'chg_up', value: 5 });
const a3 = await mk({ symbol: 'AAA', type: 'rel_vol', value: 2 });
const a4 = await mk({ symbol: 'AAA', type: 'ema_touch', value: 20 });
const a5 = await mk({ symbol: 'AAA', type: 'ema_touch', value: 50 });   // 90 is outside 97..101
const a6 = await mk({ symbol: 'BBB', type: 'price_down', value: 49.5 });
const a7 = await mk({ symbol: 'BBB', type: 'ema_touch', value: 50 });   // no ema50 in snapshot yet -> skipped
const a8 = await mk({ symbol: 'CCC', type: 'chg_down', value: 3 });
ok('create validates', (await A.hAlertsCreate({ symbol: 'X', type: 'ema_touch', value: 30 }, deps)).status === 400);
let r = await A.runAlertEvaluation(deps);
ok('same-day snapshot: nothing fires (created on it)', r.body.fired === 0);

// next day's snapshot
snap = { asOf: '2026-10-13T04:00:00.000Z', feats: JSON.parse(JSON.stringify(snap.feats)) };
r = await A.runAlertEvaluation(deps, { trigger: 'cron' });
const fired = new Set(r.body.events.map((e) => e.alertId));
ok('price_up fired (high 101 >= 100.5)', fired.has(a1.id));
ok('chg_up fired (6.2 >= 5)', fired.has(a2.id));
ok('rel_vol fired (2.4 >= 2)', fired.has(a3.id));
ok('ema20 touch fired (97 <= 98 <= 101)', fired.has(a4.id));
ok('ema50 no touch', !fired.has(a5.id));
ok('price_down fired (low 49 <= 49.5)', fired.has(a6.id));
ok('missing ema50 skipped, not fired', !fired.has(a7.id) && r.body.skipped === 1);
ok('chg_down not hit', !fired.has(a8.id));
ok('5 fired total', r.body.fired === 5);
const list = (await A.hAlertsList(deps)).body.alerts;
ok('one-shot alerts become fired', list.find((x) => x.id === a1.id).status === 'fired');
ok('history stored', (await A.hAlertsHistory(deps)).body.events.length === 5);

// idempotence: re-run on same snapshot
r = await A.runAlertEvaluation(deps, { trigger: 'cron' });
ok('re-run on same asOf fires nothing', r.body.fired === 0);

// daily-repeat alert + pause
const d = await mk({ symbol: 'AAA', type: 'chg_up', value: 1, repeat: 'daily' });
snap = { asOf: '2026-10-14T04:00:00.000Z', feats: snap.feats };
await A.hAlertsUpdate(a8.id, { status: 'paused' }, deps);
r = await A.runAlertEvaluation(deps);
ok('daily alert fires again on newer snapshot, stays active', r.body.events.some((e) => e.alertId === d.id) &&
   (await A.hAlertsList(deps)).body.alerts.find((x) => x.id === d.id).status === 'active');
ok('paused alert is not checked', !r.body.events.some((e) => e.alertId === a8.id));

// force (manual) check
const f = await mk({ symbol: 'CCC', type: 'price_up', value: 10.2 });
r = await A.runAlertEvaluation(deps, { force: true, trigger: 'manual-force' });
ok('force check evaluates alert created on current snapshot, tagged manual', r.body.events.some((e) => e.alertId === f.id && e.manual));
ok('delete', (await A.hAlertsDelete(f.id, deps)).status === 200 && (await A.hAlertsDelete(f.id, deps)).status === 404);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
