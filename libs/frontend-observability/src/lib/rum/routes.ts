const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const LONG_HEX_SEGMENT = /^[0-9a-f]{16,}$/i;

/**
 * Converts a concrete pathname into a low-cardinality route template,
 * e.g. /customer/123456/orders/987654 -> /customer/:id/orders/:id
 */
export function normalizeRoute(pathname: string): string {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return pathname;
  }
  const segments = pathname.split('/').map((segment) => {
    if (segment.length === 0) {
      return segment;
    }
    if (NUMERIC_SEGMENT.test(segment) || UUID_SEGMENT.test(segment) || LONG_HEX_SEGMENT.test(segment)) {
      return ':id';
    }
    return segment;
  });
  return segments.join('/') || '/';
}
