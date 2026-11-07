import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  FFQ_BANQI_FACE_UP_SQUARES,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { fanfanqiArticle } from './articles/content/fanfanqi.js';
import * as diagrams from './fanfanqi-rules-diagrams.js';
import { ffqBanqiBoardView, ffqBanqiSquare } from './ffq-banqi-board.js';
import { renderBanqiBoardSvg } from './live-banqi-render.js';
import {
  type FFQBanqiBoardRenderOptions,
  renderFFQBanqiBoardSvg,
} from './live-ffq-banqi-render.js';

function figure(svg: string): HTMLDivElement {
  const host = document.createElement('div');
  host.innerHTML = svg;
  return host;
}

describe('Fanfanqi rules diagrams', () => {
  const figures = {
    FANFANQI_SETUP: diagrams.FANFANQI_SETUP,
    FANFANQI_SHOT_BEFORE: diagrams.FANFANQI_SHOT_BEFORE,
    FANFANQI_SHOT_AFTER: diagrams.FANFANQI_SHOT_AFTER,
    FANFANQI_CAPTURE_CARDS: diagrams.FANFANQI_CAPTURE_CARDS,
    FANFANQI_RANK_LADDER: diagrams.FANFANQI_RANK_LADDER,
    FANFANQI_SOLDIER_TAKES_GENERAL: diagrams.FANFANQI_SOLDIER_TAKES_GENERAL,
    FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER: diagrams.FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER,
    FANFANQI_CANNON_SHOT: diagrams.FANFANQI_CANNON_SHOT,
  };

  for (const [name, draw] of Object.entries(figures)) {
    it(`${name} renders with kernel-checked marks`, () => {
      expect(draw().startsWith('<svg')).toBe(true);
      expect(figure(draw()).querySelector('svg[data-fanfanqi-diagram]')).not.toBeNull();
    });
  }

  it('places every figure in its matching section', () => {
    const sections = fanfanqiArticle.sections;
    const shape = (heading: string) =>
      sections
        .find((s) => s.heading === heading)!
        .blocks!.map((b) => (b.kind === 'raw-svg' ? b.svg : b.kind));
    expect(sections.map((s) => s.heading).slice(0, 5)).toEqual([
      'Board and setup',
      'Turns and flips',
      'Steps and the rank ladder',
      'HP and capture damage',
      'Cannons only capture',
    ]);
    expect(shape('Board and setup')).toEqual([
      'paragraph',
      'paragraph',
      figures.FANFANQI_SETUP,
      'paragraph',
    ]);
    const ranks = sections.find((s) => s.heading === 'Steps and the rank ladder')!.blocks!;
    expect(ranks.find((b) => b.kind === 'raw-svg')).toMatchObject({
      svg: figures.FANFANQI_RANK_LADDER,
    });
    expect(ranks.find((b) => b.kind === 'svg-row')).toMatchObject({
      items: [
        { svg: figures.FANFANQI_SOLDIER_TAKES_GENERAL },
        { svg: figures.FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER },
      ],
    });
    const cannons = sections.find((s) => s.heading === 'Cannons only capture')!.blocks!;
    // Each step's paragraph comes before its own diagram.
    expect(cannons.map((b) => (b.kind === 'raw-svg' ? b.svg : b.kind))).toEqual([
      'paragraph',
      'paragraph',
      figures.FANFANQI_CANNON_SHOT,
      'paragraph',
      'svg-row',
      'paragraph',
      figures.FANFANQI_CAPTURE_CARDS,
      'paragraph',
    ]);
    expect(cannons.find((b) => b.kind === 'svg-row')).toMatchObject({
      items: [{ svg: figures.FANFANQI_SHOT_BEFORE }, { svg: figures.FANFANQI_SHOT_AFTER }],
    });
  });

  it('starts with 28 backs and four fixed face-up squares of both colors', () => {
    const host = figure(figures.FANFANQI_SETUP());
    expect(host.querySelectorAll('.banqi-back')).toHaveLength(28);
    const squares = [...host.querySelectorAll('[data-piece-square]')]
      .filter((slot) => !slot.querySelector('.banqi-back'))
      .map((slot) => slot.getAttribute('data-piece-square'));
    expect(squares.sort()).toEqual(FFQ_BANQI_FACE_UP_SQUARES.map(ffqBanqiSquare).sort());
    expect(host.querySelector('[aria-label^="red "]')).not.toBeNull();
    expect(host.querySelector('[aria-label^="black "]')).not.toBeNull();
    expect(host.querySelector('.banqi-lastmove, .banqi-hint, .banqi-selection')).toBeNull();
    // Every square is full: the only non-flip moves are the cannon's shots.
    const setup = createInitialFFQBanqiState('fanfanqi-setup', 2);
    expect(
      getFFQBanqiLegalMoves(setup)
        .filter((m) => m.from !== m.to)
        .map((m) => `${m.from}-${m.to}`),
    ).toEqual(['6-4', '6-14']);
  });

  it('shows the shot before, with both targets dotted, and after, with the shot tinted', () => {
    expect(figure(figures.FANFANQI_SHOT_BEFORE()).querySelectorAll('.banqi-hint')).toHaveLength(2);
    const host = figure(figures.FANFANQI_SHOT_AFTER());
    expect(host.querySelectorAll('.banqi-back')).toHaveLength(27);
    // The room tints both ends of a move: where the cannon stood and where it landed.
    expect(host.querySelectorAll('.banqi-lastmove')).toHaveLength(2);
  });

  it('gives both players the same capture card, read from each seat’s own view', () => {
    const setup = createInitialFFQBanqiState('fanfanqi-setup', 2);
    const after = applyFFQBanqiMove(setup, { from: 6, to: 4 });
    const cards = diagrams.coveredCaptureKnowledge(setup, after);
    expect(cards).toEqual([
      { seat: 'red', owner: 'black', role: 'soldier', hpBefore: 60, hpAfter: 58 },
      { seat: 'black', owner: 'black', role: 'soldier', hpBefore: 60, hpAfter: 58 },
    ]);
    const text = figure(figures.FANFANQI_CAPTURE_CARDS()).textContent!;
    expect(text).toContain('RED SEES');
    expect(text).toContain('BLACK SEES');
    expect(text.match(/a black soldier was taken/g)).toHaveLength(2);
    expect(text.match(/Black HP: 60 → 58/g)).toHaveLength(2);
    // Planted: a position with no covered capture cannot draw the cards.
    expect(() => diagrams.coveredCaptureKnowledge(setup, setup)).toThrow(/no face-down capture/);
  });

  it('matches the prose exceptions to the kernel, and draws both colors', () => {
    expect(diagrams.ladderExceptions()).toEqual([
      { attacker: 'general', victim: 'soldier', captures: false },
      { attacker: 'soldier', victim: 'general', captures: true },
    ]);
    const host = figure(figures.FANFANQI_RANK_LADDER());
    expect(host.querySelectorAll('[aria-label^="red "]')).toHaveLength(7);
    expect(host.querySelectorAll('[aria-label^="black "]')).toHaveLength(7);
    expect(host.querySelectorAll('path[stroke], polygon, line')).toHaveLength(0);
  });

  it('shows the soldier capture and refuses the reverse capture', () => {
    expect(
      figure(figures.FANFANQI_SOLDIER_TAKES_GENERAL()).querySelectorAll('.banqi-hint-capture'),
    ).toHaveLength(1);
    expect(
      figure(figures.FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER()).querySelectorAll(
        '.banqi-hint-capture',
      ),
    ).toHaveLength(0);
  });

  it('marks each cannon target with the room’s dot or ring, and nothing else', () => {
    // The room uses a dot on a covered target, a ring on a revealed target.
    for (const [draw, targets] of [
      [figures.FANFANQI_CANNON_SHOT, [[21, 'banqi-hint-capture']]],
      [
        figures.FANFANQI_SHOT_BEFORE,
        [
          [4, 'banqi-hint'],
          [14, 'banqi-hint'],
        ],
      ],
    ] as const) {
      const host = figure(draw());
      expect(host.querySelectorAll('.banqi-hint, .banqi-hint-capture')).toHaveLength(
        targets.length,
      );
      const marks = [...host.querySelectorAll('.banqi-hint, .banqi-hint-capture')].map(
        (m) => `${m.getAttribute('class')}@${m.getAttribute('cx')},${m.getAttribute('cy')}`,
      );
      for (const [index, markClass] of targets) {
        expect(host.querySelector(`[data-piece-square="${ffqBanqiSquare(index)}"]`)).not.toBeNull();
        const at = `${28 + 64 * (Math.floor(index / 4) + 0.5)},${28 + 64 * (3.5 - (index % 4))}`;
        expect(marks).toContain(`${markClass}@${at}`);
      }
      expect(host.querySelectorAll('.banqi-selection')).toHaveLength(1);
    }
  });

  it('throws for a planted wrong expectation', () => {
    const state = createInitialFFQBanqiState('wrong-expect', 2);
    state.board = Array(32).fill(null);
    state.board[9] = { color: 'red', role: 'cannon', faceDown: false };
    const draw = diagrams.fanfanqiMoveDiagram({ id: 'wrong', state, from: 9, expect: [10] });
    expect(draw).toThrow(/kernel allows 9 -> \[\], diagram expects \[10\]/);
  });

  it('renders identical SVG when every identity beneath the backs changes', () => {
    const original = createInitialFFQBanqiState('hidden-identities', 2);
    const changed = {
      ...original,
      board: original.board.map((piece) =>
        !piece?.faceDown
          ? piece
          : {
              ...piece,
              color: piece.color === 'red' ? ('black' as const) : ('red' as const),
              role: piece.role === 'soldier' ? ('general' as const) : ('soldier' as const),
            },
      ),
    };
    // Test both an unselected position and a cannon with covered targets.
    original.board[6] = changed.board[6] = { color: 'red', role: 'cannon', faceDown: false };
    const targets = getFFQBanqiLegalMoves(original)
      .filter((m) => m.from === 6 && m.from !== m.to)
      .map((m) => m.to);
    expect(targets.length).toBeGreaterThan(0);
    const position = (state: typeof original) =>
      diagrams.fanfanqiPositionDiagram({ id: 'hidden', state })();
    const move = (state: typeof original) =>
      diagrams.fanfanqiMoveDiagram({ id: 'hidden-move', state, from: 6, expect: targets })();
    expect(position(original)).toBe(position(changed));
    expect(move(original)).toBe(move(changed));
    for (const slot of figure(move(changed)).querySelectorAll('[data-piece-square]')) {
      if (slot.querySelector('.banqi-back')) {
        expect(slot.outerHTML).not.toMatch(
          /red|black|soldier|general|advisor|elephant|chariot|horse|cannon/,
        );
        expect(slot.querySelector('image, [aria-label]')).toBeNull();
      }
    }
  });

  it('preserves the room’s SVG exactly across seats, selection, dragging and last moves', () => {
    const start = createInitialFFQBanqiState('room-parity', 2);
    const flipped = applyFFQBanqiMove(start, { from: 9, to: 9 });
    const options: FFQBanqiBoardRenderOptions[] = [
      { interactive: true, selectedSquare: null, draggingFrom: null, coordinates: false },
      { interactive: true, selectedSquare: 'b3', draggingFrom: 'b3', coordinates: true },
    ];
    for (const state of [start, flipped]) {
      for (const perspective of ['red', 'black', 'observer'] as const) {
        const view = getFFQBanqiPlayerView(state, perspective);
        const projected = ffqBanqiBoardView(view);
        for (const opts of options) {
          const previous = renderBanqiBoardSvg(projected, projected.perspective, {
            ...opts,
            legalMoves: opts.selectedSquare
              ? projected.legalMoves.filter(
                  (m) => m.from === opts.selectedSquare && m.from !== m.to,
                )
              : [],
          });
          expect(renderFFQBanqiBoardSvg(view, opts)).toBe(previous);
        }
      }
    }
  });
});
