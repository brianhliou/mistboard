import {
  applyMove as applyXiangqiMove,
  createInitialXiangqiState,
  getStandardXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it, vi } from 'vitest';
import { type DisplayPreferenceValue, writeDisplayPreference } from './display-preferences.js';
import { renderXiangqiBoardSvg as renderLiveXiangqiBoardSvg } from './live-xiangqi.js';
import {
  animateXiangqiBoardMove,
  createXiangqiInteractiveBoard,
  renderXiangqiBoardSvg as renderSharedXiangqiBoardSvg,
  type XiangqiBoardArrow,
  xiangqiArrowSvg,
  xiangqiBoardSvg,
  xiangqiMarkerSvg,
} from './xiangqi-board.js';

// This happy-dom build ships no window.localStorage; back it with memory (same
// idiom as puzzles.test.ts) so the pieceAnimation preference writes work.
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

const NON_SELECTABLE_RIVER_GROUP =
  '<g class="xq-live-river" aria-hidden="true" pointer-events="none" style="-webkit-user-select: none; user-select: none;">';

describe('standard Xiangqi board SVG', () => {
  it('renders a 9 by 10 square grid without moving the logical board centers', () => {
    const state = createInitialXiangqiState('xq-board-cell-layout');
    const view = getStandardXiangqiPlayerView(state, 'red');
    const svg = renderSharedXiangqiBoardSvg(view, 'red', { layout: 'cell' });
    expect(svg).toContain('data-xiangqi-layout="cell"');
    // Coordinates default to off, and the label gutter is reclaimed when they
    // are: a reader who never turns them on sees exactly the board that shipped
    // before they existed.
    expect(svg).toContain('viewBox="6 6 540 612"');
    expect(svg.match(/class="xq-live-cell xq-live-cell--/g)).toHaveLength(90);
    expect(svg.match(/class="xq-live-cell-line"/g)).toHaveLength(24);
    expect(svg).toContain(
      '<rect class="xq-live-cell-river" x="6" y="306" width="540" height="12"/>',
    );
    expect(svg.match(/class="xq-live-palace-band"/g)).toHaveLength(2);
    expect(svg).toContain('<g class="xq-live-palace"></g>');
    expect(svg).not.toContain('<line class="xq-live-cell-line" x1="6" y1="6"');
    // The river is a real gutter: the fifth row ends at 306 and the sixth begins
    // at 318. Red a1 shifts with its half and remains centered in its square.
    expect(svg).toContain('x="6" y="246" width="60" height="60"');
    expect(svg).toContain('x="6" y="318" width="60" height="60"');
    expect(svg).toContain('x="9" y="561" width="54" height="54"');
  });

  it('retains the traditional palace diagonals on intersection boards', () => {
    const state = createInitialXiangqiState('xq-board-classic-palace');
    const view = getStandardXiangqiPlayerView(state, 'red');
    const svg = renderSharedXiangqiBoardSvg(view, 'red', { layout: 'intersection' });

    expect(svg).toContain('<line x1="216" y1="36" x2="336" y2="156"/>');
    expect(svg).toContain('<line x1="336" y1="36" x2="216" y2="156"/>');
  });

  it('renders the river label as theme-controlled non-selectable board furniture', () => {
    const state = createInitialXiangqiState('xq-board-render');
    const view = getStandardXiangqiPlayerView(state, 'red');

    expect(renderSharedXiangqiBoardSvg(view)).toContain(NON_SELECTABLE_RIVER_GROUP);
    expect(renderSharedXiangqiBoardSvg(view)).toContain('class="xq-live-river-label"');
    expect(renderLiveXiangqiBoardSvg(view)).toContain(NON_SELECTABLE_RIVER_GROUP);
    expect(renderLiveXiangqiBoardSvg(view)).toContain('class="xq-live-river-label"');
  });

  it('re-exports ONE renderer from live-xiangqi (no duplicate implementation)', () => {
    expect(renderLiveXiangqiBoardSvg).toBe(renderSharedXiangqiBoardSvg);
  });

  it('keeps the background full-bleed so the CSS wrapper owns responsive corner clipping', () => {
    const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-board-corners'), 'red');
    const svg = renderSharedXiangqiBoardSvg(view);

    // Full bleed means the whole viewBox, whatever it currently is. With
    // coordinates off there is no gutter, so this is the original rectangle.
    expect(svg).toContain('<rect class="xq-live-bg" x="0" y="0" width="552" height="612"/>');
    expect(svg).not.toMatch(/class="xq-live-bg"[^>]*\srx=/);
  });

  it('marks the last move with an origin shadow and a destination ring', () => {
    const state = applyXiangqiMove(createInitialXiangqiState('xq-board-lastmove'), {
      from: 'b3',
      to: 'e3',
    });
    const view = getStandardXiangqiPlayerView(state, 'red');
    expect(view.lastMove).toEqual({ from: 'b3', to: 'e3' });

    // Red perspective geometry: x = 36 + file*60, y = 36 + (10 - rank)*60.
    // b3 -> (96, 456); e3 -> (276, 456). Origin = the darker -from shadow disc;
    // destination = the gold ring around the moved piece (r=29 > piece r=27).
    // Positions are asserted here; the radii belong to board-lastmove.test.ts,
    // which derives them. Restating them meant this failed on a deliberate
    // geometry change rather than on a bug.
    const svg = renderSharedXiangqiBoardSvg(view);
    expect(svg).toMatch(
      /<circle class="xq-live-lastmove-cell xq-live-lastmove-from" cx="96" cy="456" r="[\d.]+"\/>/,
    );
    expect(svg).toMatch(/<circle class="xq-live-lastmove-ring" cx="276" cy="456" r="[\d.]+"\/>/);
    expect(svg.match(/xq-live-lastmove-from/g)).toHaveLength(1);
    expect(svg.match(/xq-live-lastmove-ring/g)).toHaveLength(1);

    // Black rotates the board 180 degrees, so BOTH axes move: file b (index 1)
    // lands at column 7 -> x = 36 + 7*60 = 456, and rank 3 at y = 36 + 2*60 = 156.
    const flipped = renderSharedXiangqiBoardSvg(view, 'black');
    expect(flipped).toMatch(
      /<circle class="xq-live-lastmove-cell xq-live-lastmove-from" cx="456" cy="156" r="[\d.]+"\/>/,
    );
    expect(flipped).toMatch(
      /<circle class="xq-live-lastmove-ring" cx="276" cy="156" r="[\d.]+"\/>/,
    );
  });

  it('marks the last move with complete source and destination cells on a square grid', () => {
    const state = applyXiangqiMove(createInitialXiangqiState('xq-board-cell-lastmove'), {
      from: 'b3',
      to: 'e3',
    });
    const view = getStandardXiangqiPlayerView(state, 'red');

    // The red-perspective bottom half includes the 12-unit river gutter:
    // b3 center=(96,468), e3 center=(276,468), then inset half a 60-unit cell.
    const svg = renderSharedXiangqiBoardSvg(view, 'red', { layout: 'cell' });
    expect(svg).toContain(
      '<rect class="xq-live-lastmove-square xq-live-lastmove-from" x="66" y="438" width="60" height="60"/>',
    );
    expect(svg).toContain(
      '<rect class="xq-live-lastmove-square xq-live-lastmove-to" x="246" y="438" width="60" height="60"/>',
    );
    expect(svg).not.toContain('xq-live-lastmove-cell');
    expect(svg).not.toContain('xq-live-lastmove-ring');

    const flipped = renderSharedXiangqiBoardSvg(view, 'black', { layout: 'cell' });
    expect(flipped).toContain(
      '<rect class="xq-live-lastmove-square xq-live-lastmove-from" x="426" y="126" width="60" height="60"/>',
    );
    expect(flipped).toContain(
      '<rect class="xq-live-lastmove-square xq-live-lastmove-to" x="246" y="126" width="60" height="60"/>',
    );
  });

  it('renders no last-move marker when the view has no lastMove', () => {
    const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-board-fresh'), 'red');
    expect(view.lastMove).toBeUndefined();
    expect(renderSharedXiangqiBoardSvg(view)).not.toContain('xq-live-lastmove-cell');
    expect(renderSharedXiangqiBoardSvg(view)).not.toContain('xq-live-lastmove-ring');
    expect(renderSharedXiangqiBoardSvg(view)).not.toContain('xq-live-lastmove-square');
  });
});

describe('keyed piece slots + animateXiangqiBoardMove', () => {
  function mountMovedBoard(): HTMLDivElement {
    const state = applyXiangqiMove(createInitialXiangqiState('xq-board-anim'), {
      from: 'b3',
      to: 'e3',
    });
    const view = getStandardXiangqiPlayerView(state, 'red');
    const host = document.createElement('div');
    host.innerHTML = renderSharedXiangqiBoardSvg(view);
    return host;
  }

  it('wraps every piece in a keyed slot the glide can target', () => {
    const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-board-slots'), 'red');
    const svg = renderSharedXiangqiBoardSvg(view);
    expect(svg).toContain('<g class="xq-piece-slot" data-piece-square="a1">');
    expect(svg.match(/xq-piece-slot/g)).toHaveLength(32);
  });

  it('glides the destination slot from the move origin in viewBox user units', () => {
    const host = mountMovedBoard();
    const slot = host.querySelector('[data-piece-square="e3"]');
    expect(slot).not.toBeNull();
    const animate = vi.fn();
    Object.assign(slot as object, { animate });
    animateXiangqiBoardMove(host, { from: 'b3', to: 'e3' }, 'red');
    // b3 -> (96, 456), e3 -> (276, 456): the piece starts 180 units left of rest.
    expect(animate).toHaveBeenCalledTimes(1);
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translate(-180px, 0px)' },
      { transform: 'none' },
    ]);
    expect(animate.mock.calls[0]![1]).toMatchObject({ duration: 250 });
  });

  it('includes the mounted river gutter in a cross-river glide', () => {
    const move = { from: 'b3', to: 'b7' } as const;
    const state = applyXiangqiMove(createInitialXiangqiState('xq-board-cell-anim'), move);
    const view = getStandardXiangqiPlayerView(state, 'red');
    const host = document.createElement('div');
    host.innerHTML = renderSharedXiangqiBoardSvg(view, 'red', { layout: 'cell' });
    const slot = host.querySelector('[data-piece-square="b7"]');
    const animate = vi.fn();
    Object.assign(slot as object, { animate });

    animateXiangqiBoardMove(host, move, 'red');

    // Classic b3-b7 spans 240 units. The square board adds its 12-unit river.
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translate(0px, 252px)' },
      { transform: 'none' },
    ]);
  });

  it('reverse-animates the origin slot on a back-step and skips missing slots', () => {
    const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-board-rev'), 'red');
    const host = document.createElement('div');
    host.innerHTML = renderSharedXiangqiBoardSvg(view);
    const slot = host.querySelector('[data-piece-square="b3"]');
    const animate = vi.fn();
    Object.assign(slot as object, { animate });
    animateXiangqiBoardMove(host, { from: 'b3', to: 'e3' }, 'red', { reverse: true });
    expect(animate.mock.calls[0]![0]).toEqual([
      { transform: 'translate(180px, 0px)' },
      { transform: 'none' },
    ]);
    // Empty destination square (no slot): safe no-op, nothing throws.
    expect(() => animateXiangqiBoardMove(host, { from: 'e6', to: 'e7' }, 'red')).not.toThrow();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when the pieceAnimation preference is none', () => {
    // Same cast the settings UI uses for select values (see account.ts).
    writeDisplayPreference('pieceAnimation', 'none' as DisplayPreferenceValue<'pieceAnimation'>);
    try {
      const host = mountMovedBoard();
      const slot = host.querySelector('[data-piece-square="e3"]');
      const animate = vi.fn();
      Object.assign(slot as object, { animate });
      animateXiangqiBoardMove(host, { from: 'b3', to: 'e3' }, 'red');
      expect(animate).not.toHaveBeenCalled();
    } finally {
      writeDisplayPreference('pieceAnimation', 'normal');
    }
  });

  it('no-ops safely in a DOM without WAAPI (el.animate missing)', () => {
    const host = mountMovedBoard();
    const slot = host.querySelector('[data-piece-square="e3"]');
    Object.assign(slot as object, { animate: undefined });
    expect(() => animateXiangqiBoardMove(host, { from: 'b3', to: 'e3' }, 'red')).not.toThrow();
  });
});

describe('xiangqiArrowSvg', () => {
  it('draws shaft + head between intersection centers, inset at both ends', () => {
    // Red perspective: b3 -> (96, 456), e3 -> (276, 456); horizontal arrow.
    // Start inset 12 -> x=108. Tip lands AT the destination centre (x=276); head
    // length 20 -> the shaft ends at the head base (x=256); head half-width 11.
    const svg = xiangqiArrowSvg({ from: 'b3', to: 'e3' }, 'red');
    expect(svg).toContain('class="xq-arrow"');
    expect(svg).toContain('opacity="0.9"');
    expect(svg).toContain(
      '<line x1="108" y1="456" x2="256" y2="456" stroke-width="9" stroke-linecap="round"/>',
    );
    expect(svg).toContain('<polygon points="276,456 256,467 256,445" stroke="none"/>');
    expect(svg).toContain('pointer-events="none"');
  });

  it('flips with the board perspective (same transform as the pieces)', () => {
    // Black rotates 180 degrees: file b -> column 7 (x 456), rank 3 -> y 156.
    // The arrow is inset from both piece centres, hence 444 -> 296 with the tip at 276.
    const svg = xiangqiArrowSvg({ from: 'b3', to: 'e3' }, 'black');
    expect(svg).toContain('<line x1="444" y1="156" x2="296" y2="156"');
    expect(svg).toContain('<polygon points="276,156 296,145 296,167"');
  });

  it('honours per-arrow class, opacity, width, and dash', () => {
    const svg = xiangqiArrowSvg(
      { from: 'h3', to: 'e3', className: 'xq-arrow--pv2', opacity: 0.55, width: 8, dashed: true },
      'red',
    );
    expect(svg).toContain('class="xq-arrow xq-arrow--pv2"');
    expect(svg).toContain('opacity="0.55"');
    expect(svg).toContain('stroke-width="8"');
    expect(svg).toContain('stroke-dasharray="10 8"');
  });

  it('scales the head with the shaft so a thin arrow is not a lollipop', () => {
    // Engine candidate arrows encode strength as width; a fixed head would leave
    // a hairline shaft carrying a full-size spearhead. Half the width at 4.5 =>
    // head length 10 (shaft base x=266) and half-width 5.5.
    const svg = xiangqiArrowSvg({ from: 'b3', to: 'e3', width: 4.5 }, 'red');
    expect(svg).toContain('<line x1="108" y1="456" x2="266" y2="456" stroke-width="4.5"');
    expect(svg).toContain('<polygon points="276,456 266,461.5 266,450.5" stroke="none"/>');
  });

  it('clamps a wide head to the span so a one-step arrow never reverses', () => {
    // b3 -> c3 spans 60 units, of which 24 survive the two insets. A width-14
    // head would want 31 units and would push the shaft base behind its start.
    const svg = xiangqiArrowSvg({ from: 'b3', to: 'c3', width: 14 }, 'red');
    const shaft = svg.match(/<line x1="(\d+(?:\.\d+)?)"[^>]*x2="(\d+(?:\.\d+)?)"/);
    expect(shaft).not.toBeNull();
    expect(Number(shaft?.[2])).toBeGreaterThanOrEqual(Number(shaft?.[1]));
  });

  it('renders nothing for a degenerate zero-length arrow', () => {
    expect(xiangqiArrowSvg({ from: 'e3', to: 'e3' }, 'red')).toBe('');
  });
});

describe('judgment glyph markers', () => {
  it('pins the badge to the top-right of the point so it clears the piece', () => {
    // Red perspective: b3 -> (96, 456); the badge offsets +21 / -21 from there.
    const svg = xiangqiMarkerSvg({ square: 'b3', kind: 'glyph', text: '??' }, 'red');
    expect(svg).toContain('class="xq-marker xq-marker--glyph"');
    expect(svg).toContain('<circle class="xq-marker__disc" cx="117" cy="435" r="13"/>');
    expect(svg).toContain('>??</text>');
  });

  it('offsets in SCREEN space, so the badge keeps its corner when the board flips', () => {
    // Black rotates the board, so b3's anchor moves to (456, 156). The badge
    // offset stays +21/-21 in SCREEN space rather than rotating with the board,
    // which is the whole point: a badge is always up-and-right of its piece.
    const svg = xiangqiMarkerSvg({ square: 'b3', kind: 'glyph', text: '?' }, 'black');
    expect(svg).toContain('cx="477" cy="135"');
  });

  it('keeps a corner badge inside the board edge (offset + radius <= margin)', () => {
    // i10 is the far corner in red perspective: x = 516, y = 36. The disc spans
    // 516+21±13 = [524, 550] and 36-21±13 = [2, 28], inside the 552x612 box.
    const svg = xiangqiMarkerSvg({ square: 'i10', kind: 'glyph', text: '?!' }, 'red');
    expect(svg).toContain('cx="537" cy="15" r="13"');
  });

  it('carries the tone class so the board palette matches the move list', () => {
    const svg = xiangqiMarkerSvg(
      { square: 'e3', kind: 'glyph', text: '?', className: 'xq-marker--mistake' },
      'red',
    );
    expect(svg).toContain('class="xq-marker xq-marker--mistake xq-marker--glyph"');
  });

  it('escapes the label rather than injecting it as markup', () => {
    const svg = xiangqiMarkerSvg({ square: 'e3', kind: 'glyph', text: '<b>&' }, 'red');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('&lt;b&gt;&amp;');
  });

  it('draws nothing for a glyph with no label, rather than a blank disc', () => {
    expect(xiangqiMarkerSvg({ square: 'e3', kind: 'glyph' }, 'red')).toBe('');
    expect(xiangqiMarkerSvg({ square: 'e3', kind: 'glyph', text: '' }, 'red')).toBe('');
  });

  it('leaves the existing circle and star kinds alone', () => {
    expect(xiangqiMarkerSvg({ square: 'b3', kind: 'circle' }, 'red')).toContain('cx="96" cy="456"');
    expect(xiangqiMarkerSvg({ square: 'b3', kind: 'star' }, 'red')).toContain('xq-marker--star');
  });
});

describe('interactive board arrow overlay', () => {
  function mountBoard() {
    const host = document.createElement('div');
    document.body.append(host);
    const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-board-arrows'), 'red');
    const board = createXiangqiInteractiveBoard({
      board: host,
      getInteractionView: () => view,
      getPerspective: () => 'red',
      seatFor: () => 'red',
      enabled: () => true,
      onMove: () => {},
    });
    board.render(view, 'red');
    return { host, board, view };
  }

  const PV_ARROWS: XiangqiBoardArrow[] = [
    { from: 'b1', to: 'c3', className: 'xq-arrow--pv3', opacity: 0.35, width: 7 },
    { from: 'b3', to: 'b7', className: 'xq-arrow--pv2', opacity: 0.55, width: 8 },
    { from: 'h3', to: 'e3', className: 'xq-arrow--pv1', opacity: 0.9, width: 9 },
  ];

  it('setArrows patches the arrows layer in place with ranked opacity, strongest last', () => {
    const { host, board } = mountBoard();
    board.setArrows(PV_ARROWS);
    const groups = [...host.querySelectorAll('.xq-live-arrows .xq-arrow')];
    expect(groups).toHaveLength(3);
    // Array order = draw order: weakest first, PV1 painted last (on top).
    expect(groups.map((g) => g.getAttribute('opacity'))).toEqual(['0.35', '0.55', '0.9']);
    expect(groups[2]?.getAttribute('class')).toContain('xq-arrow--pv1');
    host.remove();
  });

  it('clears with an empty list and survives a full re-render until cleared', () => {
    const { host, board, view } = mountBoard();
    board.setArrows(PV_ARROWS);
    // A full innerHTML re-render (ply/flip/selection) must keep the overlay.
    board.render(view, 'red');
    expect(host.querySelectorAll('.xq-live-arrows .xq-arrow')).toHaveLength(3);
    board.setArrows([]);
    expect(host.querySelectorAll('.xq-live-arrows .xq-arrow')).toHaveLength(0);
    host.remove();
  });

  it('puts judgment badges in a band ABOVE the arrows, ringed markers below', () => {
    const { host, board } = mountBoard();
    try {
      board.setArrows([{ from: 'b3', to: 'e3' }]);
      board.setMarkers([
        { square: 'e3', kind: 'glyph', text: '??' },
        { square: 'b3', kind: 'circle' },
      ]);
      const html = host.innerHTML;
      expect(host.querySelector('.xq-live-markers')?.innerHTML).toContain('xq-marker--circle');
      expect(host.querySelector('.xq-live-markers')?.innerHTML).not.toContain('xq-marker--glyph');
      expect(host.querySelector('.xq-live-glyphs')?.innerHTML).toContain('xq-marker--glyph');
      // Document order is paint order: an arrowhead landing on the annotated
      // point must not cover the verdict.
      expect(html.indexOf('xq-live-arrows')).toBeLessThan(html.indexOf('xq-live-glyphs'));
    } finally {
      host.remove();
    }
  });

  it('patches streamed arrows and markers using the mounted square-grid geometry', () => {
    window.history.replaceState(null, '', '/analysis/xiangqi?xqLayout=cell');
    const { host, board } = mountBoard();
    try {
      board.setArrows([{ from: 'b3', to: 'b7' }]);
      board.setMarkers([{ square: 'b3', kind: 'circle' }]);

      const arrow = host.querySelector('.xq-live-arrows')?.innerHTML ?? '';
      expect(arrow).toContain('<line x1="96" y1="456" x2="96" y2="236"');
      expect(arrow).toContain('<polygon points="96,216 107,236 85,236"');
      expect(host.querySelector('.xq-live-markers')?.innerHTML).toContain('cx="96" cy="468"');
    } finally {
      host.remove();
      window.history.replaceState(null, '', '/');
    }
  });

  it('renders posted ceval MultiPV lines as weighted arrows and clears them again', async () => {
    // The real pipeline the review glue drives: CevalLine[] -> spec builder ->
    // setArrows. Three near-equal lines -> three arrows at one opacity, with
    // shaft width carrying the strength (plus the faint dashed PV1 reply at the
    // bottom of the stack when that is enabled).
    const { engineArrowsFromLines, SHOW_PV1_REPLY_SEGMENT } = await import(
      './review/engine/engine-arrows.js'
    );
    const { host, board } = mountBoard();
    board.setArrows(
      engineArrowsFromLines([
        { multipv: 1, depth: 18, scoreCp: 35, mate: null, pvUci: ['h3e3', 'h8e8'] },
        { multipv: 2, depth: 18, scoreCp: 12, mate: null, pvUci: ['b3e3'] },
        { multipv: 3, depth: 18, scoreCp: 4, mate: null, pvUci: ['b1c3'] },
      ]),
    );
    const groups = [...host.querySelectorAll('.xq-live-arrows .xq-arrow')].filter(
      (g) => !(g.getAttribute('class') ?? '').includes('reply'),
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.getAttribute('class')?.split(' ').at(-1))).toEqual([
      'xq-arrow--alt',
      'xq-arrow--alt',
      'xq-arrow--pv1',
    ]);
    // Alternates share one opacity; the best move is last (on top) and widest.
    const widthOf = (g: Element) => Number(g.querySelector('line')?.getAttribute('stroke-width'));
    expect(groups.slice(0, 2).map((g) => Number(g.getAttribute('opacity')))).toEqual([0.35, 0.35]);
    expect(widthOf(groups[2]!)).toBeGreaterThan(widthOf(groups[1]!));
    // Head scales with the shaft: the thinner alternate carries the smaller head.
    const headSpan = (g: Element) => {
      const pts = (g.querySelector('polygon')?.getAttribute('points') ?? '').split(' ');
      return Math.abs(Number(pts[1]?.split(',')[1]) - Number(pts[2]?.split(',')[1]));
    };
    expect(headSpan(groups[2]!)).toBeGreaterThan(headSpan(groups[1]!));
    // Engine toggled off / ply changed: the glue posts a clear.
    board.setArrows([]);
    expect(host.querySelectorAll('.xq-live-arrows .xq-arrow')).toHaveLength(0);
    host.remove();
    expect(SHOW_PV1_REPLY_SEGMENT).toBe(false);
  });
});

// The `coordinates` option is tri-state, and the two forced states exist for
// surfaces where the labels are the subject rather than a convenience.
describe('board coordinate labels', () => {
  const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-coords'), 'red');
  const base = { interactive: false, selectedSquare: null, draggingFrom: null } as const;
  const labelCount = (svg: string): number => svg.split('class="xq-live-coord"').length - 1;

  it('follows the reader preference when the option is omitted', () => {
    writeDisplayPreference('boardCoordinates', false);
    expect(labelCount(xiangqiBoardSvg(view, 'red', { ...base }))).toBe(0);
    writeDisplayPreference('boardCoordinates', true);
    expect(labelCount(xiangqiBoardSvg(view, 'red', { ...base }))).toBeGreaterThan(0);
  });

  // The coordinate trainer's training-wheels toggle would be inert without
  // this: boardCoordinates defaults to OFF, so `true` has to mean on rather
  // than "on if the reader already turned it on".
  it('forces labels on over a preference that is off', () => {
    writeDisplayPreference('boardCoordinates', false);
    const svg = xiangqiBoardSvg(view, 'red', { ...base, coordinates: true });
    expect(labelCount(svg)).toBeGreaterThan(0);
  });

  it('forces labels off over a preference that is on', () => {
    writeDisplayPreference('boardCoordinates', true);
    expect(labelCount(xiangqiBoardSvg(view, 'red', { ...base, coordinates: false }))).toBe(0);
  });

  // A surface teaching one system must be able to pin it. Without this the
  // trainer labels the board in whatever the reader's move notation happens to
  // be, which can be the opposite system from the one it is drilling.
  it('pins the label system when asked, over the notation preference', () => {
    const algebraic = xiangqiBoardSvg(view, 'red', {
      ...base,
      coordinates: true,
      coordinateStyle: 'coordinate',
    });
    expect(algebraic).toContain('>a<');
    expect(algebraic).not.toContain('>一<');

    const chinese = xiangqiBoardSvg(view, 'red', {
      ...base,
      coordinates: true,
      coordinateStyle: 'chinese-simplified',
    });
    expect(chinese).toContain('>一<');
    expect(chinese).not.toContain('>a<');
  });
});

// Start markers reach the live board through the shared surface: 14 brackets on
// the lined layout when on (the default), none when off or on the square grid.
describe('board start markers', () => {
  const view = getStandardXiangqiPlayerView(createInitialXiangqiState('xq-start-marks'), 'red');
  const base = { interactive: false, selectedSquare: null, draggingFrom: null } as const;
  const markCount = (svg: string): number => svg.split('class="xq-live-start-mark"').length - 1;

  it('draws the 14 start points by default, from either side', () => {
    document.documentElement.removeAttribute('data-xiangqi-start-markers');
    const svg = xiangqiBoardSvg(view, 'red', { ...base, layout: 'intersection' });
    expect(markCount(svg)).toBe(14);
    expect(markCount(xiangqiBoardSvg(view, 'black', { ...base, layout: 'intersection' }))).toBe(14);
    // Inside the grid group, so they sit under the pieces.
    const grid = svg.slice(svg.indexOf('<g class="xq-live-grid">'), svg.indexOf('</g>'));
    expect(markCount(grid)).toBe(14);
  });

  it('draws none when turned off or on the square grid', () => {
    document.documentElement.dataset.xiangqiStartMarkers = 'off';
    expect(markCount(xiangqiBoardSvg(view, 'red', { ...base, layout: 'intersection' }))).toBe(0);
    document.documentElement.dataset.xiangqiStartMarkers = 'on';
    expect(markCount(xiangqiBoardSvg(view, 'red', { ...base, layout: 'cell' }))).toBe(0);
    document.documentElement.removeAttribute('data-xiangqi-start-markers');
  });
});
