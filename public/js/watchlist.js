// watchlist.js — named lists, CRUD, 5 color tags, sort/filter, live quotes, click-to-chart.
import { api } from './api.js';
import { wlStore } from './state.js';
import { toast } from './tabs.js';
import { dialog, parseTickers } from './ux.js';

const COLORS = [null, 'red', 'orange', 'yellow', 'green', 'blue'];
const COLOR_HE = { red: 'אדום', orange: 'כתום', yellow: 'צהוב', green: 'ירוק', blue: 'כחול' };

export class WatchlistUI {
  constructor(onPick) {
    this.onPick = onPick;
    this.quotes = {};
    this.textFilter = '';
    this.tagFilter = '';
    this.sort = 'manual';
    this._qT = null;
  }

  async init() { await wlStore.load(); this.render(); this.refreshQuotes(); setInterval(() => this.refreshQuotes(), 60000); }

  active() { return wlStore.active(); }

  render() {
    const sel = document.getElementById('wl-select');
    sel.innerHTML = '';
    for (const l of wlStore.lists) {
      const o = document.createElement('option');
      o.value = l.id; o.textContent = l.name;
      if (l.id === wlStore.activeListId) o.selected = true;
      sel.appendChild(o);
    }
    sel.onchange = () => { wlStore.activeListId = sel.value; wlStore.save(); this.render(); this.refreshQuotes(); };
    document.getElementById('wl-filter').oninput = (e) => { this.textFilter = e.target.value.toLowerCase(); this.renderItems(); };
    document.getElementById('wl-sort').onchange = (e) => { this.sort = e.target.value; this.renderItems(); };
    document.querySelectorAll('#wl-tags .tag-filter').forEach((b) => {
      b.classList.toggle('active', (b.dataset.tag || '') === this.tagFilter);
      b.onclick = () => { this.tagFilter = b.dataset.tag || ''; this.render(); };
    });
    this.renderItems();
  }

  rows() {
    const l = this.active();
    if (!l) return [];
    let items = l.items.slice();
    if (this.tagFilter) items = items.filter((i) => i.color === this.tagFilter);
    if (this.textFilter) items = items.filter((i) => i.symbol.toLowerCase().includes(this.textFilter));
    const q = this.quotes;
    if (this.sort === 'symbol') items.sort((a, b) => a.symbol.localeCompare(b.symbol));
    else if (this.sort === 'change') items.sort((a, b) => (q[b.symbol]?.changePct ?? -1e9) - (q[a.symbol]?.changePct ?? -1e9));
    else if (this.sort === 'volume') items.sort((a, b) => (q[b.symbol]?.volume ?? -1) - (q[a.symbol]?.volume ?? -1));
    return items;
  }

  renderItems() {
    const ul = document.getElementById('wl-items');
    ul.innerHTML = '';
    const rows = this.rows();
    if (!rows.length) {
      ul.innerHTML = '<li class="wl-empty">אין סימבולים ברשימה.<br>הקלד סימבול למטה והקש Enter.</li>';
      return;
    }
    for (const item of rows) {
      const li = document.createElement('li');
      li.className = 'wl-row';
      const q = this.quotes[item.symbol];
      const chg = q?.changePct;
      li.innerHTML = `
        <span class="sym" dir="ltr"><span class="dot ${item.color || ''}" style="${item.color ? '' : 'visibility:hidden'}"></span>${item.symbol}</span>
        <span class="px">${q ? q.price.toFixed(2) : '—'}</span>
        <span class="chg ${chg == null ? '' : chg >= 0 ? 'up' : 'dn'}" dir="ltr">${chg == null ? '' : (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'}</span>
        <button class="note-btn" title="הערה לטיקר">✎</button><button class="rm" title="הסר">✕</button>`;
      li.title = item.note || (item.color ? 'תג: ' + COLOR_HE[item.color] : item.symbol);
      if (item.note) { const n = document.createElement('span'); n.className = 'wl-note'; n.textContent = item.note; li.append(n); }
      li.querySelector('.note-btn').onclick = e => { e.stopPropagation(); this.editNote(item); };
      li.onclick = () => {
        if (this.onPick) this.onPick(item.symbol);
        if (isNarrowWatchlist()) closeWatchlistDrawer(); // drawer out of the way after picking
      };
      li.querySelector('.rm').onclick = (e) => { e.stopPropagation(); this.remove(item.symbol); };
      li.oncontextmenu = (e) => { e.preventDefault(); this.cycleColor(item.symbol); };
      ul.appendChild(li);
    }
  }

  async refreshQuotes() {
    const l = this.active();
    if (!l || !l.items.length) return;
    try {
      this.quotes = await api.quotes(l.items.map((i) => i.symbol));
      this.renderItems();
    } catch { /* keep last */ }
  }

  editNote(item) {
    dialog('הערה ל-' + item.symbol, (box, close) => {
      const input = document.createElement('textarea'); input.className = 'ux-text'; input.maxLength = 500; input.dir = 'auto'; input.value = item.note || ''; input.placeholder = 'רמת כניסה, תנאי לפריצה, מה לבדוק…';
      const save = document.createElement('button'); save.className = 'btn-primary'; save.textContent = 'שמור הערה';
      save.onclick = async () => { item.note = input.value.trim(); await wlStore.save(); this.renderItems(); close(); };
      const foot = document.createElement('div'); foot.className = 'modal-foot'; foot.append(save); box.append(input, foot);
    });
  }

  async addMany(symbols, listId = wlStore.activeListId) {
    const l = wlStore.lists.find(x => x.id === listId); if (!l) { toast('בחר רשימה'); return; }
    const have = new Set(l.items.map(x => x.symbol)); let added = 0, duplicate = 0, full = 0;
    for (const symbol of symbols) {
      if (have.has(symbol)) { duplicate++; continue; }
      if (l.items.length >= 500) { full++; continue; }
      have.add(symbol); l.items.push({symbol, color: null}); added++;
    }
    wlStore.activeListId = l.id; await wlStore.save(); this.render(); this.refreshQuotes();
    toast(`נוספו ${added} ל-${l.name} · ${duplicate} כבר ברשימה${full ? ' · ' + full + ' לא נוספו (מגבלת 500)' : ''}`);
    return { added, duplicate, full };
  }

  pasteImport() {
    const l = this.active(); if (!l) { toast('צור רשימה תחילה'); return; }
    dialog('הדבקת טיקרים ל-' + l.name, (box, close) => {
      const input = document.createElement('textarea'); input.className = 'ux-text'; input.dir = 'ltr'; input.placeholder = 'NVDA, AAPL, NASDAQ:AMD'; input.setAttribute('aria-label', 'רשימת טיקרים');
      const preview = document.createElement('p'); preview.className = 'ux-hint';
      const save = document.createElement('button'); save.className = 'btn-primary'; save.textContent = 'הוסף לרשימה';
      const update = () => { const p = parseTickers(input.value); preview.textContent = `${p.symbols.length} טיקרים ייחודיים · כפילויות לא יתווספו` + (p.invalid.length ? ` · לא תקינים: ${p.invalid.join(', ')}` : ''); save.disabled = !p.symbols.length || !!p.invalid.length; }; input.oninput = update; update();
      save.onclick = async () => { const p = parseTickers(input.value); if(!p.symbols.length || p.invalid.length) return; save.disabled = true; await this.addMany(p.symbols, l.id); close(); };
      const foot = document.createElement('div'); foot.className = 'modal-foot'; foot.append(save); box.append(input, preview, foot);
    });
  }

  async add(symbol) {
    symbol = symbol.trim().toUpperCase();
    if (!symbol) return;
    let l = this.active();
    if (!l) { toast('אין רשימה פעילה'); return; }
    if (l.items.some((i) => i.symbol === symbol)) { toast(symbol + ' כבר ברשימה'); return; }
    if (l.items.length >= 500) { toast('הרשימה מלאה'); return; }
    l.items.push({ symbol, color: null });
    await wlStore.save();
    try { this.quotes = { ...this.quotes, ...(await api.quotes([symbol])) }; } catch { /* */ }
    this.renderItems();
  }

  async remove(symbol) {
    const l = this.active(); if (!l) return;
    l.items = l.items.filter((i) => i.symbol !== symbol);
    await wlStore.save(); this.renderItems();
  }

  async cycleColor(symbol) {
    const l = this.active(); if (!l) return;
    const item = l.items.find((i) => i.symbol === symbol); if (!item) return;
    const i = COLORS.indexOf(item.color);
    item.color = COLORS[(i + 1) % COLORS.length];
    await wlStore.save(); this.renderItems();
  }

  async createList() {
    const name = prompt('שם הרשימה:', 'רשימה חדשה');
    if (name === null) return;
    await wlStore.create(name.trim() || 'רשימה חדשה');
    this.render(); this.refreshQuotes();
  }
  async renameList() {
    const l = this.active(); if (!l) return;
    const name = prompt('שם חדש:', l.name);
    if (name === null) return;
    await wlStore.rename(l.id, name);
    this.render();
  }
  async removeList() {
    const l = this.active(); if (!l) return;
    if (!confirm(`למחוק את הרשימה "${l.name}"?`)) return;
    await wlStore.remove(l.id);
    this.render(); this.refreshQuotes();
  }
}

export function wireWatchlistButtons(ui) {
  document.getElementById('wl-import').onclick = () => ui.pasteImport();
  document.getElementById('wl-add-list').onclick = () => ui.createList();
  document.getElementById('wl-rename').onclick = () => ui.renameList();
  document.getElementById('wl-del-list').onclick = () => ui.removeList();
  const inp = document.getElementById('wl-add-input');
  inp.onkeydown = (e) => { if (e.key === 'Enter') { ui.add(inp.value); inp.value = ''; } };
  document.getElementById('btn-wl').onclick = () => toggleWatchlist();
  document.getElementById('wl-close').onclick = () => closeWatchlistDrawer();
  document.getElementById('wl-backdrop').onclick = () => closeWatchlistDrawer();
  // Esc closes the drawer on narrow screens
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isNarrowWatchlist() &&
        document.getElementById('watchlist-panel').classList.contains('open')) {
      closeWatchlistDrawer();
    }
  });
  // leaving narrow mode resets drawer state
  narrowWatchlistMQ().addEventListener('change', (e) => { if (!e.matches) closeWatchlistDrawer(); });
}

// ── ≤1280px drawer behavior (wide screens keep the old collapse toggle) ──
export const narrowWatchlistMQ = () => window.matchMedia('(max-width: 1280px)');
export const isNarrowWatchlist = () => narrowWatchlistMQ().matches;

export function openWatchlistDrawer() {
  document.getElementById('watchlist-panel').classList.add('open');
  document.getElementById('wl-backdrop').hidden = false;
}
export function closeWatchlistDrawer() {
  document.getElementById('watchlist-panel').classList.remove('open');
  document.getElementById('wl-backdrop').hidden = true;
}
export function toggleWatchlist() {
  if (isNarrowWatchlist()) {
    document.getElementById('watchlist-panel').classList.contains('open')
      ? closeWatchlistDrawer() : openWatchlistDrawer();
  } else {
    document.getElementById('watchlist-panel').classList.toggle('collapsed');
  }
}
