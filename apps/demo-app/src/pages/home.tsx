import { getObservability } from '@company/frontend-observability';
import { Link } from 'react-router-dom';

export function HomePage() {
  const status = getObservability();
  return (
    <section>
      <h1>Frontend Observability Demo</h1>
      <p>
        This application is instrumented through <code>@company/frontend-observability</code>: RUM,
        errors, Web Vitals, and traces flow via Grafana Alloy into Loki and Tempo.
      </p>
      <dl className="status">
        <dt>Telemetry</dt>
        <dd>{status.initialized ? 'initialized' : 'disabled'}</dd>
        <dt>App</dt>
        <dd>{status.appName ?? '-'}</dd>
        <dt>Environment</dt>
        <dd>{status.environment ?? '-'}</dd>
        <dt>Release</dt>
        <dd>{status.release ?? '-'}</dd>
      </dl>
      <p>
        Visit the <Link to="/lab">Telemetry Lab</Link> to generate errors, events, and traces, or
        browse <Link to="/orders">Orders</Link> to produce route-change telemetry.
      </p>
    </section>
  );
}
