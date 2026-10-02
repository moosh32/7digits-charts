// Scans snapshot: builds a liquid US-stock universe with precomputed daily
// features from the official Nasdaq API (no key). Refreshed in background.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SNAP_PATH = path.join(DATA_DIR, 'scan-snapshot.json');
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const num = (s) => parseFloat(String(s).replace(/[$,]/g, ''));
const int = (s) => parseInt(String(s).replace(/,/g, ''), 10) || 0;

const fetchT = (url, opts = {}, ms = 15000) =>
    fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });

export async function nasdaqDaily(symbol, etfFirst = false) {
    const order = etfFirst ? ['etf', 'stocks'] : ['stocks', 'etf'];
    for (const ac of order) {
        try {
            const r = await fetchT(
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
            if (bars.length) return { bars: bars.reverse(), etf: ac === 'etf' };
        } catch { /* next */ }
    }
    return { bars: [], etf: false };
}

async function screenerPage(exchange, offset, limit = 1000) {
    const r = await fetchT(
        `https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=${limit}&offset=${offset}&exchange=${exchange}`,
        { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error('screener ' + r.status);
    const j = await r.json();
    return { rows: j?.data?.table?.rows || [], total: j?.data?.totalrecords || 0 };
}

function parseMoney(s) {
    if (s == null) return 0;
    return parseFloat(String(s).replace(/[$,]/g, '')) || 0;
}

export async function fetchUniverse() {
    const out = [];
    for (const ex of ['nasdaq', 'nyse', 'amex']) {
        let offset = 0, total = Infinity;
        while (offset < total) {
            const { rows, total: t } = await screenerPage(ex, offset);
            total = t;
            for (const r of rows) {
                const price = parseMoney(r.lastsale);
                const mcap = parseMoney(r.marketCap);
                if (price >= 2 && mcap >= 30_000_000 && r.symbol && !/[^A-Z0-9.\-]/.test(r.symbol))
                    out.push({ s: r.symbol, n: String(r.name || '').replace(/ Common Stock.*$/, ''), price, mcap });
            }
            offset += rows.length;
            if (!rows.length) break;
        }
    }
    const seen = new Set();
    return out.filter((x) => (seen.has(x.s) ? false : (seen.add(x.s), true)));
}

// ETFs: separate screener (no marketCap column); used only by the liquid-ETF scan.
export async function fetchEtfUniverse() {
    const out = [];
    let offset = 0, total = Infinity;
    while (offset < total) {
        const r = await fetchT(
            `https://api.nasdaq.com/api/screener/etf?tableonly=true&limit=1000&offset=${offset}`,
            { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
        if (!r.ok) throw new Error('etf screener ' + r.status);
        const j = await r.json();
        const rows = j?.data?.records?.data?.rows || [];
        total = j?.data?.records?.totalrecords || 0;
        for (const row of rows) {
            const price = parseMoney(row.lastSalePrice);
            if (price >= 2 && row.symbol && !/[^A-Z0-9.\-]/.test(row.symbol))
                out.push({ s: row.symbol, n: String(row.companyName || ''), price });
        }
        offset += rows.length;
        if (!rows.length) break;
    }
    const seen = new Set();
    return out.filter((x) => (seen.has(x.s) ? false : (seen.add(x.s), true)));
}

// ---------- feature math ----------
const sma = (a, k) => { if (a.length < k) return null; let s = 0; for (let i = a.length - k; i < a.length; i++) s += a[i]; return s / k; };
const ema = (a, k) => {
    if (a.length < k) return null;
    const m = 2 / (k + 1);
    let e = a[a.length - k];
    for (let i = a.length - k + 1; i < a.length; i++) e = a[i] * m + e * (1 - m);
    return e;
};
const hi = (a, k) => Math.max(...a.slice(-k));
const lo = (a, k) => Math.min(...a.slice(-k));

export function computeFeatures(sym, name, bars, meta = {}) {
    const n = bars.length;
    if (n < 60) return null;
    const C = bars.map((b) => b.close), H = bars.map((b) => b.high),
        L = bars.map((b) => b.low), V = bars.map((b) => b.volume);
    const last = bars[n - 1], prev = bars[n - 2];
    const perf = (k) => {
        if (n - 1 - k < 0 || C[n - 1 - k] <= 0) return null;
        const v = (last.close / C[n - 1 - k] - 1) * 100;
        // a listed $2+ stock cannot lose more than 99.99% — such prints are split-adjustment artifacts
        return v < -99.99 ? null : v;
    };
    const rets = [];
    for (let i = Math.max(1, n - 22); i < n; i++) rets.push(C[i] / C[i - 1] - 1);
    const std = (a) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length); };
    // ATR14
    const trs = [];
    for (let i = Math.max(1, n - 15); i < n; i++)
        trs.push(Math.max(H[i] - L[i], Math.abs(H[i] - C[i - 1]), Math.abs(L[i] - C[i - 1])));
    const atr14 = trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : null;
    // ADR20 (intraday range only, no gaps — Qullamaggie style)
    let adr = 0, adrn = 0;
    for (let i = n - Math.min(20, n); i < n; i++) { adr += (H[i] - L[i]) / C[i]; adrn++; }
    const avgV = (k) => sma(V, k);
    const dvol = (k) => { const m = Math.min(k, n); let s = 0; for (let i = n - m; i < n; i++) s += C[i] * V[i]; return s / m; };
    let upDays = 0;
    for (let i = n - 1; i > 0 && C[i] > C[i - 1]; i--) upDays++;
    const h52 = hi(H, Math.min(252, n)), l52 = lo(L, Math.min(252, n));
    return {
        s: sym, name,
        mcap: meta.mcap || 0, etf: !!meta.etf,
        price: last.close, prevClose: prev.close,
        dayHigh: last.high, dayLow: last.low, dayOpen: last.open,
        hiAll: Math.max(...H),
        chg: prev.close ? (last.close / prev.close - 1) * 100 : 0,
        gap: prev.close ? (last.open / prev.close - 1) * 100 : 0,
        vol: last.volume, volPrev: prev.volume,
        avgV20: avgV(20), avgV40: avgV(40), avgV60: avgV(60),
        relVol: avgV(20) ? last.volume / avgV(20) : 0,
        dvol20: dvol(20),
        perf5: perf(5), perf21: perf(21), perf63: perf(63), perf126: perf(126), perf252: perf(252), perf1260: perf(1260),
        atrPct: atr14 && last.close ? (atr14 / last.close) * 100 : null,
        adr20: adrn ? (adr / adrn) * 100 : null,
        mvol: rets.length > 2 ? std(rets) * 100 : null,
        wvol: (() => { const w = rets.slice(-5); return w.length > 2 ? std(w) * 100 : null; })(),
        sma20: sma(C, 20), sma50: sma(C, 50), sma200: sma(C, 200),
        ema5: ema(C, 5), ema6: ema(C, 6), ema7: ema(C, 7), ema20: ema(C, 20), ema60: ema(C, 60), ema65: ema(C, 65),
        hi5: hi(H, 5), lo5: lo(L, 5), hi10: hi(H, 10), lo10: lo(L, 10),
        hi20: hi(H, 20), lo20: lo(L, 20), hi30: hi(H, 30), lo30: lo(L, 30),
        hi60: hi(H, 60), lo60: lo(L, 60), hi90: hi(H, 90), lo90: lo(L, 90),
        hi52: h52, lo52: l52,
        upDays, bars: n,
        range10: (hi(H, 10) - lo(L, 10)) / last.close * 100,
        range30: (hi(H, 30) - lo(L, 30)) / last.close * 100,
        // min low of days [n-25, n-6] — for undercut & rally (excludes last 5 days)
        loPrev: (() => { const seg = L.slice(Math.max(0, n - 25), Math.max(0, n - 5)); return seg.length ? Math.min(...seg) : null; })(),
        // avg volume of the consolidation window vs earlier — for anticipation
        avgV15: sma(V, 15),
    };
}

// ---------- snapshot lifecycle ----------
let snapshot = null; // { asOf, feats: { sym: f } }
let refreshing = false;

export function getSnapshot() { return snapshot; }

function save() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SNAP_PATH, JSON.stringify(snapshot));
    } catch (e) { console.error('scan snapshot save failed', e.message); }
}
function load() {
    try {
        if (fs.existsSync(SNAP_PATH)) {
            snapshot = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
            console.log(`scan snapshot loaded: ${Object.keys(snapshot.feats).length} stocks + ${Object.keys(snapshot.etfFeats || {}).length} ETFs, asOf ${snapshot.asOf}`);
        }
    } catch (e) { console.error('scan snapshot load failed', e.message); }
}

async function pool(items, conc, fn) {
    const out = [];
    let i = 0;
    const workers = Array.from({ length: conc }, async () => {
        while (i < items.length) {
            const idx = i++;
            try { out[idx] = await fn(items[idx]); } catch { out[idx] = null; }
        }
    });
    await Promise.all(workers);
    return out;
}

export async function refreshSnapshot() {
    if (refreshing) return false;
    refreshing = true;
    try {
        console.log('scan snapshot refresh: fetching universe…');
        const uni = await fetchUniverse();
        console.log(`scan snapshot: ${uni.length} liquid symbols, fetching bars…`);
        const feats = {};
        let done = 0;
        const results = await pool(uni, 16, async (u) => {
            const { bars, etf } = await nasdaqDaily(u.s);
            if (++done % 500 === 0) console.log(`scan snapshot: ${done}/${uni.length}…`);
            if (!bars.length) return null;
            return computeFeatures(u.s, u.n, bars, { mcap: u.mcap, etf });
        });
        let ok = 0;
        const prev = snapshot?.feats || {};
        for (const f of results) if (f) { feats[f.s] = f; ok++; }
        // keep last-good features for symbols that failed this refresh
        for (const sym of Object.keys(prev)) if (!feats[sym]) feats[sym] = prev[sym];
        // ETFs (separate universe — only the liquid-ETF scan uses these)
        console.log('scan snapshot: fetching ETF universe…');
        const etfUni = (await fetchEtfUniverse()).filter((u) => !feats[u.s]);
        console.log(`scan snapshot: ${etfUni.length} ETFs, fetching bars…`);
        const etfFeats = {};
        let edone = 0;
        const eresults = await pool(etfUni, 12, async (u) => {
            const { bars } = await nasdaqDaily(u.s, true);
            if (++edone % 500 === 0) console.log(`scan snapshot ETFs: ${edone}/${etfUni.length}…`);
            if (!bars.length) return null;
            return computeFeatures(u.s, u.n, bars, { etf: true });
        });
        let eok = 0;
        const prevEtf = snapshot?.etfFeats || {};
        for (const f of eresults) if (f) { etfFeats[f.s] = f; eok++; }
        for (const sym of Object.keys(prevEtf)) if (!etfFeats[sym]) etfFeats[sym] = prevEtf[sym];
        snapshot = { asOf: new Date().toISOString(), feats, etfFeats };
        save();
        console.log(`scan snapshot done: ${ok} stocks + ${eok} ETFs`);
        return true;
    } catch (e) {
        console.error('scan snapshot refresh failed:', e.message);
        return false;
    } finally {
        refreshing = false;
    }
}

export function startScanEngine() {
    load();
    if (!snapshot) setTimeout(() => refreshSnapshot(), 5000);
    setInterval(() => refreshSnapshot(), 4 * 60 * 60 * 1000);
}
