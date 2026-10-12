// main.js — bootstrap for the 7D charting platform.
import { api } from './api.js';
import { tabsStore, wlStore, scanStore } from './state.js';
import { Layout7D } from './chart.js';
import { TabsUI, toast } from './tabs.js';
import { WatchlistUI, wireWatchlistButtons } from './watchlist.js';
import { ScanUI, showScanView } from './scan.js';
import { SearchUI } from './search.js';
import { AlertsUI } from './alerts.js';
import { PineUI } from './pine.js';
import { wireShortcuts } from './shortcuts.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const serverOk = await api.init();
  paintMode();
  // status-bar click opens the token modal (proper password field — the old
  // native prompt() is gone so password managers can fill it)
  wireTokenModal();
  function paintMode() {
    const ok = api.state.serverOk;
    $('sb-mode').textContent = ok ? 'מחובר לשרת' : 'מצב מקומי';
    $('sb-mode').style.color = ok ? 'var(--up)' : 'var(--gold)';
  }
  function wireTokenModal() {
    const modal = $('token-modal'), input = $('token-input');
    const open = () => {
      try { input.value = localStorage.getItem('7d.api.secret') || ''; } catch { input.value = ''; }
      modal.hidden = false;
      setTimeout(() => { input.focus(); input.select(); }, 30);
    };
    const close = () => { modal.hidden = true; };
    $('sb-mode').style.cursor = 'pointer';
    $('sb-mode').title = 'לחץ להגדרת טוקן סנכרון שרת';
    $('sb-mode').onclick = open;
    modal.querySelector('.modal-close').onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('token-save').click(); });
    $('token-save').onclick = async () => {
      api.setSecret(input.value.trim() || null);
      const ok = await api.init();
      paintMode(); close();
      toast(ok ? 'מחובר לשרת ✓' : 'מצב מקומי — הסנכרון שמור בדפדפן בלבד');
    };
    $('token-clear').onclick = async () => {
      api.setSecret(null); input.value = '';
      await api.init(); paintMode(); close();
      toast('נותק מהשרת — מצב מקומי');
    };
  }

  try {
    const h = await api.health();
    if (h?.snapshot) $('sb-data').textContent = `נתונים: ${String(h.snapshot.asOf).slice(0, 10)} · ${h.snapshot.count} מניות`;
  } catch { /* */ }

  await tabsStore.load();
  await scanStore.load();

  // ── chart ──
  const c7 = new Layout7D($('chart'), api, tabsStore);
  const t0 = tabsStore.active();
  await c7.loadTab(t0);

  const tabs = new TabsUI(c7, api, onTabSwitch);
  c7.onSelect = (t) => { tabs.syncToggles(t); tabs.render(); onTabSwitch(); };
  c7.onSymbol = (sym) => tabs.setSymbol(sym);
  c7.onTimeframe = (tf) => tabs.setTimeframe(tf);
  tabs.render();
  $('tab-link').onclick = () => tabs.toggleLink();
  $('tab-duplicate').onclick = () => tabs.duplicate();
  tabs.syncToggles(t0);
  c7.onDrawingsChange = () => tabs.persistDrawings();

  // ── watchlist ──
  const wl = new WatchlistUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  await wl.init();
  wireWatchlistButtons(wl);

  // ── scan ──
  const scan = new ScanUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); }, wl);
  scan.render();
  $('btn-scan').onclick = () => {
    const showing = $('scan-view').hidden;
    showScanView(showing);
    if (!showing) setTimeout(() => c7.resize(), 30);
  };

  // ── search / pine ──
  const search = new SearchUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  search.wire();
  const pine = new PineUI(c7, () => tabsStore.active(), () => tabsStore.save(),
    () => scan.lastResult,
    (sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  pine.wire();

  // ── EOD alerts ──
  const alerts = new AlertsUI(() => tabsStore.active().symbol, () => c7.cursorPrice);
  alerts.onPick = (sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); };
  alerts.wire();

  // ── timeframe + indicator toggles ──
  document.querySelectorAll('#tf-bar button').forEach((b) => {
    b.onclick = () => { showScanView(false); c7.resize(); tabs.setTimeframe(b.dataset.tf); };
  });
  document.querySelectorAll('#ind-toggles button').forEach((b) => {
    b.onclick = () => tabs.setIndicatorToggle(b.dataset.ind, !tabsStore.active().indicators?.[b.dataset.ind]);
  });

  // ── drawing tools: Vela's native toolbar (left rail inside the chart) owns
  // tool arming, magnet and eraser — no custom rail (it duplicated the native one).

  // ── tab add ──
  $('tab-add').onclick = () => tabs.add();

  // ── quote chip ──
  async function refreshQuote() {
    const t = tabsStore.active();
    try {
      const q = await api.quote(t.symbol);
      $('quote-chip').innerHTML = `<b>${t.symbol}</b> ${q.price.toFixed(2)} <span class="${q.changePct >= 0 ? 'up' : 'dn'}">${(q.changePct >= 0 ? '+' : '') + q.changePct.toFixed(2)}%</span>`;
    } catch { $('quote-chip').textContent = ''; }
  }
  async function onTabSwitch() { await refreshQuote(); }
  await refreshQuote();
  setInterval(refreshQuote, 60000);

  // ── shortcuts ──
  wireShortcuts({ search, pine, alerts, chart: c7, tabs, activeTabId: () => tabsStore.activeId });

  // ── resize / unload ──
  window.addEventListener('resize', () => c7.resize());
  window.addEventListener('beforeunload', () => tabs.persistDrawings());

  // ── clock ──
  const tick = () => { $('sb-clock').textContent = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }); };
  tick(); setInterval(tick, 1000);

  console.info('[7d] ready. server=%s', serverOk);
  window.__7d = { alerts, c7, tabs, wl, scan, search, pine, api, stores: { tabsStore, wlStore, scanStore } };
}

document.addEventListener('DOMContentLoaded', boot);
