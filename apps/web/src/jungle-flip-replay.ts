// Flip Jungle (兽棋 / 翻翻棋) game replay for the rules article.
//
// Sibling of banqi-replay.ts: the spec carries the hidden deal + a move list, not
// per-ply board images. Each position is produced by replaying the moves through
// the real flip-jungle kernel (createInitialJungleFlipState(id, deal) +
// applyJungleFlipMove) and rendered on demand by the live flip-jungle board
// renderer from the as-played masked view. Face-down tiles show as backs and flip
// to their dealt animal the first time they are turned over, exactly as in play.

import {
  applyJungleFlipMove,
  createInitialJungleFlipState,
  getJungleFlipPlayerView,
  type JungleFlipGameState,
  type JungleFlipMove,
  type JungleFlipSquare,
  jungleFlipLastMoverInk,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import type { JungleFlipReplaySpec } from './articles/types.js';
import {
  animateJungleFlipBoardMove,
  type JungleFlipRenderBoard,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';

type JungleFlipReplayCopy = {
  firstRole: string;
  secondRole: string;
  firstMove: string;
  previousMove: string;
  nextMove: string;
  lastMove: string;
  sliderLabel: string;
  start: string;
  intro: string;
  movePrefix: (moveNumber: number) => string;
  first: string;
  second: string;
  flips: string;
};

const JUNGLE_FLIP_REPLAY_COPY: Record<ArticleLang | 'en', JungleFlipReplayCopy> = {
  en: {
    firstRole: ' (first)',
    secondRole: ' (second)',
    firstMove: 'First move',
    previousMove: 'Previous move',
    nextMove: 'Next move',
    lastMove: 'Last move',
    sliderLabel: 'Move',
    start: 'Start',
    intro:
      'Step through the game. A tile flips to its dealt animal the first time it is turned over; the first tile a player flips sets their color.',
    movePrefix: (moveNumber) => `Move ${moveNumber}`,
    first: 'First',
    second: 'Second',
    flips: 'flips',
  },
  'zh-Hans': {
    firstRole: '（先手）',
    secondRole: '（后手）',
    firstMove: '第一步',
    previousMove: '上一步',
    nextMove: '下一步',
    lastMove: '最后一步',
    sliderLabel: '着法',
    start: '开始',
    intro:
      '逐步回放这盘棋。棋子第一次翻开时会显示其发到的动物；每位玩家翻开的第一枚棋子决定其颜色。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    first: '先手',
    second: '后手',
    flips: '翻开',
  },
  'zh-Hant': {
    firstRole: '（先手）',
    secondRole: '（後手）',
    firstMove: '第一步',
    previousMove: '上一步',
    nextMove: '下一步',
    lastMove: '最後一步',
    sliderLabel: '著法',
    start: '開始',
    intro:
      '逐步回放這盤棋。棋子第一次翻開時會顯示其發到的動物；每位玩家翻開的第一枚棋子決定其顏色。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    first: '先手',
    second: '後手',
    flips: '翻開',
  },
};

export type JungleFlipReplayController = { destroy(): void };

const SQUARE_MOVE = /^([a-d][1-4])([a-d][1-4])$/;

function tokenToMove(tok: string): JungleFlipMove | null {
  const m = SQUARE_MOVE.exec(tok);
  if (!m) return null;
  return { from: m[1] as JungleFlipSquare, to: m[2] as JungleFlipSquare };
}

export function mountJungleFlipReplay(
  host: HTMLElement,
  spec: JungleFlipReplaySpec,
  options: { lang?: ArticleLang } = {},
): JungleFlipReplayController {
  const copy = JUNGLE_FLIP_REPLAY_COPY[options.lang ?? 'en'];
  const moves = spec.moves
    .trim()
    .split(/\s+/)
    .map(tokenToMove)
    .filter((m): m is JungleFlipMove => m !== null);

  // Replay once; cache every position so stepping is instant.
  const states: JungleFlipGameState[] = [
    createInitialJungleFlipState('jungle-flip-replay', spec.deal),
  ];
  for (const move of moves) {
    states.push(applyJungleFlipMove(states[states.length - 1]!, move));
  }
  const total = moves.length;

  host.classList.add('jungle-flip-replay', 'stepper');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  const headerPlayers = document.createElement('div');
  // Flip Jungle has no fixed sides — the seats are first/second to move, and the
  // opening flip decides each player's color. Label by sequence, not by ink.
  headerPlayers.textContent = `${spec.red}${copy.firstRole} vs ${spec.black}${copy.secondRole}`;
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
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-jungle-flip';

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
    const view = getJungleFlipPlayerView(states[index]!, 'red');
    frame.innerHTML = renderJungleFlipBoardSvg(view.board as JungleFlipRenderBoard, {
      lastMove: view.lastMove ?? null,
      lastMoveInk: jungleFlipLastMoverInk(view),
    });
    // One-ply steps glide (the embed board's rule); a jump repaints instantly.
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = moves[(forward ? index : animateFrom) - 1];
      if (move) animateJungleFlipBoardMove(frame, move, { reverse: !forward });
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
      const mover = index % 2 === 1 ? copy.first : copy.second;
      const action = mv.from === mv.to ? `${copy.flips} ${mv.from}` : `${mv.from}–${mv.to}`;
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${action}`;
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
      host.classList.remove('jungle-flip-replay', 'stepper');
    },
  };
}
