// Gomoku engine scores in words (B+2.1, White wins in 7). Kept apart from
// eval-format.ts, which Node-run scripts import and must not pull in the i18n
// catalog (it reads import.meta.env, which only Vite defines).

import { t } from '../../i18n/catalog.js';

/** Gomoku names the side instead of signing the score, the way Go writes a lead
 *  ("W+9.0"): a chess player reads a minus as Black, but Black moves first here
 *  and is the plus side of the shared axis (Brian, 2026-11-05). Inputs are from
 *  the first seat's POV (positive = Black better). A forced win names the side
 *  in words, since "#" means checkmate and the game has none. `compact` is the
 *  narrow form for the move-list column, chart readout and phone readout
 *  ("W in 7"); the engine panel has room for "White wins in 7". */
export function formatGomokuEval(
  cp: number | null,
  mate: number | null,
  options: { compact?: boolean } = {},
): string {
  const compact = options.compact === true;
  if (mate != null) {
    if (mate === 0) return compact ? '–' : t('engine.gomokuDecided');
    const black = mate > 0;
    const moves = Math.abs(mate);
    if (compact)
      return t(black ? 'engine.gomokuBlackInShort' : 'engine.gomokuWhiteInShort', { moves });
    return t(black ? 'engine.blackWinsIn' : 'engine.whiteWinsIn', { moves });
  }
  if (cp == null) return '–';
  if (Math.abs(cp) >= 30000) {
    if (compact) return t(cp > 0 ? 'engine.gomokuBlackWinsShort' : 'engine.gomokuWhiteWinsShort');
    return t(cp > 0 ? 'engine.blackWins' : 'engine.whiteWins');
  }
  const score = (Math.abs(cp) / 100).toFixed(1);
  if (score === '0.0') return score;
  return t(cp > 0 ? 'engine.gomokuBlackLead' : 'engine.gomokuWhiteLead', { score });
}

/** The narrow Gomoku form, shaped like `formatEval` for the shared columns. */
export function formatGomokuEvalCompact(cp: number | null, mate: number | null): string {
  return formatGomokuEval(cp, mate, { compact: true });
}
