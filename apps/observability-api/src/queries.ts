import type {
  DashboardFilters,
  TraceSearch,
  WidgetSettings,
} from '@ui-observability/contracts';

/** Quote data as a query string literal; never interpolate raw filter input. */
export const quote = (value: string): string => JSON.stringify(value);
export function selector(filters: DashboardFilters, kind?: string): string {
  const labels = ['job="faro"'];
  for (const [key, value] of [
    ['app_name', filters.app],
    ['app_environment', filters.environment],
    ['app_release', filters.release],
  ]) {
    if (value) labels.push(key + '=' + quote(value));
  }
  if (kind) labels.push('kind=~' + quote(kind));
  return '{' + labels.join(',') + '}';
}
export function stream(filters: DashboardFilters, kind?: string): string {
  let expression = selector(filters, kind) + ' | logfmt';
  if (filters.route)
    expression +=
      ' | context_route=' +
      quote(filters.route) +
      ' or event_data_toRoute=' +
      quote(filters.route) +
      ' or view_name=' +
      quote(filters.route);
  if (filters.browser)
    expression += ' | browser_name=' + quote(filters.browser);
  if (filters.sessionId)
    expression += ' | session_id=' + quote(filters.sessionId);
  if (filters.search) expression += ' |= ' + quote(filters.search);
  return expression + ' | __error__=""';
}
export interface QueryPlan {
  queries: { expression: string; name?: string }[];
  mode: 'instant' | 'range' | 'stream';
}
export function planWidget(
  id: string,
  f: DashboardFilters,
  settings: WidgetSettings = {},
): QueryPlan {
  const range = Math.max(1, Math.ceil((f.end - f.start) / 1000)) + 's';
  const bucket = Math.max(10, Math.ceil((f.end - f.start) / 180_000)) + 's';
  const instant = (expression: string): QueryPlan => ({
    queries: [{ expression }],
    mode: 'instant',
  });
  const trend = (expression: string): QueryPlan => ({
    queries: [{ expression }],
    mode: 'range',
  });
  const count = (
    kind?: string,
    extra = '',
    group = '',
    window = range,
  ): string =>
    'sum' +
    (group ? ' by (' + group + ')' : '') +
    '(count_over_time(' +
    stream(f, kind) +
    extra +
    ' [' +
    window +
    ']))';
  const sessions = (exceptions = false): string =>
    '(count(sum by (session_id)(count_over_time(' +
    stream(f, exceptions ? 'exception' : undefined) +
    ' | session_id!="" [' +
    range +
    ']))) or vector(0))';
  const quantile = (
    field: string,
    window: string,
    extra = '',
    group = '',
  ): string =>
    'quantile_over_time(0.75, ' +
    stream(f, 'measurement') +
    extra +
    ' | ' +
    field +
    '!="" | unwrap ' +
    field +
    ' | __error__="" [' +
    window +
    ']) by (' +
    group +
    ')';
  const event = (name: string): string => ' | event_name=' + quote(name);
  const top = (kind: string, group: string, extra = ''): QueryPlan =>
    instant('topk(10, ' + count(kind, extra, group) + ')');
  switch (id) {
    case 'sessions':
      return instant(sessions());
    case 'impacted-sessions':
      return instant(sessions(true));
    case 'error-free':
      return instant('100 * (1 - ' + sessions(true) + ' / ' + sessions() + ')');
    case 'navigations':
      return instant(
        count('event', ' | event_name=~"route_change|view_changed"') +
          ' or vector(0)',
      );
    case 'exceptions':
      return instant(count('exception') + ' or vector(0)');
    case 'rage-clicks':
      return instant(count('event', event('rage_click')) + ' or vector(0)');
    case 'long-task-count':
      return instant(
        count('measurement', ' | type="longtask"') + ' or vector(0)',
      );
    case 'resource-failures':
      return instant(
        count(
          'exception',
          ' | context_error_type=~"chunk_load|resource_load"',
        ) + ' or vector(0)',
      );
    case 'boundary-errors':
      return instant(
        count('exception', ' | context_source="react-error-boundary"') +
          ' or vector(0)',
      );
    case 'lcp':
    case 'inp':
    case 'cls':
    case 'fcp':
    case 'ttfb':
      return instant(quantile('value_' + id, range));
    case 'lcp-trend':
    case 'inp-trend':
    case 'cls-trend':
    case 'fcp-trend':
    case 'ttfb-trend':
      return trend(quantile('value_' + id.split('-')[0], bucket));
    case 'signal-volume':
      return trend(count(undefined, '', 'kind', bucket));
    case 'issues-trend':
      return {
        mode: 'range',
        queries: [
          {
            expression: count('exception', '', '', bucket),
            name: 'Exceptions',
          },
          {
            expression: count('event', event('rage_click'), '', bucket),
            name: 'Rage clicks',
          },
          {
            expression: count('measurement', ' | type="longtask"', '', bucket),
            name: 'Long tasks',
          },
        ],
      };
    case 'events-trend':
      return trend(count('event', ' | event_name!=""', 'event_name', bucket));
    case 'views-table':
      return top(
        'event|log|exception|measurement',
        'view_name,session_attr_tenant_id,app_release',
      );
    case 'errors-release':
      return top('exception', 'app_release');
    case 'failures-trend':
      return trend(
        count('exception', '', 'context_error_type,context_source', bucket),
      );
    case 'errors-connectivity':
      return top(
        'exception',
        'context_online,context_connection_type,context_visibility_state',
      );
    case 'logs-level':
      return trend(count('log', '', 'level', bucket));
    case 'top-errors':
      return top('exception', 'type,value');
    case 'errors-page':
      return top('exception', 'page_url');
    case 'errors-browser':
      return top('exception', 'browser_name,browser_version,browser_os');
    case 'longtask-trend':
      return trend(
        quantile(
          'value_duration_ms',
          bucket,
          ' | type="longtask"',
          'context_route',
        ),
      );
    case 'custom-measurements': {
      const extra = settings.measurementType
        ? ' | type=' + quote(settings.measurementType)
        : ' | type!="web-vitals" | type!="longtask"';
      return trend(
        quantile(
          'value_' + (settings.measurementField ?? 'duration_ms'),
          bucket,
          extra,
          'type',
        ),
      );
    }
    case 'fetch-latency':
      return trend(
        'quantile_over_time(0.75, ' +
          stream(f, 'event') +
          event('faro.tracing.fetch') +
          ' | event_data_duration_ns!="" | unwrap event_data_duration_ns | __error__="" [' +
          bucket +
          ']) by (event_data_url_full,event_data_http_response_status_code) / 1000000',
      );
    case 'routes-table':
      return top(
        'event',
        'event_data_toRoute,event_data_toView',
        ' | event_name=~"route_change|view_changed"',
      );
    case 'event-stream':
      return { mode: 'stream', queries: [{ expression: stream(f) }] };
    case 'error-stream':
      return {
        mode: 'stream',
        queries: [{ expression: stream(f, 'exception|log') }],
      };
    case 'measurement-stream':
      return {
        mode: 'stream',
        queries: [{ expression: stream(f, 'measurement') }],
      };
    default:
      throw new Error('Unknown widget: ' + id);
  }
}
export function traceQuery(search: TraceSearch): string {
  const { filters: f } = search;
  const conditions: string[] = [];
  if (f.app) conditions.push('resource.service.name = ' + quote(f.app));
  if (f.environment)
    conditions.push(
      '(resource.deployment.environment.name = ' +
        quote(f.environment) +
        ' || resource.deployment.environment = ' +
        quote(f.environment) +
        ')',
    );
  if (f.release) conditions.push('resource.app.release = ' + quote(f.release));
  if (f.sessionId) conditions.push('span.session.id = ' + quote(f.sessionId));
  if (search.name)
    conditions.push(
      'name =~ ' +
        quote('.*' + search.name.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&') + '.*'),
    );
  if (search.status !== 'all') conditions.push('status = ' + search.status);
  if (search.minDurationMs !== undefined)
    conditions.push('duration >= ' + search.minDurationMs + 'ms');
  if (search.maxDurationMs !== undefined)
    conditions.push('duration <= ' + search.maxDurationMs + 'ms');
  return '{ ' + (conditions.join(' && ') || 'true') + ' }';
}
