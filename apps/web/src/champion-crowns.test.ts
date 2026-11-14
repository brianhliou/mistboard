import { afterEach, describe, expect, it } from 'vitest';
import { ensureLocaleCatalog } from './i18n/catalog.js';
import {
  participantProfileTarget,
  playerNameEl,
  profileTargetFor,
  reviewSeatProfiles,
} from './profile-link.js';

const champions = [
  { variant: 'xiangqi', timeClass: 'blitz' },
  { variant: 'jungle_flip', timeClass: 'correspondence' },
] as const;

afterEach(() => window.history.replaceState(null, '', '/'));

describe('champion crowns', () => {
  it.each([
    ['en', '/', ['Xiangqi blitz champion', 'Flip Jungle correspondence champion']],
    ['zh-Hans', '/zh-hans/', ['象棋闪电冠军', '翻翻兽棋通信对局冠军']],
    ['zh-Hant', '/zh-hant/', ['象棋閃電冠軍', '翻翻獸棋通信對局冠軍']],
  ] as const)(
    'labels every championship in %s with matching tooltip and accessible text',
    async (locale, path, labels) => {
      await ensureLocaleCatalog(locale);
      window.history.replaceState(null, '', path);
      const name = playerNameEl(
        'Alice',
        profileTargetFor({ handle: 'alice', champions }),
        'clock-name',
      );
      const icons = [...name.querySelectorAll<HTMLImageElement>('img.champion-crown')];
      expect(icons.map((icon) => icon.alt)).toEqual(labels);
      for (const [index, icon] of icons.entries()) {
        expect(icon.getAttribute('src')).toBe('/champion-crown.png');
        expect(icon.title).toBe(labels[index]);
        expect(icon.getAttribute('aria-label')).toBe(labels[index]);
        expect(icon.width).toBe(20);
        expect(icon.height).toBe(20);
      }
      expect(name.textContent).toBe('Alice');
      expect(name.getAttribute('href')).toBe('/@/alice');
    },
  );

  it.each([
    ['en', '/', ['Fog Chess bullet champion', 'Banqi rapid champion']],
    ['zh-Hans', '/zh-hans/', ['迷雾国际象棋子弹冠军', '暗棋快速冠军']],
    ['zh-Hant', '/zh-hant/', ['迷霧西洋棋子彈冠軍', '暗棋快速冠軍']],
  ] as const)('uses existing bullet and rapid terms in %s', async (locale, path, labels) => {
    await ensureLocaleCatalog(locale);
    window.history.replaceState(null, '', path);
    const name = playerNameEl(
      'Alice',
      profileTargetFor({
        handle: 'alice',
        champions: [
          { variant: 'fog', timeClass: 'bullet' },
          { variant: 'banqi', timeClass: 'rapid' },
        ],
      }),
      'name',
    );
    expect([...name.querySelectorAll('img')].map((icon) => icon.alt)).toEqual(labels);
  });

  it('keeps championships on the correct review seat, including chess and Gomoku mappings', () => {
    const players = [
      { color: 'white', handle: 'alice', champions },
      { color: 'black', handle: 'bob', champions: [] },
    ];
    for (const [first, second] of [
      ['white', 'black'],
      ['black', 'white'],
    ]) {
      const profiles = reviewSeatProfiles(players, first, second);
      for (const slot of ['red', 'black'] as const) {
        const target = profiles[slot];
        const name = playerNameEl('Seat', target, 'review-seat__name');
        expect(name.querySelectorAll('.champion-crown')).toHaveLength(
          target?.kind === 'user' && target.handle === 'alice' ? 2 : 0,
        );
      }
    }
  });

  it('preserves championships for a persisted user participant', () => {
    const target = participantProfileTarget({
      color: 'red',
      displayName: 'Alice',
      subjectType: 'user',
      subjectId: 'internal-id',
      visibility: 'public',
      handle: 'alice',
      champions: [...champions],
    });
    expect(playerNameEl('Alice', target, 'name').querySelectorAll('.champion-crown')).toHaveLength(
      2,
    );
  });

  it.each([
    { state: 'missing', value: undefined },
    { state: 'empty', value: [] },
  ])('removes crowns when championships become $state', ({ value }) => {
    const host = document.createElement('div');
    host.append(
      playerNameEl('Alice', profileTargetFor({ handle: 'alice', champions }), 'clock-name'),
    );
    expect(host.querySelectorAll('.champion-crown')).toHaveLength(2);
    const name = playerNameEl(
      'Alice',
      profileTargetFor({ handle: 'alice', champions: value }),
      'clock-name',
    );
    host.replaceChildren(name);
    expect(host.textContent).toBe('Alice');
    expect(host.querySelector('.champion-crowns')).toBeNull();
    expect(name.innerHTML).not.toContain('vacant');
  });

  it('renders championships only for linkable user identities', () => {
    expect(
      playerNameEl(
        'Alice',
        profileTargetFor({ handle: 'alice', champions }),
        'name',
      ).querySelectorAll('.champion-crown'),
    ).toHaveLength(2);
    for (const identity of [{ champions }, { botId: 'misty', champions }]) {
      expect(
        playerNameEl('Seat', profileTargetFor(identity), 'name').querySelector('.champion-crowns'),
      ).toBeNull();
    }
  });

  it('retains the champion label if the image cannot load', () => {
    const name = playerNameEl('Alice', profileTargetFor({ handle: 'alice', champions }), 'name');
    const icon = name.querySelector('img.champion-crown');
    expect(icon).not.toBeNull();
    icon?.dispatchEvent(new Event('error'));
    const fallback = name.querySelector('.champion-crown[role="img"]');
    expect(fallback?.getAttribute('title')).toBe('Xiangqi blitz champion');
    expect(fallback?.getAttribute('aria-label')).toBe('Xiangqi blitz champion');
    expect(fallback?.textContent).toBe('◇');
  });
});
