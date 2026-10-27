import type { ObservabilityConfig } from '../config/types';

export function createTestConfig(overrides: Partial<ObservabilityConfig> = {}): ObservabilityConfig {
  return {
    app: {
      name: 'test-app',
      version: '1.0.0',
      environment: 'test',
      commitSha: 'abc1234def',
    },
    collector: { faroUrl: 'http://localhost:12347/collect' },
    features: {
      rum: true,
      errors: true,
      tracing: true,
      network: true,
      webVitals: true,
      customEvents: true,
    },
    sampling: { sessions: 1, traces: 1, performance: 1, events: 1 },
    privacy: {
      collectUserId: true,
      collectTenantId: true,
      allowQueryParameters: false,
    },
    tracePropagation: { allowedOrigins: [/^http:\/\/localhost/] },
    ...overrides,
  };
}
