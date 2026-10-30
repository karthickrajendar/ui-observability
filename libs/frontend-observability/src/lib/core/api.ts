import { LogLevel } from '@grafana/faro-web-sdk';

import type {
  Breadcrumb,
  CaptureContext,
  MeasurementValues,
  ObservabilityConfig,
  ObservabilityStatus,
  TenantContext,
  UserContext,
} from '../config/types';
import { validateConfig } from '../config/validate';
import { installChunkErrorCapture } from '../errors/chunk-errors';
import { createFaroInstance } from '../faro/init';
import { sanitizeAttributes, scrubText } from '../privacy/sanitize';
import { buildRelease } from '../release/release';
import { getBrowserContextAttributes, installRumObservers } from '../rum/observers';
import { normalizeRoute } from '../rum/routes';
import { shouldSample } from '../sampling/sampling';
import { getState } from './state';
import { getActiveTraceContext } from './tracing';

const TENANT_ATTRIBUTE = 'tenant_id';
const MAX_BREADCRUMBS = 20;

function debugWarn(message: string, detail?: unknown): void {
  console.warn(`[frontend-observability] ${message}`, detail ?? '');
}

function getAllowQueryParameters(): boolean {
  return getState().config?.privacy.allowQueryParameters ?? false;
}

function canEmitTelemetry(): boolean {
  const state = getState();
  return state.status === 'initialized' && state.faro !== null && state.consentGranted;
}

/**
 * Initializes the observability SDK. Idempotent, non-blocking, and safe:
 * it never throws, never blocks rendering, and is a no-op when called twice
 * (React Strict Mode, HMR, duplicate bundles).
 */
export function initializeObservability(config: ObservabilityConfig): void {
  const state = getState();
  if (state.status === 'initialized') {
    return;
  }

  try {
    const { errors, normalized } = validateConfig(config);
    if (errors.length > 0) {
      state.status = 'disabled';
      debugWarn(`invalid configuration, telemetry disabled: ${errors.join('; ')}`);
      return;
    }

    state.faro = createFaroInstance(normalized);
    state.config = normalized;
    state.consentGranted = true;
    state.status = 'initialized';

    if (normalized.features.errors) {
      installChunkErrorCapture();
    }

    if (normalized.features.rum || normalized.features.webVitals) {
      installRumObservers({
        onLongTask: (durationMs, route) => {
          if (getState().config?.features.webVitals) {
            captureMeasurement('longtask', { duration_ms: durationMs }, { attributes: { route } });
          }
        },
        onRageClick: (targetDescriptor, clickCount, route) => {
          addBreadcrumb({
            category: 'ui',
            message: `Rage click on ${targetDescriptor}`,
            attributes: { click_count: String(clickCount), route },
          });
          if (getState().config?.features.rum) {
            captureEvent('rage_click', {
              target: targetDescriptor,
              click_count: String(clickCount),
              route,
            });
          }
        },
      });
    }
  } catch (error) {
    state.status = 'disabled';
    state.faro = null;
    debugWarn('initialization failed, telemetry disabled', error);
  }
}

/** Pauses telemetry delivery and forgets the instance. Never throws. */
export function shutdownObservability(): void {
  const state = getState();
  try {
    state.faro?.pause();
  } catch {
    // Telemetry must never break the application.
  }
  state.faro = null;
  state.config = null;
  state.breadcrumbs = [];
  state.consentGranted = true;
  state.status = 'uninitialized';
}

/**
 * Dynamically grants or revokes telemetry consent at runtime (e.g. GDPR banner).
 * When revoked, Faro transport is paused and user/tenant/breadcrumb state is cleared.
 */
export function setTelemetryConsent(granted: boolean): void {
  const state = getState();
  state.consentGranted = Boolean(granted);
  if (state.status !== 'initialized' || !state.faro) {
    return;
  }
  try {
    if (state.consentGranted) {
      state.faro.unpause?.();
    } else {
      clearUserContext();
      clearTenantContext();
      clearBreadcrumbs();
      state.faro.pause();
    }
  } catch (error) {
    debugWarn('setTelemetryConsent failed', error);
  }
}

/** Vendor-neutral snapshot of the SDK state. */
export function getObservability(): ObservabilityStatus {
  const state = getState();
  if (state.status !== 'initialized' || !state.config) {
    return { initialized: false };
  }
  return {
    initialized: true,
    consentGranted: state.consentGranted,
    appName: state.config.app.name,
    environment: state.config.app.environment,
    release: buildRelease(state.config.app),
  };
}

/**
 * Records a sanitized breadcrumb in the bounded in-memory ring buffer.
 * Recent breadcrumbs are automatically attached to subsequent `captureError` reports.
 */
export function addBreadcrumb(breadcrumb: Breadcrumb): void {
  const state = getState();
  if (state.status !== 'initialized' || !state.consentGranted) {
    return;
  }
  const allowQuery = getAllowQueryParameters();
  const entry: Breadcrumb = {
    category: breadcrumb.category,
    message: scrubText(breadcrumb.message),
    attributes: breadcrumb.attributes
      ? sanitizeAttributes(breadcrumb.attributes, allowQuery)
      : undefined,
    timestamp: breadcrumb.timestamp ?? Date.now(),
  };
  state.breadcrumbs.push(entry);
  if (state.breadcrumbs.length > MAX_BREADCRUMBS) {
    state.breadcrumbs.splice(0, state.breadcrumbs.length - MAX_BREADCRUMBS);
  }
}

/** Returns a shallow copy of the current breadcrumb trail. */
export function getBreadcrumbs(): ReadonlyArray<Breadcrumb> {
  return [...getState().breadcrumbs];
}

/** Clears the in-memory breadcrumb trail. */
export function clearBreadcrumbs(): void {
  getState().breadcrumbs = [];
}

/**
 * Sets the logical view name for RUM segmentation (normalized to low cardinality).
 * Useful for modals, multi-step wizards, or micro-frontends without URL route changes.
 */
export function setView(name: string): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro || !state.config?.features.rum) {
    return;
  }
  const normalizedView = normalizeRoute(scrubText(name));
  try {
    state.faro.api.setView({ name: normalizedView });
    addBreadcrumb({ category: 'navigation', message: `view:${normalizedView}` });
  } catch (error) {
    debugWarn('setView failed', error);
  }
}


export function setUserContext(user: UserContext): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro || !state.config) {
    return;
  }
  if (!state.config.privacy.collectUserId) {
    if (state.config.debug) {
      debugWarn('setUserContext ignored: privacy.collectUserId is false');
    }
    return;
  }
  try {
    state.faro.api.setUser({
      id: user.id,
      attributes: sanitizeAttributes(user.attributes, getAllowQueryParameters()),
    });
  } catch (error) {
    debugWarn('setUserContext failed', error);
  }
}

export function clearUserContext(): void {
  const state = getState();
  try {
    state.faro?.api.resetUser();
  } catch (error) {
    debugWarn('clearUserContext failed', error);
  }
}

export function setTenantContext(tenant: TenantContext): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro || !state.config) {
    return;
  }
  if (!state.config.privacy.collectTenantId) {
    if (state.config.debug) {
      debugWarn('setTenantContext ignored: privacy.collectTenantId is false');
    }
    return;
  }
  try {
    const session = state.faro.api.getSession();
    state.faro.api.setSession({
      ...session,
      attributes: { ...session?.attributes, [TENANT_ATTRIBUTE]: tenant.id },
    });
  } catch (error) {
    debugWarn('setTenantContext failed', error);
  }
}

export function clearTenantContext(): void {
  const state = getState();
  try {
    const session = state.faro?.api.getSession();
    if (!session?.attributes?.[TENANT_ATTRIBUTE]) {
      return;
    }
    const attributes = { ...session.attributes };
    delete attributes[TENANT_ATTRIBUTE];
    state.faro?.api.setSession({ ...session, attributes });
  } catch (error) {
    debugWarn('clearTenantContext failed', error);
  }
}

function toError(candidate: unknown): Error {
  if (candidate instanceof Error) {
    return candidate;
  }
  return new Error(typeof candidate === 'string' ? candidate : JSON.stringify(candidate));
}

function formatRecentBreadcrumbs(breadcrumbs: ReadonlyArray<Breadcrumb>): string | undefined {
  if (breadcrumbs.length === 0) {
    return undefined;
  }
  return breadcrumbs
    .slice(-10)
    .map((b) => `[${b.category}] ${b.message}`)
    .join(' -> ');
}

/** Captures an error. Errors are never sampled away. */
export function captureError(error: unknown, context?: CaptureContext): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro) {
    return;
  }
  try {
    const allowQuery = getAllowQueryParameters();
    const trail = formatRecentBreadcrumbs(state.breadcrumbs);
    const activeTrace = getActiveTraceContext();
    const mergedAttributes: Record<string, unknown> = {
      ...getBrowserContextAttributes(),
      ...(trail ? { breadcrumbs: trail } : {}),
      ...context?.attributes,
      // The pinned Alloy receiver can omit native exception trace fields.
      // Mirror correlation IDs into sanitized context, never indexed labels.
      ...(activeTrace ? { trace_id: activeTrace.traceId, span_id: activeTrace.spanId } : {}),
    };
    state.faro.api.pushError(toError(error), {
      context: sanitizeAttributes(mergedAttributes, allowQuery),
      ...(activeTrace ? { spanContext: { traceId: activeTrace.traceId, spanId: activeTrace.spanId } } : {}),
    });
  } catch (pushFailure) {
    debugWarn('captureError failed', pushFailure);
  }
}

export function captureMessage(
  message: string,
  options?: CaptureContext & { level?: 'info' | 'warn' | 'error' }
): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro) {
    return;
  }
  try {
    const level = options?.level
      ? { level: { info: LogLevel.INFO, warn: LogLevel.WARN, error: LogLevel.ERROR }[options.level] }
      : {};
    state.faro.api.pushLog([scrubText(message)], {
      context: sanitizeAttributes(options?.attributes, getAllowQueryParameters()),
      ...level,
    });
  } catch (error) {
    debugWarn('captureMessage failed', error);
  }
}

/** Captures a custom RUM event, subject to the configured event sampling rate. */
export function captureEvent(name: string, attributes?: Record<string, string>): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro || !state.config) {
    return;
  }
  if (!state.config.features.customEvents) {
    return;
  }
  if (!shouldSample(state.config.sampling.events)) {
    return;
  }
  try {
    const sanitized = sanitizeAttributes(attributes, getAllowQueryParameters());
    addBreadcrumb({ category: 'custom', message: name, attributes: sanitized });
    state.faro.api.pushEvent(name, sanitized);
  } catch (error) {
    debugWarn('captureEvent failed', error);
  }
}

/**
 * Captures a custom performance measurement (e.g. feature render duration or hydration SLI).
 * Only finite numeric values are forwarded.
 */
export function captureMeasurement(
  type: string,
  values: MeasurementValues,
  context?: CaptureContext
): void {
  const state = getState();
  if (!canEmitTelemetry() || !state.faro || !state.config) {
    return;
  }
  if (!state.config.features.webVitals && !state.config.features.rum) {
    return;
  }
  const cleanValues: MeasurementValues = {};
  for (const [key, val] of Object.entries(values ?? {})) {
    if (typeof val === 'number' && Number.isFinite(val)) {
      cleanValues[key] = val;
    }
  }
  if (Object.keys(cleanValues).length === 0) {
    return;
  }
  try {
    const sanitizedContext = sanitizeAttributes(
      {
        ...getBrowserContextAttributes(),
        ...context?.attributes,
      },
      getAllowQueryParameters()
    );
    state.faro.api.pushMeasurement(
      {
        type: scrubText(type),
        values: cleanValues,
        context: sanitizedContext,
      },
      { context: sanitizedContext }
    );
  } catch (error) {
    debugWarn('captureMeasurement failed', error);
  }
}

