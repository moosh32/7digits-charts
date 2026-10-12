// Functional test: Pine-as-scan end-to-end (10 most-liquid symbols).
import { chromium } from 'playwright-core';

const SHELL = '/home/hatch/workspace/.playwright-browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath: SHELL, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.addInitScript(() => {
  localStorage.clear();
  localStorage.setItem('7d.api.secret', 'test-secret-123');
});
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__7d, null, { timeout: 60000 });
await page.waitForTimeout(2500);

await page.click('#btn-pine');
await page.waitForTimeout(300);
// a script that should match broadly: price above SMA20 -> signal 1
await page.fill('#pine-code', `//@version=6
indicator("scan test", overlay=true)
signal = close > ta.sma(close, 20) ? 1 : 0
plot(signal, "signal")`);
await page.selectOption('#pine-scan-src', 'liquid');
await page.fill('#pine-scan-n', '10');
await page.click('#pine-scan-run');
console.log('scan started, waiting…');
await page.waitForFunction(() => !document.getElementById('pine-modal') || document.getElementById('pine-modal').hidden, null, { timeout: 180000 });
await page.waitForTimeout(1000);
const scanVisible = await page.locator('#scan-view').isVisible();
const rows = await page.locator('#scan-results table.results tbody tr').count();
const meta = await page.locator('#scan-results .scan-meta').first().textContent().catch(() => '(no meta)');
console.log('scan view visible:', scanVisible);
console.log('result rows:', rows);
console.log('meta:', meta);
// click first result -> chart
if (rows > 0) {
  const sym = await page.locator('#scan-results table.results tbody tr td b').first().textContent();
  await page.locator('#scan-results table.results tbody tr').first().click();
  await page.waitForTimeout(2500);
  const status = await page.textContent('#chart-status');
  console.log('clicked', sym, '-> chart status:', status);
  console.log('click-to-chart:', status.includes(sym) ? 'PASS' : 'FAIL');
}
// compile-error path
await page.click('#btn-pine');
await page.waitForTimeout(300);
await page.fill('#pine-code', `//@version=6
indicator("bad", overlay=true)
plot(nonexistent_fn(close), "x")`);
await page.selectOption('#pine-scan-src', 'liquid');
await page.fill('#pine-scan-n', '10');
await page.click('#pine-scan-run');
await page.waitForTimeout(20000);
const errVis = await page.locator('#pine-error').isVisible();
const errText = await page.locator('#pine-error').textContent().catch(() => '');
console.log('compile error surfaced:', errVis, '|', errText.slice(0, 120));
await page.screenshot({ path: '/home/hatch/workspace/charts-platform/scripts/.e2e-shots/fix2/pine-scan-results.png' });
console.log('pageerrors:', errs.length ? errs : 'none');
await browser.close();
