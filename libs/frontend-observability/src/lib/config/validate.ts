import type { ObservabilityConfig, SamplingConfig } from './types';

export interface ValidationResult {
  errors: string[];
  normalized: ObservabilityConfig;
}

function clampRate(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function normalizeSampling(sampling: SamplingConfig | undefined): SamplingConfig {
  return {
    sessions: clampRate(sampling?.sessions, 1),
    traces: clampRate(sampling?.traces, 1),
    performance: clampRate(sampling?.performance, 1),
    events: clampRate(sampling?.events, 1),
  };
}

/**
 * Validates and normalizes the configuration.
 * Returns a list of errors; when non-empty the SDK must stay disabled.
 */
export function validateConfig(config: ObservabilityConfig): ValidationResult {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return {
      errors: ['configuration object is required'],
      normalized: config,
    };
  }

  if (!config.app?.name) {
    errors.push('app.name is required');
  }
  if (!config.app?.version) {
    errors.push('app.version is required');
  }
  if (!config.app?.environment) {
    errors.push('app.environment is required');
  }

  if (!config.collector?.faroUrl) {
    errors.push('collector.faroUrl is required');
  } else {
    try {
      new URL(config.collector.faroUrl);
    } catch {
      errors.push(`collector.faroUrl is not a valid URL: ${config.collector.faroUrl}`);
    }
  }

  if (!config.features) {
    errors.push('features is required');
  }
  if (!config.privacy) {
    errors.push('privacy is required');
  }
  if (!Array.isArray(config.tracePropagation?.allowedOrigins)) {
    errors.push('tracePropagation.allowedOrigins must be an array of RegExp');
  }

  const normalized: ObservabilityConfig = {
    ...config,
    sampling: normalizeSampling(config.sampling),
  };

  return { errors, normalized };
}
