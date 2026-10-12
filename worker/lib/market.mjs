// Market data: bars / quotes / search over public upstream APIs.
// Web-API only (global fetch) — shared by the worker and usable from node.
import { nasdaqDaily } from './scan-engine.mjs';

export const TF_MAP = {
    '1':  { interval: '1m',  range: '5d'  },
    '5':  { interval: '5m',  range: '1mo' },
    '15': { interval: '15m', range: '1mo' },
    '30': { interval: '30m', range: '3mo' },
    '60': { interval: '1h',  range: '6mo' },
    'D':  { interval: '1d',  range: '5y'  },
    'W':  { interval: '1wk', range: 'max' },
    'M':  { interval: '1mo', range: 'max' },
};
export const TIMEFRAMES = Object.keys(TF_MAP);

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ---------- tiny TTL cache (per-isolate / per-process) ----------
const cache = new Map();
export const INTRADAY_TTL = 5 * 60 * 1000;
export const DAILY_TTL = 4 * 60 * 60 * 1000;
export const SEARCH_TTL = 60 * 60 * 1000;
export const QUOTE_TTL = 60 * 1000;

export function cacheGet(key) {
    const e = cache.get(key);
    if (e && Date.now() < e.exp) return e.val;
    cache.delete(key);
    return null;
}
export function cacheSet(key, val, ttlMs) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { val, exp: Date.now() + ttlMs });
}

// ---------- Yahoo (primary for intraday, no key) ----------
let yahooCookie = '';

async function yahooGet(host, p) {
    const attempt = (cookie) => fetch(`https://${host}${p}`, {
        headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) },
    });
    let r = await attempt(yahooCookie);
    if ((r.status === 401 || r.status === 403) && !yahooCookie) {
        try {
            const c = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA } });
            const raw = typeof c.headers.getSetCookie === 'function' ? c.headers.getSetCookie() : [];
            yahooCookie = raw.map((s) => s.split(';')[0]).join('; ');
            if (yahooCookie) r = await attempt(yahooCookie);
        } catch { /* fall through */ }
    }
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    return r.json();
}

async function yahooBars(symbol, tf) {
    const j = await yahooGet('query1.finance.yahoo.com',
        `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${tf.interval}&range=${tf.range}`);
    const result = j?.chart?.result?.[0];
    const t = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < t.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        bars.push({ time: t[i] * 1000, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
    }
    if (!bars.length) throw new Error('yahoo: empty');
    return bars;
}

// ---------- Twelve Data (fallback, needs key) ----------
const TD_INTERVAL = { '1': '1min', '5': '5min', '15': '15min', '30': '30min', '60': '1h', D: '1day', W: '1week', M: '1month' };

async function twelveDataBars(symbol, tfKey, apiKey) {
    if (!apiKey) throw new Error('no twelvedata key');
    const iv = TD_INTERVAL[tfKey] || '1day';
    const intraday = iv.includes('min') || iv === '1h';
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${iv}&outputsize=5000&apikey=${apiKey}&timezone=America/New_York`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    const vals = j?.values;
    if (!vals?.length) throw new Error('twelvedata: ' + (j?.message || r.status));
    return vals.map((v) => ({
        time: new Date(intraday ? v.datetime : v.datetime + 'T00:00:00').getTime(),
        open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0),
    })).reverse();
}

function resampleDaily(bars, tfKey) {
    const out = [];
    let cur = null;
    const keyOf = (t) => {
        const d = new Date(t);
        if (tfKey === 'W') {
            const mondayOffset = (d.getUTCDay() + 6) % 7;
            return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset);
        }
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    };
    for (const b of bars) {
        const k = keyOf(b.time);
        if (!cur || cur.k !== k) {
            if (cur) out.push(cur.bar);
            cur = { k, bar: { ...b } };
        } else {
            cur.bar.high = Math.max(cur.bar.high, b.high);
            cur.bar.low = Math.min(cur.bar.low, b.low);
            cur.bar.close = b.close;
            cur.bar.volume += b.volume;
        }
    }
    if (cur) out.push(cur.bar);
    return out;
}

// Priority: Nasdaq official API for D/W/M (no key) → TwelveData intraday (key) → Yahoo.
export async function getBars(symbol, tfKey, twelvedataKey = '') {
    const tf = TF_MAP[tfKey] || TF_MAP.D;
    const eod = tfKey === 'D' || tfKey === 'W' || tfKey === 'M';
    const errors = [];
    if (eod) {
        try {
            const { bars } = await nasdaqDaily(symbol);
            if (!bars.length) throw new Error('nasdaq: empty');
            return tfKey === 'D' ? bars : resampleDaily(bars, tfKey);
        } catch (e) { errors.push(e.message); }
    }
    if (!eod && twelvedataKey) {
        try {
            return await twelveDataBars(symbol, tfKey, twelvedataKey);
        } catch (e) { errors.push(e.message); }
    }
    try {
        return await yahooBars(symbol, tf);
    } catch (e) { errors.push(e.message); }
    if (twelvedataKey) return twelveDataBars(symbol, tfKey, twelvedataKey);
    throw new Error(errors.join(' | ') || 'no data');
}

export function sanitizeSymbol(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
}

// ---------- search over the symbol universe ----------
// universe: [{s,n,e}] ; etfSet: Set of symbols known to be ETFs (from snapshot).
export function searchUniverse(universe, q, limit = 12, etfSet = null) {
    const uq = String(q || '').toUpperCase().trim();
    if (!uq) return [];
    const lim = Math.max(1, Math.min(50, Number(limit) || 12));
    const hits = [];
    for (const it of universe) {
        let score = -1;
        if (it.s === uq) score = 0;
        else if (it.s.startsWith(uq)) score = 1;
        else if (String(it.n || '').toUpperCase().includes(uq)) score = 2;
        if (score >= 0) hits.push([score, it]);
    }
    hits.sort((a, b) => a[0] - b[0] || (a[1].s < b[1].s ? -1 : 1));
    return hits.slice(0, lim).map(([, it]) => ({
        symbol: it.s,
        name: it.n,
        exchange: it.e,
        type: etfSet && etfSet.has(it.s) ? 'etf' : 'stock',
    }));
}

// ---------- quotes (Nasdaq daily bars; nulls when a piece is unavailable) ----------
export async function getQuote(symbol) {
    const { bars } = await nasdaqDaily(symbol);
    if (bars.length < 2) throw new Error('no quote');
    const last = bars[bars.length - 1], prev = bars[bars.length - 2];
    return {
        symbol,
        price: Number.isFinite(last.close) ? +last.close.toFixed(2) : null,
        changePct: prev.close ? +(((last.close - prev.close) / prev.close * 100).toFixed(2)) : null,
        dayHigh: Number.isFinite(last.high) ? +last.high.toFixed(2) : null,
        dayLow: Number.isFinite(last.low) ? +last.low.toFixed(2) : null,
        volume: Number.isFinite(last.volume) ? last.volume : null,
    };
}
