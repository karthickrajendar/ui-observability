import { describe, expect, it } from 'vitest';

import { REDACTED, sanitizeAttributes, sanitizeHeaders, sanitizeUrl, scrubText } from './sanitize';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c';

describe('scrubText', () => {
  it('removes JWTs from free text', () => {
    expect(scrubText(`failed with token ${JWT} attached`)).not.toContain(JWT);
  });

  it('removes bearer tokens from free text', () => {
    const result = scrubText('header was Bearer abc.def-123 and more');
    expect(result).not.toContain('abc.def-123');
    expect(result).toContain(REDACTED);
  });

  it('leaves ordinary text untouched', () => {
    expect(scrubText('regular error message')).toBe('regular error message');
  });
});

describe('sanitizeUrl', () => {
  it('strips the entire query string when query parameters are not allowed', () => {
    expect(sanitizeUrl('https://api.company.com/orders?limit=10&token=secret', false)).toBe(
      'https://api.company.com/orders'
    );
  });

  it('redacts sensitive parameters when query parameters are allowed', () => {
    const result = sanitizeUrl(
      'https://api.company.com/search?q=shoes&token=secret&email=a@b.c&session=xyz',
      true
    );
    expect(result).toContain('q=shoes');
    expect(result).not.toContain('secret');
    expect(result).not.toContain('a%40b.c');
    expect(result).not.toContain('xyz');
  });

  it('always strips hash fragments and credentials', () => {
    const result = sanitizeUrl('https://user:pass@api.company.com/a#access_token=abc', true);
    expect(result).not.toContain('user');
    expect(result).not.toContain('pass');
    expect(result).not.toContain('access_token');
  });

  it('fails closed on unparseable input', () => {
    const result = sanitizeUrl('::::?token=abc', false);
    expect(result).not.toContain('token=abc');
  });
});

describe('sanitizeHeaders', () => {
  it('redacts Authorization, Cookie, and Set-Cookie regardless of casing', () => {
    const result = sanitizeHeaders({
      Authorization: 'Bearer topsecret',
      Cookie: 'sid=123',
      'set-cookie': 'sid=123',
      'X-Api-Key': 'k-123',
      accept: 'application/json',
    });
    expect(result['Authorization']).toBe(REDACTED);
    expect(result['Cookie']).toBe(REDACTED);
    expect(result['set-cookie']).toBe(REDACTED);
    expect(result['X-Api-Key']).toBe(REDACTED);
    expect(result['accept']).toBe('application/json');
  });
});

describe('sanitizeAttributes', () => {
  it('redacts sensitive keys', () => {
    const result = sanitizeAttributes({
      password: 'hunter2',
      refresh_token: 'r-1',
      customer_email: 'a@b.c',
      code: 'oauth-code',
      auth_code: 'oauth-code-2',
      'http.response.status_code': '200',
      route: '/orders',
    });
    expect(result['password']).toBe(REDACTED);
    expect(result['refresh_token']).toBe(REDACTED);
    expect(result['customer_email']).toBe(REDACTED);
    expect(result['code']).toBe(REDACTED);
    expect(result['auth_code']).toBe(REDACTED);
    expect(result['http.response.status_code']).toBe('200');
    expect(result['route']).toBe('/orders');
  });


  it('scrubs JWTs inside non-sensitive values', () => {
    const result = sanitizeAttributes({ detail: `jwt was ${JWT}` });
    expect(result['detail']).not.toContain(JWT);
  });

  it('sanitizes URL-valued attributes', () => {
    const result = sanitizeAttributes({ request_url: 'https://x.com/a?code=123' }, false);
    expect(result['request_url']).toBe('https://x.com/a');
  });

  it('drops null and undefined values and stringifies the rest', () => {
    const result = sanitizeAttributes({ a: undefined, b: null, c: 42, d: true });
    expect(result).toEqual({ c: '42', d: 'true' });
  });
});
