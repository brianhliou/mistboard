import { readFileSync } from 'node:fs';
import type { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeaturedGame } from './game-display.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { createMoveList } from './review/move-list.js';
import {
  invalidateWatchFeedCache,
  mountWatch,
  renderWatchPlayers,
  revealWatchPhoneMove,
} from './watch-route.js';

vi.mock('./replay.js', () => ({
  mountReplay: async (_root: HTMLElement, roomId: string) => ({
    activeSampleId: () => roomId,
    plyCount: () => 4,
    jumpToPly: vi.fn(),
    destroy: vi.fn(),
    moveEntries: () =>
      Array.from({ length: 4 }, (_, i) => ({ ply: i + 1, label: `Move ${i + 1}` })),
    clockAtPly: () => ({ first: 300_000, second: 299_000, toMove: null, initialMs: 300_000 }),
    setPov: vi.fn(),
    availablePovs: () => ['white', 'truth', 'black'],
  }),
}));

const browser = window as unknown as Window;
const originalSize = { width: window.innerWidth, height: window.innerHeight };
const channels = ['top', 'xiangqi', 'three-kingdoms-banqi'].map((id) => ({
  id,
  label: id,
  family: 'xiangqi',
  gameSpecIds: [],
  sealedCount: 0,
  unlockedCount: 0,
  topPlayer: { name: 'A player with a long name', rating: 1500 },
}));
let games: FeaturedGame[];
let root: HTMLElement;
let style: HTMLStyleElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T20:00:00.000Z'));
  games = [];
  invalidateWatchFeedCache();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () =>
        url.includes('/api/watch/live')
          ? { featured: null }
          : {
              activeChannel: 'top',
              channels,
              unlocked: games,
              unlockLimit: 64,
              sealedCount: 0,
              now: '2026-11-15T20:00:00.000Z',
            },
    })),
  );
  style = document.createElement('style');
  style.textContent = [
    'src/review/review-shell.css',
    'src/game-shell.css',
    'src/review/game-meta-card.css',
    'src/review/move-list.css',
    'src/watch-route.css',
  ]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  document.head.append(style);
  root = document.createElement('div');
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  style.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  browser.happyDOM.setWindowSize(originalSize);
  invalidateWatchFeedCache();
});

function element(selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  expect(el, selector).not.toBeNull();
  return el!;
}

describe('Watch phone layout (#838)', () => {
  it.each([320, 390, 768])('puts reachable channels before the board at %ipx', async (width) => {
    browser.happyDOM.setWindowSize({ width, height: 844 });
    await mountWatch(root);

    const rows = getComputedStyle(element('.review-shell__cluster')).gridTemplateAreas.match(
      /"[^"]+"/g,
    );
    expect(rows?.slice(0, 4)).toEqual([
      '"channels channels channels"',
      '"headline headline headline"',
      '"player-top captures-top clock-top"',
      '"board board board"',
    ]);
    const rail = element('.watch-channel-rail');
    expect(getComputedStyle(rail).gridArea).toBe('channels');
    // Every wrapper between the rail and grid must dissolve or grid-area has no effect.
    for (
      let parent = rail.parentElement;
      parent && !parent.classList.contains('review-shell__cluster');
      parent = parent.parentElement
    ) {
      expect(getComputedStyle(parent).display).toBe('contents');
    }
    const list = element('.watch-channel-list');
    expect(getComputedStyle(list).flexDirection).toBe('row');
    expect(getComputedStyle(list).overflowX).toBe('auto');
    expect(list.querySelectorAll('a')).toHaveLength(channels.length);
    expect(list.querySelector('[aria-current="page"]')?.getAttribute('href')).toBe(
      '/watch?channel=top',
    );
    expect(getComputedStyle(element('.watch-channel-link')).minHeight).toBe('44px');
    expect(getComputedStyle(element('.watch-channel-link')).flexShrink).toBe('0');
    expect(getComputedStyle(element('.watch-channel-player')).display).toBe('none');
  });

  it('keeps long linked names in one tappable seat line on a phone', async () => {
    browser.happyDOM.setWindowSize({ width: 390, height: 844 });
    await mountWatch(root);
    renderWatchPlayers(element('[data-player-top]'), element('[data-player-bottom]'), {
      roomId: 'xq_phone',
      variant: 'xiangqi',
      mode: 'pve',
      result: 'red-wins',
      termination: 'resignation',
      plyCount: 40,
      corpusId: null,
      whiteName: null,
      blackName: null,
      participants: [
        {
          color: 'red',
          displayName: 'Misty',
          subjectType: 'bot',
          subjectId: 'misty',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'A very long player name',
          subjectType: 'user',
          subjectId: 'u1',
          handle: 'long-name',
          visibility: 'public',
        },
      ],
    });
    const linkedName = element('.watch-game-table a.clock-name');
    expect(linkedName.textContent).toBe('A very long player name');
    const name = getComputedStyle(linkedName);
    expect(name.whiteSpace).toBe('nowrap');
    expect(name.textOverflow).toBe('ellipsis');
    expect(name.minHeight).toBe('44px');
    expect(getComputedStyle(element('.watch-player-bot')).fontSize).toBe('11px');
  });

  it.each([320, 390, 768])(
    'folds the card into a linked headline subline at %ipx',
    async (width) => {
      browser.happyDOM.setWindowSize({ width, height: 844 });
      games = [
        {
          roomId: 'phone-game',
          variant: 'dark-chess',
          result: 'white-wins',
          termination: 'checkmate',
          plyCount: 4,
          corpusId: null,
          whiteName: 'First',
          blackName: 'Second',
          rated: false,
          initialMs: 300_000,
          incrementMs: 0,
          endedAt: '2026-11-13T20:00:00.000Z',
        },
      ];
      await mountWatch(root);
      expect(getComputedStyle(element('.watch-meta')).display).toBe('none');
      expect(element('.watch-meta .game-meta-card')).toBeTruthy();
      const headline = element('.watch-headline');
      expect(getComputedStyle(headline).display).toBe('block');
      expect(headline.children).toHaveLength(2);
      expect(element('.watch-headline__matchup').textContent).toContain('First vs Second');
      expect(element('.watch-headline__matchup').textContent).toContain('White wins');
      const subline = element('.watch-headline__detail');
      expect(subline.textContent).toBe('Fog Chess · 5:00 · Casual · 2 days ago');
      const rules = element('.watch-headline__variant');
      expect(rules.getAttribute('href')).toBe(
        element('.game-meta-card__variant').getAttribute('href'),
      );
      expect(rules.tagName).toBe('A');
      expect(getComputedStyle(rules).minHeight).toBe('44px');
      expect(headline.querySelector('.game-meta-card__icon')).toBeNull();
    },
  );

  it.each([320, 390, 768])(
    'places room seats and clocks around the board at %ipx',
    async (width) => {
      browser.happyDOM.setWindowSize({ width, height: 844 });
      await mountWatch(root);
      element('.watch-game-table').hidden = false;
      const rows = getComputedStyle(element('.review-shell__cluster')).gridTemplateAreas.match(
        /"[^"]+"/g,
      );
      expect(rows?.slice(2, 5)).toEqual([
        '"player-top captures-top clock-top"',
        '"board board board"',
        '"player-bottom captures-bottom clock-bottom"',
      ]);
      for (const [selector, area] of [
        ['[data-player-top]', 'player-top'],
        ['[data-clock-top]', 'clock-top'],
        ['[data-player-bottom]', 'player-bottom'],
        ['[data-clock-bottom]', 'clock-bottom'],
      ]) {
        const slot = element(selector!);
        expect(getComputedStyle(slot).gridArea).toBe(area);
        expect(getComputedStyle(slot).minHeight).toBe('44px');
        // All intervening wrappers dissolve so the slot reaches the board's grid.
        for (
          let parent = slot.parentElement;
          parent && !parent.classList.contains('review-shell__cluster');
          parent = parent.parentElement
        ) {
          expect(getComputedStyle(parent).display).toBe('contents');
        }
      }
      const clock = document.createElement('div');
      clock.className = 'clock-time-row';
      clock.innerHTML = '<strong>5:00</strong>';
      element('[data-clock-top]').append(clock);
      expect(getComputedStyle(clock).minHeight).toBe('44px');
      expect(getComputedStyle(clock.querySelector('strong')!).fontSize).toBe('26px');
    },
  );

  it('swaps the phone seat, clock and capture bands with the black board perspective', async () => {
    browser.happyDOM.setWindowSize({ width: 390, height: 844 });
    await mountWatch(root);
    element('.watch-game-table').hidden = false;
    // Set the state before reading styles: happy-dom caches descendant selector
    // matches across ancestor attribute mutations (real browsers invalidate them).
    element('.watch-review-shell').dataset.watchPov = 'black';
    expect(getComputedStyle(element('[data-player-top]')).gridArea).toBe('player-bottom');
    expect(getComputedStyle(element('[data-clock-top]')).gridArea).toBe('clock-bottom');
    expect(getComputedStyle(element('[data-player-bottom]')).gridArea).toBe('player-top');
    expect(getComputedStyle(element('[data-clock-bottom]')).gridArea).toBe('clock-top');
    expect(getComputedStyle(element('.captures-strip-top')).gridArea).toBe('captures-bottom');
    expect(getComputedStyle(element('.captures-strip-bottom')).gridArea).toBe('captures-top');
  });

  it('keeps moves on one scrolling line and follows the current move without scrolling the page', async () => {
    browser.happyDOM.setWindowSize({ width: 390, height: 844 });
    await mountWatch(root);
    element('.watch-game-table').hidden = false;
    const moves = element('.game-table-moves');
    const list = createMoveList(
      Array.from({ length: 60 }, (_, i) => ({ ply: i + 1, label: `Move ${i + 1}` })),
    );
    moves.replaceChildren(list.el);
    expect(getComputedStyle(moves).overflowX).toBe('auto');
    expect(getComputedStyle(moves).overflowY).toBe('hidden');
    expect(getComputedStyle(moves).whiteSpace).toBe('nowrap');
    const rows = element('.review-move-list__rows');
    expect(getComputedStyle(rows).flexDirection).toBe('row');
    expect(getComputedStyle(rows).flexWrap).toBe('nowrap');
    expect(getComputedStyle(rows).overflowY).toBe('visible');
    expect(getComputedStyle(element('.review-move-list__row')).display).toBe('flex');
    expect(getComputedStyle(element('.review-move-list__move')).height).toBe('36px');
    const jump = vi.fn();
    list.update(60, jump);
    const current = element('.review-move-list__move--current');
    Object.defineProperty(moves, 'clientWidth', { value: 300 });
    moves.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    current.getBoundingClientRect = () =>
      ({ left: 900 - moves.scrollLeft, top: 0, width: 60, height: 36 }) as DOMRect;
    revealWatchPhoneMove(moves);
    expect(moves.scrollLeft).toBe(780);
    expect(document.documentElement.scrollTop).toBe(0);
    current.click();
    expect(jump).toHaveBeenCalledWith(60);
    for (const button of root.querySelectorAll<HTMLElement>('.move-nav-bar [data-replay]')) {
      expect(getComputedStyle(button).minHeight).toBe('44px');
      expect(getComputedStyle(button).minWidth).toBe('44px');
    }
    browser.happyDOM.setWindowSize({ width: 1280, height: 900 });
    moves.scrollLeft = 0;
    revealWatchPhoneMove(moves);
    expect(moves.scrollLeft).toBe(0);
  });

  it.each([800, 1280])(
    'preserves the vertical channel rail and board columns at %ipx',
    async (width) => {
      browser.happyDOM.setWindowSize({ width, height: 900 });
      await mountWatch(root);
      element('.watch-meta').append(
        createGameMetaCard({
          variantName: 'Xiangqi',
          variantHref: '/rules/xiangqi',
          headline: ['3+2'],
        }).el,
      );
      element('.watch-game-table').hidden = false;
      expect(getComputedStyle(element('.watch-meta')).display).not.toBe('none');
      expect(getComputedStyle(element('.game-meta-card')).display).not.toBe('none');
      expect(getComputedStyle(element('.watch-headline')).display).toBe('none');
      expect(getComputedStyle(element('.watch-game-table')).display).not.toBe('contents');
      expect(getComputedStyle(element('.round-table__box')).display).not.toBe('contents');
      expect(getComputedStyle(element('.watch-channel-list')).flexDirection).toBe('column');
      expect(getComputedStyle(element('.watch-channel-player')).display).not.toBe('none');
      expect(getComputedStyle(element('.watch-left')).display).toBe('flex');
      expect(getComputedStyle(element('.review-shell__cluster')).gridTemplateAreas).toContain(
        'side',
      );
    },
  );
});
