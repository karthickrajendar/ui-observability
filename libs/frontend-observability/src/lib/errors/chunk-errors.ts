import { captureError } from '../core/api';

const INSTALL_FLAG = '__company_frontend_observability_chunk_errors__';

type GlobalWithFlag = typeof globalThis & { [INSTALL_FLAG]?: boolean };

const CHUNK_ERROR_PATTERN =
  /Loading chunk|ChunkLoadError|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR_PATTERN.test(message);
}

/**
 * Captures failures Faro's default error instrumentation does not cover:
 * resource load failures (script/link/img) and tags chunk/dynamic-import
 * failures with a stable error type. Idempotent across HMR reloads.
 */
export function installChunkErrorCapture(): void {
  if (typeof window === 'undefined') {
    return;
  }
  const holder = globalThis as GlobalWithFlag;
  if (holder[INSTALL_FLAG]) {
    return;
  }
  holder[INSTALL_FLAG] = true;

  // Resource load errors do not bubble; they are only observable in capture phase.
  window.addEventListener(
    'error',
    (event: ErrorEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target || target === (window as unknown as HTMLElement)) {
        return;
      }
      const tagName = target.tagName?.toUpperCase();
      if (tagName === 'SCRIPT' || tagName === 'LINK' || tagName === 'IMG') {
        const source =
          (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || 'unknown';
        captureError(new Error(`Resource failed to load: ${source}`), {
          attributes: { error_type: 'resource_load', resource_tag: tagName.toLowerCase() },
        });
      }
    },
    true
  );

  // Faro already reports unhandled rejections; this adds a typed marker for
  // chunk/dynamic-import failures so dashboards can single them out.
  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    if (isChunkLoadError(event.reason)) {
      captureError(event.reason, {
        attributes: { error_type: 'chunk_load' },
      });
    }
  });
}
