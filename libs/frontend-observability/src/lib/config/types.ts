/**
 * Public configuration contract for @company/frontend-observability.
 *
 * No vendor (Faro / OpenTelemetry) types may appear in this file.
 */

export interface AppMetadata {
  name: string;
  version: string;
  environment: string;
  /** Full release identifier, e.g. "customer-portal@2026.08.18+abc1234". Derived if omitted. */
  release?: string;
  commitSha?: string;
}

export interface CollectorConfig {
  /** Faro receiver endpoint of Grafana Alloy, e.g. http://localhost:12347/collect */
  faroUrl: string;
}

export interface FeatureFlags {
  rum: boolean;
  errors: boolean;
  tracing: boolean;
  network: boolean;
  webVitals: boolean;
  customEvents: boolean;
}

/** All rates are in the range [0, 1]. Errors are always captured at 100%. */
export interface SamplingConfig {
  sessions: number;
  traces: number;
  performance: number;
  events: number;
}

export interface PrivacyConfig {
  collectUserId: boolean;
  collectTenantId: boolean;
  /**
   * When false, query strings are stripped entirely from telemetry URLs.
   * When true, only the sensitive parameters are redacted.
   */
  allowQueryParameters: boolean;
}

export interface TracePropagationConfig {
  /** First-party origins that may receive the W3C traceparent header. Never use a catch-all. */
  allowedOrigins: RegExp[];
}

export interface ObservabilityConfig {
  app: AppMetadata;
  collector: CollectorConfig;
  features: FeatureFlags;
  sampling: SamplingConfig;
  privacy: PrivacyConfig;
  tracePropagation: TracePropagationConfig;
  debug?: boolean;
}

export interface UserContext {
  /** Opaque, non-PII user identifier. */
  id: string;
  attributes?: Record<string, string>;
}

export interface TenantContext {
  id: string;
}

export interface CaptureContext {
  attributes?: Record<string, string>;
}

export type BreadcrumbCategory = 'navigation' | 'ui' | 'network' | 'user' | 'console' | 'custom';

export interface Breadcrumb {
  category: BreadcrumbCategory;
  message: string;
  attributes?: Record<string, string>;
  timestamp?: number;
}

export type MeasurementValues = Record<string, number>;

export type SpanAttributes = Record<string, string | number | boolean>;

export interface SpanHandle {
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface TracerHandle {
  startSpan(name: string, attributes?: SpanAttributes): SpanHandle;
}

/** Vendor-neutral snapshot of the currently active W3C trace context. */
export interface ActiveTraceContext {
  traceId: string;
  spanId: string;
  traceparent: string;
}

/** Vendor-neutral snapshot of the SDK state. */

export interface ObservabilityStatus {
  initialized: boolean;
  consentGranted?: boolean;
  appName?: string;
  environment?: string;
  release?: string;
}

