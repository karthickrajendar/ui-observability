import { FaroRoutes } from '@grafana/faro-react';
import type { ComponentProps } from 'react';
import { Routes } from 'react-router-dom';

import { isInitialized } from '../core/state';

export type ObservableRoutesProps = ComponentProps<typeof Routes>;

/**
 * Drop-in replacement for React Router's <Routes> that reports route changes
 * (with route templates, not raw URLs) to the observability pipeline.
 * Falls back to the plain <Routes> when the SDK is not initialized.
 */
export function ObservableRoutes(props: ObservableRoutesProps) {
  if (isInitialized()) {
    return <FaroRoutes {...props} />;
  }
  return <Routes {...props} />;
}
