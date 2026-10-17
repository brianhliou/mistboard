// The study "MistyBanqi against people" (scripts/misty-banqi-study.ts) holds the
// three games the MistyBanqi article embeds. Its data file is the source of truth,
// so this replays every game from it and asserts what the article, the embed
// captions and the chapter notes say about them, then checks that each embed in
// the article points at the right chapter and ply.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyBanqiMove,
  type BanqiDeal,
  type BanqiGameState,
  type BanqiMove,
  type BanqiSquare,
  createInitialBanqiState,
  getBanqiLegalMovesFrom,
  isBanqiLegalMove,
  LEGACY_BANQI_RULES,
} from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { BANQI_CONVERSION_GAME } from '../banqi-engine-game.js';
import { banqiEngineArticle } from './content/banqi-engine.js';
import type { ArticleBlock } from './types.js';

type StudyGame = {
  key: string;
  name: string;
  chapterId: string | null;
  embedPly: number;
  result: string;
  notes: Record<string, string>;
  deal: BanqiDeal;
  moves: string;
};

const dataPath = ['scripts/data/misty-banqi-study.json', '../../scripts/data/misty-banqi-study.json']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));
if (!dataPath) throw new Error('scripts/data/misty-banqi-study.json not found');
const data = JSON.parse(readFileSync(dataPath, 'utf8')) as { studyId: string | null; games: StudyGame[] };
const gameByKey = (key: string): StudyGame => {
  const game = data.games.find((g) => g.key === key);
  if (!game) throw new Error(`no ${key} game in the study data`);
  return game;
};

function parse(moves: string): BanqiMove[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((token) => ({ from: token.slice(0, 2) as BanqiSquare, to: token.slice(2, 4) as BanqiSquare }));
}

// Every state from 0 to the end, each move checked legal before it is applied
// (applyBanqiMove silently ignores an illegal one, which would let a claim drift).
// All three games predate the 長捉 rule, so they replay under the legacy rules.
function replay(game: { deal: BanqiDeal; moves: string }): BanqiGameState[] {
  let state = createInitialBanqiState('study-test', game.deal, LEGACY_BANQI_RULES);
  const states = [state];
  for (const move of parse(game.moves)) {
    expect(isBanqiLegalMove(state, move), `${move.from}${move.to} at move ${states.length}`).toBe(true);
    state = applyBanqiMove(state, move);
    states.push(state);
  }
  return states;
}

function generalSquare(state: BanqiGameState, color: 'red' | 'black'): string | undefined {
  return Object.entries(state.board).find(
    ([, piece]) => piece && !piece.faceDown && piece.color === color && piece.role === 'general',
  )?.[0];
}

function faceUp(state: BanqiGameState, color: 'red' | 'black'): number {
  return Object.values(state.board).filter((piece) => piece && !piece.faceDown && piece.color === color).length;
}

/** The capture made by move `ply` (1-based), if any. */
function captureAt(states: BanqiGameState[], ply: number) {
  const before = states[ply - 1]!.captures.length;
  return states[ply]!.captures.length > before ? states[ply]!.captures.at(-1) : undefined;
}

describe('MistyBanqi against people: the study data', () => {
  it('lists the three chapters in article order, each ending on its recorded result', () => {
    expect(data.games.map((g) => g.key)).toEqual(['win', 'conversion', 'hunt']);
    for (const game of data.games) {
      const states = replay(game);
      const end = states.at(-1)!.status;
      expect(end.type, game.key).toBe('finished');
      const result = end.type === 'finished' ? (end.winner === 'red' ? '1-0' : end.winner === 'black' ? '0-1' : '1/2-1/2') : '';
      expect(result, game.key).toBe(game.result);
      expect(states[states.length - 2]!.status.type, game.key).not.toBe('finished');
      for (const ply of Object.keys(game.notes)) expect(Number(ply)).toBeLessThan(states.length);
    }
  });

  it('win: Misty, the first seat on black, falls behind early, takes the general on 25 and wins on 95', () => {
    const states = replay(gameByKey('win'));
    expect(states).toHaveLength(96);
    expect(states[95]!.firstColor).toBe('black');
    // An elephant, an advisor and a horse lost in the first twelve moves.
    const early = [6, 8, 12].map((ply) => captureAt(states, ply));
    expect(early.map((c) => `${c?.owner} ${c?.role}`)).toEqual(['black elephant', 'black advisor', 'black horse']);
    expect(captureAt(states, 25)).toMatchObject({ owner: 'red', role: 'general' });
    // Move 25 is odd: the first seat (MistyBanqi) made it.
    expect(states[95]!.status).toMatchObject({ type: 'finished', winner: 'red', reason: 'stalemate' });
  });

  it('conversion: ten pieces to two at move 56, the last flip or capture, then a repetition draw at 64', () => {
    const game = gameByKey('conversion');
    const states = replay(game);
    expect(states).toHaveLength(65);
    expect(states[64]!.firstColor).toBe('red');
    expect(faceUp(states[56]!, 'red')).toBe(10);
    expect(faceUp(states[56]!, 'black')).toBe(2);
    const moves = parse(game.moves);
    const events = moves
      .map((m, i) => (m.from === m.to || captureAt(states, i + 1) !== undefined ? i + 1 : 0))
      .filter(Boolean);
    expect(events.at(-1)).toBe(56);
    expect(states[64]!.status).toMatchObject({ type: 'finished', winner: null, reason: 'repetition' });
  });

  it('conversion: under the chase rule now in force, move 64 is forbidden (the caption says the board stops at 63)', () => {
    const game = gameByKey('conversion');
    const moves = parse(game.moves);
    let state = createInitialBanqiState('study-test-now', game.deal);
    for (const move of moves.slice(0, 63)) state = applyBanqiMove(state, move);
    expect(state.ply).toBe(63);
    expect(isBanqiLegalMove(state, moves[63]!)).toBe(false);
  });

  it('conversion: the thumbnail copy in banqi-engine-game.ts is the same game', () => {
    const game = gameByKey('conversion');
    expect(BANQI_CONVERSION_GAME.deal).toEqual(game.deal);
    expect(BANQI_CONVERSION_GAME.moves.trim().split(/\s+/)).toEqual(game.moves.trim().split(/\s+/));
  });

  describe('hunt (bq_e684b31b): one soldier hunts the general into the corner', () => {
    const game = gameByKey('hunt');
    const states = replay(game);
    const move = (ply: number) => parse(game.moves)[ply - 1]!;

    it('replays 153 moves; MistyBanqi, the first seat, has the black pieces and wins', () => {
      expect(states).toHaveLength(154);
      expect(states[153]!.firstColor).toBe('black');
      expect(states[153]!.status).toMatchObject({ type: 'finished', winner: 'red', reason: 'stalemate' });
    });

    it('at move 44 the general is on b1 and the red soldier on b4; it walks to a1, then the soldier marches b4-b3-a3-a2-a1', () => {
      expect(game.embedPly).toBe(44);
      expect(generalSquare(states[44]!, 'black')).toBe('b1');
      expect(states[44]!.board.b4).toMatchObject({ color: 'red', role: 'soldier', faceDown: false });
      expect(move(45)).toEqual({ from: 'b1', to: 'a1' });
      expect([50, 52, 54, 56].map(move)).toEqual([
        { from: 'b4', to: 'b3' },
        { from: 'b3', to: 'a3' },
        { from: 'a3', to: 'a2' },
        { from: 'a2', to: 'a1' },
      ]);
    });

    it('at move 58 the general on b1 has no legal move, walled by face-down c1 and b2 and the soldier on a1', () => {
      const last = states[58]!;
      expect(last.board.b1).toMatchObject({ color: 'black', role: 'general', faceDown: false });
      expect(last.board.a1).toMatchObject({ color: 'red', role: 'soldier', faceDown: false });
      expect(last.board.c1?.faceDown).toBe(true);
      expect(last.board.b2?.faceDown).toBe(true);
      expect(getBanqiLegalMovesFrom(last, 'b1')).toEqual([]);
    });

    it('stays stuck until 85, takes a flipped advisor on b2, and is captured on 86, 28 moves after 58', () => {
      for (let ply = 58; ply < 84; ply += 1) expect(generalSquare(states[ply]!, 'black'), `move ${ply}`).toBe('b1');
      expect(states[84]!.board.b2).toMatchObject({ color: 'red', role: 'advisor', faceDown: false });
      expect(move(85)).toEqual({ from: 'b1', to: 'b2' });
      expect(captureAt(states, 86)).toMatchObject({ owner: 'black', role: 'general' });
      expect(states[86]!.board.b2).toMatchObject({ color: 'red', role: 'general' });
      expect(86 - 58).toBe(28);
    });
  });
});

describe('MistyBanqi article embeds', () => {
  const blocks: ArticleBlock[] = [
    ...(banqiEngineArticle.intro ?? []),
    ...banqiEngineArticle.sections.flatMap((s) => s.blocks ?? []),
  ];
  const embeds = blocks.filter((block): block is Extract<ArticleBlock, { kind: 'embed' }> => block.kind === 'embed');

  it('embeds each chapter once, in order, at the ply the data file names', () => {
    // Null until `scripts/misty-banqi-study.ts --create --public` runs against
    // production, which writes the ids into the data file and the article.
    expect(data.studyId, 'the study has not been created on production yet').toBeTypeOf('string');
    expect(embeds.map((e) => e.path)).toEqual(
      data.games.map((g) => `/embed/study/${data.studyId}/${g.chapterId}?ply=${g.embedPly}`),
    );
  });
});
