import { describe, expect, it } from 'vitest';
import {
  type DarkXiangqiWireView,
  darkXiangqiClickResult,
  fogLayer,
  renderDarkXiangqiBoardSvg,
} from './live-dark-xiangqi.js';

const NON_SELECTABLE_RIVER_GROUP =
  '<g class="xq-live-river" aria-hidden="true" pointer-events="none" style="-webkit-user-select: none; user-select: none;">';

// The room chrome (clocks, countdowns, action status, confirm dialogs, room
// actions) is pinned by room-chrome.test.ts and the DMX room suite; this file
// pins what stays Dark-Xiangqi-owned — the intersection-board SVG with its
// fog mask, and the pure click-to-move decision over a fog view (the
// web-side half of the hidden-info guarantee).

describe('Dark Xiangqi board svg', () => {
  it('renders the article-style intersection board instead of a cell grid', () => {
    const svg = renderDarkXiangqiBoardSvg(viewFixture());

    expect(svg).toContain('viewBox="0 0 552 612"');
    expect(svg.match(/xq-live-line/g)).toHaveLength(26);
    expect(svg).not.toContain('xq-live-cell');
    expect(svg).toContain('楚 河   漢 界');
    expect(svg).toContain('class="xq-live-river-label"');
    expect(svg).toContain(NON_SELECTABLE_RIVER_GROUP);
    expect(svg).not.toContain('xq-live-border');
  });

  it('keeps the background and fog full-bleed for responsive wrapper clipping', () => {
    const svg = renderDarkXiangqiBoardSvg(viewFixture());

    expect(svg).toContain('<rect class="xq-live-bg" x="0" y="0" width="552" height="612"/>');
    expect(svg).not.toMatch(/class="xq-live-bg"[^>]*\srx=/);
    expect(svg).toContain('width="552" height="612" rx="0" fill="white"');
  });

  it('keeps shrouded pieces role-neutral in the DOM', () => {
    const svg = renderDarkXiangqiBoardSvg(viewFixture());

    expect(svg).toContain('aria-label="black hidden piece"');
    expect(svg).not.toContain('aria-label="black soldier"');
  });

  // The homepage viewer drew the square grid with fog holes cut at intersection
  // heights (a river gap too high below the river) and a fog sheet 6 units
  // short of the bottom edge, because the fog was built before the layout was
  // known and sized to the intersection board.
  it('cuts square-grid fog holes on the square-grid cells, river gap included', () => {
    const view: DarkXiangqiWireView = { ...viewFixture(), visibleSquares: ['b3', 'a1'] };
    const fog = fogLayer(view, 'red', 'm', 'cell');

    // The sheet spans the cells plus the river strip: 9 x 60 by 10 x 60 + 12.
    expect(fog).toContain('<rect x="6" y="6" width="540" height="612" rx="0" fill="white"/>');
    // b3 sits below the river: row 7, centre 36 + 7 * 60 + 12 = 468.
    expect(fog).toContain('<rect x="65.5" y="437.5" width="61" height="61" fill="black"/>');
    // a1 is the bottom-left square and bleeds to the sheet's own edges.
    expect(fog).toContain('<rect x="6" y="557.5" width="60.5" height="60.5" fill="black"/>');
  });

  it('keeps intersection-board fog holes where they were', () => {
    const fog = fogLayer({ ...viewFixture(), visibleSquares: ['b3'] }, 'red', 'm', 'intersection');

    expect(fog).toContain('<rect x="0" y="0" width="552" height="612" rx="0" fill="white"/>');
    expect(fog).toContain('<rect x="65.5" y="425.5" width="61" height="61" fill="black"/>');
  });

  // The square grid's cells are opaque, so palace bands drawn before them were
  // painted over and Fog Xiangqi showed no palace at all on that layout.
  it('draws the square-grid palace above the cells', () => {
    window.history.replaceState({}, '', '/?xqLayout=cell');
    try {
      const svg = renderDarkXiangqiBoardSvg(viewFixture());
      expect(svg.indexOf('class="xq-live-palace-bands"')).toBeGreaterThan(
        svg.indexOf('class="xq-live-grid"'),
      );
      expect(svg).toContain('xq-live-palace-band');
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });

  it('masks fog by default and drops the mask when fog is off', () => {
    expect(renderDarkXiangqiBoardSvg(viewFixture())).toContain('xq-live-fog-mask');
    expect(renderDarkXiangqiBoardSvg(viewFixture(), 'red', { showFog: false })).not.toContain(
      'xq-live-fog-mask',
    );
  });

  it('gives red and black views distinct fog mask ids (postgame triptych)', () => {
    // Hidden-info regression: the postgame triptych draws the red, truth, and
    // black views in ONE document, same game id, same board orientation. Keying
    // the fog mask by render orientation made red and black share an id, so the
    // black board's url(#…) resolved to the red board's mask and showed RED's
    // fog. Each view's fog must own a unique mask id.
    const id = 'xq-shared';
    const redView: DarkXiangqiWireView = { ...viewFixture(), id, perspective: 'red' };
    const blackView: DarkXiangqiWireView = {
      ...viewFixture(),
      id,
      perspective: 'black',
      visibleSquares: ['a9', 'a10'],
    };
    const redMask = fogMaskId(renderDarkXiangqiBoardSvg(redView, 'red'));
    const blackMask = fogMaskId(renderDarkXiangqiBoardSvg(blackView, 'red'));
    expect(redMask).not.toBeNull();
    expect(blackMask).not.toBeNull();
    expect(blackMask).not.toBe(redMask);
  });
});

function fogMaskId(svg: string): string | null {
  return svg.match(/id="(xq-live-fog-[^"]+)"/)?.[1] ?? null;
}

describe('Dark Xiangqi click-to-move decisions', () => {
  it('selects an own visible piece with legal moves', () => {
    expect(darkXiangqiClickResult(viewFixture(), 'red', null, 'b3')).toEqual({
      kind: 'select',
      square: 'b3',
    });
  });

  it('submits a legal move from a selected piece', () => {
    expect(darkXiangqiClickResult(viewFixture(), 'red', 'b3', 'b4')).toEqual({
      kind: 'move',
      move: { from: 'b3', to: 'b4' },
    });
  });

  it('never selects a shrouded opponent piece', () => {
    expect(darkXiangqiClickResult(viewFixture(), 'red', null, 'b8')).toEqual({ kind: 'noop' });
  });

  it('clears the selection on a repeated click', () => {
    expect(darkXiangqiClickResult(viewFixture(), 'red', 'b3', 'b3')).toEqual({ kind: 'clear' });
  });

  it('ignores clicks off-turn and from spectators', () => {
    const offTurn: DarkXiangqiWireView = {
      ...viewFixture(),
      status: { type: 'playing', turn: 'black' },
    };
    expect(darkXiangqiClickResult(offTurn, 'red', null, 'b3')).toEqual({ kind: 'noop' });
    expect(darkXiangqiClickResult(viewFixture(), 'spectator', null, 'b3')).toEqual({
      kind: 'noop',
    });
  });

  it('ignores clicks once the game is over', () => {
    const finished: DarkXiangqiWireView = {
      ...viewFixture(),
      status: { type: 'finished', winner: 'red', reason: 'general-captured' },
      legalMoves: [],
    };
    expect(darkXiangqiClickResult(finished, 'red', null, 'b3')).toEqual({ kind: 'noop' });
  });
});

describe('Dark Xiangqi last-move marks', () => {
  // The fog board drew a symmetric pair of plain amber discs while every other
  // token board drew an origin wash plus a gold destination halo. Same grammar
  // now. The visibility cases below are a client-side guard rather than the
  // live-room mechanism -- the server strips an opponent's lastMove outright,
  // stricter than per-square visibility (see dark-xiangqi-tenant.ts) -- but the
  // widened reveals (postgame, /watch) render through this same function, and a
  // mark on a square the view cannot see is the one thing this layer must never
  // emit.
  const withLastMove = (from: 'b3' | 'b8', to: 'b4' | 'b7'): DarkXiangqiWireView => ({
    ...viewFixture(),
    lastMove: { from, to },
  });

  it('draws the same origin wash and destination halo as the open board', () => {
    const svg = renderDarkXiangqiBoardSvg(withLastMove('b3', 'b4'));

    expect(svg).toContain('xq-live-lastmove-cell xq-live-lastmove-from');
    expect(svg).toContain('xq-live-lastmove-ring');
    // The old treatment: two bare -cell circles, no -from, no ring.
    expect(svg).not.toMatch(/class="xq-live-lastmove-cell"/);
  });

  it('marks only the endpoints this viewer can see', () => {
    // b8 is visible, b7 is not: the piece left somewhere we can see and landed
    // in the fog. Marking the destination would leak where it went.
    const half = renderDarkXiangqiBoardSvg(withLastMove('b8', 'b7'));
    expect(half).toContain('xq-live-lastmove-from');
    expect(half).not.toContain('xq-live-lastmove-ring');

    // And the reverse: arriving on a visible square from a hidden one.
    const arriving = renderDarkXiangqiBoardSvg({
      ...viewFixture(),
      lastMove: { from: 'i1', to: 'b4' },
    });
    expect(arriving).toContain('xq-live-lastmove-ring');
    expect(arriving).not.toContain('xq-live-lastmove-from');
  });

  it('marks nothing when the whole move happened in the fog', () => {
    const svg = renderDarkXiangqiBoardSvg({
      ...viewFixture(),
      lastMove: { from: 'i1', to: 'i2' },
    });
    expect(svg).not.toContain('xq-live-lastmove-cell');
    expect(svg).not.toContain('xq-live-lastmove-ring');
  });
});

function viewFixture(): DarkXiangqiWireView {
  return {
    id: 'xq-test',
    perspective: 'red',
    board: {
      b3: { piece: { color: 'red', role: 'cannon' }, shrouded: false },
      b8: { color: 'black', shrouded: true },
    },
    visibleSquares: ['b3', 'b4', 'b8'],
    legalMoves: [{ from: 'b3', to: 'b4' }],
    status: { type: 'playing', turn: 'red' },
    moveNumber: 1,
    captures: { red: [], black: [] },
  };
}
