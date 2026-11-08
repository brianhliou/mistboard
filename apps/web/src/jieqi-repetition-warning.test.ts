import {
  applyJieqiMove,
  createInitialJieqiState,
  createJieqiChasePosition,
  getJieqiPlayerView,
  type JieqiBoard,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPlayerView,
  jieqiRepetitionPositionKey,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  jieqiRepetitionWarning,
  placeRepetitionLabel,
  repetitionWarningMode,
} from './jieqi-repetition-warning.js';

const parse = (line: string): JieqiMove[] =>
  line.split(' ').map((token) => {
    const [from, to] = token.split('-');
    return { from, to } as JieqiMove;
  });
const piece = (color: JieqiColor, role: 'general' | 'chariot' | 'horse', faceDown = false) => ({
  color,
  role,
  faceDown,
});
const chaseBoard: JieqiBoard = {
  d1: piece('red', 'general'),
  e10: piece('black', 'general'),
  b2: piece('red', 'chariot'),
  b4: piece('black', 'horse'),
  h8: piece('black', 'horse'),
};
const chaseCycle = 'b4-a6 b2-a2 a6-b4 a2-b2';
const checkBoard: JieqiBoard = {
  d1: piece('red', 'general'),
  e10: piece('black', 'general'),
  e8: piece('red', 'chariot'),
};
const checkCycle = 'e10-f10 e8-f8 f10-e10 f8-e8';

function initial(board: JieqiBoard, turn: JieqiColor): JieqiGameState {
  const base = createInitialJieqiState('warning', undefined, {
    repetition: true,
    adjudicationRule: 'jqe-v1',
  });
  const key = jieqiRepetitionPositionKey(board, turn, 'jqe-v1');
  return {
    ...base,
    board,
    status: { type: 'playing', turn },
    positionCounts: { [key]: 1 },
    repetitionLog: [{ key, chase: createJieqiChasePosition(board) }],
  };
}
function play(board: JieqiBoard, cycle: string, plies: number, turn: JieqiColor = 'black') {
  let state = initial(board, turn);
  const history: JieqiPlayerView[] = [getJieqiPlayerView(state, 'red')];
  const moves = parse(`${cycle} ${cycle}`);
  for (const move of moves.slice(0, plies)) {
    const next = applyJieqiMove(state, move);
    expect(next, `${move.from}-${move.to} is legal`).not.toBe(state);
    state = next;
    history.push(getJieqiPlayerView(state, 'red'));
  }
  return { state, history, view: getJieqiPlayerView(state, 'red') };
}

describe('public Jieqi repetition warning', () => {
  it('accepts only the four exact query modes', () => {
    for (const value of ['heads-up', 'mark', 'confirm', 'label'])
      expect(repetitionWarningMode(`?repwarn=${value}`)).toBe(value);
    for (const query of ['', '?repwarn=1', '?repwarn=', '?other=confirm'])
      expect(repetitionWarningMode(query)).toBeNull();
  });
  for (const [board, cycle, reason] of [
    [chaseBoard, chaseCycle, 'perpetual-chase'],
    [checkBoard, checkCycle, 'perpetual-check'],
  ] as const) {
    it(`warns both seats at twofold and matches the kernel's ${reason} loss`, () => {
      const twice = play(board, cycle, 4);
      for (const seat of ['red', 'black'])
        expect(jieqiRepetitionWarning('jqe-v1', twice.history, twice.view, seat).headsUp).toEqual({
          loser: 'red',
          reason,
        });
      const { state, history, view } = play(board, cycle, 7);
      const before = JSON.stringify({ state, history, view });
      const warning = jieqiRepetitionWarning('jqe-v1', history, view, 'red');
      expect(warning.losingMoves).toEqual([{ loser: 'red', reason, move: parse(cycle)[3] }]);
      expect(jieqiRepetitionWarning('jqe-v1', history, view, 'black').losingMoves).toEqual([]);
      for (const move of view.legalMoves) {
        const next = applyJieqiMove(state, move);
        const marked = warning.losingMoves.some(
          (loss) => loss.move.from === move.from && loss.move.to === move.to,
        );
        expect(marked).toBe(
          next.status.type === 'finished' &&
            next.status.winner === 'black' &&
            ['chasing', 'perpetual-chase'].includes(next.status.reason),
        );
      }
      expect(JSON.stringify({ state, history, view })).toBe(before);
    });
  }
  it('marks a Black checking loss with the correct colour', () => {
    const board: JieqiBoard = {
      f10: piece('black', 'general'),
      e1: piece('red', 'general'),
      e3: piece('black', 'chariot'),
    };
    const { history, state } = play(board, 'e1-d1 e3-d3 d1-e1 d3-e3', 7, 'red');
    const view = getJieqiPlayerView(state, 'black');
    expect(jieqiRepetitionWarning('jqe-v1', history, view, 'black').losingMoves).toEqual([
      { loser: 'black', reason: 'perpetual-check', move: { from: 'd3', to: 'e3' } },
    ]);
  });
  it('does not warn about the first occurrence, legacy games, incomplete history or a finished game', () => {
    const { history, view } = play(chaseBoard, chaseCycle, 3);
    expect(jieqiRepetitionWarning('jqe-v1', history, view, 'red')).toEqual({
      headsUp: null,
      losingMoves: [],
    });
    const twice = play(chaseBoard, chaseCycle, 7);
    for (const rule of [undefined, 'future-rule'])
      expect(jieqiRepetitionWarning(rule, twice.history, twice.view, 'red')).toEqual({
        headsUp: null,
        losingMoves: [],
      });
    expect(jieqiRepetitionWarning('jqe-v1', [], twice.view, 'red').headsUp).toBeNull();
    expect(jieqiRepetitionWarning('jqe-v1', history, twice.view, 'red').headsUp).toBeNull();
    const ended = play(chaseBoard, chaseCycle, 8);
    expect(jieqiRepetitionWarning('jqe-v1', ended.history, ended.view, 'red')).toEqual({
      headsUp: null,
      losingMoves: [],
    });
  });
  it('quiet repetitions draw without a warning', () => {
    const { history, view } = play(
      { d1: piece('red', 'general'), f10: piece('black', 'general') },
      'f10-f9 d1-d2 f9-f10 d2-d1',
      7,
    );
    expect(jieqiRepetitionWarning('jqe-v1', history, view, 'red')).toEqual({
      headsUp: null,
      losingMoves: [],
    });
  });
  it('an intermittent check does not become a perpetual-check or chase warning', () => {
    // The complete unequal interval includes Red's quiet e8-e7 move. Looking
    // only at its last short cycle would incorrectly name Red as a checker.
    const line = 'e10-f10 e8-e7 f10-f9 e7-e8 f9-f10 e8-f8 f10-e10 f8-e8';
    const { history, view } = play(checkBoard, line, 8);
    expect(jieqiRepetitionWarning('jqe-v1', history, view, 'black')).toEqual({
      headsUp: null,
      losingMoves: [],
    });
  });
  it('resets on real captures and reveals, and never predicts an unknown reveal', () => {
    for (const capture of [false, true]) {
      const board: JieqiBoard = {
        ...chaseBoard,
        c1: { color: 'red', role: 'elephant', faceDown: true },
        ...(capture ? { a3: piece('black', 'horse') } : {}),
      };
      const { history, state, view } = play(board, chaseCycle, 7);
      expect(
        jieqiRepetitionWarning('jqe-v1', history, view, 'red').losingMoves.some(
          ({ move }) => move.from === 'c1',
        ),
      ).toBe(false);
      const next = applyJieqiMove(state, { from: 'c1', to: 'a3' });
      expect(next).not.toBe(state);
      const after = getJieqiPlayerView(next, 'black');
      expect(jieqiRepetitionWarning('jqe-v1', [...history, after], after, 'black')).toEqual({
        headsUp: null,
        losingMoves: [],
      });
    }
  });
  it('swapping two hidden identities changes neither complete output nor physical chase responsibility', () => {
    const board: JieqiBoard = {
      ...chaseBoard,
      c1: piece('red', 'horse', true),
      g1: piece('red', 'chariot', true),
    };
    const { history, view } = play(board, chaseCycle, 7);
    // Even an accidentally truth-bearing input is masked before retention or keys.
    const withHidden = history.map((frame) => ({
      ...frame,
      board: { ...frame.board, c1: board.c1!, g1: board.g1! },
    }));
    const swapped = withHidden.map((frame) => ({
      ...frame,
      board: { ...frame.board, c1: board.g1!, g1: board.c1! },
    }));
    const first = jieqiRepetitionWarning(
      'jqe-v1',
      withHidden,
      { ...view, board: withHidden.at(-1)!.board },
      'red',
    );
    const second = jieqiRepetitionWarning(
      'jqe-v1',
      swapped,
      { ...view, board: swapped.at(-1)!.board },
      'red',
    );
    expect(first.losingMoves).toHaveLength(1);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('repetition point label placement', () => {
  const board = { left: 10, top: 20, width: 390, height: 440 };
  const label = { width: 128, height: 22 };
  const selected = { left: 180, top: 100, width: 40, height: 40 };

  it.each([
    [10, 20],
    [360, 20],
    [10, 420],
    [360, 420],
  ])('clamps inside the board at edge point (%i, %i)', (left, top) => {
    const placed = placeRepetitionLabel(
      { left, top, width: 40, height: 40 },
      board,
      label,
      selected,
      [],
    );
    expect(placed.left).toBeGreaterThanOrEqual(board.left + 4);
    expect(placed.top).toBeGreaterThanOrEqual(board.top + 4);
    expect(placed.left + label.width).toBeLessThanOrEqual(board.left + board.width - 4);
    expect(placed.top + label.height).toBeLessThanOrEqual(board.top + board.height - 4);
  });

  it('sits on the side away from the selected piece', () => {
    const placed = placeRepetitionLabel(
      { left: 180, top: 200, width: 40, height: 40 },
      board,
      label,
      selected,
      [],
    );
    expect(placed).toEqual({ left: 136, top: 244 });
  });

  it('prefers another outward side when a sibling legal destination is in the way', () => {
    const point = { left: 180, top: 200, width: 40, height: 40 };
    const sibling = { left: 180, top: 244, width: 40, height: 40 };
    const placed = placeRepetitionLabel(point, board, label, selected, [sibling]);
    expect(placed.top).toBeGreaterThanOrEqual(point.top + point.height);
    expect(
      placed.left + label.width <= sibling.left || placed.left >= sibling.left + sibling.width,
    ).toBe(true);
  });
});
