// tabs.js — tab strip UI + per-tab state (symbol, timeframe, drawings, indicators, pine).
import { tabsStore } from './state.js';

export class TabsUI {
  constructor(chart7d, api, onSwitch) {
    this.c7 = chart7d; this.api = api; this.onSwitch = onSwitch;
    this.el = document.getElementById('tabs');
    this.switching = false;
  }

  render() {
    this.el.innerHTML = '';
    for (const t of tabsStore.tabs) {
      const b = document.createElement('button');
      b.className = 'tab' + (t.id === tabsStore.activeId ? ' active' : '');
      b.setAttribute('role', 'tab');
      b.title = t.symbol;
      const nm = document.createElement('span');
      nm.className = 'tab-name'; nm.textContent = t.name; nm.dir = 'ltr';
      b.appendChild(nm);
      const x = document.createElement('span');
      x.className = 'tab-x'; x.textContent = '✕'; x.title = 'סגור (Alt+W)';
      x.onclick = (e) => { e.stopPropagation(); this.close(t.id); };
      b.appendChild(x);
      b.onclick = () => this.activate(t.id);
      b.ondblclick = (e) => { e.stopPropagation(); this.startRename(b, t); };
      this.el.appendChild(b);
    }
  }

  persistDrawings() {
    const t = tabsStore.active();
    if (t && this.c7.chart) { t.drawings = this.c7.serializeDrawings(); tabsStore.save(); }
  }

  async activate(id, { force = false } = {}) {
    if (this.switching) return;
    if (id === tabsStore.activeId && !force) return;
    this.switching = true;
    try {
      this.persistDrawings();
      tabsStore.activeId = id;
      tabsStore.save();
      const t = tabsStore.active();
      await this.loadTab(t);
      this.render();
      this.onSwitch && this.onSwitch(t);
    } finally { this.switching = false; }
  }

  async loadTab(t) {
    this.c7.status('טוען ' + t.symbol + '…');
    try {
      const j = await this.api.bars(t.symbol, t.timeframe);
      await this.c7.setMarket(t.symbol, t.timeframe, j.bars || []);
      this.c7.restoreDrawings(t.drawings);
      for (const [k, on] of Object.entries(t.indicators || {})) await this.c7.setIndicator(k, !!on);
      for (const src of t.pine || []) {
        try { this.c7.trackPine('pine-' + Date.now().toString(36), this.c7.runPine(src)); } catch { /* skip */ }
      }
      this.c7.status(`${t.symbol} · ${t.timeframe} · ${j.count ?? j.bars?.length ?? 0} נרות`);
    } catch (e) {
      this.c7.status('שגיאה בטעינת ' + t.symbol, true);
    }
    this.syncToggles(t);
  }

  syncToggles(t) {
    document.querySelectorAll('#tf-bar button').forEach((b) => b.classList.toggle('active', b.dataset.tf === t.timeframe));
    document.querySelectorAll('#ind-toggles button').forEach((b) => b.classList.toggle('on', !!(t.indicators || {})[b.dataset.ind]));
    const lbl = document.getElementById('search-label');
    if (lbl) lbl.textContent = t.symbol;
  }

  async setSymbol(symbol) {
    const t = tabsStore.active();
    const old = t.symbol;
    t.symbol = symbol.toUpperCase();
    if (t.name === old) t.name = t.symbol; // keep manual renames
    tabsStore.save(); this.render();
    await this.loadTab(t);
    this.onSwitch && this.onSwitch(t);
  }

  async setTimeframe(tf) {
    const t = tabsStore.active();
    t.timeframe = tf; tabsStore.save();
    await this.loadTab(t);
    this.onSwitch && this.onSwitch(t);
  }

  async setIndicatorToggle(key, on) {
    const t = tabsStore.active();
    t.indicators = t.indicators || {};
    t.indicators[key] = on;
    const ok = await this.c7.setIndicator(key, on);
    if (ok === false) t.indicators[key] = false;
    tabsStore.save();
    this.syncToggles(t);
  }

  add(symbol) {
    const t = tabsStore.add(symbol || 'NVDA');
    if (!t) { toast('מקסימום 30 לשוניות'); return; }
    this.render();
    this.activate(t.id, { force: true });
  }

  close(id) {
    this.persistDrawings();
    tabsStore.close(id);
    this.render();
    this.activate(tabsStore.activeId, { force: true });
  }

  startRename(btn, t) {
    const nm = btn.querySelector('.tab-name');
    const inp = document.createElement('input');
    inp.value = t.name; inp.dir = 'auto';
    nm.replaceWith(inp); inp.focus(); inp.select();
    const commit = () => { tabsStore.rename(t.id, inp.value || t.name); this.render(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') this.render(); e.stopPropagation(); };
    inp.onblur = commit;
    inp.onclick = (e) => e.stopPropagation();
  }

  step(dir) {
    const i = tabsStore.tabs.findIndex((t) => t.id === tabsStore.activeId);
    const n = tabsStore.tabs[(i + dir + tabsStore.tabs.length) % tabsStore.tabs.length];
    if (n) this.activate(n.id);
  }
}

export function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2600);
}
