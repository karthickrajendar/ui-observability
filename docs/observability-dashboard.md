# Pulse observability dashboard

Pulse queries the telemetry already collected by this workspace: Loki for RUM,
exceptions, events, and frontend measurements, and Tempo for distributed traces.
Grafana remains available alongside it.

## Start locally

Use Node 24 LTS or newer, npm, and a running Docker daemon.

```bash
npm install
docker compose -f observability/docker/docker-compose.yml up -d
npm run dev
```

Open **http://localhost:4201**. The API listens on **127.0.0.1:4202**; Vite proxies
`/api` requests to it. In a second terminal, start the telemetry source:

```bash
npx nx serve @ui-observability/demo-app
```

Open http://localhost:4200 and use Telemetry Lab to generate signals. The **Capture
error with trace context** button creates a correlated exception. **Traced fetch to
/api/echo** creates a browser → API → database trace. Pulse itself does not emit
telemetry, keeping it separate from the application being observed.

## Configuration

The API loads `apps/observability-api/.env` when present. Copy `.env.example` in
that directory to override its defaults:

| Variable              | Default                 |
| --------------------- | ----------------------- |
| `HOST`                | `127.0.0.1`             |
| `PORT`                | `4202`                  |
| `LOKI_URL`            | `http://127.0.0.1:3100` |
| `TEMPO_URL`           | `http://127.0.0.1:3200` |
| `UPSTREAM_TIMEOUT_MS` | `10000`                 |

If you change the API port, update the web Vite proxy too. Keep the API on loopback:
this version is intended for local development and has no authentication.
Backend addresses and configuration remain server-side.

## Dashboards and filters

The preset dashboards cover RUM, frontend errors, frontend metrics, and traces.
Application, environment, release, time range, and refresh interval are encoded in
the URL. Custom ranges use the browser's local timezone and may span up to seven days.

Signal filters match exact route/view, browser, or session values, with a literal
substring search for event text. Trace widgets offer operation-name substring,
span-duration, and span-status search plus direct trace-ID lookup. RUM-only filters
produce an explicit error on a trace widget rather than being silently ignored.
Use **Clear** under signal filters to return to unrestricted trace search.

**Edit dashboard** lets you rename a dashboard, add/remove/rename widgets, and drag or
resize panels. Arrow buttons reorder widgets with the keyboard; widget settings also
expose numeric width and height. Custom measurement settings select a numeric field,
optional measurement type, and display unit. Suggestions come from a bounded sample
of recent measurements; you can type a known field when it is absent.

Save, duplicate, and create dashboards in this browser. Reset restores an original
preset; deleting removes a personal dashboard. Saved definitions are versioned under
`pulse:dashboards:v1` in local storage. URLs share filters and time ranges, while
personal layouts remain local. Invalid saved entries are skipped with a notice,
preserving readable entries.

## Data semantics and failures

- Session counts are distinct **observed** sessions in the selected range. Counts
  reflect SDK sampling.
- Web Vitals use p75 over collected samples. CLS is unitless; network nanoseconds
  are converted to milliseconds. Custom units must match the source field values.
- Successful empty count queries yield zero. Missing numeric samples and ratios
  with no denominator show **No data**.
- Totals and percentiles come from Loki aggregation, never from a limited event list.
- Event streams show at most 200 entries, trace searches at most 100 matches, and
  charts target about 180 time buckets. Limit notices appear where applicable.
- Queries use server-owned templates, bounded concurrency, a 10-second default
  upstream timeout, and a 16 MiB response limit.
- A failed widget retains successful data for the same filters and settings,
  marked **Stale** with its last successful timestamp. Changed filters do not reuse
  values from another selection.
- Trace details retrieve the complete trace, retaining downstream spans even when
  their service/environment differs from the matching frontend span.
- New browser traces carry `app.release`, matching Faro's RUM release identifier.
  Historical traces without this attribute require an unrestricted release filter.
  The local Tempo stack retains traces for 24 hours.
- Captured errors mirror active trace/span IDs into sanitized context for correlation
  with the pinned receiver, which can omit native exception trace fields. These IDs
  remain record attributes and are not promoted to Loki labels.

## API

Shared request schemas and result types live in `@ui-observability/contracts`.

| Endpoint                  | Purpose                                               |
| ------------------------- | ----------------------------------------------------- |
| `GET /api/health`         | Independent Loki/Tempo readiness                      |
| `POST /api/filters`       | Label values and recent measurement-field suggestions |
| `POST /api/widgets/query` | Catalog widgets → independent widget results          |
| `POST /api/traces/search` | Filtered trace summaries                              |
| `GET /api/traces/:id`     | Complete normalized spans, resources, and events      |

Widget requests contain `{ filters, widgets: [{ id, catalogId, settings }] }`.
Filters use epoch milliseconds for `start`/`end`, plus `app`, `environment`, `release`,
`route`, `browser`, `sessionId`, and `search` strings (empty means unrestricted).
There is no arbitrary query or upstream-URL endpoint.

## Build and validate

```bash
npm run check
npm run check:dashboard  # dashboard, contracts, existing SDK, and demo only
npm run build
npx nx build @ui-observability/demo-app
```

The production API is `node apps/observability-api/dist/main.mjs`. For a local
production-web preview against that API, run `npx nx preview observability-web`
and open http://localhost:4301.

With the stack, demo app, and dashboard running:

```bash
npx playwright install chromium
npm run verify:dashboard
node scripts/verify-telemetry.mjs
```

Dashboard verification generates real telemetry and exercises every catalog query,
release filtering, the complete waterfall, event-to-trace navigation, widget edits,
local persistence, responsive layouts, theme switching, and retained stale results.
It uses an isolated browser context and writes screenshots to `tmp/dashboard-qa/`.

If Google Chrome is already installed, you can use
`node scripts/verify-dashboard.mjs --chrome` and
`node scripts/verify-telemetry.mjs --chrome` instead of downloading Chromium.
