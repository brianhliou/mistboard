// Jungle (Dou Shou Qi) game replay for the rules article.
//
// Sibling of banqi-replay.ts, but perfect-information: the spec carries only a
// move list (no hidden deal). Each position is produced by replaying the moves
// through the real jungle kernel (createInitialJungleState + applyJungleMove)
// and rendered on demand by the live jungle board renderer, so the sample game
// looks exactly like a played game.

import {
  applyJungleMove,
  createInitialJungleState,
  type JungleGameState,
  type JungleMove,
  type JungleSquare,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import type { JungleReplaySpec } from './articles/types.js';
import { animateJungleBoardMove, renderJungleBoardSvg } from './jungle-render.js';

type JungleReplayCopy = {
  redLabel: string;
  blackLabel: string;
  firstMove: string;
  previousMove: string;
  nextMove: string;
  lastMove: string;
  sliderLabel: string;
  start: string;
  intro: string;
  movePrefix: (moveNumber: number) => string;
  red: string;
  black: string;
};

const JUNGLE_REPLAY_COPY: Record<ArticleLang | 'en', JungleReplayCopy> = {
  en: {
    redLabel: ' (Red)',
    blackLabel: ' (Blue)',
    firstMove: 'First move',
    previousMove: 'Previous move',
    nextMove: 'Next move',
    lastMove: 'Last move',
    sliderLabel: 'Move',
    start: 'Start',
    intro: 'Step through the game. Red moves first.',
    movePrefix: (moveNumber) => `Move ${moveNumber}`,
    red: 'Red',
    black: 'Blue',
  },
  'zh-Hans': {
    redLabel: '（红方）',
    blackLabel: '（蓝方）',
    firstMove: '第一步',
    previousMove: '上一步',
    nextMove: '下一步',
    lastMove: '最后一步',
    sliderLabel: '着法',
    start: '开始',
    intro: '逐步回放这盘棋。红方先走。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    red: '红方',
    black: '蓝方',
  },
  'zh-Hant': {
    redLabel: '（紅方）',
    blackLabel: '（藍方）',
    firstMove: '第一步',
    previousMove: '上一步',
    nextMove: '下一步',
    lastMove: '最後一步',
    sliderLabel: '著法',
    start: '開始',
    intro: '逐步回放這盤棋。紅方先走。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    red: '紅方',
    black: '藍方',
  },
};

export type JungleReplayController = { destroy(): void };

const SQUARE_MOVE = /^([a-g][1-9])([a-g][1-9])$/;

function tokenToMove(tok: string): JungleMove | null {
  const m = SQUARE_MOVE.exec(tok);
  if (!m) return null;
  return { from: m[1] as JungleSquare, to: m[2] as JungleSquare };
}

export function mountJungleReplay(
  host: HTMLElement,
  spec: JungleReplaySpec,
  options: { lang?: ArticleLang } = {},
): JungleReplayController {
  const copy = JUNGLE_REPLAY_COPY[options.lang ?? 'en'];
  const perspective = spec.perspective ?? 'red';
  const moves = spec.moves
    .trim()
    .split(/\s+/)
    .map(tokenToMove)
    .filter((m): m is JungleMove => m !== null);

  // Replay once; cache every position so stepping is instant.
  const states: JungleGameState[] = [createInitialJungleState('jungle-replay')];
  for (const move of moves) {
    states.push(applyJungleMove(states[states.length - 1]!, move));
  }
  const total = moves.length;

  host.classList.add('jungle-replay', 'stepper');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  const headerPlayers = document.createElement('div');
  headerPlayers.textContent = `${spec.red}${copy.redLabel} vs ${spec.black}${copy.blackLabel}`;
  const headerEvent = document.createElement('div');
  headerEvent.className = 'xq-replay-header-event';
  headerEvent.textContent = spec.event;
  header.append(headerPlayers, headerEvent);
  if (spec.outcome) {
    const headerOutcome = document.createElement('div');
    headerOutcome.className = 'xq-replay-header-event';
    headerOutcome.textContent = spec.outcome;
    header.append(headerOutcome);
  }

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-jungle';

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
    const state = states[index]!;
    frame.innerHTML = renderJungleBoardSvg(state.board, {
      perspective,
      lastMove: state.lastMove ?? null,
    });
    // One-ply steps glide (the embed board's rule); a jump repaints instantly.
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = moves[(forward ? index : animateFrom) - 1];
      if (move) animateJungleBoardMove(frame, move, perspective, { reverse: !forward });
    }
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
      const mv = moves[index - 1]!;
      const mover = index % 2 === 1 ? copy.red : copy.black;
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${mv.from}–${mv.to}`;
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

  render();

  return {
    destroy(): void {
      first.removeEventListener('click', onFirst);
      prev.removeEventListener('click', onPrev);
      next.removeEventListener('click', onNext);
      last.removeEventListener('click', onLast);
      slider.removeEventListener('input', onSlider);
      host.removeEventListener('keydown', onKey);
      host.replaceChildren();
      host.classList.remove('jungle-replay', 'stepper');
    },
  };
}
