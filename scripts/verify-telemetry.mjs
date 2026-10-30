/**
 * End-to-end telemetry verification driver.
 *
 * Drives a real Chromium browser through the demo app's telemetry triggers,
 * then the caller verifies the signals arrived in Loki and Tempo.
 *
 * Usage: node scripts/verify-telemetry.mjs [--outage]
 *   --outage  assumes the collector is DOWN and asserts the app still works.
 */
import { chromium } from 'playwright';

const outageMode = process.argv.includes('--outage');
const BASE = 'http://localhost:4200';

const pageErrors = [];
const browser = await chromium.launch({ channel: process.argv.includes('--chrome') ? 'chrome' : undefined });
const page = await browser.newPage();

// "Deliberate" errors are intentional triggers; anything else is a real bug.
page.on('pageerror', (error) => {
  if (!/Deliberate|this-chunk-does-not-exist/.test(error.message)) {
    pageErrors.push(error.message);
  }
});

console.log(`[verify] visiting home (outage mode: ${outageMode})`);
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForSelector('h1');

const telemetryStatus = await page.locator('.status dd').first().textContent();
console.log(`[verify] telemetry status shown on page: ${telemetryStatus}`);
if (telemetryStatus !== 'initialized') {
  console.error('[verify] FAIL: SDK did not initialize');
  process.exit(1);
}

console.log('[verify] navigating through routes');
await page.click('nav >> text=Orders');
await page.waitForSelector('h1:has-text("Orders")');
await page.click('text=Order #100234');
await page.waitForSelector('h1:has-text("Order #100234")');

console.log('[verify] opening telemetry lab');
await page.click('nav >> text=Telemetry Lab');
await page.waitForSelector('h1:has-text("Telemetry Lab")');

const clickButton = async (label) => {
  console.log(`[verify] trigger: ${label}`);
  await page.click(`button:has-text("${label}")`);
  await page.waitForTimeout(400);
};

await clickButton('Throw uncaught JS error');
await clickButton('Unhandled promise rejection');
await clickButton('Fail a dynamic import');
await clickButton('Traced fetch to /api/echo');
await clickButton('Fetch a 404');
await clickButton('Send custom event');
await clickButton('Send log message');
await clickButton('Record custom SLI measurement');
await clickButton('Record breadcrumb & logical view');
await clickButton('Log in as user-42');


// Render error last: it replaces the lab with the error boundary fallback.
await clickButton('Trigger React render error');
await page.waitForSelector('text=Something went wrong');
console.log('[verify] error boundary fallback rendered');

await page.click('text=Back to home');
await page.waitForSelector('h1:has-text("Frontend Observability Demo")');

// Give Faro time to flush its batched telemetry.
await page.waitForTimeout(4000);
await browser.close();

if (pageErrors.length > 0) {
  console.error('[verify] FAIL: unexpected page errors:', pageErrors);
  process.exit(1);
}

console.log(
  outageMode
    ? '[verify] OK: app fully usable while the collector is down'
    : '[verify] OK: browser run complete without unexpected errors'
);
