// Speaking KataGo-AnimalChess's GTP dialect from our jungle kernel (#434).
//
// hzyhhzy's KataGomo branch `AnimalChess2025` plays the same game we do, on a
// board that is our LEFT-RIGHT MIRROR: its start has the lion on a9 and the
// tiger on g9, ours the other way round. Jungle is symmetric under that mirror
// (the two lakes, the two dens and their traps all map onto each other), so one
// file flip is the whole translation and captures, ranks and rules carry over
// untouched. Its piece letters differ in one place: J is the leopard, ours P.
//
// This lives in the kernel package rather than in the server because two callers
// have to agree on it exactly: the live bot (apps/server) and the match harness
// (scripts/variant-lab/jungle-katago-match.ts) that measured the bot's strength.
// If they disagreed, the engine we rated would not be the engine we serve.
//
// Colours: KataGo's "black" is the bottom side, which moves first, which is our
// red. Its `setfen <board> w|b` takes 'w' for that side, so red is 'w' there.

import { JUNGLE_HEIGHT, JUNGLE_WIDTH, type JungleSquare } from './variants-jungle.js';

const FILES = 'abcdefg';

if (FILES.length !== JUNGLE_WIDTH) {
  throw new Error('jungle-katago-gtp: file list does not match the kernel board width');
}

/** Our square -> KataGo vertex: mirrored file, same rank, upper case (A1, G9). */
export function toKatagoVertex(square: JungleSquare): string {
  const file = FILES.indexOf(square[0] as string);
  if (file < 0) throw new Error(`not a jungle square: ${square}`);
  return `${FILES[FILES.length - 1 - file]?.toUpperCase()}${square.slice(1)}`;
}

/** KataGo vertex -> our square, or null when it is not one (pass, resign, junk). */
export function fromKatagoVertex(vertex: string): JungleSquare | null {
  const match = /^([A-Ga-g])([1-9])$/.exec(vertex.trim());
  if (!match) return null;
  const file = FILES.indexOf((match[1] as string).toLowerCase());
  const rank = Number(match[2]);
  if (file < 0 || rank < 1 || rank > JUNGLE_HEIGHT) return null;
  return `${FILES[FILES.length - 1 - file]}${rank}` as JungleSquare;
}

/**
 * Our engine FEN -> the board field and side letter `setfen` wants.
 *
 * Each rank string is mirrored (so the board is), the leopard is re-lettered,
 * and the side to move becomes KataGo's: our red is its 'w'. Digit runs are
 * expanded and re-compressed rather than reversed in place, because "2e3" and
 * "3e2" are different boards.
 */
export function toKatagoFen(fen: string): { board: string; side: 'w' | 'b' } {
  const [placement, turn] = fen.trim().split(/\s+/);
  if (!placement || !turn) throw new Error(`not a jungle engine FEN: ${fen}`);
  const ranks = placement.split('/');
  if (ranks.length !== JUNGLE_HEIGHT) {
    throw new Error(`jungle FEN has ${ranks.length} ranks, expected ${JUNGLE_HEIGHT}`);
  }
  const board = ranks
    .map((rank) => {
      const cells: string[] = [];
      for (const ch of rank) {
        if (ch >= '1' && ch <= '9') {
          for (let i = 0; i < Number(ch); i += 1) cells.push('.');
        } else {
          cells.push(ch === 'P' ? 'J' : ch === 'p' ? 'j' : ch);
        }
      }
      if (cells.length !== JUNGLE_WIDTH) {
        throw new Error(`jungle FEN rank "${rank}" is ${cells.length} squares wide`);
      }
      cells.reverse();
      let out = '';
      let run = 0;
      for (const cell of cells) {
        if (cell === '.') {
          run += 1;
          continue;
        }
        if (run > 0) out += String(run);
        run = 0;
        out += cell;
      }
      if (run > 0) out += String(run);
      return out;
    })
    .join('/');
  if (turn !== 'r' && turn !== 'b') throw new Error(`jungle FEN side to move is "${turn}"`);
  return { board, side: turn === 'r' ? 'w' : 'b' };
}

/** The GTP colour letter for one of our seats: red moves first, which is KataGo's 'b'
 *  in `genmove` (its bottom side). The engine ignores the argument and plays whoever
 *  is to move, but GTP requires one. */
export function katagoGenmoveColor(mover: 'red' | 'black'): 'b' | 'w' {
  return mover === 'red' ? 'b' : 'w';
}
