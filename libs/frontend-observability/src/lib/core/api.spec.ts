import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogLevel } from '@grafana/faro-web-sdk';

import { createTestConfig } from '../testing/fixtures';
import {
  addBreadcrumb,
  captureError,
  captureEvent,
  captureMeasurement,
  captureMessage,
  clearBreadcrumbs,
  clearTenantContext,
  getBreadcrumbs,
  getObservability,
  initializeObservability,
  setTelemetryConsent,
  setTenantContext,
  setUserContext,
  setView,
  shutdownObservability,
} from './api';
import { resetStateForTesting } from './state';

const mocks = vi.hoisted(() => {
  const api = {
    setUser: vi.fn(),
    resetUser: vi.fn(),
    setSession: vi.fn(),
    getSession: vi.fn(() => ({ id: 'session-1', attributes: {} as Record<string, string> })),
    setView: vi.fn(),
    pushError: vi.fn(),
    pushLog: vi.fn(),
    pushEvent: vi.fn(),
    pushMeasurement: vi.fn(),
    getOTEL: vi.fn(() => undefined),
  };
  const faro = { api, pause: vi.fn(), unpause: vi.fn() };
  return { api, faro, createFaroInstance: vi.fn(() => faro) };
});


vi.mock('../faro/init', () => ({
  createFaroInstance: mocks.createFaroInstance,
}));

describe('core api', () => {
  beforeEach(() => {
    resetStateForTesting();
    vi.clearAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes exactly once even when called repeatedly (Strict Mode / HMR)', () => {
    const config = createTestConfig();
    initializeObservability(config);
    initializeObservability(config);
    initializeObservability(config);
    expect(mocks.createFaroInstance).toHaveBeenCalledTimes(1);
    expect(getObservability().initialized).toBe(true);
  });

  it('stays disabled and never throws on invalid configuration', () => {
    const config = createTestConfig({ collector: { faroUrl: '' } });
    expect(() => initializeObservability(config)).not.toThrow();
    expect(getObservability().initialized).toBe(false);
    expect(mocks.createFaroInstance).not.toHaveBeenCalled();

    // All capture calls must be safe no-ops in the disabled state.
    expect(() => {
      captureError(new Error('x'));
      captureMessage('y');
      captureEvent('z');
      setUserContext({ id: 'u1' });
      setTenantContext({ id: 't1' });
    }).not.toThrow();
    expect(mocks.api.pushError).not.toHaveBeenCalled();
  });

  it('stays disabled and never throws when Faro initialization fails', () => {
    mocks.createFaroInstance.mockImplementationOnce(() => {
      throw new Error('collector unreachable');
    });
    expect(() => initializeObservability(createTestConfig())).not.toThrow();
    expect(getObservability().initialized).toBe(false);
  });

  it('reports errors with sanitized context', () => {
    initializeObservability(createTestConfig());
    captureError(new Error('boom'), { attributes: { password: 'x', route: '/a' } });
    expect(mocks.api.pushError).toHaveBeenCalledTimes(1);
    const [error, options] = mocks.api.pushError.mock.calls[0];
    expect(error).toBeInstanceOf(Error);
    expect(options.context['password']).toBe('[REDACTED]');
    expect(options.context['route']).toBe('/a');
  });

  it('wraps non-Error values before reporting', () => {
    initializeObservability(createTestConfig());
    captureError('string failure');
    expect(mocks.api.pushError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('maps captureMessage levels to Faro and preserves the default level', () => {
    initializeObservability(createTestConfig());
    captureMessage('info message', { level: 'info' });
    expect(mocks.api.pushLog).toHaveBeenLastCalledWith(['info message'], {
      context: {},
      level: LogLevel.INFO,
    });

    captureMessage('warning message', { level: 'warn' });
    expect(mocks.api.pushLog).toHaveBeenLastCalledWith(['warning message'], {
      context: {},
      level: LogLevel.WARN,
    });

    captureMessage('error message', { level: 'error' });
    expect(mocks.api.pushLog).toHaveBeenLastCalledWith(['error message'], {
      context: {},
      level: LogLevel.ERROR,
    });

    captureMessage('default message');
    expect(mocks.api.pushLog).toHaveBeenLastCalledWith(['default message'], { context: {} });
  });

  it('honors the customEvents feature flag and event sampling', () => {
    initializeObservability(
      createTestConfig({
        features: {
          rum: true,
          errors: true,
          tracing: true,
          network: true,
          webVitals: true,
          customEvents: false,
        },
      })
    );
    captureEvent('clicked');
    expect(mocks.api.pushEvent).not.toHaveBeenCalled();

    resetStateForTesting();
    initializeObservability(
      createTestConfig({ sampling: { sessions: 1, traces: 1, performance: 1, events: 0 } })
    );
    captureEvent('clicked');
    expect(mocks.api.pushEvent).not.toHaveBeenCalled();

    resetStateForTesting();
    initializeObservability(createTestConfig());
    captureEvent('clicked', { step: '1' });
    expect(mocks.api.pushEvent).toHaveBeenCalledWith('clicked', { step: '1' });
  });

  it('ignores user context when privacy forbids it', () => {
    initializeObservability(
      createTestConfig({
        privacy: { collectUserId: false, collectTenantId: false, allowQueryParameters: false },
      })
    );
    setUserContext({ id: 'user-1' });
    setTenantContext({ id: 'tenant-1' });
    expect(mocks.api.setUser).not.toHaveBeenCalled();
    expect(mocks.api.setSession).not.toHaveBeenCalled();
  });

  it('sets and clears the tenant context via session attributes', () => {
    initializeObservability(createTestConfig());
    setTenantContext({ id: 'tenant-1' });
    expect(mocks.api.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: expect.objectContaining({ tenant_id: 'tenant-1' }) })
    );

    mocks.api.getSession.mockReturnValueOnce({
      id: 'session-1',
      attributes: { tenant_id: 'tenant-1', other: 'kept' },
    });
    clearTenantContext();
    const lastCall = mocks.api.setSession.mock.calls.at(-1)?.[0];
    expect(lastCall.attributes).toEqual({ other: 'kept' });
  });

  it('sets sanitized user context when allowed', () => {
    initializeObservability(createTestConfig());
    setUserContext({ id: 'user-1', attributes: { plan: 'pro', email: 'a@b.c' } });
    expect(mocks.api.setUser).toHaveBeenCalledWith({
      id: 'user-1',
      attributes: { plan: 'pro', email: '[REDACTED]' },
    });
  });

  it('shutdown pauses the transport and allows re-initialization', () => {
    initializeObservability(createTestConfig());
    shutdownObservability();
    expect(mocks.faro.pause).toHaveBeenCalledTimes(1);
    expect(getObservability().initialized).toBe(false);

    initializeObservability(createTestConfig());
    expect(mocks.createFaroInstance).toHaveBeenCalledTimes(2);
  });

  it('records sanitized breadcrumbs and attaches recent trail to captureError', () => {
    initializeObservability(createTestConfig());
    addBreadcrumb({
      category: 'navigation',
      message: 'Navigated to /orders',
      attributes: { token: 'secret' },
    });
    addBreadcrumb({
      category: 'ui',
      message: 'Clicked checkout with Bearer secret-jwt',
    });

    const trail = getBreadcrumbs();
    expect(trail).toHaveLength(2);
    expect(trail[0].attributes?.['token']).toBe('[REDACTED]');
    expect(trail[1].message).toContain('[REDACTED]');

    captureError(new Error('checkout failed'));
    const [, options] = mocks.api.pushError.mock.calls[0];
    expect(options.context['breadcrumbs']).toContain('[navigation] Navigated to /orders');
    expect(options.context['breadcrumbs']).toContain('[ui] Clicked checkout with [REDACTED]');
    expect(options.context['online']).toBeDefined();

    clearBreadcrumbs();
    expect(getBreadcrumbs()).toHaveLength(0);
  });

  it('reports custom measurements with sanitized context and ignores non-finite values', () => {
    initializeObservability(createTestConfig());
    captureMeasurement(
      'checkout_hydration',
      { duration_ms: 142.5, invalid: Number.NaN },
      { attributes: { step: 'payment', api_key: 'k-123' } }
    );
    expect(mocks.api.pushMeasurement).toHaveBeenCalledTimes(1);
    const [payload] = mocks.api.pushMeasurement.mock.calls[0];
    expect(payload.type).toBe('checkout_hydration');
    expect(payload.values).toEqual({ duration_ms: 142.5 });
    expect(payload.context['step']).toBe('payment');
    expect(payload.context['api_key']).toBe('[REDACTED]');
  });

  it('normalizes view names passed to setView and records a navigation breadcrumb', () => {
    initializeObservability(createTestConfig());
    setView('/customers/987654/billing');
    expect(mocks.api.setView).toHaveBeenCalledWith({ name: '/customers/:id/billing' });
    expect(getBreadcrumbs().at(-1)?.message).toBe('view:/customers/:id/billing');
  });

  it('pauses telemetry, clears identity, and suppresses signals when consent is revoked', () => {
    initializeObservability(createTestConfig());
    setTelemetryConsent(false);
    expect(mocks.faro.pause).toHaveBeenCalledTimes(1);
    expect(mocks.api.resetUser).toHaveBeenCalledTimes(1);
    expect(getObservability().consentGranted).toBe(false);

    captureError(new Error('ignored while revoked'));
    captureEvent('ignored_event');
    expect(mocks.api.pushError).not.toHaveBeenCalled();
    expect(mocks.api.pushEvent).not.toHaveBeenCalled();

    setTelemetryConsent(true);
    expect(mocks.faro.unpause).toHaveBeenCalledTimes(1);
    expect(getObservability().consentGranted).toBe(true);
  });
});

