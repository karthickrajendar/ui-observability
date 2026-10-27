import type { ActiveTraceContext, SpanAttributes, SpanHandle, TracerHandle } from '../config/types';
import { sanitizeAttributeString, sanitizeSpanAttributes } from '../privacy/sanitize';
import { getState } from './state';


const TRACER_NAME = '@company/frontend-observability';

const NOOP_SPAN: SpanHandle = {
  setAttribute: () => undefined,
  recordError: () => undefined,
  end: () => undefined,
};

/**
 * Internal accessor for the OTel API owned by the Faro TracingInstrumentation.
 * OTel types never leave this module.
 */
function getOtel() {
  const state = getState();
  if (state.status !== 'initialized' || !state.faro || !state.config?.features.tracing) {
    return undefined;
  }
  try {
    return state.faro.api.getOTEL();
  } catch {
    return undefined;
  }
}

function getAllowQueryParameters(): boolean {
  return getState().config?.privacy.allowQueryParameters ?? false;
}

function toSanitizedError(candidate: unknown): Error {
  const error = candidate instanceof Error ? candidate : new Error(String(candidate));
  const allowQueryParameters = getAllowQueryParameters();
  const sanitized = new Error(
    sanitizeAttributeString('exception.message', error.message, allowQueryParameters)
  );
  sanitized.name = sanitizeAttributeString('exception.type', error.name, allowQueryParameters);
  if (error.stack) {
    sanitized.stack = sanitizeAttributeString('exception.stacktrace', error.stack, allowQueryParameters);
  }
  return sanitized;
}

/**
 * Returns the currently active W3C trace context (traceId, spanId, traceparent)
 * when called inside `withSpan` or an instrumented operation, or undefined if
 * no valid span is active. Useful for surfacing a support correlation ID in UI.
 */
export function getActiveTraceContext(): ActiveTraceContext | undefined {
  const state = getState();
  if (state.status !== 'initialized' || !state.faro || !state.config?.features.tracing) {
    return undefined;
  }
  try {
    const faroTraceCtx = state.faro.api.getTraceContext?.();
    if (faroTraceCtx?.trace_id && faroTraceCtx?.span_id) {
      return {
        traceId: faroTraceCtx.trace_id,
        spanId: faroTraceCtx.span_id,
        traceparent: `00-${faroTraceCtx.trace_id}-${faroTraceCtx.span_id}-01`,
      };
    }
    const otel = getOtel();
    const activeSpan = otel?.trace.getSpan(otel.context.active());
    const spanCtx = activeSpan?.spanContext();
    if (spanCtx?.traceId && spanCtx?.spanId) {
      const flags = typeof spanCtx.traceFlags === 'number' ? spanCtx.traceFlags : 1;
      const hexFlags = flags.toString(16).padStart(2, '0');
      return {
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        traceparent: `00-${spanCtx.traceId}-${spanCtx.spanId}-${hexFlags}`,
      };
    }
  } catch {
    // Never throw from telemetry helpers
  }
  return undefined;
}

export function getTracer(): TracerHandle {
  return {
    startSpan(name: string, attributes?: SpanAttributes): SpanHandle {
      return startSpan(name, attributes);
    },
  };
}

/** Starts a manual span. The caller must call end(). No-op when tracing is unavailable. */
export function startSpan(name: string, attributes?: SpanAttributes): SpanHandle {
  const otel = getOtel();
  if (!otel) {
    return NOOP_SPAN;
  }
  try {
    const span = otel.trace.getTracer(TRACER_NAME).startSpan(name, {
      attributes: sanitizeSpanAttributes(attributes, getAllowQueryParameters()),
    });
    return {
      setAttribute: (key, value) => {
        try {
          span.setAttribute(key, sanitizeSpanAttributes({ [key]: value }, getAllowQueryParameters())[key]);
        } catch {
          // ignore telemetry failures
        }
      },
      recordError: (error) => {
        try {
          span.recordException(toSanitizedError(error));
          span.setStatus({ code: 2 });
        } catch {
          // ignore telemetry failures
        }
      },
      end: () => {
        try {
          span.end();
        } catch {
          // ignore telemetry failures
        }
      },
    };
  } catch {
    return NOOP_SPAN;
  }
}

/**
 * Runs a function inside an active span. The span is ended automatically and
 * failures are recorded. When tracing is unavailable the function simply runs.
 */
export async function withSpan<T>(
  name: string,
  fn: () => Promise<T> | T,
  attributes?: SpanAttributes
): Promise<T> {
  const otel = getOtel();
  if (!otel) {
    return fn();
  }
  const tracer = otel.trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(
    name,
    { attributes: sanitizeSpanAttributes(attributes, getAllowQueryParameters()) },
    async (span) => {
  try {
    const result = await fn();
    span.setStatus({ code: 1 });
    return result;
  } catch (error) {

        span.recordException(toSanitizedError(error));
        span.setStatus({ code: 2 });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}
