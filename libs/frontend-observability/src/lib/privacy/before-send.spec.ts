import { TransportItemType } from '@grafana/faro-web-sdk';
import type { TransportItem } from '@grafana/faro-web-sdk';
import { describe, expect, it } from 'vitest';

import { createTestConfig } from '../testing/fixtures';
import { createBeforeSendHook } from './before-send';
import { REDACTED } from './sanitize';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';

function makeItem(type: TransportItemType, payload: unknown): TransportItem {
  return {
    type,
    payload,
    meta: { page: { url: 'http://localhost/checkout?token=abc&step=2' } },
  } as TransportItem;
}

describe('createBeforeSendHook', () => {
  it('sanitizes the page URL on every item', () => {
    const hook = createBeforeSendHook(createTestConfig());
    const item = hook(makeItem(TransportItemType.LOG, { message: 'hello' }));
    expect(item?.meta.page?.url).toBe('http://localhost/checkout');
  });

  it('scrubs secrets from exception values and redacts sensitive context keys', () => {
    const hook = createBeforeSendHook(createTestConfig());
    const item = hook(
      makeItem(TransportItemType.EXCEPTION, {
        type: 'Error',
        value: `request failed, token was ${JWT}`,
        context: { password: 'hunter2', route: '/checkout' },
      })
    );
    const payload = item?.payload as { value: string; context: Record<string, string> };
    expect(payload.value).not.toContain(JWT);
    expect(payload.context['password']).toBe(REDACTED);
    expect(payload.context['route']).toBe('/checkout');
  });

  it('scrubs log messages', () => {
    const hook = createBeforeSendHook(createTestConfig());
    const item = hook(makeItem(TransportItemType.LOG, { message: `Bearer abc123 leaked` }));
    const payload = item?.payload as { message: string };
    expect(payload.message).not.toContain('abc123');
  });

  it('sanitizes event attributes', () => {
    const hook = createBeforeSendHook(createTestConfig());
    const item = hook(
      makeItem(TransportItemType.EVENT, {
        name: 'checkout_completed',
        attributes: { session: 'sess-1', amount: '42' },
      })
    );
    const payload = item?.payload as { attributes: Record<string, string> };
    expect(payload.attributes['session']).toBe(REDACTED);
    expect(payload.attributes['amount']).toBe('42');
  });

  it('drops measurements when the performance sampling rate is 0 and keeps them at 1', () => {
    const dropAll = createBeforeSendHook(
      createTestConfig({ sampling: { sessions: 1, traces: 1, performance: 0, events: 1 } })
    );
    expect(dropAll(makeItem(TransportItemType.MEASUREMENT, { type: 'web-vitals' }))).toBeNull();

    const keepAll = createBeforeSendHook(createTestConfig());
    const item = keepAll(
      makeItem(TransportItemType.MEASUREMENT, {
        type: 'custom-sli',
        values: { duration_ms: 120 },
        context: { api_key: 'secret', route: '/orders' },
      })
    );
    expect(item).not.toBeNull();
    const payload = item?.payload as { context: Record<string, string> };
    expect(payload.context['api_key']).toBe(REDACTED);
    expect(payload.context['route']).toBe('/orders');
  });

  it('samples traces deterministically by traceId so spans in a trace are never split', () => {
    const hook = createBeforeSendHook(
      createTestConfig({ sampling: { sessions: 1, traces: 0.5, performance: 1, events: 1 } })
    );
    const makeTraceBatch = (traceId: string) =>
      makeItem(TransportItemType.TRACE, {
        resourceSpans: [{ scopeSpans: [{ spans: [{ traceId, name: 'span-1' }] }] }],
      });

    const firstDecision = hook(makeTraceBatch('4bf92f3577b34da6a3ce929d0e0e4736')) !== null;
    for (let i = 0; i < 10; i += 1) {
      const nextDecision = hook(makeTraceBatch('4bf92f3577b34da6a3ce929d0e0e4736')) !== null;
      expect(nextDecision).toBe(firstDecision);
    }
  });


  it('drops traces when the trace sampling rate is 0 and sanitizes span URLs otherwise', () => {
    const dropAll = createBeforeSendHook(
      createTestConfig({ sampling: { sessions: 1, traces: 0, performance: 1, events: 1 } })
    );
    expect(dropAll(makeItem(TransportItemType.TRACE, { resourceSpans: [] }))).toBeNull();

    const keepAll = createBeforeSendHook(createTestConfig());
    const tracePayload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  attributes: [
                    { key: 'http.url', value: { stringValue: 'http://api/x?code=999' } },
                    { key: 'http.method', value: { stringValue: 'GET' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const item = keepAll(makeItem(TransportItemType.TRACE, tracePayload));
    expect(item).not.toBeNull();
    expect(tracePayload.resourceSpans[0].scopeSpans[0].spans[0].attributes[0].value.stringValue).toBe(
      'http://api/x'
    );
    expect(tracePayload.resourceSpans[0].scopeSpans[0].spans[0].attributes[1].value.stringValue).toBe(
      'GET'
    );
  });

  it('sanitizes all trace attributes, nested event attributes, names, and status messages', () => {
    const hook = createBeforeSendHook(createTestConfig());
    const tracePayload = {
      resourceSpans: [
        {
          resource: {
            attributes: [{ key: 'api_key', value: { stringValue: 'secret-key' } }],
          },
          scopeSpans: [
            {
              scope: {
                attributes: [{ key: 'instrumentation.token', value: { stringValue: 'secret-token' } }],
              },
              spans: [
                {
                  name: `request ${JWT}`,
                  attributes: [
                    { key: 'password', value: { stringValue: 'hunter2' } },
                    { key: 'detail', value: { stringValue: `Bearer secret ${JWT}` } },
                    { key: 'url.query', value: { stringValue: '?token=secret&step=2' } },
                  ],
                  events: [
                    {
                      name: 'exception',
                      attributes: [{ key: 'exception.message', value: { stringValue: `failed ${JWT}` } }],
                    },
                  ],
                  status: { message: `failed ${JWT}` },
                },
              ],
            },
          ],
        },
      ],
    };

    const item = hook(makeItem(TransportItemType.TRACE, tracePayload));
    expect(item).not.toBeNull();
    expect(tracePayload.resourceSpans[0].resource.attributes[0].value.stringValue).toBe(REDACTED);
    expect(tracePayload.resourceSpans[0].scopeSpans[0].scope.attributes[0].value.stringValue).toBe(
      REDACTED
    );
    const span = tracePayload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.name).not.toContain(JWT);
    expect(span.attributes[0].value.stringValue).toBe(REDACTED);
    expect(span.attributes[1].value.stringValue).not.toContain('secret');
    expect(span.attributes[2].value.stringValue).toBe('');
    expect(span.events[0].attributes[0].value.stringValue).not.toContain(JWT);
    expect(span.status.message).not.toContain(JWT);
  });
});
