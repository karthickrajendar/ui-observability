import { describe, expect, it } from 'vitest';

import { shouldSample, shouldSampleTraceId } from './sampling';

describe('shouldSample', () => {
  it('always keeps at rate 1 and always drops at rate 0', () => {
    expect(shouldSample(1)).toBe(true);
    expect(shouldSample(0)).toBe(false);
  });

  it('keeps items below the threshold and drops those above', () => {
    expect(shouldSample(0.5, () => 0.4)).toBe(true);
    expect(shouldSample(0.5, () => 0.6)).toBe(false);
  });

  it('keeps everything when the rate is not a number', () => {
    expect(shouldSample(Number.NaN)).toBe(true);
  });
});

describe('shouldSampleTraceId', () => {
  it('makes identical decisions for the same traceId across multiple spans', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const first = shouldSampleTraceId(traceId, 0.5);
    for (let i = 0; i < 10; i += 1) {
      expect(shouldSampleTraceId(traceId, 0.5)).toBe(first);
    }
  });

  it('respects 0 and 1 rates regardless of traceId', () => {
    expect(shouldSampleTraceId('4bf92f3577b34da6a3ce929d0e0e4736', 1)).toBe(true);
    expect(shouldSampleTraceId('4bf92f3577b34da6a3ce929d0e0e4736', 0)).toBe(false);
  });

  it('falls back to the random sampler when traceId is missing', () => {
    expect(shouldSampleTraceId(undefined, 0.5, () => 0.2)).toBe(true);
    expect(shouldSampleTraceId(undefined, 0.5, () => 0.8)).toBe(false);
  });
});

