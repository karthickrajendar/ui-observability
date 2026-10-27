import { ObservabilityErrorBoundary, ObservableRoutes } from '@company/frontend-observability';
import { Link, NavLink, Route, useLocation } from 'react-router-dom';

import { HomePage } from '../pages/home';
import { OrderDetailPage, OrdersPage } from '../pages/orders';
import { TelemetryLabPage } from '../pages/telemetry-lab';

function ErrorFallback(error: Error) {
  return (
    <div className="error-fallback">
      <h2>Something went wrong</h2>
      <p>The error was reported to the observability platform.</p>
      <pre>{error.message}</pre>
      <Link to="/">Back to home</Link>
    </div>
  );
}

export function App() {
  // Keying the boundary on the path lets navigation recover from render errors.
  const location = useLocation();
  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">demo-app</span>
        <nav>
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/orders">Orders</NavLink>
          <NavLink to="/lab">Telemetry Lab</NavLink>
        </nav>
      </header>
      <main>
        <ObservabilityErrorBoundary key={location.pathname} fallback={ErrorFallback}>
          <ObservableRoutes>
            <Route path="/" element={<HomePage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:orderId" element={<OrderDetailPage />} />
            <Route path="/lab" element={<TelemetryLabPage />} />
          </ObservableRoutes>
        </ObservabilityErrorBoundary>
      </main>
    </div>
  );
}

export default App;
