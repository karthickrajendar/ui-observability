import { sanitizeAttributes } from '../privacy/sanitize';
import { normalizeRoute } from './routes';

const OBSERVERS_FLAG = '__company_frontend_observability_rum_observers__';
const RAGE_CLICK_WINDOW_MS = 1000;
const RAGE_CLICK_THRESHOLD = 3;
const MAX_PIXEL_DISTANCE = 30;
const LONG_TASK_THRESHOLD_MS = 50;

type GlobalWithObservers = typeof globalThis & { [OBSERVERS_FLAG]?: boolean };

interface NetworkInformationLike {
  effectiveType?: string;
  rtt?: number;
  downlink?: number;
}

interface NavigatorWithConnection extends Navigator {
  connection?: NetworkInformationLike;
}

/**
 * Returns low-cardinality browser connectivity and visibility attributes so
 * errors and measurements can distinguish real backend incidents from offline
 * clients or backgrounded tabs.
 */
export function getBrowserContextAttributes(): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (typeof navigator !== 'undefined') {
    if (typeof navigator.onLine === 'boolean') {
      attrs['online'] = String(navigator.onLine);
    }
    const conn = (navigator as NavigatorWithConnection).connection;
    if (conn?.effectiveType) {
      attrs['connection_type'] = String(conn.effectiveType);
    }
  }
  if (typeof document !== 'undefined' && typeof document.visibilityState === 'string') {
    attrs['visibility_state'] = document.visibilityState;
  }
  return sanitizeAttributes(attrs);
}

/**
 * Describes an interactive DOM element without capturing PII (never reads textContent
 * or input values; only tag name, semantic role, and explicit data-otel-action).
 */
export function describeSafeTarget(target: EventTarget | null): string {
  if (!target || typeof (target as Element).tagName !== 'string') {
    return 'unknown';
  }
  const el = target as Element;
  const tag = el.tagName.toLowerCase();
  const action = el.getAttribute?.('data-otel-action') || el.getAttribute?.('aria-label-id');
  const role = el.getAttribute?.('role');
  if (action) {
    return `${tag}[data-otel-action="${action}"]`;
  }
  if (role) {
    return `${tag}[role="${role}"]`;
  }
  return tag;
}

export interface RumObserverCallbacks {
  onLongTask: (durationMs: number, route: string) => void;
  onRageClick: (targetDescriptor: string, clickCount: number, route: string) => void;
}

/**
 * Installs idempotent browser observers for main-thread blocking Long Tasks (>50ms)
 * and user frustration Rage Clicks (>=3 rapid clicks in the same 30px area within 1s).
 */
export function installRumObservers(callbacks: RumObserverCallbacks): void {
  if (typeof window === 'undefined') {
    return;
  }
  const holder = globalThis as GlobalWithObservers;
  if (holder[OBSERVERS_FLAG]) {
    return;
  }
  holder[OBSERVERS_FLAG] = true;

  // 1. Long Task observer (main-thread stalls > 50ms)
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const supported = PerformanceObserver.supportedEntryTypes ?? [];
      if (supported.includes('longtask')) {
        const observer = new PerformanceObserver((list) => {
          const route = normalizeRoute(window.location?.pathname ?? '/');
          for (const entry of list.getEntries()) {
            if (entry.duration >= LONG_TASK_THRESHOLD_MS) {
              callbacks.onLongTask(Math.round(entry.duration), route);
            }
          }
        });
        observer.observe({ type: 'longtask', buffered: true });
      }
    } catch {
      // Never break the host application if PerformanceObserver fails.
    }
  }

  // 2. Rage Click frustration detector
  let clicks: Array<{ ts: number; x: number; y: number; target: string }> = [];
  window.addEventListener(
    'click',
    (event: MouseEvent) => {
      try {
        const now = Date.now();
        const descriptor = describeSafeTarget(event.target);
        const x = typeof event.clientX === 'number' ? event.clientX : 0;
        const y = typeof event.clientY === 'number' ? event.clientY : 0;

        clicks = clicks.filter(
          (prev) =>
            now - prev.ts <= RAGE_CLICK_WINDOW_MS &&
            prev.target === descriptor &&
            Math.hypot(x - prev.x, y - prev.y) <= MAX_PIXEL_DISTANCE
        );
        clicks.push({ ts: now, x, y, target: descriptor });

        if (clicks.length >= RAGE_CLICK_THRESHOLD) {
          const count = clicks.length;
          clicks = [];
          const route = normalizeRoute(window.location?.pathname ?? '/');
          callbacks.onRageClick(descriptor, count, route);
        }
      } catch {
        // Ignore observer errors
      }
    },
    { capture: true, passive: true }
  );
}

/** Test-only helper to reset the idempotent observer installation flag. */
export function resetRumObserversForTesting(): void {
  const holder = globalThis as GlobalWithObservers;
  delete holder[OBSERVERS_FLAG];
}
