// search.js — global symbol search modal (Ctrl+K), keyboard navigation.
import { api } from './api.js';

export class SearchUI {
  constructor(onPick) {
    this.onPick = onPick;
    this.modal = document.getElementById('search-modal');
    this.input = document.getElementById('search-input');
    this.list = document.getElementById('search-results');
    this.items = [];
    this.sel = 0;
    this._t = null;
    this.recent = JSON.parse(localStorage.getItem('7d.recent') || '[]');
  }

  open() {
    this.modal.hidden = false;
    this.input.value = '';
    this.renderRecent();
    setTimeout(() => this.input.focus(), 30);
  }
  close() { this.modal.hidden = true; }
  get isOpen() { return !this.modal.hidden; }

  renderRecent() {
    this.items = this.recent.map((s) => ({ symbol: s, name: '', exchange: '' }));
    this.draw();
  }

  draw() {
    this.list.innerHTML = '';
    if (!this.items.length) {
      this.list.innerHTML = '<li class="skel">אין תוצאות — נסה סימבול אחר.</li>';
      return;
    }
    this.items.forEach((r, i) => {
      const li = document.createElement('li');
      if (i === this.sel) li.classList.add('sel');
      li.innerHTML = `<span class="s" dir="ltr">${r.symbol}</span><span class="n">${r.name || ''}</span><span class="e" dir="ltr">${r.exchange || ''}</span>`;
      li.onclick = () => this.pick(i);
      li.onmousemove = () => { this.sel = i; this.draw(); };
      this.list.appendChild(li);
    });
  }

  pick(i) {
    const r = this.items[i ?? this.sel];
    if (!r) return;
    this.recent = [r.symbol, ...this.recent.filter((s) => s !== r.symbol)].slice(0, 8);
    localStorage.setItem('7d.recent', JSON.stringify(this.recent));
    this.close();
    this.onPick && this.onPick(r.symbol);
  }

  wire() {
    this.input.addEventListener('input', () => {
      clearTimeout(this._t);
      const q = this.input.value.trim();
      if (!q) { this.renderRecent(); return; }
      this._t = setTimeout(async () => {
        try {
          this.items = await api.search(q, 12);
          this.sel = 0; this.draw();
        } catch { this.items = []; this.draw(); }
      }, 180);
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); this.sel = Math.min(this.sel + 1, this.items.length - 1); this.draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.sel = Math.max(this.sel - 1, 0); this.draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); this.pick(); }
      else if (e.key === 'Escape') this.close();
    });
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
    document.getElementById('btn-search').onclick = () => this.open();
  }
}
