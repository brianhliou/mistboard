import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import {
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  type BanqiTablebaseAnswer,
  type BanqiTablebaseTable,
  banqiTablebaseTableFromBytes,
  banqiTablebaseUrl,
  decodeBanqiTablebaseSlot,
  isBanqiLegalMove,
  readBanqiTablebase,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  BANQI_ENDGAME_PARITY_EVEN,
  BANQI_ENDGAME_PARITY_ODD,
  BANQI_ENDGAME_ROOT,
  BANQI_ENDGAME_THUMBNAIL,
  ENDGAME_LINE,
  ENDGAME_ROOT_FEN,
  endgameState,
  endgameStateAt,
  PARITY_EVEN_FEN,
  PARITY_EVEN_PATH,
  PARITY_ODD_FEN,
  PARITY_ODD_PATH,
} from './banqi-endgame-diagrams.js';

// The shipped files, as the review board fetches them.
const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const cache = new Map<string, BanqiTablebaseTable>();
function table(key: string): BanqiTablebaseTable | undefined {
  const known = cache.get(key);
  if (known) return known;
  const bytes = gunzipSync(readFileSync(join(PUBLIC, banqiTablebaseUrl(key))));
  const parsed = banqiTablebaseTableFromBytes(key, new Uint8Array(bytes));
  if (!parsed) throw new Error(`${key}: wrong length`);
  cache.set(key, parsed);
  return parsed;
}

const CLOCK_OFF = Number.POSITIVE_INFINITY;

function answer(state: BanqiGameState, limit = CLOCK_OFF): BanqiTablebaseAnswer {
  const read = readBanqiTablebase(state, table, limit);
  if (!read) throw new Error('position not covered');
  return read;
}

const label = (m: BanqiMove) => `${m.from}-${m.to}`;
const winners = (a: BanqiTablebaseAnswer) => a.rows.filter((r) => r.result === 'win');

// A FEN with a black chariot and a red chariot, black to move.
function chariotsFen(black: BanqiSquare, red: BanqiSquare): string {
  const ranks = [4, 3, 2, 1].map((rank) => {
    let row = '';
    let gap = 0;
    for (const file of 'abcdefgh') {
      const sq = `${file}${rank}`;
      const letter = sq === black ? 'R' : sq === red ? 'r' : '';
      if (!letter) gap += 1;
      else {
        row += (gap ? String(gap) : '') + letter;
        gap = 0;
      }
    }
    return row + (gap ? String(gap) : '');
  });
  return `${ranks.join('/')} r - 0 1`;
}

function chariots(state: BanqiGameState): { black?: BanqiSquare; red?: BanqiSquare } {
  const out: { black?: BanqiSquare; red?: BanqiSquare } = {};
  for (const [square, piece] of Object.entries(state.board)) {
    if (piece?.role === 'chariot') out[piece.color] = square as BanqiSquare;
  }
  return out;
}

function steps(a: BanqiSquare, b: BanqiSquare): number {
  return Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(Number(a[1]) - Number(b[1]));
}

// Every position of the main line, 0..67, each move checked legal first.
const LINE_STATES: BanqiGameState[] = (() => {
  const states = [endgameState(ENDGAME_ROOT_FEN)];
  for (let ply = 1; ply <= ENDGAME_LINE.length; ply += 1) {
    const before = states[ply - 1]!;
    const move = ENDGAME_LINE[ply - 1]!;
    if (!isBanqiLegalMove(before, move)) throw new Error(`ply ${ply} ${label(move)} is illegal`);
    states.push(endgameStateAt(ENDGAME_ROOT_FEN, ENDGAME_LINE, ply));
  }
  return states;
})();

describe('two chariots alone', () => {
  it('black to move wins every odd-distance placement and loses every even one, inside 18 plies, clock or not', () => {
    const tally = { oddWin: 0, evenLoss: 0, other: 0 };
    let longest = 0;
    const squares = 'abcdefgh'.split('').flatMap((f) => [1, 2, 3, 4].map((r) => `${f}${r}` as BanqiSquare));
    for (const black of squares) {
      for (const red of squares) {
        if (black === red) continue;
        const placed = endgameState(chariotsFen(black, red));
        const free = answer(placed);
        const clocked = answer(placed, 40);
        expect(clocked.clockDraw).toBe(false);
        longest = Math.max(longest, free.dtm ?? 0);
        const odd = steps(black, red) % 2 === 1;
        if (odd && free.result === 'win') tally.oddWin += 1;
        else if (!odd && free.result === 'loss') tally.evenLoss += 1;
        else tally.other += 1;
      }
    }
    expect(tally).toEqual({ oddWin: 512, evenLoss: 480, other: 0 });
    expect(longest).toBe(18);
  });

  it('the two figures: four apart loses, three apart wins', () => {
    expect(answer(endgameState(PARITY_EVEN_FEN)).result).toBe('loss');
    expect(answer(endgameState(PARITY_ODD_FEN)).result).toBe('win');
    expect(steps('c2', 'f3')).toBe(4);
    expect(steps('c2', 'e3')).toBe(3);
    // Each arrow walks from black's chariot to red's, one step per square.
    for (const [fen, path] of [
      [PARITY_EVEN_FEN, PARITY_EVEN_PATH],
      [PARITY_ODD_FEN, PARITY_ODD_PATH],
    ] as const) {
      const ends = chariots(endgameState(fen));
      expect([path[0], path.at(-1)]).toEqual([ends.black, ends.red]);
      expect(path.length - 1).toBe(steps(ends.black!, ends.red!));
      for (let i = 1; i < path.length; i += 1) expect(steps(path[i - 1]!, path[i]!)).toBe(1);
    }
  });
});

describe('the position', () => {
  const root = answer(LINE_STATES[0]!);

  it('red wins in 67, its longest win anywhere in this material', () => {
    expect(root.moverInk).toBe('red');
    expect(root.dtm).toBe(67);
    // Longest win by side to move over every slot of the table. Black's longer
    // one starts with a capture (chariot takes horse) into a different ending.
    const t = table('rh-rhs')!;
    const longest = [0, 0];
    t.dtm.forEach((v, slot) => {
      const { stm } = decodeBanqiTablebaseSlot(slot, 5);
      if (v > longest[stm]!) longest[stm] = v;
    });
    expect(longest).toEqual([73, 67]);
  });

  it('nine moves: two win (c1-c2 and h3-g3, both in 67), five draw, two lose', () => {
    expect(root.rows).toHaveLength(9);
    expect(winners(root).map((r) => [label(r.move), r.dtm]).sort()).toEqual([
      ['c1-c2', 67],
      ['h3-g3', 67],
    ]);
    expect(root.rows.filter((r) => r.result === 'draw')).toHaveLength(5);
    expect(root.rows.filter((r) => r.result === 'loss')).toHaveLength(2);
  });

  it('under the 40-ply clock it is a draw; the line fits a 60-ply clock', () => {
    expect(answer(LINE_STATES[0]!, 40).clockDraw).toBe(true);
    expect(root.dtz).toBe(45);
    // Longest stretch of the line without a capture.
    let run = 0;
    let longest = 0;
    ENDGAME_LINE.forEach((move, i) => {
      const capture = Boolean(LINE_STATES[i]!.board[move.to]);
      run = capture ? 0 : run + 1;
      longest = Math.max(longest, run);
    });
    expect(longest).toBe(43);
  });
});

describe('the line', () => {
  it('is best play for both sides at every ply, and red takes black’s last piece on ply 67', () => {
    expect(ENDGAME_LINE).toHaveLength(67);
    for (let ply = 1; ply <= 66; ply += 1) {
      const a = answer(LINE_STATES[ply - 1]!);
      const row = a.rows.find((r) => label(r.move) === label(ENDGAME_LINE[ply - 1]!));
      expect(row, `ply ${ply}`).toBeDefined();
      expect(row!.result, `ply ${ply}`).toBe(a.result);
      expect(row!.dtm, `ply ${ply}`).toBe(a.dtm);
    }
    const end = LINE_STATES[67]!;
    expect(end.status.type).not.toBe('playing');
    expect(Object.values(end.board).every((p) => p?.color === 'red')).toBe(true);
  });

  it('the first capture is on ply 44, black’s chariot taking red’s horse; red’s chariot takes black’s horse on 45', () => {
    const captures = ENDGAME_LINE.map((m, i) => (LINE_STATES[i]!.board[m.to] ? i + 1 : 0)).filter(Boolean);
    expect(captures).toEqual([44, 45, 67]);
    expect(LINE_STATES[43]!.board.h2).toMatchObject({ color: 'black', role: 'chariot' });
    expect(LINE_STATES[43]!.board.h3).toMatchObject({ color: 'red', role: 'horse' });
    expect(LINE_STATES[44]!.board.g1).toMatchObject({ color: 'red', role: 'chariot' });
    expect(LINE_STATES[44]!.board.h1).toMatchObject({ color: 'black', role: 'horse' });
  });

});

describe('figures render', () => {
  it('every figure is an svg', () => {
    for (const svg of [BANQI_ENDGAME_PARITY_EVEN, BANQI_ENDGAME_PARITY_ODD, BANQI_ENDGAME_ROOT, BANQI_ENDGAME_THUMBNAIL]) {
      expect(svg()).toMatch(/^<svg[\s\S]*<\/svg>$/);
    }
  });

  it('the card thumbnail shows the position with no move arrow', () => {
    const svg = BANQI_ENDGAME_THUMBNAIL();
    expect(svg).not.toContain('<marker');
    expect(svg).not.toContain('marker-end');
  });
});
