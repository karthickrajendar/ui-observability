import {
  ErrorsInstrumentation,
  InternalLoggerLevel,
  ReactIntegration,
  ViewInstrumentation,
  WebVitalsInstrumentation,
  createReactRouterV6Options,
  getWebInstrumentations,
  initializeFaro,
} from '@grafana/faro-react';
import type { Faro, Instrumentation } from '@grafana/faro-react';
import { TracingInstrumentation } from '@grafana/faro-web-tracing';
import {
  createRoutesFromChildren,
  matchRoutes,
  Routes,
  useLocation,
  useNavigationType,
} from 'react-router-dom';

import type { ObservabilityConfig } from '../config/types';
import { createBeforeSendHook } from '../privacy/before-send';
import { buildRelease } from '../release/release';

function buildInstrumentations(config: ObservabilityConfig): Instrumentation[] {
  const { features } = config;

  const instrumentations = getWebInstrumentations({ captureConsole: false }).filter((instrumentation) => {
    if (instrumentation instanceof WebVitalsInstrumentation) {
      return features.webVitals;
    }
    if (instrumentation instanceof ErrorsInstrumentation) {
      return features.errors;
    }
    if (instrumentation instanceof ViewInstrumentation) {
      return features.rum;
    }
    return true;
  });

  if (features.tracing) {
    instrumentations.push(
      new TracingInstrumentation({
        instrumentationOptions: {
          propagateTraceHeaderCorsUrls: config.tracePropagation.allowedOrigins,
        },
        // When network monitoring is off, drop the default fetch/XHR instrumentations.
        ...(features.network ? {} : { instrumentations: [] }),
      })
    );
  }

  if (features.rum) {
    instrumentations.push(
      new ReactIntegration({
        router: createReactRouterV6Options({
          createRoutesFromChildren,
          matchRoutes,
          Routes,
          useLocation,
          useNavigationType,
        }),
      })
    );
  }

  return instrumentations;
}

/**
 * Creates the single Faro instance (which owns the single OpenTelemetry
 * WebTracerProvider via TracingInstrumentation). Callers are responsible
 * for singleton guarding; see core/api.ts.
 */
export function createFaroInstance(config: ObservabilityConfig): Faro {
  return initializeFaro({
    url: config.collector.faroUrl,
    app: {
      name: config.app.name,
      version: config.app.version,
      environment: config.app.environment,
      release: buildRelease(config.app),
    },
    sessionTracking: {
      enabled: config.features.rum,
      samplingRate: config.sampling.sessions,
    },
    instrumentations: buildInstrumentations(config),
    beforeSend: createBeforeSendHook(config),
    internalLoggerLevel: config.debug ? InternalLoggerLevel.VERBOSE : InternalLoggerLevel.ERROR,
  });
}
