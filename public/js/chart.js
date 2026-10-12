// chart.js — Vela wrapper. All Vela calls here use methods verified on the real class:
// constructor, setMarket, setTheme, on, resize, destroy, getVisibleRange/setVisibleRange/panBy,
// registerEngine, addIndicator, addNativeIndicator, availableNativeIndicators,
// presentNativeIndicators, indicators, drawings.{setTool,getTool,setSnapMode,getSnapMode,
// setMode,setStayMode,toJSON,fromJSON,select,undo,redo}, drawingTypes().
import { Vela, drawingTypes } from '@luxalgo/vela';
import { PineEngine } from '@luxalgo/vela-pinets';

export const SEVEN_D_THEME = {
  background: '#0b0e14',
  textColor: '#d7dce3',
  gridColor: '#1a2130',
  borderColor: '#232b38',
  upColor: '#2ebd85',
  downColor: '#f6465d',
  fontFamily: '"Segoe UI", system-ui, Arial, sans-serif',
};

const TOOL_TYPES = new Set(drawingTypes().map((d) => d.type));
export function drawingToolExists(t) { return TOOL_TYPES.has(t); }

// Pine fallback overlays (used only when no matching native indicator exists)
const PINE_SRC = {
  ma20: `//@version=6
indicator("MA 20", overlay=true)
plot(ta.sma(close, 20), "MA20", color.new(#c9a227, 0), 2)`,
  ma50: `//@version=6
indicator("MA 50", overlay=true)
plot(ta.sma(close, 50), "MA50", color.new(#4f7dc9, 0), 2)`,
  ema20: `//@version=6
indicator("EMA 20", overlay=true)
plot(ta.ema(close, 20), "EMA20", color.new(#e0912f, 0), 2)`,
  volume: `//@version=6
indicator("Volume", overlay=false)
plot(volume, "Volume", close >= open ? color.new(#2ebd85, 20) : color.new(#f6465d, 20), 1, plot.style_columns)`,
};
const IND_LABEL = { ma20: 'MA20', ma50: 'MA50', ema20: 'EMA20', volume: 'VOL' };

export class Chart7D {
  constructor(el) {
    this.el = el;
    this.chart = null;
    this.indHandles = {};   // key -> IndicatorHandle
    this.indKind = {};      // key -> 'native' | 'pine'
    this.nativeMap = {};    // key -> native type string (resolved at runtime)
    this.pineReady = false;
    this.statusEl = document.getElementById('chart-status');
    this.onDrawingsChange = null;
    this.cursorPrice = null;   // last crosshair price on the price pane (for Alt+A alerts)
  }

  status(msg, isErr = false) {
    if (!this.statusEl) return;
    this.statusEl.textContent = msg || '';
    this.statusEl.classList.toggle('err', isErr);
  }

  async create(symbol, timeframe, bars) {
    if (this.chart) this.chart.destroy();
    this.indHandles = {};
    this.chart = new Vela(this.el, {
      symbol, timeframe, data: bars, live: false, theme: SEVEN_D_THEME,
    });
    try { this.chart.registerEngine('pine', new PineEngine()); this.pineReady = true; }
    catch (e) { console.warn('pine engine failed', e); }
    await this.resolveNatives();
    // drawings change → notify host (persist per tab)
    try {
      this.chart.on('drawing:added', () => this.onDrawingsChange && this.onDrawingsChange());
      this.chart.on('drawing:removed', () => this.onDrawingsChange && this.onDrawingsChange());
      this.chart.on('drawing:changed', () => this.onDrawingsChange && this.onDrawingsChange());
    } catch { /* event names may differ; persistence also runs on tab switch */ }
    try {
      const rc = this.chart.rendererControl || this.chart;
      rc.onCrosshairMove((e) => {
        this.cursorPrice = (e && e.price != null && e.paneKind !== 'study') ? e.price : this.cursorPrice;
      });
    } catch { /* crosshair seam unavailable - Alt+A falls back to manual entry */ }
    this.chart.resize();
  }

  // Map our toggle keys to real native indicator types, verified at runtime.
  async resolveNatives() {
    this.nativeMap = {};
    try {
      const list = await this.chart.availableNativeIndicators();
      console.info('[7d] native indicators:', list.map((i) => `${i.type} (${i.title})`).join(', ') || '(none)');
      const find = (...needles) => list.find((i) => needles.some((n) => (i.type + ' ' + i.title).toLowerCase().includes(n)));
      const ma = find('sma', 'moving average', ' simple');
      const ema = find('ema', 'exponential');
      const vol = find('volume');
      if (ma) { this.nativeMap.ma20 = ma.type; this.nativeMap.ma50 = ma.type; }
      if (ema) this.nativeMap.ema20 = ema.type;
      if (vol) this.nativeMap.volume = vol.type;
    } catch (e) { console.warn('native indicator probe failed', e); }
  }

  async setMarket(symbol, timeframe, bars) {
    await this.chart.setMarket({ symbol, timeframe, data: bars });
    await this.resolveNatives();
    // re-apply indicator toggles for the new market
    const keys = Object.keys(this.indHandles);
    this.indHandles = {};
    for (const k of keys) await this.setIndicator(k, true);
  }

  async setIndicator(key, on) {
    const cur = this.indHandles[key];
    if (!on) {
      if (cur) { try { cur.remove(); } catch { /* gone */ } delete this.indHandles[key]; }
      return;
    }
    if (cur) return;
    const nativeType = this.nativeMap[key];
    try {
      if (nativeType) {
        const inputs = key === 'ma50' ? { length: 50 } : key === 'volume' ? {} : { length: 20 };
        const h = this.chart.addNativeIndicator(nativeType, { inputs });
        this.indHandles[key] = h; this.indKind[key] = 'native';
      } else if (this.pineReady && PINE_SRC[key]) {
        const h = this.chart.addIndicator(PINE_SRC[key]);
        this.indHandles[key] = h; this.indKind[key] = 'pine';
      } else {
        console.warn('no indicator path for', key);
        return false;
      }
      return true;
    } catch (e) {
      console.warn('setIndicator failed', key, e);
      // pine fallback if native failed
      if (nativeType && this.pineReady && PINE_SRC[key]) {
        try {
          const h = this.chart.addIndicator(PINE_SRC[key]);
          this.indHandles[key] = h; this.indKind[key] = 'pine'; return true;
        } catch (e2) { console.warn('pine fallback failed', e2); }
      }
      return false;
    }
  }

  clearIndicators() {
    for (const k of Object.keys(this.indHandles)) { try { this.indHandles[k].remove(); } catch { /* */ } }
    this.indHandles = {};
  }

  pineHandles() { return Object.entries(this.indHandles).filter(([, h]) => h.source).map(([k, h]) => ({ key: k, handle: h })); }

  runPine(source) {
    if (!this.pineReady) throw new Error('מנוע Pine לא זמין');
    return this.chart.addIndicator(source);
  }
  clearPine() {
    for (const [k, h] of Object.entries(this.indHandles)) {
      if (h.source) { try { h.remove(); } catch { /* */ } delete this.indHandles[k]; }
    }
  }
  trackPine(key, handle) { this.indHandles[key] = handle; this.indKind[key] = 'pine'; }

  // ── drawings ──
  armTool(tool) {
    const d = this.chart.drawings;
    if (tool === 'select') { d.setTool(null); d.setMode(null); }
    else if (tool === 'cross') { d.setTool('crossline'); }
    else d.setTool(drawingToolExists(tool) ? tool : null);
  }
  activeTool() { try { return this.chart.drawings.getTool(); } catch { return null; } }
  toggleMagnet() {
    const d = this.chart.drawings;
    const cur = d.getSnapMode();
    d.setSnapMode(cur === 'off' ? 'weak' : 'off');
    return d.getSnapMode() !== 'off';
  }
  toggleEraser() {
    const d = this.chart.drawings;
    const cur = d.getMode();
    d.setMode(cur === 'eraser' ? null : 'eraser');
    return d.getMode() === 'eraser';
  }
  deselect() { try { this.chart.drawings.select(null); } catch { /* */ } }
  undo() { try { this.chart.drawings.undo(); } catch { /* */ } }
  serializeDrawings() { try { return this.chart.drawings.toJSON(); } catch { return null; } }
  restoreDrawings(json) {
    if (!this.chart) return;
    // fromJSON replaces the whole set; an empty doc clears (a tab with no
    // drawings must not inherit the previous tab's drawings).
    try { this.chart.drawings.fromJSON(json || { version: 1, drawings: [] }); }
    catch (e) { console.warn('restore drawings failed', e); }
  }

  resize() { try { this.chart.resize(); } catch { /* */ } }
  destroy() { try { this.chart.destroy(); } catch { /* */ } this.chart = null; }
  on(...a) { return this.chart.on(...a); }
}
