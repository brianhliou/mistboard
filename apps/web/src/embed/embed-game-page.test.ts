import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedRailWidthPx } from './embed-card.js';
import { embedGameHeader, fitBoardWidth, mountEmbedGame, seatDiscInk } from './embed-game-page.js';
import { embedGameRouteFromPath, embedPlyFromSearch, embedRouteFromPath } from './embed-route.js';

// The chess replay is the heavy path; the pov test only needs to see what it
// was asked for, so it is replaced with a recorder that returns a bare handle.
const replayMounts: Array<Record<string, unknown>> = [];
vi.mock('../replay.js', () => ({
  mountReplay: async (_root: HTMLElement, _id: string, options: Record<string, unknown>) => {
    replayMounts.push(options);
    return { destroy() {}, moveEntries: () => [], plyCount: () => 0, jumpToPly() {} };
  },
}));

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('embedGameRouteFromPath', () => {
  it('matches a game path by room id and nothing else', () => {
    expect(embedGameRouteFromPath('/embed/game/abc-123_X')).toEqual({ roomId: 'abc-123_X' });
    expect(embedGameRouteFromPath('/embed/game/abc/')).not.toBeNull();
    for (const bad of ['/embed/game', '/embed/game/a/b', '/game/abc', '/embed/study/a/b']) {
      expect(embedGameRouteFromPath(bad), bad).toBeNull();
    }
  });

  it('refuses ids that are not id-shaped', () => {
    // Frameable by anyone, so the input is hostile by default.
    expect(embedGameRouteFromPath('/embed/game/../../account')).toBeNull();
    expect(embedGameRouteFromPath('/embed/game/a b')).toBeNull();
    expect(embedGameRouteFromPath(`/embed/game/${'a'.repeat(65)}`)).toBeNull();
  });
});

describe('embedRouteFromPath', () => {
  it('discriminates the embed kinds', () => {
    expect(embedRouteFromPath('/embed/study/s/c')).toEqual({
      kind: 'study',
      route: { studyId: 's', chapterId: 'c' },
    });
    expect(embedRouteFromPath('/embed/game/r')).toEqual({ kind: 'game', route: { roomId: 'r' } });
    expect(embedRouteFromPath('/embed')).toBeNull();
    expect(embedRouteFromPath('/')).toBeNull();
  });
});

describe('embedPlyFromSearch', () => {
  it('reads a non-negative integer and nothing else', () => {
    expect(embedPlyFromSearch('?ply=12')).toBe(12);
    expect(embedPlyFromSearch('?ply=0')).toBe(0);
    expect(embedPlyFromSearch('')).toBeNull();
    expect(embedPlyFromSearch('?ply=-1')).toBeNull();
    expect(embedPlyFromSearch('?ply=abc')).toBeNull();
    expect(embedPlyFromSearch('?ply=1e3')).toBeNull();
  });
});

describe('fitBoardWidth', () => {
  it('is bounded by the room beside the move sheet in the wide layout', () => {
    // 760 wide: the sheet takes 226 and the card border 2, leaving 532; the
    // height allows more.
    expect(fitBoardWidth({ width: 760, height: 900 }, 0.9, false)).toBe(532);
  });

  it('is bounded by the height when the frame is short', () => {
    // 700 tall minus two seat bars (78), the control row (39) and the card
    // border (2) = 581, times a 9:10 board = 522.
    expect(fitBoardWidth({ width: 1200, height: 700 }, 0.9, false)).toBe(522);
  });

  it('keeps room for the move list when stacked', () => {
    // 500 tall: bars, controls and border leave 381; the stacked layout also
    // holds 112 back for the sheet under the board, so a square board gets 269.
    expect(fitBoardWidth({ width: 400, height: 500 }, 1, true)).toBe(269);
    // A tall frame is bounded by the width instead (398 = 400 minus the border).
    expect(fitBoardWidth({ width: 400, height: 700 }, 1, true)).toBe(398);
  });

  it('never collapses to nothing', () => {
    expect(fitBoardWidth({ width: 100, height: 100 }, 1, false)).toBe(120);
  });

  it('gives Duck Xiangqi the wider sheet its notation needs', () => {
    // A duck turn is a move and a placement in one cell (`h10-f10@e10`). At the
    // 226 floor cut for a coordinate move, most of a duck game ellipsised. The
    // board yields the difference: 760 wide leaves 482 rather than 532.
    expect(embedRailWidthPx('duck-xiangqi')).toBe(276);
    expect(embedRailWidthPx('xiangqi')).toBe(226);
    expect(embedRailWidthPx(null)).toBe(226);
    expect(fitBoardWidth({ width: 760, height: 900 }, 0.9, false, 276)).toBe(482);
    // Stacked, the sheet is under the board and the floor does not apply.
    expect(fitBoardWidth({ width: 400, height: 700 }, 1, true, 276)).toBe(398);
  });
});

describe('mountEmbedGame', () => {
  it('says an unfinished or missing game is unavailable rather than looking broken', async () => {
    stubFetch(404, { error: 'not_found' });
    const root = document.createElement('div');
    await mountEmbedGame(root, { roomId: 'nope' });
    expect(root.textContent).toContain('not available');
    expect(document.documentElement.dataset.embed).toBe('game');
  });

  it('treats a private game as unavailable even when the summary answers', async () => {
    stubFetch(200, { game: { roomId: 'r', variant: 'xiangqi', visibility: 'private' } });
    const root = document.createElement('div');
    await mountEmbedGame(root, { roomId: 'r' });
    expect(root.textContent).toContain('not available');
  });

  it('does not throw when the network fails', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('offline');
    });
    const root = document.createElement('div');
    await mountEmbedGame(root, { roomId: 'r' });
    expect(root.textContent).toContain('could not be loaded');
  });
});

describe('mountEmbedGame pov on the chess stack', () => {
  const summary = { game: { roomId: 'fog', variant: 'dark-chess', result: 'black-wins' } };

  it("renders the named side's own pane and keeps it fogged at the end", async () => {
    stubFetch(200, summary);
    replayMounts.length = 0;
    const root = document.createElement('div');
    await mountEmbedGame(root, { roomId: 'fog' }, { pov: 'black' });
    const options = replayMounts[0];
    expect(options).toBeDefined();
    expect(options?.orientation).toBe('black');
    expect(options?.revealOnFinish).toBe(false);
    const panes = options?.panes as { resolver: () => string } | undefined;
    expect(panes?.resolver()).toBe('black');
  });

  it('shows the revealed truth board when no side is named, and for truth', async () => {
    for (const pov of [undefined, 'truth'] as const) {
      stubFetch(200, summary);
      replayMounts.length = 0;
      const root = document.createElement('div');
      await mountEmbedGame(root, { roomId: 'fog' }, pov ? { pov } : {});
      const options = replayMounts[0];
      expect(options?.revealOnFinish, String(pov)).toBe(true);
      expect(options?.panes, String(pov)).toBeUndefined();
      expect(options?.orientation, String(pov)).toBe('white');
    }
  });
});

describe('the card chrome the game embed shares with the study embed', () => {
  const game = (extra: Record<string, unknown>) =>
    ({ roomId: 'r', variant: 'xiangqi', result: 'red-wins', mode: 'pve', ...extra }) as never;

  it('names the variant and the clock above the card, or the variant alone', () => {
    expect(embedGameHeader(game({ initialMs: 600_000, incrementMs: 5_000 }))).toBe(
      'Xiangqi · 10 + 5',
    );
    expect(embedGameHeader(game({}))).toBe('Xiangqi');
  });

  it('paints each seat disc in the ink on the board, not the seat id', () => {
    // Xiangqi seats are their inks.
    expect(seatDiscInk(game({}), 'first')).toBe('red');
    expect(seatDiscInk(game({}), 'second')).toBe('black');
    // A flip variant's seats are move-order slots; the ink binds on the first
    // flip, so the same seat paints either colour.
    const flip = (firstColor: 'red' | 'black') =>
      game({ variant: 'jungle-flip', firstColor, participants: [] });
    expect(seatDiscInk(flip('black'), 'first')).toBe('black');
    expect(seatDiscInk(flip('black'), 'second')).toBe('red');
    expect(seatDiscInk(flip('red'), 'first')).toBe('red');
  });
});
