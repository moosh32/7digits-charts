// EOD alerts: price level, daily % change, unusual volume, EMA20/EMA50 touch.
// Evaluated once per snapshot (daily close data) - no intraday/realtime infra.
// Pure evaluation (evaluateAlerts) is separate from storage so it can be tested
// without a store. Framework-free: shared by the worker and the express target.

export const ALERTS_KEY = 'alerts:list';
export const HISTORY_KEY = 'alerts:history';
export const STATE_KEY = 'alerts:state';
export const MAX_ALERTS = 200;
export const MAX_HISTORY = 300;

export const ALERT_TYPES = {
    price_up: 'מחיר חוצה כלפי מעלה',
    price_down: 'מחיר חוצה כלפי מטה',
    chg_up: 'עלייה יומית ב-%',
    chg_down: 'ירידה יומית ב-%',
    rel_vol: 'ווליום חריג (נפח יחסי)',
    ema_touch: 'נגיעה בממוצע EMA',
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = (v) => (num(v) == null ? null : Math.round(v * 100) / 100);

export function alertLabel(a) {
    switch (a.type) {
        case 'price_up': return `${a.symbol} חצה מעלה ${a.value}`;
        case 'price_down': return `${a.symbol} חצה מטה ${a.value}`;
        case 'chg_up': return `${a.symbol} עלה ${a.value}%+`;
        case 'chg_down': return `${a.symbol} ירד ${a.value}%+`;
        case 'rel_vol': return `${a.symbol} נפח יחסי ${a.value}x+`;
        case 'ema_touch': return `${a.symbol} נגע ב-EMA${a.value}`;
        default: return a.symbol;
    }
}

// f = snapshot feature row for the symbol. Returns { hit, skip, actual }.
// skip = reason the alert could not be evaluated (missing data), never a hit.
export function checkCondition(a, f) {
    if (!f) return { hit: false, skip: 'symbol not in snapshot' };
    const actual = { price: r2(f.price), chg: r2(f.chg), relVol: r2(f.relVol), dayHigh: r2(f.dayHigh), dayLow: r2(f.dayLow) };
    switch (a.type) {
        case 'price_up':
            if (num(f.dayHigh) == null) return { hit: false, skip: 'no high' };
            return { hit: f.dayHigh >= a.value, actual };
        case 'price_down':
            if (num(f.dayLow) == null) return { hit: false, skip: 'no low' };
            return { hit: f.dayLow <= a.value, actual };
        case 'chg_up':
            if (num(f.chg) == null) return { hit: false, skip: 'no chg' };
            return { hit: f.chg >= a.value, actual };
        case 'chg_down':
            if (num(f.chg) == null) return { hit: false, skip: 'no chg' };
            return { hit: f.chg <= -a.value, actual };
        case 'rel_vol':
            if (num(f.relVol) == null) return { hit: false, skip: 'no relVol' };
            return { hit: f.relVol >= a.value, actual };
        case 'ema_touch': {
            const e = num(f[`ema${a.value}`]);
            if (e == null || num(f.dayHigh) == null || num(f.dayLow) == null)
                return { hit: false, skip: `no ema${a.value} in snapshot yet` };
            actual.ema = r2(e);
            return { hit: f.dayLow <= e && e <= f.dayHigh, actual };
        }
        default: return { hit: false, skip: 'unknown type' };
    }
}

// Mutates alerts (status/lastCheckedAsOf/...) and returns { events, checked, skipped }.
// An alert is checked at most once per snapshot asOf, and only against snapshots
// newer than the one it was created on (so a level already touched today does
// not fire on the data the user was looking at). force=true (manual check)
// ignores both guards and tags events manual.
export function evaluateAlerts(alerts, snap, { force = false, now = new Date() } = {}) {
    const asOf = snap?.asOf || null;
    const events = [];
    let checked = 0, skipped = 0;
    for (const a of alerts) {
        if (a.status !== 'active') continue;
        if (!force) {
            if (a.lastCheckedAsOf === asOf) continue;
            if (a.createdAsOf && asOf && asOf <= a.createdAsOf) continue;
        }
        const f = snap?.feats?.[a.symbol] || snap?.etfFeats?.[a.symbol];
        const r = checkCondition(a, f);
        if (r.skip) { skipped++; continue; }
        checked++;
        if (!force) a.lastCheckedAsOf = asOf;
        if (!r.hit) continue;
        const firedAt = now.toISOString();
        events.push({
            id: crypto.randomUUID(), alertId: a.id, symbol: a.symbol, type: a.type, value: a.value,
            label: alertLabel(a), note: a.note || '', actual: r.actual, asOf, firedAt, manual: !!force,
        });
        a.firedCount = (a.firedCount || 0) + 1;
        a.lastFiredAt = firedAt;
        if (a.repeat !== 'daily') a.status = 'fired';
    }
    return { events, checked, skipped };
}

// ---------- validation ----------
export function sanitizeAlertInput(body, existing = null) {
    const out = {};
    const has = (k) => body && body[k] !== undefined;
    if (!existing || has('symbol')) {
        const symbol = String(body?.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 12);
        if (!symbol) return { error: 'symbol required' };
        out.symbol = symbol;
    }
    if (!existing || has('type')) {
        if (!ALERT_TYPES[body?.type]) return { error: 'invalid type' };
        out.type = body.type;
    }
    const type = out.type || existing?.type;
    if (!existing || has('value')) {
        const v = Number(body?.value);
        if (!Number.isFinite(v)) return { error: 'value must be a number' };
        if (type === 'ema_touch' && ![20, 50].includes(v)) return { error: 'ema value must be 20 or 50' };
        if ((type === 'price_up' || type === 'price_down') && !(v > 0)) return { error: 'price must be > 0' };
        if ((type === 'chg_up' || type === 'chg_down') && !(v > 0 && v <= 1000)) return { error: 'percent must be 0..1000' };
        if (type === 'rel_vol' && !(v > 0 && v <= 1000)) return { error: 'relVol must be 0..1000' };
        out.value = v;
    }
    if (has('note')) out.note = String(body.note || '').slice(0, 200);
    if (has('repeat')) out.repeat = body.repeat === 'daily' ? 'daily' : 'once';
    if (has('status')) {
        if (!['active', 'paused', 'fired'].includes(body.status)) return { error: 'invalid status' };
        out.status = body.status;
    }
    return { value: out };
}

// ---------- storage-backed handlers ({status, body}) ----------
async function readList(store) {
    const d = await store.get(ALERTS_KEY);
    return Array.isArray(d?.alerts) ? d.alerts : [];
}
async function readHistory(store) {
    const d = await store.get(HISTORY_KEY);
    return Array.isArray(d?.events) ? d.events : [];
}

export async function hAlertsList(deps) {
    const [alerts, state] = await Promise.all([readList(deps.store), deps.store.get(STATE_KEY)]);
    return { status: 200, body: { alerts, state: state || null, snapshotAsOf: deps.getSnapshot()?.asOf || null } };
}

export async function hAlertsCreate(body, deps) {
    const alerts = await readList(deps.store);
    if (alerts.length >= MAX_ALERTS) return { status: 400, body: { error: `max ${MAX_ALERTS} alerts` } };
    const r = sanitizeAlertInput(body);
    if (r.error) return { status: 400, body: { error: r.error } };
    const snap = deps.getSnapshot();
    const a = {
        id: crypto.randomUUID(), repeat: 'once', note: '', status: 'active', ...r.value,
        createdAt: new Date().toISOString(), createdAsOf: snap?.asOf || null,
        createdPrice: r2((snap?.feats?.[r.value.symbol] || snap?.etfFeats?.[r.value.symbol])?.price),
        firedCount: 0,
    };
    alerts.push(a);
    await deps.store.set(ALERTS_KEY, { alerts });
    return { status: 200, body: a };
}

export async function hAlertsUpdate(id, body, deps) {
    const alerts = await readList(deps.store);
    const a = alerts.find((x) => x.id === id);
    if (!a) return { status: 404, body: { error: 'unknown alert' } };
    const r = sanitizeAlertInput(body, a);
    if (r.error) return { status: 400, body: { error: r.error } };
    Object.assign(a, r.value);
    // re-arming (resume / new level) restarts the "newer than" guard from now
    if (r.value.status === 'active' || r.value.value !== undefined) {
        a.createdAsOf = deps.getSnapshot()?.asOf || a.createdAsOf;
        a.lastCheckedAsOf = null;
    }
    await deps.store.set(ALERTS_KEY, { alerts });
    return { status: 200, body: a };
}

export async function hAlertsDelete(id, deps) {
    const alerts = await readList(deps.store);
    const next = alerts.filter((x) => x.id !== id);
    if (next.length === alerts.length) return { status: 404, body: { error: 'unknown alert' } };
    await deps.store.set(ALERTS_KEY, { alerts: next });
    return { status: 200, body: { ok: true } };
}

export async function hAlertsHistory(deps) {
    return { status: 200, body: { events: await readHistory(deps.store) } };
}

export async function hAlertsHistoryClear(deps) {
    await deps.store.set(HISTORY_KEY, { events: [] });
    return { status: 200, body: { ok: true } };
}

// Evaluate all active alerts against the current snapshot; persist state + history.
export async function runAlertEvaluation(deps, { force = false, trigger = 'manual' } = {}) {
    const snap = deps.getSnapshot();
    if (!snap?.feats) return { status: 503, body: { error: 'no snapshot' } };
    const alerts = await readList(deps.store);
    const { events, checked, skipped } = evaluateAlerts(alerts, snap, { force });
    if (events.length || checked || skipped) await deps.store.set(ALERTS_KEY, { alerts });
    if (events.length) {
        const hist = await readHistory(deps.store);
        await deps.store.set(HISTORY_KEY, { events: [...events, ...hist].slice(0, MAX_HISTORY) });
    }
    const state = {
        lastRunAt: new Date().toISOString(), trigger, snapshotAsOf: snap.asOf || null,
        checked, skipped, fired: events.length, force: !!force,
    };
    await deps.store.set(STATE_KEY, state);
    return { status: 200, body: { ...state, events } };
}

export async function hAlertsEvaluate(body, deps) {
    return runAlertEvaluation(deps, { force: !!body?.force, trigger: body?.force ? 'manual-force' : 'manual' });
}
