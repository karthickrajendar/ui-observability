import type { Faro } from '@grafana/faro-web-sdk';

import type { Breadcrumb, ObservabilityConfig } from '../config/types';

export type SdkStatus = 'uninitialized' | 'initialized' | 'disabled';

export interface SdkState {
  status: SdkStatus;
  faro: Faro | null;
  config: ObservabilityConfig | null;
  consentGranted: boolean;
  breadcrumbs: Breadcrumb[];
}

/**
 * The state lives on globalThis so hot module replacement and duplicate
 * bundles cannot create a second Faro/OTel pipeline.
 */
const GLOBAL_KEY = '__company_frontend_observability_state__';

type GlobalWithState = typeof globalThis & { [GLOBAL_KEY]?: SdkState };

export function getState(): SdkState {
  const holder = globalThis as GlobalWithState;
  if (!holder[GLOBAL_KEY]) {
    holder[GLOBAL_KEY] = {
      status: 'uninitialized',
      faro: null,
      config: null,
      consentGranted: true,
      breadcrumbs: [],
    };
  }
  return holder[GLOBAL_KEY];
}

export function isInitialized(): boolean {
  return getState().status === 'initialized';
}

/** Test-only helper. */
export function resetStateForTesting(): void {
  const holder = globalThis as GlobalWithState;
  delete holder[GLOBAL_KEY];
}

