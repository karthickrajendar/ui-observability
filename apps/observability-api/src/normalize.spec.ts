import { describe, expect, it } from 'vitest';
import { normalizeLoki, normalizeTrace, parseLogfmt } from './normalize';
describe('Loki normalization', () => {
  it('preserves error messages named value alongside their aggregate count', () => {
    const data = normalizeLoki(
      {
        status: 'success',
        data: {
          resultType: 'vector',
          result: [
            {
              metric: { type: 'Error', value: 'Checkout failed' },
              value: [1, '4'],
            },
          ],
        },
      },
      'table',
    );
    expect(data.columns).toEqual(['type', 'value', 'count']);
    expect(data.rows).toEqual([
      { type: 'Error', value: 'Checkout failed', count: 4 },
    ]);
  });
  it('keeps trace correlation from structured metadata and receiver-compatible context', () => {
    const id = '4bf92f3577b34da6a3ce929d0e0e4736';
    const data = normalizeLoki(
      {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              values: [
                ['1000000000', 'kind=log', { trace_id: id }],
                ['2000000000', 'kind=exception context_trace_id=' + id],
              ],
            },
          ],
        },
      },
      'stream',
    );
    expect(data.events?.map((e) => e.traceId)).toEqual([id, id]);
  });
  it('parses quoted logfmt values and preserves trace context without rendering HTML', () => {
    const fields = parseLogfmt(
      'kind=exception value="Failed \\"checkout\\"\\nretry" trace_id=4bf92f3577b34da6a3ce929d0e0e4736 payload="<script>alert(1)</script>"',
    );
    expect(fields['value']).toBe('Failed "checkout"\nretry');
    expect(fields['payload']).toContain('<script>');
    const data = normalizeLoki(
      {
        status: 'success',
        data: {
          resultType: 'streams',
          result: [
            {
              stream: { app_name: 'demo' },
              values: [
                [
                  '1000000000',
                  'kind=log trace_id=4bf92f3577b34da6a3ce929d0e0e4736',
                ],
              ],
            },
          ],
        },
      },
      'stream',
    );
    expect(data.events?.[0]).toMatchObject({
      timestamp: 1000,
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      fields: { app_name: 'demo' },
    });
  });
  it('distinguishes empty samples, undefined ratios, and actual zero values', () => {
    const stat = (value: string) =>
      normalizeLoki(
        {
          status: 'success',
          data: { resultType: 'vector', result: [{ value: [1, value] }] },
        },
        'stat',
      ).value;
    expect(stat('NaN')).toBeNull();
    expect(stat('+Inf')).toBeNull();
    expect(stat('0')).toBe(0);
    expect(
      normalizeLoki(
        { status: 'success', data: { resultType: 'vector', result: [] } },
        'gauge',
      ).value,
    ).toBeNull();
    expect(() =>
      normalizeLoki({ status: 'error', error: 'bad query' }, 'stat'),
    ).toThrow('bad query');
  });
});
describe('Tempo normalization', () => {
  it('keeps API/database spans, decodes protobuf IDs, and preserves precise durations', () => {
    const body = {
      batches: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'demo-app' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  spanId: '1111111111111111',
                  name: 'UI',
                  startTimeUnixNano: '1793376000000000000',
                  endTimeUnixNano: '1793376000100000000',
                },
              ],
            },
          ],
        },
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'demo-api' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  spanId: Buffer.from('2222222222222222', 'hex').toString(
                    'base64',
                  ),
                  parentSpanId: Buffer.from('1111111111111111', 'hex').toString(
                    'base64',
                  ),
                  name: 'DB',
                  startTimeUnixNano: '1793376000000000001',
                  endTimeUnixNano: '1793376000001000001',
                  status: { code: 'STATUS_CODE_ERROR' },
                  events: [
                    {
                      name: 'exception',
                      timeUnixNano: '1793376000000500001',
                      attributes: [
                        {
                          key: 'exception.message',
                          value: { stringValue: 'failure' },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const trace = normalizeTrace(body, 'a'.repeat(32));
    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[1]).toMatchObject({
      spanId: '2222222222222222',
      parentSpanId: '1111111111111111',
      durationMs: 1,
      service: 'demo-api',
      status: 'error',
    });
    expect(trace.spans[1].events[0].attributes['exception.message']).toBe(
      'failure',
    );
  });
});
