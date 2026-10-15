// Drops from the pockets on the Crazyhouse Xiangqi analysis board. The review
// drew both hands as inert pockets, so on /analysis/crazyhouse-xiangqi a piece in
// hand could be seen but never played: tapping it, or dragging it, did nothing on
// any device (Brian, iPhone, 2026-10-14). This mounts the real review (the same
// presentation the analysis board, the postgame and studies use) and plays a
// drop the way a reader does: tap the hand piece, then the point.
//
// The drag path is hand-drag.ts, shared with the live room; it resolves the
// drop point with elementFromPoint, which jsdom does not lay out, so the drag
// was driven with real CDP touch and mouse in a browser instead.

import {
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiMoveFromUci,
  isCrazyhouseXiangqiDropMove,
} from '@mistboard/game';
import { afterEach, describe, expect, it } from 'vitest';
import { mountCrazyhouseXiangqiReview } from './crazyhouse-xiangqi-review.js';

afterEach(() => {
  document.body.replaceChildren();
});

const move = (uci: string): CrazyhouseXiangqiMove => {
  const m = crazyhouseXiangqiMoveFromUci(uci);
  if (!m) throw new Error(`bad uci ${uci}`);
  return m;
};

// Brian's line: the chariot takes the horse, the chariot takes back. Red to
// move with a horse in hand, Black with a chariot.
const MOVES = ['b3b10', 'a10b10'].map(move);

function mount(moves: CrazyhouseXiangqiMove[] = MOVES) {
  const root = document.createElement('div');
  document.body.append(root);
  const lines: CrazyhouseXiangqiMove[][] = [];
  mountCrazyhouseXiangqiReview(root, {
    ariaLabel: 'Crazyhouse Xiangqi analysis',
    title: 'Crazyhouse Xiangqi analysis',
    summary: '',
    moves,
    analysis: null,
    onLineChange: (line) => lines.push(line),
  });
  // Land on the end of the given line, as /analysis?moves= does.
  root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  return { root, lines };
}

function handTile(root: HTMLElement, hand: 'red' | 'black', role: string): HTMLElement {
  const tile = root.querySelector<HTMLElement>(`[data-hand="${hand}"] [data-role="${role}"]`);
  if (!tile) throw new Error(`no ${hand} ${role} tile`);
  return tile;
}

function square(root: HTMLElement, sq: string): Element {
  const el = root.querySelector(`[data-square="${sq}"]`);
  if (!el) throw new Error(`no square ${sq}`);
  return el;
}

function lastMove(lines: CrazyhouseXiangqiMove[][]): CrazyhouseXiangqiMove | undefined {
  return lines.at(-1)?.at(-1);
}

describe('Crazyhouse Xiangqi review drops', () => {
  it("makes only the side to move's hand playable", () => {
    const { root } = mount();
    expect(handTile(root, 'red', 'horse').tagName).toBe('BUTTON');
    expect(handTile(root, 'black', 'chariot').tagName).toBe('SPAN');
  });

  it('drops a hand piece with a tap on the piece and a tap on the point', () => {
    const { root, lines } = mount();
    handTile(root, 'red', 'horse').click();
    expect(handTile(root, 'red', 'horse').classList.contains('selected')).toBe(true);
    // The points it may land on are marked like move targets.
    expect(square(root, 'e5').classList.contains('xq-live-hit--target')).toBe(true);

    square(root, 'e5').dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const played = lastMove(lines);
    expect(played && isCrazyhouseXiangqiDropMove(played)).toBe(true);
    expect(played).toMatchObject({ drop: 'horse', to: 'e5' });
    expect(lines.at(-1)).toHaveLength(3);
    // Black to move now: its hand takes over, Red's is spent.
    expect(handTile(root, 'black', 'chariot').tagName).toBe('BUTTON');
    expect(handTile(root, 'red', 'horse').tagName).toBe('SPAN');
  });

  it('puts the hand piece back on a tap off its targets', () => {
    const { root, lines } = mount();
    const before = lines.length;
    handTile(root, 'red', 'horse').click();
    // b10 holds Black's chariot: no drop lands on an occupied point.
    square(root, 'b10').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(lines.length).toBe(before);
    expect(handTile(root, 'red', 'horse').classList.contains('selected')).toBe(false);
    expect(square(root, 'e5').classList.contains('xq-live-hit--target')).toBe(false);
  });
});
