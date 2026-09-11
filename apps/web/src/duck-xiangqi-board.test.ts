import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiSquare,
  duckXiangqiDuckDestinations,
  getDuckXiangqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  type DuckXiangqiBoardPhase,
  duckXiangqiBoardSvg,
  duckXiangqiClickResult,
} from './duck-xiangqi-board.js';

const PIECE_PHASE = (selected: DuckXiangqiSquare | null): DuckXiangqiBoardPhase => ({
  kind: 'piece',
  selected,
});

function openingView(perspective: 'red' | 'black' = 'red') {
  return getDuckXiangqiPlayerView(createInitialDuckXiangqiState('t'), perspective);
}

/** The position after Red plays one full turn, so `duck` is on the board. */
function afterOneTurn() {
  const state = applyDuckXiangqiTurn(createInitialDuckXiangqiState('t'), {
    from: 'b3',
    to: 'e3',
    duckTo: 'e6',
  });
  if (!state) throw new Error('b3-e3@e6 should be a legal opening turn');
  return state;
}

// The click rules ARE the two-phase turn. Every bug this board has had lived in
// this function or in the list it is handed, so both are tested against the
// kernel rather than against a hand-written fixture.
describe('duckXiangqiClickResult', () => {
  it('selects a piece of the side to move', () => {
    const result = duckXiangqiClickResult({
      view: openingView(),
      seat: 'red',
      phase: PIECE_PHASE(null),
      targets: [],
      square: 'b3',
      capturesGeneral: () => false,
    });
    expect(result).toEqual({ kind: 'select', square: 'b3' });
  });

  it('ignores every click from the seat that is not to move', () => {
    const result = duckXiangqiClickResult({
      view: openingView('black'),
      seat: 'black',
      phase: PIECE_PHASE(null),
      targets: [],
      square: 'b8',
      capturesGeneral: () => false,
    });
    expect(result).toEqual({ kind: 'noop' });
  });

  it('arms phase two instead of sending, and sends NOTHING for the piece move', () => {
    const result = duckXiangqiClickResult({
      view: openingView(),
      seat: 'red',
      phase: PIECE_PHASE('b3'),
      targets: ['e3'],
      square: 'e3',
      capturesGeneral: () => false,
    });
    expect(result).toEqual({ kind: 'await-duck', move: { from: 'b3', to: 'e3' } });
  });

  it('completes the turn on the duck click, as ONE message', () => {
    const result = duckXiangqiClickResult({
      view: openingView(),
      seat: 'red',
      phase: { kind: 'duck', move: { from: 'b3', to: 'e3' } },
      targets: ['e6'],
      square: 'e6',
      capturesGeneral: () => false,
    });
    expect(result).toEqual({ kind: 'turn', turn: { from: 'b3', to: 'e3', duckTo: 'e6' } });
  });

  it('abandons the whole turn when phase two is clicked off-target', () => {
    const result = duckXiangqiClickResult({
      view: openingView(),
      seat: 'red',
      phase: { kind: 'duck', move: { from: 'b3', to: 'e3' } },
      targets: ['e6'],
      square: 'a1',
      capturesGeneral: () => false,
    });
    expect(result).toEqual({ kind: 'clear' });
  });

  it('finishes a general capture in ONE click, with duckTo null', () => {
    const result = duckXiangqiClickResult({
      view: openingView(),
      seat: 'red',
      phase: PIECE_PHASE('b3'),
      targets: ['e10'],
      square: 'e10',
      capturesGeneral: () => true,
    });
    expect(result).toEqual({ kind: 'turn', turn: { from: 'b3', to: 'e10', duckTo: null } });
  });

  // The regression that made the board look broken: the duck-target list the
  // caller derives has to contain the squares the caller then draws, or every
  // click in phase two reads as off-target and silently cancels the turn.
  it('accepts every duck square the kernel offers', () => {
    const view = openingView();
    const targets = duckXiangqiDuckDestinations(view.board, view.duck, 'b3', 'e3');
    expect(targets.length).toBe(58);
    for (const square of targets) {
      expect(
        duckXiangqiClickResult({
          view,
          seat: 'red',
          phase: { kind: 'duck', move: { from: 'b3', to: 'e3' } },
          targets,
          square,
          capturesGeneral: () => false,
        }).kind,
      ).toBe('turn');
    }
  });

  it('never offers the point the duck already stands on', () => {
    const state = afterOneTurn();
    expect(state.duck).toBe('e6');
    const targets = duckXiangqiDuckDestinations(state.board, state.duck, 'b8', 'e8');
    expect(targets).not.toContain('e6');
    expect(targets.length).toBe(57);
  });
});

describe('duckXiangqiBoardSvg', () => {
  it('draws the duck as its own token, not as a piece', () => {
    const view = getDuckXiangqiPlayerView(afterOneTurn(), 'red');
    const svg = duckXiangqiBoardSvg(view, 'red', {
      interactive: true,
      phase: PIECE_PHASE(null),
      targets: [],
    });
    expect(svg).toContain('data-duck-square="e6"');
    expect(svg).toContain('/piece-sets/xiangqi/animal-dobutsu/duck.png');
    // A duck drawn through the piece renderer would carry a piece slot.
    expect(svg).not.toContain('data-piece-square="e6"');
  });

  // ONE drawing, every set: the duck is an object rather than a role, so it has
  // no per-idiom form to switch to. Only its FRAME follows the set.
  it('draws the same duck in every piece set', () => {
    const view = getDuckXiangqiPlayerView(afterOneTurn(), 'red');
    const sets = [
      'international',
      'international-flat',
      'animal-dobutsu',
      'traditional',
      'simplified',
      'western',
      'symbols',
    ] as const;
    for (const pieceSet of sets) {
      const svg = duckXiangqiBoardSvg(view, 'red', {
        interactive: false,
        phase: PIECE_PHASE(null),
        targets: [],
        pieceSet,
      });
      expect(svg, pieceSet).toContain('/piece-sets/xiangqi/animal-dobutsu/duck.png');
      // Wherever the set draws a ring, that ring is the DUCK's own gold
      // (#b8860b, the variant's accent), never a seat's red or black: it is how
      // this board says "no seat", and the duck has none. It was a neutral grey
      // until 2026-09-11, which said the same thing by being absent and read as
      // a missing ring at board size. `international-flat` is the one set with
      // no disc at all, so it has no ring to colour. Asserted positively only:
      // the SVG is the WHOLE board, so a "never red" check would trip on the
      // red pieces standing next to the duck.
      if (pieceSet !== 'international-flat') {
        expect(svg, pieceSet).toContain('#b8860b');
      }
    }
  });

  // Phase one and phase two must not look alike: a player who has just moved and
  // sees dots again has to know instantly which question is being asked.
  it('marks phase one with the shared hint dot and phase two with the duck mark', () => {
    const view = openingView();
    const one = duckXiangqiBoardSvg(view, 'red', {
      interactive: true,
      phase: PIECE_PHASE('b3'),
      targets: ['e3'],
    });
    expect(one).toContain('xq-live-hint-dot');
    expect(one).not.toContain('dkx-target--duck');

    const two = duckXiangqiBoardSvg(view, 'red', {
      interactive: true,
      phase: { kind: 'duck', move: { from: 'b3', to: 'e3' } },
      targets: ['e6'],
    });
    expect(two).toContain('dkx-target--duck');
    expect(two).not.toContain('xq-live-hint-dot');
  });

  it('shows the piece at its destination while the duck is pending', () => {
    const view = openingView();
    const svg = duckXiangqiBoardSvg(view, 'red', {
      interactive: true,
      phase: { kind: 'duck', move: { from: 'b3', to: 'e3' } },
      targets: ['e6'],
    });
    expect(svg).toContain('data-piece-square="e3"');
    expect(svg).not.toContain('data-piece-square="b3"');
  });

  // Every point is clickable, including empty ones: a duck placement must be
  // exactly as easy to hit as a piece.
  it('gives all ninety points a hit area when interactive', () => {
    const svg = duckXiangqiBoardSvg(openingView(), 'red', {
      interactive: true,
      phase: PIECE_PHASE(null),
      targets: [],
    });
    expect(svg.match(/data-square="/g)?.length).toBe(90);
  });

  it('draws right-click arrows and circles', () => {
    const svg = duckXiangqiBoardSvg(openingView(), 'red', {
      interactive: true,
      phase: PIECE_PHASE(null),
      targets: [],
      arrows: [{ from: 'c4', to: 'c6', className: 'xq-arrow--draw' }],
      markers: [{ square: 'e5', kind: 'circle', className: 'xq-shape--green' }],
    });
    expect(svg).toContain('xq-arrow--draw');
    expect(svg).toContain('xq-marker--circle');
  });
});
