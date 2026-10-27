/**
 * Centralized telemetry sanitization. Every telemetry path (RUM events,
 * errors, logs, traces) must pass through these helpers before leaving
 * the browser.
 */

export const REDACTED = '[REDACTED]';

/** Query parameters / attribute keys that must never leave the browser unredacted. */
const SENSITIVE_KEY_PATTERN =
  /(?:^|[-_.])(?:token|access[-_]?token|refresh[-_]?token|id[-_]?token|(?:auth|authorization|verification|recovery|otp|pin|pass)[-_]?code|email|password|passwd|pwd|authorization|auth|account|customer|session|secret|api[-_]?key|apikey|jwt|signature|sig|credential|ssn|card)(?:$|[-_.])|^(?:token|code|email|password|authorization|account|customer|session|secret|key)$/i;


const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
]);

/** JWTs (three base64url segments starting with eyJ) and bearer tokens embedded in free text. */
const JWT_PATTERN = /\beyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]*/g;
const BEARER_PATTERN = /\bBearer\s+[\w.~+/=-]+/gi;
const URL_ATTRIBUTE_KEYS = new Set(['http.url', 'url.full', 'http.target']);
const QUERY_ATTRIBUTE_KEYS = new Set(['http.query', 'url.query']);

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/** Removes secret-looking values (JWTs, bearer tokens) from a free-text string. */
export function scrubText(value: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }
  return value.replace(JWT_PATTERN, REDACTED).replace(BEARER_PATTERN, REDACTED);
}

function sanitizeQuery(query: string, allowQueryParameters: boolean): string {
  if (!allowQueryParameters) {
    return '';
  }

  const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
  for (const [key, value] of params) {
    params.set(key, isSensitiveKey(key) ? REDACTED : scrubText(value));
  }
  return params.toString();
}

/** Sanitizes an attribute string while preserving the attribute's original name. */
export function sanitizeAttributeString(
  key: string,
  value: string,
  allowQueryParameters = false
): string {
  if (isSensitiveKey(key)) {
    return REDACTED;
  }
  if (QUERY_ATTRIBUTE_KEYS.has(key.toLowerCase())) {
    return sanitizeQuery(value, allowQueryParameters);
  }
  if (
    URL_ATTRIBUTE_KEYS.has(key.toLowerCase()) ||
    /^https?:\/\//i.test(value) ||
    /url$/i.test(key)
  ) {
    return sanitizeUrl(value, allowQueryParameters);
  }
  return scrubText(value);
}

/** Sanitizes manual span attributes without changing their primitive types. */
export function sanitizeSpanAttributes(
  attributes: Record<string, string | number | boolean> | undefined,
  allowQueryParameters = false
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (typeof value === 'string') {
      result[key] = sanitizeAttributeString(key, value, allowQueryParameters);
    } else {
      result[key] = isSensitiveKey(key) ? REDACTED : value;
    }
  }
  return result;
}

/**
 * Sanitizes a URL for telemetry.
 *
 * - `allowQueryParameters: false` (default): the entire query string and hash are dropped.
 * - `allowQueryParameters: true`: sensitive parameters are redacted, the rest kept.
 */
export function sanitizeUrl(url: string, allowQueryParameters = false): string {
  if (typeof url !== 'string' || url.length === 0) {
    return url;
  }
  try {
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const parsed = new URL(url, base);

    if (!allowQueryParameters) {
      parsed.search = '';
    } else {
      const params = parsed.searchParams;
      const keys = Array.from(params.keys());
      for (const key of keys) {
        if (isSensitiveKey(key)) {
          params.set(key, REDACTED);
        } else {
          const value = params.get(key);
          if (value !== null) {
            params.set(key, scrubText(value));
          }
        }
      }
    }
    parsed.hash = '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    // Unparseable input: fail closed by scrubbing free text and dropping any query.
    return scrubText(url.split('?')[0].split('#')[0]);
  }
}

/** Redacts sensitive headers and scrubs secret-looking values from the rest. */
export function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    result[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : scrubText(value);
  }
  return result;
}

/**
 * Sanitizes a flat attribute map: sensitive keys are redacted, string values
 * are scrubbed for embedded secrets, URL-valued attributes are URL-sanitized.
 */
export function sanitizeAttributes<T extends Record<string, unknown>>(
  attributes: T | undefined,
  allowQueryParameters = false
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attributes) {
    return result;
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
      continue;
    }
    result[key] = sanitizeAttributeString(
      key,
      typeof value === 'string' ? value : String(value),
      allowQueryParameters
    );
  }
  return result;
}
