import {
  applyJieqiMove,
  getJieqiLegalMoves,
  type JieqiGameState,
  type JieqiSquare,
  parseJieqiFen,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  JIEQI_PUZZLE_LINES,
  JIEQI_PUZZLE_THUMBNAIL,
  type JieqiPuzzleLine,
  jieqiLinePath,
  jieqiPuzzleSearchArticle,
  LOTTERY_OUTCOMES,
  LOTTERY_UNSEEN,
  LOTTERY_VIEW_FEN,
  tileAverage,
  WHICH_TILE_OUTCOMES,
  XIANGQI_RULES_FUNNEL,
} from './articles/content/jieqi-puzzle-search.js';
import { embedLineFromSearch } from './embed/embed-route.js';
import { replayJieqiLine } from './jieqi-replay-board.js';

// Every board on the page is a line embed over a dealt position. Each test
// replays a line the way the embed does (replayJieqiLine) and checks the claim
// its caption makes, so a caption cannot drift from the position it shows.

const TOKEN = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;
const move = (token: string) => {
  const m = TOKEN.exec(token);
  if (!m) throw new Error(`bad token ${token}`);
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
};

function replay(line: JieqiPuzzleLine) {
  const replayed = replayJieqiLine(line.fen, line.moves);
  if (!replayed) throw new Error(`no dealt root: ${line.fen}`);
  return replayed;
}

function root(fen: string): JieqiGameState {
  const parsed = parseJieqiFen(fen);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.state;
}

function play(state: JieqiGameState, tokens: readonly string[]): JieqiGameState {
  let s = state;
  for (const token of tokens) {
    const next = applyJieqiMove(s, move(token));
    if (next === s) throw new Error(`illegal ${token}`);
    s = next;
  }
  return s;
}

const legal = (s: JieqiGameState) => getJieqiLegalMoves(s).map((m) => `${m.from}${m.to}`);
const mated = (s: JieqiGameState, winner: 'red' | 'black') =>
  s.status.type === 'finished' && s.status.winner === winner && s.status.reason === 'checkmate';

// The piece a square holds after a line, as the board shows it once revealed.
const roleAt = (s: JieqiGameState, square: string) => s.board[square as JieqiSquare]?.role;

/** Black mates in two from `s` (Black to move) against every Red defence,
 *  starting with `first` when given (the full search is slow in a test). */
function blackMatesInTwo(s: JieqiGameState, first?: string): boolean {
  const starts = first ? [move(first)] : getJieqiLegalMoves(s);
  return starts.some((m1) => {
    const a = applyJieqiMove(s, m1);
    if (mated(a, 'black')) return true;
    if (a.status.type !== 'playing') return false;
    return getJieqiLegalMoves(a).every((r) => {
      const b = applyJieqiMove(a, r);
      return (
        b.status.type === 'playing' &&
        getJieqiLegalMoves(b).some((m2) => mated(applyJieqiMove(b, m2), 'black'))
      );
    });
  });
}

describe('jieqi-puzzle-search lines', () => {
  for (const [name, line] of Object.entries(JIEQI_PUZZLE_LINES)) {
    it(`${name}: the embed replays every move from a dealt root`, () => {
      expect(replay(line).played).toHaveLength(line.moves.length);
      // The embed query carries the line intact (the fen is capped at 200).
      const spec = embedLineFromSearch(jieqiLinePath(line).split('?')[1] ?? '');
      expect(spec.fen).toBe(line.fen);
      expect(spec.moves).toEqual(line.moves);
      expect(spec.orientation).toBe(line.orientation);
    });
  }

  it('every embed on the page is one of these lines', () => {
    const paths = jieqiPuzzleSearchArticle.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => (b?.kind === 'embed' ? [b.path] : []));
    expect(new Set(paths)).toEqual(new Set(Object.values(JIEQI_PUZZLE_LINES).map(jieqiLinePath)));
  });

  it('lottery: a10 is a soldier and the move does not mate; a chariot there mates', () => {
    const dealt = replay(JIEQI_PUZZLE_LINES.lotteryDealt);
    expect(dealt.states[0]!.status).toEqual({ type: 'playing', turn: 'black' });
    const after = dealt.states.at(-1)!;
    expect(roleAt(after, 'a1')).toBe('soldier');
    expect(after.status.type).toBe('playing');
    expect(mated(replay(JIEQI_PUZZLE_LINES.lotteryChariot).states.at(-1)!, 'black')).toBe(true);
  });

  it("lottery table: Black's view still counts the chariot and cannon Red had taken", () => {
    const view = LOTTERY_VIEW_FEN.split(' ')[2]!;
    const truth = JIEQI_PUZZLE_LINES.lotteryDealt.fen.split(' ')[2]!;
    const black = (pool: string) =>
      Object.fromEntries([...pool.matchAll(/([rachnbp])(\d+)/g)].map((m) => [m[1], Number(m[2])]));
    // The view: one each of four pieces for two tiles, so one in four.
    expect(black(view)).toMatchObject({ r: 1, c: 1, p: 1, n: 1 });
    expect(LOTTERY_UNSEEN.map((row) => row.role).sort()).toEqual(['c', 'n', 'p', 'r']);
    // The truth: only the soldier and horse are still on the board.
    expect(black(truth)).toMatchObject({ r: 0, c: 0, p: 1, n: 1 });
    expect(JIEQI_PUZZLE_LINES.lotteryDealt.fen.split(' ')[5]!.slice(0, 2)).toBe('pn');
  });

  it("double or nothing: Black's tile was a soldier and took Red's soldier", () => {
    const line = replay(JIEQI_PUZZLE_LINES.doubleOrNothing);
    expect(line.states[0]!.board.a1?.role).toBe('soldier');
    expect(roleAt(line.states[1]!, 'a1')).toBe('soldier');
    expect(roleAt(line.states[1]!, 'a1') && line.states[1]!.board.a1?.color).toBe('black');
  });

  it("stored capture: i10xi4 is legal on each of Black's turns from move 10 to 15, and the tile is an elephant", () => {
    const line = replay(JIEQI_PUZZLE_LINES.storedCapture);
    const takeAt = JIEQI_PUZZLE_LINES.storedCapture.moves.indexOf('i10i4');
    expect(takeAt).toBe(10);
    for (let ply = 0; ply <= takeAt; ply += 2) {
      const s = line.states[ply]!;
      expect(s.status).toEqual({ type: 'playing', turn: 'black' });
      expect(legal(s)).toContain('i10i4');
      // The i4 tile is still Red's and still face down: a capture in reserve.
      expect(s.board.i4).toMatchObject({ color: 'red', faceDown: true });
    }
    // The line ends on the capture: six turns, five waits and the take.
    expect(takeAt).toBe(JIEQI_PUZZLE_LINES.storedCapture.moves.length - 1);
    expect(roleAt(line.states[takeAt + 1]!, 'i4')).toBe('elephant');
    // the opening frame's arrow is the capture, not the waiting move played
    expect(JIEQI_PUZZLE_LINES.storedCapture.arrow).toBe('i10i4');
    expect(jieqiLinePath(JIEQI_PUZZLE_LINES.storedCapture)).toContain('arrow=i10i4');
  });

  it('every other board is about its first move, so its arrow is the move played', () => {
    for (const [name, line] of Object.entries(JIEQI_PUZZLE_LINES)) {
      if (name === 'storedCapture') continue;
      expect((line as { arrow?: string }).arrow, name).toBeUndefined();
      expect(jieqiLinePath(line), name).toContain('arrows=1');
    }
  });

  describe('which tile', () => {
    const line = JIEQI_PUZZLE_LINES.whichTile;
    const start = root(line.fen);
    const [placement, stm, pools, rule, full, deal] = line.fen.split(' ');
    // The deal string lists Black's 12 tiles, then Red's 10 in board order:
    // c4 e4 g4 b3 h3 a1 c1 d1 g1 i1. Index 6 of Red's is c1.
    const redDeal = deal!.slice(12);
    const withC1 = (letter: string): JieqiGameState => {
      const swap = redDeal.indexOf(letter);
      const chars = [...redDeal];
      [chars[6], chars[swap]] = [chars[swap]!, chars[6]!];
      return root(
        [placement, stm, pools, rule, full, deal!.slice(0, 12) + chars.join('')].join(' '),
      );
    };

    // The full count (4 of Red's 38 moves stop the mate: c1-a3, e1-f1, e1-e2,
    // e4-e5) was a one-off search; here the test pins the threat and the answer.
    it('Black threatens mate in two starting d5-d1 against a quiet Red move', () => {
      expect(getJieqiLegalMoves(start)).toHaveLength(38);
      expect(blackMatesInTwo(play(start, ['i5i6']), 'd5d1')).toBe(true);
    });

    it('c1-a3 stops the mate for every piece c1 could be, and frees a1 to take back on d1', () => {
      for (const letter of ['R', 'A', 'B', 'N', 'C', 'P']) {
        expect(blackMatesInTwo(play(withC1(letter), ['c1a3']))).toBe(false);
      }
      expect(legal(play(start, ['c1a3', 'd5d1']))).toContain('a1d1');
    });

    it('the tile was an advisor and Black took the a5 cannon; only a chariot guards a5', () => {
      const game = replay(line);
      expect(roleAt(game.states[1]!, 'a3')).toBe('advisor');
      expect(start.board.a5?.role).toBe('cannon');
      expect(game.states[2]!.board.a5).toMatchObject({ color: 'black', role: 'chariot' });
      expect(legal(game.states[2]!).some((m) => m.endsWith('a5'))).toBe(false);
      expect(legal(play(withC1('R'), ['c1a3', 'd5a5']))).toContain('a3a5');
      expect(WHICH_TILE_OUTCOMES.filter((o) => o.reply !== 'd5xa5').map((o) => o.piece)).toEqual([
        'Chariot',
      ]);
      // The table's counts are Red's face-down pool in the dealt FEN.
      const red = Object.fromEntries(
        [...pools!.matchAll(/([RACPNB])(\d+)/g)].map((m) => [m[1], Number(m[2])]),
      );
      const letter: Record<string, string> = {
        Chariot: 'R',
        Advisor: 'A',
        Elephant: 'B',
        Horse: 'N',
        Cannon: 'C',
        Soldier: 'P',
      };
      for (const o of WHICH_TILE_OUTCOMES) expect(o.left).toBe(red[letter[o.piece]!]);
    });
  });

  it('survivor D is mate in the line shown, with no face-down piece on the board', () => {
    const line = replay(JIEQI_PUZZLE_LINES.survivorD);
    expect(Object.values(line.states[0]!.board).some((p) => p?.faceDown)).toBe(false);
    expect(line.played).toHaveLength(11);
    expect(mated(line.states.at(-1)!, 'black')).toBe(true);
  });

  it("survivor B: no face-down piece, Black's chariot falls two moves after i10-f10, and Red had i10-i9", () => {
    const line = replay(JIEQI_PUZZLE_LINES.survivorB);
    const start = line.states[0]!;
    expect(Object.values(start.board).some((p) => p?.faceDown)).toBe(false);
    expect(line.played[0]).toEqual({ from: 'i10', to: 'f10' });
    // e9xf8 on the line's third move takes the chariot that blocked on f8
    expect(line.states[2]!.board.f8).toMatchObject({ color: 'black', role: 'chariot' });
    expect(line.states[3]!.board.f8).toMatchObject({ color: 'red' });
    // the move Red played in the game instead
    expect(legal(start)).toContain('i10i9');
  });

  it('survivor C turns a tile over only on its last move', () => {
    const line = replay(JIEQI_PUZZLE_LINES.survivorC);
    line.played.forEach((m, i) => {
      const faceDown = line.states[i]!.board[m.from]?.faceDown ?? false;
      expect(faceDown).toBe(i === line.played.length - 1);
    });
  });

  it("the fairest capture: the h1 tile takes Black's chariot on g3, whatever it is", () => {
    const line = replay(JIEQI_PUZZLE_LINES.fairest);
    const start = line.states[0]!;
    expect(start.board.h1).toMatchObject({ color: 'red', faceDown: true });
    expect(start.board.g3).toMatchObject({ color: 'black', role: 'chariot' });
    expect(line.states[1]!.board.g3?.color).toBe('red');
  });

  it('the chart averages match the prose: 25.1% and about 36%', () => {
    expect(tileAverage(LOTTERY_OUTCOMES).toFixed(1)).toBe('25.1');
    expect(Math.round(tileAverage(WHICH_TILE_OUTCOMES))).toBe(36);
    const wins = WHICH_TILE_OUTCOMES.map((o) => o.win);
    expect([Math.min(...wins), Math.max(...wins)]).toEqual([32, 43]);
  });

  it('the funnel adds up, and its survivors are the four lines shown', () => {
    const f = XIANGQI_RULES_FUNNEL;
    expect(f.passed - f.mateInOne - f.singleLegalMove).toBe(f.left);
    const survivors = Object.keys(JIEQI_PUZZLE_LINES).filter((k) => k.startsWith('survivor'));
    expect(survivors).toHaveLength(f.left);
  });

  it('the card art is the lottery as dealt: a10 face down, a10-a1 legal, from Black', () => {
    const thumb = jieqiPuzzleSearchArticle.thumbnail;
    expect(thumb?.kind).toBe('svg');
    expect(thumb && thumb.kind === 'svg' ? thumb.svg : null).toBe(JIEQI_PUZZLE_THUMBNAIL);
    const svg = JIEQI_PUZZLE_THUMBNAIL();
    expect(svg).toContain('aria-label="Black\'s face-down tile on a10');
    expect(svg).toContain('xq-arrow-a10-a1');
    const parsed = parseJieqiFen(JIEQI_PUZZLE_LINES.lotteryDealt.fen);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.board.a10?.faceDown).toBe(true);
    expect(parsed.state.board.a10?.color).toBe('black');
    const legal = getJieqiLegalMoves(parsed.state).map((m) => `${m.from}${m.to}`);
    expect(legal).toContain('a10a1');
  });
});
