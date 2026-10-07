#!/usr/bin/env node
/**
 * Sample one endgame CLASS through chessdb.cn and tally its verdicts.
 *
 *   node scripts/xiangqi-endgame-sweep.mjs --class chariot-cannon-vs-chariot --n 120
 *   node scripts/xiangqi-endgame-sweep.mjs --class chariot-vs-full-defence --n 300 --quiet-defence
 *
 * Why: a corpus entry is ONE position, and a tablebase settles that position
 * exactly, but a book grade (例胜 / 例和) is a claim about the whole class. Two
 * rows of the 象棋残局 list disagreed with zh-Wikipedia, and the honest way to
 * settle a class claim is to ask about many positions of it, not one.
 *
 * It also picks 巧胜 positions. A "tricky win" is a won position inside a class
 * the book calls a draw; `--quiet-defence` keeps only positions where nothing is
 * hanging (Red has no capture at all) and Black is not in check, so a win the
 * sweep finds is a win against a defence that has not simply dropped a piece.
 * Candidates print shortest-first, and the position is ours by construction:
 * a random draw from the class, not anyone's diagram.
 *
 * Positions are generated on legal points only (advisors on the five palace
 * points, elephants on their seven, soldiers never behind their start) and
 * validated through the kernel: both generals present, the side NOT to move
 * not in check. chessdb answers from the side to move; this prints from Red's.
 */
import {
  getStandardXiangqiLegalMoves as getLegalMoves,
  isStandardXiangqiGeneralInCheck,
  parseStandardXiangqiFen,
  standardXiangqiEngineFen,
} from '@mistboard/game';

const args = process.argv.slice(2);
const argOf = (flag, fallback = '') => {
  const at = args.indexOf(`--${flag}`);
  return at === -1 ? fallback : (args[at + 1] ?? fallback);
};

const FILES = 'abcdefghi';
const ALL = [];
for (let rank = 1; rank <= 10; rank += 1) for (const f of FILES) ALL.push(`${f}${rank}`);

const RED_PALACE = ['d1', 'e1', 'f1', 'd2', 'e2', 'f2', 'd3', 'e3', 'f3'];
const BLACK_PALACE = ['d10', 'e10', 'f10', 'd9', 'e9', 'f9', 'd8', 'e8', 'f8'];
const POINTS = {
  K: RED_PALACE,
  k: BLACK_PALACE,
  A: ['d1', 'f1', 'e2', 'd3', 'f3'],
  a: ['d10', 'f10', 'e9', 'd8', 'f8'],
  B: ['c1', 'g1', 'a3', 'e3', 'i3', 'c5', 'g5'],
  b: ['c10', 'g10', 'a8', 'e8', 'i8', 'c6', 'g6'],
  R: ALL,
  r: ALL,
  C: ALL,
  c: ALL,
  N: ALL,
  n: ALL,
  // A soldier across the river (any file), for Red: ranks 6-9.
  P: ALL.filter((s) => {
    const rank = Number(s.slice(1));
    return rank >= 6 && rank <= 9;
  }),
  // High soldier (高兵): ranks 7-8, above the palace's bottom two ranks.
  'P-high': ALL.filter((s) => {
    const rank = Number(s.slice(1));
    return rank === 7 || rank === 8;
  }),
  // Bottom soldier (底兵): on Black's back rank.
  'P-bottom': ALL.filter((s) => s.endsWith('10') && s.length === 3),
  // A Black soldier across the river (into Red's half): ranks 2-5.
  'p-crossed': ALL.filter((s) => {
    const rank = Number(s.slice(1));
    return rank >= 2 && rank <= 5;
  }),
};

/** Each class: Red's men, Black's men, as POINTS keys. */
const CLASSES = {
  'chariot-cannon-vs-chariot': { red: ['K', 'R', 'C'], black: ['k', 'r'] },
  'high-soldier-vs-advisor': { red: ['K', 'P-high'], black: ['k', 'a'] },
  'bottom-soldier-vs-bare-general': { red: ['K', 'P-bottom'], black: ['k'] },
  'horse-vs-crossed-soldier': { red: ['K', 'N'], black: ['k', 'p-crossed'] },
  'two-cannons-vs-two-elephants': { red: ['K', 'C', 'C'], black: ['k', 'b', 'b'] },
  'two-cannons-advisor-vs-full-defence': {
    red: ['K', 'C', 'C', 'A'],
    black: ['k', 'a', 'a', 'b', 'b'],
  },
  'chariot-vs-full-defence': { red: ['K', 'R'], black: ['k', 'a', 'a', 'b', 'b'] },
  'chariot-vs-horse-two-advisors': { red: ['K', 'R'], black: ['k', 'n', 'a', 'a'] },
  'chariot-vs-cannon-two-advisors': { red: ['K', 'R'], black: ['k', 'c', 'a', 'a'] },
  'chariot-vs-two-horses': { red: ['K', 'R'], black: ['k', 'n', 'n'] },
  'chariot-vs-horse-cannon': { red: ['K', 'R'], black: ['k', 'n', 'c'] },
  'horse-soldier-vs-three-defence': {
    red: ['K', 'N', 'P-high'],
    black: ['k', 'a', 'a', 'b'],
  },
};

const LETTER = (key) => key.slice(0, 1);

function randomPosition(spec, turn) {
  for (let tries = 0; tries < 2000; tries += 1) {
    const used = new Map();
    let ok = true;
    for (const key of [...spec.red, ...spec.black]) {
      const free = POINTS[key].filter((s) => !used.has(s));
      if (!free.length) {
        ok = false;
        break;
      }
      used.set(free[Math.floor(Math.random() * free.length)], LETTER(key));
    }
    if (!ok) continue;
    const rows = [];
    for (let rank = 10; rank >= 1; rank -= 1) {
      let row = '';
      let empty = 0;
      for (const f of FILES) {
        const piece = used.get(`${f}${rank}`);
        if (!piece) {
          empty += 1;
          continue;
        }
        if (empty) row += String(empty);
        empty = 0;
        row += piece;
      }
      if (empty) row += String(empty);
      rows.push(row);
    }
    const fen = `${rows.join('/')} ${turn === 'red' ? 'w' : 'b'}`;
    const parsed = parseStandardXiangqiFen(fen, 'sweep');
    if (!parsed.ok) continue;
    const other = turn === 'red' ? 'black' : 'red';
    if (isStandardXiangqiGeneralInCheck(parsed.state, other)) continue;
    if (getLegalMoves(parsed.state).length === 0) continue;
    return { fen: standardXiangqiEngineFen(parsed.state), state: parsed.state, used };
  }
  throw new Error('could not place the class');
}

/**
 * True when nothing is hanging for EITHER side: neither the side to move nor
 * the other side (were it to move) has a capture, and nobody is in check. A
 * class verdict should be read off positions where the next move is not
 * already a tactic.
 */
function quiet(state) {
  if (state.status.type !== 'playing') return false;
  const noCapture = (s) => getLegalMoves(s).every((move) => !s.board[move.to]);
  const other = state.status.turn === 'red' ? 'black' : 'red';
  const flipped = { ...state, status: { type: 'playing', turn: other } };
  if (isStandardXiangqiGeneralInCheck(state, state.status.turn)) return false;
  return noCapture(state) && noCapture(flipped);
}

async function verdict(fen) {
  const url = `http://www.chessdb.cn/chessdb.php?action=queryall&board=${encodeURIComponent(fen)}`;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const text = (await response.text()).trim();
      const best = text.split('|')[0] ?? '';
      const note = /note:[^(]*\((W|D|L)-M-(\d+)\)/.exec(best);
      // An empty or throttled reply is not an answer; only a bare `unknown` or
      // a scored move with no tablebase note is a real "not in the database".
      if (!note && (!text || /rate limit/i.test(text))) throw new Error('throttled');
      if (!note) return { result: 'not-in-db', dtm: null, raw: text.slice(0, 40) };
      return {
        result: note[1] === 'W' ? 'win' : note[1] === 'L' ? 'loss' : 'draw',
        dtm: Number(note[2]),
      };
    } catch {
      // Throttled or timed out: back off and ask again.
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  return { result: 'not-in-db', dtm: null };
}

async function main() {
  const name = argOf('class');
  const spec = CLASSES[name];
  if (!spec) throw new Error(`--class one of: ${Object.keys(CLASSES).join(', ')}`);
  const n = Number(argOf('n', '100'));
  const turn = argOf('turn', 'red');
  const quietOnly = args.includes('--quiet-defence');
  const fixed = argOf('fixed'); // e.g. "k:e10" to pin a piece's point
  if (fixed) {
    for (const pin of fixed.split(',')) {
      const [key, square] = pin.split(':');
      POINTS[key] = [square];
    }
  }

  const rows = [];
  const seen = new Set();
  let index = 0;
  const worker = async () => {
    while (index < n) {
      index += 1;
      let position;
      do position = randomPosition(spec, turn);
      while (seen.has(position.fen) || (quietOnly && !quiet(position.state)));
      seen.add(position.fen);
      const { result, dtm, raw } = await verdict(position.fen);
      if (raw && args.includes('--debug')) console.log(`  raw: ${raw}  ${position.fen}`);
      // From Red's point of view.
      const red =
        turn === 'red' ? result : result === 'win' ? 'loss' : result === 'loss' ? 'win' : result;
      rows.push({ fen: position.fen, red, dtm });
    }
  };
  await Promise.all([worker()]);

  const tally = {};
  for (const row of rows) tally[row.red] = (tally[row.red] ?? 0) + 1;
  console.log(`${name} (${turn} to move${quietOnly ? ', quiet' : ''}): ${JSON.stringify(tally)}`);
  const show = argOf('show', 'win');
  const list = rows
    .filter((row) => row.red === show)
    .sort((a, b) => (a.dtm ?? 0) - (b.dtm ?? 0))
    .slice(0, Number(argOf('top', '8')));
  for (const row of list) console.log(`  ${row.red} ${row.dtm ?? ''}  ${row.fen}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
