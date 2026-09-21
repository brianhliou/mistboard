// Shared test fixtures for the curator: a legal mainline of the central cannon
// vs screen horses and its mirror, in our squares, plus helpers to fabricate
// eval series without an engine.

import type { XiangqiMove, XiangqiSquare } from '@mistboard/game';
import type { CuratorGame } from './annotate.js';
import type { CuratorPlyEval } from './moments.js';
import type { StudyRecipe } from './recipes.js';

export function mv(uci: string): XiangqiMove {
  const match = /^([a-i](?:[1-9]|10))([a-i](?:[1-9]|10))$/.exec(uci);
  if (!match) throw new Error(`bad uci ${uci}`);
  return { from: match[1] as XiangqiSquare, to: match[2] as XiangqiSquare };
}

/** 1. C2=5 H8+7 2. H2+3 R9=8 3. R1=2 H2+3 4. P7+1 P7+1 5. R2+6 C8=9 */
export const CENTRAL_CANNON_SCREEN_HORSES: XiangqiMove[] = [
  'h3e3',
  'h10g8',
  'h1g3',
  'i10h10',
  'i1h1',
  'b10c8',
  'c4c5',
  'g7g6',
  'h1h7',
  'h8i8',
].map(mv);

/** The same opening from Red's other cannon (炮八平五), which the shape must also match. */
export const CENTRAL_CANNON_SCREEN_HORSES_MIRRORED: XiangqiMove[] = [
  'b3e3',
  'b10c8',
  'b1c3',
  'a10b10',
  'a1b1',
  'h10g8',
  'g4g5',
  'c7c6',
  'b1b7',
  'b8a8',
].map(mv);

/** 1. E3+5 H8+7 2. H2+3 R9=8 3. R1=2 H2+3: an elephant opening, no central cannon. */
export const ELEPHANT_OPENING: XiangqiMove[] = [
  'g1e3',
  'h10g8',
  'h1g3',
  'i10h10',
  'i1h1',
  'b10c8',
  'c4c5',
  'g7g6',
].map(mv);

export function gameOf(
  id: string,
  moves: XiangqiMove[],
  result: CuratorGame['result'],
  extra: Partial<CuratorGame> = {},
): CuratorGame {
  return {
    id,
    kind: 'broadcast',
    moves,
    result,
    red: { name: '尹昇', nameEn: 'Yin Sheng' },
    black: { name: '杨世哲', nameEn: 'Yang Shizhe' },
    event: {
      name: '2026年全国象棋甲级联赛',
      nameEn: '2026 National Xiangqi Men Division A League',
    },
    round: { name: '第3轮', nameEn: 'Round 3' },
    playedOn: '2026-09-15',
    sourceUrl: 'http://www.dpxq.com/hldcg/search/view_m_1.html',
    ...extra,
  };
}

/** Eval rows from a Red-POV centipawn series (one entry per position, 0..N). */
export function evalsOf(
  cps: readonly number[],
  bestByPly: Record<number, { best: string; pv?: string[] }> = {},
): CuratorPlyEval[] {
  return cps.map((cp, ply) => ({
    ply,
    cp,
    mate: null,
    best: bestByPly[ply]?.best ?? null,
    ...(bestByPly[ply]?.pv ? { pv: bestByPly[ply]?.pv } : {}),
  }));
}

export function recipeOf(overrides: Partial<StudyRecipe> = {}): StudyRecipe {
  return {
    id: 'test-recipe',
    version: 1,
    study: {
      name: 'Test study',
      description: 'A test',
      visibility: 'unlisted',
      orientation: 'red',
    },
    source: { results: ['1-0', '0-1'] },
    mode: 'model-games',
    chapters: { max: 3 },
    ...overrides,
  };
}
