import type { AppMetadata } from '../config/types';

/**
 * Builds a release identifier of the form "name@version+shortsha",
 * e.g. "customer-portal@2026.08.18+abc1234".
 */
export function buildRelease(app: AppMetadata): string {
  if (app.release) {
    return app.release;
  }
  const base = `${app.name}@${app.version}`;
  return app.commitSha ? `${base}+${app.commitSha.slice(0, 7)}` : base;
}
