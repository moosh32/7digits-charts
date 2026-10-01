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
            supportedTimeframes: ['D', 'W', 'M'],
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
    timeframes: ['D', 'W', 'M'],
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
const drawers = { 'watchlist-toggle': 'watchlist-panel', 'pine-toggle': 'pine-panel' };
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
indicator("EMA 20/50", overlay=true)
plot(ta.ema(close, 20), "EMA 20", color.orange)
plot(ta.ema(close, 50), "EMA 50", color.blue)`;
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
