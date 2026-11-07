import {
  applyFFQBanqiMove,
  createInitialFFQBanqiState,
  FFQ_BANQI_FACE_UP_SQUARES,
  getFFQBanqiLegalMoves,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { fanfanqiArticle } from './articles/content/fanfanqi.js';
import { BANQI_RANK_LADDER } from './banqi-rules-diagrams.js';
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
    FANFANQI_FIRST_FLIP: diagrams.FANFANQI_FIRST_FLIP,
    FANFANQI_REPLY_FLIP: diagrams.FANFANQI_REPLY_FLIP,
    FANFANQI_SOLDIER_TAKES_GENERAL: diagrams.FANFANQI_SOLDIER_TAKES_GENERAL,
    FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER: diagrams.FANFANQI_GENERAL_CANNOT_TAKE_SOLDIER,
    FANFANQI_CANNON_SHOT: diagrams.FANFANQI_CANNON_SHOT,
    FANFANQI_CANNON_GAMBLE: diagrams.FANFANQI_CANNON_GAMBLE,
    FANFANQI_CANNON_NO_SHOT: diagrams.FANFANQI_CANNON_NO_SHOT,
  };

  for (const [name, draw] of Object.entries(figures)) {
    it(`${name} renders with kernel-checked marks`, () => {
      expect(draw().startsWith('<svg')).toBe(true);
      expect(figure(draw()).querySelector('svg[data-fanfanqi-diagram]')).not.toBeNull();
    });
  }

  it('places every figure in its matching section and reuses the ladder unchanged', () => {
    const sections = fanfanqiArticle.sections;
    const setup = sections.find((s) => s.heading === 'Board and setup')!.blocks!;
    expect(setup.find((b) => b.kind === 'svg-row')).toMatchObject({
      items: [
        { svg: figures.FANFANQI_SETUP },
        { svg: figures.FANFANQI_FIRST_FLIP },
        { svg: figures.FANFANQI_REPLY_FLIP },
      ],
    });
    const ranks = sections.find((s) => s.heading === 'Steps and the rank ladder')!.blocks!;
    expect(ranks.find((b) => b.kind === 'raw-svg')).toMatchObject({ svg: BANQI_RANK_LADDER });
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
      figures.FANFANQI_CANNON_GAMBLE,
      'paragraph',
      figures.FANFANQI_CANNON_NO_SHOT,
    ]);
    expect(BANQI_RANK_LADDER()).toContain('<svg');
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
    expect(host.querySelector('.banqi-lastmove')).toBeNull();
  });

  it('advances the setup through two flips, tinting each tile with the mover’s color', () => {
    for (const [draw, backs, ink] of [
      [figures.FANFANQI_FIRST_FLIP, 27, 'red'],
      [figures.FANFANQI_REPLY_FLIP, 26, 'black'],
    ] as const) {
      const host = figure(draw());
      expect(host.querySelectorAll('.banqi-back')).toHaveLength(backs);
      expect(host.querySelectorAll('.banqi-lastmove')).toHaveLength(1);
      expect(host.querySelector(`.banqi-lastmove-flip.banqi-lastmove--${ink}`)).not.toBeNull();
    }
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
      [figures.FANFANQI_CANNON_GAMBLE, [[11, 'banqi-hint']]],
      [figures.FANFANQI_CANNON_NO_SHOT, []],
    ] as const) {
      const host = figure(draw());
      expect(host.querySelectorAll('.banqi-hint, .banqi-hint-capture')).toHaveLength(
        targets.length,
      );
      for (const [index, markClass] of targets) {
        const mark = host.querySelector(`.${markClass}`)!;
        expect(host.querySelector(`[data-piece-square="${ffqBanqiSquare(index)}"]`)).not.toBeNull();
        expect(mark.getAttribute('cx')).toBe(String(28 + 64 * (Math.floor(index / 4) + 0.5)));
        expect(mark.getAttribute('cy')).toBe(String(28 + 64 * (3.5 - (index % 4))));
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
