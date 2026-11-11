import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveOpsRoute } from './ops-route.js';

const mounts = vi.hoisted(() => ({
  readout: vi.fn(async () => {}),
  metrics: vi.fn(async () => {}),
}));
vi.mock('./readouts-admin.js', () => ({ mountReadoutsAdmin: mounts.readout }));
vi.mock('./metrics.js', () => ({ mountMetrics: mounts.metrics }));

import { mountOps } from './ops-admin.js';

describe('one Ops area', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => window.history.replaceState(null, '', '/'));
  it('opens weekly readouts by default and keeps old metrics links on their section', () => {
    expect(resolveOpsRoute(new URL('https://mistboard.com/ops'))).toEqual({
      tab: 'readouts',
      href: '/ops',
    });
    expect(resolveOpsRoute(new URL('https://mistboard.com/readouts/'))).toEqual({
      tab: 'readouts',
      href: '/ops',
    });
    expect(resolveOpsRoute(new URL('https://mistboard.com/metrics'))).toEqual({
      tab: 'play',
      href: '/ops?tab=play',
    });
    expect(resolveOpsRoute(new URL('https://mistboard.com/metrics#deploy-history'))).toEqual({
      tab: 'operations',
      href: '/ops?tab=operations#deploy-history',
    });
  });
  it('preserves the selected tab, week and anchor in old links', () => {
    const route = resolveOpsRoute(
      new URL('https://mistboard.com/metrics?tab=retention&week=2026-10-26#evidence'),
    )!;
    const result = new URL(route.href, 'https://mistboard.com');
    expect(result.pathname).toBe('/ops');
    expect(result.searchParams.get('tab')).toBe('retention');
    expect(result.searchParams.get('week')).toBe('2026-10-26');
    expect(result.hash).toBe('#evidence');
    expect(resolveOpsRoute(new URL('https://mistboard.com/ops?tab=nonsense'))).toEqual({
      tab: 'readouts',
      href: '/ops',
    });
    expect(resolveOpsRoute(new URL('https://mistboard.com/stats'))).toBeNull();
  });
  it('mounts just the readout in the shared area and replaces the legacy address', async () => {
    window.history.replaceState(null, '', '/readouts');
    const root = document.createElement('div');
    await mountOps(root);
    expect(window.location.pathname).toBe('/ops');
    expect(mounts.readout).toHaveBeenCalledWith(root);
    expect(mounts.metrics).not.toHaveBeenCalled();
  });
  it('mounts just the admin metrics section and preserves the requested week', async () => {
    window.history.replaceState(null, '', '/metrics?week=2026-10-26&tab=activity');
    const root = document.createElement('div');
    await mountOps(root);
    expect(window.location.pathname).toBe('/ops');
    expect(new URLSearchParams(window.location.search).get('week')).toBe('2026-10-26');
    expect(mounts.metrics).toHaveBeenCalledWith(root, { admin: true });
    expect(mounts.readout).not.toHaveBeenCalled();
  });
});
