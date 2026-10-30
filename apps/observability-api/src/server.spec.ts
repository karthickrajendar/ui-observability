import { describe, expect, it, vi } from 'vitest';
import { filtersSchema } from '@ui-observability/contracts';
import { buildServer } from './server';
const filters = filtersSchema.parse({ start: 1000, end: 3601000 });
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
describe('dashboard API', () => {
  it('isolates widget errors instead of failing every panel', async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      const q = new URL(String(url)).searchParams.get('query') ?? '';
      return q.includes('kind=~"exception"')
        ? json({}, 503)
        : json({
            status: 'success',
            data: { resultType: 'vector', result: [{ value: [3601, '3'] }] },
          });
    });
    const app = buildServer({ fetch: fetcher as typeof fetch });
    const response = await app.inject({
      method: 'POST',
      url: '/api/widgets/query',
      payload: {
        filters,
        widgets: [
          { id: 's', catalogId: 'sessions' },
          { id: 'e', catalogId: 'exceptions' },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().results).toEqual([
      expect.objectContaining({ id: 's', data: { value: 3 } }),
      expect.objectContaining({ id: 'e', error: 'loki returned HTTP 503' }),
    ]);
    await app.close();
  });
  it('rejects invalid inputs and origins before accessing upstream services', async () => {
    const fetcher = vi.fn();
    const app = buildServer({ fetch: fetcher });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/widgets/query',
          payload: { query: 'arbitrary' },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'GET', url: '/api/traces/not-a-trace' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/health',
          headers: { origin: 'https://untrusted.example' },
        })
      ).statusCode,
    ).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    await app.close();
  });
  it('reports unavailable sources separately and times out stalled upstream requests', async () => {
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Timeout', 'TimeoutError')),
            { once: true },
          );
        }),
    );
    const app = buildServer({ fetch: fetcher as typeof fetch, timeoutMs: 100 });
    const result = await app.inject({
      method: 'POST',
      url: '/api/widgets/query',
      payload: { filters, widgets: [{ id: 'x', catalogId: 'lcp' }] },
    });
    expect(result.json().results[0].error).toContain('timed out');
    const health = await app.inject('/api/health');
    expect(health.json()).toEqual({ loki: false, tempo: false });
    await app.close();
  });
  it('retrieves a complete trace without adding resource or time filters', async () => {
    const fetcher = vi.fn(async (url: unknown) => {
      expect(String(url)).toContain('/api/traces/');
      return json({ batches: [] });
    });
    const app = buildServer({ fetch: fetcher as typeof fetch });
    const id = 'a'.repeat(32);
    const response = await app.inject('/api/traces/' + id);
    expect(response.json()).toEqual({ traceId: id, spans: [] });
    expect(String(fetcher.mock.calls[0][0])).toBe(
      'http://127.0.0.1:3200/api/traces/' + id,
    );
    await app.close();
  });
});
