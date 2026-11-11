import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountReadoutsAdmin } from './readouts-admin.js';

const report = {
  report: {
    snapshotId: 'latest',
    verdict: 'action',
    trigger: 'weekly',
    generatedAt: '2026-11-02T17:00:00Z',
    periodStart: '2026-10-26T00:00:00Z',
  },
  summary: {
    title: '100 completed games this week',
    period: '2026-10-26 to 2026-11-01 · complete UTC week',
    summary: 'Games increased.',
    metrics: [{ label: 'Completed human games', current: 100, previous: 50, growth: true }],
    actions: [
      {
        state: 'New',
        title: '<img src=x onerror=alert(1)>',
        detail: 'Review the solution.',
        url: 'javascript:alert(1)',
        urgent: true,
      },
    ],
    extraActions: 1,
    breakdown: [],
    context: [],
    deploy: null,
  },
  markdown: '# Full detail',
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
function fixture() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/history'))
        return json({
          readouts: [
            {
              snapshotId: 'latest',
              periodStart: '2026-10-26',
              periodEnd: '2026-11-02',
              trigger: 'weekly',
              verdict: 'action',
              completedGames: 100,
              actions: 1,
            },
            {
              snapshotId: 'older',
              periodStart: '2026-10-19',
              periodEnd: '2026-10-26',
              trigger: 'weekly',
              verdict: 'healthy',
              completedGames: 50,
              actions: 0,
            },
          ],
        });
      if (url.includes('/snapshot?id=older'))
        return json({
          ...report,
          report: { ...report.report, snapshotId: 'older' },
          summary: {
            ...report.summary,
            metrics: [{ label: 'Completed human games', current: 50, previous: 40 }],
            title: '50 completed games this week',
          },
        });
      return json(report);
    }),
  );
}
describe('admin readouts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });
  it('shows a compact weekly memo with safe actions and no hero cards or folds', async () => {
    fixture();
    const root = document.createElement('div');
    await mountReadoutsAdmin(root);
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      '/api/admin/readouts/latest?trigger=weekly',
      expect.anything(),
    );
    expect(root.querySelector('.readouts-admin-numbers')?.textContent).toContain(
      '+50 (+100%) vs 50',
    );
    expect(root.querySelector('.readouts-admin-cards')).toBeNull();
    expect(root.querySelectorAll('.readouts-admin-numbers tbody tr')).toHaveLength(1);
    expect(root.querySelector('.admin-reporting-nav [aria-current="page"]')?.textContent).toBe(
      'Readouts',
    );
    expect(root.querySelector('article')?.textContent).toContain('Urgent');
    expect(root.querySelector('article img')).toBeNull();
    expect(root.querySelector('article a')?.getAttribute('href')).not.toContain('javascript:');
    expect(root.querySelector('details')).toBeNull();
    expect(root.querySelectorAll('select')).toHaveLength(1);
  });
  it('opens a historical snapshot without generating or sending a readout', async () => {
    fixture();
    const root = document.createElement('div');
    await mountReadoutsAdmin(root);
    const picker = root.querySelector<HTMLSelectElement>('[aria-label="Readout week"]')!;
    picker.value = 'older';
    picker.dispatchEvent(new Event('change'));
    await vi.waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        '/api/admin/readouts/snapshot?id=older',
        expect.anything(),
      ),
    );
    await vi.waitFor(() =>
      expect(root.querySelector('.readouts-admin-latest')?.textContent).not.toBe('Loading…'),
    );
    expect(picker.value).toBe('older');
    expect(root.querySelector('.readouts-admin-number')?.textContent).toBe('50');
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes('/generate'))).toBe(
      true,
    );
  });
  it('keeps a pre-summary snapshot readable and shows one access message when signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) =>
        String(url).includes('/history')
          ? json({ readouts: [] })
          : json({ ...report, summary: undefined }),
      ),
    );
    const root = document.createElement('div');
    await mountReadoutsAdmin(root);
    expect(root.querySelector('details')).toBeNull();
    expect(root.textContent).toContain('# Full detail');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({}, 401)),
    );
    await mountReadoutsAdmin(root);
    expect(root.textContent?.match(/Admin access required/g)).toHaveLength(1);
    expect(root.querySelector('.admin-reporting-nav')).toBeNull();
  });
});
