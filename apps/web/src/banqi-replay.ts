// Banqi game replay for the rules article.
//
// Sibling of jieqi-replay.ts: the spec carries the hidden deal + a move list, not
// per-ply board images. Each position is produced by replaying the moves through
// the real banqi kernel (createInitialBanqiState(id, deal) + applyBanqiMove) and
// rendered on demand by the live banqi board renderer. Face-down tiles show as
// backs and flip to their dealt piece the first time they are turned over,
// exactly as in play.

import {
  applyBanqiMove,
  type BanqiGameState,
  type BanqiMove,
  type BanqiPlayerView,
  type BanqiSquare,
  createInitialBanqiState,
  getBanqiPlayerView,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import {
  BANQI_BOARD_H,
  BANQI_BOARD_W,
  BANQI_CELL,
  banqiBoardGrid,
  banqiPiece,
  xqSvg,
} from './articles/diagrams.js';
import type { BanqiReplaySpec } from './articles/types.js';
import { glideSvgPiece, pieceAnimationDurationMs } from './board-anim.js';

type BanqiReplayCopy = {
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
  red: string;
  black: string;
  flips: string;
};

const BANQI_REPLAY_COPY: Record<ArticleLang | 'en', BanqiReplayCopy> = {
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
      'Step through the game. Red moves first; a tile flips to its dealt piece the first time it is turned over.',
    movePrefix: (moveNumber) => `Move ${moveNumber}`,
    red: 'Red',
    black: 'Black',
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
    intro: '逐步回放这盘棋。红方先走；棋子第一次翻开时会显示其发到的身份。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    red: '红方',
    black: '黑方',
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
    intro: '逐步回放這盤棋。紅方先走；棋子第一次翻開時會顯示其發到的身分。',
    movePrefix: (moveNumber) => `第 ${moveNumber} 回合`,
    red: '紅方',
    black: '黑方',
    flips: '翻開',
  },
};

// Render a banqi position in the rules-page DIAGRAM style — the xq-diagram-bg
// board, 50px cells, solid-colour glyph pieces, and "back" face-down tiles,
// shared with the other banqi diagrams — rather than the larger live-game board,
// so the sample game matches the surrounding figures.
function renderBanqiBoardDiagram(view: BanqiPlayerView): string {
  const parts = [banqiBoardGrid(0, 0)];
  for (const [square, entry] of Object.entries(view.board)) {
    if (!entry) continue;
    // 'a1'..'h4' → col = file (a=0); row = 4 − rank (rank 4 sits on top).
    const col = square.charCodeAt(0) - 97;
    const row = 4 - Number(square[1]);
    const piece = entry.faceDown
      ? banqiPiece({ shrouded: true }, col, row, 0, 0)
      : banqiPiece({ color: entry.color, role: entry.role }, col, row, 0, 0);
    // A keyed slot per piece so a one-ply step can find the mover and glide it.
    parts.push(`<g class="banqi-piece-slot" data-piece-square="${square}">${piece}</g>`);
  }
  return xqSvg(BANQI_BOARD_W, BANQI_BOARD_H, parts.join(''));
}

/** 'a1'..'h4' to the diagram's cell: col = file, row = 4 - rank. */
function diagramCell(square: BanqiSquare): { col: number; row: number } {
  return { col: square.charCodeAt(0) - 97, row: 4 - Number(square[1]) };
}

/**
 * Glide the piece of a one-ply step, after the repaint that drew the final
 * position: forward slides the piece on `move.to` in from `move.from`, a back
 * step slides the piece on `move.from` home from `move.to`. A flip stays put.
 */
function glideDiagramMove(frame: HTMLElement, move: BanqiMove, reverse: boolean): void {
  if (move.from === move.to) return;
  const duration = pieceAnimationDurationMs();
  if (duration <= 0) return;
  const settle = reverse ? move.from : move.to;
  const origin = reverse ? move.to : move.from;
  const slot = frame.querySelector(`[data-piece-square="${settle}"]`);
  if (!slot) return;
  const o = diagramCell(origin);
  const t = diagramCell(settle);
  glideSvgPiece(slot, (o.col - t.col) * BANQI_CELL, (o.row - t.row) * BANQI_CELL, duration);
}

export type BanqiReplayController = { destroy(): void };

const SQUARE_MOVE = /^([a-h][1-4])([a-h][1-4])$/;

function tokenToMove(tok: string): BanqiMove | null {
  const m = SQUARE_MOVE.exec(tok);
  if (!m) return null;
  return { from: m[1] as BanqiSquare, to: m[2] as BanqiSquare };
}

export function mountBanqiReplay(
  host: HTMLElement,
  spec: BanqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): BanqiReplayController {
  const copy = BANQI_REPLAY_COPY[options.lang ?? 'en'];
  const perspective = spec.perspective ?? 'red';
  const moves = spec.moves
    .trim()
    .split(/\s+/)
    .map(tokenToMove)
    .filter((m): m is BanqiMove => m !== null);

  // Replay once; cache every position so stepping is instant.
  const states: BanqiGameState[] = [createInitialBanqiState('banqi-replay', spec.deal)];
  for (const move of moves) {
    states.push(applyBanqiMove(states[states.length - 1]!, move));
  }
  const total = moves.length;

  host.classList.add('banqi-replay', 'stepper');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  const headerPlayers = document.createElement('div');
  // Banqi has no fixed sides — the seats are first/second to move, and the
  // opening flip decides each player's colour. So label the matchup by sequence,
  // not by ink (which the board shows as the game plays out).
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
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-banqi';

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
    frame.innerHTML = renderBanqiBoardDiagram(getBanqiPlayerView(states[index]!, perspective));
    if (animateFrom !== undefined && Math.abs(index - animateFrom) === 1) {
      const forward = index > animateFrom;
      const move = moves[(forward ? index : animateFrom) - 1];
      if (move) glideDiagramMove(frame, move, !forward);
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
      host.classList.remove('banqi-replay', 'stepper');
    },
  };
}
