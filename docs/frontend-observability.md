# Frontend Observability SDK Guide

`@company/frontend-observability` is the single entry point for all frontend telemetry.
Grafana Faro and OpenTelemetry are implementation details: no vendor type or package ever
leaks through the public API, and ESLint blocks direct `@grafana/*` / `@opentelemetry/*`
imports in application code.

## Initialization

Initialize once, before rendering, from environment-driven configuration:

```ts
import { initializeObservability } from '@company/frontend-observability';

initializeObservability({
  app: {
    name: 'customer-portal',
    version: '2026.08.18',
    environment: 'production',
    commitSha: 'abc1234',
  },
  collector: { faroUrl: 'https://telemetry.company.com/collect' },
  features: {
    rum: true,
    errors: true,
    tracing: true,
    network: true,
    webVitals: true,
    customEvents: true,
  },
  sampling: { sessions: 0.25, traces: 0.1, performance: 0.25, events: 1 },
  privacy: { collectUserId: true, collectTenantId: true, allowQueryParameters: false },
  tracePropagation: {
    allowedOrigins: [/^https:\/\/api\.company\.com/],
  },
});
```

Guarantees:

- **Singleton-safe**: repeated calls (React Strict Mode, HMR, duplicate bundles) are no-ops;
  state lives on `globalThis`.
- **Never throws**: invalid configuration or a failing collector disables telemetry and
  logs a warning; the application is never affected.
- **Non-blocking**: initialization does no synchronous network work.

## Public API

| Function | Purpose |
|---|---|
| `initializeObservability(config)` | Boot telemetry (idempotent) |
| `shutdownObservability()` | Pause delivery and reset |
| `setTelemetryConsent(granted)` | Dynamically pause/resume telemetry and clear identity on consent change |
| `getObservability()` | Vendor-neutral status snapshot |
| `captureError(error, context?)` | Report an error enriched with breadcrumbs + browser context (never sampled away) |
| `captureMessage(message, options?)` | Report a log line (`info`, `warn`, or `error`) |
| `captureEvent(name, attributes?)` | Report a custom RUM event (sampled) |
| `captureMeasurement(type, values, context?)` | Report custom performance SLIs / timings |
| `addBreadcrumb(breadcrumb)` / `getBreadcrumbs()` / `clearBreadcrumbs()` | Record and inspect sanitized user/navigation breadcrumbs |
| `setView(name)` | Set normalized logical view name for modals, wizards, or micro-frontends |
| `setUserContext({ id })` / `clearUserContext()` | Attach/detach an opaque user id |
| `setTenantContext({ id })` / `clearTenantContext()` | Attach/detach a tenant id |
| `getTracer()` / `startSpan()` / `withSpan()` / `getActiveTraceContext()` | Vendor-neutral tracing & active W3C correlation context |
| `ObservabilityErrorBoundary` | React error boundary that reports render errors |

| `ObservableRoutes` | Drop-in `<Routes>` replacement reporting route templates |
| `normalizeRoute(pathname)` | Convert concrete paths to low-cardinality templates |


### React integration

```tsx
<ObservabilityErrorBoundary fallback={(error) => <ErrorPage error={error} />}>
  <ObservableRoutes>
    <Route path="/orders/:orderId" element={<OrderDetail />} />
  </ObservableRoutes>
</ObservabilityErrorBoundary>
```

Route changes are reported with the route *template* (`/orders/:orderId`), never raw URLs.

### Tracing

```ts
await withSpan('checkout.submit', async () => {
  await fetch('/api/checkout', { method: 'POST' });
});
```

Manual span attributes, updates, and recorded exceptions are sanitized before they are
recorded. The export gate also sanitizes trace resource, span, event, and link attributes.
`captureMessage` maps its optional `level` to the corresponding Faro log severity; when
omitted, Faro's default severity is preserved.

`fetch` (and optionally XHR) are instrumented automatically when `features.network` is on.
The W3C `traceparent` header is attached only to requests matching
`tracePropagation.allowedOrigins`. Never use a catch-all: third parties must not receive
trace context.

### Identity

Call on login / logout / tenant switch:

```ts
setUserContext({ id: opaqueUserId });   // requires privacy.collectUserId
setTenantContext({ id: tenantId });     // requires privacy.collectTenantId
clearUserContext();
clearTenantContext();
```

## Telemetry contract

Resource metadata attached to all signals:

| Field | Source |
|---|---|
| `app_name`, `app_version`, `app_environment` | `config.app` |
| `app_release` | `name@version+shortsha` (or explicit `app.release`) |
| `session_id` | Faro session tracking |
| `user_id` | `setUserContext` (opaque id only) |
| `session_attr_tenant_id` | `setTenantContext` |
| `browser_*`, `page_url` | Faro browser metadata (URL sanitized) |
| `trace_id` | Present on signals correlated with a trace |

Loki labels (low-cardinality only): `job=faro`, `kind`, `app_name`, `app_environment`,
`app_release`. User, session, and request identifiers are never used as labels.

## Sampling

| Signal | Default | Control |
|---|---|---|
| Errors | always 100% | not configurable by design |
| Sessions | `sampling.sessions` | Faro session sampling |
| Traces | `sampling.traces` | deterministic `traceId` hash sampling at export time |
| Performance (Web Vitals, Long Tasks, Custom Measurements) | `sampling.performance` | applied at export time |
| Custom events & frustration signals (`rage_click`) | `sampling.events` | applied in `captureEvent` |


Delivery is batched, asynchronous, and bounded by the Faro transport; a full buffer drops
low-priority items rather than blocking the application.

## Local pipeline

See the root [README.md](../README.md) for the local Alloy/Loki/Tempo/Grafana stack and the
headless-browser smoke test (`scripts/verify-telemetry.mjs`).
