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

let yahooCookie = '';

async function yahoo(host, p) {
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
        } catch { /* fall through to error */ }
    }
    if (!r.ok) throw new Error(`yahoo ${r.status}`);
    return r.json();
}

app.get('/api/bars', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
        const tf = TF_MAP[String(req.query.timeframe)] || TF_MAP.D;
        if (!symbol) return res.status(400).json({ error: 'symbol required' });
        const j = await yahoo('query1.finance.yahoo.com', `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${tf.interval}&range=${tf.range}`);
        const result = j?.chart?.result?.[0];
        const t = result?.timestamp || [];
        const q = result?.indicators?.quote?.[0] || {};
        const bars = [];
        for (let i = 0; i < t.length; i++) {
            const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
            if (o == null || h == null || l == null || c == null) continue;
            bars.push({ time: t[i] * 1000, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
        }
        if (!bars.length) return res.status(404).json({ error: 'no data' });
        res.json(bars);
    } catch (e) {
        res.status(502).json({ error: 'data unavailable', detail: String(e.message || e).slice(0, 120) });
    }
});

app.get('/api/search', async (req, res) => {
    try {
        const q = String(req.query.q || '').slice(0, 24);
        if (q.length < 1) return res.json([]);
        const j = await yahoo('query2.finance.yahoo.com', `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0`);
        const out = (j?.quotes || [])
            .filter((x) => x.quoteType === 'EQUITY' || x.quoteType === 'ETF')
            .map((x) => ({ symbol: x.symbol, name: x.shortname || x.longname || x.symbol, exchange: x.exchDisp || x.exchange || '' }));
        res.json(out);
    } catch (e) {
        res.status(502).json({ error: 'search unavailable' });
    }
});

app.use(express.static(path.join(__dirname, '..', 'dist')));
app.use((req, res) => res.sendFile(path.join(__dirname, '..', 'dist', 'index.html')));

app.listen(PORT, () => console.log(`charts-platform on :${PORT}`));
