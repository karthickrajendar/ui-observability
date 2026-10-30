import type {
  Series,
  TelemetryEvent,
  TraceDetail,
  TraceSpan,
  TraceSummary,
  WidgetData,
} from '@ui-observability/contracts';

export function parseLogfmt(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const pattern = /([\w.-]+)=(?:"((?:\\.|[^"\\])*)"|(\S*))/g;
  for (const match of line.matchAll(pattern)) {
    let value = match[3] ?? '';
    if (match[2] !== undefined) {
      try {
        value = JSON.parse('"' + match[2] + '"') as string;
      } catch {
        value = match[2].replace(/\\(["\\])/g, '$1');
      }
    }
    Object.defineProperty(fields, match[1], {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return fields;
}
interface LokiResult {
  metric?: Record<string, string>;
  stream?: Record<string, string>;
  value?: [number, string];
  values?: [number | string, string, Record<string, string>?][];
}
export interface LokiResponse {
  status: string;
  data?: { resultType: string; result: LokiResult[] };
  error?: string;
}
export const numeric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export function normalizeLoki(
  response: LokiResponse,
  kind: string,
  name?: string,
): WidgetData {
  if (response.status !== 'success' || !Array.isArray(response.data?.result))
    throw new Error(response.error ?? 'Invalid Loki response');
  const { result, resultType } = response.data;
  if (resultType === 'streams') {
    const events: TelemetryEvent[] = result
      .flatMap((r) =>
        (r.values ?? []).map(([ts, line, metadata]) => {
          const fields = { ...r.stream, ...metadata, ...parseLogfmt(line) };
          const rawId =
            fields['trace_id'] ??
            fields['traceID'] ??
            fields['traceId'] ??
            fields['context_trace_id'] ??
            fields['trace_trace_id'];
          return {
            timestamp: Number(ts) / 1e6,
            line,
            fields,
            traceId: rawId && /^[0-9a-f]{32}$/i.test(rawId) ? rawId : undefined,
          };
        }),
      )
      .sort((a, b) => b.timestamp - a.timestamp);
    return { events, limited: events.length >= 200 };
  }
  const series: Series[] = result.map((r) => ({
    name:
      name ??
      (Object.values(r.metric ?? {})
        .filter(Boolean)
        .join(' · ') ||
        'Total'),
    labels: r.metric ?? {},
    points: (r.values ?? (r.value ? [r.value] : [])).map(([ts, value]) => [
      Number(ts) * 1000,
      numeric(value),
    ]),
  }));
  if (kind === 'stat' || kind === 'gauge')
    return { value: series[0]?.points[0]?.[1] ?? null };
  if (kind === 'table' || kind === 'bar') {
    const columns = [
      ...new Set(result.flatMap((r) => Object.keys(r.metric ?? {}))),
    ].filter((key) => key !== '__name__');
    return {
      columns: [...columns, 'count'],
      rows: result.map((r) => ({ ...r.metric, count: numeric(r.value?.[1]) })),
    };
  }
  return { series };
}

interface OtelValue {
  stringValue?: string;
  intValue?: string | number;
  doubleValue?: number;
  boolValue?: boolean;
  arrayValue?: { values?: OtelValue[] };
  kvlistValue?: { values?: OtelAttribute[] };
}
interface OtelAttribute {
  key: string;
  value?: OtelValue;
}
function otelValue(v: OtelValue = {}): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return v.intValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(otelValue);
  if (v.kvlistValue) return attributes(v.kvlistValue.values);
  return null;
}
function attributes(values: OtelAttribute[] = []): Record<string, unknown> {
  return Object.fromEntries(values.map((a) => [a.key, otelValue(a.value)]));
}
function hex(value: string | undefined, size: number): string {
  if (!value) return '';
  return new RegExp('^[0-9a-f]{' + size + '}$', 'i').test(value)
    ? value.toLowerCase()
    : Buffer.from(value, 'base64').toString('hex');
}
interface OtelSpan {
  spanId: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes?: OtelAttribute[];
  status?: { code?: number | string; message?: string };
  events?: {
    name?: string;
    timeUnixNano?: string;
    attributes?: OtelAttribute[];
  }[];
}
interface OtelBatch {
  resource?: { attributes?: OtelAttribute[] };
  scopeSpans?: { spans?: OtelSpan[] }[];
  instrumentationLibrarySpans?: { spans?: OtelSpan[] }[];
}
export function normalizeTrace(
  body: { batches?: OtelBatch[]; resourceSpans?: OtelBatch[] },
  traceId: string,
): TraceDetail {
  const batches = body.batches ?? body.resourceSpans;
  if (!Array.isArray(batches)) throw new Error('Invalid Tempo trace response');
  const spans: TraceSpan[] = batches.flatMap((batch) => {
    const resource = attributes(batch.resource?.attributes);
    return (
      batch.scopeSpans ??
      batch.instrumentationLibrarySpans ??
      []
    ).flatMap((scope) =>
      (scope.spans ?? []).map((span) => {
        const start = BigInt(span.startTimeUnixNano ?? '0'),
          end = BigInt(span.endTimeUnixNano ?? span.startTimeUnixNano ?? '0');
        const code = span.status?.code;
        return {
          spanId: hex(span.spanId, 16),
          parentSpanId: span.parentSpanId
            ? hex(span.parentSpanId, 16)
            : undefined,
          name: span.name ?? 'Unnamed span',
          service: String(resource['service.name'] ?? 'unknown'),
          startTime: Number(start) / 1e6,
          durationMs: Math.max(0, Number(end - start) / 1e6),
          status:
            code === 2 || code === 'STATUS_CODE_ERROR'
              ? 'error'
              : code === 1 || code === 'STATUS_CODE_OK'
                ? 'ok'
                : 'unset',
          attributes: attributes(span.attributes),
          resource,
          events: (span.events ?? []).map((event) => ({
            name: event.name ?? 'event',
            timestamp: Number(event.timeUnixNano ?? '0') / 1e6,
            attributes: attributes(event.attributes),
          })),
        };
      }),
    );
  });
  return { traceId, spans: spans.sort((a, b) => a.startTime - b.startTime) };
}
export function normalizeSearch(body: {
  traces?: {
    traceID: string;
    rootTraceName?: string;
    rootServiceName?: string;
    startTimeUnixNano?: string;
    durationMs?: number;
  }[];
}): TraceSummary[] {
  if (!Array.isArray(body.traces))
    throw new Error('Invalid Tempo search response');
  return body.traces
    .map((t) => ({
      traceId: t.traceID,
      name: t.rootTraceName || 'Unnamed trace',
      service: t.rootServiceName || 'unknown',
      startTime: Number(t.startTimeUnixNano ?? 0) / 1e6,
      durationMs: t.durationMs ?? 0,
    }))
    .sort((a, b) => b.startTime - a.startTime);
}
