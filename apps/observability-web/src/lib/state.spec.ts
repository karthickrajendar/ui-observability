import { describe, expect, it, vi } from 'vitest';
import { presets, type WidgetResult } from '@ui-observability/contracts';
import {
  allDashboards,
  loadDashboards,
  readFilters,
  reorderWidgets,
  saveDashboards,
  STORAGE_KEY,
  toFilters,
} from './state';
import { request, retainResults } from './api';
describe('personal dashboards', () => {
  const storage = (raw: string | null = null) => {
    let value = raw;
    return {
      getItem: () => value,
      setItem: (_key: string, next: string) => {
        value = next;
      },
    };
  };
  it('round-trips edited titles, settings, and layouts without changing presets', () => {
    const store = storage();
    const edited = structuredClone(presets[0]);
    edited.title = 'Checkout';
    edited.widgets[0].w = 6;
    saveDashboards(store, [edited]);
    const loaded = loadDashboards(store).dashboards;
    expect(allDashboards(loaded)[0].title).toBe('Checkout');
    expect(allDashboards(loaded)[0].widgets[0].w).toBe(6);
    expect(presets[0].title).toBe('RUM Overview');
    expect(STORAGE_KEY).toContain(':v1');
  });
  it('recovers valid entries when saved data contains malformed or unknown widgets', () => {
    expect(loadDashboards(storage('{broken')).dashboards).toEqual([]);
    const loaded = loadDashboards(
      storage(
        JSON.stringify({
          version: 1,
          dashboards: [
            presets[0],
            { ...presets[1], widgets: [{ id: 'bad', catalogId: 'missing' }] },
          ],
        }),
      ),
    );
    expect(loaded.dashboards).toHaveLength(1);
    expect(loaded.warning).toBeTruthy();
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(loadDashboards(blocked).warning).toBeTruthy();
    expect(() => saveDashboards(blocked, [])).toThrow('quota');
  });
  it('supports keyboard reordering without overlapping widgets', () => {
    const original = presets[0];
    const moved = reorderWidgets(original, original.widgets[1].id, -1);
    expect(moved.widgets[0].id).toBe(original.widgets[1].id);
    for (const a of moved.widgets)
      for (const b of moved.widgets) {
        if (a.id === b.id) continue;
        expect(
          a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y,
        ).toBe(true);
      }
    expect(original.widgets[0].y).toBe(0);
  });
});
describe('filters and refresh', () => {
  it('advances relative ranges at each fetch and preserves absolute ranges', () => {
    const relative = readFilters(
      new URLSearchParams('app=demo&range=900000&refresh=0'),
    );
    expect(toFilters(relative, 1000000)).toMatchObject({
      app: 'demo',
      start: 100000,
      end: 1000000,
    });
    expect(toFilters(relative, 1100000).start).toBe(200000);
    const absolute = readFilters(new URLSearchParams('from=1000&to=2000'));
    expect(toFilters(absolute, 999999)).toMatchObject({
      start: 1000,
      end: 2000,
    });
    expect(
      readFilters(new URLSearchParams('range=-1&refresh=abc&from=3&to=1')),
    ).toMatchObject({ range: 3600000, refresh: 30000, from: undefined });
  });
  it('retains only earlier successful widget data on errors and keeps its timestamp', () => {
    const previous: WidgetResult[] = [
      { id: 'a', data: { value: 42 }, fetchedAt: 1 },
    ];
    const merged = retainResults(
      [
        { id: 'a', error: 'offline', fetchedAt: 2 },
        { id: 'b', data: { value: null }, fetchedAt: 2 },
      ],
      previous,
    );
    expect(merged[0]).toMatchObject({
      data: { value: 42 },
      error: 'offline',
      fetchedAt: 1,
    });
    expect(merged[1].data?.value).toBeNull();
  });
  it('passes cancellation to fetch so changed filters can abort obsolete requests', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          ),
        ),
    );
    vi.stubGlobal('fetch', fetcher);
    const pending = request('widgets/query', {}, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
    vi.unstubAllGlobals();
  });
});
