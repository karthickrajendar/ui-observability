/**
 * @company/frontend-observability
 *
 * The single entry point for all frontend telemetry. Application code must
 * import from this package only; Grafana Faro and OpenTelemetry are
 * implementation details that never leak through this API.
 */

export type {
  ActiveTraceContext,
  AppMetadata,
  Breadcrumb,
  BreadcrumbCategory,
  CaptureContext,
  CollectorConfig,
  FeatureFlags,
  MeasurementValues,
  ObservabilityConfig,
  ObservabilityStatus,
  PrivacyConfig,
  SamplingConfig,
  SpanAttributes,
  SpanHandle,
  TenantContext,
  TracePropagationConfig,
  TracerHandle,
  UserContext,
} from './lib/config/types';

export {
  addBreadcrumb,
  captureError,
  captureEvent,
  captureMeasurement,
  captureMessage,
  clearBreadcrumbs,
  clearTenantContext,
  clearUserContext,
  getBreadcrumbs,
  getObservability,
  initializeObservability,
  setTelemetryConsent,
  setTenantContext,
  setUserContext,
  setView,
  shutdownObservability,
} from './lib/core/api';

export { getActiveTraceContext, getTracer, startSpan, withSpan } from './lib/core/tracing';

export {
  ObservabilityErrorBoundary,
  type ObservabilityErrorBoundaryProps,
} from './lib/errors/error-boundary';

export { ObservableRoutes, type ObservableRoutesProps } from './lib/rum/observable-routes';

export { normalizeRoute } from './lib/rum/routes';
export { sanitizeUrl } from './lib/privacy/sanitize';
