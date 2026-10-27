import { describe, expect, it } from 'vitest';

import { normalizeRoute } from './routes';

describe('normalizeRoute', () => {
  it('replaces numeric segments', () => {
    expect(normalizeRoute('/customer/123456/orders/987654')).toBe('/customer/:id/orders/:id');
  });

  it('replaces UUID segments', () => {
    expect(normalizeRoute('/tenants/6f1e0b8a-4a2f-4c6e-9a3b-2b1f0d9c8e7f/users')).toBe(
      '/tenants/:id/users'
    );
  });

  it('replaces long hex identifiers', () => {
    expect(normalizeRoute('/docs/9f86d081884c7d659a2feaa0c55ad015')).toBe('/docs/:id');
  });

  it('leaves static routes untouched', () => {
    expect(normalizeRoute('/settings/profile')).toBe('/settings/profile');
    expect(normalizeRoute('/')).toBe('/');
  });
});
