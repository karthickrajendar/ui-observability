# ui-observability

Production-grade frontend observability reference implementation: a React (Nx) application
instrumented through an internal SDK built on **Grafana Faro** and **OpenTelemetry Web**,
shipping RUM, errors, Web Vitals, and traces through **Grafana Alloy** into **Loki** and
**Tempo**, visualized in **Grafana**.

```text
React demo app
      |
@company/frontend-observability   (the ONLY telemetry import allowed in app code)
      |
Faro Web SDK + OTel TracingInstrumentation
      |
      v  HTTP :12347
Grafana Alloy (faro.receiver)
      |               |
      v               v
    Loki            Tempo
 (RUM/logs)        (traces)
      \               /
       v             v
          Grafana :3000
```

## Repository layout

| Path | Purpose |
|---|---|
| `apps/demo-app` | React demo app with a Telemetry Lab page for generating every signal |
| `libs/frontend-observability` | The internal SDK (`@company/frontend-observability`) |
| `observability/docker` | Local LGTM stack: Alloy, Loki, Tempo, Grafana |
| `observability/dashboards` | Provisioned Grafana dashboards |
| `docs/` | Telemetry contract and privacy model |
| `scripts/verify-telemetry.mjs` | Headless-browser end-to-end verification |

## Quickstart

Prerequisites: Node 20+, npm, Docker (Docker Desktop or colima).

```bash
# 1. Install dependencies
npm install

# 2. Start the observability stack (Alloy, Loki, Tempo, Grafana)
docker compose -f observability/docker/docker-compose.yml up -d

# 3. Start the demo app
npx nx serve demo-app
```

Then:

- Open the app at http://localhost:4200 and use the **Telemetry Lab** page to generate
  errors, events, traces, and Web Vitals.
- Open Grafana at http://localhost:3000 (anonymous admin, local only). Dashboards are in
  the **Frontend Observability** folder: *RUM Overview*, *Frontend Errors*,
  *Frontend Performance*.
- Explore raw signals: Loki query `{job="faro"}`, Tempo search `service.name=demo-app`.

## Smoke test

With the stack and dev server running:

```bash
node scripts/verify-telemetry.mjs
```

This drives a headless Chromium through every telemetry trigger and fails on unexpected
page errors. To prove the app survives a collector outage:

```bash
docker stop ui-observability-alloy-1
node scripts/verify-telemetry.mjs --outage
docker start ui-observability-alloy-1
```

## Development

```bash
npx nx run-many -t typecheck test lint   # all checks
npx nx test @company/frontend-observability
```

Key rules (enforced by ESLint and the SDK design):

1. Application code never imports `@grafana/*` or `@opentelemetry/*` directly - only
   `@company/frontend-observability`.
2. There is exactly one tracer provider, owned by the SDK (Faro's
   `TracingInstrumentation`).
3. Every telemetry item passes centralized sanitization (`beforeSend`); secrets,
   sensitive headers, and sensitive query parameters never leave the browser.
4. Telemetry failures never break the application: initialization is non-blocking,
   singleton-safe, Strict Mode / HMR safe, and everything no-ops when disabled.
5. `traceparent` is only propagated to the configured first-party origin allowlist.

See [docs/frontend-observability.md](docs/frontend-observability.md) for the SDK guide
and [docs/privacy.md](docs/privacy.md) for the privacy model.
