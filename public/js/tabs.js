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
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', t.id === tabsStore.activeId);
      b.draggable = true;
      b.ondragstart = e => { e.dataTransfer.setData('text/plain',t.id); b.classList.add('dragging'); };
      b.ondragend = () => b.classList.remove('dragging');
      b.ondragover = e => { e.preventDefault(); };
      b.ondrop = e => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); const from = tabsStore.tabs.findIndex(x=>x.id===id); const to = tabsStore.tabs.findIndex(x=>x.id===t.id); if(from<0 || from===to) return; const [tab] = tabsStore.tabs.splice(from,1); tabsStore.tabs.splice(to,0,tab); tabsStore.save(); this.render(); };
      b.title = t.symbol + (t.linked ? ' · מקושרת' : '');
      if (t.linked) b.classList.add('linked');
      const nm = document.createElement('span');
      nm.className = 'tab-name'; nm.textContent = (t.linked ? '🔗 ' : '') + t.name; nm.dir = 'ltr';
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
      // capture the OUTGOING tab's drawings before switching. Never write the
      // live chart state into the incoming tab (a fresh tab must start clean —
      // writing it would leak the previous tab's drawings into its doc).
      const out = tabsStore.active();
      if (out && out.id !== id && this.c7.chart) {
        out.drawings = this.c7.serializeDrawings();
      }
      tabsStore.activeId = id;
      tabsStore.save();
      const t = tabsStore.active();
      await this.loadTab(t);
      this.render();
      this.onSwitch && this.onSwitch(t);
    } finally { this.switching = false; }
  }

  async loadTab(t) {
    if (this.c7.loadTab) { await this.c7.loadTab(t); this.syncToggles(t); return; }
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
    this.syncLinkBtn();
    const lbl = document.getElementById('search-label');
    if (lbl) lbl.textContent = t.symbol;
  }

  async setSymbol(symbol) {
    const t = tabsStore.active();
    const sym = symbol.toUpperCase();
    // symbol link: every linked tab follows the active one when it is linked
    const group = t.linked ? tabsStore.tabs.filter((x) => x.linked) : [t];
    for (const x of group) {
      const old = x.symbol;
      x.symbol = sym;
      if (x.name === old) x.name = sym; // keep manual renames
    }
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

  toggleLink() {
    const t = tabsStore.active();
    t.linked = !t.linked;
    tabsStore.save(); this.render(); this.syncLinkBtn();
    const n = tabsStore.tabs.filter((x) => x.linked).length;
    toast(t.linked ? (n > 1 ? `מקושרת · ${n} לשוניות מקושרות` : 'מקושרת · קשר גם לשונית נוספת כדי לסנכרן סימבול') : 'הקישור בוטל');
  }
  syncLinkBtn() {
    const b = document.getElementById('tab-link'); if (!b) return;
    const on = !!tabsStore.active()?.linked;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
  }

  duplicate() {
    this.persistDrawings(); const source = structuredClone(tabsStore.active());
    const t = tabsStore.add(source.symbol); if(!t) { toast('מקסימום 30 לשוניות'); return; }
    Object.assign(t, source, {id:t.id, name:source.name + ' עותק'}); tabsStore.save(); this.render(); this.activate(t.id,{force:true});
  }

  add(symbol) {
    this.persistDrawings();
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
