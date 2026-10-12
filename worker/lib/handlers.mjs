// Shared route handlers — framework-free: each takes plain params/body plus a
// `deps` object and returns {status, body}. The worker router (worker/index.mjs)
// and the express adapter (server/contract-routes.mjs) both call these, so the
// API contract is implemented exactly once.
import {
    TF_MAP, TIMEFRAMES, getBars, getQuote, sanitizeSymbol, searchUniverse,
    cacheGet, cacheSet, INTRADAY_TTL, DAILY_TTL, SEARCH_TTL, QUOTE_TTL,
} from './market.mjs';
import { listScanners, runScanner } from '../../server/scans/definitions.mjs';
import {
    validateScanBody, runCustomScan, ScanValidationError,
    listCustomScans, saveCustomScan, updateCustomScan, deleteCustomScan, getCustomScan,
} from './custom-scan.mjs';

const COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue']);
const WL_KEY = 'watchlists';
const TABS_KEY = 'tabs';
const SCANS_KEY = 'scans:custom'; // (kept in custom-scan.mjs too)
const BREATH_KEY = 'breadth';

// ---------- market data (public) ----------

export function hHealth(deps) {
    const snap = deps.snapshotStatus();
    return {
        status: 200,
        body: { ok: true, snapshot: { asOf: snap.asOf, count: snap.count }, kv: !!deps.env?.SEVEND_KV },
    };
}

export async function hBars(params, deps) {
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return { status: 400, body: { error: 'symbol required' } };
    const tfKey = TIMEFRAMES.includes(params.timeframe) ? params.timeframe : 'D';
    const ck = `bars:${symbol}:${tfKey}`;
    const hit = cacheGet(ck);
    if (hit) return { status: 200, body: { symbol, timeframe: tfKey, bars: hit, count: hit.length } };
    try {
        const bars = await getBars(symbol, tfKey, deps.twelvedataKey);
        cacheSet(ck, bars, ['1', '5', '15', '30', '60'].includes(tfKey) ? INTRADAY_TTL : DAILY_TTL);
        return { status: 200, body: { symbol, timeframe: tfKey, bars, count: bars.length } };
    } catch (e) {
        return { status: 502, body: { error: 'data unavailable', detail: String(e.message || e).slice(0, 120) } };
    }
}

export function hSearch(params, deps) {
    const q = String(params.q || '').slice(0, 24);
    if (q.length < 1) return { status: 200, body: [] };
    const ck = `search:${q.toLowerCase()}`;
    const hit = cacheGet(ck);
    if (hit) return { status: 200, body: hit };
    try {
        const snap = deps.getSnapshot();
        const etfSet = snap?.etfFeats ? new Set(Object.keys(snap.etfFeats)) : null;
        const out = searchUniverse(deps.universe, q, params.limit, etfSet);
        cacheSet(ck, out, SEARCH_TTL);
        return { status: 200, body: out };
    } catch {
        return { status: 502, body: { error: 'search unavailable' } };
    }
}

export async function hQuote(params, deps) {
    const symbol = sanitizeSymbol(params.symbol);
    if (!symbol) return { status: 400, body: { error: 'symbol required' } };
    const ck = `quote:${symbol}`;
    const hit = cacheGet(ck);
    if (hit) return { status: 200, body: hit };
    try {
        const out = await getQuote(symbol);
        cacheSet(ck, out, QUOTE_TTL);
        return { status: 200, body: out };
    } catch {
        return { status: 502, body: { error: 'quote unavailable' } };
    }
}

export async function hQuotes(params, deps) {
    const symbols = String(params.symbols || '').toUpperCase().split(',')
        .map((s) => sanitizeSymbol(s))
        .filter(Boolean).slice(0, 100);
    const out = {};
    await Promise.all(symbols.map(async (symbol) => {
        try {
            const ck = `quote:${symbol}`;
            const hit = cacheGet(ck);
            if (hit) { out[symbol] = hit; return; }
            const q = await getQuote(symbol);
            cacheSet(ck, q, QUOTE_TTL);
            out[symbol] = q;
        } catch { /* skip failed symbols */ }
    }));
    return { status: 200, body: out };
}

// ---------- prebuilt scanners (public; existing shapes) ----------

export function hScansList() {
    return { status: 200, body: listScanners() };
}

export function hPrebuiltScan(id) {
    const out = runScanner(id);
    if (!out) return { status: 404, body: { error: 'unknown scanner' } };
    if (out.error) return { status: 503, body: out };
    return { status: 200, body: out };
}

// ---------- custom scans (run public; saved scans protected) ----------

export function hCustomScanRun(body, deps) {
    try {
        const v = validateScanBody(body);
        const out = runCustomScan(deps.getSnapshot(), v.criteria, v.sort, v.limit);
        if (out.error) return { status: 503, body: out };
        return { status: 200, body: out };
    } catch (e) {
        if (e instanceof ScanValidationError) return { status: 400, body: { error: e.message } };
        return { status: 500, body: { error: 'scan failed' } };
    }
}

export async function hCustomList(deps) {
    return { status: 200, body: await listCustomScans(deps.store) };
}

export async function hCustomCreate(body, deps) {
    try {
        const scan = await saveCustomScan(deps.store, body || {});
        return { status: 200, body: scan };
    } catch (e) {
        if (e instanceof ScanValidationError) return { status: 400, body: { error: e.message } };
        return { status: 500, body: { error: 'save failed' } };
    }
}

export async function hCustomUpdate(id, body, deps) {
    try {
        const scan = await updateCustomScan(deps.store, id, body || {});
        if (!scan) return { status: 404, body: { error: 'unknown scan' } };
        return { status: 200, body: scan };
    } catch (e) {
        if (e instanceof ScanValidationError) return { status: 400, body: { error: e.message } };
        return { status: 500, body: { error: 'update failed' } };
    }
}

export async function hCustomDelete(id, deps) {
    const ok = await deleteCustomScan(deps.store, id);
    if (!ok) return { status: 404, body: { error: 'unknown scan' } };
    return { status: 200, body: { ok: true } };
}

export async function hCustomRunSaved(id, body, deps) {
    const scan = await getCustomScan(deps.store, id);
    if (!scan) return { status: 404, body: { error: 'unknown scan' } };
    const limit = body?.limit == null ? 200 : Math.max(1, Math.min(1000, Math.floor(Number(body.limit)) || 200));
    const out = runCustomScan(deps.getSnapshot(), scan.criteria, scan.sort, limit);
    if (out.error) return { status: 503, body: out };
    return { status: 200, body: out };
}

// ---------- watchlists v2 (protected) ----------

function defaultWatchlists() {
    return { lists: [], activeListId: null };
}
async function readWatchlists(store) {
    const d = await store.get(WL_KEY);
    if (!d || !Array.isArray(d.lists)) return defaultWatchlists();
    return { lists: d.lists, activeListId: d.activeListId ?? null };
}

function cleanWlItem(x) {
    const symbol = sanitizeSymbol(x?.symbol);
    if (!symbol) return null;
    const color = x?.color == null ? null : String(x.color).toLowerCase();
    return { symbol, color: color && COLORS.has(color) ? color : null };
}

export async function hWatchlistsGet(deps) {
    return { status: 200, body: await readWatchlists(deps.store) };
}

export async function hWatchlistsCreate(body, deps) {
    const name = String(body?.name || '').trim();
    if (!name || name.length > 60) return { status: 400, body: { error: 'name must be 1..60 chars' } };
    const doc = await readWatchlists(deps.store);
    const list = { id: crypto.randomUUID(), name, items: [] };
    doc.lists.push(list);
    if (!doc.activeListId) doc.activeListId = list.id;
    await deps.store.set(WL_KEY, doc);
    return { status: 200, body: list };
}

export async function hWatchlistsUpdate(id, body, deps) {
    const doc = await readWatchlists(deps.store);
    const list = doc.lists.find((l) => l.id === id);
    if (!list) return { status: 404, body: { error: 'unknown list' } };
    if (body?.name !== undefined) {
        const name = String(body.name).trim();
        if (!name || name.length > 60) return { status: 400, body: { error: 'name must be 1..60 chars' } };
        list.name = name;
    }
    if (body?.items !== undefined) {
        if (!Array.isArray(body.items) || body.items.length > 500)
            return { status: 400, body: { error: 'items must be an array (max 500)' } };
        list.items = body.items.map(cleanWlItem).filter(Boolean);
    }
    await deps.store.set(WL_KEY, doc);
    return { status: 200, body: list };
}

export async function hWatchlistsDelete(id, deps) {
    const doc = await readWatchlists(deps.store);
    const next = doc.lists.filter((l) => l.id !== id);
    if (next.length === doc.lists.length) return { status: 404, body: { error: 'unknown list' } };
    doc.lists = next;
    if (doc.activeListId === id) doc.activeListId = next.length ? next[0].id : null;
    await deps.store.set(WL_KEY, doc);
    return { status: 200, body: { ok: true } };
}

// ---------- tabs (protected) ----------

function defaultTabs() {
    return { tabs: [], activeId: null };
}

export async function hTabsGet(deps) {
    const d = await deps.store.get(TABS_KEY);
    if (!d || !Array.isArray(d.tabs)) return { status: 200, body: defaultTabs() };
    return { status: 200, body: { tabs: d.tabs, activeId: d.activeId ?? null } };
}

export async function hTabsPut(body, deps) {
    const tabsIn = body?.tabs;
    if (!Array.isArray(tabsIn) || tabsIn.length > 30)
        return { status: 400, body: { error: 'tabs must be an array (max 30)' } };
    const tabs = [];
    for (const t of tabsIn) {
        const symbol = sanitizeSymbol(t?.symbol);
        const name = String(t?.name || '').slice(0, 60);
        if (!symbol) return { status: 400, body: { error: 'each tab needs a symbol' } };
        tabs.push({ id: t?.id ? String(t.id).slice(0, 64) : crypto.randomUUID(), name, symbol });
    }
    let activeId = body?.activeId ?? null;
    if (activeId != null) {
        activeId = String(activeId);
        if (!tabs.some((t) => t.id === activeId))
            return { status: 400, body: { error: 'activeId must match a tab' } };
    }
    const doc = { tabs, activeId };
    await deps.store.set(TABS_KEY, doc);
    return { status: 200, body: doc };
}

// ---------- breadth (GET public; POST protected; existing shapes) ----------

export async function hBreadthGet(params, deps) {
    const ex = params.exchange === 'nyse' ? 'nyse' : 'nasdaq';
    const d = await deps.store.get(BREATH_KEY);
    const records = Array.isArray(d?.records) ? d.records.filter((r) => r.exchange === ex) : [];
    return { status: 200, body: { exchange: ex, records } };
}

export async function hBreadthPost(body, deps) {
    const recs = (body && body.records) || [];
    if (!Array.isArray(recs) || recs.length > 2000)
        return { status: 400, body: { error: 'bad records' } };
    const clean = [];
    for (const r of recs) {
        if (!r || typeof r.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.d)) continue;
        if (r.exchange !== 'nasdaq' && r.exchange !== 'nyse') continue;
        const adv = Number(r.adv), dec = Number(r.dec);
        if (!Number.isFinite(adv) || !Number.isFinite(dec)) continue;
        const net = Number.isFinite(Number(r.net)) ? Number(r.net) : adv - dec;
        clean.push({ d: r.d, exchange: r.exchange, adv, dec, net });
    }
    if (!clean.length) return { status: 400, body: { error: 'no valid records' } };
    const d = await deps.store.get(BREATH_KEY);
    const prev = Array.isArray(d?.records) ? d.records : [];
    const map = new Map(prev.map((r) => [`${r.exchange}|${r.d}`, r]));
    for (const r of clean) map.set(`${r.exchange}|${r.d}`, r);
    const records = [...map.values()].sort((a, b) =>
        a.exchange === b.exchange ? (a.d < b.d ? -1 : 1) : (a.exchange < b.exchange ? -1 : 1));
    try {
        await deps.store.set(BREATH_KEY, { records });
    } catch {
        return { status: 500, body: { error: 'write failed' } };
    }
    return { status: 200, body: { ok: true, upserted: clean.length, total: records.length } };
}

// ---------- snapshot refresh (protected) ----------
// deps.startRefresh(): worker → kicks off a background rebuild, returns {accepted:true};
// express → runs the real rebuild synchronously, returns {asOf,count}.
export async function hSnapshotRefresh(deps) {
    try {
        const r = await deps.startRefresh();
        if (r && r.accepted) return { status: 202, body: { ok: true, started: true } };
        return { status: 200, body: { ok: true, ...(r || {}) } };
    } catch (e) {
        return { status: 500, body: { error: 'refresh failed', detail: String(e.message || e).slice(0, 120) } };
    }
}

export { SCANS_KEY };
