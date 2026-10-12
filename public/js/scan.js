// scan.js — custom scan builder: criteria rows, AND logic, run/save/re-run/delete.
import { api } from './api.js';
import { scanStore, wlStore } from './state.js';
import { resultsCsv } from './ux.js';
import { toast } from './tabs.js';

const FIELDS = [
  ['price', 'מחיר ($)'], ['dollarVolume', 'דולר-ווליום'], ['avgDollarVolume20', 'דולר-ווליום ממוצע 20'],
  ['atrPct', 'ATR %'], ['gapPct', 'גאפ %'], ['relVolume', 'ווליום יחסי'],
  ['priceVsSma20Pct', 'מרחק מ-SMA20 %'], ['priceVsSma50Pct', 'מרחק מ-SMA50 %'], ['priceVsSma200Pct', 'מרחק מ-SMA200 %'],
  ['perf5', 'ביצוע 5 ימים %'], ['perf21', 'ביצוע 21 ימים %'], ['perf63', 'ביצוע 63 ימים %'],
  ['rs63vsSpy', 'RS מול SPY (63d)'], ['marketCap', 'שווי שוק'], ['avgVolume20', 'ווליום ממוצע 20'],
  ['sma20', 'SMA20'], ['sma50', 'SMA50'], ['sma200', 'SMA200'],
  ['distHigh52Pct', 'מרחק משיא 52 שבועות %'], ['pctAboveLow52', 'מעל שפל 52 שבועות %'], ['newHigh52', 'שיא 52 שבועות חדש (1=כן)'],
  ['hve', 'HVE שיא נפח היסטורי (1=כן)'], ['hv1', 'HV1 שיא נפח שנה (1=כן)'],
];
const OPS = [
  ['gt', '>'], ['gte', '≥'], ['lt', '<'], ['lte', '≤'], ['eq', '='], ['between', 'בין'],
];
const FIELD_HE = Object.fromEntries(FIELDS);
const OP_HE = Object.fromEntries(OPS);

export class ScanUI {
  constructor(onPick, watchlist) {
    this.onPick = onPick; this.watchlist = watchlist;
    this.criteria = [{ field: 'dollarVolume', op: 'gt', value: '10000000' }, { field: 'price', op: 'gt', value: '5' }];
    this.sort = { field: 'dollarVolume', dir: 'desc' };
    this.lastResult = null;
  }

  render() {
    const root = document.getElementById('scan-builder');
    root.innerHTML = '';
    root.appendChild(this.libraryCard());
    const card = el('div', 'scan-card');
    card.innerHTML = '<h3>בונה סריקות</h3>';
    const presets = el('div', 'scan-presets');
    presets.append(el('span', 'scan-meta', 'התחלה מהירה:'));
    const base = [{field:'price',op:'gt',value:'5'},{field:'avgDollarVolume20',op:'gte',value:'25000000'}];
    const choices = [
      ['ווליום חריג', [{field:'relVolume',op:'gte',value:'2'}], 'relVolume'],
      ['קרוב לשיא 52ש׳', [{field:'distHigh52Pct',op:'gte',value:'-5'},{field:'perf63',op:'gte',value:'20'}], 'distHigh52Pct'],
      ['שיא 52ש׳ חדש', [{field:'newHigh52',op:'eq',value:'1'}], 'relVolume'],
      ['גאפ עולה', [{field:'gapPct',op:'gte',value:'4'}], 'gapPct'],
      ['מומנטום נזיל', [{field:'priceVsSma20Pct',op:'gt',value:'0'},{field:'priceVsSma50Pct',op:'gt',value:'0'},{field:'perf21',op:'gte',value:'10'},{field:'atrPct',op:'gte',value:'4'}], 'perf21'],
    ];
    for (const [label, criteria, sort] of choices) {
      const b = el('button','btn-ghost',label); b.title = 'טוען תנאים לבונה, ניתן לערוך לפני הרצה';
      b.onclick = () => { this.criteria = structuredClone([...base, ...criteria]); this.sort = {field:sort,dir:'desc'}; this.render(); }; presets.append(b);
    }
    card.append(presets, el('p','ux-hint','תבניות כלליות לנתוני סוף יום. הסורקים של קולמאגי ושל החדר נמצאים בספריית "סורקים מוכנים" למעלה.'));
    const rowsBox = el('div'); card.appendChild(rowsBox);
    this.criteria.forEach((c, i) => rowsBox.appendChild(this.critRow(c, i, rowsBox)));
    const add = el('button', 'btn-ghost', '+ הוסף תנאי');
    add.onclick = () => { this.criteria.push({ field: 'price', op: 'gt', value: '' }); this.render(); };
    const actions = el('div', 'scan-actions');
    actions.appendChild(add);

    const sortSel = el('select');
    sortSel.innerHTML = '<option value="">ללא מיון</option>' + FIELDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    if (this.sort) sortSel.value = this.sort.field;
    const dirSel = el('select');
    dirSel.innerHTML = '<option value="desc">יורד</option><option value="asc">עולה</option>';
    dirSel.value = this.sort?.dir || 'desc';
    const limInp = el('input'); limInp.type = 'number'; limInp.value = '100'; limInp.min = '1'; limInp.max = '500'; limInp.style.width = '70px'; limInp.title = 'מגבלה';
    actions.append(' מיון: ', sortSel, dirSel, ' מגבלה: ', limInp);

    const run = el('button', 'btn-primary', 'הרץ סריקה');
    run.onclick = () => {
      this.sort = sortSel.value ? { field: sortSel.value, dir: dirSel.value } : null;
      this.runScan(+limInp.value || 100);
    };
    actions.appendChild(run);

    const saveName = el('input'); saveName.type = 'text'; saveName.placeholder = 'שם לסריקה שמורה…'; saveName.style.width = '170px';
    const save = el('button', 'btn-ghost', 'שמור סריקה');
    save.onclick = async () => {
      const name = saveName.value.trim();
      if (!name) { toast('תן שם לסריקה'); return; }
      if (!this.validCriteria().length) { toast('אין תנאים תקינים'); return; }
      await scanStore.saveScan(name, this.validCriteria(), this.sort);
      toast('הסריקה נשמרה'); this.render();
    };
    actions.append(saveName, save);
    card.appendChild(actions);
    root.appendChild(card);

    // saved scans
    const saved = el('div', 'scan-card');
    saved.innerHTML = '<h3>סריקות שמורות</h3>';
    if (!scanStore.scans.length) saved.appendChild(el('div', 'skel', 'אין סריקות שמורות עדיין.'));
    for (const s of scanStore.scans) {
      const row = el('div', 'saved-scan');
      row.innerHTML = `<span class="nm"></span><span class="scan-meta" dir="ltr">${s.criteria?.length || 0} תנאים</span>`;
      row.querySelector('.nm').textContent = s.name;
      const rerun = el('button', 'btn-ghost', 'הרצה חוזרת');
      rerun.onclick = () => this.runSaved(s);
      const edit = el('button', 'btn-ghost', 'טען לבונה');
      edit.onclick = () => { this.criteria = JSON.parse(JSON.stringify(s.criteria || [])); this.sort = s.sort ? { ...s.sort } : null; this.render(); };
      const del = el('button', 'btn-ghost', 'מחק');
      del.onclick = async () => { if (confirm(`למחוק את "${s.name}"?`)) { await scanStore.delete(s.id); this.render(); } };
      row.append(rerun, edit, del);
      saved.appendChild(row);
    }
    root.appendChild(saved);
  }

  // ── ready-made scanner library (the server's prebuilt scanners, grouped) ──
  libraryCard() {
    const card = el('div', 'scan-card scan-lib');
    card.innerHTML = '<h3>סורקים מוכנים</h3>';
    const tabs = el('div', 'lib-groups'), list = el('div', 'lib-list');
    card.append(tabs, list);
    const draw = () => {
      tabs.innerHTML = ''; list.innerHTML = '';
      const lib = this.lib;
      if (!lib) { list.appendChild(el('div', 'skel', 'טוען סורקים…')); return; }
      const counts = {};
      for (const g of lib.groups) counts[g.id] = lib.scanners.filter((s) => s.groups.includes(g.id)).length;
      for (const g of lib.groups) {
        if (!counts[g.id]) continue;
        const b = el('button', 'lib-tab' + (g.id === this.libGroup ? ' on' : ''), `${g.name} (${counts[g.id]})`);
        b.onclick = () => { this.libGroup = g.id; draw(); };
        tabs.appendChild(b);
      }
      for (const s of lib.scanners.filter((x) => x.groups.includes(this.libGroup))) {
        const b = el('button', 'lib-chip', s.name);
        b.title = s.desc + (s.approx ? '\n⚠ ' + s.approx : '');
        b.onclick = () => this.runPrebuilt(s);
        list.appendChild(b);
      }
    };
    this.libGroup = this.libGroup || 'qullamaggie';
    draw();
    if (!this.lib && !this.libLoading) {
      this.libLoading = true;
      api.scannersList().then((l) => { this.lib = l; draw(); }).catch(() => { list.innerHTML = '<div class="err">טעינת הסורקים נכשלה.</div>'; }).finally(() => { this.libLoading = false; });
    }
    return card;
  }

  async runPrebuilt(s) {
    this.renderResults('<div class="skel">מריץ ' + escapeHtml(s.name) + '…</div>');
    try {
      const o = await api.scanPrebuilt(s.id);
      const r = {
        prebuilt: true, count: o.count, asOf: o.asOf, desc: o.desc, approx: o.approx,
        tickers: o.rows.map((x) => ({ symbol: x.s, name: x.name, price: x.price, changePct: x.chg, dollarVolume: x.dvolM * 1e6, relVol: x.relVol, detail: x.detail })),
      };
      this.lastResult = r;
      this.renderResultsTable(r, o.name);
    } catch (e) { this.renderResults('<div class="err">הסריקה נכשלה — נסה שוב.</div>'); }
  }

  validCriteria() {
    return this.criteria
      .map((c) => ({ field: c.field, op: c.op, value: parseFloat(c.value), value2: c.op === 'between' ? parseFloat(c.value2) : undefined }))
      .filter((c) => c.field && c.op && isFinite(c.value) && (c.op !== 'between' || isFinite(c.value2)));
  }

  critRow(c, i, box) {
    const row = el('div', 'crit-row');
    const f = el('select'); f.innerHTML = FIELDS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); f.value = c.field;
    const o = el('select'); o.dir = 'ltr'; o.innerHTML = OPS.map(([v, l]) => `<option value="${v}">${l}</option>`).join(''); o.value = c.op;
    const v = el('input'); v.type = 'number'; v.dir = 'ltr'; v.step = 'any'; v.placeholder = 'ערך'; v.value = c.value ?? ''; v.style.width = '110px';
    const v2 = el('input'); v2.type = 'number'; v2.dir = 'ltr'; v2.step = 'any'; v2.placeholder = 'עד'; v2.value = c.value2 ?? ''; v2.style.width = '90px';
    v2.style.display = c.op === 'between' ? '' : 'none';
    f.onchange = () => { c.field = f.value; }; o.onchange = () => { c.op = o.value; v2.style.display = o.value === 'between' ? '' : 'none'; };
    v.oninput = () => { c.value = v.value; }; v2.oninput = () => { c.value2 = v2.value; };
    const rm = el('button', 'rm-crit', '✕'); rm.title = 'הסר תנאי';
    rm.onclick = () => { this.criteria.splice(i, 1); this.render(); };
    row.append(f, o, v, v2, rm);
    return row;
  }

  async runScan(limit) {
    const criteria = this.validCriteria();
    if (!criteria.length) { toast('הוסף לפחות תנאי אחד תקין'); return; }
    this.renderResults('<div class="skel">מריץ סריקה…</div>');
    try {
      const r = await api.scanRun(criteria, this.sort, limit);
      this.lastResult = r;
      this.renderResultsTable(r, null);
    } catch (e) { this.renderResults(`<div class="err">הסריקה נכשלה — נסה שוב.</div>`); }
  }

  async runSaved(s) {
    this.renderResults('<div class="skel">מריץ סריקה שמורה…</div>');
    try {
      const r = api.state.serverOk
        ? await api.scanRunSaved(s.id, 200)
        : await api.scanRun(s.criteria, s.sort, 200);
      this.lastResult = r;
      this.renderResultsTable(r, s.name);
    } catch (e) { this.renderResults(`<div class="err">הסריקה נכשלה — נסה שוב.</div>`); }
  }

  renderResults(html) { document.getElementById('scan-results').innerHTML = html; }

  renderResultsTable(r, name) {
    const box = document.getElementById('scan-results');
    box.innerHTML = '';
    const card = el('div', 'scan-card');
    const meta = el('div', 'scan-meta');
    meta.textContent = `${name ? name + ' · ' : ''}${r.count} התאמות · מוצגות ${r.tickers.length} · נתוני ${String(r.asOf || '').slice(0, 10)}`;
    card.appendChild(meta);
    if (r.prebuilt && r.desc) card.appendChild(el('p', 'ux-hint', r.desc + (r.approx ? ' · ⚠ ' + r.approx : '')));
    if (!r.tickers.length) { card.appendChild(el('div', 'skel', 'אין תוצאות לתנאים האלה.')); box.appendChild(card); return; }
    const actions = el('div','scan-actions');
    const destination = el('select'); destination.setAttribute('aria-label','רשימת יעד');
    for (const l of wlStore.lists) { const o = el('option','',l.name); o.value = l.id; destination.append(o); }
    destination.value = wlStore.activeListId || '';
    const add = el('button','btn-ghost',`הוסף ${r.tickers.length} מוצגות לרשימה`); add.disabled = !wlStore.lists.length;
    add.onclick = async () => { add.disabled = true; try { await this.watchlist?.addMany(r.tickers.map(x=>x.symbol), destination.value); } finally { add.disabled = !wlStore.lists.length; } };
    const csv = el('button','btn-ghost','ייצוא CSV');
    csv.onclick = () => { const url = URL.createObjectURL(new Blob([resultsCsv(r.tickers)],{type:'text/csv;charset=utf-8'})); const a = el('a'); a.href = url; a.download = '7d-scan-' + String(r.asOf || '').slice(0,10) + '.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); toast('יוצאו ' + r.tickers.length + ' שורות'); };
    actions.append(destination,add,csv); card.append(actions);
    const t = document.createElement('table'); t.className = 'results';
    t.innerHTML = r.prebuilt ? `<thead><tr>
      <th data-k="symbol">סימבול</th><th>שם</th><th data-k="price">מחיר</th>
      <th data-k="changePct">שינוי%</th><th data-k="dollarVolume" title="דולר-ווליום ממוצע 20 ימים">$ ווליום ממוצע</th>
      <th data-k="relVol">ווליום יחסי</th><th>פירוט</th></tr></thead><tbody></tbody>` : `<thead><tr>
      <th data-k="symbol">סימבול</th><th>שם</th><th data-k="price">מחיר</th>
      <th data-k="changePct">שינוי%</th><th data-k="dollarVolume">דולר-ווליום</th>
      <th data-k="atrPct">ATR%</th><th data-k="gapPct">גאפ%</th>
      <th data-k="distHigh52Pct" title="מרחק ממחיר השיא ב-52 שבועות">מרחק משיא 52ש׳</th></tr></thead><tbody></tbody>`;
    const tb = t.querySelector('tbody');
    const draw = (rows) => {
      tb.innerHTML = '';
      for (const x of rows) {
        const tr = document.createElement('tr');
        const chg = x.changePct;
        if (r.prebuilt) {
          tr.innerHTML = `<td dir="ltr"><b>${x.symbol}</b></td><td dir="ltr">${escapeHtml(x.name || '')}</td><td dir="ltr">${fmt(x.price)}</td>
          <td dir="ltr" class="${chg >= 0 ? 'up' : 'dn'}">${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%</td><td dir="ltr">${fmtBig(x.dollarVolume)}</td>
          <td dir="ltr">${x.relVol}x</td><td>${escapeHtml(x.detail || '')}</td>`;
          tr.onclick = () => this.onPick && this.onPick(x.symbol); tb.appendChild(tr); continue;
        }
        tr.innerHTML = `<td dir="ltr"><b>${x.symbol}</b></td><td dir="ltr">${escapeHtml(x.name || '')}</td>
          <td dir="ltr">${fmt(x.price)}</td>
          <td dir="ltr" class="${chg >= 0 ? 'up' : 'dn'}">${(chg >= 0 ? '+' : '') + chg.toFixed(2)}%</td>
          <td dir="ltr">${fmtBig(x.dollarVolume)}</td>
          <td dir="ltr">${x.atrPct?.toFixed(2)}</td>
          <td dir="ltr" class="${x.gapPct >= 0 ? 'up' : 'dn'}">${(x.gapPct >= 0 ? '+' : '') + x.gapPct?.toFixed(2)}%</td>
          <td dir="ltr" class="${x.newHigh52 ? 'up' : ''}">${x.distHigh52Pct == null ? '—' : x.distHigh52Pct.toFixed(1) + '%'}${x.newHigh52 ? ' <span class="nh-badge" title="שיא 52 שבועות חדש">NH</span>' : ''}</td>`;
        tr.onclick = () => this.onPick && this.onPick(x.symbol);
        tb.appendChild(tr);
      }
    };
    let dir = 1, lastK = null;
    t.querySelectorAll('th[data-k]').forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        dir = lastK === k ? -dir : -1; lastK = k;
        const rows = [...r.tickers].sort((a, b) => dir * ((a[k] ?? 0) - (b[k] ?? 0) || String(a[k] ?? '').localeCompare(String(b[k] ?? ''))));
        draw(rows);
      };
    });
    draw(r.tickers);
    card.appendChild(t); box.appendChild(card);
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return n == null ? '—' : (+n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
function fmtBig(n) {
  if (n == null) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

export function showScanView(show) {
  document.getElementById('scan-view').hidden = !show;
  document.getElementById('chart-view').hidden = show;
  document.getElementById('btn-scan').classList.toggle('active', show);
}
