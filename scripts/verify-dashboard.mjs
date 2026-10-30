/**
 * Real-stack browser acceptance check. Start Docker, demo-app, and npm run dev first.
 * Uses a fresh browser context; test dashboard edits never touch your personal browser.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { widgetCatalog } from '../libs/observability-contracts/src/index.ts';

const webUrl = process.env.DASHBOARD_URL ?? 'http://localhost:4201';
const demoUrl = process.env.DEMO_URL ?? 'http://localhost:4200';
const output = new URL('../tmp/dashboard-qa/', import.meta.url);
await mkdir(output, { recursive: true });
async function api(path, body) {
  const response = await fetch(webUrl + '/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  assert.ok(response.ok, JSON.stringify(value));
  return value;
}
async function eventually(fn, description, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out: ' + description, { cause: last });
}
const health = await api('health');
assert.deepEqual(
  health,
  { loki: true, tempo: true },
  'Start the Docker telemetry stack first.',
);
const browser = await chromium.launch({
  channel: process.argv.includes('--chrome') ? 'chrome' : undefined,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  console.log('[dashboard] Generating real telemetry through the demo app');
  const demo = await context.newPage();
  await demo.goto(demoUrl, { waitUntil: 'networkidle' });
  assert.equal(
    await demo.locator('.status dd').first().textContent(),
    'initialized',
  );
  await demo
    .getByRole('navigation')
    .getByRole('link', { name: 'Orders', exact: true })
    .click();
  await demo.getByRole('link', { name: 'Telemetry Lab', exact: true }).click();
  await demo
    .getByRole('button', { name: 'Send custom event', exact: true })
    .click();
  await demo
    .getByRole('button', { name: 'Send log message', exact: true })
    .click();
  await demo
    .getByRole('button', { name: 'Record custom SLI measurement', exact: true })
    .click();
  const generatedAt = Date.now();
  await demo
    .getByRole('button', {
      name: 'Capture error with trace context',
      exact: true,
    })
    .click();
  const echoResponse = demo.waitForResponse(
    (r) => r.url().includes('/api/echo?') && r.status() === 200,
  );
  await demo
    .getByRole('button', { name: 'Traced fetch to /api/echo', exact: true })
    .click();
  const echo = await (await echoResponse).json();
  assert.match(echo.traceId, /^[0-9a-f]{32}$/);
  await demo.evaluate(() => {
    const until = performance.now() + 90;
    while (performance.now() < until) {
      /* Intentional test long task. */
    }
  });
  await demo.getByRole('link', { name: 'Home', exact: true }).click();

  const filters = {
    start: Date.now() - 3600000,
    end: Date.now() + 1000,
    app: 'demo-app',
    environment: '',
    release: '',
    route: '',
    browser: '',
    sessionId: '',
    search: '',
  };
  const widgets = widgetCatalog.map((w) => ({
    id: w.id,
    catalogId: w.id,
    settings: {},
  }));
  const queried = await eventually(
    async () => {
      filters.end = Date.now();
      const result = await api('widgets/query', { filters, widgets });
      const failed = result.results.filter((r) => r.error);
      assert.deepEqual(
        failed,
        [],
        'All catalog queries must execute against the pinned stack.',
      );
      const correlated = result.results
        .find((r) => r.id === 'error-stream')
        ?.data?.events?.some(
          (e) =>
            e.timestamp >= generatedAt &&
            e.traceId &&
            e.fields['value'] ===
              'Deliberate traced error from the Telemetry Lab',
        );
      return correlated &&
        result.results.find((r) => r.id === 'sessions')?.data?.value > 0
        ? result
        : false;
    },
    'RUM and errors arriving in Loki',
    45000,
  );
  assert.ok(
    queried.results
      .find((r) => r.id === 'custom-measurements')
      .data.series.some((s) => s.points.some(([, value]) => value === 135)),
  );
  console.log(
    '[dashboard] All ' + widgets.length + ' catalog queries succeeded',
  );
  const trace = await eventually(
    async () => {
      const detail = await api('traces/' + echo.traceId);
      return detail.spans.some((s) => s.service === 'demo-app') &&
        detail.spans.some((s) => s.name.includes('postgres'))
        ? detail
        : false;
    },
    'complete browser → API → DB trace arriving',
    45000,
  );
  const release = trace.spans.find((s) => s.service === 'demo-app').resource[
    'app.release'
  ];
  assert.ok(release);
  await eventually(async () => {
    const releaseSearch = await api('traces/search', {
      filters: { ...filters, end: Date.now(), release },
      name: 'lab.echo-roundtrip',
      status: 'all',
    });
    return releaseSearch.traces.some((t) => t.traceId === echo.traceId);
  }, 'search index finding the release-filtered trace');
  console.log('[dashboard] Complete trace and release filters verified');

  await page.goto(webUrl, { waitUntil: 'networkidle' });
  await page
    .getByRole('heading', { name: 'RUM Overview', exact: true })
    .waitFor();
  await eventually(
    async () =>
      Number(
        (
          await page
            .getByRole('region', { name: 'Observed sessions', exact: true })
            .locator('.stat-value')
            .textContent()
        ).replace(/,/g, ''),
      ) > 0,
    'live session widget',
  );
  await page
    .getByRole('combobox', { name: 'Application', exact: true })
    .click();
  await page.getByRole('option', { name: 'demo-app', exact: true }).click();
  await page.getByRole('combobox', { name: 'Time range', exact: true }).click();
  await page
    .getByRole('option', { name: 'Last 15 minutes', exact: true })
    .click();
  await page
    .getByRole('combobox', { name: 'Auto refresh', exact: true })
    .click();
  await page.getByRole('option', { name: 'Refresh off', exact: true }).click();
  assert.ok(
    page.url().includes('app=demo-app') &&
      page.url().includes('range=900000') &&
      page.url().includes('refresh=0'),
  );
  await page.reload({ waitUntil: 'networkidle' });
  assert.ok(
    (
      await page
        .getByRole('combobox', { name: 'Application', exact: true })
        .textContent()
    ).includes('demo-app'),
  );
  await page.screenshot({
    path: new URL('rum-desktop.png', output).pathname,
    fullPage: true,
  });

  console.log(
    '[dashboard] Testing persistence, keyboard ordering, and widget settings',
  );
  await page
    .getByRole('button', { name: 'Edit dashboard', exact: true })
    .click();
  const firstWidget = page.getByRole('region', {
    name: 'Observed sessions',
    exact: true,
  });
  const beforeDrag = await firstWidget.boundingBox();
  const grip = await firstWidget.locator('.drag-handle').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + beforeDrag.width + 22, grip.y + 10, {
    steps: 10,
  });
  await page.mouse.up();
  await eventually(
    async () => {
      const box = await firstWidget.boundingBox();
      return box.x !== beforeDrag.x || box.y !== beforeDrag.y;
    },
    'dragging a widget',
    5000,
  );
  const beforeResize = await firstWidget.boundingBox();
  const resize = await firstWidget
    .locator('..')
    .locator('.react-resizable-handle')
    .boundingBox();
  await page.mouse.move(
    resize.x + resize.width / 2,
    resize.y + resize.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(resize.x + 130, resize.y + 55, { steps: 10 });
  await page.mouse.up();
  await eventually(
    async () => (await firstWidget.boundingBox()).width > beforeResize.width,
    'resizing a widget',
    5000,
  );
  await page
    .getByRole('button', { name: 'Configure Observed sessions', exact: true })
    .click();
  const settings = page.getByRole('dialog');
  await settings
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('Observed test sessions');
  await settings
    .getByRole('spinbutton', { name: 'Width (grid columns)', exact: true })
    .fill('4');
  await settings
    .getByRole('button', { name: 'Apply settings', exact: true })
    .click();
  await page
    .getByRole('button', {
      name: 'Move Observed test sessions later',
      exact: true,
    })
    .focus();
  await page.keyboard.press('Enter');
  await page
    .getByRole('button', { name: 'Save dashboard', exact: true })
    .click();
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('heading', { name: 'Observed test sessions', exact: true })
    .waitFor();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('pulse:dashboards:v1')),
  );
  assert.equal(
    saved.dashboards[0].widgets.find(
      (w) => w.title === 'Observed test sessions',
    ).w,
    4,
  );
  await page
    .getByRole('button', { name: 'Duplicate dashboard', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Dashboard name', exact: true })
    .fill('Checkout QA');
  await page.getByRole('button', { name: 'Create copy', exact: true }).click();
  await page
    .getByRole('heading', { name: 'Checkout QA', exact: true })
    .waitFor();
  await page.reload({ waitUntil: 'networkidle' });
  await page
    .getByRole('heading', { name: 'Checkout QA', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Edit dashboard', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Search widgets', exact: true })
    .fill('Custom measurements');
  await page
    .locator('.catalog-card')
    .filter({ hasText: 'Custom measurements' })
    .click();
  await page
    .getByRole('textbox', { name: 'Search widgets', exact: true })
    .waitFor({ state: 'hidden' });
  await page
    .getByRole('button', { name: 'Configure Custom measurements', exact: true })
    .click();
  await page
    .getByLabel('Measurement type', { exact: true })
    .fill('checkout_step_duration');
  await page
    .getByRole('button', { name: 'Apply settings', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Save dashboard', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete dashboard', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete dashboard', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'RUM Overview', exact: true })
    .waitFor();
  await page
    .getByRole('button', { name: 'Reset dashboard', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Reset dashboard', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Observed sessions', exact: true })
    .waitFor();

  console.log(
    '[dashboard] Checking event-to-trace navigation and trace waterfall',
  );
  await page
    .getByRole('navigation', { name: 'Dashboards', exact: true })
    .getByRole('button', { name: 'Frontend Errors', exact: true })
    .click();
  const correlated = page
    .locator('.event-row')
    .filter({ hasText: 'Deliberate traced error from the Telemetry Lab' })
    .first();
  await correlated.waitFor();
  await correlated.click();
  await page
    .getByRole('button', { name: 'Open distributed trace', exact: false })
    .click();
  await page.locator('.waterfall-row').first().waitFor();
  assert.ok(page.url().includes('trace='));
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Dashboards', exact: true })
    .getByRole('button', { name: 'Distributed Traces', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Trace ID', exact: true })
    .fill(echo.traceId);
  await page.getByRole('button', { name: 'Open trace', exact: true }).click();
  await page
    .locator('.waterfall-row')
    .filter({ hasText: 'SELECT orders FROM postgres' })
    .waitFor();
  await page.screenshot({
    path: new URL('trace-waterfall.png', output).pathname,
  });
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();

  console.log(
    '[dashboard] Checking mobile layout, themes, and stale data handling',
  );
  await page
    .getByRole('navigation', { name: 'Dashboards', exact: true })
    .getByRole('button', { name: 'RUM Overview', exact: true })
    .click();
  await page
    .getByRole('region', { name: 'Observed sessions', exact: true })
    .locator('.stat-value')
    .waitFor();
  await page.route('**/api/widgets/query', async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      json: {
        results: body.widgets.map((w) => ({
          id: w.id,
          error: 'Loki test outage',
          fetchedAt: Date.now(),
        })),
      },
    });
  });
  await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
  await eventually(
    async () =>
      (
        await page
          .getByRole('region', { name: 'Observed sessions', exact: true })
          .locator('.widget-error')
          .textContent()
      ).includes('Stale'),
    'retained stale panel data',
  );
  await page.unroute('**/api/widgets/query');
  await page.getByRole('button', { name: 'Refresh data', exact: true }).click();
  await page
    .getByRole('button', { name: 'Switch to light theme', exact: true })
    .click();
  await page.screenshot({ path: new URL('rum-light.png', output).pathname });
  await page
    .getByRole('button', { name: 'Switch to dark theme', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-widget-grid').waitFor();
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    'Mobile page must not overflow horizontally.',
  );
  await page.screenshot({ path: new URL('rum-mobile.png', output).pathname });
  await page
    .getByRole('button', { name: 'Open navigation', exact: true })
    .click();
  await page
    .getByRole('navigation', { name: 'Dashboards', exact: true })
    .getByRole('button', { name: 'Frontend Metrics', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Frontend Metrics', exact: true })
    .waitFor();
  assert.deepEqual(errors, [], 'No unexpected dashboard runtime errors');
  console.log(
    '[dashboard] PASS: live queries, filters, persistence, editing, drilldowns, responsive layouts, themes, and outage handling',
  );
  console.log('[dashboard] Screenshots: ' + output.pathname);
} catch (error) {
  await page
    .screenshot({
      path: new URL('failure.png', output).pathname,
      fullPage: true,
    })
    .catch(() => undefined);
  throw error;
} finally {
  await browser.close();
}
