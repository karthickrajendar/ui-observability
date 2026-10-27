# @company/frontend-observability

The internal frontend observability SDK. Applications import telemetry functionality from
this package only - Grafana Faro and OpenTelemetry are private implementation details.

- Usage guide and API reference: [docs/frontend-observability.md](../../docs/frontend-observability.md)
- Privacy model: [docs/privacy.md](../../docs/privacy.md)

## Commands

```bash
npx nx test @company/frontend-observability
npx nx typecheck @company/frontend-observability
npx nx lint @company/frontend-observability
```

## Structure

```text
src/lib/
  config/    ObservabilityConfig contract + validation
  core/      public API, singleton state, vendor-neutral tracing
  faro/      the single Faro/OTel initialization path
  privacy/   sanitization + the beforeSend gate all telemetry passes
  sampling/  sampling helpers
  rum/       route normalization, ObservableRoutes
  errors/    error boundary, chunk/resource failure capture
  release/   release identifier derivation
```
