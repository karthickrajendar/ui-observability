import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Database,
  GripVertical,
  Search,
  Settings2,
  Trash2,
} from 'lucide-react';
import {
  widgetById,
  type TelemetryEvent,
  type TraceSummary,
  type Unit,
  type WidgetData,
  type WidgetInstance,
  type WidgetResult,
} from '@ui-observability/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Select } from './ui/select';
import { cn, formatValue, timeLabel } from '../lib/utils';
import { request } from '../lib/api';
import { toFilters, type FilterState } from '../lib/state';

export const colors = [
  '#6cb8dd',
  '#b19af4',
  '#e7af57',
  '#5dbda5',
  '#e47c85',
  '#94a4f4',
  '#d6a6cc',
];
export function Empty({
  message = 'No data in this time range',
  detail = 'Try a different filter or generate telemetry in the demo app.',
}: {
  message?: string;
  detail?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Activity size={21} strokeWidth={1.4} />
      </div>
      <span>{message}</span>
      <small>{detail}</small>
    </div>
  );
}
export function DataTable({ data, unit }: { data: WidgetData; unit: Unit }) {
  if (!data.rows?.length) return <Empty />;
  const cols = data.columns ?? [];
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {cols.map((col) => (
              <th key={col}>{fieldLabel(col)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row, i) => (
            <tr key={i}>
              {cols.map((col) => (
                <td key={col} title={String(row[col] ?? '')}>
                  {col === 'count'
                    ? formatValue(row[col] as number | null, unit)
                    : String(row[col] || '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function fieldLabel(key: string): string {
  const labels: Record<string, string> = {
    value: 'Message',
    count: 'Count',
    type: 'Type',
    app_release: 'Release',
    value_duration_ms: 'Duration (ms)',
    context_route: 'Route',
    event_data_toRoute: 'Target route',
    event_data_toView: 'Target view',
    page_url: 'Page URL',
    browser_name: 'Browser',
    browser_version: 'Version',
    browser_os: 'OS',
    view_name: 'View',
    session_attr_tenant_id: 'Tenant',
    context_online: 'Online',
    context_visibility_state: 'Tab visibility',
    context_connection_type: 'Connection',
  };
  return labels[key] ?? key.replace(/_/g, ' ');
}
function Chart({
  data,
  unit,
  bar = false,
}: {
  data: WidgetData;
  unit: Unit;
  bar?: boolean;
}) {
  const transformed = useMemo(() => {
    const byTime = new Map<number, Record<string, number | null>>();
    data.series?.forEach((series, i) =>
      series.points.forEach(([time, value]) => {
        const row = byTime.get(time) ?? { time };
        row['s' + i] = value;
        byTime.set(time, row);
      }),
    );
    return [...byTime.values()].sort(
      (a, b) => (a['time'] ?? 0) - (b['time'] ?? 0),
    );
  }, [data.series]);
  const series = data.series ?? [];
  if (bar) {
    if (!data.rows?.length) return <Empty />;
    const rows = data.rows.map((row) => ({
      name: Object.entries(row)
        .filter(([key]) => key !== 'count')
        .map(([, value]) => value || 'Unknown')
        .join(' · '),
      value: row['count'],
    }));
    return (
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <BarChart
            data={rows}
            margin={{ top: 15, right: 16, left: -12, bottom: 4 }}
          >
            <CartesianGrid
              stroke="var(--chart-grid)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickFormatter={(s: string) =>
                s.length > 18 ? s.slice(0, 17) + '…' : s
              }
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              cursor={{ fill: 'var(--accent)' }}
            />
            <Bar
              dataKey="value"
              fill={colors[0]}
              radius={[4, 4, 0, 0]}
              maxBarSize={42}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
  if (!series.some((s) => s.points.some(([, v]) => v !== null)))
    return <Empty />;
  return (
    <>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <AreaChart
            data={transformed}
            margin={{ top: 15, right: 16, left: -10, bottom: 2 }}
          >
            <CartesianGrid
              stroke="var(--chart-grid)"
              strokeDasharray="3 5"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={(t: number) =>
                new Date(t).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              }
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              minTickGap={40}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
              tickFormatter={(v: number) =>
                v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(v)
              }
              axisLine={false}
              tickLine={false}
              width={48}
            />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(label) => timeLabel(Number(label))}
              formatter={(value, name) => [
                formatValue(Number(value), unit),
                name,
              ]}
            />
            {series.map((s, i) => (
              <Area
                key={i}
                type="monotone"
                dataKey={'s' + i}
                name={s.name}
                stroke={colors[i % colors.length]}
                strokeWidth={1.8}
                fill={colors[i % colors.length]}
                fillOpacity={0.055}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend">
        {series.slice(0, 8).map((s, i) => (
          <span key={i} title={s.name}>
            <i style={{ background: colors[i % colors.length] }} />
            {s.name}
          </span>
        ))}
        {series.length > 8 && <span>+{series.length - 8} more</span>}
      </div>
    </>
  );
}
const tooltipStyle = {
  background: 'var(--popover)',
  color: 'var(--foreground)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
};

export function EventStream({
  events,
  onEvent,
}: {
  events: TelemetryEvent[];
  onEvent: (event: TelemetryEvent) => void;
}) {
  if (!events.length) return <Empty />;
  return (
    <div className="event-list">
      {events.map((event, i) => {
        const f = event.fields;
        const kind = f['kind'] ?? 'event';
        return (
          <button
            className="event-row"
            key={event.timestamp + '-' + i}
            onClick={() => onEvent(event)}
          >
            <time>{timeLabel(event.timestamp)}</time>
            <span
              className={cn(
                'signal-tag',
                kind === 'exception' && 'signal-error',
                kind === 'measurement' && 'signal-metric',
              )}
            >
              {kind}
            </span>
            <span className="event-message">
              {f['event_name'] ||
                f['value'] ||
                f['message'] ||
                f['type'] ||
                event.line}
            </span>
            <span className="event-app">{f['app_name']}</span>
            <ArrowUpRight size={13} />
          </button>
        );
      })}
    </div>
  );
}
export function TraceTable({
  traces,
  onTrace,
}: {
  traces: TraceSummary[];
  onTrace: (id: string) => void;
}) {
  if (!traces.length)
    return (
      <Empty
        message="No matching traces"
        detail="Generate a traced request in the Telemetry Lab or adjust the filters."
      />
    );
  return (
    <div className="table-scroll">
      <table className="trace-table">
        <thead>
          <tr>
            <th>Trace / operation</th>
            <th>Root service</th>
            <th>Started</th>
            <th>Duration</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {traces.map((trace) => (
            <tr key={trace.traceId}>
              <td>
                <button
                  className="trace-link"
                  onClick={() => onTrace(trace.traceId)}
                >
                  {trace.name}
                  <code>{trace.traceId.slice(0, 16)}</code>
                </button>
              </td>
              <td>
                <span className="service-label">
                  <i />
                  {trace.service}
                </span>
              </td>
              <td>{timeLabel(trace.startTime)}</td>
              <td className="mono">{formatValue(trace.durationMs, 'ms')}</td>
              <td>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={'Open trace ' + trace.traceId}
                  onClick={() => onTrace(trace.traceId)}
                >
                  <ArrowUpRight />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function TraceExplorer({
  state,
  onTrace,
}: {
  state: FilterState;
  onTrace: (id: string) => void;
}) {
  const [name, setName] = useState(''),
    [minimum, setMinimum] = useState(''),
    [maximum, setMaximum] = useState(''),
    [status, setStatus] = useState('all'),
    [directId, setDirectId] = useState('');
  const [search, setSearch] = useState({
    name: '',
    minDurationMs: undefined as number | undefined,
    maxDurationMs: undefined as number | undefined,
    status: 'all',
  });
  const [formError, setFormError] = useState('');
  const query = useQuery({
    queryKey: ['trace-search', state, search],
    queryFn: ({ signal }) =>
      request<{ traces: TraceSummary[]; limited: boolean }>(
        'traces/search',
        { filters: toFilters(state), ...search },
        signal,
      ),
    refetchInterval: state.refresh || false,
  });
  return (
    <div className="trace-explorer">
      <form
        className="trace-filters"
        onSubmit={(event) => {
          event.preventDefault();
          const min = minimum === '' ? undefined : Number(minimum),
            max = maximum === '' ? undefined : Number(maximum);
          if (
            (min !== undefined && (!Number.isFinite(min) || min < 0)) ||
            (max !== undefined && (!Number.isFinite(max) || max < 0)) ||
            (min !== undefined && max !== undefined && min > max)
          ) {
            setFormError('Enter valid durations, with minimum ≤ maximum.');
            return;
          }
          setFormError('');
          setSearch({ name, minDurationMs: min, maxDurationMs: max, status });
        }}
      >
        <div className="search-input">
          <Search size={14} />
          <Input
            aria-label="Trace operation name"
            placeholder="Search operation name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Input
          aria-label="Minimum span duration in milliseconds"
          type="number"
          min={0}
          placeholder="Min ms"
          value={minimum}
          onChange={(e) => setMinimum(e.target.value)}
          className="duration-input"
        />
        <Input
          aria-label="Maximum span duration in milliseconds"
          type="number"
          min={0}
          placeholder="Max ms"
          value={maximum}
          onChange={(e) => setMaximum(e.target.value)}
          className="duration-input"
        />
        <Select
          label="Span status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'error', label: 'Error spans' },
            { value: 'ok', label: 'OK spans' },
          ]}
        />
        <Button type="submit" variant="outline" size="sm">
          Search
        </Button>
      </form>
      <form
        className="direct-trace"
        onSubmit={(e) => {
          e.preventDefault();
          if (/^[0-9a-f]{32}$/i.test(directId)) {
            setFormError('');
            onTrace(directId);
          } else
            setFormError('Trace ID must contain 32 hexadecimal characters.');
        }}
      >
        <Input
          aria-label="Trace ID"
          placeholder="Look up a trace ID directly…"
          value={directId}
          onChange={(e) => setDirectId(e.target.value.trim())}
        />
        <Button type="submit" variant="ghost" size="sm">
          Open trace <ArrowUpRight />
        </Button>
        <small>Duration and status filters match spans within a trace.</small>
      </form>
      {formError && (
        <p className="inline-error" role="alert">
          {formError}
        </p>
      )}
      {query.error && (
        <p className="inline-error" role="alert">
          {query.error.message}
          {query.data && ' · Showing stale results.'}
        </p>
      )}
      {query.isPending ? (
        <div className="skeleton-body" />
      ) : query.data ? (
        <TraceTable traces={query.data.traces} onTrace={onTrace} />
      ) : (
        <Empty
          message="Trace search is unavailable"
          detail="Check the API and Tempo connection."
        />
      )}
      {query.data?.limited && (
        <div className="limited-note">
          Showing up to 100 matches. Narrow the time range or filters to refine
          the results.
        </div>
      )}
    </div>
  );
}
interface WidgetProps {
  widget: WidgetInstance;
  result?: WidgetResult;
  error?: string;
  loading: boolean;
  editing: boolean;
  state: FilterState;
  onEvent: (event: TelemetryEvent) => void;
  onTrace: (id: string) => void;
  onSettings: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
}
export function WidgetPanel({
  widget,
  result,
  error,
  loading,
  editing,
  state,
  onEvent,
  onTrace,
  onSettings,
  onRemove,
  onMove,
}: WidgetProps) {
  const definition = widgetById[widget.catalogId],
    data = result?.data,
    failure = result?.error ?? error;
  const small = definition.kind === 'stat' || definition.kind === 'gauge';
  const unit = widget.settings.unit ?? definition.unit;
  const value = data?.value;
  const thresholds = definition.thresholds;
  const good =
    value !== null &&
    value !== undefined &&
    (thresholds
      ? value <= thresholds[0]
      : widget.catalogId === 'error-free'
        ? value >= 99
        : true);
  const rating =
    value === null || value === undefined
      ? 'Awaiting samples'
      : thresholds
        ? good
          ? 'Good'
          : value <= thresholds[1]
            ? 'Needs improvement'
            : 'Poor'
        : widget.catalogId === 'error-free'
          ? 'Of observed sessions'
          : 'In selected range';
  return (
    <section
      className={cn(
        'widget-panel',
        small && 'widget-small',
        editing && 'widget-editing',
      )}
      aria-label={widget.title}
    >
      <header className="widget-header">
        <div className="widget-title">
          {editing && <GripVertical className="drag-handle" size={14} />}
          <h2 title={definition.description}>{widget.title}</h2>
        </div>
        {editing ? (
          <div className="widget-actions">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={'Move ' + widget.title + ' earlier'}
              onClick={() => onMove(-1)}
            >
              <ArrowUp />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={'Move ' + widget.title + ' later'}
              onClick={() => onMove(1)}
            >
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={'Configure ' + widget.title}
              onClick={onSettings}
            >
              <Settings2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={'Remove ' + widget.title}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        ) : (
          <span className="widget-kind">
            {definition.kind === 'gauge' && definition.thresholds ? (
              'p75'
            ) : definition.kind === 'stream' ? (
              <Database size={12} />
            ) : null}
          </span>
        )}
      </header>
      {failure && (
        <div className="widget-error" title={failure}>
          <AlertCircle size={12} />
          <span>
            {data ? 'Stale · ' : ''}
            {failure}
          </span>
          {data && <time>as of {timeLabel(result?.fetchedAt ?? 0)}</time>}
        </div>
      )}
      <div className={cn('widget-body', small && 'stat-body')}>
        {definition.kind === 'traces' ? (
          <TraceExplorer state={state} onTrace={onTrace} />
        ) : !data && loading ? (
          <div className="skeleton-body" />
        ) : !data ? (
          <Empty
            message={failure ? 'Data unavailable' : 'No data yet'}
            detail={
              failure ? 'Check your local observability stack.' : undefined
            }
          />
        ) : small ? (
          <>
            <div className={cn('stat-value', value === null && 'stat-empty')}>
              {formatValue(value, unit)}
            </div>
            {definition.kind === 'gauge' && thresholds && (
              <div className="gauge-track">
                <span />
                <span />
                <span />
                {value !== null && value !== undefined && (
                  <i
                    style={{
                      left:
                        Math.min(
                          98,
                          Math.max(1, (value / (thresholds[1] * 1.5)) * 100),
                        ) + '%',
                    }}
                  />
                )}
              </div>
            )}
            <div className="stat-caption">
              {definition.kind === 'gauge' && (
                <span
                  className={cn(
                    'status-dot',
                    value === null || value === undefined
                      ? 'neutral'
                      : good
                        ? 'good'
                        : 'warn',
                  )}
                />
              )}
              {rating}
            </div>
          </>
        ) : definition.kind === 'timeseries' || definition.kind === 'bar' ? (
          <Chart data={data} unit={unit} bar={definition.kind === 'bar'} />
        ) : definition.kind === 'stream' ? (
          <EventStream events={data.events ?? []} onEvent={onEvent} />
        ) : (
          <DataTable data={data} unit={unit} />
        )}
      </div>
      {data?.limited && (
        <div className="limited-note">
          Showing the latest 200 entries. Narrow your filters for more detail.
        </div>
      )}
    </section>
  );
}
