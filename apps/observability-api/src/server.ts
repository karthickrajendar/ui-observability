import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  filtersSchema,
  tracesRequestSchema,
  widgetById,
  widgetsRequestSchema,
  type DashboardFilters,
  type FilterOptions,
  type TraceSearch,
  type WidgetData,
  type WidgetResult,
} from '@ui-observability/contracts';
import {
  normalizeLoki,
  normalizeSearch,
  normalizeTrace,
  parseLogfmt,
  type LokiResponse,
} from './normalize';
import { planWidget, stream, traceQuery } from './queries';

export interface ServerOptions {
  lokiUrl?: string;
  tempoUrl?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}
export function buildServer(options: ServerOptions = {}) {
  const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
  const urls = {
    loki: options.lokiUrl ?? process.env['LOKI_URL'] ?? 'http://127.0.0.1:3100',
    tempo:
      options.tempoUrl ?? process.env['TEMPO_URL'] ?? 'http://127.0.0.1:3200',
  };
  const timeout =
    options.timeoutMs ?? Number(process.env['UPSTREAM_TIMEOUT_MS'] ?? 10000);
  if (!Number.isFinite(timeout) || timeout < 100 || timeout > 60000)
    throw new Error('UPSTREAM_TIMEOUT_MS must be between 100 and 60000');
  for (const url of Object.values(urls)) {
    if (!['http:', 'https:'].includes(new URL(url).protocol))
      throw new Error('Upstream URLs must use HTTP or HTTPS');
  }
  const fetcher = options.fetch ?? fetch;
  async function upstream<T>(
    backend: keyof typeof urls,
    path: string,
    params: Record<string, string> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const url = new URL(urls[backend].replace(/\/$/, '') + path);
    for (const [key, value] of Object.entries(params))
      url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.any([
          AbortSignal.timeout(timeout),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (error) {
      if (signal?.aborted) throw new Error('Request cancelled');
      throw new Error(
        backend +
          (error instanceof Error && /timeout|abort/i.test(error.name)
            ? ' request timed out'
            : ' is unavailable'),
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && backend === 'tempo')
        throw new Error('Trace not found or no longer retained');
      throw new Error(backend + ' returned HTTP ' + response.status);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Empty upstream response');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > 16 * 1024 * 1024) {
          await reader.cancel();
          throw new Error(
            'Upstream result exceeds 16 MiB; narrow your filters',
          );
        }
        chunks.push(chunk.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
    } finally {
      reader.releaseLock();
    }
  }
  function rangeParams(f: DashboardFilters): Record<string, string> {
    return {
      start: String(BigInt(f.start) * 1000000n),
      end: String(BigInt(f.end) * 1000000n),
    };
  }
  async function searchTraces(search: TraceSearch, signal?: AbortSignal) {
    if (
      search.filters.route ||
      search.filters.browser ||
      search.filters.sessionId ||
      search.filters.search
    )
      throw new Error(
        'Use trace name, duration, and status filters for trace widgets; route, browser, session, and event text filters apply to Loki signals.',
      );
    const body = await upstream<Parameters<typeof normalizeSearch>[0]>(
      'tempo',
      '/api/search',
      {
        q: traceQuery(search),
        start: String(Math.floor(search.filters.start / 1000)),
        end: String(Math.ceil(search.filters.end / 1000)),
        limit: String(search.limit),
      },
      signal,
    );
    return {
      traces: normalizeSearch(body),
      limited: (body.traces?.length ?? 0) >= search.limit,
    };
  }
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (
      origin &&
      !/^http:\/\/(localhost|127\.0\.0\.1):(4201|4301)$/.test(origin)
    ) {
      return reply.code(403).send({ error: 'Origin is not allowed' });
    }
    reply.header('cache-control', 'no-store');
  });
  app.setErrorHandler((error, _request, reply) => {
    const err = error as Error & { statusCode?: number };
    reply.code(err.statusCode ?? 502).send({ error: err.message });
  });
  app.get('/api/health', async () => {
    const checks = await Promise.allSettled(
      Object.keys(urls).map(async (key) => {
        const backend = key as keyof typeof urls;
        const response = await fetcher(
          urls[backend].replace(/\/$/, '') + '/ready',
          { signal: AbortSignal.timeout(Math.min(timeout, 2000)) },
        );
        await response.body?.cancel();
        return response.ok;
      }),
    );
    return {
      loki: checks[0].status === 'fulfilled' && checks[0].value,
      tempo: checks[1].status === 'fulfilled' && checks[1].value,
    };
  });
  app.post('/api/filters', async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const f = parsed.data;
    const signal = requestSignal(request, reply);
    const result: FilterOptions = {
      apps: [],
      environments: [],
      releases: [],
      measurements: [],
      warnings: [],
    };
    const [labels, measurements] = await Promise.allSettled([
      upstream<{ data: Record<string, string>[] }>(
        'loki',
        '/loki/api/v1/series',
        { ...rangeParams(f), 'match[]': '{job="faro"}' },
        signal,
      ),
      upstream<LokiResponse>(
        'loki',
        '/loki/api/v1/query_range',
        {
          ...rangeParams(f),
          query: stream(f, 'measurement'),
          limit: '200',
          direction: 'backward',
        },
        signal,
      ),
    ]);
    if (labels.status === 'fulfilled') {
      const sets = labels.value.data ?? [];
      result.apps = [
        ...new Set(sets.map((s) => s['app_name']).filter(Boolean)),
      ].sort();
      result.environments = [
        ...new Set(
          sets
            .filter((s) => !f.app || s['app_name'] === f.app)
            .map((s) => s['app_environment'])
            .filter(Boolean),
        ),
      ].sort();
      result.releases = [
        ...new Set(
          sets
            .filter(
              (s) =>
                (!f.app || s['app_name'] === f.app) &&
                (!f.environment || s['app_environment'] === f.environment),
            )
            .map((s) => s['app_release'])
            .filter(Boolean),
        ),
      ].sort();
    } else
      result.warnings.push(
        'Filter discovery unavailable: ' + message(labels.reason),
      );
    if (measurements.status === 'fulfilled') {
      const found = new Map<string, { type: string; field: string }>();
      for (const event of normalizeLoki(measurements.value, 'stream').events ??
        []) {
        const fields = parseLogfmt(event.line);
        for (const [key, value] of Object.entries(fields)) {
          if (
            key.startsWith('value_') &&
            Number.isFinite(Number(value)) &&
            value !== ''
          ) {
            const item = { type: fields['type'] ?? '', field: key.slice(6) };
            found.set(item.type + ':' + item.field, item);
          }
        }
      }
      result.measurements = [...found.values()];
    } else
      result.warnings.push(
        'Measurement discovery unavailable: ' + message(measurements.reason),
      );
    return result;
  });
  app.post('/api/widgets/query', async (request, reply) => {
    const parsed = widgetsRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const controller = new AbortController();
    request.raw.on('aborted', () => controller.abort());
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    const { filters, widgets } = parsed.data;
    const results: WidgetResult[] = new Array(widgets.length);
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, widgets.length) }, async () => {
        while (next < widgets.length && !controller.signal.aborted) {
          const index = next++,
            widget = widgets[index];
          try {
            let data: WidgetData;
            if (widget.catalogId === 'traces') {
              data = await searchTraces(
                tracesRequestSchema.parse({ filters }),
                controller.signal,
              );
            } else {
              const plan = planWidget(
                widget.catalogId,
                filters,
                widget.settings,
              );
              const parts = await Promise.all(
                plan.queries.map(async ({ expression, name }) => {
                  const params: Record<string, string> =
                    plan.mode === 'instant'
                      ? { query: expression, time: String(filters.end / 1000) }
                      : {
                          ...rangeParams(filters),
                          query: expression,
                          step: String(
                            Math.max(
                              10,
                              Math.ceil((filters.end - filters.start) / 180000),
                            ),
                          ),
                          limit: '200',
                          direction: 'backward',
                        };
                  const raw = await upstream<LokiResponse>(
                    'loki',
                    plan.mode === 'instant'
                      ? '/loki/api/v1/query'
                      : '/loki/api/v1/query_range',
                    params,
                    controller.signal,
                  );
                  return normalizeLoki(
                    raw,
                    widgetById[widget.catalogId].kind,
                    name,
                  );
                }),
              );
              data =
                parts.length === 1
                  ? parts[0]
                  : { series: parts.flatMap((p) => p.series ?? []) };
            }
            results[index] = { id: widget.id, data, fetchedAt: Date.now() };
          } catch (error) {
            results[index] = {
              id: widget.id,
              error: message(error),
              fetchedAt: Date.now(),
            };
          }
        }
      }),
    );
    return { results };
  });
  app.post('/api/traces/search', async (request, reply) => {
    const parsed = tracesRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const controller = new AbortController();
    request.raw.on('aborted', () => controller.abort());
    reply.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    return searchTraces(parsed.data, controller.signal);
  });
  app.get<{ Params: { id: string } }>(
    '/api/traces/:id',
    async (request, reply) => {
      if (!/^[0-9a-f]{32}$/i.test(request.params.id))
        return reply
          .code(400)
          .send({ error: 'Trace ID must contain 32 hexadecimal characters' });
      const body = await upstream<Parameters<typeof normalizeTrace>[0]>(
        'tempo',
        '/api/traces/' + request.params.id,
        {},
        requestSignal(request, reply),
      );
      return normalizeTrace(body, request.params.id);
    },
  );
  return app;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Upstream query failed';
}
function requestSignal(
  request: FastifyRequest,
  reply: FastifyReply,
): AbortSignal {
  const controller = new AbortController();
  request.raw.once('aborted', () => controller.abort());
  reply.raw.once('close', () => {
    if (!reply.raw.writableEnded) controller.abort();
  });
  return controller.signal;
}
