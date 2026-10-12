// Small shared UI helpers. No new dependencies or data feed.
export function dialog(title, build) {
  const overlay = document.createElement('div'); overlay.className = 'modal';
  const box = document.createElement('div'); box.className = 'modal-box';
  const head = document.createElement('div'); head.className = 'modal-head';
  const h = document.createElement('h3'); h.textContent = title;
  const close = document.createElement('button'); close.className = 'icon-btn'; close.textContent = '✕'; close.title = 'סגור';
  const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', escape, true); };
  const escape = e => { if(e.key === 'Escape') { e.stopImmediatePropagation(); dismiss(); } };
  close.onclick = dismiss; overlay.onclick = e => { if(e.target === overlay) dismiss(); };
  document.addEventListener('keydown', escape, true);
  head.append(h, close); box.append(head); overlay.append(box); document.body.append(overlay);
  build(box, dismiss); box.querySelector('textarea,input,select,button:last-child')?.focus();
}
export function parseTickers(text) {
  const tokens = text.toUpperCase().split(/[\s,;]+/).filter(Boolean);
  const valid = [], invalid = [];
  for (let s of tokens) {
    s = s.replace(/^[A-Z]+:/, '').replace(/^\$/, '');
    if (/^[A-Z][A-Z0-9.\-]{0,11}$/.test(s)) valid.push(s); else invalid.push(s);
  }
  return { symbols: [...new Set(valid)], invalid };
}
export function resultsCsv(rows) {
  const fields = ['symbol','name','price','changePct','dollarVolume','atrPct','gapPct'];
  const cell = x => '"' + (typeof x === 'number' ? String(x) : String(x ?? '').replace(/^[=+@-]/, "'")).replace(/"/g, '""') + '"';
  return '\ufeff' + [fields.join(','), ...rows.map(r=>fields.map(k=>cell(r[k])).join(','))].join('\r\n');
}
