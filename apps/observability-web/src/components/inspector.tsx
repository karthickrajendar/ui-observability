import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Check, Copy, GitBranch, Layers } from 'lucide-react';
import type {
  TelemetryEvent,
  TraceDetail,
  TraceSpan,
} from '@ui-observability/contracts';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { colors, Empty, fieldLabel } from './widgets';
import { cn, formatValue, timeLabel } from '../lib/utils';
import { request } from '../lib/api';
export function orderedSpans(
  spans: TraceSpan[],
): { span: TraceSpan; depth: number }[] {
  const byId = new Map(spans.map((s) => [s.spanId, s]));
  const children = new Map<string, TraceSpan[]>();
  spans.forEach((s) => {
    if (s.parentSpanId && byId.has(s.parentSpanId))
      children.set(s.parentSpanId, [
        ...(children.get(s.parentSpanId) ?? []),
        s,
      ]);
  });
  const result: { span: TraceSpan; depth: number }[] = [],
    visited = new Set<string>();
  function walk(span: TraceSpan, depth: number) {
    if (visited.has(span.spanId)) return;
    visited.add(span.spanId);
    result.push({ span, depth });
    (children.get(span.spanId) ?? []).forEach((child) =>
      walk(child, Math.min(20, depth + 1)),
    );
  }
  spans
    .filter((s) => !s.parentSpanId || !byId.has(s.parentSpanId))
    .forEach((s) => walk(s, 0));
  spans.forEach((s) => walk(s, 0));
  return result;
}
function Attributes({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="attributes">
      {Object.entries(values).map(([key, value]) => (
        <div key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd>
            {typeof value === 'object'
              ? JSON.stringify(value, null, 2)
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Inspector({
  traceId,
  event,
  onClose,
  onTrace,
}: {
  traceId?: string;
  event?: TelemetryEvent;
  onClose: () => void;
  onTrace: (id: string) => void;
}) {
  return (
    <Dialog
      open={Boolean(traceId || event)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="inspector">
        {traceId ? (
          <TraceInspector key={traceId} traceId={traceId} />
        ) : event ? (
          <>
            <div className="inspector-heading">
              <span className="eyebrow">EVENT INSPECTOR</span>
              <DialogTitle className="text-xl font-semibold">
                {event.fields['event_name'] ||
                  event.fields['type'] ||
                  event.fields['kind'] ||
                  'Telemetry event'}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()}
              </DialogDescription>
            </div>
            {event.traceId && (
              <Button
                variant="outline"
                className="justify-self-start"
                onClick={() => {
                  if (event.traceId) onTrace(event.traceId);
                }}
              >
                <GitBranch />
                Open distributed trace
                <ArrowUpRight />
              </Button>
            )}
            <h3 className="section-label">Event fields</h3>
            <Attributes values={event.fields} />
            <h3 className="section-label">Raw record</h3>
            <pre className="raw-record">{event.line}</pre>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
function TraceInspector({ traceId }: { traceId: string }) {
  const query = useQuery({
    queryKey: ['trace', traceId],
    queryFn: ({ signal }) =>
      request<TraceDetail>('traces/' + traceId, undefined, signal),
  });
  const [selectedId, setSelectedId] = useState<string>();
  const [copied, setCopied] = useState(false),
    [copyError, setCopyError] = useState(false);
  const spans = useMemo(() => query.data?.spans ?? [], [query.data]);
  const ordered = useMemo(() => orderedSpans(spans), [spans]);
  const selected = spans.find((s) => s.spanId === selectedId) ?? spans[0];
  const services = [...new Set(spans.map((s) => s.service))];
  const start = Math.min(...spans.map((s) => s.startTime)),
    end = Math.max(...spans.map((s) => s.startTime + s.durationMs));
  const duration = Math.max(0.001, end - start);
  return (
    <>
      <div className="inspector-heading">
        <span className="eyebrow">DISTRIBUTED TRACE</span>
        <DialogTitle className="text-xl font-semibold">
          {spans.find((s) => !s.parentSpanId)?.name ?? 'Trace detail'}
        </DialogTitle>
        <DialogDescription className="flex items-center gap-2 text-xs text-muted-foreground">
          <code>{traceId}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy trace ID"
            onClick={() => {
              void navigator.clipboard.writeText(traceId).then(
                () => {
                  setCopied(true);
                  setCopyError(false);
                },
                () => setCopyError(true),
              );
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </DialogDescription>
        {copyError && (
          <span className="inline-error">
            Copy unavailable. Select the trace ID above.
          </span>
        )}
      </div>
      {query.isPending ? (
        <div className="skeleton-body h-60" />
      ) : query.error ? (
        <Empty
          message={query.error.message}
          detail="The trace may be unavailable or outside Tempo retention."
        />
      ) : !spans.length ? (
        <Empty message="No spans in this trace" />
      ) : (
        <>
          <div className="trace-summary">
            <span>
              <Layers size={14} />
              {spans.length} spans
            </span>
            <span>
              <GitBranch size={14} />
              {services.length} services
            </span>
            <span className="mono">{formatValue(duration, 'ms')}</span>
            <span>{timeLabel(start)}</span>
          </div>
          <div className="service-legend">
            {services.map((service, i) => (
              <span key={service}>
                <i style={{ background: colors[i % colors.length] }} />
                {service}
              </span>
            ))}
          </div>
          <div className="waterfall">
            <div className="waterfall-heading">
              <span>Service / operation</span>
              <span>
                0 ms <b>{formatValue(duration, 'ms')}</b>
              </span>
            </div>
            {ordered.map(({ span, depth }) => (
              <button
                key={span.spanId}
                className={cn(
                  'waterfall-row',
                  selected?.spanId === span.spanId && 'selected',
                )}
                onClick={() => setSelectedId(span.spanId)}
              >
                <span
                  className="span-label"
                  style={{ paddingLeft: 12 + depth * 12 }}
                >
                  <i
                    style={{
                      background:
                        colors[services.indexOf(span.service) % colors.length],
                    }}
                  />
                  <span title={span.name}>
                    <small>{span.service}</small>
                    {span.name}
                  </span>
                  {span.status === 'error' && <em>Error</em>}
                </span>
                <span className="span-timeline">
                  <i
                    style={{
                      left:
                        Math.max(
                          0,
                          ((span.startTime - start) / duration) * 100,
                        ) + '%',
                      width:
                        Math.min(100, (span.durationMs / duration) * 100) + '%',
                      background:
                        colors[services.indexOf(span.service) % colors.length],
                    }}
                  />
                  <small>{formatValue(span.durationMs, 'ms')}</small>
                </span>
              </button>
            ))}
          </div>
          {selected && (
            <div className="span-detail">
              <div className="span-detail-heading">
                <h3>{selected.name}</h3>
                <span
                  className={cn(
                    'signal-tag',
                    selected.status === 'error' && 'signal-error',
                  )}
                >
                  {selected.status}
                </span>
              </div>
              <code className="text-xs text-muted-foreground">
                span {selected.spanId}
                {selected.parentSpanId && ' · parent ' + selected.parentSpanId}
              </code>
              <h4 className="section-label">Span attributes</h4>
              <Attributes values={selected.attributes} />
              <h4 className="section-label">Resource attributes</h4>
              <Attributes values={selected.resource} />
              <h4 className="section-label">
                Span events ({selected.events.length})
              </h4>
              {selected.events.length ? (
                selected.events.map((item, i) => (
                  <div className="span-event" key={i}>
                    <strong>{item.name}</strong>
                    <time>{timeLabel(item.timestamp)}</time>
                    <Attributes values={item.attributes} />
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">
                  No events recorded for this span.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
