// e2e-verify.mjs — headless-chromium E2E for the 7D charting platform.
// Usage: API_SECRET=test-secret-123 node server/server.mjs &   (port 3000, serves dist/)
//        node scripts/e2e-verify.mjs
// Requires: playwright-core + a chromium headless shell (see PLAYWRIGHT_BROWSERS_PATH).
import { chromium } from 'playwright-core';

const SHELL = process.env.CHROME_HEADLESS_SHELL ||
  '/home/hatch/workspace/.playwright-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = process.env.E2E_BASE || 'http://localhost:3000/';
const SHOT_DIR = process.env.E2E_SHOTS || '/home/hatch/workspace/charts-platform/scripts/.e2e-shots';
const errors = [];
const results = [];
const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); };

const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 200)));
page.on('dialog', async (d) => { // single handler: prompt gets a name, confirms accepted
  if (d.type() === 'prompt') await d.accept('רשימת בדיקה');
  else await d.accept();
});
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('7d.api.secret', 'test-secret-123');
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__7d, null, { timeout: 60000 });
await page.waitForTimeout(2500);

// 1. chart basics
ok('boot: window.__7d', true);
ok('server mode (sb-mode)', (await page.textContent('#sb-mode')).includes('מחובר'));
const canvasCount = await page.locator('#chart canvas').count();
ok('chart canvas rendered', canvasCount > 0, canvasCount + ' canvases');
const tbCount = await page.locator('#chart .vela-dtb-btn').count();
ok('native drawing toolbar present', tbCount > 0, tbCount + ' toolbar buttons');

// native indicators catalog (runtime verification)
const natives = await page.evaluate(async () => (await window.__7d.c7.chart.availableNativeIndicators()).map((i) => i.type + '|' + i.title));
ok('availableNativeIndicators non-empty', natives.length > 0, natives.slice(0, 8).join(', '));

// 2. timeframe switch
await page.click('#tf-bar button[data-tf="W"]');
await page.waitForTimeout(3000);
ok('timeframe W', (await page.textContent('#chart-status')).includes('W'), await page.textContent('#chart-status'));
await page.click('#tf-bar button[data-tf="D"]');
await page.waitForTimeout(2500);

// 3. indicator toggles (native)
await page.click('#ind-toggles button[data-ind="ma20"]');
await page.waitForTimeout(1200);
let indCount = await page.evaluate(() => Object.keys(window.__7d.c7.indHandles).length);
ok('MA20 toggle on', indCount >= 1, 'handles=' + indCount);
await page.click('#ind-toggles button[data-ind="volume"]');
await page.waitForTimeout(1200);
const kinds = await page.evaluate(() => window.__7d.c7.indKind);
ok('VOL toggle on', Object.keys(kinds).length >= 2, JSON.stringify(kinds));
await page.click('#ind-toggles button[data-ind="ma20"]'); // off
await page.waitForTimeout(800);

// 4. drawings: arm trendline via runtime-verified drawings.setTool, drag on chart
const chartBox = await page.locator('#chart').boundingBox();
const drawTest = await page.evaluate(() => {
  const c = window.__7d.c7;
  const before = c.chart.drawings.all().length;
  c.armTool('trendline'); // runtime-verified: drawings.setTool
  return { before, tool: c.activeTool() };
});
ok('arm trendline', drawTest.tool === 'trendline', String(drawTest.tool));
const cx = chartBox.x + chartBox.width * 0.45, cy = chartBox.y + chartBox.height * 0.45;
// trendline in this Vela version is placed with two clicks (not a drag)
await page.mouse.click(cx - 150, cy + 60);
await page.waitForTimeout(400);
await page.mouse.click(cx + 150, cy - 60);
await page.waitForTimeout(800);
const afterDraw = await page.evaluate(() => window.__7d.c7.chart.drawings.all().length);
ok('trendline drawn on chart', afterDraw === drawTest.before + 1, `before=${drawTest.before} after=${afterDraw}`);
// hline via setTool too
await page.evaluate(() => window.__7d.c7.armTool('hline'));
await page.mouse.move(cx - 100, cy);
await page.mouse.down();
await page.mouse.move(cx + 100, cy, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(800);
const afterHline = await page.evaluate(() => window.__7d.c7.chart.drawings.all().length);
ok('hline drawn on chart', afterHline === afterDraw + 1, `after=${afterHline}`);
await page.evaluate(() => window.__7d.c7.armTool('select'));
// serialize/restore roundtrip (toJSON/fromJSON — runtime-verified)
const rt = await page.evaluate(() => {
  const c = window.__7d.c7;
  const doc = c.serializeDrawings();
  const n0 = c.chart.drawings.all().length;
  c.chart.drawings.remove(c.chart.drawings.all()[0].id);
  const n1 = c.chart.drawings.all().length;
  c.restoreDrawings(doc);
  const n2 = c.chart.drawings.all().length;
  return { n0, n1, n2, hasDoc: !!doc && !!doc.drawings };
});
ok('drawings toJSON/fromJSON roundtrip', rt.n2 === rt.n0 && rt.n1 === rt.n0 - 1 && rt.hasDoc, JSON.stringify(rt));

// tab switch keeps drawings per tab
await page.evaluate(() => window.__7d.tabs.persistDrawings());
const tabCount0 = await page.locator('#tabs .tab').count();
await page.keyboard.press('Alt+t');
await page.waitForTimeout(3500);
const tabCount1 = await page.locator('#tabs .tab').count();
ok('Alt+T new tab', tabCount1 === tabCount0 + 1, `${tabCount0}->${tabCount1}`);
const drawsNewTab = await page.evaluate(() => window.__7d.c7.chart.drawings.all().length);
ok('new tab starts clean', drawsNewTab === 0, 'drawings=' + drawsNewTab);
// step back twice: new tab (idx 2) -> AAPL (idx 1) -> NVDA (idx 0, holds the drawings)
await page.keyboard.press('Alt+[');
await page.waitForTimeout(3000);
await page.keyboard.press('Alt+[');
await page.waitForTimeout(3500);
const drawsBack = await page.evaluate(() => window.__7d.c7.chart.drawings.all().length);
ok('drawings follow their tab', drawsBack === rt.n0, 'drawings=' + drawsBack + ' expected=' + rt.n0);

// rename via dblclick
await page.dblclick('#tabs .tab.active .tab-name');
await page.keyboard.type('הטאב שלי');
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
ok('tab rename', (await page.textContent('#tabs .tab.active .tab-name')).includes('הטאב'));

// close tab
await page.keyboard.press('Alt+w');
await page.waitForTimeout(3000);
ok('Alt+W close tab', (await page.locator('#tabs .tab').count()) === tabCount0);

// 5. Ctrl+K search
await page.keyboard.press('Control+k');
await page.waitForTimeout(400);
ok('search modal opens', await page.locator('#search-modal').isVisible());
await page.fill('#search-input', 'NVDA');
await page.waitForTimeout(1500);
const sres = await page.locator('#search-results li').count();
ok('search results', sres > 0, sres + ' rows');
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
ok('search loads symbol', (await page.textContent('#chart-status')).includes('NVDA'), await page.textContent('#chart-status'));

// 6. watchlist CRUD (panel starts visible)
ok('watchlist panel', await page.locator('#watchlist-panel').isVisible());
await page.fill('#wl-add-input', 'MSFT');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('#wl-items .wl-row').length > 0, null, { timeout: 30000 });
let wlRows = await page.locator('#wl-items .wl-row').count();
ok('watchlist add ticker', wlRows > 0, wlRows + ' rows');
const px = await page.locator('#wl-items .wl-row .px').first().textContent();
ok('watchlist quotes loaded', px && px.trim() !== '—' && px.trim() !== '', 'px=' + String(px).trim());
// color tag via right-click cycle
await page.locator('#wl-items .wl-row').first().click({ button: 'right' });
await page.waitForTimeout(400);
const dotCls = await page.locator('#wl-items .wl-row .dot').first().getAttribute('class');
ok('color tag cycle', /red|orange|yellow|green|blue/.test(dotCls || ''), dotCls);
// new list (dialog handler fills the prompt)
await page.click('#wl-add-list');
await page.waitForTimeout(1500);
const listNames = await page.locator('#wl-select option').allTextContents();
ok('watchlist create list', listNames.some((n) => n.includes('בדיקה')), listNames.join('|'));

// 7. scan builder
await page.click('#btn-scan');
await page.waitForTimeout(800);
ok('scan view', await page.locator('#scan-view').isVisible());
await page.click('.scan-actions .btn-primary');
await page.waitForFunction(() => document.querySelectorAll('#scan-results table.results tbody tr').length > 0, null, { timeout: 45000 });
const scanRows = await page.locator('#scan-results table.results tbody tr').count();
ok('scan run results', scanRows > 0, scanRows + ' rows');
await page.fill('.scan-actions input[placeholder*="שם לסריקה"]', 'סריקת בדיקה');
await page.click('.scan-actions .btn-ghost:has-text("שמור סריקה")');
await page.waitForTimeout(2000);
const savedNames = await page.locator('.saved-scan .nm').allTextContents();
ok('scan save', savedNames.some((n) => n.includes('סריקת בדיקה')), savedNames.join('|'));
// re-run saved
await page.locator('.saved-scan .btn-ghost:has-text("הרצה חוזרת")').first().click();
await page.waitForFunction(() => document.querySelectorAll('#scan-results table.results tbody tr').length > 0, null, { timeout: 45000 });
ok('scan re-run', true);
// delete saved (confirm auto-accepted)
await page.locator('.saved-scan .btn-ghost:has-text("מחק")').first().click();
await page.waitForTimeout(1500);
const savedAfter = await page.locator('.saved-scan .nm').allTextContents();
ok('scan delete', !savedAfter.some((n) => n.includes('סריקת בדיקה')));
// click-to-chart from results
await page.click('.scan-actions .btn-primary');
await page.waitForFunction(() => document.querySelectorAll('#scan-results table.results tbody tr').length > 0, null, { timeout: 45000 });
const firstSym = await page.locator('#scan-results table.results tbody tr td b').first().textContent();
await page.locator('#scan-results table.results tbody tr').first().click();
await page.waitForTimeout(3500);
ok('scan click-to-chart', (await page.textContent('#chart-status')).includes(firstSym.trim()), firstSym);

// 8. pine modal
await page.click('#btn-pine');
await page.waitForTimeout(400);
ok('pine modal opens', await page.locator('#pine-modal').isVisible());
await page.click('#pine-run');
await page.waitForTimeout(4000);
const pineCount = await page.evaluate(() => Object.values(window.__7d.c7.indHandles).filter((h) => h.source).length);
ok('pine overlay runs', pineCount > 0, pineCount + ' pine handles');
await page.click('#btn-pine'); // modal closes after a successful run — reopen to clear
await page.waitForTimeout(400);
await page.click('#pine-clear');
await page.waitForTimeout(800);

// 9. shortcuts dialog
await page.keyboard.press('?');
await page.waitForTimeout(300);
ok('? dialog', await page.locator('#help-modal').isVisible());
await page.keyboard.press('Escape');

// 10. persistence across reload (server wins)
await page.waitForTimeout(2500); // let debounced PUTs flush
await page.reload({ waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__7d, null, { timeout: 60000 });
await page.waitForTimeout(2000);
const tabsAfter = await page.locator('#tabs .tab').count();
ok('tabs persist after reload', tabsAfter >= tabCount0, tabsAfter + ' tabs');

// screenshots
await page.setViewportSize({ width: 1920, height: 1080 });
await page.waitForTimeout(1500);
await page.screenshot({ path: SHOT_DIR + '/shot-1920.png' });
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOT_DIR + '/shot-1440.png' });
await page.setViewportSize({ width: 1280, height: 800 });
await page.waitForTimeout(1200);
await page.screenshot({ path: SHOT_DIR + '/shot-1280.png' });

console.log('=== RESULTS ===');
for (const [s, n, x] of results) console.log(s, '|', n, x ? '| ' + x : '');
console.log('=== CONSOLE ERRORS (' + errors.length + ') ===');
for (const e of errors.slice(0, 15)) console.log('ERR:', e);
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`=== ${results.length - fails}/${results.length} passed ===`);
await browser.close();
process.exit(fails ? 1 : 0);
