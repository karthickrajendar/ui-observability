import { describe, expect, it } from 'vitest';

import { isChunkLoadError } from './chunk-errors';

describe('isChunkLoadError', () => {
  it('recognizes webpack and vite chunk failures', () => {
    expect(isChunkLoadError(new Error('Loading chunk 42 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('ChunkLoadError: timeout'))).toBe(true);
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/a.js'))
    ).toBe(true);
    expect(isChunkLoadError('Importing a module script failed.')).toBe(true);
  });

  it('rejects unrelated errors', () => {
    expect(isChunkLoadError(new Error('TypeError: x is not a function'))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});
