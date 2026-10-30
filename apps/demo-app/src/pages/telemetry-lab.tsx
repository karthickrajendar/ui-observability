import {
  addBreadcrumb,
  captureEvent,
  captureError,
  captureMeasurement,
  captureMessage,
  clearTenantContext,
  clearUserContext,
  getActiveTraceContext,
  setTelemetryConsent,
  setTenantContext,
  setUserContext,
  setView,
  withSpan,
} from '@company/frontend-observability';
import { useState } from 'react';



function BrokenComponent(): never {
  throw new Error('Deliberate render error from BrokenComponent');
}

export function TelemetryLabPage() {
  const [renderError, setRenderError] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [consent, setConsent] = useState(true);
  const [lastAction, setLastAction] = useState('none');
  const [lastTraceInfo, setLastTraceInfo] = useState<string | null>(null);



  if (renderError) {
    return <BrokenComponent />;
  }

  const act = (label: string, fn: () => void) => () => {
    fn();
    setLastAction(label);
  };

  return (
    <section>
      <h1>Telemetry Lab</h1>
      <p>
        Each button produces a specific telemetry signal. Watch it arrive in Grafana at{' '}
        <code>http://localhost:3000</code>.
      </p>
      <p className="last-action">
        Last action: <strong>{lastAction}</strong>
        {lastTraceInfo ? (
          <>
            {' '}
            | End-to-End Trace: <code>{lastTraceInfo}</code>
          </>
        ) : null}
      </p>


      <h2>Errors</h2>
      <div className="actions">
        <button
          onClick={act('uncaught error', () => {
            setTimeout(() => {
              throw new Error('Deliberate uncaught error from the Telemetry Lab');
            }, 0);
          })}
        >
          Throw uncaught JS error
        </button>
        <button
          onClick={act('unhandled rejection', () => {
            void Promise.reject(new Error('Deliberate unhandled promise rejection'));
          })}
        >
          Unhandled promise rejection
        </button>
        <button onClick={act('render error', () => setRenderError(true))}>
          Trigger React render error (error boundary)
        </button>
        <button
          onClick={act('failed dynamic import', () => {
            // Path assembled at runtime so bundler and type checker leave it alone.
            // Deliberately NOT caught: the unhandled rejection is how real chunk
            // failures surface, and the SDK tags them with error_type=chunk_load.
            const missingChunk = ['', 'assets', 'this-chunk-does-not-exist.js'].join('/');
            void import(/* @vite-ignore */ missingChunk);
          })}
        >
          Fail a dynamic import (chunk error)
        </button>
      </div>

      <h2>Network and traces</h2>
      <div className="actions">
        <button
          onClick={act('traced error', () => {
            void withSpan('lab.correlated-error', () => {
              const trace = getActiveTraceContext();
              setLastTraceInfo(trace ? 'traceId=' + trace.traceId : 'No active trace context');
              captureError(new Error('Deliberate traced error from the Telemetry Lab'));
            });
          })}
        >
          Capture error with trace context
        </button>
        <button
          onClick={act('traced fetch', () => {
            void withSpan('lab.echo-roundtrip', async () => {
              const uiCtx = getActiveTraceContext();
              const response = await fetch('/api/echo?requestId=42');
              const body = (await response.json()) as {
                traceId?: string;
                backendSpanId?: string;
                receivedTraceparent?: string | null;
              };
              const traceId = body.traceId ?? uiCtx?.traceId ?? 'unknown';
              setLastTraceInfo(
                `traceId=${traceId} (UI -> demo-api span=${body.backendSpanId ?? 'n/a'})`
              );
            });
          })}
        >
          Traced fetch to /api/echo
        </button>

        <button
          onClick={act('failing fetch', () => {
            void fetch('/api/does-not-exist').catch(() => undefined);
          })}
        >
          Fetch a 404
        </button>
      </div>

      <h2>Events and logs</h2>
      <div className="actions">
        <button
          data-otel-action="send-custom-event"
          onClick={act('custom event', () =>
            captureEvent('lab_button_clicked', { feature: 'telemetry-lab' })
          )}
        >
          Send custom event
        </button>
        <button onClick={act('log message', () => captureMessage('Hello from the Telemetry Lab'))}>
          Send log message
        </button>
        <button
          onClick={act('custom measurement', () =>
            captureMeasurement(
              'checkout_step_duration',
              { duration_ms: 135 },
              { attributes: { step: 'review' } }
            )
          )}
        >
          Record custom SLI measurement
        </button>
        <button
          onClick={act('breadcrumb + view', () => {
            addBreadcrumb({ category: 'user', message: 'Opened checkout modal' });
            setView('/checkout/modal/998877');
          })}
        >
          Record breadcrumb & logical view
        </button>
      </div>

      <h2>Identity & Consent</h2>
      <div className="actions">
        {loggedIn ? (
          <button
            onClick={act('logout', () => {
              clearUserContext();
              clearTenantContext();
              setLoggedIn(false);
            })}
          >
            Log out (clears user and tenant context)
          </button>
        ) : (
          <button
            onClick={act('login', () => {
              setUserContext({ id: 'user-42' });
              setTenantContext({ id: 'tenant-acme' });
              setLoggedIn(true);
            })}
          >
            Log in as user-42 @ tenant-acme
          </button>
        )}
        <button
          onClick={act(consent ? 'revoke consent' : 'grant consent', () => {
            const next = !consent;
            setTelemetryConsent(next);
            setConsent(next);
          })}
        >
          {consent ? 'Revoke telemetry consent' : 'Grant telemetry consent'}
        </button>
      </div>

    </section>
  );
}
