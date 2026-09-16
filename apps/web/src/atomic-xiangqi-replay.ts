// Client-side Atomic Xiangqi replay for the rules article and the study embed:
// one board stepped through a move list by replaying the real rules kernel, so
// every explosion on the way is the kernel's, not a re-implementation. The board
// renders through the LIVE renderer (xiangqiBoardSvg) with the aftermath discs
// and the detonation the live room draws (atomic-xiangqi-board.ts), so the
// replay tracks the reader's board theme and piece set and a capture looks the
// way it does in a game.
//
// A token is Fairy-Stockfish UCI in this variant's own squares (`b3b7`,
// `h1g3`, `a10a9`), which is also what a study chapter stores, so a game is
// pasted between the surfaces without translation.

import {
  type AtomicXiangqiColor,
  type AtomicXiangqiGameState,
  type AtomicXiangqiMove,
  applyAtomicXiangqiMove,
  createInitialAtomicXiangqiState,
  formatXiangqiMove,
  fsfUciToXiangqiSquares,
  getAtomicXiangqiPlayerView,
  isAtomicXiangqiLegalMove,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import './live-xiangqi.css';
import './atomic-xiangqi.css';
import {
  animateAtomicXiangqiCapture,
  atomicXiangqiBlastKey,
  atomicXiangqiBlastMarkers,
  atomicXiangqiCaptureAnimates,
  markAtomicXiangqiBlastHost,
} from './atomic-xiangqi-board.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { xiangqiBoardSvg } from './xiangqi-board.js';
import { currentXiangqiNotationStyle } from './xiangqi-notation.js';

export type AtomicXiangqiReplaySpec = {
  /** Space-separated UCI tokens in a1-i10 squares, for example "b3b7 h10g8". */
  moves: string;
  red: string;
  black: string;
  event: string;
  perspective?: AtomicXiangqiColor;
  resultText: string;
};

export type AtomicXiangqiReplayController = { destroy: () => void };

function tokenize(moves: string): string[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((raw) => raw.replace(/^\d+\./, '').replace(/[,.]+$/g, ''))
    .filter(Boolean);
}

/**
 * Resolve a token against the kernel rather than trusting it: a malformed or
 * illegal move fails loudly here instead of replaying into a quietly wrong
 * position, which for this variant would mean a board with pieces on it that
 * the explosion removed.
 */
function moveForToken(
  state: AtomicXiangqiGameState,
  token: string,
  ply: number,
): AtomicXiangqiMove {
  const move = fsfUciToXiangqiSquares(token);
  if (!move) throw new Error(`atomic xiangqi replay: bad token "${token}" at ply ${ply + 1}`);
  if (state.status.type !== 'playing' || !isAtomicXiangqiLegalMove(state, move)) {
    throw new Error(`atomic xiangqi replay: illegal move "${token}" at ply ${ply + 1}`);
  }
  return move;
}

export function replayAtomicXiangqiNotation(moves: string): {
  moves: AtomicXiangqiMove[];
  states: AtomicXiangqiGameState[];
  labels: string[];
} {
  const tokens = tokenize(moves);
  const style = currentXiangqiNotationStyle();
  let state = createInitialAtomicXiangqiState('article-replay');
  const states: AtomicXiangqiGameState[] = [state];
  const played: AtomicXiangqiMove[] = [];
  const labels: string[] = [];
  tokens.forEach((token, ply) => {
    const move = moveForToken(state, token, ply);
    labels.push(formatXiangqiMove(state, move, style));
    state = applyAtomicXiangqiMove(state, move);
    played.push(move);
    states.push(state);
  });
  return { moves: played, states, labels };
}

/**
 * The board half shared by the article widget and the embed card: paints the
 * position at `index` for `perspective`, with the aftermath discs, and plays
 * the detonation the first time a capture ply comes on screen (stepping back
 * onto it later shows the discs without the burst, as the live room does).
 */
function createBoardPainter(host: HTMLElement, states: AtomicXiangqiGameState[]) {
  let detonatedKey: string | null = null;
  let cancelCapture: (() => void) | null = null;
  return {
    paint(index: number, perspective: AtomicXiangqiColor): void {
      const state = states[index]!;
      const view = getAtomicXiangqiPlayerView(state, perspective);
      const key = atomicXiangqiBlastKey(view);
      const fresh = key !== detonatedKey;
      detonatedKey = key;
      if (fresh) {
        cancelCapture?.();
        cancelCapture = null;
      }
      markAtomicXiangqiBlastHost(host, view);
      host.innerHTML = xiangqiBoardSvg(view, perspective, {
        interactive: false,
        selectedSquare: null,
        draggingFrom: null,
        coordinates: false,
        markers: atomicXiangqiBlastMarkers(view, { fresh }),
      });
      if (fresh && atomicXiangqiCaptureAnimates(view)) {
        cancelCapture = animateAtomicXiangqiCapture(host, view, perspective);
      }
    },
    dispose(): void {
      cancelCapture?.();
      cancelCapture = null;
    },
  };
}

export function mountAtomicXiangqiReplay(
  host: HTMLElement,
  spec: AtomicXiangqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): AtomicXiangqiReplayController {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const perspective = spec.perspective ?? 'red';
  const { states, labels } = replayAtomicXiangqiNotation(spec.moves);
  const total = labels.length;

  host.classList.add('xq-replay', 'stepper', 'notranslate');
  host.setAttribute('translate', 'no');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  const headerPlayers = document.createElement('div');
  headerPlayers.textContent = `${spec.red}${copy.firstRole} vs ${spec.black}${copy.secondRole}`;
  const headerEvent = document.createElement('div');
  headerEvent.className = 'xq-replay-header-event';
  headerEvent.textContent = spec.event;
  header.append(headerPlayers, headerEvent);

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-xq replay-pane';
  const board = document.createElement('div');
  // The duck replay's showcase sizing (480px board, live renderer); this widget
  // renders the live board too, so the `xq-article-svg` rules cannot reach it.
  board.className = 'dkx-replay-board';
  frame.append(board);

  const controls = document.createElement('div');
  controls.className = 'stepper-controls';
  const mkButton = (label: string, aria: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stepper-button';
    b.setAttribute('aria-label', aria);
    b.textContent = label;
    return b;
  };
  const first = mkButton('⏮', copy.firstMove);
  const prev = mkButton('←', copy.previousMove);
  prev.classList.add('stepper-button-prev');
  const counter = document.createElement('span');
  counter.className = 'stepper-counter';
  const next = mkButton('→', copy.nextMove);
  next.classList.add('stepper-button-next');
  const last = mkButton('⏭', copy.lastMove);
  controls.append(first, prev, counter, next, last);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'xq-replay-slider dkx-replay-slider';
  slider.min = '0';
  slider.max = String(total);
  slider.step = '1';
  slider.setAttribute('aria-label', copy.sliderLabel);

  const narrative = document.createElement('div');
  narrative.className = 'stepper-narrative';

  host.append(header, frame, controls, slider, narrative);

  const painter = createBoardPainter(board, states);
  let index = 0;
  function render(): void {
    painter.paint(index, perspective);
    counter.textContent = index === 0 ? copy.start : `${index} / ${total}`;
    first.disabled = index === 0;
    prev.disabled = index === 0;
    next.disabled = index === total;
    last.disabled = index === total;
    slider.value = String(index);
    if (index === 0) {
      narrative.textContent = copy.intro;
    } else if (index === total) {
      narrative.textContent = spec.resultText;
    } else {
      const mover = index % 2 === 1 ? copy.first : copy.second;
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${labels[index - 1]}`;
    }
  }

  function goto(target: number): void {
    const clamped = Math.max(0, Math.min(total, target));
    if (clamped !== index) {
      index = clamped;
      render();
    }
  }
  const onFirst = () => goto(0);
  const onPrev = () => goto(index - 1);
  const onNext = () => goto(index + 1);
  const onLast = () => goto(total);
  const onSlider = () => goto(Number(slider.value));
  first.addEventListener('click', onFirst);
  prev.addEventListener('click', onPrev);
  next.addEventListener('click', onNext);
  last.addEventListener('click', onLast);
  slider.addEventListener('input', onSlider);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      onPrev();
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      onNext();
      e.preventDefault();
    }
  };
  host.addEventListener('keydown', onKey);
  window.addEventListener(xiangqiAppearanceChangedEvent, render);

  render();

  return {
    destroy(): void {
      painter.dispose();
      first.removeEventListener('click', onFirst);
      prev.removeEventListener('click', onPrev);
      next.removeEventListener('click', onNext);
      last.removeEventListener('click', onLast);
      slider.removeEventListener('input', onSlider);
      host.removeEventListener('keydown', onKey);
      window.removeEventListener(xiangqiAppearanceChangedEvent, render);
      host.replaceChildren();
      host.classList.remove('xq-replay', 'stepper', 'notranslate');
      host.removeAttribute('translate');
    },
  };
}

/**
 * The BOARD half of an atomic replay, driven by whatever chrome hosts it: the
 * embed card (embed/embed-card.ts) supplies the stepper and the move sheet and
 * wants only a board plus a handle. Same shape as `mountXiangqiReplayBoard`
 * and `mountDuckXiangqiReplayBoard`, so one card drives any of them.
 */
export function mountAtomicXiangqiReplayBoard(
  host: HTMLElement,
  spec: AtomicXiangqiReplaySpec,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{ ply: number; label: string }>;
  bottomSeat: () => 'first' | 'second';
} {
  const perspective = spec.perspective ?? 'red';
  const { states, labels } = replayAtomicXiangqiNotation(spec.moves);
  const total = labels.length;

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-xq';
  host.replaceChildren(frame);
  const painter = createBoardPainter(frame, states);

  let index = 0;
  const render = (): void => {
    painter.paint(index, perspective);
    hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => {
      painter.dispose();
      host.replaceChildren();
    },
    jumpToPly: (ply: number) => {
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render();
    },
    plyCount: () => total,
    moveEntries: () => labels.map((label, i) => ({ ply: i + 1, label })),
    // Red is the first mover in xiangqi, so a red-perspective board puts the
    // first mover at the bottom.
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}
