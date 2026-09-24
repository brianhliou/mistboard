// Roomless whole-game analysis: a client-side ceval sweep over the mainline,
// shared by the analysis board (xiangqi-analysis.ts) and the historical library
// review (historical-xiangqi-postgame.ts). Both are roomless — there is no server
// Pikafish cache to fetch — so the "Computer analysis" tab computes in-browser on
// request. (Played games use the server path instead; see xiangqi-postgame.ts.)
import { xiangqiMoveToFsfUci } from '@mistboard/game';
import { createCeval } from './engine/ceval.js';
import { computeGameAnalysis, type PlyEval } from './game-analysis.js';
import type { XiangqiAnalysisSource } from './xiangqi-review.js';
import type { XiangqiReplay } from './xiangqi-review-model.js';

const ANALYSIS_SWEEP_DEPTH = 12;

/** Build the analysis source for a roomless review, or null when there's nothing
 *  to analyse (an empty board). The sweep evaluates each ply once at a shallow
 *  fixed depth and reports progress; scores are normalized to Red's POV. */
export function buildXiangqiClientAnalysisSource(
  replay: XiangqiReplay,
  initialFen?: string,
): XiangqiAnalysisSource | null {
  if (replay.maxPly < 1) return null;
  const engineMovesUci = replay.moves.map((move) => xiangqiMoveToFsfUci(move));
  // Ply parity maps to side-to-move via the START position's turn — a FEN-seeded
  // composition can open with black to move, flipping every ply's POV sign.
  const startStatus = replay.views[0]?.status;
  const redStarts = startStatus?.type !== 'playing' || startStatus.turn === 'red';
  return {
    requestLabel: 'Analyse the whole game',
    run: async (onProgress, signal) => {
      const handle = createCeval('xiangqi');
      const plies: PlyEval[] = [];
      try {
        for (let ply = 0; ply <= replay.maxPly; ply += 1) {
          // A destroyed review stops its sweep at the next ply; the worker goes
          // in the finally below instead of running on behind a closed page.
          if (signal?.aborted) throw new DOMException('analysis cancelled', 'AbortError');
          const update = await handle.evaluate({
            movesUci: engineMovesUci.slice(0, ply),
            initialFen,
            multiPv: 1,
            maxDepth: ANALYSIS_SWEEP_DEPTH,
          });
          const best = update.lines[0];
          const redToMove = (ply % 2 === 0) === redStarts;
          const cp = best?.scoreCp ?? null;
          const mate = best?.mate ?? null;
          plies.push({
            ply,
            cp: cp === null ? null : redToMove ? cp : -cp,
            mate: mate === null ? null : redToMove ? mate : -mate,
            best: best?.pvUci[0] ?? null,
            pv: best?.pvUci.slice(0, 16),
          });
          onProgress(ply, replay.maxPly);
        }
      } finally {
        handle.dispose();
      }
      return computeGameAnalysis(
        {
          engineId: 'pikafish',
          depth: ANALYSIS_SWEEP_DEPTH,
          plies,
        },
        { firstMover: redStarts ? 'red' : 'black' },
      );
    },
  };
}
