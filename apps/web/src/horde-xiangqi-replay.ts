// Client-side Horde Xiangqi replay for the article: one 9x10 board stepped
// through a game record by replaying the real rule kernel with the horde
// configuration (a non-royal red side that loses by extinction, the facing
// rule void, veteran soldiers as a switch). The standard xq-replay cannot hold
// this game: its applier and FEN parser expect a general on each side and a
// soldier that moves sideways only past the river.
//
// The board is drawn with the shared xiangqi diagram toolkit, so it follows the
// reader's board and piece pickers, and veterans wear the crossed art from
// rank 1 because that is the move they have.

import {
  createXiangqiRuleKernel,
  parseXiangqiRulePlacement,
  type XiangqiColor,
  type XiangqiMove,
  type XiangqiRuleState,
  type XiangqiSquare,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import {
  XQ_BOARD_H,
  XQ_BOARD_W,
  xqBoardSvg,
  xqCoord,
  xqPoint,
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';
import './live-xiangqi.css';
import { createStepCard } from './article-step-card.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';

export type HordeXiangqiReplaySpec = {
  /** The start array as a FEN placement (ranks 10 to 1, Red's soldiers as P). */
  placement: string;
  /** Space-separated coordinate moves, `e4e5`, ranks 1-10 with Red's back rank at 1. */
  moves: string;
  /** Veteran soldiers: the crossed soldier's move from the first step. */
  veteran: boolean;
  /** The no-capture clock in plies the game was recorded under. */
  progressClock: number;
  red: string;
  black: string;
  event: string;
  perspective?: XiangqiColor;
  /** Shown on the final ply; the record's own terminal reason is asserted against it. */
  resultText: string;
  /** Optional narrative at chosen plies (1-based; 0 is the start). Other plies show the move. */
  notes?: Record<number, string>;
};

export type HordeXiangqiReplayController = { destroy: () => void };

const SQUARE = /^[a-i](?:10|[1-9])$/;

function splitMove(token: string, ply: number): { from: XiangqiSquare; to: XiangqiSquare } {
  const n = token.endsWith('10') ? 3 : 2;
  const from = token.slice(0, token.length - n);
  const to = token.slice(token.length - n);
  if (!SQUARE.test(from) || !SQUARE.test(to)) {
    throw new Error(`horde xiangqi replay: bad token "${token}" at ply ${ply + 1}`);
  }
  return { from: from as XiangqiSquare, to: to as XiangqiSquare };
}

export function replayHordeXiangqiRecord(spec: HordeXiangqiReplaySpec): {
  moves: XiangqiMove[];
  states: XiangqiRuleState[];
} {
  const startBoard = parseXiangqiRulePlacement(spec.placement);
  if (!startBoard) throw new Error('horde xiangqi replay: the start placement does not parse');
  const kernel = createXiangqiRuleKernel({
    startBoard,
    facing: 'off',
    stalemate: 'loss',
    progressClock: spec.progressClock,
    repetition: 'draw',
    royal: { red: false, black: true },
    extinction: { red: 'loses', black: 'none' },
    veteranSoldiers: { red: spec.veteran, black: false },
  });
  let state = kernel.initial('article-replay');
  const states: XiangqiRuleState[] = [state];
  const moves: XiangqiMove[] = [];
  spec.moves
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, ply) => {
      const { from, to } = splitMove(token, ply);
      // Resolve against the kernel's own legal moves, so a malformed record
      // fails loudly instead of replaying into a quietly wrong position.
      const hit = kernel.legalMoves(state).find((m) => m.from === from && m.to === to);
      if (!hit) throw new Error(`horde xiangqi replay: illegal move "${token}" at ply ${ply + 1}`);
      state = kernel.apply(state, hit);
      moves.push(hit);
      states.push(state);
    });
  return { moves, states };
}

export function mountHordeXiangqiReplay(
  host: HTMLElement,
  spec: HordeXiangqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): HordeXiangqiReplayController {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const perspective = spec.perspective ?? 'red';
  const { moves, states } = replayHordeXiangqiRecord(spec);
  const total = moves.length;
  const notes = spec.notes ?? {};

  host.classList.add('notranslate');
  host.setAttribute('translate', 'no');

  /**
   * Glide the piece of a one-ply step after the repaint: forward slides the
   * piece on `to` in from `from`, a back step slides the piece on `from` home.
   * Offsets are differences of two diagram points, so the board's origin and
   * layout (intersection or cell) cancel out.
   */
  function glide(board: HTMLElement, move: XiangqiMove, reverse: boolean): void {
    const duration = pieceAnimationDurationMs();
    if (duration <= 0) return;
    const settle = reverse ? move.from : move.to;
    const origin = reverse ? move.to : move.from;
    const slot = board.querySelector(`[data-piece-square="${settle}"]`);
    if (!slot) return;
    const o = xqCoord(origin);
    const t = xqCoord(settle);
    const from = xqPoint(o.file, o.rank, perspective, 0, 0);
    const to = xqPoint(t.file, t.rank, perspective, 0, 0);
    glideSvgPiece(slot, from.x - to.x, from.y - to.y, duration);
  }

  function paint(board: HTMLElement, index: number, from: number | null): void {
    const state = states[index]!;
    const lastMove = index ? moves[index - 1]! : null;
    board.innerHTML = xqSvg(
      XQ_BOARD_W,
      // The board alone, no label band above it: the card's seat rows frame it.
      XQ_BOARD_H + 8,
      xqBoardSvg({
        state: xqVisionDemoState(`horde-replay-${index}`, state.board),
        x: 0,
        y: -24,
        label: '',
        perspective,
        arrows: lastMove ? [{ from: lastMove.from, to: lastMove.to }] : undefined,
        veteranSoldiers: spec.veteran,
      }),
    );
    if (from !== null && Math.abs(index - from) === 1) {
      const forward = index > from;
      const move = moves[(forward ? index : from) - 1];
      if (move) glide(board, move, !forward);
    }
  }

  const card = createStepCard(
    { lang: options.lang, title: spec.event },
    {
      count: total + 1,
      paint,
      moves: moves.map((move, i) => ({
        label: `${move.from}-${move.to}`,
        ...(notes[i + 1] ? { note: notes[i + 1] } : {}),
      })),
      intro: notes[0] ?? copy.intro,
      seats: {
        first: { name: `${spec.red}${copy.firstRole}`, ink: 'red' },
        second: { name: `${spec.black}${copy.secondRole}`, ink: 'black' },
      },
      result: spec.resultText,
    },
  );
  host.replaceChildren(card.el);
  const onAppearance = (): void => card.repaint();
  window.addEventListener(xiangqiAppearanceChangedEvent, onAppearance);

  return {
    destroy(): void {
      window.removeEventListener(xiangqiAppearanceChangedEvent, onAppearance);
      card.destroy();
      host.replaceChildren();
      host.classList.remove('notranslate');
      host.removeAttribute('translate');
    },
  };
}
