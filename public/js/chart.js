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

// Multi-pane host. Existing tools always address the selected Chart7D.
// Full pane documents stay in the local tab mirror; server tab schema is unchanged.
export class Layout7D {
  constructor(el, api, store) {
    this.el = el; this.api = api; this.store = store;
    this.panes = []; this.tab = null; this.generation = 0;
    this.onDrawingsChange = null; this.onSelect = null;
    const style = document.createElement('style');
    style.textContent = `
      #chart {display:grid;gap:3px;direction:ltr;overflow:hidden;padding:3px}
      #chart[data-layout="1"] {grid-template-columns:1fr;grid-template-rows:1fr}
      #chart[data-layout="2h"] {grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:1fr}
      #chart[data-layout="2v"] {grid-template-columns:1fr;grid-template-rows:repeat(2,minmax(0,1fr))}
      #chart[data-layout="4"] {grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(2,minmax(0,1fr))}
      .chart-cell {display:flex;flex-direction:column;min-width:0;min-height:0;border:1px solid var(--border,#232b38);overflow:hidden}
      .chart-cell.selected {border-color:var(--gold,#c9a227)}
      /* In split layouts, keep the selected pane's native drawing toolbar as the shared toolbar. */
      #chart[data-layout]:not([data-layout="1"]) .chart-cell:not(.selected) .vela-dtb {display:none !important}
      .cell-head {display:flex;align-items:center;gap:6px;padding:3px 6px;background:#141a24;direction:rtl;min-height:28px}
      .cell-head button,.cell-head input,.cell-head select,#chart-layout,.pane-link {font:inherit;color:#d7dce3;background:#0b0e14;border:1px solid #323c4e;border-radius:4px;padding:3px 6px}
      .cell-head input {width:75px;min-width:0;direction:ltr}
      .cell-head button {cursor:pointer;white-space:nowrap}
      .cell-head .cell-count {font-size:10px;color:#929baa;margin-inline-start:auto}
      .cell-canvas {flex:1;min-height:0;position:relative;overflow:hidden}
      #chart-layout {margin-inline:6px;max-width:150px}
      .pane-link {cursor:pointer;white-space:nowrap}
      .pane-link.on {color:#c9a227;border-color:#c9a227}
      @media(max-width:600px){.cell-head{gap:3px;padding:3px}.cell-head input{width:52px}.cell-count{display:none}.cell-head button{font-size:10px}.cell-head select{max-width:55px}}
    `;
    document.head.appendChild(style);
    const select = document.createElement('select'); select.id = 'chart-layout';
    select.setAttribute('aria-label', 'פריסת גרפים');
    select.innerHTML = '<option value="1">▣ גרף אחד</option><option value="2h">◫ 2 זה לצד זה</option><option value="2v">⊟ 2 זה מעל זה</option><option value="4">⊞ 4 גרפים</option>';
    const link = document.createElement('button'); link.className = 'pane-link'; link.id = 'pane-link';
    link.textContent = 'קישור חלוניות'; link.title = 'אותו סימבול בכל החלוניות, מסגרות זמן נפרדות';
    document.getElementById('tabstrip').append(select, link);
    select.onchange = async () => {
      this.capture(); this.tab.layout = select.value;
      this.tab.activePane = Math.min(this.tab.activePane || 0, this.count(select.value)-1); this.mirror();
      await this.loadTab(this.tab); this.store.save();
    };
    link.onclick = async () => {
      this.capture(); this.tab.paneLinked = !this.tab.paneLinked;
      if (this.tab.paneLinked) for (const p of this.tab.panes) p.symbol = this.tab.symbol;
      await this.loadTab(this.tab); this.store.save();
    };
    return new Proxy(this, {
      get: (target, key) => {
        if (key in target) { const v = target[key]; return typeof v === 'function' ? v.bind(target) : v; }
        const active = target.activeChart(); const v = active?.[key];
        return typeof v === 'function' ? v.bind(active) : v;
      },
    });
  }
  activeChart() { return this.panes[this.tab?.activePane || 0]?.chart; }
  count(layout) { return layout === '4' ? 4 : layout === '2h' || layout === '2v' ? 2 : 1; }
  doc(t) { return { symbol:t.symbol, timeframe:t.timeframe || 'D', indicators:structuredClone(t.indicators || {}), drawings:structuredClone(t.drawings || null), pine:[...(t.pine || [])] }; }
  capture() {
    if (!this.tab) return;
    for (let i=0;i<this.panes.length;i++) {
      const c = this.panes[i].chart;
      if (c.chart && this.tab.panes[i]) this.tab.panes[i].drawings = c.serializeDrawings();
    }
    // Indicator/Pine controls edit the selected tab fields. Keep that pane current.
    const i = this.tab.activePane || 0;
    if (this.tab.panes[i]) Object.assign(this.tab.panes[i], this.doc(this.tab), {drawings:this.panes[i]?.chart.serializeDrawings() || this.tab.panes[i].drawings});
  }
  serializeDrawings() { this.capture(); return this.activeChart()?.serializeDrawings() || null; }
  mirror() {
    const p = this.tab.panes[this.tab.activePane || 0];
    const old = this.tab.symbol;
    Object.assign(this.tab, this.doc(p));
    if (this.tab.name === old) this.tab.name = p.symbol;
  }
  selectPane(i) {
    if (!this.tab || i === this.tab.activePane) return;
    this.capture(); this.tab.activePane = i; this.mirror();
    this.paint(); this.store.save(); this.onSelect?.(this.tab);
  }
  paint() {
    this.panes.forEach((p,i) => {
      p.el.classList.toggle('selected', i === (this.tab.activePane || 0));
      p.button.setAttribute('aria-pressed', String(i === (this.tab.activePane || 0)));
      p.input.value = this.tab.panes[i].symbol;
      p.tf.value = this.tab.panes[i].timeframe;
    });
    document.getElementById('chart-layout').value = this.tab.layout;
    const link = document.getElementById('pane-link');
    link.classList.toggle('on', !!this.tab.paneLinked);
    link.setAttribute('aria-pressed', String(!!this.tab.paneLinked));
  }
  async loadTab(t) {
    const generation = ++this.generation;
    if (this.tab === t) this.capture();
    const layout = ['1','2h','2v','4'].includes(t.layout) ? t.layout : '1';
    t.layout = layout;
    t.panes ||= [this.doc(t)];
    t.activePane = Math.min(t.activePane || 0, this.count(layout)-1);
    // TabsUI changes symbol/timeframe/indicators through the existing root fields.
    Object.assign(t.panes[t.activePane] ||= this.doc(t), this.doc(t));
    while(t.panes.length < this.count(layout)) {
      const p = this.doc(t); p.timeframe = ['D','W','M','D'][t.panes.length]; p.drawings = null;
      t.panes.push(p);
    }
    if (t.paneLinked) for(const p of t.panes) p.symbol = t.symbol;
    const data = await Promise.all(t.panes.slice(0,this.count(layout)).map(p =>
      this.api.bars(p.symbol,p.timeframe).catch(() => ({bars:[],error:true}))));
    if(generation !== this.generation) return;
    this.panes.forEach(p => p.chart.destroy()); this.panes = []; this.el.replaceChildren();
    this.tab = t; this.el.dataset.layout = layout;
    for(let i=0;i<this.count(layout);i++) {
      const p = t.panes[i], j = data[i];
      const cell = document.createElement('section'); cell.className = 'chart-cell';
      cell.setAttribute('aria-label', `חלונית ${i+1}`);
      const head = document.createElement('div'); head.className = 'cell-head';
      const button = document.createElement('button'); button.textContent = `גרף ${i+1}`; button.title = 'בחר חלונית לעריכה';
      const input = document.createElement('input'); input.setAttribute('aria-label', `סימבול גרף ${i+1}`); input.maxLength = 16;
      const tf = document.createElement('select'); tf.setAttribute('aria-label', `טווח זמן גרף ${i+1}`);
      tf.innerHTML = ['1','5','15','30','60','D','W','M'].map(x => `<option value="${x}">${x==='60'?'1h':isNaN(+x)?x:x+'m'}</option>`).join('');
      const count = document.createElement('span'); count.className = 'cell-count'; count.textContent = j.error ? 'שגיאת נתונים' : `${j.bars?.length || 0} נרות`;
      head.append(button,input,tf,count);
      const canvas = document.createElement('div'); canvas.className = 'cell-canvas'; cell.append(head,canvas); this.el.append(cell);
      const c = new Chart7D(canvas); c.statusEl = null;
      this.panes.push({chart:c,el:cell,button,input,tf});
      cell.addEventListener('pointerdown', () => this.selectPane(i), true);
      button.onclick = () => this.selectPane(i);
      input.onkeydown = async e => {
        if(e.key !== 'Enter') return; e.preventDefault();
        const sym = input.value.trim().toUpperCase();
        if(!/^[A-Z0-9.^=-]{1,16}$/.test(sym)) return;
        this.selectPane(i); await this.onSymbol?.(sym);
      };
      tf.onchange = async () => { const value=tf.value; this.selectPane(i); await this.onTimeframe?.(value); };
      await c.create(p.symbol,p.timeframe,j.bars || []);
      c.restoreDrawings(p.drawings);
      for(const [key,on] of Object.entries(p.indicators || {})) if(on) await c.setIndicator(key,true);
      for(const [n,src] of (p.pine || []).entries()) { try {c.trackPine('pane-pine-'+n,c.runPine(src));} catch {} }
      c.onDrawingsChange = () => { if(this.generation === generation) {this.capture(); this.store.save();} };
    }
    this.mirror(); this.paint(); this.resize(); this.store.save();
    this.status(`${t.symbol} · ${t.timeframe} · ${this.count(layout)} גרפים`);
  }
  status(msg,err=false) {
    const el = document.getElementById('chart-status'); el.textContent = msg || ''; el.classList.toggle('err',err);
  }
  resize() { this.panes.forEach(p=>p.chart.resize()); }
  destroy() { this.panes.forEach(p=>p.chart.destroy()); this.panes=[]; }
}
