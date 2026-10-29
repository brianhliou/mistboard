import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Board coordinates on the Crazyhouse Xiangqi and Duck Xiangqi boards.
//
// Coordinates are a reader display preference (boardCoordinates, off by
// default). Xiangqi and jieqi boards honour it; these two never drew them on
// any surface (Brian, 2026-10-17: "I'm not seeing the board coordinates on the
// crazy house board ... The board should be aligned with xiangqi and jieqi").
// Crazyhouse forced them off on /watch and the homepage TV, the embed card and
// the rules-article replay; Duck Xiangqi's renderer pinned the gutter to zero
// and drew no labels, and its CSS, review and postgame aspects were pinned to
// match. Every surface here now follows the preference the way the standard
// board does: labels and a 12-unit gutter with it on, neither with it off, and
// a host aspect that equals the viewBox in both states (the hosts clip).

import {
  applyCrazyhouseXiangqiMove,
  applyDuckXiangqiTurn,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  createInitialCrazyhouseXiangqiState,
  createInitialDuckXiangqiState,
  createInitialXiangqiState,
  type DuckXiangqiGameState,
  type DuckXiangqiTurn,
  getCrazyhouseXiangqiPlayerView,
  getDuckXiangqiPlayerView,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./feature-flags.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./feature-flags.js')>()),
  crazyhouseXiangqiEnabled: () => true,
  duckXiangqiEnabled: () => true,
}));

const { writeDisplayPreference } = await import('./display-preferences.js');
const { xiangqiBoardSvg } = await import('./xiangqi-board.js');
const { duckXiangqiBoardSvg } = await import('./duck-xiangqi-board.js');
const { mountDuckXiangqiPostgame } = await import('./duck-xiangqi-postgame.js');
const { mountDuckXiangqiReplay, mountDuckXiangqiReplayBoard } = await import(
  './duck-xiangqi-replay.js'
);
const { mountCrazyhouseXiangqiReplay } = await import('./crazyhouse-xiangqi-replay.js');
const { mountCrazyhouseXiangqiReplayBoard, replayCrazyhouseXiangqiLine } = await import(
  './crazyhouse-xiangqi-replay-board.js'
);
const { mountCrazyhouseXiangqiWatchReplay } = await import('./watch-crazyhouse-xiangqi-replay.js');
const { mountDuckXiangqiWatchReplay } = await import('./watch-duck-xiangqi-replay.js');
const { EDITOR_VARIANT_IDS } = await import('./editor/editor-catalog.js');
const { EDITOR_SPECS } = await import('./editor/editor-specs.js');
const { duckXiangqiReviewBoardAspect } = await import('./review/duck-xiangqi-review.js');
type DuckXiangqiPostgameResponse = import('./duck-xiangqi-postgame.js').DuckXiangqiPostgameResponse;
type CrazyhouseXiangqiPostgameResponse =
  import('./crazyhouse-xiangqi-postgame.js').CrazyhouseXiangqiPostgameResponse;

// This happy-dom build ships no window.localStorage; back it with memory (the
// xiangqi-board.test.ts idiom) so the preference writes are read back.
const storageValues = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    get length() {
      return storageValues.size;
    },
    clear: () => storageValues.clear(),
    getItem: (key: string) => storageValues.get(key) ?? null,
    key: (index: number) => [...storageValues.keys()][index] ?? null,
    removeItem: (key: string) => void storageValues.delete(key),
    setItem: (key: string, value: string) => void storageValues.set(key, value),
  } satisfies Storage,
});

// The standard live board's viewBox in each state (LIVE_BOARD_GEO: a 12-unit
// gutter on every side with coordinates on). The square grid draws its cells
// inside the same frame, so its box starts 6 units in. Pinned against
// xiangqiBoardSvg below, so these are the standard board's numbers.
const VIEWBOX = {
  intersection: { on: '-12 -12 576 636', off: '0 0 552 612' },
  cell: { on: '-6 -6 564 636', off: '6 6 540 612' },
} as const;

function setCoordinates(on: boolean): void {
  writeDisplayPreference('boardCoordinates', on);
}

function boardSvg(root: ParentNode): SVGSVGElement {
  const svg = root.querySelector<SVGSVGElement>('svg.xq-live-svg');
  if (!svg) throw new Error('no xiangqi-surface board was rendered');
  return svg;
}

function coordLabels(root: ParentNode): number {
  return boardSvg(root).querySelectorAll('.xq-live-coords text').length;
}

function aspectOf(viewBox: string): number {
  const [, , w, h] = viewBox.split(' ').map(Number);
  return (w as number) / (h as number);
}

/** Expect the board in `root` to draw labels in its gutter, or neither. */
function expectCoordinates(root: ParentNode, on: boolean): void {
  const svg = boardSvg(root);
  const layout = svg.getAttribute('data-xiangqi-layout') === 'cell' ? 'cell' : 'intersection';
  expect(svg.getAttribute('viewBox')).toBe(VIEWBOX[layout][on ? 'on' : 'off']);
  if (on) {
    // Nine files and ten ranks, as the standard board labels them.
    expect(coordLabels(root)).toBeGreaterThanOrEqual(19);
  } else {
    expect(coordLabels(root)).toBe(0);
  }
}

beforeEach(() => {
  storageValues.clear();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
});

describe('the standard board these surfaces must match', () => {
  for (const on of [true, false]) {
    for (const layout of ['intersection', 'cell'] as const) {
      it(`draws ${VIEWBOX[layout][on ? 'on' : 'off']} (${on ? 'on' : 'off'}, ${layout})`, () => {
        setCoordinates(on);
        const host = document.createElement('div');
        host.innerHTML = xiangqiBoardSvg(
          getStandardXiangqiPlayerView(createInitialXiangqiState('std'), 'red'),
          'red',
          { interactive: false, selectedSquare: null, draggingFrom: null, layout },
        );
        expectCoordinates(host, on);
      });
    }
  }
});

describe('Duck Xiangqi board renderer', () => {
  const view = getDuckXiangqiPlayerView(
    applyDuckXiangqiTurn(createInitialDuckXiangqiState('coords'), {
      from: 'a4',
      to: 'a5',
      duckTo: 'e5',
    })!,
    'red',
  );
  const render = (extra: { coordinates?: boolean; layout?: 'intersection' | 'cell' } = {}) => {
    const host = document.createElement('div');
    host.innerHTML = duckXiangqiBoardSvg(view, 'red', {
      interactive: false,
      phase: { kind: 'piece', selected: null },
      targets: [],
      ...extra,
    });
    return host;
  };

  for (const on of [true, false]) {
    for (const layout of ['intersection', 'cell'] as const) {
      it(`follows the preference (${on ? 'on' : 'off'}, ${layout})`, () => {
        setCoordinates(on);
        expectCoordinates(render({ layout }), on);
      });
    }
  }

  it('lets a caller force the labels off (and on) whatever the preference', () => {
    setCoordinates(true);
    expectCoordinates(render({ coordinates: false }), false);
    setCoordinates(false);
    expectCoordinates(render({ coordinates: true }), true);
  });

  it('keeps the duck and the pieces on the same points with the gutter added', () => {
    const duckAt = (on: boolean) => {
      setCoordinates(on);
      const host = render();
      return {
        duck: host.querySelector('.dkx-duck > g')?.getAttribute('transform'),
        piece: host.querySelector('[data-piece-square="e1"] > g')?.getAttribute('transform'),
      };
    };
    const off = duckAt(false);
    expect(off.duck).toBeTruthy();
    expect(off.piece).toBeTruthy();
    expect(duckAt(true)).toEqual(off);
  });
});

describe('Duck Xiangqi board aspect', () => {
  const ratio = (css: string, selector: string): number => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(
      new RegExp(
        `(?:^|\\n)${escaped}\\s*\\{\\s*--uni-board-aspect:\\s*calc\\(([\\d.]+) / ([\\d.]+)\\);`,
      ),
    );
    if (!match) throw new Error(`no --uni-board-aspect rule for ${selector}`);
    return Number(match[1]) / Number(match[2]);
  };

  it('sizes the live room host to the viewBox in all four states', () => {
    // Beside this test, whatever directory the runner starts in (the cwd is
    // the main checkout when run with --root from another worktree). A `?raw`
    // CSS import comes back empty under vitest, and jsdom's URL is not a file URL.
    const css = readFileSync(join(import.meta.dirname, 'duck-xiangqi.css'), 'utf8');
    const route = '.live-route--duck-xiangqi';
    expect(ratio(css, route)).toBeCloseTo(aspectOf(VIEWBOX.intersection.off), 6);
    expect(ratio(css, `:root[data-xiangqi-board-layout="cell"] ${route}`)).toBeCloseTo(
      aspectOf(VIEWBOX.cell.off),
      6,
    );
    expect(ratio(css, `:root[data-board-coordinates="on"] ${route}`)).toBeCloseTo(
      aspectOf(VIEWBOX.intersection.on),
      6,
    );
    expect(
      ratio(css, `:root[data-board-coordinates="on"][data-xiangqi-board-layout="cell"] ${route}`),
    ).toBeCloseTo(aspectOf(VIEWBOX.cell.on), 6);
  });

  for (const on of [true, false]) {
    it(`sizes the review host to the viewBox (coordinates ${on ? 'on' : 'off'})`, () => {
      setCoordinates(on);
      expect(duckXiangqiReviewBoardAspect()).toBeCloseTo(
        aspectOf(VIEWBOX.intersection[on ? 'on' : 'off']),
        6,
      );
      window.history.replaceState(null, '', '/?xqLayout=cell');
      expect(duckXiangqiReviewBoardAspect()).toBeCloseTo(
        aspectOf(VIEWBOX.cell[on ? 'on' : 'off']),
        6,
      );
    });

    it(`sizes the postgame host to the viewBox and draws labels (coordinates ${on ? 'on' : 'off'})`, async () => {
      setCoordinates(on);
      vi.stubGlobal('fetch', async () => jsonResponse(duckPostgameFixture()));
      const root = document.createElement('div');
      mountDuckXiangqiPostgame(root, DUCK_ROOM);
      await flushPromises();
      const host = root.querySelector<HTMLElement>('.duck-xiangqi-postgame__board');
      expect(host).not.toBeNull();
      expectCoordinates(host!, on);
      const viewBox = boardSvg(host!).getAttribute('viewBox')!;
      const [w, h = '1'] = host!.style.aspectRatio.split('/');
      expect(Number(w) / Number(h)).toBeCloseTo(aspectOf(viewBox), 6);
    });
  }
});

describe('Duck Xiangqi replay surfaces follow the preference', () => {
  const spec = { moves: 'a4a5@e5 a7a6@e6', red: 'R', black: 'B', event: 'E', resultText: '' };

  for (const on of [true, false]) {
    const state = on ? 'on' : 'off';

    it(`watch and homepage TV (${state})`, async () => {
      setCoordinates(on);
      vi.stubGlobal('fetch', async () => jsonResponse(duckPostgameFixture()));
      const root = document.createElement('div');
      window.history.replaceState(null, '', `/watch/${DUCK_ROOM}`);
      const handle = await mountDuckXiangqiWatchReplay(root, DUCK_ROOM, { autoplay: false });
      expectCoordinates(root, on);
      handle.destroy();
    });

    it(`article replay (${state})`, () => {
      setCoordinates(on);
      const host = document.createElement('div');
      const replay = mountDuckXiangqiReplay(host, spec);
      expectCoordinates(host, on);
      replay.destroy();
    });

    it(`embed and study board (${state})`, () => {
      setCoordinates(on);
      const host = document.createElement('div');
      const board = mountDuckXiangqiReplayBoard(host, spec);
      expectCoordinates(host, on);
      board.destroy();
    });
  }
});

describe('Crazyhouse Xiangqi replay surfaces follow the preference', () => {
  for (const on of [true, false]) {
    const state = on ? 'on' : 'off';

    it(`watch and homepage TV (${state})`, async () => {
      setCoordinates(on);
      vi.stubGlobal('fetch', async () => jsonResponse(crazyhousePostgameFixture()));
      const root = document.createElement('div');
      window.history.replaceState(null, '', `/watch/${CHX_ROOM}`);
      const handle = await mountCrazyhouseXiangqiWatchReplay(root, CHX_ROOM, { autoplay: false });
      expectCoordinates(root, on);
      handle.destroy();
    });

    it(`rules-article replay (${state})`, () => {
      setCoordinates(on);
      const host = document.createElement('div');
      const replay = mountCrazyhouseXiangqiReplay(host, {
        moves: 'h3h10 i10h10',
        red: 'R',
        black: 'B',
        event: 'E',
        resultText: '',
      });
      expectCoordinates(host, on);
      replay.destroy();
    });

    it(`embed and study board (${state})`, () => {
      setCoordinates(on);
      const host = document.createElement('div');
      const line = replayCrazyhouseXiangqiLine(undefined, ['h3h10', 'i10h10']);
      const board = mountCrazyhouseXiangqiReplayBoard(host, line!);
      expectCoordinates(host, on);
      board.destroy();
    });
  }
});

const DUCK_ROOM = 'dkx_coords';
const CHX_ROOM = 'chx_coords';

function duckPostgameFixture(): DuckXiangqiPostgameResponse {
  const turns: DuckXiangqiTurn[] = [
    { from: 'a4', to: 'a5', duckTo: 'e5' },
    { from: 'a7', to: 'a6', duckTo: 'e6' },
  ];
  const finalStatus = { type: 'finished', winner: 'black', reason: 'resignation' } as const;
  let state: DuckXiangqiGameState = createInitialDuckXiangqiState(DUCK_ROOM);
  const history = [{ ply: 0, view: getDuckXiangqiPlayerView(state, 'red') }];
  turns.forEach((turn, index) => {
    state = applyDuckXiangqiTurn(state, turn)!;
    history.push({ ply: index + 1, view: getDuckXiangqiPlayerView(state, 'red') });
  });
  const truth = { ...getDuckXiangqiPlayerView(state, 'red'), status: finalStatus };
  return {
    game: {
      roomId: DUCK_ROOM,
      variant: 'duck-xiangqi',
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: turns.length,
      startedAt: '2026-10-17T08:00:00.000Z',
      endedAt: '2026-10-17T08:05:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 300000,
      incrementMs: 5000,
    },
    state: {
      status: finalStatus,
      moveNumber: state.moveNumber,
      timeControl: { initialMs: 300000, incrementMs: 5000 },
    },
    timeline: turns.map((move, index) => ({
      type: 'move-played',
      at: 10 + index,
      color: index % 2 === 0 ? ('red' as const) : ('black' as const),
      move,
      ply: index + 1,
    })),
    view: truth,
    views: { truth },
    history: { truth: history },
  };
}

function crazyhousePostgameFixture(): CrazyhouseXiangqiPostgameResponse {
  const moves: CrazyhouseXiangqiMove[] = [
    { from: 'h3', to: 'h10' },
    { from: 'i10', to: 'h10' },
  ];
  const finalStatus = { type: 'finished', winner: 'black', reason: 'resignation' } as const;
  let state: CrazyhouseXiangqiGameState = createInitialCrazyhouseXiangqiState(CHX_ROOM);
  const history = [{ ply: 0, view: getCrazyhouseXiangqiPlayerView(state, 'red') }];
  moves.forEach((move, index) => {
    state = applyCrazyhouseXiangqiMove(state, move);
    history.push({ ply: index + 1, view: getCrazyhouseXiangqiPlayerView(state, 'red') });
  });
  const truth = { ...getCrazyhouseXiangqiPlayerView(state, 'red'), status: finalStatus };
  return {
    game: {
      roomId: CHX_ROOM,
      variant: 'crazyhouse-xiangqi',
      mode: 'pvp',
      result: 'black-wins',
      termination: 'resignation',
      plyCount: moves.length,
      startedAt: '2026-10-17T08:00:00.000Z',
      endedAt: '2026-10-17T08:05:00.000Z',
      rated: false,
      visibility: 'public',
      initialMs: 180000,
      incrementMs: 2000,
    },
    state: {
      status: finalStatus,
      moveNumber: state.moveNumber,
      timeControl: { initialMs: 180000, incrementMs: 2000 },
    },
    timeline: moves.map((move, index) => ({
      type: 'move-played',
      at: 10 + index,
      color: index % 2 === 0 ? ('red' as const) : ('black' as const),
      move,
      ply: index + 1,
    })),
    view: truth,
    views: { truth },
    history: { truth: history },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

// The editor lays transparent click targets over the board from its own
// geometry, so the board it draws must sit in exactly that frame. Six editors
// drew the coordinate gutter while their geometry reserved none, which slid the
// points out from under the targets toward the edges (found 2026-10-17, once
// the gear made coordinates reachable for guests).
describe('the position editor board stays under its click layer', () => {
  for (const on of [false, true]) {
    for (const layout of ['intersection', 'cell'] as const) {
      it(`matches the hit frame with coordinates ${on ? 'on' : 'off'}, ${layout} layout`, () => {
        setCoordinates(on);
        window.history.replaceState(null, '', `/?xqLayout=${layout}`);
        const bad: string[] = [];
        for (const id of EDITOR_VARIANT_IDS) {
          const spec = EDITOR_SPECS[id];
          for (const flipped of [false, true]) {
            const svg = spec.renderSvg({ ...spec.start(), flipped }, spec.colors[flipped ? 1 : 0]);
            const box = spec.geometry.viewBox(flipped);
            const got = /viewBox="([^"]+)"/.exec(svg)?.[1];
            const want = `${box.minX} ${box.minY} ${box.width} ${box.height}`;
            if (got !== want) bad.push(`${id} flipped=${flipped} svg=${got} geo=${want}`);
          }
        }
        expect(bad).toEqual([]);
      });
    }
  }
});
