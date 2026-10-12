// state.js — Tabs / watchlists / saved scans with server persistence + localStorage mirror.
// Contract: server wins on load; localStorage is the always-written fallback.
import { api } from './api.js';

const LS = {
  tabs: '7d.tabs.v1',        // full tab docs incl. drawings/indicators (server holds minimal)
  watchlists: '7d.watchlists.v1',
  scans: '7d.scans.v1',
};
const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } };

const uid = (p) => p + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);

function defaultTab(symbol = 'NVDA') {
  return {
    id: uid('t'), name: symbol, symbol, timeframe: 'D',
    indicators: { ma20: false, ma50: false, ema20: false, volume: false },
    drawings: null, pine: [],
  };
}

// ═══ Tabs ═══
export const tabsStore = {
  tabs: [], activeId: null,
  _saveT: null,

  async load() {
    const local = read(LS.tabs, null);
    let server = null;
    if (api.state.serverOk) {
      try { server = await api.tabsGet(); } catch { server = null; }
    }
    if (server && Array.isArray(server.tabs) && server.tabs.length) {
      // server wins for the tab list; per-tab detail (drawings/indicators) from localStorage
      const localById = Object.fromEntries((local?.tabs || []).map((t) => [t.id, t]));
      this.tabs = server.tabs.map((t) => ({ ...defaultTab(t.symbol), ...localById[t.id], id: t.id, name: t.name, symbol: t.symbol }));
      this.activeId = server.activeId && this.tabs.some((t) => t.id === server.activeId) ? server.activeId : this.tabs[0].id;
    } else if (local && Array.isArray(local.tabs) && local.tabs.length) {
      this.tabs = local.tabs; this.activeId = local.activeId;
    } else {
      this.tabs = [defaultTab('NVDA'), defaultTab('AAPL')];
      this.activeId = this.tabs[0].id;
    }
    if (!this.tabs.some((t) => t.id === this.activeId)) this.activeId = this.tabs[0].id;
    this.saveLocal();
  },
  active() { return this.tabs.find((t) => t.id === this.activeId) || this.tabs[0]; },
  saveLocal() { write(LS.tabs, { tabs: this.tabs, activeId: this.activeId }); },
  save() {
    this.saveLocal();
    clearTimeout(this._saveT);
    this._saveT = setTimeout(async () => {
      if (!api.state.serverOk) return;
      try {
        await api.tabsPut(this.tabs.map((t) => ({ id: t.id, name: t.name, symbol: t.symbol })), this.activeId);
      } catch { /* stay local */ }
    }, 600);
  },
  add(symbol = 'NVDA') {
    if (this.tabs.length >= 30) return null;
    const t = defaultTab(symbol);
    this.tabs.push(t); this.activeId = t.id; this.save();
    return t;
  },
  close(id) {
    if (this.tabs.length <= 1) { const t = this.tabs[0]; Object.assign(t, defaultTab('NVDA'), { id: t.id }); this.activeId = t.id; this.save(); return; }
    const i = this.tabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    this.tabs.splice(i, 1);
    if (this.activeId === id) this.activeId = this.tabs[Math.max(0, i - 1)].id;
    this.save();
  },
  rename(id, name) { const t = this.tabs.find((x) => x.id === id); if (t && name.trim()) { t.name = name.trim().slice(0, 40); this.save(); } },
};

// ═══ Watchlists ═══
export const wlStore = {
  lists: [], activeListId: null,
  _saveT: null,

  async load() {
    const local = read(LS.watchlists, null);
    let server = null;
    if (api.state.serverOk) { try { server = await api.wlList(); } catch { server = null; } }
    const doc = (server && server.lists) ? server : local;
    if (doc && Array.isArray(doc.lists) && doc.lists.length) {
      this.lists = doc.lists; this.activeListId = doc.activeListId;
    } else {
      const l = { id: uid('wl'), name: 'מעקב', items: ['SPY', 'QQQ', 'NVDA', 'AAPL', 'TSLA', 'MSFT'].map((s) => ({ symbol: s, color: null })) };
      this.lists = [l]; this.activeListId = l.id;
    }
    if (!this.lists.some((l) => l.id === this.activeListId)) this.activeListId = this.lists[0]?.id ?? null;
    this.saveLocal();
  },
  active() { return this.lists.find((l) => l.id === this.activeListId) || this.lists[0]; },
  saveLocal() { write(LS.watchlists, { lists: this.lists, activeListId: this.activeListId }); },
  async save() {
    this.saveLocal();
    clearTimeout(this._saveT);
    const active = this.active();
    this._pendingLists ||= new Map();
    if (active) this._pendingLists.set(active.id, JSON.parse(JSON.stringify(active.items)));
    this._saveT = setTimeout(async () => {
      if (!api.state.serverOk) return;
      const pending = [...this._pendingLists]; this._pendingLists.clear();
      for (const [id, items] of pending) { try { await api.wlUpdate(id, { items }); } catch { /* local only */ } }
    }, 600);
  },
  async create(name) {
    if (api.state.serverOk) { try { const l = await api.wlCreate(name); this.lists.push(l); this.activeListId = l.id; this.saveLocal(); return l; } catch { /* fall through */ } }
    const l = { id: uid('wl'), name: name || 'רשימה חדשה', items: [] };
    this.lists.push(l); this.activeListId = l.id; this.save();
    return l;
  },
  async rename(id, name) {
    const l = this.lists.find((x) => x.id === id); if (!l || !name.trim()) return;
    l.name = name.trim().slice(0, 60);
    if (api.state.serverOk) { try { await api.wlUpdate(id, { name: l.name }); } catch { /* fall through */ } }
    this.save();
  },
  async remove(id) {
    if (api.state.serverOk) { try { await api.wlDelete(id); } catch { /* fall through */ } }
    this.lists = this.lists.filter((x) => x.id !== id);
    if (this.activeListId === id) this.activeListId = this.lists[0]?.id ?? null;
    this.saveLocal();
  },
};

// ═══ Saved scans ═══
export const scanStore = {
  scans: [],
  async load() {
    const local = read(LS.scans, []);
    let server = null;
    if (api.state.serverOk) { try { server = await api.scansList(); } catch { server = null; } }
    this.scans = Array.isArray(server) ? server : local;
  },
  saveLocal() { write(LS.scans, this.scans); },
  async saveScan(name, criteria, sort) {
    if (api.state.serverOk) {
      try { const r = await api.scanSave(name, criteria, sort); this.scans.push(r); this.saveLocal(); return r; }
      catch { /* fall through */ }
    }
    const r = { id: uid('sc'), name, criteria, sort, createdAt: Date.now(), updatedAt: Date.now() };
    this.scans.push(r); this.saveLocal(); return r;
  },
  async delete(id) {
    if (api.state.serverOk) { try { await api.scanDelete(id); } catch { /* fall through */ } }
    this.scans = this.scans.filter((x) => x.id !== id);
    this.saveLocal();
  },
};
