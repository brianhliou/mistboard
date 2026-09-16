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
  xqSvg,
  xqVisionDemoState,
} from './articles/diagrams.js';
import './live-xiangqi.css';
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

  let index = 0;
  function render(): void {
    const state = states[index]!;
    const lastMove = index ? moves[index - 1]! : null;
    board.innerHTML = xqSvg(
      XQ_BOARD_W,
      XQ_BOARD_H + 34,
      xqBoardSvg({
        state: xqVisionDemoState(`horde-replay-${index}`, state.board),
        x: 0,
        y: 0,
        label: '',
        perspective,
        arrows: lastMove ? [{ from: lastMove.from, to: lastMove.to }] : undefined,
        veteranSoldiers: spec.veteran,
      }),
    );
    counter.textContent = index === 0 ? copy.start : `${index} / ${total}`;
    first.disabled = index === 0;
    prev.disabled = index === 0;
    next.disabled = index === total;
    last.disabled = index === total;
    slider.value = String(index);
    const note = notes[index];
    if (index === 0) {
      narrative.textContent = note ?? copy.intro;
    } else if (index === total) {
      narrative.textContent = note ? `${note} ${spec.resultText}` : spec.resultText;
    } else {
      const mover = index % 2 === 1 ? copy.first : copy.second;
      const move = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${lastMove!.from}-${lastMove!.to}`;
      narrative.textContent = note ? `${move}. ${note}` : move;
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
