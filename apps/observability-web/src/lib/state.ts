import {
  dashboardSchema,
  presets,
  type DashboardDefinition,
  type DashboardFilters,
} from '@ui-observability/contracts';
export const STORAGE_KEY = 'pulse:dashboards:v1';
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export function loadDashboards(storage: StorageLike): {
  dashboards: DashboardDefinition[];
  warning?: string;
} {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { dashboards: [] };
    const document = JSON.parse(raw) as {
      version?: number;
      dashboards?: unknown[];
    };
    if (document.version !== 1 || !Array.isArray(document.dashboards))
      return {
        dashboards: [],
        warning:
          'Saved dashboards could not be read. Presets are still available.',
      };
    const valid = document.dashboards.map((d) => dashboardSchema.safeParse(d));
    const dashboards = valid
      .flatMap((d) => (d.success ? [d.data] : []))
      .filter((d, i, list) => list.findIndex((v) => v.id === d.id) === i);
    return {
      dashboards,
      warning: valid.some((d) => !d.success)
        ? 'Some invalid saved dashboards were skipped.'
        : undefined,
    };
  } catch {
    return {
      dashboards: [],
      warning: 'Browser storage is unavailable or contains invalid dashboards.',
    };
  }
}
export function saveDashboards(
  storage: StorageLike,
  dashboards: DashboardDefinition[],
): void {
  const valid = dashboards.map((d) => dashboardSchema.parse(d));
  storage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, dashboards: valid }),
  );
}
export function allDashboards(
  saved: DashboardDefinition[],
): DashboardDefinition[] {
  return [
    ...presets.map((p) => saved.find((d) => d.id === p.id) ?? p),
    ...saved.filter((d) => !presets.some((p) => p.id === d.id)),
  ];
}
export interface FilterState {
  app: string;
  environment: string;
  release: string;
  route: string;
  browser: string;
  sessionId: string;
  search: string;
  range: number;
  from?: number;
  to?: number;
  refresh: number;
}
export function readFilters(params: URLSearchParams): FilterState {
  const allowed = [900000, 3600000, 21600000, 86400000];
  const range = Number(params.get('range') ?? 3600000);
  const from = Number(params.get('from')),
    to = Number(params.get('to'));
  const validCustom =
    params.has('from') &&
    params.has('to') &&
    Number.isFinite(from) &&
    Number.isFinite(to) &&
    from >= 0 &&
    to > from &&
    to - from <= 7 * 86400000;
  const refresh = Number(params.get('refresh') ?? 30000);
  return {
    app: params.get('app') ?? '',
    environment: params.get('environment') ?? '',
    release: params.get('release') ?? '',
    route: params.get('route') ?? '',
    browser: params.get('browser') ?? '',
    sessionId: params.get('sessionId') ?? '',
    search: params.get('search') ?? '',
    range: allowed.includes(range) ? range : 3600000,
    from: validCustom ? from : undefined,
    to: validCustom ? to : undefined,
    refresh: [0, 10000, 30000, 60000, 300000].includes(refresh)
      ? refresh
      : 30000,
  };
}
export function toFilters(
  state: FilterState,
  now = Date.now(),
): DashboardFilters {
  const end = state.to ?? now,
    start = state.from ?? end - state.range;
  return {
    start,
    end,
    app: state.app,
    environment: state.environment,
    release: state.release,
    route: state.route,
    browser: state.browser,
    sessionId: state.sessionId,
    search: state.search,
  };
}
export function reorderWidgets(
  dashboard: DashboardDefinition,
  id: string,
  direction: -1 | 1,
): DashboardDefinition {
  const sorted = [...dashboard.widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  const index = sorted.findIndex((w) => w.id === id),
    target = index + direction;
  if (index < 0 || target < 0 || target >= sorted.length) return dashboard;
  [sorted[index], sorted[target]] = [sorted[target], sorted[index]];
  let x = 0,
    y = 0,
    rowHeight = 0;
  return {
    ...dashboard,
    widgets: sorted.map((w) => {
      if (x + w.w > 12) {
        y += rowHeight;
        x = 0;
        rowHeight = 0;
      }
      const updated = { ...w, x, y };
      x += w.w;
      rowHeight = Math.max(rowHeight, w.h);
      return updated;
    }),
  };
}
