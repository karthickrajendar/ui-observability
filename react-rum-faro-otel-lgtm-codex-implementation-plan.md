# Production-Grade React RUM + OpenTelemetry + Grafana LGTM — Codex Implementation Plan

## 1. Executive Decision

For the new approach, keep the frontend observability platform focused on:

- React
- Nx
- Grafana Faro
- OpenTelemetry Web SDK
- Grafana Alloy
- Loki
- Tempo
- Grafana

Do **not** include Azure Monitor or Log Analytics in the React RUM implementation.

The target architecture is:

```text
                         Browser
                            |
                            v
                  React Nx Application
                            |
                            v
            @company/frontend-observability
                            |
                 +----------+----------+
                 |                     |
                 v                     v
            Grafana Faro       OpenTelemetry Web
            RUM / Errors       Traces / Spans
            Web Vitals        W3C Trace Context
            Sessions          HTTP instrumentation
                 |                     |
                 +----------+----------+
                            |
                            v
                    HTTPS / TLS
                            |
                            v
                    Ingress / WAF
                            |
                            v
                    Grafana Alloy
                            |
                 +----------+----------+
                 |                     |
                 v                     v
                Loki                 Tempo
             RUM / Logs             Traces
                 |                     |
                 +----------+----------+
                            |
                            v
                         Grafana
```

Future backend:

```text
React
  |
  | traceparent
  v
API Gateway
  |
  v
Spring Boot Service A
  |
  v
Spring Boot Service B
  |
  v
PostgreSQL
```

Future metrics platform:

```text
Spring Boot / Kubernetes / PostgreSQL
              |
              v
          Prometheus
              |
              v
            Mimir
              |
              v
            Grafana
```

Azure Monitor/Log Analytics can be added later for Azure platform/security/compliance telemetry, but it is deliberately outside this frontend RUM milestone.

---

# 2. Why This Architecture

The platform has clear responsibilities:

| Component | Responsibility |
|---|---|
| Grafana Faro | Frontend RUM |
| OpenTelemetry Web | Browser tracing |
| Grafana Alloy | Telemetry ingestion, processing and routing |
| Loki | Frontend logs/RUM events |
| Tempo | Distributed traces |
| Grafana | Visualization and alerting |
| Prometheus | Future metrics scraping |
| Mimir | Future long-term metrics |
| Azure Monitor | Future Azure platform telemetry |

Grafana's current Faro documentation describes Faro as an open-source RUM SDK with React support, while the Alloy `faro.receiver` accepts telemetry from the Faro Web SDK and can forward logs to Loki and traces to OpenTelemetry-compatible downstream components. citeturn0search6turn0search0

OpenTelemetry JavaScript supports browser tracing, but its own documentation currently warns that browser client instrumentation is experimental/mostly unspecified. Therefore, keep OTel implementation details completely behind the internal company SDK. citeturn0search1turn0search3

---

# 3. Critical Design Rule — One Tracing Implementation

Use:

```text
OpenTelemetry Web SDK
        |
        +-- HTTP spans
        +-- custom spans
        +-- W3C propagation
        +-- trace context
        |
        v
Faro-compatible export path
        |
        v
Alloy
        |
        v
Tempo
```

Do **not** create two independent tracing providers:

```text
Faro tracing provider
+
separate OTel tracing provider
```

That can cause:

- duplicate spans
- duplicate HTTP instrumentation
- inconsistent context
- confusing traces
- additional browser overhead

The internal SDK must own the provider lifecycle.

---

# 4. Critical Design Rule — Applications Never Import Vendors

Application code:

```ts
import {
  initializeObservability,
  captureError,
  getTracer,
} from '@company/frontend-observability';
```

Never:

```ts
import { initializeFaro } from '@grafana/faro-react';
import { trace } from '@opentelemetry/api';
```

The public company SDK API must not expose vendor-specific types.

This makes the platform replaceable and gives the observability team centralized control over:

- sampling
- privacy
- routing
- instrumentation
- release metadata
- configuration
- upgrades

---

# 5. Nx Repository Structure

Use:

```text
libs/
  frontend-observability/
    src/
      lib/
        core/
        config/
        faro/
        otel/
        rum/
        errors/
        network/
        context/
        privacy/
        sampling/
        release/
      index.ts
    README.md
    project.json

observability/
  docker/
    docker-compose.yml
    alloy/
      config.alloy
    grafana/
      provisioning/

  dashboards/
    rum-overview.json
    frontend-errors.json
    frontend-performance.json
    release-health.json

  alerts/

docs/
  frontend-observability.md
  privacy.md
  rollout.md
  runbook.md
```

If the repository has an existing Nx library convention, follow that convention.

---

# 6. Phase 0 — Repository Discovery

Before modifying anything, have Codex inspect the repository.

### Codex Prompt

```text
DISCOVERY ONLY.

You are implementing production-grade frontend RUM in an existing React Nx monorepo.

Do not modify files.
Do not install packages.

Inspect:

- Nx version
- Node version
- package manager
- React version
- React Router version
- TypeScript version
- build system
- fetch usage
- Axios usage
- GraphQL usage
- authentication
- user context
- tenant context
- existing error boundaries
- existing logging
- existing analytics
- existing OpenTelemetry
- existing Faro
- existing Application Insights
- environment configuration
- source maps
- deployment architecture
- CSP
- CORS
- SSR
- service workers
- micro-frontends
- CI/CD

Return:

1. findings
2. existing dependencies
3. architecture constraints
4. privacy/security risks
5. duplicate instrumentation risks
6. recommended Nx library location
7. files likely to change
8. required dependencies
9. testing strategy
10. phased implementation plan

Do not change anything.

Stop after the report.
```

### Gate

Review Codex's report before continuing.

---

# 7. Phase 1 — Observability Contract

Create:

```text
docs/frontend-observability.md
docs/privacy.md
```

Define resource metadata:

```text
service.name
service.version
deployment.environment
app.name
app.version
release
commit.sha
```

Define contextual metadata:

```text
route
session.id
trace.id
browser
browser.version
os
device.type
```

Optional and privacy-reviewed:

```text
user.id
tenant.id
```

Do not use high-cardinality values as metric labels.

---

# 8. Phase 2 — Privacy First

Complete this before instrumentation.

## Never collect

```text
passwords
access tokens
refresh tokens
JWT contents
Authorization headers
Cookie contents
Set-Cookie
credit card data
bank account data
secrets
full form values
full request bodies
full response bodies
```

## Sanitize URLs

Redact:

```text
token
code
email
password
authorization
account
customer
session
```

## Normalize routes

Bad:

```text
/customer/123456/orders/987654
```

Good:

```text
/customer/:customerId/orders/:orderId
```

## Telemetry endpoint security

Browser telemetry is untrusted input.

Protect the endpoint with:

```text
HTTPS
CORS allowlist
origin validation
rate limiting
payload size limits
API-key validation where appropriate
schema validation
sanitization
abuse controls
```

Alloy's `faro.receiver` supports CORS configuration, API-key validation, rate limiting, payload limits, and sourcemap retrieval, which makes it suitable as the self-hosted Faro ingestion boundary. citeturn0search0

---

# 9. Phase 3 — Strongly Typed Configuration

Create:

```ts
export interface ObservabilityConfig {
  app: {
    name: string;
    version: string;
    environment: string;
    release?: string;
    commitSha?: string;
  };

  collector: {
    faroUrl: string;
  };

  features: {
    rum: boolean;
    errors: boolean;
    tracing: boolean;
    network: boolean;
    webVitals: boolean;
    customEvents: boolean;
  };

  sampling: {
    sessions: number;
    traces: number;
    performance: number;
    events: number;
  };

  privacy: {
    collectUserId: boolean;
    collectTenantId: boolean;
    allowQueryParameters: boolean;
  };

  tracePropagation: {
    allowedOrigins: RegExp[];
  };

  debug?: boolean;
}
```

Configuration must be environment-driven.

Never hardcode production endpoints.

---

# 10. Phase 4 — Core SDK

Implement:

```ts
initializeObservability()
shutdownObservability()

getObservability()

setUserContext()
clearUserContext()

setTenantContext()
clearTenantContext()

captureError()
captureMessage()
captureEvent()

getTracer()
startSpan()
withSpan()
```

Requirements:

- singleton-safe
- non-blocking
- safe when disabled
- safe when collector unavailable
- safe during HMR
- safe with React Strict Mode
- no telemetry exception reaches application code

---

# 11. Phase 5 — Grafana Faro RUM

Use Faro for:

```text
JavaScript errors
React errors
page views
route changes
Web Vitals
sessions
browser metadata
RUM events
```

Grafana's React integration supports React Router instrumentation and React error-boundary integration. citeturn0search6turn0search10

### Codex Prompt

```text
Implement Grafana Faro RUM inside @company/frontend-observability.

Requirements:

1. Faro must only be imported inside the observability library.
2. Application code must never import Faro directly.
3. Configure app name, version and environment.
4. Configure the Faro endpoint from environment configuration.
5. Initialization must be non-blocking.
6. Initialization failure must never crash the application.
7. Add singleton protection.
8. Add centralized telemetry sanitization.
9. Add configurable sampling.
10. Add unit tests.
11. Do not modify unrelated dependencies.
12. Do not capture request or response bodies.
13. Do not capture sensitive headers.
14. Do not expose Faro types in the public SDK.

Inspect installed package versions first and use compatible APIs.
```

---

# 12. Phase 6 — OpenTelemetry Web SDK

OpenTelemetry Web is the canonical tracing implementation.

Use it for:

```text
browser spans
fetch spans
XHR spans when required
custom spans
W3C trace context
traceparent propagation
future Spring Boot correlation
```

The current OTel JavaScript browser documentation uses `@opentelemetry/sdk-trace-web` and browser instrumentation packages for browser tracing, while warning that client browser instrumentation is experimental. citeturn0search3

### Codex Prompt

```text
Implement OpenTelemetry Web tracing inside @company/frontend-observability.

Requirements:

1. OpenTelemetry Web is the canonical browser tracing implementation.
2. Create exactly one tracer provider.
3. Configure:
   - service.name
   - service.version
   - deployment.environment
4. Configure W3C Trace Context propagation.
5. Instrument fetch.
6. Instrument XMLHttpRequest only if the application requires it.
7. Prevent duplicate instrumentation.
8. Integrate trace export with the Faro/Alloy architecture.
9. Do not expose OTel implementation types to application code.
10. Add singleton protection.
11. Make initialization safe for React Strict Mode.
12. Make initialization safe for HMR.
13. Add tests for provider initialization.
14. Add tests for traceparent generation.
15. Add tests for duplicate instrumentation.
16. Do not modify unrelated dependencies.

Inspect installed OTel/Faro versions first.
Use APIs compatible with the repository.
```

---

# 13. Phase 7 — Trace Propagation

Future target:

```text
React
  |
  | traceparent
  v
API Gateway
  |
  v
Spring Boot A
  |
  v
Spring Boot B
```

Only propagate to approved first-party origins.

Example:

```ts
allowedOrigins: [
  /^https:\/\/api\.company\.com/,
  /^https:\/\/gateway\.company\.com/,
]
```

Never:

```text
*
```

Never send tracing headers to:

```text
Google
Microsoft
Stripe
third-party analytics
CDNs
external APIs
```

unless explicitly approved.

---

# 14. Phase 8 — React Error Monitoring

Capture:

```text
React ErrorBoundary
window.onerror
unhandledrejection
dynamic import failures
chunk load failures
resource failures
```

Attach:

```text
route
release
browser
session.id
trace.id
component stack
```

Never attach:

```text
DOM
form values
passwords
tokens
cookies
```

---

# 15. Phase 9 — Router and Page Views

Capture:

```text
route
navigation duration
navigation result
navigation type
```

Use route templates rather than raw dynamic URLs.

For React Router, use the supported Faro React integration where it fits the application's router version rather than inventing parallel route instrumentation. Grafana documents support for multiple React Router generations. citeturn0search6

---

# 16. Phase 10 — Web Vitals

Capture:

```text
LCP
CLS
INP
FCP
TTFB
```

Dimensions:

```text
app
release
environment
route
browser
device.type
```

Do not add:

```text
user.id
session.id
request.id
```

as metric labels.

---

# 17. Phase 11 — Network Monitoring

Instrument only the HTTP client(s) actually used.

Capture:

```text
method
normalized route
status
duration
request size
response size
trace.id
```

Never capture:

```text
Authorization
Cookie
request body
response body
sensitive query parameters
```

### Codex Prompt

```text
Inspect the application and identify the real HTTP clients.

Instrument only the clients actually used.

Capture request metadata and performance only.

Implement:

- normalized endpoint
- method
- status
- duration
- request size
- response size
- trace ID

Never transmit:

- Authorization
- Cookie
- request body
- response body
- sensitive query parameters

Add privacy tests proving these values never reach telemetry.
```

---

# 18. Phase 12 — User / Tenant / Session Context

On login:

```ts
setUserContext({
  id: opaqueUserId,
});
```

On logout:

```ts
clearUserContext();
```

Tenant:

```ts
setTenantContext({
  id: tenantId,
});
```

Clear context on:

```text
logout
tenant switch
account switch
authentication expiry
```

Do not persist sensitive telemetry context merely for observability.

---

# 19. Phase 13 — Release Tracking

Every build must provide:

```text
app.version
release
commit.sha
build.timestamp
environment
```

Recommended:

```text
customer-portal@2026.08.18+abc1234
```

This is essential for answering:

> Did the latest deployment increase frontend errors or degrade performance?

---

# 20. Phase 14 — Source Maps

Production JavaScript errors must resolve to original source locations.

Pipeline:

```text
Nx build
   |
   +-- JS bundles
   |
   +-- source maps
   |
   v
secure sourcemap location
```

Do not publicly expose source maps unless explicitly approved.

Alloy's Faro receiver supports sourcemap retrieval and caching configuration. citeturn0search0

---

# 21. Phase 15 — Sampling and Batching

Starting production values:

```text
Errors:             100%
Critical errors:    100%
Sessions:            10-25%
Traces:              10%
Performance:         10-25%
Approved business events: 100%
Debug logs:           0%
```

Tune based on real telemetry volume.

Telemetry must be:

```text
batched
asynchronous
bounded
retryable
non-blocking
```

When buffers are full:

```text
drop low-priority events
```

Never block the application.

---

# 22. Phase 16 — Local LGTM Environment

Create:

```text
observability/docker/
  docker-compose.yml

observability/alloy/
  config.alloy

observability/grafana/
  provisioning/
```

Local target:

```text
React
 |
Faro + OTel
 |
 v
Alloy
 |
 +--> Loki
 |
 +--> Tempo
 |
 v
Grafana
```

### Codex Prompt

```text
Create a local frontend observability environment.

Use:

- Grafana Alloy
- Loki
- Tempo
- Grafana

Configure the stable faro.receiver component.

Verify:

1. React -> Faro -> Alloy -> Loki
2. React -> OTel/Faro -> Alloy -> Tempo

Create:

- Docker Compose
- Alloy configuration
- Grafana datasource provisioning
- health checks
- README
- smoke-test instructions

Do not add Azure Monitor or Log Analytics.
Do not add Prometheus/Mimir yet unless required by an existing repository standard.
```

Grafana's stable `faro.receiver` is specifically designed to accept Faro Web SDK telemetry and route logs/traces downstream. citeturn0search0

---

# 23. Phase 17 — Alloy Production Configuration

Production architecture:

```text
Internet
   |
   v
WAF / Ingress
   |
   v
Alloy
   |
   +---- Loki
   |
   +---- Tempo
```

Configure:

```text
HTTPS
CORS allowlist
API key validation where appropriate
rate limiting
payload size limits
sourcemaps
logging
health checks
```

Never use:

```text
CORS = *
```

in production.

The Alloy `faro.receiver` supports explicit CORS origins, API-key validation, payload limits and rate limiting. citeturn0search0

---

# 24. Phase 18 — Grafana Dashboards

Create:

## RUM Overview

```text
sessions
page views
error-free sessions
JS error rate
LCP
INP
CLS
TTFB
```

## Frontend Errors

```text
errors by release
errors by route
errors by browser
errors by application
top stack traces
chunk errors
```

## Performance

```text
LCP
INP
CLS
FCP
TTFB
page load
route transitions
API latency
```

## Network

```text
request count
error rate
p50
p95
p99
slow endpoints
status codes
```

## Release Health

```text
current release
previous release
sessions
error-free sessions
error rate
LCP
INP
API failure rate
```

---

# 25. Phase 19 — Alerts

Use high-signal alerts.

### Errors

```text
frontend JS error rate spike
error-free sessions drop
chunk load failure spike
```

### Performance

```text
LCP degradation
INP degradation
API p95 degradation
```

### Platform

```text
Alloy unavailable
Loki unavailable
Tempo unavailable
telemetry ingestion failure
```

Do not alert on every individual JavaScript exception.

---

# 26. Phase 20 — Testing

## Unit tests

Test:

```text
configuration
initialization
singleton behavior
sanitization
sampling
route normalization
user context
tenant context
release metadata
trace propagation
```

## Privacy tests

Prove:

```text
password -> never transmitted
JWT -> never transmitted
Authorization -> never transmitted
Cookie -> never transmitted
sensitive query -> redacted
request body -> not transmitted
response body -> not transmitted
```

## Playwright tests

Verify:

```text
RUM initialization
page view
route change
JS error
React error boundary
network telemetry
traceparent
Web Vitals
user context
tenant context
logout clearing context
privacy filtering
collector failure does not break app
```

---

# 27. Phase 21 — Performance Validation

Measure before and after observability:

```text
bundle size
LCP
INP
CLS
TTFB
CPU
memory
network requests
```

Requirements:

```text
non-blocking initialization
asynchronous delivery
batched payloads
bounded queues
no synchronous telemetry requests
minimal main-thread work
```

Set a CI performance budget and fail the build if telemetry causes an unacceptable regression.

---

# 28. Phase 22 — AGENTS.md for Codex

Create:

```text
AGENTS.md
```

Use:

```text
# Frontend Observability Rules

1. All application telemetry goes through @company/frontend-observability.
2. Application code must not import Faro directly.
3. Application code must not import OTel implementation packages directly.
4. OpenTelemetry Web is the canonical browser tracing implementation.
5. Only one tracer provider may be initialized.
6. Prevent duplicate Fetch/XHR instrumentation.
7. Never capture secrets.
8. Never capture Authorization headers.
9. Never capture cookies.
10. Never capture request/response bodies by default.
11. Never propagate trace headers to third-party domains.
12. Use explicit first-party API origin allowlists.
13. Telemetry failures must never break application behavior.
14. Initialization must be non-blocking.
15. New telemetry events require documented schemas.
16. New attributes require privacy review.
17. Avoid high-cardinality metric labels.
18. Do not use user/session/request IDs as metric labels.
19. Normalize dynamic routes.
20. Production source maps must not be public.
21. Do not add Azure Monitor or Application Insights browser SDK to this RUM milestone.
22. Do not add Log Analytics to the frontend telemetry path.
23. Do not upgrade unrelated dependencies.
24. Every telemetry feature requires unit tests.
25. Browser behavior requires Playwright validation.
26. Initialization must be singleton-safe.
27. React Strict Mode must not create duplicate telemetry.
28. HMR must not create duplicate telemetry.
29. Keep vendor-specific types out of the public SDK.
30. Preserve public SDK backward compatibility.
```

---

# 29. Codex Milestones

Do not ask Codex to implement the whole platform in one pass.

Use:

```text
M1  Repository discovery
M2  Observability contract
M3  Privacy/security model
M4  Nx SDK scaffold
M5  Faro RUM
M6  OpenTelemetry Web
M7  Trace propagation
M8  React errors
M9  Router/page views
M10 Web Vitals
M11 Network instrumentation
M12 User/session/tenant context
M13 Privacy sanitization
M14 Sampling/batching
M15 Release/source maps
M16 Local Alloy
M17 Loki + Tempo
M18 Grafana dashboards
M19 Alerts
M20 Playwright validation
M21 Performance testing
M22 Production hardening
M23 Production rollout
```

After every milestone:

```text
Codex
  |
  v
Review diff
  |
  v
Run tests
  |
  v
Run application
  |
  v
Verify telemetry
  |
  v
Commit
```

---

# 30. Recommended Codex Prompts

## M1 — Discovery

```text
Perform repository discovery only.

Do not modify files.
Do not install packages.

Analyze the React Nx application and return:

- versions
- build system
- router
- HTTP clients
- authentication
- error handling
- existing telemetry
- existing OTel
- existing Faro
- environment configuration
- deployment
- source maps
- CSP/CORS
- testing setup

Propose exact integration points for @company/frontend-observability.

Stop.
```

## M2 — SDK Scaffold

```text
Create @company/frontend-observability as an Nx library.

Do not integrate Faro or OpenTelemetry yet.

Create:

core
config
faro
otel
rum
errors
network
context
privacy
sampling
release

Create public TypeScript interfaces and unit tests.

Do not modify unrelated code.
```

## M3 — Faro

```text
Implement Grafana Faro RUM behind the internal SDK.

Implement:

- initialization
- page views
- errors
- sessions
- Web Vitals
- configuration
- release metadata
- sanitization
- sampling

Application code must not import Faro.

Add tests.
```

## M4 — OpenTelemetry

```text
Implement OpenTelemetry Web tracing behind the internal SDK.

Implement:

- WebTracerProvider
- resource attributes
- W3C Trace Context
- fetch instrumentation
- optional XHR instrumentation
- trace export integration
- singleton protection
- duplicate instrumentation protection
- Strict Mode safety
- HMR safety

Add tests.

Application code must not import OTel directly.
```

## M5 — Errors and Router

```text
Implement:

- React ErrorBoundary
- window.onerror
- unhandledrejection
- chunk load errors
- dynamic import errors
- React Router route instrumentation
- route normalization

Add unit and Playwright tests.
```

## M6 — Network

```text
Inspect the actual HTTP clients used by the application.

Instrument only those clients.

Capture:

- method
- normalized route
- status
- duration
- request/response size
- trace ID

Never capture:

- Authorization
- Cookie
- request body
- response body
- sensitive query parameters

Add privacy tests.
```

## M7 — Privacy and Sampling

```text
Implement centralized:

sanitizeUrl()
sanitizeHeaders()
sanitizeAttributes()
sanitizeEvent()
shouldSample()

Errors remain 100%.

Make sessions, traces and performance sampling configurable.

No telemetry path may bypass sanitization.

Add exhaustive tests.
```

## M8 — Local Alloy

```text
Create Docker Compose with:

- Alloy
- Loki
- Tempo
- Grafana

Configure stable faro.receiver.

Verify:

React -> Faro -> Alloy -> Loki
React -> OTel/Faro -> Alloy -> Tempo

Do not add Azure Monitor.
Do not add Log Analytics.
```

## M9 — Grafana

```text
Create:

- RUM Overview
- Frontend Errors
- Web Vitals
- Network Performance
- Release Health

Create high-signal alerts.

Avoid high-cardinality dimensions.

Document dashboard queries.
```

## M10 — Validation

```text
Create Playwright tests proving:

- RUM initialization
- page views
- route changes
- JS errors
- React errors
- network telemetry
- traceparent
- Web Vitals
- user context
- tenant context
- logout clearing context
- sensitive-data filtering
- collector outage does not break application

Make tests CI-compatible.
```

---

# 31. Definition of Done

## SDK

- [ ] Internal Nx SDK exists
- [ ] Faro hidden behind SDK
- [ ] OTel hidden behind SDK
- [ ] singleton initialization
- [ ] Strict Mode safe
- [ ] HMR safe
- [ ] vendor types not exposed

## RUM

- [ ] page views
- [ ] route changes
- [ ] JavaScript errors
- [ ] React errors
- [ ] unhandled promise rejection
- [ ] chunk errors
- [ ] Web Vitals
- [ ] network performance
- [ ] sessions
- [ ] release metadata

## Tracing

- [ ] OpenTelemetry Web
- [ ] W3C Trace Context
- [ ] traceparent
- [ ] API origin allowlist
- [ ] third-party propagation blocked
- [ ] duplicate spans prevented
- [ ] future Spring Boot correlation validated conceptually

## Security

- [ ] HTTPS
- [ ] CORS
- [ ] rate limiting
- [ ] payload limits
- [ ] PII filtering
- [ ] secrets filtering
- [ ] protected source maps
- [ ] no credentials in browser

## LGTM

- [ ] Alloy
- [ ] Loki
- [ ] Tempo
- [ ] Grafana
- [ ] RUM dashboard
- [ ] error dashboard
- [ ] performance dashboard
- [ ] release dashboard
- [ ] alerts

## Testing

- [ ] unit tests
- [ ] integration tests
- [ ] Playwright tests
- [ ] privacy tests
- [ ] performance baseline
- [ ] CI validation
- [ ] production runbook

---

# 32. Final Production Architecture

```text
                         USERS
                           |
                           v
                +----------------------+
                | React Nx Application |
                |                      |
                | Faro RUM             |
                | OTel Web SDK         |
                +----------+-----------+
                           |
                       HTTPS/TLS
                           |
                           v
                    Ingress / WAF
                           |
                           v
                    Grafana Alloy
                           |
                +----------+----------+
                |                     |
                v                     v
              Loki                  Tempo
             RUM/Logs              Traces
                |                     |
                +----------+----------+
                           |
                           v
                        Grafana
```

Future:

```text
                    Grafana
                       |
       +---------------+---------------+
       |               |               |
       v               v               v
      Loki            Tempo          Mimir
       ^               ^               ^
       |               |               |
     Alloy           Alloy         Prometheus
       ^               ^               ^
       |               |               |
     React         Spring Boot    K8s/Postgres
     Faro             OTel
```

Azure Monitor/Log Analytics is deliberately **not** in this architecture.

Add it later only if there is a specific need for:

```text
Azure platform logs
Azure Activity Logs
AKS diagnostic logs
security/compliance
Azure resource monitoring
```

That keeps the React RUM platform vendor-focused on **Faro + OpenTelemetry + LGTM**, with a clean path to full backend observability.

---

# 33. Official References

- Grafana Faro React: https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/get-started/instrument-react/
- Grafana Faro React instrumentation: https://grafana.com/docs/grafana-cloud/monitor-applications/frontend-observability/instrument/faro-react/
- Grafana Alloy `faro.receiver`: https://grafana.com/docs/alloy/latest/reference/components/faro/faro.receiver/
- OpenTelemetry JavaScript: https://opentelemetry.io/docs/languages/js/
- OpenTelemetry Browser: https://opentelemetry.io/docs/languages/js/getting-started/browser/
- OpenTelemetry JavaScript instrumentation libraries: https://opentelemetry.io/docs/languages/js/libraries/
