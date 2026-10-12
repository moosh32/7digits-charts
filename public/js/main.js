// main.js — bootstrap for the 7D charting platform.
import { api } from './api.js';
import { tabsStore, wlStore, scanStore } from './state.js';
import { Chart7D } from './chart.js';
import { TabsUI, toast } from './tabs.js';
import { WatchlistUI, wireWatchlistButtons } from './watchlist.js';
import { ScanUI, showScanView } from './scan.js';
import { SearchUI } from './search.js';
import { PineUI } from './pine.js';
import { wireShortcuts } from './shortcuts.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  const serverOk = await api.init();
  paintMode();
  // click the mode indicator to set/clear the API token (server sync)
  $('sb-mode').style.cursor = 'pointer';
  $('sb-mode').title = 'לחץ להגדרת טוקן סנכרון שרת';
  $('sb-mode').onclick = async () => {
    const cur = api.hasManualSecret();
    const v = prompt(cur ? 'טוקן סנכרון שרת (ריק לניתוק):' : 'טוקן סנכרון שרת:', '');
    if (v === null) return;
    api.setSecret(v.trim() || null);
    const ok = await api.init();
    paintMode();
    toast(ok ? 'מחובר לשרת ✓' : 'מצב מקומי — הסנכרון שמור בדפדפן בלבד');
  };
  function paintMode() {
    const ok = api.state.serverOk;
    $('sb-mode').textContent = ok ? 'מחובר לשרת' : 'מצב מקומי';
    $('sb-mode').style.color = ok ? 'var(--up)' : 'var(--gold)';
  }

  try {
    const h = await api.health();
    if (h?.snapshot) $('sb-data').textContent = `נתונים: ${String(h.snapshot.asOf).slice(0, 10)} · ${h.snapshot.count} מניות`;
  } catch { /* */ }

  await tabsStore.load();
  await scanStore.load();

  // ── chart ──
  const c7 = new Chart7D($('chart'));
  const t0 = tabsStore.active();
  c7.status('טוען ' + t0.symbol + '…');
  const j0 = await api.bars(t0.symbol, t0.timeframe).catch((e) => ({ bars: [], count: 0, error: true }));
  if (j0.error) c7.status('שגיאת נתונים — בדוק חיבור', true);
  await c7.create(t0.symbol, t0.timeframe, j0.bars || []);
  c7.restoreDrawings(t0.drawings);
  for (const [k, on] of Object.entries(t0.indicators || {})) if (on) await c7.setIndicator(k, true);
  c7.status(`${t0.symbol} · ${t0.timeframe} · ${j0.count ?? 0} נרות`);

  const tabs = new TabsUI(c7, api, onTabSwitch);
  tabs.render();
  tabs.syncToggles(t0);
  c7.onDrawingsChange = () => tabs.persistDrawings();

  // ── watchlist ──
  const wl = new WatchlistUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  await wl.init();
  wireWatchlistButtons(wl);

  // ── scan ──
  const scan = new ScanUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  scan.render();
  $('btn-scan').onclick = () => {
    const showing = $('scan-view').hidden;
    showScanView(showing);
    if (!showing) setTimeout(() => c7.resize(), 30);
  };

  // ── search / pine ──
  const search = new SearchUI((sym) => { showScanView(false); c7.resize(); tabs.setSymbol(sym); });
  search.wire();
  const pine = new PineUI(c7, () => tabsStore.active(), () => tabsStore.save());
  pine.wire();

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
  wireShortcuts({ search, pine, chart: c7, tabs, activeTabId: () => tabsStore.activeId });

  // ── resize / unload ──
  window.addEventListener('resize', () => c7.resize());
  window.addEventListener('beforeunload', () => tabs.persistDrawings());

  // ── clock ──
  const tick = () => { $('sb-clock').textContent = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }); };
  tick(); setInterval(tick, 1000);

  console.info('[7d] ready. server=%s', serverOk);
  window.__7d = { c7, tabs, wl, scan, search, pine, api, stores: { tabsStore, wlStore, scanStore } };
}

document.addEventListener('DOMContentLoaded', boot);
