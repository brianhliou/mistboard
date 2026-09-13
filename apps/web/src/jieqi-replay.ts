// Jieqi game replay for the rules article.
//
// Sibling of chess-replay.ts: the spec carries a hidden deal + a move
// list, not per-ply board images. Each position is produced by replaying the moves
// through the real jieqi kernel (createInitialJieqiState(id, deal) + applyJieqiMove)
// and rendered on demand by the live jieqi board renderer. Face-down pieces show as
// backs and flip to their dealt identity on first move, exactly as in play.

import {
  applyJieqiMove,
  createInitialJieqiState,
  getJieqiPlayerView,
  type JieqiColor,
  type JieqiGameState,
  type JieqiMove,
  type JieqiPieceRole,
  type JieqiSquare,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import { installJieqiBoardStyles, renderJieqiBoardSvg } from './live-jieqi-render.js';
import { replayStepperCopy } from './replay-stepper-copy.js';

export type JieqiReplaySpec = {
  red: string;
  black: string;
  event: string;
  // Short result line shown under the players (e.g. "Red wins by checkmate · 36 moves").
  outcome?: string;
  // Shown on the final ply. The kernel reports the real result; this overrides the
  // narrative text there.
  resultText: string;
  // Per-side hidden deal in jieqiHomeSquares order — reveals follow it.
  deal: { red: JieqiPieceRole[]; black: JieqiPieceRole[] };
  // Space-separated concatenated-square moves (e.g. "b1c3 i7i6 c10e8 ..."), files
  // a-i and ranks 1-10, so each token splits into from/to with the square regex.
  moves: string;
  perspective?: JieqiColor;
};

export type JieqiReplayController = { destroy(): void };

const SQUARE_MOVE = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

function tokenToMove(tok: string): JieqiMove | null {
  const m = SQUARE_MOVE.exec(tok);
  if (!m) return null;
  return { from: m[1] as JieqiSquare, to: m[2] as JieqiSquare };
}

export function mountJieqiReplay(
  host: HTMLElement,
  spec: JieqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): JieqiReplayController {
  const copy = replayStepperCopy(options.lang, 'jieqi');
  installJieqiBoardStyles();
  const perspective = spec.perspective ?? 'red';
  const moves = spec.moves
    .trim()
    .split(/\s+/)
    .map(tokenToMove)
    .filter((m): m is JieqiMove => m !== null);

  // Replay once; cache every position so stepping is instant. The no-capture clock
  // is disabled so the full record always plays out to the deciding move.
  const states: JieqiGameState[] = [createInitialJieqiState('jieqi-replay', spec.deal)];
  for (const move of moves) {
    states.push(
      applyJieqiMove(states[states.length - 1]!, move, {
        noCaptureClockLimit: Number.POSITIVE_INFINITY,
      }),
    );
  }
  const total = moves.length;

  host.classList.add('jieqi-replay', 'stepper');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  const headerPlayers = document.createElement('div');
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
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-jieqi';

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
  function render(): void {
    frame.innerHTML = renderJieqiBoardSvg(
      getJieqiPlayerView(states[index]!, perspective),
      perspective,
    );
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
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${mv.from}–${mv.to}`;
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
      host.classList.remove('jieqi-replay', 'stepper');
    },
  };
}
