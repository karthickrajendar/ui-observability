import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

import { captureError } from '../core/api';

export interface ObservabilityErrorBoundaryProps {
  children: ReactNode;
  /** Static fallback or render function receiving the caught error. */
  fallback?: ReactNode | ((error: Error) => ReactNode);
}

interface ObservabilityErrorBoundaryState {
  error: Error | null;
}

/**
 * React error boundary that reports render errors (with component stack)
 * through the observability SDK. Works even when the SDK is disabled:
 * reporting silently no-ops and the fallback still renders.
 */
export class ObservabilityErrorBoundary extends Component<
  ObservabilityErrorBoundaryProps,
  ObservabilityErrorBoundaryState
> {
  override state: ObservabilityErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ObservabilityErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    captureError(error, {
      attributes: {
        source: 'react-error-boundary',
        component_stack: errorInfo.componentStack ?? '',
      },
    });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      const { fallback } = this.props;
      if (typeof fallback === 'function') {
        return fallback(error);
      }
      return fallback ?? null;
    }
    return this.props.children;
  }
}
