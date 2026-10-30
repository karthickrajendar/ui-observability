# Frontend Telemetry Privacy Model

Browser telemetry is untrusted input and a data-exfiltration risk. This document defines
what the observability pipeline may and may not collect, and where each control lives.

## Never collected

The following must never leave the browser via telemetry:

- passwords, form values
- access / refresh / ID tokens, JWT contents
- `Authorization`, `Proxy-Authorization`, `Cookie`, `Set-Cookie`, API-key headers
- request bodies and response bodies
- credit card or bank account data, secrets of any kind

Enforced centrally in `libs/frontend-observability/src/lib/privacy/`:

- Fetch/XHR instrumentation records metadata only (method, URL, status, timing) - never
  bodies or headers.
- `sanitizeHeaders()` redacts sensitive headers if any code path ever forwards them.
- `scrubText()` strips JWTs and bearer tokens embedded in error messages and log lines.

## URL sanitization

Every URL in telemetry (page URLs, span `url.full` / `http.url` attributes) passes through
`sanitizeUrl()`:

- `privacy.allowQueryParameters: false` (default): the entire query string is removed.
- `privacy.allowQueryParameters: true`: parameters matching the sensitive-key pattern
  (`token`, `code`, `email`, `password`, `authorization`, `account`, `customer`,
  `session`, `secret`, `key`, ...) are replaced with `[REDACTED]`.
- Hash fragments and embedded credentials are always removed.
- Unparseable URLs fail closed: the query is dropped entirely.

## Route normalization

Dashboards and telemetry use route templates, never raw paths:

```text
/customer/123456/orders/987654  ->  /customer/:id/orders/:id
```

Router instrumentation reports React Router templates (`/orders/:orderId`);
`normalizeRoute()` covers manual reporting.

## The single sanitization gate

All telemetry (logs, errors, events, measurements, traces) flows through one Faro
`beforeSend` hook (`privacy/before-send.ts`). It sanitizes page URLs, exception messages
and contexts, event attributes, and trace resource/span/event/link attributes. Manual
span attributes and recorded exception messages are sanitized before being passed to
OpenTelemetry as well. If sanitization itself throws, the item is dropped - fail closed,
never leak.

## Identity

- `user.id` and `tenant.id` are opaque identifiers, collected only when
  `privacy.collectUserId` / `privacy.collectTenantId` are enabled.
- Context is cleared on logout / tenant switch (`clearUserContext`,
  `clearTenantContext`); the demo app demonstrates the pattern.
- Identity values are never used as metric or log labels (cardinality and privacy).

## Ingestion boundary (Alloy)

`observability/docker/alloy/config.alloy` treats the Faro receiver as a security boundary
even locally:

- CORS allowlist pinned to the application origin - never `*`
- 1 MiB payload limit
- rate limiting (100 req/s, burst 200)

Production adds HTTPS/WAF termination in front of Alloy and API-key validation.

## Verification

Privacy behavior is proven by unit tests in
`libs/frontend-observability/src/lib/privacy/*.spec.ts`:

- passwords / JWTs / Authorization / Cookie values never pass sanitization
- sensitive query parameters are redacted; full query removal by default
- measurement and trace sampling cannot bypass the sanitization gate

New telemetry attributes require a privacy review before shipping.

The dashboard adds the existing, non-personal release identifier as the
`app.release` trace resource attribute so RUM and trace release filters agree.
It uses the same release builder as Faro metadata and passes through the existing
trace sanitization gate. It adds no user fields, request bodies, or identity labels.

Captured errors also retain existing active trace/span IDs in sanitized context for
compatibility with the pinned receiver. These correlation fields are not indexed labels.
