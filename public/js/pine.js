// pine.js — Pine editor modal: chart overlays + "run as scan" over a symbol list.
//
// Pine-as-scan feasibility (checked 2026-10-12): the snapshot only stores
// per-symbol *features*, not OHLCV history, so a full 4,472-symbol Pine scan
// would need ~4,472 bar fetches — infeasible interactively. The workable
// design is two-stage: numeric pre-scan (or most-liquid list) narrows the
// candidates, then PineTS evaluates the script per symbol (browser-side,
// ~100ms/symbol). Contract: the script's plot named "signal" (else the first
// plot) — last value finite and != 0 means a match.
import { api } from './api.js';
import { toast } from './tabs.js';
import { showScanView } from './scan.js';

const DEFAULT_CODE = `//@version=6
indicator("My Overlay", overlay=true)
// דוגמה: ממוצע נע 20 בזהב של 7-DIGITS
plot(ta.sma(close, 20), "SMA20", color.new(#c9a227, 0), 2)

// לסריקה: החזר plot בשם "signal" — 1 = התאמה
// signal = ta.crossover(ta.sma(close, 20), ta.sma(close, 50)) ? 1 : 0
// plot(signal, "signal")`;

const MAX_SCAN_SYMBOLS = 200;
const FETCH_BATCH = 8;

export class PineUI {
  constructor(chart7d, getTab, saveTab, getLastScan, onPick) {
    this.c7 = chart7d; this.getTab = getTab; this.saveTab = saveTab;
    this.getLastScan = getLastScan; this.onPick = onPick;
    this.modal = document.getElementById('pine-modal');
    this.code = document.getElementById('pine-code');
    this.err = document.getElementById('pine-error');
    this.prog = document.getElementById('pine-scan-progress');
    this._scanning = false;
    this.code.value = localStorage.getItem('7d.pine.draft') || DEFAULT_CODE;
    this.code.addEventListener('input', () => localStorage.setItem('7d.pine.draft', this.code.value));
  }

  open() { this.modal.hidden = false; this.err.hidden = true; setTimeout(() => this.code.focus(), 30); }
  close() { this.modal.hidden = true; }

  wire() {
    document.getElementById('btn-pine').onclick = () => this.open();
    document.querySelectorAll('.modal-close').forEach((b) => b.onclick = () => document.getElementById(b.dataset.close).hidden = true);
    document.getElementById('pine-run').onclick = () => this.run();
    document.getElementById('pine-scan-run').onclick = () => this.runAsScan();
    document.getElementById('pine-clear').onclick = () => {
      this.c7.clearPine();
      const t = this.getTab(); if (t) { t.pine = []; this.saveTab(); }
      toast('אינדיקטורי Pine נוקו');
    };
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
  }

  run() {
    const src = this.code.value;
    this.err.hidden = true;
    try {
      const h = this.c7.runPine(src);
      const key = 'pine-' + Date.now().toString(36);
      this.c7.trackPine(key, h);
      const t = this.getTab();
      if (t) { t.pine = [...(t.pine || []), src]; this.saveTab(); }
      toast('האינדיקטור הורץ על הגרף');
      this.close();
    } catch (e) {
      this.err.textContent = 'שגיאה: ' + (e?.message || e);
      this.err.hidden = false;
    }
  }

  // ── Pine as scan ──
  async runAsScan() {
    if (this._scanning) return;
    const code = this.code.value;
    this.err.hidden = true;
    const n = Math.min(MAX_SCAN_SYMBOLS, Math.max(10, parseInt(document.getElementById('pine-scan-n').value, 10) || 100));
    const src = document.getElementById('pine-scan-src').value;

    // 1. candidate symbols
    let cands = [];
    try {
      if (src === 'last') {
        const last = this.getLastScan && this.getLastScan();
        cands = (last?.tickers || []).slice(0, n).map((t) => t.symbol);
        if (!cands.length) { toast('אין תוצאות סריקה — הרץ סריקה מספרית קודם, או בחר "הנזילות ביותר"'); return; }
      } else {
        this.progress('טוען רשימת נזילים…');
        const r = await api.scanRun(
          [{ field: 'dollarVolume', op: 'gt', value: 0 }],
          { field: 'dollarVolume', dir: 'desc' }, n);
        cands = (r.tickers || []).map((t) => t.symbol);
      }
    } catch (e) { this.fail('שגיאה בטעינת רשימת סימבולים'); return; }

    // 2. lazy-load PineTS (kept out of the initial bundle)
    let PineTS;
    try {
      ({ PineTS } = await import('pinets'));
    } catch (e) { this.fail('מנוע PineTS לא נטען — בדוק חיבור'); return; }

    this._scanning = true;
    const matches = [];
    let checked = 0, errors = 0, compileChecked = false;
    try {
      await mapPool(cands, FETCH_BATCH, async (sym) => {
        let bars;
        try {
          const j = await api.bars(sym, 'D');
          bars = (j.bars || []).filter((b) => isFinite(b.close));
          if (bars.length < 30) return; // not enough history for indicators
        } catch { errors++; return; }
        const klines = bars.map((b) => ({
          openTime: b.time, open: b.open, high: b.high, low: b.low, close: b.close,
          volume: b.volume ?? 0, closeTime: b.time + 86399999,
          quoteAssetVolume: 0, numberOfTrades: 0,
          takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
        }));
        let sig;
        try {
          const pts = new PineTS(klines, sym, 'D');
          const ctx = await pts.run(code);
          sig = lastSignal(ctx);
        } catch (e) {
          if (!compileChecked) throw new Error('Pine: ' + (e?.message || e));
          errors++; return;
        }
        compileChecked = true;
        if (sig.match) {
          const last = bars[bars.length - 1], prev = bars[bars.length - 2];
          matches.push({
            symbol: sym,
            price: last.close,
            changePct: prev ? ((last.close / prev.close - 1) * 100) : null,
            signal: sig.value,
          });
        }
        checked++;
        this.progress(`בודק ${checked}/${cands.length}… נמצאו ${matches.length}`);
      });
    } catch (e) {
      this._scanning = false;
      this.err.textContent = 'שגיאה: ' + (e?.message || e);
      this.err.hidden = false;
      this.prog.hidden = true;
      return;
    }
    this._scanning = false;
    this.prog.hidden = true;
    this.close();
    this.renderPineResults(matches, cands.length, errors);
    showScanView(true);
    toast(`סריקת Pine: ${matches.length} התאמות מתוך ${cands.length}`);
  }

  progress(t) { this.prog.hidden = false; this.prog.textContent = t; }
  fail(t) { this.err.textContent = t; this.err.hidden = false; }

  renderPineResults(matches, checked, errors) {
    const box = document.getElementById('scan-results');
    box.innerHTML = '';
    const card = document.createElement('div'); card.className = 'scan-card';
    const meta = document.createElement('div'); meta.className = 'scan-meta';
    meta.textContent = `סריקת Pine · ${matches.length} התאמות מתוך ${checked} סימבולים` +
      (errors ? ` · ${errors} דולגו (אין נתונים)` : '');
    card.appendChild(meta);
    if (!matches.length) {
      const d = document.createElement('div'); d.className = 'skel';
      d.textContent = 'אין התאמות — נסה להרחיב את הרשימה או לשנות את הסקריפט.';
      card.appendChild(d); box.appendChild(card); return;
    }
    const t = document.createElement('table'); t.className = 'results';
    t.innerHTML = `<thead><tr><th>סימבול</th><th>מחיר</th><th>שינוי%</th><th>אות</th></tr></thead><tbody></tbody>`;
    const tb = t.querySelector('tbody');
    for (const x of matches) {
      const tr = document.createElement('tr');
      const chg = x.changePct;
      tr.innerHTML = `<td dir="ltr"><b>${x.symbol}</b></td>
        <td dir="ltr">${x.price?.toFixed(2) ?? '—'}</td>
        <td dir="ltr" class="${chg == null ? '' : chg >= 0 ? 'up' : 'dn'}">${chg == null ? '—' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}</td>
        <td dir="ltr">${typeof x.signal === 'number' ? x.signal.toFixed(2) : String(x.signal)}</td>`;
      tr.onclick = () => this.onPick && this.onPick(x.symbol);
      tb.appendChild(tr);
    }
    card.appendChild(t); box.appendChild(card);
  }
}

// last value of the "signal" plot (else the first user plot); match = finite non-zero
function lastSignal(ctx) {
  const plots = ctx?.plots || {};
  const keys = Object.keys(plots).filter((k) => !k.startsWith('__'));
  if (!keys.length) return { match: false };
  const key = keys.find((k) => k.toLowerCase() === 'signal') || keys[0];
  const data = plots[key]?.data;
  if (!Array.isArray(data) || !data.length) return { match: false, key };
  const v = data[data.length - 1]?.value;
  const num = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  const match = typeof num === 'number' && isFinite(num) && num !== 0;
  return { match, key, value: num };
}

async function mapPool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const idx = i++; await fn(items[idx], idx); }
  }));
}
