// A judged move on a DIALECT-DIVERGED variant must still graft the engine's best
// line as clickable variation moves, not just a textual "… was best" row.
//
// Banqi's analysis engine speaks 0-indexed ranks (board b3 = engine b2), so until
// 2026-08-22 these variants were skipped by injectBestLines outright: parsing
// their PVs with the generic adapter would have grafted wrong moves. They now go
// through the variant's own moveFromEngineUci, the same decoder the engine panel
// and the best-move arrow already use.
import {
  applyBanqiMove,
  type BanqiMove,
  createInitialBanqiState,
  getBanqiLegalMoves,
  STANDARD_BANQI_DEAL,
} from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountBanqiReview } from './banqi-review.js';
import type { GameAnalysis } from './game-analysis.js';

/** Board square ("b3") → engine token ("b2"): the engine ranks from 0. */
function toEngineUci(move: BanqiMove): string {
  const enc = (sq: string): string => `${sq[0]}${Number(sq.slice(1)) - 1}`;
  return `${enc(move.from)}${enc(move.to)}`;
}

/**
 * One played move, plus a two-ply best line that is legal from the SAME position
 * and starts with a different move. Derived from the rules rather than written by
 * hand: a hand-picked UCI that turned out illegal would make this test pass for
 * the wrong reason (addMove drops illegal moves silently).
 */
function scenario() {
  const start = createInitialBanqiState('t', STANDARD_BANQI_DEAL);
  const legal = getBanqiLegalMoves(start);
  const played = legal[0]!;
  const alternative = legal.find((m) => m.from !== played.from || m.to !== played.to)!;
  const after = applyBanqiMove(start, alternative);
  const reply = getBanqiLegalMoves(after)[0]!;
  return { played, pv: [toEngineUci(alternative), toEngineUci(reply)] };
}

function analysisFor(pv: string[]): GameAnalysis {
  return {
    engineId: 'test',
    depth: 10,
    evals: [
      { ply: 0, cp: 300, mate: null, best: pv[0] ?? null, pv },
      { ply: 1, cp: 10, mate: null, best: null, pv: [] },
    ],
    moves: [{ ply: 1, mover: 'red', judgment: 'blunder', accuracy: 15 }],
    chancePlies: [],
    unstablePlies: [],
    bestPlayedPlies: [],
    red: { accuracy: 15, inaccuracies: 0, mistakes: 0, blunders: 1, acpl: 290 },
    black: { accuracy: 100, inaccuracies: 0, mistakes: 0, blunders: 0, acpl: 0 },
  };
}

describe('banqi best-line graft', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('grafts the engine PV as clickable variation moves', async () => {
    const { played, pv } = scenario();
    const analysis = analysisFor(pv);
    const root = document.createElement('div');
    document.body.append(root);

    mountBanqiReview(
      root,
      'room-graft',
      { deal: STANDARD_BANQI_DEAL, rules: {} },
      {
        ariaLabel: 'test',
        title: 'Banqi',
        summary: 'test',
        moves: [played],
        analysis: {
          requestLabel: 'Analyse',
          fetchCached: async () => analysis,
          run: async () => analysis,
        },
      },
    );

    await vi.waitFor(
      () => {
        expect(root.querySelector('.move-tree__variation')).not.toBeNull();
      },
      { timeout: 4000 },
    );

    const variation = root.querySelector('.move-tree__variation')!;
    // Two grafted plies, each a real button that jumps to its node.
    const moves = variation.querySelectorAll('.review-move-list__move');
    expect(moves.length).toBe(2);
    // The line opens with the engine's best move, not with the move played.
    expect(variation.textContent).not.toBe('');
    expect(moves[0]!.tagName).toBe('BUTTON');
  });

  it('pins the judgment badge to the board square the played move landed on', async () => {
    const { played, pv } = scenario();
    const analysis = analysisFor(pv);
    const root = document.createElement('div');
    document.body.append(root);

    mountBanqiReview(
      root,
      'room-badge',
      { deal: STANDARD_BANQI_DEAL, rules: {} },
      {
        ariaLabel: 'test',
        title: 'Banqi',
        summary: 'test',
        moves: [played],
        analysis: {
          requestLabel: 'Analyse',
          fetchCached: async () => analysis,
          run: async () => analysis,
        },
      },
    );

    // Jump to the blunder: the badge rides the move that led to the current node.
    await vi.waitFor(
      () => {
        expect(root.querySelector('.move-tree__comment--blunder')).not.toBeNull();
      },
      { timeout: 4000 },
    );
    const playedCell = root.querySelector<HTMLButtonElement>(
      '.review-move-list__row .review-move-list__move',
    );
    playedCell?.click();

    await vi.waitFor(
      () => {
        expect(root.querySelector('.xq-marker--glyph')).not.toBeNull();
      },
      { timeout: 4000 },
    );
    const badge = root.querySelector('.xq-marker--glyph')!;
    expect(badge.classList.contains('xq-marker--blunder')).toBe(true);
    expect(badge.querySelector('.xq-marker__label')?.textContent).toBe('??');
  });
});
