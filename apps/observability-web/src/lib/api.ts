import type { WidgetResult } from '@ui-observability/contracts';
export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers:
      body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error ?? 'Request failed (' + response.status + ')');
  return data;
}
export function retainResults(
  fresh: WidgetResult[],
  previous: WidgetResult[] = [],
): WidgetResult[] {
  return fresh.map((result) => {
    const old = previous.find((p) => p.id === result.id);
    return result.error && old?.data
      ? { ...result, data: old.data, fetchedAt: old.fetchedAt }
      : result;
  });
}
