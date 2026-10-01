import { VelaWorkspace } from '@luxalgo/vela/workspace';

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
    providers: { stocks: () => new StocksProvider() },
    persist: true,
});

// ---- Hebrew shell wiring ----
const searchInput = document.getElementById('symbol-search');
const searchResults = document.getElementById('search-results');
const currentSymbol = document.getElementById('current-symbol');
let debounce = null;

function setSymbol(sym) {
    ws.active.setSymbol('stocks:' + sym.toUpperCase());
    currentSymbol.textContent = sym.toUpperCase();
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
                b.addEventListener('click', () => setSymbol(it.symbol));
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
