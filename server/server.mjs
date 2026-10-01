import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

async function getBars(symbol, tfKey, tf) {
    try {
        return await yahooBars(symbol, tf);
    } catch (e) {
        if (TD_KEY) return twelveDataBars(symbol, tfKey);
        throw e;
    }
}

// ---------- cache ----------
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
        const j = await yahooGet('query2.finance.yahoo.com', `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`);
        const out = (j?.quotes || [])
            .filter((x) => x.quoteType === 'EQUITY' || x.quoteType === 'ETF')
            .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || '' }));
        cacheSet(ck, out, SEARCH_TTL);
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: 'search unavailable' });
    }
});

app.get('/api/health', (req, res) => res.json({ ok: true, twelvedata: !!TD_KEY }));

// TEMP debug — remove before handoff
app.get('/api/debug-sources', async (req, res) => {
    const out = {};
    try { const r = await fetch('https://stooq.com/q/d/l/?s=aapl.us&i=d', { headers: { 'User-Agent': UA } }); out.stooq = r.status + ' ' + (await r.text()).slice(0, 60); } catch (e) { out.stooq = 'err ' + e.message; }
    try { const r = await fetch('https://api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks', { headers: { 'User-Agent': UA, 'Accept': 'application/json' } }); out.nasdaq = r.status + ' ' + (await r.text()).slice(0, 60); } catch (e) { out.nasdaq = 'err ' + e.message; }
    res.json(out);
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));

app.listen(PORT, () => console.log(`charts-platform on :${PORT}`));
