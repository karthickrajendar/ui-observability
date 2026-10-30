import { describe, expect, it } from 'vitest';
import {
  filtersSchema,
  tracesRequestSchema,
  widgetCatalog,
  widgetsRequestSchema,
} from '@ui-observability/contracts';
import { planWidget, quote, selector, traceQuery } from './queries';

const filters = filtersSchema.parse({ start: 1000, end: 3601000 });
describe('query contracts', () => {
  it('has an explicit server template for every Loki catalog widget', () => {
    for (const widget of widgetCatalog.filter((w) => w.kind !== 'traces')) {
      const plan = planWidget(widget.id, filters);
      expect(plan.queries.length).toBeGreaterThan(0);
      expect(
        plan.queries.every((q) => q.expression.includes('job="faro"')),
      ).toBe(true);
      expect(plan.queries.every((q) => !q.expression.includes('$__'))).toBe(
        true,
      );
    }
  });
  it('quotes app, environment, and release values as data instead of query syntax', () => {
    const malicious = 'store"} | json | secret="x\\y\n';
    expect(
      selector({
        ...filters,
        app: malicious,
        environment: 'prod',
        release: 'v1',
      }),
    ).toBe(
      '{job="faro",app_name=' +
        quote(malicious) +
        ',app_environment="prod",app_release="v1"}',
    );
    expect(JSON.parse(quote(malicious))).toBe(malicious);
  });
  it('computes percentiles across samples and converts network nanoseconds in the backend', () => {
    expect(planWidget('lcp', filters).queries[0].expression).toContain(
      'quantile_over_time(0.75',
    );
    expect(planWidget('lcp', filters).queries[0].expression).toContain('by ()');
    expect(
      planWidget('fetch-latency', filters).queries[0].expression,
    ).toContain('/ 1000000');
    expect(
      planWidget('error-free', filters).queries[0].expression,
    ).not.toContain('clamp_min');
  });
  it('rejects arbitrary metric field expressions, unknown widgets, and unbounded ranges', () => {
    expect(
      widgetsRequestSchema.safeParse({
        filters,
        widgets: [
          {
            id: 'x',
            catalogId: 'custom-measurements',
            settings: { measurementField: 'duration_ms | line_format "leak"' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      widgetsRequestSchema.safeParse({
        filters,
        widgets: [{ id: 'x', catalogId: 'raw-query' }],
      }).success,
    ).toBe(false);
    expect(
      filtersSchema.safeParse({ start: 0, end: 8 * 86400000 }).success,
    ).toBe(false);
    expect(filtersSchema.safeParse({ start: 1000, end: 999 }).success).toBe(
      false,
    );
  });
  it('uses resource release filters and escapes trace operation regex metacharacters', () => {
    const search = tracesRequestSchema.parse({
      filters: {
        ...filters,
        app: 'demo-app',
        environment: 'local',
        release: 'demo-app@1',
      },
      name: 'GET /orders?x=(a)',
      minDurationMs: 2,
      status: 'error',
    });
    const q = traceQuery(search);
    expect(q).toContain('resource.app.release = "demo-app@1"');
    expect(q).toContain('resource.deployment.environment.name');
    expect(q).toContain('resource.deployment.environment =');
    expect(q).toContain('status = error');
    expect(q).toContain('duration >= 2ms');
    expect(q).toContain(quote('.*GET /orders\\?x=\\(a\\).*'));
  });
});
