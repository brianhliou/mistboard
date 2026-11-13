// Lightweight client-side Duck Xiangqi replay for the rules article: one 9x10
// board stepped through a compact turn list by replaying the real rules kernel.
// The board renders through the LIVE renderer (duckXiangqiBoardSvg), so the
// replay tracks the reader's xiangqi board theme and piece set, and the duck is
// the same drawing they meet in a game.
//
// A turn here is a piece move AND a duck placement, so a token carries both:
// `b1c3@c8`. The duck half is dropped on the one turn that has none, the
// general capture that ends the game (`b1d1`). That is the same spelling the
// analysis board's tree uses, which is what lets a game be pasted between the
// two surfaces without translation.

import {
  applyDuckXiangqiTurn,
  createInitialDuckXiangqiState,
  type DuckXiangqiColor,
  type DuckXiangqiGameState,
  type DuckXiangqiSquare,
  type DuckXiangqiTurn,
  getDuckXiangqiLegalTurns,
  getDuckXiangqiPlayerView,
  oppositeDuckXiangqiColor,
} from '@mistboard/game';
import type { ArticleLang } from './article-i18n.js';
import { animateDuckXiangqiTurn, duckXiangqiBoardSvg } from './duck-xiangqi-board.js';
import { duckXiangqiTurnLabel } from './duck-xiangqi-turn-label.js';
import { BEST_STYLE, bestMoveArrow } from './review/engine/engine-arrows.js';
import { moveGlyphTone } from './review/move-glyph.js';
import {
  type ChapterShape,
  type ChapterSideline,
  GLYPH_SUFFIX_CLASS,
} from './study-chapter-annotations.js';
import type { XiangqiBoardArrow, XiangqiBoardMarker } from './xiangqi-board.js';
import './board-glyph-marker.css';
import './live-xiangqi.css';
import './variant-tenant/board-annotations.css';
import { replayStepperCopy } from './replay-stepper-copy.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';

export type DuckXiangqiReplaySpec = {
  /**
   * Space-separated turn tokens, `<from><to>@<duckTo>`, for example
   * "b1c3@c8". The `@<duckTo>` is omitted only on a general capture, which
   * ends the game before the duck moves.
   */
  moves: string;
  red: string;
  black: string;
  event: string;
  perspective?: DuckXiangqiColor;
  resultText: string;
  /** Study annotations by 1-based mainline ply: a move glyph (?!, ??) and a
   *  comment, listed under the move the way the jieqi board lists them. */
  glyphs?: Readonly<Record<number, string>>;
  notes?: Readonly<Record<number, string>>;
  /** First sideline from the position before each 1-based mainline ply. */
  lines?: Readonly<Record<number, ChapterSideline>>;
  /** Position verdicts in the move list's eval slot. */
  assessments?: Readonly<Record<number, string>>;
  /** Drawn on the position after this many mainline turns (0 = root). */
  shapes?: Readonly<Record<number, ChapterShape[]>>;
};

export type DuckXiangqiReplayController = { destroy: () => void };

const SQUARE = /^[a-i](?:10|[1-9])$/;

function tokenize(moves: string): string[] {
  return moves
    .trim()
    .split(/\s+/)
    .map((raw) => raw.replace(/^\d+\./, '').replace(/[,.]+$/g, ''))
    .filter(Boolean);
}

/**
 * Resolve a token against the kernel's own legal turns rather than parsing it
 * into a turn object.
 *
 * Deliberate: the kernel is the only thing that knows whether a general capture
 * carries a duck placement, and matching against its answer means a malformed
 * token fails loudly here instead of producing a turn that replays into a
 * quietly wrong position. `applyDuckXiangqiTurn` returns the state UNCHANGED for
 * an illegal turn, so a bad move list would otherwise render as a board that
 * stops moving half way through the game.
 */
function turnForToken(state: DuckXiangqiGameState, token: string, ply: number): DuckXiangqiTurn {
  const [piece, duckTo] = token.split('@');
  const from = piece?.slice(0, piece.length - (piece.endsWith('10') ? 3 : 2));
  const to = piece?.slice(from?.length ?? 0);
  if (!from || !to || !SQUARE.test(from) || !SQUARE.test(to)) {
    throw new Error(`duck xiangqi replay: bad token "${token}" at ply ${ply + 1}`);
  }
  const legal = getDuckXiangqiLegalTurns(state);
  const hit = legal.find(
    (t) =>
      t.from === (from as DuckXiangqiSquare) &&
      t.to === (to as DuckXiangqiSquare) &&
      (duckTo === undefined ? t.duckTo === null : t.duckTo === (duckTo as DuckXiangqiSquare)),
  );
  if (!hit) throw new Error(`duck xiangqi replay: illegal turn "${token}" at ply ${ply + 1}`);
  return hit;
}

export function replayDuckXiangqiNotation(moves: string): {
  turns: DuckXiangqiTurn[];
  states: DuckXiangqiGameState[];
} {
  const tokens = tokenize(moves);
  let state = createInitialDuckXiangqiState('article-replay');
  const states: DuckXiangqiGameState[] = [state];
  const turns: DuckXiangqiTurn[] = [];
  tokens.forEach((token, ply) => {
    const turn = turnForToken(state, token, ply);
    state = applyDuckXiangqiTurn(state, turn);
    turns.push(turn);
    states.push(state);
  });
  return { turns, states };
}

export function mountDuckXiangqiReplay(
  host: HTMLElement,
  spec: DuckXiangqiReplaySpec,
  options: { lang?: ArticleLang } = {},
): DuckXiangqiReplayController {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  const perspective = spec.perspective ?? 'red';
  const { turns, states } = replayDuckXiangqiNotation(spec.moves);
  const total = turns.length;

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
  // Own class because this widget renders the LIVE board, not an
  // `xq-article-svg`, so the per-article width overrides in articles.css that
  // size the other xq replays cannot reach it.
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
  function render(from?: number): void {
    const state = states[index]!;
    const view = getDuckXiangqiPlayerView(state, perspective);
    // A replay is never interactive and has no phase of its own: the board is
    // always showing a finished turn, both halves applied.
    board.innerHTML = duckXiangqiBoardSvg(view, perspective, {
      interactive: false,
      phase: { kind: 'piece', selected: null },
      targets: [],
    });
    animateDuckStep(board, states, from, index, perspective);
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
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${duckXiangqiTurnLabel(turns[index - 1]!)}`;
    }
  }

  const repaint = (): void => render();
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
  window.addEventListener(xiangqiAppearanceChangedEvent, repaint);

  render();

  return {
    destroy(): void {
      first.removeEventListener('click', onFirst);
      prev.removeEventListener('click', onPrev);
      next.removeEventListener('click', onNext);
      last.removeEventListener('click', onLast);
      slider.removeEventListener('input', onSlider);
      host.removeEventListener('keydown', onKey);
      window.removeEventListener(xiangqiAppearanceChangedEvent, repaint);
      host.replaceChildren();
      host.classList.remove('xq-replay', 'stepper', 'notranslate');
      host.removeAttribute('translate');
    },
  };
}

// Unused by the article, but the same shape the other replays export so a
// caller can rebuild the record without mounting anything.
export type DuckXiangqiReplayRecord = ReturnType<typeof replayDuckXiangqiNotation>;

export function oppositeReplayColor(color: DuckXiangqiColor): DuckXiangqiColor {
  return oppositeDuckXiangqiColor(color);
}

/** The BOARD half of a duck replay, driven by whatever chrome hosts it.
 *
 *  `mountDuckXiangqiReplay` above is the article widget: it owns its header,
 *  its stepper and its slider. The embed card (embed/embed-card.ts) supplies
 *  all of that itself and wants only a board plus a handle, which is the
 *  contract `XiangqiReplayBoardHandle` describes. Without this, the study
 *  embed had no way to draw a duck game and fell back to the xiangqi board,
 *  which cannot render the duck at all.
 *
 *  Deliberately the same shape as `mountXiangqiReplayBoard`, so one card can
 *  drive either without knowing which variant it is holding.
 */
export function mountDuckXiangqiReplayBoard(
  host: HTMLElement,
  spec: DuckXiangqiReplaySpec,
  hooks: { onPlyChange?: (ply: number, maxPly: number) => void } = {},
): {
  destroy: () => void;
  jumpToPly: (ply: number) => void;
  jumpToLine: (atPly: number, cursor: number) => void;
  plyCount: () => number;
  moveEntries: () => Array<{
    ply: number;
    label: string;
    suffix?: string;
    suffixClass?: string;
    note?: string;
    assessment?: string;
    line?: ChapterSideline;
  }>;
  bottomSeat: () => 'first' | 'second';
} {
  const perspective = spec.perspective ?? 'red';
  const { turns, states } = replayDuckXiangqiNotation(spec.moves);
  const total = turns.length;
  // A variation replaces its marked mainline move. Replaying from that move's
  // BEFORE state is essential: both the piece move and duck placement matter.
  const lines = new Map<number, DuckXiangqiReplayRecord>();
  for (const [key, side] of Object.entries(spec.lines ?? {})) {
    const ply = Number(key);
    const start = states[ply - 1];
    if (!start || ply > total) continue;
    const replayed: DuckXiangqiReplayRecord = { turns: [], states: [start] };
    for (const token of side.moves) {
      const before = replayed.states[replayed.states.length - 1]!;
      let turn: DuckXiangqiTurn;
      try {
        turn = turnForToken(before, token, ply - 1 + replayed.turns.length);
      } catch {
        // A malformed or illegal token ends a stored line at its last real
        // position, as on the jieqi embed. Never show a silently wrong board.
        break;
      }
      replayed.turns.push(turn);
      replayed.states.push(applyDuckXiangqiTurn(before, turn));
    }
    if (replayed.turns.length) lines.set(ply, replayed);
  }

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-xq';
  host.replaceChildren(frame);

  let index = 0;
  let inLine: { atPly: number; cursor: number } | null = null;
  // `from` is the ply a one-ply step left: the turn between them glides.
  const render = (from?: number): void => {
    const side = inLine ? lines.get(inLine.atPly)! : null;
    const shownStates = side?.states ?? states;
    const cursor = inLine?.cursor ?? index;
    const state = shownStates[cursor]!;
    const arrows: XiangqiBoardArrow[] = [];
    const markers: XiangqiBoardMarker[] = [];
    let ghostDuck: { square: DuckXiangqiSquare; className?: string; color?: string } | undefined;
    if (!inLine) {
      // The same shape mapping and destination badge as the review and jieqi
      // embed, using the shared glyph tone and BEST_STYLE arrow helpers.
      for (const shape of spec.shapes?.[index] ?? []) {
        if (shape.dest && shape.dest !== shape.orig) {
          arrows.push({
            from: shape.orig as DuckXiangqiSquare,
            to: shape.dest as DuckXiangqiSquare,
            className: `xq-arrow--draw xq-shape--${shape.brush}`,
          });
        } else {
          markers.push({
            square: shape.orig as DuckXiangqiSquare,
            kind: 'circle',
            className: `xq-shape--${shape.brush}`,
          });
        }
      }
      const last = turns[index - 1];
      const glyph = spec.glyphs?.[index];
      const tone = glyph ? moveGlyphTone(glyph, GLYPH_SUFFIX_CLASS[glyph]) : null;
      if (last && glyph && tone) {
        markers.push({
          square: last.to,
          kind: 'glyph',
          text: glyph,
          className: `xq-marker--${tone}`,
        });
      }
      const alternative = lines.get(index + 1)?.turns[0];
      if (alternative) {
        // Keep the chapter's brush when it already draws this alternative;
        // otherwise show the engine's usual best-move arrow. Its duck square
        // is available only on the turn token, never on the stored shape.
        let arrow = arrows.find((a) => a.from === alternative.from && a.to === alternative.to);
        if (arrow) Object.assign(arrow, BEST_STYLE);
        else {
          arrow = bestMoveArrow(`${alternative.from}${alternative.to}`)[0]!;
          arrows.push(arrow);
        }
        if (alternative.duckTo) {
          ghostDuck = {
            square: alternative.duckTo,
            className: arrow.className,
            color: arrow.color,
          };
        }
      }
    }
    frame.innerHTML = duckXiangqiBoardSvg(
      getDuckXiangqiPlayerView(state, perspective),
      perspective,
      {
        interactive: false,
        phase: { kind: 'piece', selected: null },
        targets: [],
        arrows,
        markers,
        ghostDuck,
      },
    );
    animateDuckStep(frame, shownStates, from, cursor, perspective);
    if (!inLine) hooks.onPlyChange?.(index, total);
  };
  render();

  return {
    destroy: () => host.replaceChildren(),
    jumpToPly: (ply: number) => {
      const from = inLine ? undefined : index;
      inLine = null;
      index = Math.max(0, Math.min(total, Math.trunc(ply)));
      render(from);
    },
    jumpToLine: (atPly: number, cursor: number) => {
      const side = lines.get(atPly);
      if (!side) return;
      const from = inLine?.atPly === atPly ? inLine.cursor : undefined;
      inLine = { atPly, cursor: Math.max(1, Math.min(side.turns.length, Math.trunc(cursor))) };
      render(from);
    },
    plyCount: () => total,
    moveEntries: () =>
      turns.map((turn, i) => {
        const glyph = spec.glyphs?.[i + 1];
        const note = spec.notes?.[i + 1];
        const assessment = spec.assessments?.[i + 1];
        const side = lines.get(i + 1);
        const meta = spec.lines?.[i + 1];
        return {
          ply: i + 1,
          label: duckXiangqiTurnLabel(turn),
          ...(glyph ? { suffix: glyph, suffixClass: GLYPH_SUFFIX_CLASS[glyph] } : {}),
          ...(note ? { note } : {}),
          ...(assessment ? { assessment } : {}),
          ...(side
            ? {
                line: {
                  moves: side.turns.map(duckXiangqiTurnLabel),
                  ...(meta?.verdict ? { verdict: meta.verdict } : {}),
                  ...(meta?.note ? { note: meta.note } : {}),
                },
              }
            : {}),
        };
      }),
    // Red is the first mover in xiangqi, so a red-perspective board puts the
    // first mover at the bottom.
    bottomSeat: () => (perspective === 'red' ? 'first' : 'second'),
  };
}

/** A one-ply step glides the turn between `from` and `to`; a jump, the first
 *  render and an appearance repaint cut. */
function animateDuckStep(
  board: HTMLElement,
  states: readonly DuckXiangqiGameState[],
  from: number | undefined,
  to: number,
  perspective: DuckXiangqiColor,
): void {
  if (from === undefined || Math.abs(to - from) !== 1) return;
  const before = states[Math.min(from, to)];
  const after = states[Math.max(from, to)];
  if (!before || !after) return;
  animateDuckXiangqiTurn(
    board,
    getDuckXiangqiPlayerView(before, perspective),
    getDuckXiangqiPlayerView(after, perspective),
    perspective,
    { reverse: to < from },
  );
}
