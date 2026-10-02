// Scans snapshot: builds a liquid US-stock universe with precomputed daily
// features from the official Nasdaq API (no key). Refreshed in background.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SNAP_PATH = path.join(DATA_DIR, 'scan-snapshot.json');
// Bump when computeFeatures gains/loses fields — forces a rebuild on next start.
const SNAP_VERSION = 2;
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

// Leveraged single-stock ETFs missing from Nasdaq's ETF screener (verified live 2026-10-02).
const LEVERAGED_ETFS = JSON.parse(fs.readFileSync(new URL('./leveraged-etfs.json', import.meta.url), 'utf8'));

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
    // append curated leveraged ETFs absent from the screener
    const have = new Set(out.map((x) => x.s));
    for (const x of LEVERAGED_ETFS) {
        if (!have.has(x.s) && /^[A-Z0-9.\-]{1,10}$/.test(x.s)) {
            out.push({ s: x.s, n: x.n, price: 10 }); // placeholder; real bars price it
            have.add(x.s);
        }
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
// EMA(k) ending at index `end` (inclusive) — full-history warmup (seed = SMA of
// first k closes), alpha = 2/(k+1). Standard method; used by ported builder scans.
const emaAt = (a, k, end) => {
    if (end + 1 < k || end < 0) return null;
    let e = 0;
    for (let i = 0; i < k; i++) e += a[i];
    e /= k;
    const m = 2 / (k + 1);
    for (let i = k; i <= end; i++) e = a[i] * m + e * (1 - m);
    return e;
};
const hi = (a, k) => Math.max(...a.slice(-k));
const lo = (a, k) => Math.min(...a.slice(-k));

// ---- ported builder scans: window-pattern helpers (pure, scalar results) ----

// FLAG 40%+ : tight flag (k = 5..15 days, smallest first) after a pole run.
// flag bars = t-1..t-k ; pole window = `poleWin` bars before the flag.
function flagScan(C, H, L, V, n, minRun, poleWin) {
    const t = n - 1;
    for (let k = 5; k <= 15; k++) {
        const f0 = t - k, f1 = t - 1; // flag window (k bars)
        if (f0 - poleWin < 0) continue;
        let ch = -Infinity, cl = Infinity;
        for (let i = f0; i <= f1; i++) { if (H[i] > ch) ch = H[i]; if (L[i] < cl) cl = L[i]; }
        let pl = Infinity;
        for (let i = f0 - poleWin; i < f0; i++) if (L[i] < pl) pl = L[i];
        if (!((ch / pl - 1) * 100 >= minRun)) continue;
        if (!((ch - cl) / ch * 100 <= 25)) continue;
        // contraction: avg(high-low) of last floor(k/2) flag days < avg of earlier half
        const m = Math.floor(k / 2), e = k - m;
        let aE = 0, aL = 0;
        for (let i = f0; i < f0 + e; i++) aE += H[i] - L[i];
        for (let i = f0 + e; i <= f1; i++) aL += H[i] - L[i];
        if (!(aL / m < aE / e)) continue;
        // optional vol dry-up: flag avg vol < avg vol of 10 days before flag
        let fv = 0, bv = 0;
        for (let i = f0; i <= f1; i++) fv += V[i];
        for (let i = f0 - 10; i < f0; i++) bv += V[i];
        return { k, ch, cl, pl, run: (ch / pl - 1) * 100, depth: (ch - cl) / ch * 100, volDryUp: (fv / k) < (bv / 10) };
    }
    return null;
}

// VCP: EMA8>EMA21>EMA50 all rising (t vs t-1), 120 bars; pivot = highest high of
// 60 bars before t, base t-pivot>=10, depth<25%, close>=0.88*pivot, thirds
// contraction d1>d2>d3, vol dry-up (avg 10d < avg base). Grade BREAKING/PRIMED/FORMING.
function vcp(C, H, L, V, n) {
    if (n < 120) return null;
    const t = n - 1;
    const e8 = emaAt(C, 8, t), e8p = emaAt(C, 8, t - 1);
    const e21 = emaAt(C, 21, t), e21p = emaAt(C, 21, t - 1);
    const e50 = emaAt(C, 50, t), e50p = emaAt(C, 50, t - 1);
    if (!(e8 > e21 && e21 > e50)) return null;
    if (!(e8 > e8p && e21 > e21p && e50 > e50p)) return null;
    let pv = -Infinity, pi = -1;
    for (let i = t - 60; i < t; i++) if (H[i] >= pv) { pv = H[i]; pi = i; }
    if (t - pi < 10) return null;
    let mn = Infinity;
    for (let i = pi; i <= t; i++) if (L[i] < mn) mn = L[i];
    const depth = (pv - mn) / pv;
    if (!(depth < 0.25)) return null;
    if (!(C[t] >= 0.88 * pv)) return null;
    const len = t - pi + 1;
    const b1 = pi + Math.floor(len / 3), b2 = pi + Math.floor(2 * len / 3);
    const segs = [[pi, b1 - 1], [b1, b2 - 1], [b2, t]];
    const ds = segs.map(([a, b]) => {
        let mx = -Infinity, mnn = Infinity;
        for (let i = a; i <= b; i++) { if (H[i] > mx) mx = H[i]; if (L[i] < mnn) mnn = L[i]; }
        return (mx - mnn) / mx;
    });
    if (!(ds[0] > ds[1] && ds[1] > ds[2])) return null;
    let v10 = 0, vb = 0;
    for (let i = t - 9; i <= t; i++) v10 += V[i];
    for (let i = pi; i <= t; i++) vb += V[i];
    if (!((v10 / 10) < (vb / len))) return null;
    const grade = C[t] > pv ? 'BREAKING' : (C[t] >= pv * 0.95 ? 'PRIMED' : 'FORMING');
    return { grade, depth: depth * 100, baseLen: len };
}

// HTF DJYLAB (high/low version): peak 10-25 days before t, pole + tight flag.
function djylab(C, H, L, V, n) {
    const t = n - 1;
    for (let p = t - 10; p >= t - 25; p--) {
        if (p < 41) continue;
        let broken = false;
        for (let i = p + 1; i <= t; i++) if (H[i] >= H[p]) { broken = true; break; }
        if (broken) continue; // peak must be unbroken
        let li = p - 1, lv = Infinity;
        for (let i = Math.max(0, p - 40); i < p; i++) if (L[i] < lv) { lv = L[i]; li = i; }
        const poleLen = p - li;
        if (poleLen < 3 || poleLen > 40) continue;
        let abovePeak = false;
        for (let i = li + 1; i < p; i++) if (H[i] > H[p]) { abovePeak = true; break; }
        if (abovePeak) continue;
        const gain = H[p] / L[li] - 1;
        if (gain < 1) continue; // need >= 100%
        if (li < 5) continue;
        let pmax = 0, bsum = 0;
        for (let i = li; i <= p; i++) if (V[i] > pmax) pmax = V[i];
        for (let i = li - 5; i < li; i++) bsum += V[i];
        if (!(pmax >= 1.3 * (bsum / 5))) continue;
        let fmin = Infinity, fsum = 0, psum = 0;
        for (let i = p + 1; i <= t; i++) { if (L[i] < fmin) fmin = L[i]; fsum += V[i]; }
        const fc = t - p;
        if (fc <= 0) continue;
        for (let i = li; i <= p; i++) psum += V[i];
        const depth = (H[p] - fmin) / H[p];
        if (depth > 0.25) continue;
        if (!((fsum / fc) <= 0.75 * (psum / (p - li + 1)))) continue;
        // near-top is a qualifier, not a hard filter (parity 2026-10-02: ref hit NIQ
        // sits 12% below peak — the builder's implementation does not filter on it)
        const nearTop = C[t] >= H[p] * 0.97;
        return { peak: H[p], gain: gain * 100, depth: depth * 100, poleLen, nearTop, belowPeak: (1 - C[t] / H[p]) * 100 };
    }
    return null;
}

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
    // ---- ported builder scans (part 1): RS / inside bars / volume extremes ----
    // t-1, t-2 bar extremes (double inside bar)
    const hi1 = H[n - 2], lo1 = L[n - 2], hi2 = H[n - 3], lo2 = L[n - 3];
    // volume extremes: 252d incl t ; all history excl first (IPO) bar
    const volMax252 = Math.max(...V.slice(-252));
    const volMaxAll = Math.max(...V.slice(1));
    // liquidity flag — informational only, NEVER a pre-filter (builder spec)
    const liqFlag = last.close >= 10 && dvol(20) >= 5_000_000;
    // split suspect: one-day close jump > 40%
    const chg1d = prev.close ? ((last.close / prev.close) - 1) * 100 : 0;
    const splitSuspect = chg1d > 40;
    // RS vs SPY: date-aligned closes, need 252 shared days
    let rsShared = 0, rsNewHigh252 = null;
    const spy = meta.spy;
    if (spy) {
        const rsv = [];
        for (let i = 0; i < n; i++) {
            const d = new Date(bars[i].time).toISOString().slice(0, 10);
            const sp = spy.get(d);
            if (sp && C[i] > 0) rsv.push(C[i] / sp);
        }
        rsShared = rsv.length;
        if (rsShared >= 252) {
            const w = rsv.slice(-252);
            const mx = Math.max(...w);
            rsNewHigh252 = w[w.length - 1] >= mx;
        }
    }
    const maxClose252 = Math.max(...C.slice(-252));
    const rsGap = maxClose252 > 0 ? ((maxClose252 - last.close) / maxClose252) * 100 : null;
    // ---- ported builder scans (part 2): flag / HTF-DJYLAB trend EMAs ----
    const ema10 = emaAt(C, 10, n - 1), ema10Lag3 = emaAt(C, 10, n - 4), ema20Lag3 = emaAt(C, 20, n - 4);
    const flag40 = flagScan(C, H, L, V, n, 40, 20);
    const flagHtf = flagScan(C, H, L, V, n, 90, 40);
    const djy = djylab(C, H, L, V, n);
    return {
        s: sym, name,
        mcap: meta.mcap || 0, etf: !!meta.etf,
        price: last.close, prevClose: prev.close,
        dayHigh: last.high, dayLow: last.low, dayOpen: last.open,
        hi1, lo1, hi2, lo2,
        volMax252, volMaxAll, liqFlag, splitSuspect,
        rsShared, rsNewHigh252, rsGap, maxClose252,
        ema10, ema10Lag3, ema20Lag3, flag40, flagHtf, djy, vcp: vcp(C, H, L, V, n),
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
        console.log('scan snapshot: fetching SPY bars for RS alignment…');
        const spyBars = (await nasdaqDaily('SPY')).bars;
        const spyMap = new Map();
        for (const b of spyBars) spyMap.set(new Date(b.time).toISOString().slice(0, 10), b.close);
        console.log(`scan snapshot: SPY bars ${spyBars.length}, fetching bars…`);
        const feats = {};
        let done = 0;
        const results = await pool(uni, 16, async (u) => {
            const { bars, etf } = await nasdaqDaily(u.s);
            if (++done % 500 === 0) console.log(`scan snapshot: ${done}/${uni.length}…`);
            if (!bars.length) return null;
            return computeFeatures(u.s, u.n, bars, { mcap: u.mcap, etf, spy: spyMap });
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
        snapshot = { v: SNAP_VERSION, asOf: new Date().toISOString(), feats, etfFeats };
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
    if (!snapshot || snapshot.v !== SNAP_VERSION) {
        console.log(`scan snapshot v${snapshot?.v} != code v${SNAP_VERSION} — rebuilding…`);
        setTimeout(() => refreshSnapshot(), 5000);
    }
    setInterval(() => refreshSnapshot(), 4 * 60 * 60 * 1000);
}
