// alerts.js — EOD alerts UI: create form (also Alt+A at the cursor price),
// management panel (active list, pause/delete, fired history), in-app toast + badge.
// Alerts are evaluated server-side once per daily snapshot (see worker/lib/alerts.mjs).
import { api } from './api.js';
import { toast } from './tabs.js';

const $ = (id) => document.getElementById(id);
const LS_SEEN = '7d.alerts.seen';
const TYPE_HE = {
  price_up: 'מחיר חוצה מעלה', price_down: 'מחיר חוצה מטה',
  chg_up: 'עלייה יומית %', chg_down: 'ירידה יומית %',
  rel_vol: 'ווליום חריג (x)', ema_touch: 'נגיעה ב-EMA',
};
const VALUE_HINT = {
  price_up: 'רמת מחיר', price_down: 'רמת מחיר', chg_up: 'אחוז (למשל 5)', chg_down: 'אחוז (למשל 5)',
  rel_vol: 'נפח יחסי (למשל 2)', ema_touch: 'תקופת EMA',
};
const STATUS_HE = { active: 'פעילה', paused: 'מושהית', fired: 'נורתה' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtDate = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) + 'Z' : '');

export class AlertsUI {
  constructor(getSymbol, getCursorPrice) {
    this.getSymbol = getSymbol;
    this.getCursorPrice = getCursorPrice;
    this.alerts = [];
    this.events = [];
    this.state = null;
    this.tab = 'active';
  }

  wire() {
    const m = $('alerts-modal');
    $('btn-alerts').onclick = () => this.open();
    m.querySelector('.modal-close').onclick = () => this.close();
    m.addEventListener('click', (e) => { if (e.target === m) this.close(); });
    $('al-type').onchange = () => this.syncForm();
    $('al-add').onclick = () => this.create();
    $('al-run').onclick = () => this.runNow();
    $('al-clear-hist').onclick = async () => {
      try { await api.alertsHistoryClear(); } catch { /* */ }
      await this.reload(); this.render();
    };
    m.querySelectorAll('.al-tabs button').forEach((b) => {
      b.onclick = () => { this.tab = b.dataset.tab; this.render(); };
    });
    $('al-value').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.create(); });
    this.poll();
    setInterval(() => this.poll(), 5 * 60 * 1000);
  }

  get isOpen() { return !$('alerts-modal').hidden; }

  syncForm() {
    const t = $('al-type').value;
    const v = $('al-value');
    v.placeholder = VALUE_HINT[t];
    if (t === 'ema_touch') { if (!['20', '50'].includes(v.value)) v.value = '20'; }
  }

  // prefill = { symbol, type, value }
  async open(prefill = null, tab = 'active') {
    if (!api.state.serverOk) { toast('התראות דורשות חיבור לשרת (לחץ על "מצב מקומי" להגדרת טוקן)'); return; }
    this.tab = tab;
    $('alerts-modal').hidden = false;
    $('al-symbol').value = (prefill?.symbol || this.getSymbol() || '').toUpperCase();
    if (prefill?.type) $('al-type').value = prefill.type;
    $('al-value').value = prefill?.value != null ? String(prefill.value) : '';
    $('al-note').value = '';
    this.syncForm();
    await this.reload();
    this.render();
    this.markSeen();
    setTimeout(() => { const v = $('al-value'); v.focus(); v.select(); }, 30);
  }
  close() { $('alerts-modal').hidden = true; }

  // Alt+A: alert at the crosshair price of the active chart
  async openAtCursor() {
    const sym = this.getSymbol();
    const cur = this.getCursorPrice();
    let last = null;
    try { last = (await api.quote(sym)).price; } catch { /* */ }
    if (cur == null) { toast('הזז את העכבר על הגרף ואז Alt+A — או בחר רמה ידנית'); return this.open({ symbol: sym }); }
    const price = Math.round(cur * 100) / 100;
    const type = last != null && price < last ? 'price_down' : 'price_up';
    return this.open({ symbol: sym, type, value: price });
  }

  async reload() {
    try {
      const [a, h] = await Promise.all([api.alertsList(), api.alertsHistory()]);
      this.alerts = a.alerts || []; this.state = a.state || null; this.snapshotAsOf = a.snapshotAsOf || null;
      this.events = h.events || [];
    } catch { /* keep previous */ }
  }

  async create() {
    const body = {
      symbol: $('al-symbol').value.trim(), type: $('al-type').value, value: $('al-value').value,
      repeat: $('al-repeat').checked ? 'daily' : 'once', note: $('al-note').value.trim(),
    };
    try {
      const a = await api.alertCreate(body);
      toast(`התראה נוצרה: ${a.symbol} · ${TYPE_HE[a.type]} ${a.value}`);
      $('al-value').value = '';
      await this.reload(); this.tab = 'active'; this.render();
    } catch (e) { toast(e.code === 400 ? 'ערכים לא תקינים — בדוק סימבול וערך' : 'שגיאה ביצירת התראה'); }
  }

  async runNow() {
    $('al-run').disabled = true;
    try {
      const r = await api.alertsEvaluate();
      toast(r.fired ? `${r.fired} התראות נורו` : `נבדקו ${r.checked} התראות — אין חדשות (נתוני ${String(r.snapshotAsOf || '').slice(0, 10)})`);
      await this.reload(); this.render();
      if (r.fired) { this.tab = 'history'; this.render(); this.markSeen(); }
    } catch { toast('בדיקה נכשלה'); }
    $('al-run').disabled = false;
  }

  render() {
    const m = $('alerts-modal');
    m.querySelectorAll('.al-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === this.tab));
    $('al-active').hidden = this.tab !== 'active';
    $('al-history').hidden = this.tab !== 'history';
    $('al-clear-hist').hidden = this.tab !== 'history';
    const nAct = this.alerts.filter((a) => a.status === 'active').length;
    m.querySelector('.al-tabs [data-tab="active"]').textContent = `התראות (${this.alerts.length})`;
    m.querySelector('.al-tabs [data-tab="history"]').textContent = `היסטוריה (${this.events.length})`;
    const st = this.state;
    $('al-status').textContent = st
      ? `בדיקה אחרונה: ${fmtDate(st.lastRunAt)} · נתוני ${String(st.snapshotAsOf || '').slice(0, 10)} · ${st.fired} נורו · ${nAct} פעילות`
      : `טרם בוצעה בדיקה · ${nAct} פעילות · הבדיקה האוטומטית רצה פעם ביום אחרי רענון הנתונים`;

    const list = $('al-active');
    if (!this.alerts.length) list.innerHTML = '<div class="skel">אין התראות. צור אחת למעלה, או לחץ Alt+A על הגרף.</div>';
    else {
      list.innerHTML = this.alerts.map((a) => `
        <div class="al-row ${a.status}" data-id="${esc(a.id)}">
          <b class="al-sym" dir="ltr">${esc(a.symbol)}</b>
          <span class="al-desc">${esc(TYPE_HE[a.type])} <b dir="ltr">${esc(a.value)}</b>${a.repeat === 'daily' ? ' · יומית' : ''}${a.note ? ` · <i>${esc(a.note)}</i>` : ''}</span>
          <span class="al-st st-${a.status}">${STATUS_HE[a.status] || a.status}${a.firedCount ? ` ×${a.firedCount}` : ''}</span>
          <button class="icon-btn" data-act="toggle" title="${a.status === 'active' ? 'השהה' : 'הפעל מחדש'}">${a.status === 'active' ? '⏸' : '▶'}</button>
          <button class="icon-btn danger" data-act="del" title="מחק">🗑</button>
        </div>`).join('');
      list.querySelectorAll('.al-row').forEach((row) => {
        const id = row.dataset.id;
        const a = this.alerts.find((x) => x.id === id);
        row.querySelector('[data-act="toggle"]').onclick = async () => {
          await api.alertUpdate(id, { status: a.status === 'active' ? 'paused' : 'active' });
          await this.reload(); this.render();
        };
        row.querySelector('[data-act="del"]').onclick = async () => {
          await api.alertDelete(id); await this.reload(); this.render();
        };
        row.querySelector('.al-sym').onclick = () => { this.close(); this.onPick && this.onPick(a.symbol); };
      });
    }
    const hist = $('al-history');
    if (!this.events.length) hist.innerHTML = '<div class="skel">עדיין לא נורתה אף התראה.</div>';
    else {
      hist.innerHTML = this.events.map((e) => {
        const x = e.actual || {};
        const detail = [x.price != null ? `סגירה ${x.price}` : '', x.chg != null ? `${x.chg >= 0 ? '+' : ''}${x.chg}%` : '',
          x.relVol != null ? `נפח ${x.relVol}x` : '', x.ema != null ? `EMA ${x.ema}` : ''].filter(Boolean).join(' · ');
        return `<div class="al-row fired"><b class="al-sym" dir="ltr">${esc(e.symbol)}</b>
          <span class="al-desc">${esc(e.label)}${e.manual ? ' <i>(בדיקה ידנית)</i>' : ''}<br><small>${esc(detail)}</small></span>
          <span class="al-st" dir="ltr">${esc(fmtDate(e.firedAt))}<br><small>נתוני ${esc(String(e.asOf || '').slice(0, 10))}</small></span></div>`;
      }).join('');
    }
  }

  // ── in-app delivery: poll history, toast unseen fires, badge on the button ──
  seenTs() { try { return localStorage.getItem(LS_SEEN) || ''; } catch { return ''; } }
  markSeen() {
    const newest = this.events[0]?.firedAt;
    if (newest) { try { localStorage.setItem(LS_SEEN, newest); } catch { /* */ } }
    this.paintBadge();
  }
  unseen() { const s = this.seenTs(); return this.events.filter((e) => e.firedAt > s); }
  paintBadge() {
    const n = this.unseen().length;
    const b = $('alerts-badge');
    b.textContent = n; b.hidden = !n;
  }
  async poll() {
    if (!api.state.serverOk) return;
    try { this.events = (await api.alertsHistory()).events || []; } catch { return; }
    if (!this.seenTs() && this.events.length && !this._first) {
      // first run on this browser: don't flood with old history
      this._first = true; this.markSeen(); return;
    }
    this._first = true;
    const un = this.unseen();
    this.paintBadge();
    if (un.length && !this.isOpen) {
      toast(`התראה: ${un[0].label}${un.length > 1 ? ` (+${un.length - 1} נוספות)` : ''}`);
    }
  }
  }
