import { createInitialXiangqiState, standardXiangqiFen, type XiangqiMove } from '@mistboard/game';
import { expect, test } from 'vitest';
import { BLACK_STALEMATE_ICCS } from './articles/content/shortest-stalemate-xiangqi.js';
import { broadcastGamePgn } from './xiangqi-broadcast-pgn.js';
import {
  mountXiangqiReplay,
  mountXiangqiReplayBoard,
  resultFromFinalPosition,
  type XiangqiReplaySpec,
} from './xiangqi-replay.js';

const shuffle = 'h0g2 h9g7 g2h0 g7h9';
const base: XiangqiReplaySpec = {
  iccs: `${shuffle} ${shuffle} h2e2 b9c7`,
  red: 'Red',
  black: 'Black',
  event: 'Record',
  resultText: '*',
  annotations: { byPly: { 9: { glyph: '?', line: 'h2e2 b9c7' } } },
};

test('broadcast PGN retains WXF after repetition', () => {
  const moves: XiangqiMove[] = base.iccs
    .split(' ')
    .map(
      (t) =>
        ({ from: `${t[0]}${Number(t[1]) + 1}`, to: `${t[2]}${Number(t[3]) + 1}` }) as XiangqiMove,
    );
  const pgn = broadcastGamePgn({
    boardId: 'record',
    red: { name: 'Red' },
    black: { name: 'Black' },
    result: '*',
    moves,
    origin: 'https://mistboard.com',
  });
  expect(pgn).toContain('C2.5');
  expect(pgn).not.toMatch(/h2e2|h3-e3/);
});

test('article infers a terminal result beyond the no-capture ruling', () => {
  const startFen = standardXiangqiFen({
    ...createInitialXiangqiState('record'),
    progressClock: 59,
  });
  expect(resultFromFinalPosition({ ...base, startFen, iccs: BLACK_STALEMATE_ICCS })).toBe('1-0');
});

for (const compact of [false, true]) {
  test(`article ${compact ? 'compact' : 'full'} board plays a variation beyond repetition`, () => {
    const el = document.createElement('div');
    document.body.append(el);
    if (compact) {
      const board = mountXiangqiReplayBoard(el, base);
      board.jumpToLine(9, 1);
      const before = el.querySelector('svg')?.outerHTML;
      board.jumpToLine(9, 2);
      expect(el.querySelector('svg')?.outerHTML).not.toBe(before);
      board.destroy();
    } else {
      const board = mountXiangqiReplay(el, base);
      const branches = el.querySelectorAll<HTMLButtonElement>(
        '.xq-replay-branch .xq-replay-move-button',
      );
      expect(branches).toHaveLength(2);
      branches[0]!.click();
      const first = el.querySelector('.raw-svg-stepper-frame-xq')?.innerHTML;
      branches[1]!.click();
      expect(el.querySelector('.raw-svg-stepper-frame-xq')?.innerHTML).not.toBe(first);
      board.destroy();
    }
    el.remove();
  });
}
