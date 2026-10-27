import { initializeObservability } from '@company/frontend-observability';

/**
 * Bootstraps telemetry from environment configuration.
 * Never hardcode collector endpoints; see apps/demo-app/.env.
 */
export function setupObservability(): void {
  initializeObservability({
    app: {
      name: import.meta.env.VITE_APP_NAME ?? 'demo-app',
      version: import.meta.env.VITE_APP_VERSION ?? '0.0.0',
      environment: import.meta.env.VITE_APP_ENVIRONMENT ?? import.meta.env.MODE,
      commitSha: import.meta.env.VITE_COMMIT_SHA,
    },
    collector: {
      faroUrl: import.meta.env.VITE_FARO_COLLECTOR_URL ?? '',
    },
    features: {
      rum: true,
      errors: true,
      tracing: true,
      network: true,
      webVitals: true,
      customEvents: true,
    },
    sampling: {
      // Local development: capture everything. Production would use 0.1-0.25.
      sessions: 1,
      traces: 1,
      performance: 1,
      events: 1,
    },
    privacy: {
      collectUserId: true,
      collectTenantId: true,
      allowQueryParameters: false,
    },
    tracePropagation: {
      // First-party origins only; traceparent is never sent to third parties.
      allowedOrigins: [/^http:\/\/localhost(:\d+)?/],
    },
    debug: import.meta.env.DEV,
  });
}
