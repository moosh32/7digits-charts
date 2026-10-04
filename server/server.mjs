import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startScanEngine } from './scans/snapshot.mjs';
import { listScanners, runScanner } from './scans/definitions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const TF_MAP = {
    '1':  { interval: '1m',  range: '5d'  },
    '5':  { interval: '5m',  range: '1mo' },
    '15': { interval: '15m', range: '1mo' },
    '30': { interval: '30m', range: '3mo' },
    '60': { interval: '1h',  range: '6mo' },
    'D':  { interval: '1d',  range: '5y'  },
    'W':  { interval: '1wk', range: 'max' },
    'M':  { interval: '1mo', range: 'max' },
};

// ---------- Yahoo (primary, no key) ----------
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

// ---------- Twelve Data (fallback, needs TWELVEDATA_KEY) ----------
const TD_KEY = process.env.TWELVEDATA_KEY || '';
const TD_INTERVAL = { '1': '1min', '5': '5min', '15': '15min', '30': '30min', '60': '1h', D: '1day', W: '1week', M: '1month' };

async function twelveDataBars(symbol, tfKey) {
    if (!TD_KEY) throw new Error('no twelvedata key');
    const iv = TD_INTERVAL[tfKey] || '1day';
    const intraday = iv.includes('min') || iv === '1h';
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${iv}&outputsize=5000&apikey=${TD_KEY}&timezone=America/New_York`;
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    const j = await r.json();
    const vals = j?.values;
    if (!vals?.length) throw new Error('twelvedata: ' + (j?.message || r.status));
    return vals.map((v) => ({
        time: new Date(intraday ? v.datetime : v.datetime + 'T00:00:00').getTime(),
        open: +v.open, high: +v.high, low: +v.low, close: +v.close, volume: +(v.volume || 0),
    })).reverse();
}

// ---------- Nasdaq official API (primary for D/W/M, no key) ----------
const num = (s) => parseFloat(String(s).replace(/[$,]/g, ''));
const int = (s) => parseInt(String(s).replace(/,/g, ''), 10) || 0;

async function nasdaqDaily(symbol) {
    for (const ac of ['stocks', 'etf']) {
        const r = await fetch(
            `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${ac}&fromdate=2000-01-01&limit=9999`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (!r.ok) continue;
        const rows = (await r.json())?.data?.tradesTable?.rows || [];
        const bars = rows.map((row) => ({
            time: new Date(row.date + ' 00:00:00 +0000').getTime(),
            open: num(row.open), high: num(row.high), low: num(row.low),
            close: num(row.close), volume: int(row.volume),
        })).filter((b) => isFinite(b.time) && isFinite(b.open) && isFinite(b.high) && isFinite(b.low) && isFinite(b.close)
            // drop degenerate placeholder rows (sub-penny print on ~no volume — Nasdaq data glitches)
            && !(b.close < 0.01 && b.volume < 1000));
        if (bars.length) return bars.reverse(); // newest-first -> chronological
    }
    throw new Error('nasdaq: empty');
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

async function getBars(symbol, tfKey, tf) {
    const eod = tfKey === 'D' || tfKey === 'W' || tfKey === 'M';
    const errors = [];
    if (eod) {
        try {
            const d = await nasdaqDaily(symbol);
            return tfKey === 'D' ? d : resampleDaily(d, tfKey);
        } catch (e) { errors.push(e.message); }
    }
    if (!eod && TD_KEY) {
        try {
            return await twelveDataBars(symbol, tfKey);
        } catch (e) { errors.push(e.message); }
    }
    try {
        return await yahooBars(symbol, tf);
    } catch (e) { errors.push(e.message); }
    if (TD_KEY) return twelveDataBars(symbol, tfKey);
    throw new Error(errors.join(' | ') || 'no data');
}

// ---------- symbol universe (official Nasdaq Trader symbol directories) ----------
const UNIVERSE = JSON.parse(fs.readFileSync(new URL('./universe.json', import.meta.url), 'utf8'));

function searchUniverse(q) {
    const uq = q.toUpperCase().trim();
    if (!uq) return [];
    const hits = [];
    for (const it of UNIVERSE) {
        let score = -1;
        if (it.s === uq) score = 0;
        else if (it.s.startsWith(uq)) score = 1;
        else if (it.n.toUpperCase().includes(uq)) score = 2;
        if (score >= 0) hits.push([score, it]);
    }
    hits.sort((a, b) => a[0] - b[0] || (a[1].s < b[1].s ? -1 : 1));
    return hits.slice(0, 12).map(([, it]) => ({ symbol: it.s, name: it.n, exchange: it.e }));
}
const cache = new Map();
const INTRADAY_TTL = 5 * 60 * 1000;
const DAILY_TTL = 4 * 60 * 60 * 1000;
const SEARCH_TTL = 60 * 60 * 1000;

function cacheGet(key) {
    const e = cache.get(key);
    if (e && Date.now() < e.exp) return e.val;
    cache.delete(key);
    return null;
}
function cacheSet(key, val, ttlMs) {
    if (cache.size > 500) cache.clear();
    cache.set(key, { val, exp: Date.now() + ttlMs });
}

// ---------- routes ----------
app.get('/api/bars', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
        const tfKey = String(req.query.timeframe);
        const tf = TF_MAP[tfKey] || TF_MAP.D;
        if (!symbol) return res.status(400).json({ error: 'symbol required' });
        const ck = `bars:${symbol}:${tfKey}`;
        const hit = cacheGet(ck);
        if (hit) return res.json(hit);
        const bars = await getBars(symbol, tfKey, tf);
        cacheSet(ck, bars, ['1', '5', '15', '30', '60'].includes(tfKey) ? INTRADAY_TTL : DAILY_TTL);
        res.json(bars);
    } catch (e) {
        res.status(502).json({ error: 'data unavailable', detail: String(e.message || e).slice(0, 120) });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').slice(0, 24);
        if (q.length < 1) return res.json([]);
        const ck = `search:${q.toLowerCase()}`;
        const hit = cacheGet(ck);
        if (hit) return res.json(hit);
        const out = searchUniverse(q);
        cacheSet(ck, out, SEARCH_TTL);
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: 'search unavailable' });
    }
});

app.get('/api/health', (req, res) => res.json({ ok: true, twelvedata: !!TD_KEY }));

app.get('/api/quote', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
        if (!symbol) return res.status(400).json({ error: 'symbol required' });
        const ck = `quote:${symbol}`;
        const hit = cacheGet(ck);
        if (hit) return res.json(hit);
        const bars = await nasdaqDaily(symbol);
        if (bars.length < 2) throw new Error('no quote');
        const last = bars[bars.length - 1], prev = bars[bars.length - 2];
        const out = {
            symbol,
            price: +last.close.toFixed(2),
            changePct: prev.close ? +(((last.close - prev.close) / prev.close * 100).toFixed(2)) : 0,
        };
        cacheSet(ck, out, 60 * 1000);
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: 'quote unavailable' });
    }
});

app.get('/api/scans', (req, res) => res.json(listScanners()));

// batch quotes for the watchlist: one request instead of one per symbol
app.get('/api/quotes', async (req, res) => {
    try {
        const symbols = String(req.query.symbols || '').toUpperCase().split(',')
            .map((s) => s.replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12))
            .filter(Boolean).slice(0, 100);
        const out = {};
        await Promise.all(symbols.map(async (symbol) => {
            try {
                const ck = `quote:${symbol}`;
                const hit = cacheGet(ck);
                if (hit) { out[symbol] = hit; return; }
                const bars = await nasdaqDaily(symbol);
                if (bars.length < 2) return;
                const last = bars[bars.length - 1], prev = bars[bars.length - 2];
                const q = {
                    symbol,
                    price: +last.close.toFixed(2),
                    changePct: prev.close ? +(((last.close - prev.close) / prev.close * 100).toFixed(2)) : 0,
                };
                cacheSet(ck, q, 60 * 1000);
                out[symbol] = q;
            } catch { /* skip failed symbols */ }
        }));
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: 'quotes unavailable' });
    }
});

app.get('/api/scan/:id', (req, res) => {
    const out = runScanner(req.params.id);
    if (!out) return res.status(404).json({ error: 'unknown scanner' });
    if (out.error) return res.status(503).json(out);
    res.json(out);
});

// ---------- Watchlist server sync (flags + sort/filter prefs) ----------
// Small single-user store: JSON file on a mounted volume (WL_DATA_DIR).
// Auth: Bearer token must equal WATCHLIST_SECRET. If the secret is not set,
// the endpoints answer 503 and clients stay in localStorage-only mode.
app.use(express.json({ limit: '64kb' }));
const WL_SECRET = process.env.WATCHLIST_SECRET || '';
const WL_DIR = process.env.WL_DATA_DIR || '/data';
const WL_FILE = path.join(WL_DIR, 'watchlist.json');
const WL_DEFAULTS = [
    { s: 'SPY', n: 'S&P 500 ETF', flag: null },
    { s: 'QQQ', n: 'Nasdaq 100 ETF', flag: null },
    { s: 'NVDA', n: 'NVIDIA Corporation', flag: null },
    { s: 'AAPL', n: 'Apple Inc', flag: null },
    { s: 'TSLA', n: 'Tesla Inc', flag: null },
    { s: 'MSFT', n: 'Microsoft Corporation', flag: null },
];
function wlDocDefault() {
    return { items: WL_DEFAULTS.map((x) => ({ ...x })), sort: 'symbol', filter: 'all', updatedAt: 0 };
}
function wlRead() {
    try {
        const d = JSON.parse(fs.readFileSync(WL_FILE, 'utf8'));
        if (!Array.isArray(d.items)) return wlDocDefault();
        return {
            items: d.items,
            sort: d.sort || 'symbol',
            filter: d.filter || 'all',
            updatedAt: d.updatedAt || 0,
        };
    } catch { return wlDocDefault(); }
}
function wlWrite(doc) {
    fs.mkdirSync(WL_DIR, { recursive: true });
    const tmp = WL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(doc));
    fs.renameSync(tmp, WL_FILE);
}
const wlAuth = (req, res, next) => {
    if (!WL_SECRET) return res.status(503).json({ error: 'watchlist sync not configured' });
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!t || t !== WL_SECRET) return res.status(401).json({ error: 'unauthorized' });
    next();
};
app.get('/api/watchlist', wlAuth, (req, res) => res.json(wlRead()));
app.put('/api/watchlist', wlAuth, (req, res) => {
    const b = req.body || {};
    if (!Array.isArray(b.items) || b.items.length > 500) {
        return res.status(400).json({ error: 'bad items' });
    }
    const items = b.items.slice(0, 500).map((x) => ({
        s: String(x.s || '').toUpperCase().slice(0, 12),
        n: String(x.n || '').slice(0, 80),
        flag: ['red', 'orange', 'yellow', 'green', 'blue'].includes(x.flag) ? x.flag : null,
    })).filter((x) => x.s);
    const sort = ['symbol', 'change-desc', 'change-asc'].includes(b.sort) ? b.sort : 'symbol';
    const filter = (b.filter === 'all' || ['red', 'orange', 'yellow', 'green', 'blue'].includes(b.filter)) ? b.filter : 'all';
    const doc = { items, sort, filter, updatedAt: Date.now() };
    try { wlWrite(doc); } catch { return res.status(500).json({ error: 'write failed' }); }
    res.json({ ok: true, updatedAt: doc.updatedAt });
});

// ---------- Market breadth store ----------
// Daily advance/decline records per exchange, fed by an external daily pull
// service (see BREADTH-FEED.md). Served to the breadth drawer as-is;
// the client computes the cumulative A/D line.
const BR_SECRET = process.env.BREADTH_SECRET || '';
const BR_FILE = path.join(WL_DIR, 'breadth.json');
function brRead() {
    try {
        const d = JSON.parse(fs.readFileSync(BR_FILE, 'utf8'));
        if (!Array.isArray(d.records)) return { records: [] };
        return { records: d.records };
    } catch { return { records: [] }; }
}
function brWrite(records) {
    fs.mkdirSync(WL_DIR, { recursive: true });
    const tmp = BR_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ records }));
    fs.renameSync(tmp, BR_FILE);
}
const brAuth = (req, res, next) => {
    if (!BR_SECRET) return res.status(503).json({ error: 'breadth feed not configured' });
    const t = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!t || t !== BR_SECRET) return res.status(401).json({ error: 'unauthorized' });
    next();
};
// Bulk upsert: {records:[{d:'YYYY-MM-DD', exchange:'nasdaq'|'nyse', adv, dec, net}]}
app.post('/api/breadth', brAuth, (req, res) => {
    const recs = (req.body && req.body.records) || [];
    if (!Array.isArray(recs) || recs.length > 2000) {
        return res.status(400).json({ error: 'bad records' });
    }
    const clean = [];
    for (const r of recs) {
        if (!r || typeof r.d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.d)) continue;
        if (r.exchange !== 'nasdaq' && r.exchange !== 'nyse') continue;
        const adv = Number(r.adv), dec = Number(r.dec);
        if (!Number.isFinite(adv) || !Number.isFinite(dec)) continue;
        const net = Number.isFinite(Number(r.net)) ? Number(r.net) : adv - dec;
        clean.push({ d: r.d, exchange: r.exchange, adv, dec, net });
    }
    if (!clean.length) return res.status(400).json({ error: 'no valid records' });
    const map = new Map(brRead().records.map((r) => [`${r.exchange}|${r.d}`, r]));
    for (const r of clean) map.set(`${r.exchange}|${r.d}`, r);
    const records = [...map.values()].sort((a, b) =>
        a.exchange === b.exchange ? (a.d < b.d ? -1 : 1) : (a.exchange < b.exchange ? -1 : 1));
    try { brWrite(records); } catch { return res.status(500).json({ error: 'write failed' }); }
    res.json({ ok: true, upserted: clean.length, total: records.length });
});
app.get('/api/breadth', (req, res) => {
    const ex = req.query.exchange === 'nyse' ? 'nyse' : 'nasdaq';
    const records = brRead().records.filter((r) => r.exchange === ex);
    res.json({ exchange: ex, records });
});

startScanEngine();

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));

app.listen(PORT, () => console.log(`charts-platform on :${PORT}`));
