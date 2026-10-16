// Lichess-style "best move" advice line under the move list: when the move that
// led to the current ply was flagged, it reads e.g. "Mistake. h3-e3 was best."
// The best alternative is the engine's top move in the position BEFORE the played
// move (evals[ply-1].best), already in our own square notation from the server.
import './move-advice.css';
import type { GameAnalysis } from './game-analysis.js';
import { ADVICE_LABEL, defaultFormatBestMove } from './move-advice-text.js';

// The text half (labels + per-variant UCI formatters) lives in move-advice-text.ts so a
// surface can quote advice without this widget's stylesheet; re-exported for old imports.
export {
  ADVICE_LABEL,
  defaultFormatBestMove,
  formatFlipVariantBestMove,
  formatJieqiBestMove,
  formatJungleEngineMove,
  PRAISE_COMMENT,
} from './move-advice-text.js';

export interface MoveAdvice {
  el: HTMLElement;
  /** Show the advice for the move at `ply`; hidden when that move wasn't flagged
   *  or analysis hasn't loaded. Call on every ply change. */
  update(ply: number, analysis: GameAnalysis | null): void;
}

export function createMoveAdvice(
  formatBest: (uci: string) => string = defaultFormatBestMove,
): MoveAdvice {
  const el = document.createElement('div');
  el.className = 'review-advice';
  el.hidden = true;

  function update(ply: number, analysis: GameAnalysis | null): void {
    const move = analysis?.moves.find((m) => m.ply === ply);
    const judgment = move?.judgment;
    if (!analysis || !move || !judgment) {
      el.hidden = true;
      el.replaceChildren();
      return;
    }
    const best = analysis.evals.find((e) => e.ply === ply - 1)?.best ?? null;
    el.hidden = false;
    el.className = `review-advice review-advice--${judgment}`;
    const label = document.createElement('span');
    label.className = 'review-advice__label';
    label.textContent = `${ADVICE_LABEL[judgment]}.`;
    el.replaceChildren(label);
    if (best) el.append(document.createTextNode(` ${formatBest(best)} was best.`));
  }

  return { el, update };
}
