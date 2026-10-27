import { describe, expect, it } from 'vitest';

import { createTestConfig } from '../testing/fixtures';
import { validateConfig } from './validate';

describe('validateConfig', () => {
  it('accepts a complete configuration', () => {
    const { errors } = validateConfig(createTestConfig());
    expect(errors).toEqual([]);
  });

  it('rejects missing app metadata', () => {
    const config = createTestConfig();
    config.app = { ...config.app, name: '', version: '', environment: '' };
    const { errors } = validateConfig(config);
    expect(errors).toContain('app.name is required');
    expect(errors).toContain('app.version is required');
    expect(errors).toContain('app.environment is required');
  });

  it('rejects a missing or malformed collector URL', () => {
    const missing = validateConfig(createTestConfig({ collector: { faroUrl: '' } }));
    expect(missing.errors).toContain('collector.faroUrl is required');

    const malformed = validateConfig(createTestConfig({ collector: { faroUrl: 'not a url' } }));
    expect(malformed.errors.some((e) => e.includes('not a valid URL'))).toBe(true);
  });

  it('rejects a missing allowedOrigins array', () => {
    const config = createTestConfig();
    // @ts-expect-error deliberately broken input
    config.tracePropagation = {};
    const { errors } = validateConfig(config);
    expect(errors).toContain('tracePropagation.allowedOrigins must be an array of RegExp');
  });

  it('clamps sampling rates into [0, 1] and defaults invalid values to 1', () => {
    const config = createTestConfig({
      sampling: { sessions: 5, traces: -1, performance: Number.NaN, events: 0.5 },
    });
    const { normalized } = validateConfig(config);
    expect(normalized.sampling).toEqual({ sessions: 1, traces: 0, performance: 1, events: 0.5 });
  });
});
