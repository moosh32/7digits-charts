// fix-round-2 visual QA: drawer @1280/390, scan/chart toggle, token modal, pine modal.
import { chromium } from 'playwright-core';

const SHELL = '/home/hatch/workspace/.playwright-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const BASE = 'http://localhost:3000/';
const SHOTS = '/home/hatch/workspace/charts-platform/scripts/.e2e-shots/fix2';
const errors = [];
const results = [];
const ok = (n, c, x = '') => { results.push([c ? 'PASS' : 'FAIL', n, x]); console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (x ? ' | ' + x : '')); };

const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] });

async function bootPage(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 160)));
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem('7d.api.secret', 'test-secret-123');
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__7d, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  return page;
}

// ── 1. drawer @1280 ──
{
  const page = await bootPage(1280, 800);
  // drawer closed by default on narrow
  let box = await page.locator('#watchlist-panel').boundingBox();
  ok('1280: drawer parked off-canvas by default', box.x >= 1280 - 2, 'x=' + Math.round(box.x));
  await page.click('#btn-wl');
  await page.waitForTimeout(400);
  box = await page.locator('#watchlist-panel').boundingBox();
  ok('1280: drawer slides in on toggle', box.x < 1280 && box.x + box.width > 1280 - 320, 'x=' + Math.round(box.x));
  const bd = await page.locator('#wl-backdrop').isVisible();
  ok('1280: backdrop visible with drawer', bd);
  await page.screenshot({ path: SHOTS + '/drawer-1280-open.png' });
  // no overlap: chart area should not be covered where the drawer isn't
  const chartBox = await page.locator('#chart').boundingBox();
  ok('1280: chart still laid out full width behind drawer', chartBox.width > 900, 'w=' + Math.round(chartBox.width));
  // close via X button
  await page.click('#wl-close');
  await page.waitForTimeout(400);
  box = await page.locator('#watchlist-panel').boundingBox();
  ok('1280: drawer closes via X', box.x >= 1280 - 2, 'x=' + Math.round(box.x));
  // scan controls not covered when drawer closed
  await page.click('#btn-scan');
  await page.waitForTimeout(600);
  const scanVisible = await page.locator('#scan-view').isVisible();
  const chartHidden = !(await page.locator('#chart-view').isVisible());
  ok('1280: scan view replaces chart (fix 2)', scanVisible && chartHidden);
  await page.screenshot({ path: SHOTS + '/scan-1280.png' });
  await page.click('#btn-scan');
  await page.waitForTimeout(600);
  ok('1280: chart restored after toggle back',
    await page.locator('#chart-view').isVisible() && !(await page.locator('#scan-view').isVisible()));
  await page.close();
}

// ── 2. drawer @390 (mobile) ──
{
  const page = await bootPage(390, 844);
  await page.click('#btn-wl');
  await page.waitForTimeout(400);
  const box = await page.locator('#watchlist-panel').boundingBox();
  ok('390: drawer visible & within viewport', box.x >= -2 && box.x + box.width <= 392, 'x=' + Math.round(box.x) + ' w=' + Math.round(box.width));
  await page.screenshot({ path: SHOTS + '/drawer-390-open.png' });
  // pick a ticker closes the drawer
  await page.click('#wl-items .wl-row');
  await page.waitForTimeout(400);
  const box2 = await page.locator('#watchlist-panel').boundingBox();
  ok('390: drawer auto-closes after picking ticker', box2.x >= 390 - 2, 'x=' + Math.round(box2.x));
  await page.close();
}

// ── 3. token modal @1440 ──
{
  const page = await bootPage(1440, 900);
  await page.click('#sb-mode');
  await page.waitForTimeout(400);
  const vis = await page.locator('#token-modal').isVisible();
  const inputType = await page.locator('#token-input').getAttribute('type');
  const ac = await page.locator('#token-input').getAttribute('autocomplete');
  ok('token modal opens (no native prompt)', vis);
  ok('token input is password type', inputType === 'password', inputType);
  ok('token input has autocomplete for managers', ac === 'current-password', ac);
  await page.screenshot({ path: SHOTS + '/token-modal.png' });
  // save flow with the test secret keeps server mode
  await page.click('#token-save');
  await page.waitForTimeout(800);
  ok('token save keeps connected state', (await page.textContent('#sb-mode')).includes('מחובר'));
  await page.close();
}

// ── 4. pine modal scan section @1440 ──
{
  const page = await bootPage(1440, 900);
  await page.click('#btn-pine');
  await page.waitForTimeout(400);
  ok('pine scan section present',
    await page.locator('#pine-scan-run').isVisible() && await page.locator('#pine-scan-src').isVisible());
  await page.screenshot({ path: SHOTS + '/pine-modal.png' });
  await page.close();
}

console.log('=== CONSOLE ERRORS (' + errors.length + ') ===');
errors.slice(0, 10).forEach((e) => console.log('ERR: ' + e));
await browser.close();
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(`=== ${results.length - fails}/${results.length} passed ===`);
process.exit(fails ? 1 : 0);
