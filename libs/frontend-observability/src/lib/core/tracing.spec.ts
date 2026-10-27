import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REDACTED } from '../privacy/sanitize';
import { createTestConfig } from '../testing/fixtures';
import { initializeObservability } from './api';
import { resetStateForTesting } from './state';
import { startSpan } from './tracing';

const mocks = vi.hoisted(() => {
  const span = {
    setAttribute: vi.fn(),
    recordException: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  };
  const tracer = {
    startSpan: vi.fn(() => span),
  };
  const api = {
    getOTEL: vi.fn(() => ({ trace: { getTracer: vi.fn(() => tracer) } })),
  };
  const faro = { api };
  return { api, faro, span, tracer, createFaroInstance: vi.fn(() => faro) };
});

vi.mock('../faro/init', () => ({
  createFaroInstance: mocks.createFaroInstance,
}));

describe('tracing API', () => {
  beforeEach(() => {
    resetStateForTesting();
    vi.clearAllMocks();
  });

  it('sanitizes span attributes, updates, and recorded exceptions', () => {
    initializeObservability(createTestConfig());
    const span = startSpan('checkout.submit', {
      password: 'secret',
      request_url: 'https://api.example.com/orders?token=secret',
      count: 2,
      enabled: true,
    });

    expect(mocks.tracer.startSpan).toHaveBeenCalledWith('checkout.submit', {
      attributes: {
        password: REDACTED,
        request_url: 'https://api.example.com/orders',
        count: 2,
        enabled: true,
      },
    });

    span.setAttribute('access_token', 'secret');
    expect(mocks.span.setAttribute).toHaveBeenCalledWith('access_token', REDACTED);

    span.recordError(new Error('request failed with Bearer secret-token'));
    const recordedError = mocks.span.recordException.mock.calls[0][0] as Error;
    expect(recordedError.message).not.toContain('secret-token');
    expect(recordedError.message).toContain(REDACTED);
  });
});
