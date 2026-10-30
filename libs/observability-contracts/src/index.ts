import { z } from 'zod';

const filterValue = z.string().max(256).default('');
export const filtersSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    app: filterValue,
    environment: filterValue,
    release: filterValue,
    route: filterValue,
    browser: filterValue,
    sessionId: filterValue,
    search: filterValue,
  })
  .refine((f) => f.end > f.start && f.end - f.start <= 7 * 86400_000, {
    message: 'Choose a time range between one millisecond and seven days.',
  });
export type DashboardFilters = z.infer<typeof filtersSchema>;
export const widgetSettingsSchema = z.object({
  measurementType: z.string().max(256).optional(),
  measurementField: z
    .string()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/)
    .optional(),
  unit: z.enum(['number', 'ms', 'percent', 'ratio']).optional(),
});
export type WidgetSettings = z.infer<typeof widgetSettingsSchema>;
export type WidgetKind =
  | 'stat'
  | 'gauge'
  | 'timeseries'
  | 'bar'
  | 'table'
  | 'stream'
  | 'traces';
export type Unit = 'number' | 'ms' | 'percent' | 'ratio';
export interface WidgetDefinition {
  id: string;
  title: string;
  description: string;
  kind: WidgetKind;
  unit: Unit;
  category: 'RUM' | 'Errors' | 'Metrics' | 'Traces';
  thresholds?: [number, number];
}

function widget(
  id: string,
  title: string,
  kind: WidgetKind,
  category: WidgetDefinition['category'],
  description: string,
  unit: Unit = 'number',
  thresholds?: [number, number],
): WidgetDefinition {
  return { id, title, kind, category, description, unit, thresholds };
}
export const widgetCatalog: WidgetDefinition[] = [
  widget(
    'sessions',
    'Observed sessions',
    'stat',
    'RUM',
    'Distinct sessions with telemetry in the selected range.',
  ),
  widget(
    'error-free',
    'Error-free sessions',
    'gauge',
    'RUM',
    'Percentage of observed sessions without exceptions; unavailable with no sessions.',
    'percent',
  ),
  widget(
    'navigations',
    'Page & view transitions',
    'stat',
    'RUM',
    'Recorded route_change and view_changed events.',
  ),
  widget(
    'exceptions',
    'JS exceptions',
    'stat',
    'Errors',
    'Total recorded frontend exceptions.',
  ),
  widget(
    'rage-clicks',
    'Rage clicks',
    'stat',
    'RUM',
    'Recorded clusters of rapid clicks on the same target.',
  ),
  widget(
    'long-task-count',
    'Long tasks',
    'stat',
    'Metrics',
    'Recorded main-thread tasks lasting at least 50 ms.',
  ),
  widget(
    'lcp',
    'Largest Contentful Paint',
    'gauge',
    'Metrics',
    'LCP p75 across collected samples.',
    'ms',
    [2500, 4000],
  ),
  widget(
    'inp',
    'Interaction to Next Paint',
    'gauge',
    'Metrics',
    'INP p75 across collected samples.',
    'ms',
    [200, 500],
  ),
  widget(
    'cls',
    'Cumulative Layout Shift',
    'gauge',
    'Metrics',
    'CLS p75, a unitless layout stability score.',
    'ratio',
    [0.1, 0.25],
  ),
  widget(
    'fcp',
    'First Contentful Paint',
    'gauge',
    'Metrics',
    'FCP p75 across collected samples.',
    'ms',
    [1800, 3000],
  ),
  widget(
    'ttfb',
    'Time to First Byte',
    'gauge',
    'Metrics',
    'TTFB p75 across collected samples.',
    'ms',
    [800, 1800],
  ),
  widget(
    'signal-volume',
    'Telemetry by signal',
    'timeseries',
    'RUM',
    'Recorded signal counts per time bucket.',
  ),
  widget(
    'issues-trend',
    'Experience issues',
    'timeseries',
    'RUM',
    'Exceptions, rage clicks, and long tasks per time bucket.',
  ),
  widget(
    'events-trend',
    'User actions & events',
    'timeseries',
    'RUM',
    'Event counts grouped by event name.',
  ),
  widget(
    'views-table',
    'Views, tenants & releases',
    'table',
    'RUM',
    'Top observed logical views and release contexts.',
  ),
  widget(
    'event-stream',
    'Live RUM stream',
    'stream',
    'RUM',
    'Most recent RUM records; open an entry to inspect details.',
  ),
  widget(
    'impacted-sessions',
    'Impacted sessions',
    'stat',
    'Errors',
    'Distinct sessions containing exceptions.',
  ),
  widget(
    'resource-failures',
    'Chunk & resource failures',
    'stat',
    'Errors',
    'Exceptions tagged as chunk_load or resource_load.',
  ),
  widget(
    'boundary-errors',
    'React boundary catches',
    'stat',
    'Errors',
    'Exceptions captured by React error boundaries.',
  ),
  widget(
    'errors-release',
    'Errors by release',
    'bar',
    'Errors',
    'Exception totals grouped by release.',
  ),
  widget(
    'failures-trend',
    'Runtime & resource failures',
    'timeseries',
    'Errors',
    'Exceptions grouped by error type and capture source.',
  ),
  widget(
    'errors-connectivity',
    'Errors by client context',
    'bar',
    'Errors',
    'Exception totals grouped by connectivity and visibility.',
  ),
  widget(
    'logs-level',
    'Logs by severity',
    'timeseries',
    'Errors',
    'Log volume grouped by severity.',
  ),
  widget(
    'top-errors',
    'Top exceptions',
    'table',
    'Errors',
    'Most frequent exception types and messages.',
  ),
  widget(
    'errors-page',
    'Errors by page',
    'table',
    'Errors',
    'Most frequent sanitized page URLs with exceptions.',
  ),
  widget(
    'errors-browser',
    'Errors by browser & OS',
    'table',
    'Errors',
    'Exception totals grouped by browser and operating system.',
  ),
  widget(
    'error-stream',
    'Exceptions & application logs',
    'stream',
    'Errors',
    'Recent exceptions and logs, including available trace context.',
  ),
  ...(['lcp', 'inp', 'cls', 'fcp', 'ttfb'] as const).map((name) =>
    widget(
      name + '-trend',
      name.toUpperCase() + ' p75 over time',
      'timeseries',
      'Metrics',
      'p75 in each time bucket across collected samples.',
      name === 'cls' ? 'ratio' : 'ms',
    ),
  ),
  widget(
    'longtask-trend',
    'Long task duration by route',
    'timeseries',
    'Metrics',
    'Long task p75 duration grouped by route.',
    'ms',
  ),
  widget(
    'custom-measurements',
    'Custom measurements',
    'timeseries',
    'Metrics',
    'p75 of a numeric measurement field; choose its type, field, and unit in widget settings.',
    'ms',
  ),
  widget(
    'fetch-latency',
    'Fetch latency by endpoint',
    'timeseries',
    'Metrics',
    'Recorded traced fetch p75 latency, converted from ns to ms.',
    'ms',
  ),
  widget(
    'routes-table',
    'Route & view transitions',
    'table',
    'Metrics',
    'Transition event totals by target route and logical view.',
  ),
  widget(
    'measurement-stream',
    'Raw measurements',
    'stream',
    'Metrics',
    'Recent Web Vitals, long task, and custom measurement records.',
  ),
  widget(
    'traces',
    'Recent distributed traces',
    'traces',
    'Traces',
    'Traces matching frontend resource filters; open one to see every service and span.',
  ),
];
export const widgetById = Object.fromEntries(
  widgetCatalog.map((w) => [w.id, w]),
) as Record<string, WidgetDefinition>;
export const widgetInstanceSchema = z
  .object({
    id: z.string().min(1).max(100),
    catalogId: z
      .string()
      .refine((id) => Object.hasOwn(widgetById, id), 'Unknown widget'),
    title: z.string().min(1).max(100),
    x: z.number().int().min(0).max(11),
    y: z.number().int().min(0).max(10000),
    w: z.number().int().min(3).max(12),
    h: z.number().int().min(3).max(20),
    settings: widgetSettingsSchema.default({}),
  })
  .refine((w) => w.x + w.w <= 12, { message: 'Widget must fit in the grid.' });
export type WidgetInstance = z.infer<typeof widgetInstanceSchema>;
export const dashboardSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(80),
    description: z.string().max(300),
    widgets: z.array(widgetInstanceSchema).max(40),
  })
  .refine(
    (d) => new Set(d.widgets.map((w) => w.id)).size === d.widgets.length,
    { message: 'Widget IDs must be unique.' },
  );
export type DashboardDefinition = z.infer<typeof dashboardSchema>;

export function createWidget(
  catalogId: string,
  id: string,
  y = 0,
): WidgetInstance {
  const definition = widgetById[catalogId];
  if (!definition) throw new Error('Unknown widget');
  const small = definition.kind === 'stat' || definition.kind === 'gauge';
  return {
    id,
    catalogId,
    title: definition.title,
    x: 0,
    y,
    w: small
      ? 3
      : definition.kind === 'stream' || definition.kind === 'traces'
        ? 12
        : 6,
    h: small ? 4 : definition.kind === 'traces' ? 14 : 7,
    settings: {},
  };
}
function preset(
  id: string,
  title: string,
  description: string,
  ids: string[],
): DashboardDefinition {
  let x = 0,
    y = 0,
    rowHeight = 0;
  const widgets = ids.map((catalogId, i) => {
    const item = createWidget(catalogId, id + '-' + i);
    if (x + item.w > 12) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    item.x = x;
    item.y = y;
    x += item.w;
    rowHeight = Math.max(rowHeight, item.h);
    return item;
  });
  return { id, title, description, widgets };
}
export const presets: DashboardDefinition[] = [
  preset(
    'rum',
    'RUM Overview',
    'A clear view of your frontend experience, from first paint to the last interaction.',
    [
      'sessions',
      'navigations',
      'error-free',
      'exceptions',
      'rage-clicks',
      'long-task-count',
      'lcp',
      'inp',
      'signal-volume',
      'issues-trend',
      'events-trend',
      'views-table',
      'event-stream',
    ],
  ),
  preset(
    'errors',
    'Frontend Errors',
    'Find failures, understand their impact, and follow the context to the source.',
    [
      'exceptions',
      'impacted-sessions',
      'resource-failures',
      'boundary-errors',
      'errors-release',
      'failures-trend',
      'errors-connectivity',
      'logs-level',
      'top-errors',
      'errors-page',
      'errors-browser',
      'error-stream',
    ],
  ),
  preset(
    'metrics',
    'Frontend Metrics',
    'Explore Web Vitals, network performance, and the measurements that matter to your app.',
    [
      'lcp',
      'inp',
      'cls',
      'fcp',
      'ttfb',
      'long-task-count',
      'custom-measurements',
      'fetch-latency',
      'lcp-trend',
      'inp-trend',
      'cls-trend',
      'fcp-trend',
      'ttfb-trend',
      'longtask-trend',
      'routes-table',
      'measurement-stream',
    ],
  ),
  preset(
    'traces',
    'Distributed Traces',
    'Follow a request across the browser, services, and database.',
    ['traces'],
  ),
];

export interface Series {
  name: string;
  labels: Record<string, string>;
  points: [number, number | null][];
}
export interface TelemetryEvent {
  timestamp: number;
  line: string;
  fields: Record<string, string>;
  traceId?: string;
}
export interface TraceSummary {
  traceId: string;
  name: string;
  service: string;
  startTime: number;
  durationMs: number;
}
export interface TraceSpan {
  spanId: string;
  parentSpanId?: string;
  name: string;
  service: string;
  startTime: number;
  durationMs: number;
  status: string;
  attributes: Record<string, unknown>;
  resource: Record<string, unknown>;
  events: {
    name: string;
    timestamp: number;
    attributes: Record<string, unknown>;
  }[];
}
export interface TraceDetail {
  traceId: string;
  spans: TraceSpan[];
}
export interface WidgetData {
  value?: number | null;
  series?: Series[];
  columns?: string[];
  rows?: Record<string, string | number | null>[];
  events?: TelemetryEvent[];
  traces?: TraceSummary[];
  limited?: boolean;
}
export interface WidgetResult {
  id: string;
  data?: WidgetData;
  error?: string;
  fetchedAt: number;
}
export interface FilterOptions {
  apps: string[];
  environments: string[];
  releases: string[];
  measurements: { type: string; field: string }[];
  warnings: string[];
}
export const widgetsRequestSchema = z.object({
  filters: filtersSchema,
  widgets: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        catalogId: z
          .string()
          .refine((id) => Object.hasOwn(widgetById, id), 'Unknown widget'),
        settings: widgetSettingsSchema.default({}),
      }),
    )
    .min(1)
    .max(40),
});
export const tracesRequestSchema = z
  .object({
    filters: filtersSchema,
    name: z.string().max(256).default(''),
    minDurationMs: z.number().min(0).max(86400_000).optional(),
    maxDurationMs: z.number().min(0).max(86400_000).optional(),
    status: z.enum(['all', 'error', 'ok']).default('all'),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .refine(
    (v) =>
      v.minDurationMs === undefined ||
      v.maxDurationMs === undefined ||
      v.minDurationMs <= v.maxDurationMs,
    { message: 'Minimum duration must not exceed maximum duration.' },
  );
export type TraceSearch = z.infer<typeof tracesRequestSchema>;
