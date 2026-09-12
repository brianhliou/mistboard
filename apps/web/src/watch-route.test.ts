import { describe, expect, it } from 'vitest';
// Side-effect import: populates the server tenant registry exactly like
// apps/server/src/index.ts does (same pattern as variant-registry-sync.test.ts),
// so the expected watch-channel list below derives from the server's source of
// truth instead of a hand-maintained literal that drifts as channels launch.
import '../../server/src/variant-tenant/register-tenants.js';
import { registeredVariantTenants } from '../../server/src/variant-tenant/registry.js';
import { listWatchChannels } from '../../server/src/watch-channels.js';
import type { FeaturedGame } from './game-display.js';
import { createGameTable } from './game-table.js';
import { installReviewKeyboard } from './review/review-layout.js';
import {
  buildWatchScrubber,
  createWatchSwitchGuard,
  formatWatchScope,
  loadWatchMainBeforePreviews,
  renderWatchChannelList,
  renderWatchHeadline,
  renderWatchMainReviewLink,
  renderWatchQueue,
  renderWatchReplaySkeleton,
  resultLabel,
  seedWatchRail,
  setWatchSeatInkFamily,
  shouldPlayWatchMoveSound,
  WATCH_FEED_CACHE_MS,
  watchFeedCacheIsFresh,
  watchFeedIsDark,
  watchGamePlayers,
  watchKeyboardHandlers,
  watchPovToggleApplies,
  watchQueueMatchupLabel,
  watchQueueResultLabel,
  watchRailAnchor,
} from './watch-route.js';

describe('watchRailAnchor', () => {
  it('keeps tall boards as the anchor', () => {
    // Xiangqi (621px board) and fog chess (560px) both dwarf the ~480px rail.
    expect(watchRailAnchor(621, 480)).toBe('board');
    expect(watchRailAnchor(560, 480)).toBe('board');
    expect(watchRailAnchor(480, 480)).toBe('board');
  });

  it('switches to the middle column when the rail outgrows the board', () => {
    // Banqi is 8x4: a ~308px board under a 480px rail.
    expect(watchRailAnchor(308, 480)).toBe('column');
  });

  it('falls back to the board before anything has been measured', () => {
    expect(watchRailAnchor(0, 0)).toBe('board');
    expect(watchRailAnchor(0, 480)).toBe('board');
    expect(watchRailAnchor(308, 0)).toBe('board');
  });
});

describe('watch move sounds', () => {
  it('sounds only a single forward ply, not initial paint, jumps, or loop resets', () => {
    expect(shouldPlayWatchMoveSound(null, 0)).toBe(false);
    expect(shouldPlayWatchMoveSound(0, 1)).toBe(true);
    expect(shouldPlayWatchMoveSound(1, 2)).toBe(true);
    expect(shouldPlayWatchMoveSound(2, 2)).toBe(false);
    expect(shouldPlayWatchMoveSound(2, 8)).toBe(false);
    expect(shouldPlayWatchMoveSound(8, 0)).toBe(false);
  });
});

describe('watch replay load priority', () => {
  it('does not start queue previews until the center board is ready', async () => {
    const order: string[] = [];
    let finishMain: (() => void) | undefined;
    const mainReady = new Promise<void>((resolve) => {
      finishMain = resolve;
    });

    const loading = loadWatchMainBeforePreviews(
      async () => {
        order.push('main-start');
        await mainReady;
        order.push('main-ready');
      },
      () => order.push('previews-start'),
    );

    await Promise.resolve();
    expect(order).toEqual(['main-start']);
    finishMain?.();
    await loading;
    expect(order).toEqual(['main-start', 'main-ready', 'previews-start']);
  });
});

describe('watch route copy helpers', () => {
  it('scopes sealed watch copy to dark channels', () => {
    const darkFeed = {
      activeChannel: 'dark-mini-xiangqi',
      channels: [
        {
          family: 'xiangqi',
          gameSpecIds: ['dark-mini-xiangqi'],
          id: 'dark-mini-xiangqi',
          label: 'Dark Mini Xiangqi',
          sealedCount: 1,
          unlockedCount: 2,
        },
      ],
      unlockLimit: 64,
    };
    const visibleFeed = {
      activeChannel: 'rapid',
      channels: [
        {
          family: 'chess',
          gameSpecIds: ['chess'],
          id: 'rapid',
          label: 'Rapid',
          sealedCount: 1,
          unlockedCount: 2,
        },
      ],
      unlockLimit: 32,
    };

    expect(watchFeedIsDark(darkFeed)).toBe(true);
    expect(formatWatchScope(darkFeed)).toBe('dark variants · latest 64');
    expect(watchFeedIsDark(visibleFeed)).toBe(false);
    expect(formatWatchScope(visibleFeed)).toBe('latest 32');
  });

  it('renders red/black Dark Mini Xiangqi queue labels', () => {
    const game: FeaturedGame = {
      blackName: null,
      corpusId: null,
      mode: 'pve',
      participants: [
        {
          color: 'red',
          displayName: 'Red Human',
          subjectId: null,
          subjectType: 'guest',
          visibility: 'public',
        },
        {
          color: 'black',
          displayName: 'Misty',
          subjectId: 'python-dmx-v1.0',
          subjectType: 'engine-version',
          visibility: 'public',
        },
      ],
      plyCount: 12,
      result: 'red-wins',
      roomId: 'dmxq_watch',
      termination: 'general-captured',
      variant: 'dark-mini-xiangqi',
      whiteName: null,
    };

    // 'python-dmx-v1.0' resolves to the build "Misty DMX 1.0"; list rows show
    // the brand.
    expect(watchQueueMatchupLabel(game)).toBe('Red Human vs Misty');
    expect(resultLabel(game.result)).toBe('Red wins');
  });

  it('labels a banqi queue result by bound ink, not the seat token', () => {
    const base: FeaturedGame = {
      blackName: null,
      corpusId: null,
      mode: 'pvp',
      plyCount: 40,
      result: 'red-wins',
      roomId: 'bq_watch',
      termination: 'stalemate',
      variant: 'banqi',
      whiteName: null,
    };
    // First-mover ('red') seat won, but it flipped BLACK on the opening move, so
    // the surviving pieces are black ink: the queue must read "Black wins".
    expect(watchQueueResultLabel({ ...base, firstColor: 'black' })).toBe('Black wins');
    // Same seat result, red ink (the seat == ink case) stays "Red wins".
    expect(watchQueueResultLabel({ ...base, firstColor: 'red' })).toBe('Red wins');
    // No firstColor (unreplayable/legacy) falls back to move order, never a wrong ink.
    expect(watchQueueResultLabel(base)).toBe('First wins');
    // Non-banqi variants are untouched by the ink translation.
    expect(watchQueueResultLabel({ ...base, variant: 'xiangqi' })).toBe('Red wins');
  });

  it('labels a Flip Jungle queue result by bound ink, in the family colour words', () => {
    const base: FeaturedGame = {
      blackName: null,
      corpusId: null,
      mode: 'pvp',
      plyCount: 40,
      result: 'red-wins',
      roomId: 'jgf_watch',
      termination: 'capture',
      variant: 'jungle-flip',
      whiteName: null,
    };
    // The Jungle family brands its navy ink "Blue"; the first-mover seat won here
    // but flipped that ink, so the queue must not read "Red wins".
    expect(watchQueueResultLabel({ ...base, firstColor: 'black' })).toBe('Blue wins');
    expect(watchQueueResultLabel({ ...base, firstColor: 'red' })).toBe('Red wins');
    expect(watchQueueResultLabel(base)).toBe('First wins');
  });
});

describe('watchGamePlayers', () => {
  // Regression: the /watch seat rows painted their disc from the raw SEAT, so a
  // flip game whose first-mover seat bound black showed the winner on a RED disc
  // directly under this page's own "Black wins" line (and contradicting the board).
  const flipGame = (variant: string, firstColor: 'red' | 'black' | null): FeaturedGame => ({
    blackName: null,
    corpusId: null,
    firstColor,
    mode: 'pve',
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
        displayName: 'human',
        subjectType: 'user',
        subjectId: 'u1',
        visibility: 'public',
      },
    ],
    plyCount: 33,
    result: 'red-wins',
    roomId: 'bq_seat_rows',
    termination: 'abandonment',
    variant,
    whiteName: null,
  });

  it('paints flip-variant seat rows with the bound ink, not the seat id', () => {
    const rows = watchGamePlayers(flipGame('banqi', 'black'));
    expect(rows.map((row) => [row.name, row.color])).toEqual([
      ['Misty', 'black'],
      ['human', 'red'],
    ]);
  });

  it('leaves a flip game unbound rather than guessing when firstColor is missing', () => {
    const rows = watchGamePlayers(flipGame('jungle-flip', null));
    expect(rows.map((row) => row.color)).toEqual([null, null]);
  });

  it('passes the seat straight through for variants where seat == ink', () => {
    const rows = watchGamePlayers(flipGame('xiangqi', null));
    expect(rows.map((row) => row.color)).toEqual(['red', 'black']);
  });

  it('scores the hero rows so a finished game reads without parsing the status line', () => {
    expect(watchGamePlayers(flipGame('xiangqi', null)).map((row) => row.score)).toEqual(['1', '0']);
  });

  it('scores a flip game by seat even when the ink came out the other way', () => {
    // 'red-wins' names the first-mover SEAT; that seat's disc here is black.
    const rows = watchGamePlayers(flipGame('banqi', 'black'));
    expect(rows.map((row) => [row.color, row.score])).toEqual([
      ['black', '1'],
      ['red', '0'],
    ]);
  });

  it('scores a draw on both rows', () => {
    const drawn = { ...flipGame('xiangqi', null), result: 'draw' };
    expect(watchGamePlayers(drawn).map((row) => row.score)).toEqual(['½', '½']);
  });
});

describe('watchPovToggleApplies', () => {
  it('shows the fog-perspective toggle only for asymmetric fog (dark) variants', () => {
    // Asymmetric fog: distinct per-side views, so the toggle is meaningful.
    expect(watchPovToggleApplies('dark-chess')).toBe(true);
    expect(watchPovToggleApplies('dark-xiangqi')).toBe(true);
    // Symmetric-mask hidden identity (one view) — no toggle.
    expect(watchPovToggleApplies('jieqi')).toBe(false);
    expect(watchPovToggleApplies('banqi')).toBe(false);
    // Open information (one shared board) — no toggle.
    expect(watchPovToggleApplies('xiangqi')).toBe(false);
    // Unknown variant resolves to no spec — no toggle, never throws.
    expect(watchPovToggleApplies('not-a-variant')).toBe(false);
  });
});

describe('renderWatchReplaySkeleton', () => {
  it('fills the slot with the board placeholder the CSS targets', () => {
    const root = document.createElement('div');
    root.append(document.createElement('span'));
    renderWatchReplaySkeleton(root);
    expect(root.querySelector('.watch-replay-skeleton-board')).not.toBeNull();
    // It replaces prior content rather than appending to it.
    expect(root.querySelector('span')).toBeNull();
    expect(root.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it("reserves the board box at the incoming variant's ratio", () => {
    // Banqi is 8x4 and xiangqi is 9x10. A square placeholder for either one
    // shifts layout when the real board lands, which is what the measured
    // CLS 0.137 on a channel switch was.
    // jsdom normalizes the shorthand ("2" becomes "2 / 1"), so compare the
    // ratio it represents rather than the string.
    const ratioOf = (el: HTMLElement | null | undefined): number => {
      const [w = '', h = '1'] = (el?.style.aspectRatio ?? '').split('/');
      return Number(w.trim()) / Number(h.trim());
    };
    const banqi = document.createElement('div');
    renderWatchReplaySkeleton(banqi, 8 / 4);
    const banqiBoard = banqi.querySelector<HTMLElement>('.watch-replay-skeleton-board');
    expect(ratioOf(banqiBoard)).toBeCloseTo(2);
    // The container's square min-height floor is lifted, or it would out-tall
    // the wide placeholder it now wraps.
    expect(banqi.firstElementChild?.classList.contains('watch-replay-skeleton--sized')).toBe(true);

    const xiangqi = document.createElement('div');
    renderWatchReplaySkeleton(xiangqi, 9 / 10);
    expect(ratioOf(xiangqi.querySelector<HTMLElement>('.watch-replay-skeleton-board'))).toBeCloseTo(
      0.9,
    );
  });

  it('keeps the stylesheet square when no ratio is known', () => {
    // The homepage showcase and cross-variant channels pass nothing; an inline
    // ratio of 0/NaN must never be written.
    for (const ratio of [undefined, 0, Number.NaN, -1]) {
      const root = document.createElement('div');
      renderWatchReplaySkeleton(root, ratio);
      const board = root.querySelector<HTMLElement>('.watch-replay-skeleton-board');
      expect(board?.style.aspectRatio).toBe('');
      expect(root.firstElementChild?.classList.contains('watch-replay-skeleton--sized')).toBe(
        false,
      );
    }
  });
});

describe('createWatchSwitchGuard', () => {
  it('lets a later switch supersede an earlier one that is still in flight', () => {
    // The prod bug: Xiangqi clicked, then Fog Chess 130ms later. Fog Chess's
    // chain finished FIRST (it is seeded by initialReplay), then Xiangqi's
    // slower chain landed and committed, putting the user back on xiangqi.
    const guard = createWatchSwitchGuard();
    const xiangqi = guard.begin();
    const fogChess = guard.begin();

    // Fog Chess resolves first and is still the newest intent: it commits.
    expect(guard.isCurrent(fogChess)).toBe(true);
    // Xiangqi resolves second but was superseded: it must drop its result.
    expect(guard.isCurrent(xiangqi)).toBe(false);
  });

  it('keeps a lone switch current across its whole chain', () => {
    const guard = createWatchSwitchGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
    // Re-checked after every await in the switch; nothing else began.
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('treats the never-begun token as superseded', () => {
    // Guards against an off-by-one where token 0 (the initial counter value)
    // would read as current and let a stale render commit.
    const guard = createWatchSwitchGuard();
    expect(guard.isCurrent(0)).toBe(false);
    guard.begin();
    expect(guard.isCurrent(0)).toBe(false);
  });
});

describe('watchFeedCacheIsFresh', () => {
  it('reuses a feed inside the TTL and refetches at or past it', () => {
    expect(watchFeedCacheIsFresh(1_000, 1_000, WATCH_FEED_CACHE_MS)).toBe(true);
    expect(watchFeedCacheIsFresh(1_000, 1_000 + WATCH_FEED_CACHE_MS - 1, WATCH_FEED_CACHE_MS)).toBe(
      true,
    );
    // Exactly at the boundary is stale, so a cached feed can never be older
    // than the TTL.
    expect(watchFeedCacheIsFresh(1_000, 1_000 + WATCH_FEED_CACHE_MS, WATCH_FEED_CACHE_MS)).toBe(
      false,
    );
  });

  it('stays under the active poll cadence', () => {
    // The cache may not outlive the refresh interval the page already runs on,
    // or the rail could show data older than the poll would ever allow.
    expect(WATCH_FEED_CACHE_MS).toBeLessThan(15_000);
  });
});

describe('watchKeyboardHandlers', () => {
  const press = (key: string, target?: HTMLElement) => {
    (target ?? document.body).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  };

  const install = (ply: number, maxPly: number) => {
    const controller = new AbortController();
    const jumps: number[] = [];
    installReviewKeyboard(
      watchKeyboardHandlers(
        (p) => jumps.push(p),
        () => ply,
        () => maxPly,
      ),
      controller.signal,
    );
    return { jumps, dispose: () => controller.abort() };
  };

  it('steps the board on the arrow keys, resolving the ply at keypress time', () => {
    const { jumps, dispose } = install(3, 10);
    press('ArrowLeft');
    press('ArrowRight');
    press('ArrowUp');
    press('ArrowDown');
    dispose();
    expect(jumps).toEqual([2, 4, 0, 10]);
  });

  it('stands down when there is no ply to step, so arrows still scroll the page', () => {
    const { jumps, dispose } = install(0, 0);
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    dispose();
    expect(jumps).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves the board alone while a form control has focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const { jumps, dispose } = install(3, 10);
    press('ArrowLeft', input);
    dispose();
    input.remove();
    expect(jumps).toEqual([]);
  });

  it('offers no flip, so `f` keeps its default behaviour on TV', () => {
    const { dispose } = install(3, 10);
    const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    dispose();
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('buildWatchScrubber', () => {
  const button = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLButtonElement>(`.review-scrubber__button[aria-label="${label}"]`);

  it('jumps to the right ply, reading the live ply at click time', () => {
    const ply = 3;
    const jumps: number[] = [];
    const scrubber = buildWatchScrubber(
      (p) => jumps.push(p),
      () => ply,
      () => 10,
    );
    button(scrubber.el, 'First move')?.click();
    button(scrubber.el, 'Previous move')?.click();
    button(scrubber.el, 'Next move')?.click();
    button(scrubber.el, 'Last move')?.click();
    // prev/next resolve against getPly() (3), not a stale captured value.
    expect(jumps).toEqual([0, 2, 4, 10]);
  });

  it('disables the end buttons at the bounds', () => {
    const scrubber = buildWatchScrubber(
      () => {},
      () => 0,
      () => 8,
    );
    scrubber.setBounds(0, 8);
    expect(button(scrubber.el, 'First move')?.disabled).toBe(true);
    expect(button(scrubber.el, 'Previous move')?.disabled).toBe(true);
    expect(button(scrubber.el, 'Next move')?.disabled).toBe(false);
    expect(button(scrubber.el, 'Last move')?.disabled).toBe(false);

    scrubber.setBounds(8, 8);
    expect(button(scrubber.el, 'First move')?.disabled).toBe(false);
    expect(button(scrubber.el, 'Next move')?.disabled).toBe(true);
    expect(button(scrubber.el, 'Last move')?.disabled).toBe(true);
  });

  it('binds the same controls used by live room game tables', () => {
    const table = createGameTable();
    const jumps: number[] = [];
    const scrubber = buildWatchScrubber(
      (ply) => jumps.push(ply),
      () => 4,
      () => 12,
      table.refs.replayControlsRoot,
    );

    table.refs.replayControlsRoot.querySelector<HTMLButtonElement>('[data-replay="prev"]')?.click();
    table.refs.replayControlsRoot
      .querySelector<HTMLButtonElement>('[data-replay="latest"]')
      ?.click();

    expect(scrubber.el).toBe(table.refs.replayControlsRoot);
    expect(jumps).toEqual([3, 12]);
  });
});

describe('seedWatchRail', () => {
  const fakeHandle = () => {
    const jumps: number[] = [];
    return {
      jumps,
      handle: { plyCount: () => 78, jumpToPly: (ply: number) => jumps.push(ply) },
    };
  };

  it('seeds the rail with the ply it froze the board on', () => {
    const { handle, jumps } = fakeHandle();
    const bound: number[] = [];
    seedWatchRail(handle, false, (ply) => bound.push(ply));
    // The board is parked at the last ply, so the rail must be told the LAST
    // ply. Told zero, |< and < come up disabled on a finished game.
    expect(jumps).toEqual([78]);
    expect(bound).toEqual([78]);
  });

  it('leaves an autoplaying board at the start and seeds the rail to match', () => {
    const { handle, jumps } = fakeHandle();
    const bound: number[] = [];
    seedWatchRail(handle, true, (ply) => bound.push(ply));
    expect(jumps).toEqual([]);
    expect(bound).toEqual([0]);
  });

  it('seeds zero for a handle without ply support', () => {
    const bound: number[] = [];
    seedWatchRail({}, false, (ply) => bound.push(ply));
    expect(bound).toEqual([0]);
  });
});

describe('renderWatchChannelList', () => {
  function channel(id: string, label: string) {
    return { family: 'xiangqi', gameSpecIds: [id], id, label, sealedCount: 0, unlockedCount: 1 };
  }

  // Regression: every launchable channel needs either a variant marker mapping
  // (CHANNEL_MINI_BY_ID) or a dedicated cross-variant marker, or its rail slot
  // renders empty. The expected list derives from the server's own channel
  // sources (apps/server/src/watch-channels.ts): every channel enabled in this
  // env via listWatchChannels() — which contributes the hardcoded dark-chess and
  // engines channels — plus every registered tenant that declares a watch
  // surface, INCLUDING tenants whose launch flag is off here. The marker must
  // exist before the flag flips, so launching a new channel without one fails
  // this test instead of shipping an empty rail slot.
  it('renders a marker for every launched or launchable watch channel', () => {
    const channelsById = new Map<string, ReturnType<typeof channel>>();
    for (const serverChannel of listWatchChannels()) {
      channelsById.set(serverChannel.id, channel(serverChannel.id, serverChannel.label));
    }
    for (const registration of registeredVariantTenants()) {
      const watch = registration.watch;
      if (!watch) continue;
      channelsById.set(watch.channelId, channel(watch.channelId, watch.label));
    }
    const channels = [...channelsById.values()];
    // Sanity: the registry side-effect import actually populated the sources
    // (dark-chess + engines + at least one tenant channel).
    expect(channels.length).toBeGreaterThanOrEqual(3);

    const feed = {
      activeChannel: 'dark-chess',
      channels,
      now: '2026-06-17T00:00:00.000Z',
      unlockLimit: 64,
      sealedCount: 0,
      unlocked: [],
    };
    const root = document.createElement('nav');
    renderWatchChannelList(root, feed);

    const links = root.querySelectorAll('a.watch-channel-link');
    expect(links).toHaveLength(channels.length);
    for (const link of links) {
      const thumb = link.querySelector('.watch-channel-thumb');
      expect(
        thumb?.querySelector('svg, .variant-marker'),
        `${link.textContent} marker`,
      ).not.toBeNull();
    }
  });

  it('uses the rounded house crown for the Featured channel', () => {
    const root = document.createElement('nav');
    renderWatchChannelList(root, {
      activeChannel: 'top',
      channels: [channel('top', 'Featured'), channel('xiangqi', 'Xiangqi')],
      now: '2026-07-23T00:00:00.000Z',
      unlockLimit: 64,
      sealedCount: 0,
      unlocked: [],
    });

    const crown = root.querySelector<SVGElement>('a[aria-label="Featured"] .watch-channel-crown');
    expect(crown?.classList.contains('ui-icon-featured-channel')).toBe(true);
    expect(crown?.getAttribute('fill')).toBe('none');
    expect(crown?.getAttribute('stroke-linecap')).toBe('round');
    expect(crown?.getAttribute('stroke-linejoin')).toBe('round');
  });
});

describe('renderWatchQueue', () => {
  it('fills its two slots from the games that are NOT on the main board', () => {
    const game = (roomId: string): FeaturedGame => ({
      blackName: 'Black',
      corpusId: null,
      mode: 'pvp',
      plyCount: 24,
      result: 'white-wins',
      roomId,
      termination: 'resignation',
      variant: 'dark-chess',
      whiteName: 'White',
    });
    const root = document.createElement('section');
    const previews = renderWatchQueue(
      root,
      {
        activeChannel: 'dark-chess',
        channels: [
          {
            family: 'chess',
            gameSpecIds: ['dark-chess'],
            id: 'dark-chess',
            label: 'Fog Chess',
            sealedCount: 0,
            unlockedCount: 3,
          },
        ],
        now: '2026-07-13T00:00:00.000Z',
        sealedCount: 0,
        unlockLimit: 64,
        unlocked: [game('newest'), game('previous'), game('older')],
      },
      'newest',
    );

    // 'newest' is on the main board, so the rail skips it and takes the next two:
    // "Previously on" offers what ELSE to watch, never a duplicate of the feature.
    expect(previews.map(({ game: previewGame }) => previewGame.roomId)).toEqual([
      'previous',
      'older',
    ]);
    expect(root.querySelectorAll('.watch-queue-preview')).toHaveLength(2);
    expect(root.querySelector('[data-room-id="newest"]')).toBeNull();
    expect(root.querySelector('[data-room-id="previous"] a')?.getAttribute('href')).toBe(
      '/game/previous',
    );
  });

  it('links tenant previews to their native review pages', () => {
    const banqi: FeaturedGame = {
      blackName: null,
      corpusId: null,
      mode: 'pve',
      plyCount: 160,
      result: 'draw',
      roomId: 'bq_review',
      termination: 'progress-clock',
      variant: 'banqi',
      whiteName: null,
    };
    const root = document.createElement('section');

    renderWatchQueue(
      root,
      {
        activeChannel: 'banqi',
        channels: [
          {
            family: 'xiangqi',
            gameSpecIds: ['banqi'],
            id: 'banqi',
            label: 'Banqi',
            sealedCount: 0,
            unlockedCount: 2,
          },
        ],
        now: '2026-07-17T00:00:00.000Z',
        sealedCount: 0,
        unlockLimit: 64,
        unlocked: [banqi, { ...banqi, roomId: 'bq_active' }],
      },
      'bq_active',
    );

    const reviewLink = root.querySelector('[data-room-id="bq_review"] a');
    expect(reviewLink?.getAttribute('href')).toBe('/banqi/game/bq_review');
    expect(reviewLink?.getAttribute('aria-label')).toContain('Review');
  });

  it('empties rather than mirroring the board when it is the channel’s only game', () => {
    const only: FeaturedGame = {
      blackName: 'Black',
      corpusId: null,
      mode: 'pvp',
      plyCount: 24,
      result: 'white-wins',
      roomId: 'only',
      termination: 'resignation',
      variant: 'dark-chess',
      whiteName: 'White',
    };
    const root = document.createElement('section');
    const previews = renderWatchQueue(
      root,
      {
        activeChannel: 'dark-chess',
        channels: [
          {
            family: 'chess',
            gameSpecIds: ['dark-chess'],
            id: 'dark-chess',
            label: 'Fog Chess',
            sealedCount: 0,
            unlockedCount: 1,
          },
        ],
        now: '2026-07-13T00:00:00.000Z',
        sealedCount: 0,
        unlockLimit: 64,
        unlocked: [only],
      },
      'only',
    );

    expect(previews).toEqual([]);
    expect(root.querySelector('[data-room-id="only"]')).toBeNull();
    expect(root.querySelector('.watch-previously-empty')?.textContent).toContain('No other');
  });
});

describe('renderWatchHeadline', () => {
  it('names the players and what is being watched, and collapses with no game', () => {
    const root = document.createElement('div');

    renderWatchHeadline(root, { matchup: 'White vs Black', detail: 'Fog Chess · White wins' });

    expect(root.hidden).toBe(false);
    expect(root.querySelector('.watch-headline__matchup')?.textContent).toBe('White vs Black');
    expect(root.querySelector('.watch-headline__detail')?.textContent).toBe(
      'Fog Chess · White wins',
    );

    renderWatchHeadline(root, null);
    expect(root.hidden).toBe(true);
    expect(root.textContent).toBe('');
  });
});

describe('renderWatchMainReviewLink', () => {
  const finishedGame: FeaturedGame = {
    blackName: 'Black',
    corpusId: null,
    mode: 'pvp',
    plyCount: 24,
    result: 'white-wins',
    roomId: 'focused',
    termination: 'resignation',
    variant: 'dark-chess',
    whiteName: 'White',
  };

  it('links the focused finished board to its variant-aware review page', () => {
    const link = document.createElement('a');

    renderWatchMainReviewLink(link, finishedGame);

    expect(link.hidden).toBe(false);
    expect(link.getAttribute('href')).toBe('/game/focused');
    expect(link.getAttribute('aria-label')).toBe('Review White vs Black');

    renderWatchMainReviewLink(link, { ...finishedGame, roomId: 'bq_focused', variant: 'banqi' });
    expect(link.getAttribute('href')).toBe('/banqi/game/bq_focused');
  });

  it('removes the link for live games and samples without review pages', () => {
    const link = document.createElement('a');
    renderWatchMainReviewLink(link, finishedGame);

    renderWatchMainReviewLink(link, null);
    expect(link.hidden).toBe(true);
    expect(link.hasAttribute('href')).toBe(false);

    renderWatchMainReviewLink(link, { ...finishedGame, corpusId: 'replay-samples' });
    expect(link.hidden).toBe(true);
    expect(link.hasAttribute('href')).toBe(false);
  });

  // The hover chip is built once with the overlay and re-targeted per game. A
  // render that rebuilt the anchor's children would drop it on the first game
  // switch, leaving an invisible link nobody can find.
  it('keeps the hover chip across game switches and hides', () => {
    const link = document.createElement('a');
    const chip = document.createElement('span');
    chip.className = 'watch-main-review-link__chip';
    link.append(chip);

    renderWatchMainReviewLink(link, finishedGame);
    renderWatchMainReviewLink(link, null);
    renderWatchMainReviewLink(link, { ...finishedGame, roomId: 'other' });

    expect(link.querySelector('.watch-main-review-link__chip')).toBe(chip);
  });
});

describe('setWatchSeatInkFamily', () => {
  const section = () => ({ el: document.createElement('main') }) as never;

  it('stamps the Jungle family and clears it for anything else', () => {
    const watch = section();
    const el = (watch as unknown as { el: HTMLElement }).el;

    setWatchSeatInkFamily(watch, 'jungle');
    expect(el.dataset.seatInkFamily).toBe('jungle');
    setWatchSeatInkFamily(watch, 'jungle-flip');
    expect(el.dataset.seatInkFamily).toBe('jungle');

    // The regression that matters on /watch: switching channel away from Jungle
    // must REMOVE the stamp, or the next game's black seat keeps the blue disc.
    setWatchSeatInkFamily(watch, 'xiangqi');
    expect(el.dataset.seatInkFamily).toBeUndefined();

    setWatchSeatInkFamily(watch, 'jungle');
    setWatchSeatInkFamily(watch, null);
    expect(el.dataset.seatInkFamily).toBeUndefined();
  });
});
