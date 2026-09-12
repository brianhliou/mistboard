import {
  createInitialRevealChessState,
  getRevealChessPlayerView,
  revealChessTruthView,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { renderRevealChessBoardSvg, revealChessFacedownDisc } from './reveal-chess-render.js';

describe('Reveal Chess board renderer', () => {
  it('renders an 8x8 board with face-up kings and face-down "?" discs', () => {
    const view = getRevealChessPlayerView(createInitialRevealChessState('r'), 'white');
    const svg = renderRevealChessBoardSvg(view);

    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<rect[^>]*fill="none"[^>]*stroke=/);
    // 64 board cells (8x8), each 50x50.
    expect((svg.match(/width="50" height="50"/g) ?? []).length).toBe(64);
    // The two kings are face-up cburnett glyphs (no recolor).
    expect((svg.match(/reveal-chess-facedown/g) ?? []).length).toBe(30);
    // No fog overlay: positions are public, only identities are hidden.
    expect(svg).not.toContain('var(--board-fog-light-fill)');
    expect(svg.toLowerCase()).not.toContain('mask');
    // The face-down disc carries the required "?" and palette.
    expect(svg).toContain('>?</text>');
  });

  it('renders the locked face-down disc spec (radius 0.40, "?" 0.46 serif bold, palette)', () => {
    const white = revealChessFacedownDisc('white', 0, 0, 50);
    expect(white).toContain('r="20"'); // 50 * 0.40
    expect(white).toContain('font-size="23"'); // 50 * 0.46
    expect(white).toContain('font-weight="700"');
    expect(white).toContain('font-family="Georgia, \'Times New Roman\', serif"');
    expect(white).toContain('fill="#f4efe4"'); // white body
    expect(white).toContain('stroke="#3a342b"'); // white rim
    expect(white).toContain('fill="#2b2620">?</text>'); // white "?"
    expect(white).not.toMatch(/<circle[^>]*r="(?:1[0-9]|[0-9])"/); // no inner ring

    const black = revealChessFacedownDisc('black', 0, 0, 50);
    expect(black).toContain('fill="#2b2620"'); // black body
    expect(black).toContain('stroke="#0d0b08"'); // black rim
    expect(black).toContain('fill="#efe7d6">?</text>'); // black "?"
  });

  it('never leaks a hidden identity (face-down entries carry no role)', () => {
    const view = getRevealChessPlayerView(createInitialRevealChessState('r'), 'white');
    const facedownSquares = Object.entries(view.board).filter(([, e]) => e?.faceDown);
    expect(facedownSquares.length).toBe(30);
    for (const [, entry] of facedownSquares) {
      expect(entry && 'role' in entry).toBe(false);
    }
  });

  it('reveals every identity in the truth view (cburnett glyphs, no discs)', () => {
    const truth = revealChessTruthView(createInitialRevealChessState('r'));
    const svg = renderRevealChessBoardSvg(truth);
    // Truth view has nothing face-down: all 32 pieces are real glyphs.
    expect(svg).not.toContain('reveal-chess-facedown');
    expect(svg).not.toContain('>?</text>');
  });

  it('flips the board for the black perspective', () => {
    const view = getRevealChessPlayerView(createInitialRevealChessState('o'), 'white');
    const whiteSvg = renderRevealChessBoardSvg(view, { perspective: 'white' });
    const blackSvg = renderRevealChessBoardSvg(view, { perspective: 'black' });
    expect(whiteSvg).not.toEqual(blackSvg);
  });

  it('emits a hit layer, selection highlight and target markers when interactive', () => {
    const view = getRevealChessPlayerView(createInitialRevealChessState('i'), 'white');
    const svg = renderRevealChessBoardSvg(view, {
      interactive: true,
      selected: 'b1',
      targets: ['a3', 'c3'],
    });
    // 64 transparent hit targets, one per square.
    expect((svg.match(/data-square="/g) ?? []).length).toBe(64);
    expect(svg).toContain('data-square="b1"');
    // Selection highlight + two move dots (empty targets) + hover-square overlays.
    expect(svg).toContain('rgba(31,111,91,0.32)');
    expect((svg.match(/rgba\(31,111,91,0\.72\)/g) ?? []).length).toBe(2);
    expect(svg).toContain('mb-grid-target-hover');
  });
});
