// api.js — 7D API client. Server mode (Bearer) when a token is available and
// protected endpoints answer; otherwise localStorage-only mode (503 fallback).
// Token sources, in order: manual entry (localStorage '7d.api.secret', set from the
// status bar), then /api/config (dev-mock only — the real backend never serves the
// secret to browsers).
const LS_SECRET = '7d.api.secret';
const state = {
  secret: null,
  serverOk: false,   // protected endpoints reachable + authorized
  base: '',
};
try { state.secret = localStorage.getItem(LS_SECRET) || null; } catch { /* */ }

function setSecret(s) {
  state.secret = s || null;
  try {
    if (s) localStorage.setItem(LS_SECRET, s);
    else localStorage.removeItem(LS_SECRET);
  } catch { /* */ }
}

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.secret) headers.Authorization = `Bearer ${state.secret}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(state.base + path, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (r.status === 503 || r.status === 401) {
    const e = new Error(r.status === 503 ? 'server-unavailable' : 'unauthorized');
    e.code = r.status; throw e;
  }
  if (!r.ok) { const e = new Error('http ' + r.status); e.code = r.status; throw e; }
  return r.json();
}

export const api = {
  state,
  setSecret,
  hasManualSecret() { try { return !!localStorage.getItem(LS_SECRET); } catch { return !!state.secret; } },
  async init() {
    if (!state.secret) {
      try {
        const cfg = await req('/api/config');
        if (cfg && cfg.apiSecret) state.secret = cfg.apiSecret;
      } catch { /* no config endpoint — try direct */ }
    }
    try {
      await req('/api/watchlists');   // protected probe
      state.serverOk = true;
    } catch (e) {
      state.serverOk = false;
    }
    return state.serverOk;
  },

  // ── public market endpoints (never need auth) ──
  bars: (symbol, timeframe) => req(`/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}`),
  search: (q, limit = 12) => req(`/api/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  quote: (symbol) => req(`/api/quote?symbol=${encodeURIComponent(symbol)}`),
  quotes: (symbols) => req(`/api/quotes?symbols=${symbols.map(encodeURIComponent).join(',')}`),
  health: () => req('/api/health'),

  // ── scans ──
  scanRun: (criteria, sort, limit) => req('/api/scan/run', { method: 'POST', body: { criteria, sort, limit } }),
  scansList: () => req('/api/scans/custom'),
  scanSave: (name, criteria, sort) => req('/api/scans/custom', { method: 'POST', body: { name, criteria, sort } }),
  scanUpdate: (id, patch) => req(`/api/scans/custom/${id}`, { method: 'PUT', body: patch }),
  scanDelete: (id) => req(`/api/scans/custom/${id}`, { method: 'DELETE' }),
  scanRunSaved: (id, limit) => req(`/api/scans/custom/${id}/run`, { method: 'POST', body: { limit } }),

  // ── watchlists v2 ──
  wlList: () => req('/api/watchlists'),
  wlCreate: (name) => req('/api/watchlists', { method: 'POST', body: { name } }),
  wlUpdate: (id, patch) => req(`/api/watchlists/${id}`, { method: 'PUT', body: patch }),
  wlDelete: (id) => req(`/api/watchlists/${id}`, { method: 'DELETE' }),

  // ── tabs ──
  tabsGet: () => req('/api/tabs'),
  tabsPut: (tabs, activeId) => req('/api/tabs', { method: 'PUT', body: { tabs, activeId } }),

  // ── EOD alerts ──
  alertsList: () => req('/api/alerts'),
  alertCreate: (body) => req('/api/alerts', { method: 'POST', body }),
  alertUpdate: (id, patch) => req(`/api/alerts/${id}`, { method: 'PUT', body: patch }),
  alertDelete: (id) => req(`/api/alerts/${id}`, { method: 'DELETE' }),
  alertsHistory: () => req('/api/alerts/history'),
  alertsHistoryClear: () => req('/api/alerts/history', { method: 'DELETE' }),
  alertsEvaluate: (force = false) => req('/api/alerts/evaluate', { method: 'POST', body: { force } }),
};
