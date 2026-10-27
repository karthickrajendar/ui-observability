import { describe, expect, it } from 'vitest';

import { buildRelease } from './release';

describe('buildRelease', () => {
  it('combines name, version, and short commit sha', () => {
    expect(
      buildRelease({
        name: 'customer-portal',
        version: '2026.08.18',
        environment: 'production',
        commitSha: 'abc1234def5678',
      })
    ).toBe('customer-portal@2026.08.18+abc1234');
  });

  it('omits the sha suffix when no commit is provided', () => {
    expect(buildRelease({ name: 'app', version: '1.0.0', environment: 'dev' })).toBe('app@1.0.0');
  });

  it('prefers an explicit release identifier', () => {
    expect(
      buildRelease({
        name: 'app',
        version: '1.0.0',
        environment: 'dev',
        release: 'custom-release-42',
      })
    ).toBe('custom-release-42');
  });
});
