import { afterEach, describe, expect, it, vi } from 'vitest';
import { landingNavigationKind, landingRoomTenantForUrl } from './landing.js';

// A correspondence seek posted from the homepage navigates to /correspondence
// through the landing's room navigator. Swapped in as a room, it mounted the
// live shell with no room ("Access rejected"); only room URLs swap in place.
describe('landing navigation kind', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['false', 'true'])('routes FFQ directly to its live client with flag=%s', (flag) => {
    vi.stubEnv('VITE_FFQ_BANQI_ENABLED', flag);
    for (const url of ['/room/ffq_public', '/?room=ffq_public']) {
      expect(landingNavigationKind(url)).toBe('room');
      expect(landingRoomTenantForUrl(url)?.gameSpecId ?? null).toBe(
        flag === 'true' ? 'ffq-banqi' : null,
      );
    }
  });
  it('loads plain pages normally', () => {
    expect(landingNavigationKind('/correspondence')).toBe('page');
    expect(landingNavigationKind('/correspondence?seek=1')).toBe('page');
    expect(landingNavigationKind('/puzzles')).toBe('page');
  });

  it('swaps room URLs in place', () => {
    expect(landingNavigationKind('/room/xq_abc123')).toBe('room');
    expect(landingNavigationKind('/room/tkb_d52a34fc')).toBe('room');
    expect(landingNavigationKind('/?room=xq_abc123')).toBe('room');
  });
});
