import { VelaWorkspace } from '@luxalgo/vela/workspace';
import { PineWorkerEngine } from '@luxalgo/vela-pinets';

// Nasdaq universe seed — popular names for instant autocomplete.
// Any US ticker can still be loaded via search or the stocks: prefix.
const WATCHLIST = [
    ['SPY', 'S&P 500 ETF'], ['QQQ', 'Nasdaq 100 ETF'], ['DIA', 'Dow Jones ETF'], ['IWM', 'Russell 2000 ETF'],
    ['AAPL', 'Apple'], ['MSFT', 'Microsoft'], ['NVDA', 'NVIDIA'], ['AMZN', 'Amazon'],
    ['META', 'Meta Platforms'], ['GOOGL', 'Alphabet A'], ['GOOG', 'Alphabet C'], ['TSLA', 'Tesla'],
    ['AVGO', 'Broadcom'], ['COST', 'Costco'], ['NFLX', 'Netflix'], ['AMD', 'AMD'],
    ['PLTR', 'Palantir'], ['INTC', 'Intel'], ['CSCO', 'Cisco'], ['PEP', 'PepsiCo'],
    ['ADBE', 'Adobe'], ['AMGN', 'Amgen'], ['TXN', 'Texas Instruments'], ['QCOM', 'Qualcomm'],
    ['HON', 'Honeywell'], ['AMAT', 'Applied Materials'], ['SBUX', 'Starbucks'], ['INTU', 'Intuit'],
    ['BKNG', 'Booking'], ['GILD', 'Gilead'], ['MDLZ', 'Mondelez'], ['ADI', 'Analog Devices'],
    ['LRCX', 'Lam Research'], ['MU', 'Micron'], ['REGN', 'Regeneron'], ['ISRG', 'Intuitive Surgical'],
    ['VRTX', 'Vertex Pharma'], ['PANW', 'Palo Alto Networks'], ['CDNS', 'Cadence'],
    ['MELI', 'MercadoLibre'], ['CSX', 'CSX Corp'], ['MNST', 'Monster Beverage'], ['KDP', 'Keurig Dr Pepper'],
    ['AEP', 'American Electric'], ['ODFL', 'Old Dominion'], ['PAYX', 'Paychex'], ['ROST', 'Ross Stores'],
    ['LULU', 'Lululemon'], ['WDAY', 'Workday'], ['TTD', 'Trade Desk'], ['MRNA', 'Moderna'],
    ['ZS', 'Zscaler'], ['CRWD', 'CrowdStrike'], ['DDOG', 'Datadog'], ['NET', 'Cloudflare'],
    ['SNOW', 'Snowflake'], ['COIN', 'Coinbase'], ['MSTR', 'Strategy'], ['MARA', 'MARA Holdings'],
    ['RIOT', 'Riot Platforms'], ['ARM', 'Arm Holdings'], ['SMCI', 'Super Micro'], ['DELL', 'Dell'],
];

class StocksProvider {
    async getBars(ticker, timeframe) {
        const clean = ticker.includes(':') ? ticker.split(':').pop() : ticker;
        const r = await fetch(`/api/bars?symbol=${encodeURIComponent(clean)}&timeframe=${encodeURIComponent(timeframe)}`);
        if (!r.ok) throw new Error('no data for ' + clean);
        return r.json();
    }
    info() {
        return {
            name: 'stocks',
            displayName: 'US Stocks',
            supportedTimeframes: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
            capabilities: { enumerate: true, stream: false, symbolInfo: false },
        };
    }
    async listSymbols() {
        return WATCHLIST.map(([ticker, description]) => ({ ticker, description, type: 'stock' }));
    }
}

const ws = new VelaWorkspace('#chart', {
    layout: false,
    symbol: 'stocks:SPY',
    timeframe: 'D',
    theme: 'dark',
    timeframes: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
    providers: { stocks: () => new StocksProvider() },
    engines: { pine: () => new PineWorkerEngine() },
    persist: true,
});

let currentSym = 'SPY';
const currentNames = { SPY: 'S&P 500 ETF' };

// ---- Hebrew shell wiring ----
const searchInput = document.getElementById('symbol-search');
const searchResults = document.getElementById('search-results');
const currentSymbol = document.getElementById('current-symbol');
let debounce = null;

function setSymbol(sym, name) {
    sym = sym.toUpperCase();
    ws.active.setSymbol('stocks:' + sym);
    currentSym = sym;
    if (name) currentNames[sym] = name;
    currentSymbol.textContent = sym;
    document.getElementById('watchlist-current').textContent = sym;
    searchResults.hidden = true;
    searchInput.value = '';
}

searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    const q = searchInput.value.trim();
    if (q.length < 1) { searchResults.hidden = true; return; }
    debounce = setTimeout(async () => {
        try {
            const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
            const list = await r.json();
            if (!list.length) { searchResults.hidden = true; return; }
            searchResults.innerHTML = '';
            for (const it of list) {
                const b = document.createElement('button');
                const s = document.createElement('span'); s.className = 'sym'; s.textContent = it.symbol;
                const n = document.createElement('span'); n.className = 'nm'; n.textContent = it.name;
                b.append(s, n);
                b.addEventListener('click', () => setSymbol(it.symbol, it.name));
                searchResults.appendChild(b);
            }
            searchResults.hidden = false;
        } catch { searchResults.hidden = true; }
    }, 250);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && searchInput.value.trim()) setSymbol(searchInput.value.trim());
    if (e.key === 'Escape') searchResults.hidden = true;
});
document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) searchResults.hidden = true;
});

document.getElementById('timeframes').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tf]');
    if (!btn) return;
    document.querySelectorAll('#timeframes button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    ws.active.setTimeframe(btn.dataset.tf);
});

window.addEventListener('resize', () => ws.resize());

// ---- Drawers ----
const drawers = { 'watchlist-toggle': 'watchlist-panel', 'pine-toggle': 'pine-panel', 'scans-toggle': 'scans-panel' };
for (const [btnId, panelId] of Object.entries(drawers)) {
    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);
    btn.addEventListener('click', () => {
        const willOpen = panel.hidden;
        document.querySelectorAll('.drawer').forEach((d) => { d.hidden = true; });
        document.querySelectorAll('.hdr-btn.open').forEach((b) => b.classList.remove('open'));
        panel.hidden = !willOpen;
        btn.classList.toggle('open', willOpen);
        if (willOpen && panelId === 'watchlist-panel') renderWatchlist();
        if (willOpen && panelId === 'pine-panel') renderSavedScripts();
        if (willOpen && panelId === 'scans-panel') initScanners();
    });
}
document.querySelectorAll('.drawer-close').forEach((b) =>
    b.addEventListener('click', () => {
        document.getElementById(b.dataset.close).hidden = true;
        document.querySelectorAll('.hdr-btn.open').forEach((x) => x.classList.remove('open'));
    }));

// ---- Watchlist ----
const WL_KEY = '7d-watchlist';
let watchlist = JSON.parse(localStorage.getItem(WL_KEY) || 'null') || [
    { s: 'SPY', n: 'S&P 500 ETF' }, { s: 'QQQ', n: 'Nasdaq 100 ETF' },
    { s: 'NVDA', n: 'NVIDIA Corporation' }, { s: 'AAPL', n: 'Apple Inc' },
    { s: 'TSLA', n: 'Tesla Inc' }, { s: 'MSFT', n: 'Microsoft' },
];
function saveWatchlist() { localStorage.setItem(WL_KEY, JSON.stringify(watchlist)); }

async function renderWatchlist() {
    const box = document.getElementById('watchlist-items');
    box.innerHTML = '';
    for (const it of watchlist) {
        const b = document.createElement('button');
        b.className = 'wl-item';
        b.innerHTML = `<span class="sym"></span><span class="nm"></span><span class="q">…</span><span class="rm" title="הסר">✕</span>`;
        b.querySelector('.sym').textContent = it.s;
        b.querySelector('.nm').textContent = it.n || '';
        const qEl = b.querySelector('.q');
        b.addEventListener('click', (e) => {
            if (e.target.closest('.rm')) return;
            setSymbol(it.s, it.n);
        });
        b.querySelector('.rm').addEventListener('click', (e) => {
            e.stopPropagation();
            watchlist = watchlist.filter((x) => x.s !== it.s);
            saveWatchlist(); renderWatchlist();
        });
        box.appendChild(b);
        try {
            const r = await fetch(`/api/quote?symbol=${encodeURIComponent(it.s)}`);
            const q = await r.json();
            if (q.price) {
                const cls = q.changePct >= 0 ? 'chg-up' : 'chg-dn';
                const sign = q.changePct >= 0 ? '+' : '';
                qEl.innerHTML = `${q.price} <span class="${cls}">${sign}${q.changePct}%</span>`;
            } else qEl.textContent = '';
        } catch { qEl.textContent = ''; }
    }
    if (!watchlist.length) box.innerHTML = '<div style="color:var(--muted);font-size:13px">ריק — הוסף מניות מהכפתור למעלה.</div>';
}
document.getElementById('watchlist-add').addEventListener('click', () => {
    if (!watchlist.some((x) => x.s === currentSym)) {
        watchlist.unshift({ s: currentSym, n: currentNames[currentSym] || '' });
        saveWatchlist(); renderWatchlist();
    }
});

// ---- Pine Script editor ----
const PINE_KEY = '7d-pine-scripts';
const PINE_DEFAULT = `//@version=5
indicator("ממוצעים ונרות", overlay=true)
plot(ta.ema(close, 10), "EMA 10", color.white)
plot(ta.ema(close, 20), "EMA 20", color.blue)
plot(ta.sma(close, 50), "SMA 50", color.green)
plot(ta.sma(close, 200), "SMA 200", color.red)
// Pocket Pivot (Gil Morales): up day, volume > highest down-volume of prior 10 days
downVol = close < open ? volume : 0
pocketPivot = close > open and volume > ta.highest(downVol[1], 10)
plotshape(pocketPivot, "Pocket Pivot", shape.diamond, location.belowbar, color.new(color.white, 45), size=size.small)
// HVE/HVQ/HVY candles in dark purple
isHVE = volume > ta.highest(volume[1], 5000)
isHVY = volume >= ta.highest(volume, 252)
isHVQ = volume >= ta.highest(volume, 63)
isHV = isHVE or isHVY or isHVQ
barcolor(isHV ? #6A1B9A : (close >= open ? color.green : color.red))`;
const PINE_VOLUME = `//@version=5
indicator("ווליום", overlay=false)
volMa = ta.sma(volume, 50)
isHVE = volume > ta.highest(volume[1], 5000)
isHVY = not isHVE and volume >= ta.highest(volume, 252)
isHVQ = not isHVE and not isHVY and volume >= ta.highest(volume, 63)
volTxt = str.tostring(volume / 1000000, "#.#") + "M"
plotshape(isHVE, "HVE", shape.labeldown, location.top, #6A1B9A, size=size.small)
plotshape(isHVY, "HVY", shape.labeldown, location.top, #6A1B9A, size=size.small)
plotshape(isHVQ, "HVQ", shape.labeldown, location.top, #6A1B9A, size=size.small)
if isHVE
    label.new(bar_index, volume, "HVE " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
if isHVY
    label.new(bar_index, volume, "HVY " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
if isHVQ
    label.new(bar_index, volume, "HVQ " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
plot(volMa, "ממוצע 50", color.orange)
plot(volume, "ווליום", volume < volMa ? color.gray : color.blue, style=plot.style_columns)`;
const pineCode = document.getElementById('pine-code');
const pineError = document.getElementById('pine-error');
const pineRunBtn = document.getElementById('pine-run');
pineCode.value = PINE_DEFAULT;
let pineRemovers = [];
let savedScripts = JSON.parse(localStorage.getItem(PINE_KEY) || '[]');
function saveScripts() { localStorage.setItem(PINE_KEY, JSON.stringify(savedScripts)); }
pineCode.addEventListener('input', () => { pineError.hidden = true; });

function pineTitle(src) {
    const m = src.match(/indicator\s*\(\s*"([^"]+)"/) || src.match(/strategy\s*\(\s*"([^"]+)"/);
    return m ? m[1] : 'סקריפט ' + new Date().toLocaleDateString('he-IL');
}

pineRunBtn.addEventListener('click', async () => {
    pineError.hidden = true;
    pineRunBtn.disabled = true;
    pineRunBtn.textContent = 'מריץ…';
    try {
        // avoid stacking duplicates: replace an existing indicator with the same title
        const t = pineTitle(pineCode.value);
        for (const h of ws.chart.indicators()) {
            if (h.title === t) { try { h.remove(); } catch { /* noop */ } }
        }
        const res = await ws.chart.runScript(pineCode.value);
        if (res.ok && typeof res.remove === 'function') {
            pineRemovers.push(res.remove);
        } else {
            pineError.textContent = String(res.error?.message || res.error || 'שגיאה לא ידועה');
            pineError.hidden = false;
        }
    } catch (e) {
        pineError.textContent = String(e.message || e);
        pineError.hidden = false;
    }
    pineRunBtn.disabled = false;
    pineRunBtn.textContent = 'הרץ על הגרף';
});

document.getElementById('pine-clear').addEventListener('click', () => {
    for (const rm of pineRemovers) { try { rm(); } catch { /* noop */ } }
    pineRemovers = [];
    pineError.hidden = true;
});

// preset scripts: Israel's defaults
document.getElementById('pine-preset-ma').addEventListener('click', () => {
    pineCode.value = PINE_DEFAULT; pineError.hidden = true;
});
document.getElementById('pine-preset-vol').addEventListener('click', () => {
    pineCode.value = PINE_VOLUME; pineError.hidden = true;
});

// auto-run Israel's defaults on the charts at load:
// - remove redundant native SMA/EMA/Volume (his Pine scripts replace them)
// - run MA+candle script + volume script, unless already present (no duplicates)
let maAutoRan = false;
async function autoRunDefaults() {
    if (maAutoRan) return; maAutoRan = true;
    try {
        await ws.chart.data.ready();
        for (const h of ws.chart.indicators()) {
            if (h.source) continue; // keep script indicators
            const t = (h.title || '').toLowerCase();
            const nt = (h.nativeType || '').toLowerCase();
            if (nt === 'volume' || nt.includes('moving-average') ||
                t === 'volume' || t === 'sma' || t === 'ema' || t.includes('moving average')) {
                try { h.remove(); } catch { /* noop */ }
            }
        }
        // drop stale copies of our own default scripts so the newest code always runs
        for (const h of ws.chart.indicators()) {
            if (h.source && (h.title === 'ממוצעים ונרות' || h.title === 'ווליום')) {
                try { h.remove(); } catch { /* noop */ }
            }
        }
        for (const src of [PINE_DEFAULT, PINE_VOLUME]) {
            try {
                const res = await ws.chart.runScript(src);
                if (res && res.ok && typeof res.remove === 'function') pineRemovers.push(res.remove);
            } catch { /* leave the chart clean if the engine is not ready */ }
        }
    } catch { /* leave the chart clean */ }
}
autoRunDefaults();

document.getElementById('pine-save').addEventListener('click', () => {
    const code = pineCode.value.trim();
    if (!code) return;
    savedScripts.unshift({ t: pineTitle(code), code, ts: Date.now() });
    saveScripts(); renderSavedScripts();
});

function renderSavedScripts() {
    const box = document.getElementById('pine-saved-list');
    box.innerHTML = '';
    if (!savedScripts.length) {
        box.innerHTML = '<div style="color:var(--muted);font-size:12px">עוד לא נשמרו סקריפטים.</div>';
        return;
    }
    for (const [i, sc] of savedScripts.entries()) {
        const d = document.createElement('div');
        d.className = 'saved-script';
        const t = document.createElement('span'); t.className = 't'; t.textContent = sc.t;
        const load = document.createElement('button'); load.textContent = 'טען';
        load.addEventListener('click', () => { pineCode.value = sc.code; pineError.hidden = true; });
        const del = document.createElement('button'); del.textContent = 'מחק'; del.className = 'del';
        del.addEventListener('click', () => { savedScripts.splice(i, 1); saveScripts(); renderSavedScripts(); });
        d.append(t, load, del);
        box.appendChild(d);
    }
}

// ---- Scanners ----
let scanData = null, activeGroup = null, activeScan = null;

async function initScanners() {
    if (!scanData) {
        try {
            const r = await fetch('/api/scans');
            scanData = await r.json();
            activeGroup = scanData.groups[0].id;
        } catch {
            document.getElementById('scan-list').innerHTML =
                '<div style="color:var(--muted);font-size:13px">הסורקים אינם זמינים כרגע.</div>';
            return;
        }
    }
    renderScanGroups();
    renderScanList();
}

function renderScanGroups() {
    const box = document.getElementById('scan-groups');
    box.innerHTML = '';
    for (const g of scanData.groups) {
        const b = document.createElement('button');
        b.textContent = g.name;
        if (g.id === activeGroup) b.classList.add('active');
        b.addEventListener('click', () => {
            activeGroup = g.id; activeScan = null;
            renderScanGroups(); renderScanList();
            document.getElementById('scan-results').innerHTML = '';
            document.getElementById('scan-meta').hidden = true;
        });
        box.appendChild(b);
    }
}

function renderScanList() {
    const box = document.getElementById('scan-list');
    box.innerHTML = '';
    for (const s of scanData.scanners.filter((x) => x.groups.includes(activeGroup))) {
        const b = document.createElement('button');
        b.className = 'scan-btn' + (s.id === activeScan ? ' active' : '');
        b.innerHTML = '';
        const t = document.createElement('span');
        t.textContent = s.name;
        b.appendChild(t);
        if (s.approx) {
            const tag = document.createElement('span');
            tag.className = 'approx-tag';
            tag.textContent = 'קירוב';
            b.appendChild(tag);
        }
        b.title = s.desc;
        b.addEventListener('click', () => runScan(s.id));
        box.appendChild(b);
    }
}

async function runScan(id) {
    activeScan = id;
    renderScanList();
    const results = document.getElementById('scan-results');
    const meta = document.getElementById('scan-meta');
    results.innerHTML = '<div style="color:var(--muted);font-size:13px">סורק…</div>';
    meta.hidden = true;
    try {
        const r = await fetch(`/api/scan/${encodeURIComponent(id)}`);
        const out = await r.json();
        if (!r.ok || out.error) {
            results.innerHTML = `<div style="color:var(--muted);font-size:13px">${out.error === 'snapshot not ready' ? 'הנתונים עדיין נטענים — נסה שוב בעוד כמה דקות.' : 'שגיאה בהרצת הסריקה.'}</div>`;
            return;
        }
        const asOf = new Date(out.asOf);
        meta.innerHTML = '';
        const d = document.createElement('div');
        d.className = 'scan-desc';
        d.textContent = out.desc;
        meta.appendChild(d);
        if (out.approx) {
            const a = document.createElement('div');
            a.className = 'scan-approx';
            a.textContent = '⚠ קירוב: ' + out.approx;
            meta.appendChild(a);
        }
        const m = document.createElement('div');
        m.textContent = `נמצאו ${out.count} מניות · עודכן ${asOf.toLocaleDateString('he-IL')} ${asOf.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}`;
        meta.appendChild(m);
        meta.hidden = false;
        results.innerHTML = '';
        if (!out.rows.length) {
            results.innerHTML = '<div style="color:var(--muted);font-size:13px">אין תוצאות כרגע.</div>';
            return;
        }
        for (const row of out.rows) {
            const b = document.createElement('button');
            b.className = 'scan-row';
            const cls = row.chg >= 0 ? 'chg-up' : 'chg-dn';
            const sign = row.chg >= 0 ? '+' : '';
            b.innerHTML =
                `<span class="sym"></span><span class="nm"></span>` +
                `<span class="q">$${row.price} <span class="${cls}">${sign}${row.chg}%</span></span>` +
                `<span class="detail"></span>`;
            b.querySelector('.sym').textContent = row.s;
            b.querySelector('.nm').textContent = row.name || '';
            b.querySelector('.detail').textContent =
                `${row.detail} · מחזור דולרי $${row.dvolM}M · נפח יחסי ${row.relVol}`;
            b.addEventListener('click', () => setSymbol(row.s, row.name));
            results.appendChild(b);
        }
    } catch {
        results.innerHTML = '<div style="color:var(--muted);font-size:13px">שגיאה בהרצת הסריקה.</div>';
    }
}
