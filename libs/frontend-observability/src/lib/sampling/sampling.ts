/** Returns true when an item with the given rate (0..1) should be kept. */
export function shouldSample(rate: number, random: () => number = Math.random): boolean {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return true;
  }
  if (rate >= 1) {
    return true;
  }
  if (rate <= 0) {
    return false;
  }
  return random() < rate;
}

/**
 * Deterministic sampler keyed by traceId (FNV-1a 32-bit hash mapped to [0, 1)).
 * Ensures every span belonging to the same trace makes the identical sampling
 * decision so traces are never fragmented into orphan spans.
 */
export function shouldSampleTraceId(
  traceId: string | undefined,
  rate: number,
  fallbackRandom: () => number = Math.random
): boolean {
  if (typeof rate !== 'number' || Number.isNaN(rate)) {
    return true;
  }
  if (rate >= 1) {
    return true;
  }
  if (rate <= 0) {
    return false;
  }
  if (!traceId || typeof traceId !== 'string') {
    return shouldSample(rate, fallbackRandom);
  }
  let hash = 0x811c9dc5;
  for (let i = 0; i < traceId.length; i += 1) {
    hash ^= traceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const normalized = (hash >>> 0) / 0x100000000;
  return normalized < rate;
}

