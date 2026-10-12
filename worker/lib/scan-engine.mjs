// Scan snapshot builder — Web-API only (global fetch, no node: imports),
// shared by the express server (server/scans/snapshot.mjs wraps it with fs
// save/load) and the Cloudflare worker (returns the snapshot object; the
// worker persists it to KV).
import { computeFeatures } from './features.mjs';
import LEVERAGED_ETFS from './leveraged-etfs.json' with { type: 'json' };

export { computeFeatures };

// Bump when computeFeatures gains/loses fields or the snapshot gains top-level
// fields — forces a rebuild on next start (express) / next asset publish (worker).
export const SNAP_VERSION = 4; // v4 adds top-level spyPerf63 (for rs63vsSpy)

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

// Full snapshot build. Pure-ish: performs network fetches, returns the snapshot
// object — the caller decides where to persist it (fs on express, KV on worker).
// `prev` (previous snapshot, optional): symbols that fail this refresh keep
// their last-good features instead of vanishing.
// `log` (optional): line logger.
export async function buildSnapshot(prev = null, log = () => {}) {
    log('scan snapshot refresh: fetching universe…');
    const uni = await fetchUniverse();
    log('scan snapshot: fetching SPY bars for RS alignment…');
    const spyBars = (await nasdaqDaily('SPY')).bars;
    const spyMap = new Map();
    for (const b of spyBars) spyMap.set(new Date(b.time).toISOString().slice(0, 10), b.close);
    // SPY 63-trading-day performance — basis for the rs63vsSpy custom-scan field
    // (rs63vsSpy = stock perf63 − SPY perf63, in percentage points).
    let spyPerf63 = null;
    if (spyBars.length > 64) {
        const a = spyBars[spyBars.length - 1].close, b = spyBars[spyBars.length - 64].close;
        if (b > 0) spyPerf63 = (a / b - 1) * 100;
    }
    log(`scan snapshot: SPY bars ${spyBars.length}, spyPerf63 ${spyPerf63?.toFixed(2)}, fetching bars…`);
    const feats = {};
    let done = 0;
    const results = await pool(uni, 16, async (u) => {
        const { bars, etf } = await nasdaqDaily(u.s);
        if (++done % 500 === 0) log(`scan snapshot: ${done}/${uni.length}…`);
        if (!bars.length) return null;
        return computeFeatures(u.s, u.n, bars, { mcap: u.mcap, etf, spy: spyMap });
    });
    let ok = 0;
    const prevFeats = prev?.feats || {};
    for (const f of results) if (f) { feats[f.s] = f; ok++; }
    // keep last-good features for symbols that failed this refresh
    for (const sym of Object.keys(prevFeats)) if (!feats[sym]) feats[sym] = prevFeats[sym];
    // ETFs (separate universe — only the liquid-ETF scan uses these).
    // If the ETF screener is blocked (403), keep previous ETF feats instead of
    // failing the whole refresh — stocks must not wait on ETFs.
    let etfFeats = {};
    let eok = 0;
    try {
        log('scan snapshot: fetching ETF universe…');
        const etfUni = (await fetchEtfUniverse()).filter((u) => !feats[u.s]);
        log(`scan snapshot: ${etfUni.length} ETFs, fetching bars…`);
        let edone = 0;
        const eresults = await pool(etfUni, 12, async (u) => {
            const { bars } = await nasdaqDaily(u.s, true);
            if (++edone % 500 === 0) log(`scan snapshot ETFs: ${edone}/${etfUni.length}…`);
            if (!bars.length) return null;
            return computeFeatures(u.s, u.n, bars, { etf: true });
        });
        for (const f of eresults) if (f) { etfFeats[f.s] = f; eok++; }
        log(`scan snapshot: ${eok} ETF feats fresh`);
    } catch (e) {
        log('scan snapshot: ETF universe failed, keeping previous: ' + e.message);
    }
    const prevEtf = prev?.etfFeats || {};
    for (const sym of Object.keys(prevEtf)) if (!etfFeats[sym]) etfFeats[sym] = prevEtf[sym];
    log(`scan snapshot done: ${ok} stocks + ${eok} ETFs`);
    return { v: SNAP_VERSION, asOf: new Date().toISOString(), feats, etfFeats, spyPerf63 };
}
