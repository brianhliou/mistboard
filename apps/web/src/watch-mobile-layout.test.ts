import { readFileSync } from 'node:fs';
import type { Window } from 'happy-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGameMetaCard } from './review/game-meta-card.js';
import { invalidateWatchFeedCache, mountWatch, renderWatchPlayers } from './watch-route.js';

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
let root: HTMLElement;
let style: HTMLStyleElement;

beforeEach(() => {
  vi.useFakeTimers();
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
              unlocked: [],
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
    expect(rows?.slice(0, 3)).toEqual(['"channels"', '"headline"', '"board"']);
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

  it('keeps long player names readable and linked names tappable on a phone', async () => {
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
    expect(name.whiteSpace).toBe('normal');
    expect(name.overflowWrap).toBe('anywhere');
    expect(name.minHeight).toBe('44px');
    expect(getComputedStyle(element('.watch-player-bot')).fontSize).toBe('11px');
  });

  it('keeps the rules link tappable in the detailed card after the game', async () => {
    browser.happyDOM.setWindowSize({ width: 390, height: 844 });
    await mountWatch(root);
    element('.watch-meta').append(
      createGameMetaCard({
        variantName: 'Xiangqi',
        variantHref: '/rules/xiangqi',
        headline: ['3+2'],
      }).el,
    );
    expect(getComputedStyle(element('.watch-meta')).gridArea).toBe('meta');
    const rules = element('.game-meta-card__variant');
    expect(rules.getAttribute('href')).toBe('/rules/xiangqi');
    expect(getComputedStyle(rules).minHeight).toBe('44px');
  });

  it('preserves the vertical channel rail and board columns on desktop', async () => {
    browser.happyDOM.setWindowSize({ width: 1280, height: 900 });
    await mountWatch(root);
    expect(getComputedStyle(element('.watch-channel-list')).flexDirection).toBe('column');
    expect(getComputedStyle(element('.watch-channel-player')).display).not.toBe('none');
    expect(getComputedStyle(element('.watch-left')).display).toBe('flex');
    expect(getComputedStyle(element('.review-shell__cluster')).gridTemplateAreas).toContain('side');
  });
});
