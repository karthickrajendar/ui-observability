/// <reference types='vitest' />
import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const TEMPO_OTLP_HTTP_URL = process.env['TEMPO_OTLP_URL'] ?? 'http://localhost:4318/v1/traces';

function parseTraceparent(header: string | undefined): { traceId: string; parentSpanId: string } {
  if (typeof header === 'string') {
    const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/i.exec(header.trim());
    if (match) {
      return { traceId: match[1].toLowerCase(), parentSpanId: match[2].toLowerCase() };
    }
  }
  return {
    traceId: randomBytes(16).toString('hex'),
    parentSpanId: '',
  };
}

async function emitBackendSpansToTempo(params: {
  traceId: string;
  parentSpanId: string;
  serverSpanId: string;
  dbSpanId: string;
  startTimeMs: number;
  dbStartMs: number;
  dbEndMs: number;
  endTimeMs: number;
  url: string;
}): Promise<void> {
  const toNano = (ms: number) => `${BigInt(Math.round(ms * 1_000_000))}`;
  const payload = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'demo-api' } },
            { key: 'service.version', value: { stringValue: '1.0.0' } },
            { key: 'deployment.environment', value: { stringValue: 'local' } },
          ],
        },
        scopeSpans: [
          {
            scope: { name: 'demo-api-echo-middleware', version: '1.0.0' },
            spans: [
              {
                traceId: params.traceId,
                spanId: params.serverSpanId,
                ...(params.parentSpanId ? { parentSpanId: params.parentSpanId } : {}),
                name: 'GET /api/echo',
                kind: 2, // SPAN_KIND_SERVER
                startTimeUnixNano: toNano(params.startTimeMs),
                endTimeUnixNano: toNano(params.endTimeMs),
                attributes: [
                  { key: 'http.request.method', value: { stringValue: 'GET' } },
                  { key: 'http.route', value: { stringValue: '/api/echo' } },
                  { key: 'url.path', value: { stringValue: params.url.split('?')[0] } },
                  { key: 'http.response.status_code', value: { intValue: '200' } },
                ],
                status: { code: 1 },
              },
              {
                traceId: params.traceId,
                spanId: params.dbSpanId,
                parentSpanId: params.serverSpanId,
                name: 'SELECT orders FROM postgres',
                kind: 3, // SPAN_KIND_CLIENT
                startTimeUnixNano: toNano(params.dbStartMs),
                endTimeUnixNano: toNano(params.dbEndMs),
                attributes: [
                  { key: 'db.system', value: { stringValue: 'postgresql' } },
                  { key: 'db.operation', value: { stringValue: 'SELECT' } },
                  { key: 'db.sql.table', value: { stringValue: 'orders' } },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  };

  try {
    await fetch(TEMPO_OTLP_HTTP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Collector may be intentionally stopped in --outage tests; never fail the API response.
  }
}

/**
 * Same-origin echo API that parses the incoming W3C `traceparent` header from
 * the browser and emits child server + database spans to Tempo so Grafana displays
 * a true multi-service UI -> API -> DB distributed trace waterfall.
 */
function echoApiPlugin(): Plugin {
  return {
    name: 'demo-echo-api',
    configureServer(server) {
      server.middlewares.use('/api/echo', (req, res) => {
        const startTimeMs = Date.now();
        const rawTraceparent = req.headers['traceparent'];
        const traceparent = Array.isArray(rawTraceparent) ? rawTraceparent[0] : rawTraceparent;
        const { traceId, parentSpanId } = parseTraceparent(traceparent);
        const serverSpanId = randomBytes(8).toString('hex');
        const dbSpanId = randomBytes(8).toString('hex');
        const dbStartMs = startTimeMs + 15;

        setTimeout(() => {
          const endTimeMs = Date.now();
          const dbEndMs = Math.max(dbStartMs + 50, endTimeMs - 15);
          void emitBackendSpansToTempo({
            traceId,
            parentSpanId,
            serverSpanId,
            dbSpanId,
            startTimeMs,
            dbStartMs,
            dbEndMs,
            endTimeMs,
            url: req.url ?? '/api/echo',
          });

          res.setHeader('content-type', 'application/json');
          res.setHeader('traceresponse', `00-${traceId}-${serverSpanId}-01`);
          res.end(
            JSON.stringify({
              ok: true,
              receivedTraceparent: traceparent ?? null,
              traceId,
              backendSpanId: serverSpanId,
              ts: endTimeMs,
            })
          );
        }, 120);
      });
    },
  };
}


export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/demo-app',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [react(), echoApiPlugin()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    // Source maps stay on the server side; never expose them publicly in production.
    sourcemap: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    name: '@ui-observability/demo-app',
    watch: false,
    globals: true,
    environment: 'jsdom',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
