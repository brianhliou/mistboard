import { afterEach, describe, expect, it, vi } from 'vitest';
import { type HostInfo, hostOfferedSpecIds } from './correspondence-host.js';
import { t } from './i18n/catalog.js';
import { buildLandingHostOpponent, landingHostRowVisible } from './landing-host-opponent.js';

const INFO: HostInfo = {
  host: { handle: 'brianhliou-dev', displayName: 'Brian' },
  daysPerMove: 2,
  gameSpecIds: ['xiangqi', 'jieqi'],
  limits: { perPlayer: 2, total: 15 },
  signedIn: true,
  isHost: false,
  canPlay: true,
  reason: null,
};

afterEach(() => {
  document.body.replaceChildren();
});

describe('landingHostRowVisible', () => {
  const base = {
    mode: 'lobby',
    timeMode: 'correspondence' as const,
    info: INFO,
    offeredSpecIds: ['xiangqi'],
  };

  it('shows for Online by correspondence with the offer on', () => {
    expect(landingHostRowVisible(base)).toBe(true);
  });

  it('hides for live play, other opponents, an off offer, the author and no shared variant', () => {
    expect(landingHostRowVisible({ ...base, timeMode: 'realtime' })).toBe(false);
    expect(landingHostRowVisible({ ...base, mode: 'pvp' })).toBe(false);
    expect(landingHostRowVisible({ ...base, mode: 'pve' })).toBe(false);
    expect(landingHostRowVisible({ ...base, info: null })).toBe(false);
    expect(landingHostRowVisible({ ...base, info: { ...INFO, isHost: true } })).toBe(false);
    expect(landingHostRowVisible({ ...base, offeredSpecIds: [] })).toBe(false);
  });
});

describe('hostOfferedSpecIds', () => {
  it('keeps the caller order and drops what the dialog does not offer', () => {
    expect(hostOfferedSpecIds(INFO, ['jieqi', 'banqi', 'xiangqi'])).toEqual(['jieqi', 'xiangqi']);
    expect(hostOfferedSpecIds(INFO, ['banqi'])).toEqual([]);
  });
});

describe('buildLandingHostOpponent', () => {
  const build = () => {
    const onChange = vi.fn();
    const row = buildLandingHostOpponent({ locale: 'en', onChange });
    document.body.append(row.section);
    const button = (value: string) =>
      row.section.querySelector<HTMLButtonElement>(`[data-play-with="${value}"]`)!;
    return { row, onChange, button };
  };

  it('picks the author only once his offer has loaded', () => {
    const { row, button, onChange } = build();
    expect(row.hostPicked()).toBe(false);
    row.setInfo(INFO);
    button('host').click();
    expect(row.hostPicked()).toBe(true);
    expect(row.summary()).toBe('Brian H. Liou');
    expect(button('host').getAttribute('aria-checked')).toBe('true');
    expect(onChange).toHaveBeenCalled();
    button('anyone').click();
    expect(row.hostPicked()).toBe(false);
    expect(row.summary()).toBe('Anyone');
  });

  it('disables the author with the reason on the control at either cap', () => {
    for (const [reason, short, full] of [
      [
        'player_limit_reached',
        'You have 2 games going',
        t('correspondence.hostPlayerLimit', { name: 'Brian H. Liou', limit: 2 }, 'en'),
      ],
      [
        'host_full',
        'Full, try again in a few days',
        t('correspondence.hostFull', { name: 'Brian H. Liou', limit: 15 }, 'en'),
      ],
    ] as const) {
      const { row, button } = build();
      row.setInfo(INFO);
      button('host').click();
      row.setInfo({ ...INFO, canPlay: false, reason });
      expect(button('host').disabled).toBe(true);
      expect(button('host').textContent).toContain(short);
      expect(button('host').title).toBe(full);
      // A capped offer falls back to an open seek.
      expect(row.hostPicked()).toBe(false);
      expect(button('anyone').classList.contains('selected')).toBe(true);
      document.body.replaceChildren();
    }
  });
});
