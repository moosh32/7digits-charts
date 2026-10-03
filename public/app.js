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

const CHART_LAYOUT_KEY = '7d-chart-layout';
let chartLayout = '1';
try { chartLayout = localStorage.getItem(CHART_LAYOUT_KEY) || '1'; } catch { chartLayout = '1'; }
if (chartLayout !== '1' && chartLayout !== '2h') chartLayout = '1';

const ws = new VelaWorkspace('#chart', {
    layout: chartLayout,
    symbol: 'stocks:SPY',
    timeframe: 'D',
    theme: 'dark',
    timeframes: ['1', '5', '15', '30', '60', 'D', 'W', 'M'],
    providers: { stocks: () => new StocksProvider() },
    engines: { pine: () => new PineWorkerEngine() },
    persist: true,
    cells: {
        main: { symbol: 'stocks:SPY', timeframe: 'D' },
        second: { symbol: 'stocks:QQQ', timeframe: 'D' },
    },
    // hide the native layout picker — our Hebrew header owns the 1/2-chart toggle
    topbar: {
        left: ['symbol', 'timeframes', 'style', 'indicators', 'actions', 'undo-redo'],
        right: ['actions', 'alerts', 'panels', 'screenshot'],
    },
});

// keep our Hebrew chrome (symbol display, timeframe highlight) following the active cell.
// NOTE: VelaWorkspace has no cell-change events, so we track the active cell by polling.
function refreshChrome() {
    let cell = null;
    try { cell = ws.active; } catch { cell = null; }
    if (!cell) return;
    const sym = String(cell.symbol || '').replace(/^stocks:/i, '').toUpperCase() || currentSym;
    currentSym = sym;
    const cs = document.getElementById('current-symbol');
    if (cs) cs.textContent = sym;
    const wc = document.getElementById('watchlist-current');
    if (wc) wc.textContent = sym;
    document.querySelectorAll('#timeframes button').forEach((b) =>
        b.classList.toggle('active', b.dataset.tf === cell.timeframe));
}
let lastActiveId = null;
try { lastActiveId = ws.active?.id || null; } catch { lastActiveId = null; }
setInterval(() => {
    let id = null;
    try { id = ws.active?.id || null; } catch { id = null; }
    if (id && id !== lastActiveId) { lastActiveId = id; refreshChrome(); }
}, 400);

// after revealing the 2nd chart, boot it with Israel's default scripts too
async function ensureDefaultsOnAllCells() {
    for (let i = 0; i < 25; i++) {
        let n = 0;
        try { n = ws.cells().length; } catch { n = 0; }
        if (n >= 2) break;
        await new Promise((r) => setTimeout(r, 200));
    }
    try {
        for (const c of ws.cells()) await runDefaultScripts(c.chart);
    } catch { /* noop */ }
}

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
    refreshChrome();
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

// 1 chart / 2 charts — native workspace grid; cells keep their own symbol,
// timeframe and indicators. Choice persists.
const chartCountBox = document.getElementById('chart-count');
function paintChartCount() {
    chartCountBox?.querySelectorAll('button').forEach((b) =>
        b.classList.toggle('active', b.dataset.layout === chartLayout));
}
chartCountBox?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layout]');
    if (!btn || btn.dataset.layout === chartLayout) return;
    chartLayout = btn.dataset.layout;
    try { localStorage.setItem(CHART_LAYOUT_KEY, chartLayout); } catch { /* noop */ }
    paintChartCount();
    ws.setLayout(chartLayout);
    if (chartLayout === '2h') ensureDefaultsOnAllCells();
    requestAnimationFrame(() => { try { ws.resize(); } catch { /* noop */ } });
});
paintChartCount();
// enforce the saved choice (workspace persist may restore a different layout)
try { ws.setLayout(chartLayout); } catch { /* noop */ }

// symbol sync across cells (TradingView-style link)
const SYNC_KEY = '7d-sync-symbol';
let syncSymbol = false;
try { syncSymbol = JSON.parse(localStorage.getItem(SYNC_KEY) ?? 'false'); } catch { syncSymbol = false; }
const syncBtn = document.getElementById('sync-toggle');
function paintSync() {
    if (!syncBtn) return;
    syncBtn.classList.toggle('on', syncSymbol);
    syncBtn.textContent = syncSymbol ? 'סנכרון: פעיל' : 'סנכרון: כבוי';
}
function applySync() {
    try { ws.sync.set('symbol', syncSymbol); } catch { /* older engine */ }
    paintSync();
}
syncBtn?.addEventListener('click', () => {
    syncSymbol = !syncSymbol;
    try { localStorage.setItem(SYNC_KEY, JSON.stringify(syncSymbol)); } catch { /* noop */ }
    applySync();
});
applySync();

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
showMarkers = input.bool(true, "הצג סימנים על הגרף")
plot(ta.ema(close, 10), "EMA 10", color.white)
plot(ta.ema(close, 20), "EMA 20", color.blue)
plot(ta.sma(close, 50), "SMA 50", color.green)
plot(ta.sma(close, 200), "SMA 200", color.red)
// Pocket Pivot (Gil Morales): up day, volume > highest down-volume of prior 10 days
downVol = close < open ? volume : 0
pocketPivot = close > open and volume > ta.highest(downVol[1], 10)
plotshape(showMarkers and pocketPivot, "Pocket Pivot", shape.diamond, location.belowbar, color.new(color.white, 45), size=size.small)
// HVE/HVQ/HVY candles in dark purple
isHVE = volume > ta.highest(volume[1], 5000)
isHVY = volume >= ta.highest(volume, 252)
isHVQ = volume >= ta.highest(volume, 63)
isHV = isHVE or isHVY or isHVQ
barcolor(isHV ? #6A1B9A : (close >= open ? color.green : color.red))`;
const PINE_VOLUME = `//@version=5
indicator("ווליום", overlay=false)
showMarkers = input.bool(true, "הצג סימנים על הגרף")
volMa = ta.sma(volume, 50)
isHVE = volume > ta.highest(volume[1], 5000)
isHVY = not isHVE and volume >= ta.highest(volume, 252)
isHVQ = not isHVE and not isHVY and volume >= ta.highest(volume, 63)
volTxt = str.tostring(volume / 1000000, "#.#") + "M"
plotshape(showMarkers and isHVE, "HVE", shape.labeldown, location.top, #6A1B9A, size=size.small)
plotshape(showMarkers and isHVY, "HVY", shape.labeldown, location.top, #6A1B9A, size=size.small)
plotshape(showMarkers and isHVQ, "HVQ", shape.labeldown, location.top, #6A1B9A, size=size.small)
if showMarkers and isHVE
    label.new(bar_index, volume, "HVE " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
if showMarkers and isHVY
    label.new(bar_index, volume, "HVY " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
if showMarkers and isHVQ
    label.new(bar_index, volume, "HVQ " + volTxt, style=label.style_none, textcolor=color.white, size=size.small)
plot(volMa, "ממוצע 50", color.orange)
plot(volume, "ווליום", volume < volMa ? color.gray : color.blue, style=plot.style_columns)`;
const PINE_RVOL30 = `//@version=5
indicator("RVOL 30%", overlay=true)
showMarkers = input.bool(true, "הצג סימנים על הגרף")
// Jeff Sun RVOL = volume vs 50-day average; yellow candle when >= 30% above average
rvolLen = input.int(50, "אורך ממוצע נפח", minval=1)
rvolThr = input.float(1.3, "סף RVOL", minval=1.0, step=0.05)
rvol = volume / ta.sma(volume, rvolLen)
isRvol30 = rvol >= rvolThr
barcolor(isRvol30 ? color.yellow : na)
plotshape(showMarkers and isRvol30, "RVOL 30%", shape.triangleup, location.belowbar, color.yellow, size=size.tiny)`;
const pineCode = document.getElementById('pine-code');
const pineError = document.getElementById('pine-error');
const pineRunBtn = document.getElementById('pine-run');
// "הצג סימנים על הגרף" — hides chart markers (diamonds, RVOL/volume triangles
// and HVE/HVY/HVQ labels) from the default scripts; candle coloring stays.
const MARKERS_KEY = '7d-show-markers';
const MARKERS_INPUT_ON = 'input.bool(true, "הצג סימנים על הגרף")';
const MARKERS_INPUT_OFF = 'input.bool(false, "הצג סימנים על הגרף")';
let showMarkers = true;
try { showMarkers = JSON.parse(localStorage.getItem(MARKERS_KEY) ?? 'true'); } catch { showMarkers = true; }
// Instant toggle: flip the live `showMarkers` input on every script indicator.
// No script re-run, no flicker. Indicators without the input are skipped.
function applyMarkersPrefToChart(chart) {
    for (const h of chart.indicators()) {
        if (!h.source) continue;
        try { h.setInputs({ showMarkers }); } catch { /* no such input */ }
    }
}
function applyMarkersPrefToAll() {
    for (const c of ws.cells()) { try { applyMarkersPrefToChart(c.chart); } catch { /* noop */ } }
}
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
            applyMarkersPrefToChart(ws.chart);
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
document.getElementById('pine-preset-rvol').addEventListener('click', () => {
    pineCode.value = PINE_RVOL30; pineError.hidden = true;
});

// auto-run Israel's defaults on a chart:
// - remove redundant native SMA/EMA/Volume (his Pine scripts replace them)
// - run MA+candle script + volume script, unless already present (no duplicates)
const DEFAULT_TITLES = ['ממוצעים ונרות', 'ווליום', 'RVOL 30%'];
let maAutoRan = false;
async function runDefaultScripts(chart = ws.chart) {
    try {
        await chart.data.ready();
        // drop stale copies of our own default scripts so the newest code always runs
        for (const h of chart.indicators()) {
            if (h.source && DEFAULT_TITLES.includes(h.title)) {
                try { h.remove(); } catch { /* noop */ }
            }
        }
        for (const src of [PINE_DEFAULT, PINE_VOLUME, PINE_RVOL30]) {
            try {
                const res = await chart.runScript(src);
                if (res && res.ok && typeof res.remove === 'function') pineRemovers.push(res.remove);
            } catch { /* leave the chart clean if the engine is not ready */ }
        }
        applyMarkersPrefToChart(chart);
    } catch { /* leave the chart clean */ }
}
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
    } catch { /* leave the chart clean */ }
    await runDefaultScripts(ws.chart);
    refreshChrome();
}
autoRunDefaults();

// settings toggle: show/hide chart markers — instant, flips the live input
const markersChk = document.getElementById('pine-markers');
if (markersChk) {
    markersChk.checked = showMarkers;
    markersChk.addEventListener('change', () => {
        showMarkers = markersChk.checked;
        try { localStorage.setItem(MARKERS_KEY, JSON.stringify(showMarkers)); } catch { /* noop */ }
        applyMarkersPrefToAll();
    });
}

// ---- Saved indicator layouts ----
const LAYOUTS_KEY = '7d-layouts';
let layouts = [];
try { layouts = JSON.parse(localStorage.getItem(LAYOUTS_KEY) || '[]'); } catch { layouts = []; }
function saveLayouts() { try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(layouts)); } catch { /* noop */ } }

function captureLayout(name) {
    const scripts = [];
    for (const h of ws.chart.indicators()) {
        if (!h.source) continue;
        // normalize the markers input back to default-on; the current pref is applied on load
        scripts.push({ t: h.title, code: h.source.split(MARKERS_INPUT_OFF).join(MARKERS_INPUT_ON) });
    }
    return { name, ts: Date.now(), markers: showMarkers, scripts };
}

async function applyLayout(l) {
    const chart = ws.chart;
    showMarkers = l.markers !== false;
    if (markersChk) markersChk.checked = showMarkers;
    try { localStorage.setItem(MARKERS_KEY, JSON.stringify(showMarkers)); } catch { /* noop */ }
    try {
        for (const h of chart.indicators()) {
            if (h.source) { try { h.remove(); } catch { /* noop */ } }
        }
        for (const s of l.scripts) {
            try {
                const res = await chart.runScript(s.code);
                if (res && res.ok && typeof res.remove === 'function') pineRemovers.push(res.remove);
            } catch { /* skip broken scripts, keep the rest */ }
        }
        applyMarkersPrefToChart(chart);
    } catch { /* leave the chart clean */ }
}

function renderLayouts() {
    const box = document.getElementById('layout-list');
    if (!box) return;
    box.innerHTML = '';
    if (!layouts.length) {
        box.innerHTML = '<div style="color:var(--muted);font-size:12px">עוד לא נשמרו לייאאוטים. סדר את האינדיקטורים על הגרף הפעיל ולחץ "שמור נוכחי".</div>';
        return;
    }
    for (const [i, l] of layouts.entries()) {
        const d = document.createElement('div');
        d.className = 'layout-row';
        const t = document.createElement('button');
        t.className = 't';
        t.textContent = `${l.name} (${(l.scripts || []).length})`;
        t.title = 'החל על הגרף הפעיל';
        t.addEventListener('click', () => applyLayout(l));
        const del = document.createElement('button');
        del.textContent = '✕'; del.className = 'del'; del.title = 'מחק לייאאוט';
        del.addEventListener('click', (e) => { e.stopPropagation(); layouts.splice(i, 1); saveLayouts(); renderLayouts(); });
        d.append(t, del);
        box.appendChild(d);
    }
}

const layoutSaveBtn = document.getElementById('layout-save');
if (layoutSaveBtn) {
    layoutSaveBtn.addEventListener('click', () => {
        const input = document.getElementById('layout-name');
        const name = (input.value || '').trim() || `לייאאוט ${layouts.length + 1}`;
        layouts.unshift(captureLayout(name));
        saveLayouts(); renderLayouts();
        input.value = '';
    });
    renderLayouts();
}

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
