/**
 * dev-mock.mjs — DEV ONLY. Not for production.
 *
 * Implements the frozen contract in docs/api-contract.md against local fixtures so the
 * frontend (7d/frontend) can be built and click-tested before the real backend lands.
 * Market data comes from REAL sources only: Yahoo chart API for bars, and
 * data/scan-snapshot.json (real 2026-10-02 scan snapshot) for quotes/search/scan runs.
 * Nothing here invents prices.
 *
 * Usage:  node scripts/dev-mock.mjs   (serves API on :3000 AND ../dist if built)
 *         DEV_API_SECRET=...  (default 'dev-secret'; client fetches it from /api/config)
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const app = express();
app.use(express.json({ limit: '128kb' }));

const API_SECRET = process.env.DEV_API_SECRET || 'dev-secret';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const snap = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/scan-snapshot.json'), 'utf8'));
const universe = JSON.parse(fs.readFileSync(path.join(ROOT, 'server/universe.json'), 'utf8'));
const SPY63 = snap.feats?.SPY?.perf63 ?? 0;

// ---------- tiny file store ----------
const DATA_DIR = path.join(__dirname, '.dev-data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const store = (name, def) => {
    const file = path.join(DATA_DIR, name + '.json');
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { doc = def(); }
    const save = () => { fs.writeFileSync(file + '.tmp', JSON.stringify(doc)); fs.renameSync(file + '.tmp', file); };
    return { get: () => doc, set: (d) => { doc = d; save(); }, save };
};
const wlStore = store('watchlists', () => ({ lists: [], activeListId: null }));
const tabsStore = store('tabs', () => ({ tabs: [], activeId: null }));
const scansStore = store('custom-scans', () => ({ scans: [] }));

// ---------- auth ----------
app.get('/api/config', (req, res) => res.json({ apiSecret: API_SECRET, mock: true }));
function auth(req, res, next) {
    if (!API_SECRET) return res.status(503).json({ error: 'API_SECRET not configured' });
    if (req.headers.authorization !== `Bearer ${API_SECRET}`) return res.status(401).json({ error: 'unauthorized' });
    next();
}

// ---------- public market endpoints ----------
app.get('/api/health', (req, res) => res.json({
    ok: true,
    snapshot: { asOf: snap.asOf, count: Object.keys(snap.feats).length },
    kv: false,
}));

const TF_MAP = { '1': '1m', '5': '5m', '15': '15m', '30': '30m', '60': '1h', D: '1d', W: '1wk', M: '1mo' };
const TF_RANGE = { '1': '5d', '5': '1mo', '15': '1mo', '30': '3mo', '60': '6mo', D: '5y', W: 'max', M: 'max' };
const barCache = new Map();
async function yahooBars(symbol, tfKey) {
    const ck = `${symbol}:${tfKey}`;
    const hit = barCache.get(ck);
    if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.bars;
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${TF_MAP[tfKey] || '1d'}&range=${TF_RANGE[tfKey] || '5y'}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error('yahoo ' + r.status);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    const t = result?.timestamp || [];
    const q = result?.indicators?.quote?.[0] || {};
    const bars = [];
    for (let i = 0; i < t.length; i++) {
        const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i];
        if (o == null || h == null || l == null || c == null) continue;
        bars.push({ time: t[i] * 1000, open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? 0 });
    }
    if (!bars.length) throw new Error('no bars');
    barCache.set(ck, { t: Date.now(), bars });
    return bars;
}

app.get('/api/bars', async (req, res) => {
    try {
        const symbol = String(req.query.symbol || '').toUpperCase().replace(/[^A-Z0-9.\-^=]/g, '').slice(0, 12);
        const timeframe = String(req.query.timeframe || 'D');
        if (!symbol) return res.status(400).json({ error: 'symbol required' });
        if (!TF_MAP[timeframe]) return res.status(400).json({ error: 'bad timeframe' });
        const bars = await yahooBars(symbol, timeframe);
        res.json({ symbol, timeframe, bars, count: bars.length });
    } catch (e) { res.status(502).json({ error: 'data unavailable' }); }
});

app.get('/api/search', (req, res) => {
    const q = String(req.query.q || '').toLowerCase().slice(0, 24);
    if (!q) return res.json([]);
    const lim = Math.min(+req.query.limit || 12, 50);
    const out = universe.filter((u) => u.s.toLowerCase().startsWith(q) || u.n.toLowerCase().includes(q)).slice(0, lim)
        .map((u) => ({ symbol: u.s, name: u.n, exchange: u.e, type: 'stock' }));
    res.json(out);
});

const quoteOf = (f) => f ? ({
    symbol: f.s, price: +f.price.toFixed(2), changePct: +f.chg.toFixed(2),
    dayHigh: f.dayHigh ?? null, dayLow: f.dayLow ?? null, volume: f.vol ?? null,
}) : null;
app.get('/api/quote', (req, res) => {
    const s = String(req.query.symbol || '').toUpperCase();
    const q = quoteOf(snap.feats[s]);
    if (!q) return res.status(502).json({ error: 'quote unavailable' });
    res.json(q);
});
app.get('/api/quotes', (req, res) => {
    const out = {};
    for (const s of String(req.query.symbols || '').toUpperCase().split(',').slice(0, 100)) {
        const q = quoteOf(snap.feats[s.trim()]);
        if (q) out[q.symbol] = q;
    }
    res.json(out);
});

// ---------- scan engine (real filter math over the real snapshot) ----------
const FIELD_OF = {
    price: (f) => f.price,
    dollarVolume: (f) => f.price * f.vol,
    avgDollarVolume20: (f) => f.dvol20,
    atrPct: (f) => f.atrPct,
    gapPct: (f) => f.gap,
    relVolume: (f) => f.relVol,
    sma20: (f) => f.sma20, sma50: (f) => f.sma50, sma200: (f) => f.sma200,
    priceVsSma20Pct: (f) => (f.price - f.sma20) / f.sma20 * 100,
    priceVsSma50Pct: (f) => (f.price - f.sma50) / f.sma50 * 100,
    priceVsSma200Pct: (f) => (f.price - f.sma200) / f.sma200 * 100,
    perf5: (f) => f.perf5, perf21: (f) => f.perf21, perf63: (f) => f.perf63,
    rs63vsSpy: (f) => f.perf63 - SPY63,
    marketCap: (f) => f.mcap,
    avgVolume20: (f) => f.avgV20,
};
const OPS = {
    gt: (a, v) => a > v, gte: (a, v) => a >= v, lt: (a, v) => a < v,
    lte: (a, v) => a <= v, eq: (a, v) => a === v,
    between: (a, v, v2) => a >= Math.min(v, v2) && a <= Math.max(v, v2),
};
function runScan(criteria = [], sort, limit = 200) {
    const rows = [];
    for (const f of Object.values(snap.feats)) {
        let ok = true;
        for (const c of criteria) {
            const fn = FIELD_OF[c.field], op = OPS[c.op];
            if (!fn || !op) { ok = false; break; }
            const v = fn(f);
            if (v == null || !isFinite(v) || !op(v, +c.value, +(c.value2 ?? 0))) { ok = false; break; }
        }
        if (ok) rows.push(f);
    }
    if (sort && FIELD_OF[sort.field]) rows.sort((a, b) => (sort.dir === 'asc' ? 1 : -1) * (FIELD_OF[sort.field](a) - FIELD_OF[sort.field](b)));
    return {
        tickers: rows.slice(0, Math.min(limit, 500)).map((f) => ({
            symbol: f.s, name: f.name, price: +f.price.toFixed(2), changePct: +f.chg.toFixed(2),
            dollarVolume: f.dvol20, atrPct: +f.atrPct.toFixed(2), gapPct: +f.gap.toFixed(2),
            relVolume: +f.relVol.toFixed(2), rs63vsSpy: +(f.perf63 - SPY63).toFixed(2), marketCap: f.mcap,
        })),
        count: rows.length, ms: 0, asOf: snap.asOf,
    };
}
app.post('/api/scan/run', (req, res) => {
    const b = req.body || {};
    res.json(runScan(b.criteria || [], b.sort, b.limit));
});

// ---------- custom scans (protected) ----------
app.get('/api/scans/custom', auth, (req, res) => res.json(scansStore.get().scans));
app.post('/api/scans/custom', auth, (req, res) => {
    const { name, criteria = [], sort = null } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'name required' });
    const rec = { id: 'sc' + Date.now().toString(36), name: String(name).slice(0, 80), criteria, sort, createdAt: Date.now(), updatedAt: Date.now() };
    const d = scansStore.get(); d.scans.push(rec); scansStore.save();
    res.json(rec);
});
app.put('/api/scans/custom/:id', auth, (req, res) => {
    const d = scansStore.get(); const r = d.scans.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    Object.assign(r, { name: req.body.name ?? r.name, criteria: req.body.criteria ?? r.criteria, sort: req.body.sort ?? r.sort, updatedAt: Date.now() });
    scansStore.save(); res.json(r);
});
app.delete('/api/scans/custom/:id', auth, (req, res) => {
    const d = scansStore.get(); d.scans = d.scans.filter((x) => x.id !== req.params.id); scansStore.save();
    res.json({ ok: true });
});
app.post('/api/scans/custom/:id/run', auth, (req, res) => {
    const r = scansStore.get().scans.find((x) => x.id === req.params.id);
    if (!r) return res.status(404).json({ error: 'not found' });
    res.json(runScan(r.criteria, r.sort, req.body?.limit));
});

// ---------- watchlists v2 (protected) ----------
const COLORS = [null, 'red', 'orange', 'yellow', 'green', 'blue'];
app.get('/api/watchlists', auth, (req, res) => res.json(wlStore.get()));
app.post('/api/watchlists', auth, (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 60) || 'רשימה חדשה';
    const d = wlStore.get();
    const rec = { id: 'wl' + Date.now().toString(36), name, items: [] };
    d.lists.push(rec); d.activeListId = rec.id; wlStore.save();
    res.json(rec);
});
app.put('/api/watchlists/:id', auth, (req, res) => {
    const d = wlStore.get(); const l = d.lists.find((x) => x.id === req.params.id);
    if (!l) return res.status(404).json({ error: 'not found' });
    if (req.body?.name != null) l.name = String(req.body.name).slice(0, 60);
    if (Array.isArray(req.body?.items)) l.items = req.body.items.slice(0, 500).map((i) => ({ symbol: String(i.symbol).toUpperCase().slice(0, 12), color: COLORS.includes(i.color) ? i.color : null }));
    if (req.body?.active === true) d.activeListId = l.id;
    wlStore.save(); res.json(l);
});
app.delete('/api/watchlists/:id', auth, (req, res) => {
    const d = wlStore.get();
    d.lists = d.lists.filter((x) => x.id !== req.params.id);
    if (d.activeListId === req.params.id) d.activeListId = d.lists[0]?.id ?? null;
    wlStore.save(); res.json({ ok: true });
});

// ---------- tabs (protected) ----------
app.get('/api/tabs', auth, (req, res) => res.json(tabsStore.get()));
app.put('/api/tabs', auth, (req, res) => {
    const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs.slice(0, 30) : [];
    const doc = {
        tabs: tabs.map((t) => ({ id: String(t.id).slice(0, 32), name: String(t.name || t.symbol || 'New').slice(0, 40), symbol: String(t.symbol || 'NVDA').toUpperCase().slice(0, 12), timeframe: String(t.timeframe || 'D') })),
        activeId: req.body?.activeId ?? null,
    };
    tabsStore.set(doc); res.json(doc);
});

// ---------- static ----------
const distDir = path.join(ROOT, 'dist');
if (fs.existsSync(distDir)) app.use(express.static(distDir));
app.get(/.*/, (req, res) => {
    const idx = path.join(distDir, 'index.html');
    if (fs.existsSync(idx)) res.sendFile(idx); else res.status(404).send('build dist/ first');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[dev-mock] http://localhost:${PORT}  (DEV ONLY — not production)`));
