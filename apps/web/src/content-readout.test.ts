// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildContentReadout, type ContentPayload, loadContentReadout } from './content-readout.js';

const row = (slug: string, n: number) => ({
  slug,
  title: slug,
  publishedAt: '2026-10-01',
  ageDays: 38,
  current: {
    visitors: n,
    boardUsers: 2,
    ctaUsers: 1,
    entryFirstPlayers: 1,
    entryVisits: 4,
    studyUsers: 2,
    puzzleUsers: 0,
    returnedVisitors: 1,
    matureVisitors: 3,
    movedVisits: 1,
  },
  previous: { visitors: 1 },
});
const payload: ContentPayload = {
  report: {
    content: {
      status: 'available',
      collectedAt: '2026-11-09T17:23:00Z',
      periodStart: '2026-10-12T00:00:00Z',
      periodEnd: '2026-11-09T00:00:00Z',
      previousPeriodStart: '2026-09-14T00:00:00Z',
      articles: [row('Alpha', 2), row('Beta', 5)],
    },
  },
  summary: {
    content: ['Shared stored observation: Beta has 5 visitors.'],
    contentCaveats: ['Assisted outcomes overlap.'],
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});
describe('stored content activity table', () => {
  it('renders shared observations, source dates, denominators, search and accessible sorting', () => {
    const view = buildContentReadout(payload);
    document.body.append(view);
    expect(view.textContent).toContain('Shared stored observation: Beta has 5 visitors.');
    expect(view.textContent).toContain('2026-11-09T17:23:00Z');
    expect(view.textContent).toContain('1 / 4');
    expect(view.textContent).toContain('1 / 3');
    expect(view.textContent).toContain('partial coverage');
    expect(view.querySelector('tbody tr')?.textContent).toContain('Beta');
    const title = Array.from(view.querySelectorAll('button')).find(
      (el) => el.textContent === 'Article',
    )!;
    title.click();
    expect(view.querySelector('tbody tr')?.textContent).toContain('Alpha');
    const input = view.querySelector('input')!;
    input.value = 'beta';
    input.dispatchEvent(new Event('input'));
    expect(view.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(view.querySelector('tbody')?.textContent).toContain('Beta');
    input.value = 'unknown';
    input.dispatchEvent(new Event('input'));
    expect(view.textContent).toContain('No matching articles');
  });
  it('old snapshots and unavailable/auth failures show unavailable without zeros or public data requests', async () => {
    expect(buildContentReadout({ report: {} }).textContent).toContain('unavailable');
    expect(buildContentReadout(null).querySelector('table')).toBeNull();
    const fetch = vi.fn(async () => new Response('{}', { status: 403 }));
    vi.stubGlobal('fetch', fetch);
    expect((await loadContentReadout()).textContent).toContain('unavailable');
    expect(fetch).toHaveBeenCalledWith(
      '/api/admin/readouts/latest',
      expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }),
    );
  });
});
