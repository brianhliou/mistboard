// Client-side Crazyhouse Xiangqi replay for the rules article: one 9x10 board
// plus both hands, stepped through a move list by replaying the real rules
// kernel. The Fortress Xiangqi replay's twin (fortress-xiangqi-replay.ts): the
// board is the live room's (xiangqiBoardSvg through crazyhouse-xiangqi-view.ts,
// as Mistboard TV draws it), the hands are the room's pockets, so the replay
// tracks the reader's board theme and piece set and marks a drop the way a
// live game does.
//
// BOTH stylesheets: `live-xiangqi.css` carries the board, `drop-reserve.css`
// the hands and the replay frame.
import './live-xiangqi.css';
import './drop-reserve.css';
import {
  applyCrazyhouseXiangqiMove,
  type CrazyhouseXiangqiColor,
  type CrazyhouseXiangqiGameState,
  type CrazyhouseXiangqiMove,
  crazyhouseXiangqiMoveFromUci,
  createInitialCrazyhouseXiangqiState,
  getCrazyhouseXiangqiPlayerView,
  isCrazyhouseXiangqiDropMove,
  isCrazyhouseXiangqiLegalMove,
  oppositeCrazyhouseXiangqiColor,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import {
  crazyhouseXiangqiBoardView,
  crazyhouseXiangqiLastDrop,
  crazyhouseXiangqiMoveLabel,
  fillCrazyhouseXiangqiReserve,
} from './crazyhouse-xiangqi-view.js';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import { animateXiangqiBoardMove, xiangqiBoardSvg } from './xiangqi-board.js';

export type CrazyhouseXiangqiReplaySpec = {
  // Space-separated Fairy-Stockfish tokens, as the engine and the JSON export
  // write them: board moves from+to ("h3e3"), drops as role@point ("B@e3",
  // B = elephant). Ranks 1-10 keep Red's back rank at 1.
  moves: string;
  red: string;
  black: string;
  event: string;
  perspective?: CrazyhouseXiangqiColor;
  resultText: string;
};

export type CrazyhouseXiangqiReplayRecord = {
  tokens: string[];
  moves: CrazyhouseXiangqiMove[];
  states: CrazyhouseXiangqiGameState[];
};

export type CrazyhouseXiangqiReplayController = { destroy: () => void };

function tokenizeMoves(moves: string): string[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((raw) => raw.replace(/^\d+\./, '').replace(/[,.]+$/g, ''))
    .filter(Boolean);
}

/** Every position of the game, through the kernel; throws on an illegal token. */
export function replayCrazyhouseXiangqiNotation(movesText: string): CrazyhouseXiangqiReplayRecord {
  const tokens = tokenizeMoves(movesText);
  const moves: CrazyhouseXiangqiMove[] = [];
  const states: CrazyhouseXiangqiGameState[] = [
    createInitialCrazyhouseXiangqiState('crazyhouse-xiangqi-replay'),
  ];
  for (const [index, token] of tokens.entries()) {
    const state = states[states.length - 1]!;
    const move = crazyhouseXiangqiMoveFromUci(token);
    if (!move) throw new Error(`Invalid Crazyhouse Xiangqi token at ply ${index + 1}: ${token}`);
    if (state.status.type !== 'playing' || !isCrazyhouseXiangqiLegalMove(state, move)) {
      throw new Error(`Crazyhouse Xiangqi replay token ${token} at ply ${index + 1} is illegal`);
    }
    moves.push(move);
    states.push(applyCrazyhouseXiangqiMove(state, move));
  }
  return { tokens, moves, states };
}

// The page calls these "hands", so the strip does too (the shared stepper copy
// says "reserve", which is Fortress's word).
const HAND_LABEL: Record<ArticleLang | 'en', (side: string) => string> = {
  en: (side) => `${side}’s hand`,
  'zh-Hans': (side) => `${side}持子`,
  'zh-Hant': (side) => `${side}持子`,
};

function handHost(labelText: string): { root: HTMLElement; pieces: HTMLElement } {
  const root = document.createElement('div');
  root.className = 'drop-mini-replay-hand';
  const label = document.createElement('span');
  label.className = 'drop-mini-replay-hand-label';
  label.textContent = labelText;
  const pieces = document.createElement('div');
  pieces.className = 'drop-mini-replay-hand-pieces';
  root.append(label, pieces);
  return { root, pieces };
}

export function mountCrazyhouseXiangqiReplay(
  host: HTMLElement,
  spec: CrazyhouseXiangqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): CrazyhouseXiangqiReplayController {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const handLabel = HAND_LABEL[options.lang ?? 'en'];
  const perspective = spec.perspective ?? 'red';
  const topColor = oppositeCrazyhouseXiangqiColor(perspective);
  const bottomColor = perspective;
  const { moves, states } = replayCrazyhouseXiangqiNotation(spec.moves);
  const total = moves.length;
  const sideName = (color: CrazyhouseXiangqiColor) => (color === 'red' ? copy.first : copy.second);

  host.classList.add('xq-replay', 'drop-mini-replay', 'stepper', 'notranslate');
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
  frame.className =
    'raw-svg-stepper-frame raw-svg-stepper-frame-xq replay-pane drop-mini-replay-frame';
  const topHand = handHost(handLabel(sideName(topColor)));
  const board = document.createElement('div');
  board.className = 'drop-mini-replay-board chx-replay-board';
  const bottomHand = handHost(handLabel(sideName(bottomColor)));
  frame.append(topHand.root, board, bottomHand.root);

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
  slider.className = 'xq-replay-slider';
  slider.min = '0';
  slider.max = String(total);
  slider.step = '1';
  slider.setAttribute('aria-label', copy.sliderLabel);

  const narrative = document.createElement('div');
  narrative.className = 'stepper-narrative';

  host.append(header, frame, controls, slider, narrative);

  let index = 0;
  function render(animateFrom?: number): void {
    const view = getCrazyhouseXiangqiPlayerView(states[index]!, perspective);
    board.innerHTML = xiangqiBoardSvg(crazyhouseXiangqiBoardView(view), perspective, {
      interactive: false,
      selectedSquare: null,
      draggingFrom: null,
      coordinates: false,
      lastDropSquare: crazyhouseXiangqiLastDrop(view),
    });
    // One-ply steps glide (the embed board's rule); a jump repaints instantly,
    // and a drop has no origin, so it just appears.
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = moves[(forward ? index : animateFrom) - 1];
      if (move && !isCrazyhouseXiangqiDropMove(move))
        animateXiangqiBoardMove(board, move, perspective, { reverse: !forward });
    }
    fillCrazyhouseXiangqiReserve(topHand.pieces, view, topColor);
    fillCrazyhouseXiangqiReserve(bottomHand.pieces, view, bottomColor);
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
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${crazyhouseXiangqiMoveLabel(moves[index - 1]!)}`;
    }
  }

  function goto(target: number): void {
    const clamped = Math.max(0, Math.min(total, target));
    if (clamped !== index) {
      const from = index;
      index = clamped;
      render(from);
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
  const onAppearance = (): void => render();
  window.addEventListener(xiangqiAppearanceChangedEvent, onAppearance);

  render();

  return {
    destroy(): void {
      first.removeEventListener('click', onFirst);
      prev.removeEventListener('click', onPrev);
      next.removeEventListener('click', onNext);
      last.removeEventListener('click', onLast);
      slider.removeEventListener('input', onSlider);
      host.removeEventListener('keydown', onKey);
      window.removeEventListener(xiangqiAppearanceChangedEvent, onAppearance);
      host.replaceChildren();
      host.classList.remove('xq-replay', 'drop-mini-replay', 'stepper', 'notranslate');
      host.removeAttribute('translate');
    },
  };
}
