// Custom scan builder over the snapshot features.
// Contract: POST /api/scan/run {criteria:[{field,op,value,value2?}], sort?, limit?}
// Fields and ops are exactly the frozen API contract's lists.

const pctAbove = (price, base) =>
    (price != null && base != null && base !== 0) ? (price / base - 1) * 100 : null;

// field -> (feature, snapshot) => number|null
const FIELDS = {
    price: (f) => f.price,
    dollarVolume: (f) => (f.vol != null && f.price != null) ? f.vol * f.price : null,
    avgDollarVolume20: (f) => f.dvol20,
    atrPct: (f) => f.atrPct,
    gapPct: (f) => f.gap,
    relVolume: (f) => f.relVol,
    sma20: (f) => f.sma20,
    sma50: (f) => f.sma50,
    sma200: (f) => f.sma200,
    priceVsSma20Pct: (f) => pctAbove(f.price, f.sma20),
    priceVsSma50Pct: (f) => pctAbove(f.price, f.sma50),
    priceVsSma200Pct: (f) => pctAbove(f.price, f.sma200),
    perf5: (f) => f.perf5,
    perf21: (f) => f.perf21,
    perf63: (f) => f.perf63,
    // RS 63d vs SPY, in percentage points (stock perf63 − SPY perf63).
    // spyPerf63 is computed at snapshot build time (see scan-engine.mjs).
    rs63vsSpy: (f, snap) =>
        (f.perf63 != null && snap?.spyPerf63 != null) ? f.perf63 - snap.spyPerf63 : null,
    // 52-week range, derived from hi52/lo52 already in the snapshot (no rebuild needed).
    // distHigh52Pct: 0 at the high, negative below it (e.g. -5 = 5% under the 52wk high).
    distHigh52Pct: (f) => (f.hi52 > 0 && f.price != null) ? (f.price / f.hi52 - 1) * 100 : null,
    // pctAboveLow52: % above the 52wk low.
    pctAboveLow52: (f) => pctAbove(f.price, f.lo52),
    // newHigh52: 1 when today's bar set the 52wk high (day high == 52wk high), else 0. Use with eq 1.
    newHigh52: (f) => (f.hi52 > 0 && f.dayHigh != null) ? (f.dayHigh >= f.hi52 ? 1 : 0) : null,
    marketCap: (f) => f.mcap,
    avgVolume20: (f) => f.avgV20,
};
export const SCAN_FIELDS = Object.keys(FIELDS);
const SORTABLE = new Set([...SCAN_FIELDS, 'symbol', 'price', 'changePct']);

const OPS = new Set(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function testOp(op, fv, value, value2) {
    if (fv == null) return false; // unknown values never pass — never invent
    switch (op) {
        case 'gt': return fv > value;
        case 'gte': return fv >= value;
        case 'lt': return fv < value;
        case 'lte': return fv <= value;
        case 'eq': return fv === value;
        case 'between': return fv >= Math.min(value, value2) && fv <= Math.max(value, value2);
        default: return false;
    }
}

export class ScanValidationError extends Error {
    constructor(message) { super(message); this.status = 400; }
}

// Validates a scan body; returns normalized {criteria, sort, limit}.
export function validateScanBody(body) {
    const b = body || {};
    if (!Array.isArray(b.criteria) || b.criteria.length === 0)
        throw new ScanValidationError('criteria must be a non-empty array');
    if (b.criteria.length > 20)
        throw new ScanValidationError('too many criteria (max 20)');
    const criteria = b.criteria.map((c, i) => {
        if (!c || typeof c !== 'object') throw new ScanValidationError(`criteria[${i}]: bad rule`);
        if (!FIELDS[c.field]) throw new ScanValidationError(`criteria[${i}]: unknown field '${c.field}'`);
        if (!OPS.has(c.op)) throw new ScanValidationError(`criteria[${i}]: unknown op '${c.op}'`);
        const value = num(c.value);
        if (value == null) throw new ScanValidationError(`criteria[${i}]: value must be a number`);
        let value2 = null;
        if (c.op === 'between') {
            value2 = num(c.value2);
            if (value2 == null) throw new ScanValidationError(`criteria[${i}]: between needs numeric value2`);
        }
        return { field: c.field, op: c.op, value, ...(c.op === 'between' ? { value2 } : {}) };
    });
    let sort = null;
    if (b.sort != null) {
        if (typeof b.sort !== 'object' || !SORTABLE.has(b.sort.field))
            throw new ScanValidationError('sort.field unknown');
        const dir = (b.sort.dir || 'desc').toLowerCase();
        if (dir !== 'asc' && dir !== 'desc') throw new ScanValidationError('sort.dir must be asc|desc');
        sort = { field: b.sort.field, dir };
    }
    const limit = b.limit == null ? 200 : Math.max(1, Math.min(1000, Math.floor(Number(b.limit)) || 200));
    return { criteria, sort, limit };
}

// Per-symbol daily stats for watchlist columns (public; from the snapshot).
export function watchlistStats(snap, symbols) {
    const out = {};
    if (!snap) return out;
    for (const sym of symbols) {
        const f = snap.feats?.[sym] || snap.etfFeats?.[sym];
        if (!f) continue;
        out[sym] = {
            changePct: r2(f.chg), relVol: r1(f.relVol), atrPct: r2(f.atrPct),
            distHigh52Pct: r2(FIELDS.distHigh52Pct(f)), newHigh52: FIELDS.newHigh52(f) === 1,
        };
    }
    return out;
}

const r2 = (v) => (v == null ? null : +v.toFixed(2));
const r1 = (v) => (v == null ? null : +v.toFixed(1));

function rowOf(f, snap) {
    const rs = FIELDS.rs63vsSpy(f, snap);
    return {
        symbol: f.s,
        name: f.name,
        price: r2(f.price),
        changePct: r2(f.chg),
        dollarVolume: (f.vol != null && f.price != null) ? Math.round(f.vol * f.price) : null,
        atrPct: r2(f.atrPct),
        gapPct: r2(f.gap),
        relVolume: r1(f.relVol),
        rs63vsSpy: r2(rs),
        distHigh52Pct: r2(FIELDS.distHigh52Pct(f)),
        newHigh52: FIELDS.newHigh52(f) === 1,
        marketCap: f.mcap || 0,
    };
}

function sortVal(f, snap, field) {
    if (field === 'symbol') return f.s;
    if (field === 'changePct') return f.chg;
    const acc = FIELDS[field];
    return acc ? acc(f, snap) : null;
}

// Runs validated criteria over the snapshot's stock features.
// Returns {tickers, count, ms, asOf} per the contract (count = total matches).
export function runCustomScan(snap, criteria, sort, limit) {
    const t0 = Date.now();
    if (!snap) return { error: 'snapshot not ready' };
    const feats = snap.feats || {};
    const rows = [];
    for (const sym of Object.keys(feats)) {
        const f = feats[sym];
        let pass = true;
        for (const c of criteria) {
            if (!testOp(c.op, FIELDS[c.field](f, snap), c.value, c.value2)) { pass = false; break; }
        }
        if (pass) rows.push({ f, row: rowOf(f, snap) });
    }
    if (sort) {
        const { field, dir } = sort;
        const m = dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const va = sortVal(a.f, snap, field), vb = sortVal(b.f, snap, field);
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'string') return m * (va < vb ? -1 : va > vb ? 1 : 0);
            return m * (va - vb);
        });
    } else {
        rows.sort((a, b) => (b.row.dollarVolume || 0) - (a.row.dollarVolume || 0));
    }
    const tickers = rows.slice(0, limit).map((r) => r.row);
    return { tickers, count: rows.length, ms: Date.now() - t0, asOf: snap.asOf };
}

// ---------- saved custom scans (Store key 'scans:custom') ----------
const STORE_KEY = 'scans:custom';

export async function listCustomScans(store) {
    return (await store.get(STORE_KEY)) || [];
}
export async function saveCustomScan(store, { name, criteria, sort }) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80)
        throw new ScanValidationError('name must be 1..80 chars');
    const v = validateScanBody({ criteria, sort });
    const scans = await listCustomScans(store);
    const now = Date.now();
    const scan = {
        id: crypto.randomUUID(),
        name: name.trim(),
        criteria: v.criteria,
        sort: v.sort,
        createdAt: now,
        updatedAt: now,
    };
    scans.push(scan);
    await store.set(STORE_KEY, scans);
    return scan;
}
export async function updateCustomScan(store, id, patch) {
    const scans = await listCustomScans(store);
    const i = scans.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const cur = scans[i];
    const next = { ...cur };
    if (patch.name !== undefined) {
        if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 80)
            throw new ScanValidationError('name must be 1..80 chars');
        next.name = patch.name.trim();
    }
    if (patch.criteria !== undefined || patch.sort !== undefined) {
        const v = validateScanBody({
            criteria: patch.criteria !== undefined ? patch.criteria : cur.criteria,
            sort: patch.sort !== undefined ? patch.sort : cur.sort,
        });
        next.criteria = v.criteria;
        next.sort = v.sort;
    }
    next.updatedAt = Date.now();
    scans[i] = next;
    await store.set(STORE_KEY, scans);
    return next;
}
export async function deleteCustomScan(store, id) {
    const scans = await listCustomScans(store);
    const next = scans.filter((s) => s.id !== id);
    if (next.length === scans.length) return false;
    await store.set(STORE_KEY, next);
    return true;
}
export async function getCustomScan(store, id) {
    const scans = await listCustomScans(store);
    return scans.find((s) => s.id === id) || null;
}
