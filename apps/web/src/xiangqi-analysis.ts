// The standalone /analysis/xiangqi surface (lichess.org/analysis): a fresh
// interactive board at the START POSITION, or seeded from an imported move list.
// Play moves that branch into a tree, run a local ceval sweep — no server room.
//
// The board + tree + engine + analysis machinery all live in the shared
// review/xiangqi-review.ts (also used by xiangqi-postgame.ts for the /game
// surface). This file only supplies the ingress, the client ceval sweep, and the
// minimal meta card (no players).

import {
  parseStandardXiangqiFen,
  standardXiangqiEngineFen,
  standardXiangqiFen,
  XIANGQI_SPEC_ID,
  type XiangqiGameState,
  type XiangqiGameStatus,
  type XiangqiMove,
} from '@mistboard/game';
import {
  type GameOutcome,
  outcomeLabel,
  terminationLabel,
  variantDisplayLabel,
} from './game-display.js';
import { seatColorWord } from './variant-seat-label.js';
import './game-shell.css';
import './live-xiangqi.css';
import './dark-xiangqi-postgame.css';
import './xiangqi-postgame.css';
import { t } from './i18n/catalog.js';
import { createGameMetaCard } from './review/game-meta-card.js';
import { editorHref } from './review/position-links.js';
import { buildXiangqiClientAnalysisSource } from './review/xiangqi-client-analysis.js';
import { importXiangqiPaste } from './review/xiangqi-import.js';
import { mountXiangqiReview } from './review/xiangqi-review.js';
import {
  buildXiangqiReplayFromMoves,
  xiangqiReplayViewAtPly,
} from './review/xiangqi-review-model.js';
import { buildNav } from './site-shell.js';
import { DEFAULT_STUDY_VARIANT } from './study-catalog.js';

function statusSummary(status: XiangqiGameStatus, plyCount: number): string {
  if (plyCount === 0) return t('analysis.playAMove');
  const plies = pliesLabel(plyCount);
  if (status.type === 'finished') {
    return `${finishedStatusLine(status)} · ${plies}`;
  }
  return `${t('analysis.board')} · ${plies}`;
}

function pliesLabel(plyCount: number): string {
  return plyCount === 1 ? t('replay.onePly') : t('watch.plyCount', { count: plyCount });
}

function finishedStatusLine(status: Extract<XiangqiGameStatus, { type: 'finished' }>): string {
  const outcome: GameOutcome = status.winner
    ? { winner: seatColorWord(XIANGQI_SPEC_ID, status.winner) }
    : { draw: true };
  return t('watch.resultByReason', {
    result: outcomeLabel(outcome),
    reason: terminationLabel(status.reason),
  });
}

export interface XiangqiAnalysisOptions {
  /** Left-rail title (default "Xiangqi analysis"). */
  title?: string;
  /** Variant dropdown (analysis-page.ts), stacked above the meta card. */
  picker?: HTMLElement;
  /** Hand-set start position (a FEN-seeded composition). The tree roots here,
   *  the engine replays from this base, and `moves` apply from this state. */
  startState?: XiangqiGameState;
  /** Render the site nav above the board (default). The embed passes false:
   *  it runs inside someone else's page and shows the board alone. */
  nav?: boolean;
}

/** Mount the interactive analysis board for a standard-xiangqi move list. An empty
 *  list opens a fresh board at the start position; illegal moves truncate to the
 *  legal prefix. */
export function mountXiangqiAnalysis(
  root: HTMLElement,
  moves: XiangqiMove[],
  opts: XiangqiAnalysisOptions = {},
): void {
  const replay = buildXiangqiReplayFromMoves(moves, opts.startState);

  const finalStatus = xiangqiReplayViewAtPly(replay, replay.maxPly).status;
  // With a variant picker (the /analysis route), the dropdown is the ENTIRE
  // left rail, lichess-style. Without one, keep the meta card (any direct
  // embed of the analysis board).
  const metaCardEl =
    opts.picker ??
    createGameMetaCard({
      markerId: 'xiangqi',
      glyph: '象',
      headline: [t('analysis.board')],
      variantName: variantDisplayLabel(XIANGQI_SPEC_ID),
      subline: replay.maxPly
        ? pliesLabel(replay.maxPly)
        : opts.startState
          ? t('analysis.customPosition')
          : t('analysis.startPosition'),
      status: finalStatus.type === 'finished' ? finishedStatusLine(finalStatus) : null,
    }).el;

  root.replaceChildren(...(opts.nav === false ? [] : [buildNav()]));
  mountXiangqiReview(root, {
    reviewSurface: 'analysis',
    pageClassName: 'xiangqi-review',
    ariaLabel: 'Xiangqi analysis',
    eyebrow: 'Analysis',
    title: opts.title ?? 'Xiangqi analysis',
    summary: statusSummary(finalStatus, replay.maxPly),
    boardAriaLabel: 'Xiangqi board',
    metaCard: metaCardEl,
    // Pass the raw moves so the review's tree truncates an illegal seed itself and
    // surfaces the notice (the legal prefix drives the client sweep above).
    moves,
    // Control-bar menu actions the analysis board can actually back: save the
    // current line as a study, and wipe the moves back to the root position.
    studyExport: { variant: DEFAULT_STUDY_VARIANT, name: opts.title ?? 'Xiangqi analysis' },
    allowClearMoves: true,
    // Hand the current position to the board editor (/editor/xiangqi?fen=).
    boardEditorHref: (truth) => editorHref('xiangqi', standardXiangqiFen(truth)),
    // A hand-set start roots the tree + engine at the composition's position.
    root: opts.startState
      ? { truth: opts.startState, fen: standardXiangqiFen(opts.startState) }
      : undefined,
    // Roomless import: whole-game analysis is a client ceval sweep (shared with the
    // historical library). Null when there is no game yet to analyse.
    analysis: buildXiangqiClientAnalysisSource(
      replay,
      opts.startState ? standardXiangqiEngineFen(opts.startState) : undefined,
    ),
    // Underboard FEN + moves boxes (lichess.org/analysis): a successful import
    // re-mounts via the shareable ?moves= / ?fen= link, so the seeded board has
    // a URL.
    // The line on screen is always in the address bar (coordinate `from-to`
    // tokens, the same spelling the import path accepts).
    onLineChange: (moves) => {
      const url = new URL(window.location.href);
      if (moves.length === 0) url.searchParams.delete('moves');
      else url.searchParams.set('moves', moves.map((m) => `${m.from}-${m.to}`).join(' '));
      if (url.toString() !== window.location.href) {
        window.history.replaceState(window.history.state, '', url.toString());
      }
    },
    importPanel: {
      onImport: (text) => {
        const trimmed = text.trim();
        if (!trimmed) return t('analysis.pasteGameToImport');
        const result = importXiangqiPaste(trimmed);
        if (result.error || result.moves.length === 0) {
          return result.error ?? 'No moves recognized.';
        }
        // A full-game import replaces any custom position: it anchors at the
        // standard start, UNLESS the paste carried its own [FEN], in which case
        // the moves only replay correctly from that position.
        const url = new URL(window.location.href);
        if (result.startFen) url.searchParams.set('fen', result.startFen);
        else url.searchParams.delete('fen');
        url.searchParams.set(
          'moves',
          result.moves.map((move) => `${move.from}-${move.to}`).join(' '),
        );
        window.location.assign(url.toString());
        return null;
      },
      onImportFen: (fen) => {
        const trimmed = fen.trim();
        if (!trimmed) return t('analysis.pasteFenToSet');
        const parsed = parseStandardXiangqiFen(trimmed);
        if (!parsed.ok) return parsed.error;
        const url = new URL(window.location.href);
        url.searchParams.delete('moves');
        url.searchParams.set('fen', standardXiangqiFen(parsed.state));
        window.location.assign(url.toString());
        return null;
      },
    },
  });
}
