import {
  applyStandardXiangqiMove,
  isStandardXiangqiGeneralInCheck,
  parseStandardXiangqiFen,
  type XiangqiGameState,
  type XiangqiSquare,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';
import {
  longestForcedMatesXiangqiArticle,
  TWO_CANNONS_FINISH_PLY,
} from './content/longest-forced-mates-xiangqi.js';
import type { ArticleBlock, EmbedBlock } from './types.js';

function blocksOf(article: (typeof articles)[number]): ArticleBlock[] {
  return [...(article.intro ?? []), ...(article.sections ?? []).flatMap((s) => s.blocks ?? [])];
}

describe('article embeds', () => {
  // An embed of a game or study chapter carries the whole line and its move
  // list wherever it opens, so a second embed of the same one at a later ?ply=
  // reads as the same board twice (longest-forced-mates, 2026-10-09).
  it('never embeds the same game or chapter twice in one article', () => {
    const dupes: string[] = [];
    for (const article of articles) {
      const seen = new Set<string>();
      for (const block of blocksOf(article)) {
        if (block.kind !== 'embed') continue;
        const target = block.path.split('?')[0] ?? block.path;
        if (seen.has(target)) dupes.push(`${article.slug}: ${target}`);
        seen.add(target);
      }
    }
    expect(dupes).toEqual([]);
  });
});

// Chapter u0z3Pvce of study uXu609QE (two cannons against the full guard, mate
// in 52): rootFen and stored main line, copied from prod /api/studies/uXu609QE
// on 2026-10-09. Black moves first; 104 plies.
const TWO_CANNONS_FEN = '2C2ab2/4k4/5a3/9/2b6/9/9/9/5C3/3K5 b - - 0 1';
const TWO_CANNONS_LINE = [
  'g10e8 c10a10 c6a8 f2c2 e8c6 c2b2 e9e8 a10e10 a8c10 b2e2 e8e9 e10d10 e9e10 d1d2',
  'c6a8 d2d3 a8c6 e2e7 c6a8 d10d9 e10d10 e7b7 d10e10 b7b10 e10e9 d9c9 e9e8 c9c8',
  'a8c6 b10b2 c10a8 c8c7 f8e9 c7e7 e9d10 d3e3 e8e9 e3f3 e9d9 b2d2 d9e9 e7e1',
  'a8c10 d2e2 e9d9 f3e3 d10e9 e1g1 c10a8 e2d2 d9d10 g1g10 d10d9 d2d7 a8c10 g10c10',
  'e9f8 c10b10 f10e9 b10b2 d9d10 d7d1 d10e10 e3d3 c6a8 b2a2 e10f10 a2e2 e9d10 d1d10',
  'f10e10 d10b10 e10f10 d3e3 f10f9 e2f2 f8e9 b10b1 f9f10 b1e1 f10e10 f2e2 e10d10 e2e9',
  'd10e10 e9e7 e10e9 e3d3 e9f9 e7e2 f9f10 d3e3 a8c10 e2f2 c10e8 e1e8 f10e10 f2b2',
  'e10d10 b2b9 d10e10 e8e9 e10d10 e9c9',
]
  .join(' ')
  .split(' ');

function play(state: XiangqiGameState, uci: string): XiangqiGameState {
  const squares = /^([a-i]\d{1,2})([a-i]\d{1,2})$/.exec(uci);
  if (!squares) throw new Error(`bad move ${uci}`);
  const next = applyStandardXiangqiMove(state, {
    from: squares[1] as XiangqiSquare,
    to: squares[2] as XiangqiSquare,
  });
  if (next === state) throw new Error(`illegal ${uci}`);
  return next;
}

function cannonsAt(ply: number): XiangqiGameState {
  const parsed = parseStandardXiangqiFen(TWO_CANNONS_FEN, 'two-cannons');
  if (!parsed.ok) throw new Error(parsed.error);
  return TWO_CANNONS_LINE.slice(0, ply).reduce(play, parsed.state);
}

describe('longest forced mates: the two-cannons finish embed', () => {
  const finishEmbed = blocksOf(longestForcedMatesXiangqiArticle).filter(
    (b): b is EmbedBlock => b.kind === 'embed',
  )[1];

  it('embeds the two-cannons chapter at the chosen ply, a different record from the first embed', () => {
    expect(finishEmbed?.path).toBe(`/embed/study/uXu609QE/u0z3Pvce?ply=${TWO_CANNONS_FINISH_PLY}`);
  });

  it('starts five red moves from the end, with the capture of the last elephant', () => {
    expect(TWO_CANNONS_LINE).toHaveLength(104);
    const start = cannonsAt(TWO_CANNONS_FINISH_PLY);
    expect(start.status).toEqual({ type: 'playing', turn: 'red' });
    const redMoves = TWO_CANNONS_LINE.slice(TWO_CANNONS_FINISH_PLY).filter((_, i) => i % 2 === 0);
    // "The cannon on e1 takes the last elephant on e8, the other cannon swings
    // from f2 round to b9, and the e8 cannon steps up to e9 ... Then e9-c9."
    expect(redMoves).toEqual(['e1e8', 'f2b2', 'b2b9', 'e8e9', 'e9c9']);
    expect(start.board.e1).toEqual({ color: 'red', role: 'cannon' });
    expect(start.board.e8).toEqual({ color: 'black', role: 'elephant' });
    const blackElephants = Object.values(start.board).filter(
      (p) => p?.color === 'black' && p.role === 'elephant',
    );
    expect(blackElephants).toHaveLength(1);
    // "steps up to e9 under the general, which runs to d10"
    expect(cannonsAt(101).board.e10).toEqual({ color: 'black', role: 'general' });
    expect(cannonsAt(103).board.d10).toEqual({ color: 'black', role: 'general' });
  });

  it('ends in 困毙 after the quiet e9-c9, black not in check', () => {
    expect(cannonsAt(103).board.c9).toBeUndefined(); // quiet: e9-c9 captures nothing
    const end = cannonsAt(104);
    expect(end.lastMove).toEqual({ from: 'e9', to: 'c9' });
    expect(end.status).toEqual({ type: 'finished', winner: 'red', reason: 'stalemate' });
    expect(isStandardXiangqiGeneralInCheck(end, 'black')).toBe(false);
    expect(end.board.d10).toEqual({ color: 'black', role: 'general' });
    expect(end.board.b9).toEqual({ color: 'red', role: 'cannon' });
    expect(end.board.c9).toEqual({ color: 'red', role: 'cannon' });
    expect(end.board.e3).toEqual({ color: 'red', role: 'general' });
    // "the b9 cannon now fires over it into d9"
    const { d10: general, ...others } = end.board;
    const onD9 = { ...end, board: { ...others, d9: general } };
    expect(isStandardXiangqiGeneralInCheck(onD9, 'black')).toBe(true);
    // "the open e-file means e10 would face the red general"
    for (let rank = 4; rank <= 10; rank += 1) {
      expect(end.board[`e${rank}` as XiangqiSquare]).toBeUndefined();
    }
  });
});
