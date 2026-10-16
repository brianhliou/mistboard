// In a drop variant the reserve is part of the POSITION, not a capture ledger:
// a fortress board with hidden pockets does not say what is droppable, so the
// position cannot be read. These rows were removed once already as ordinary
// captured material (#166) and had to come back; this pins them so the next
// review-surface tidy cannot quietly take them again.
//
// Covers review / analysis / study in one place: all three mount this same
// presentation through mountTreeReview.
import { type FortressXiangqiMove, fsfUciToFortressXiangqiMove } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { mountFortressXiangqiReview } from './fortress-xiangqi-review.js';

const move = (uci: string): FortressXiangqiMove => {
  const m = fsfUciToFortressXiangqiMove(uci);
  if (!m) throw new Error(`bad uci ${uci}`);
  return m;
};

// Opening of the article's sample game, far enough in that both sides have
// captured. Regenerated 2026-09-02 with the river soldier: the old prefix had a
// black soldier stepping sideways at home, which that rule makes illegal.
const MOVES = [
  'e1e4',
  'b7b6',
  'e4f4',
  'd8f6',
  'f2f3',
  'b8c6',
  'f1e3',
  'c8d8',
  'e3c4',
  'a8c8',
  'g1e1',
  'c8c7',
  'e1e6',
  'c6b4',
  'c4b6',
  'c7c6',
  'e6c6',
  'b4c6',
  'R@c5',
  'R@d6',
  'P@f5',
  'c6b8',
  'f5f6',
  'd6b6',
  'f6e6',
  'N@f6',
  'e6f6',
  'b6f6',
].map(move);

function mount(moves: FortressXiangqiMove[]): HTMLElement {
  const root = document.createElement('div');
  document.body.append(root);
  mountFortressXiangqiReview(root, {
    ariaLabel: 'Fortress review',
    title: 'Fortress review',
    summary: '',
    moves,
    analysis: null,
  });
  return root;
}

describe('Fortress review reserves', () => {
  it('renders both pockets as material rows', () => {
    const root = mount(MOVES);
    const rows = root.querySelectorAll('.review-material-row');
    expect(rows).toHaveLength(2);
  });

  it('keeps both rows mounted from the start, before anything is captured', () => {
    // The empty case is the one that regressed: rows that only appear on the
    // first capture are what shoved the rail and got the feature pulled. The
    // band height itself is CSS, so what is assertable here is that both hosts
    // exist and stay in the document with an empty pocket.
    const root = mount([]);
    const rows = root.querySelectorAll('.review-material-row');
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.isConnected).toBe(true);
      // Carries the shared pocket class the reserved-band CSS keys off.
      expect(row.classList.contains('drop-mini-reserve-strip')).toBe(true);
    }
  });

  it('draws a slot for every droppable role, ghosting the ones held none of', () => {
    // The lichess crazyhouse pocket shape. Drawing the empty slots is what keeps
    // the row from reading as blank space, and what keeps a given piece in the
    // SAME slot all game, so a capture fills a gap instead of reflowing the row.
    const root = mount([]);
    for (const row of root.querySelectorAll('.review-material-row')) {
      const slots = row.querySelectorAll('.drop-mini-reserve-piece');
      // The lichess pocket order carried to xiangqi, Treasure last.
      expect([...slots].map((el) => (el as HTMLElement).dataset.role)).toEqual([
        'soldier',
        'cannon',
        'horse',
        'chariot',
        'elephant',
        'advisor',
        'treasure',
      ]);
      expect(row.classList.contains('drop-pocket')).toBe(true);
      // Nothing captured yet, so every slot is a ghost.
      expect(row.querySelectorAll('.drop-mini-reserve-piece.is-empty')).toHaveLength(7);
    }
  });

  it('keeps the slot count fixed once pieces are held, filling in place', () => {
    const root = mount(MOVES);
    for (const row of root.querySelectorAll('.review-material-row')) {
      expect(row.querySelectorAll('.drop-mini-reserve-piece')).toHaveLength(7);
    }
    // At least one slot is now filled rather than ghosted.
    const filled = root.querySelectorAll(
      '.review-material-row .drop-mini-reserve-piece:not(.is-empty)',
    );
    expect(filled.length).toBeGreaterThan(0);
  });

  it('shows captured pieces in the pockets once material has been taken', () => {
    const root = mount(MOVES);
    const tiles = root.querySelectorAll('.review-material-row .drop-mini-reserve-piece');
    expect(tiles.length).toBeGreaterThan(0);
  });
});
