// Lightweight client-side xiangqi game replay. One board, stepped through a
// move list by replaying through the rules kernel — no per-ply SVG is shipped,
// each position is rendered on demand. Reusable game viewer; first used by the
// Xiangqi Rules article to show a full historical game.

import {
  ARBITER_ADJUDICATED_DRAWS,
  applyMove as applyXiangqiMove,
  createInitialXiangqiState,
  formatXiangqiMoves,
  parseJudgmentComment,
  parseStandardXiangqiFen,
  type XiangqiBoard,
  type XiangqiColor,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiPiece,
  type XiangqiSquare,
} from '@mistboard/game';
import { track } from './analytics.js';
import type { ArticleLang } from './article-i18n.js';
import './board-glyph-marker.css';
import { boardLastMoveMarkersSvg, boardLastMoveOuterRadius } from './board-lastmove.js';
import { tokenPieceSize } from './board-metrics.js';
import { type ReplayStepperCopy, replayStepperCopy } from './replay-stepper-copy.js';
import { readStoredXiangqiPieceSet, xiangqiAppearanceChangedEvent } from './theme.js';
import { drawsCrossedSoldier } from './xiangqi-crossed-soldier.js';
import { currentXiangqiNotationStyle, xiangqiNotationChangedEvent } from './xiangqi-notation.js';
import { renderXiangqiPieceGlyphed } from './xiangqi-piece-sets.js';

// Geometry/colours mirror the static xiangqi diagrams in articles-data.ts so
// the replay board is visually identical to the rules diagrams.
const CELL = 31;
const PIECE = tokenPieceSize(CELL);
// The live board draws its judgment badge at r=13 / offset 21 on a 60px cell.
// Same proportions here so the badge sits in the same place relative to the
// piece; the markup and palette are the shared ones (board-glyph-marker.css).
const GLYPH_RADIUS = (13 / 60) * CELL;
const GLYPH_OFFSET = (21 / 60) * CELL;

/**
 * The margin has to clear everything drawn around a piece on an EDGE
 * intersection, not just the piece. Three things reach past its centre:
 *
 *   the piece itself         PIECE / 2                 14.0 at CELL 31
 *   the last-move ring       outer radius              15.6
 *   the judgment badge       offset + its own radius   17.6
 *
 * A previous version set this to 15 by reasoning only about the piece, which
 * clipped the ring on every edge move and cut the top off a `?!` badge on any
 * piece that reached the back rank. Derived rather than chosen, so adding a
 * fourth decoration that reaches further cannot silently crop it.
 */
const MARGIN = Math.ceil(
  Math.max(PIECE / 2, boardLastMoveOuterRadius(PIECE), GLYPH_OFFSET + GLYPH_RADIUS),
);
const GLYPH_CLASS: Record<string, string> = {
  '??': 'xq-marker--blunder',
  '?': 'xq-marker--mistake',
  '?!': 'xq-marker--inaccuracy',
  '!!': 'xq-marker--brilliant',
  // The shared palette calls this one --good; --great has no fill defined and
  // the badge renders as an empty disc.
  '!': 'xq-marker--good',
};
const PAD = 0;
const BOARD_W = MARGIN * 2 + 8 * CELL;
const BOARD_H = MARGIN * 2 + 9 * CELL;
const RADIUS = 8;

/**
 * Engine annotation for one mainline ply (1-based). Produced by the postgame
 * analysis path and shaped by scripts/annotate-game.mjs, so an article never
 * hand-writes a judgment or a line.
 */
export type XiangqiReplayAnnotation = {
  /**
   * Judgment glyph. The negative classes come from analysis.ts; `!` and `!!`
   * come from the positive classifier (xiangqi-move-classification.ts) and only
   * appear on games run through it.
   */
  glyph?: '??' | '?' | '?!' | '!' | '!!';
  /** Eval AFTER the played move, Red POV, centipawns. */
  cp?: number | null;
  /** Mate distance after the played move, Red POV. */
  mate?: number | null;
  /**
   * What the engine wanted instead, from the position BEFORE this ply, as
   * space-separated ICCS tokens. Steppable: entering it replays the mainline
   * prefix and then this line.
   */
  line?: string;
  /** Optional human note, shown under the line. Prose is ours, never lifted. */
  note?: string;
  /**
   * Assessment at the END of `line`, in the chess-literature symbols (+−, ±, ⩲,
   * =, ⩱, ∓, −+). Deliberately not derived from `cp`: that eval is the
   * position after the move actually PLAYED, one ply deep, while this is the
   * line's destination with best play from both sides. They answer different
   * questions and routinely disagree. Measured by scripts/champions-line-evals.mjs.
   */
  lineEval?: string;
};

export type XiangqiReplayAnnotations = {
  /** Keyed by 1-based mainline ply. */
  byPly: Record<number, XiangqiReplayAnnotation>;
};

export type XiangqiReplaySpec = {
  // Space-separated ICCS coordinate tokens (e.g. "h2e2 h9g7 ..."). ICCS ranks
  // are 0-9 with 0 = Red's back rank; engine ranks are 1-10, so rank + 1.
  iccs: string;
  /**
   * Position the line starts from, as a standard xiangqi FEN. Omitted means the
   * opening, which is right for a game record and wrong for everything else: a
   * study chapter, an endgame, a composed problem. A FEN that does not parse
   * falls back to the opening rather than rendering an empty board, and the
   * caller is expected to have validated it.
   *
   * The side to move comes from the FEN, so a line can begin with Black.
   */
  startFen?: string;
  red: string;
  black: string;
  event: string;
  // Optional standalone title, used when the record is a named study or manual
  // line rather than a game between two players. When set, the header reads
  // "<title> · <event>" instead of "<red> (Red) vs <black> (Black) · <event>".
  title?: string;
  perspective?: XiangqiColor;
  // Shown on the final ply (the records stop at the mating move, so the rules
  // kernel still reports "playing"; the result is supplied explicitly).
  resultText: string;
  /**
   * Optional engine annotations. Absent means this renders exactly as it always
   * has: a bare mainline stepper. Present adds a clickable move list with
   * judgment glyphs and steppable engine lines.
   */
  annotations?: XiangqiReplayAnnotations;
};

export type XiangqiReplayController = { destroy: () => void };

function pointXY(file: number, rank: number, perspective: XiangqiColor): { x: number; y: number } {
  const row = perspective === 'red' ? 10 - rank : rank - 1;
  return { x: MARGIN + file * CELL, y: MARGIN + row * CELL };
}

function coord(square: XiangqiSquare): { file: number; rank: number } {
  return { file: 'abcdefghi'.indexOf(square[0]!), rank: Number(square.slice(1)) };
}

function gridSvg(perspective: XiangqiColor): string {
  const parts: string[] = [
    `<rect x="0" y="0" width="${BOARD_W}" height="${BOARD_H}" rx="${RADIUS}" class="xq-diagram-bg"/>`,
  ];
  const left = MARGIN;
  const right = left + 8 * CELL;
  const top = MARGIN;
  const bottom = top + 9 * CELL;
  const riverTop = top + 4 * CELL;
  const riverBottom = top + 5 * CELL;
  for (let r = 0; r < 10; r += 1) {
    const y = top + r * CELL;
    parts.push(
      `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="xq-diagram-line" stroke-width="1"/>`,
    );
  }
  for (let f = 0; f < 9; f += 1) {
    const x = left + f * CELL;
    if (f === 0 || f === 8) {
      parts.push(
        `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`,
      );
    } else {
      parts.push(
        `<line x1="${x}" y1="${top}" x2="${x}" y2="${riverTop}" class="xq-diagram-line" stroke-width="1"/>`,
      );
      parts.push(
        `<line x1="${x}" y1="${riverBottom}" x2="${x}" y2="${bottom}" class="xq-diagram-line" stroke-width="1"/>`,
      );
    }
  }
  for (const palace of [
    { fileMin: 3, fileMax: 5, rankBack: 1 },
    { fileMin: 3, fileMax: 5, rankBack: 8 },
  ]) {
    const topRank = palace.rankBack === 1 ? 3 : 10;
    const bottomRank = palace.rankBack;
    const a = pointXY(palace.fileMin, topRank, perspective);
    const b = pointXY(palace.fileMax, bottomRank, perspective);
    const c = pointXY(palace.fileMax, topRank, perspective);
    const d = pointXY(palace.fileMin, bottomRank, perspective);
    parts.push(
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" class="xq-diagram-line" stroke-width="1"/>`,
    );
    parts.push(
      `<line x1="${c.x}" y1="${c.y}" x2="${d.x}" y2="${d.y}" class="xq-diagram-line" stroke-width="1"/>`,
    );
  }
  parts.push(
    `<text x="${left + 4 * CELL}" y="${(riverTop + riverBottom) / 2 + 1}" font-family="serif" font-size="16" class="xq-diagram-ink xq-diagram-river-label" text-anchor="middle" dominant-baseline="central">楚 河   漢 界</text>`,
  );
  return parts.join('');
}

function piecesSvg(board: XiangqiBoard, perspective: XiangqiColor): string {
  return Object.entries(board)
    .map(([sq, piece]) => {
      if (!piece) return '';
      const { file, rank } = coord(sq as XiangqiSquare);
      const { x, y } = pointXY(file, rank, perspective);
      return renderXiangqiPieceGlyphed(piece as XiangqiPiece, readStoredXiangqiPieceSet(), {
        x: x - PIECE / 2,
        y: y - PIECE / 2,
        size: PIECE,
        crossed: drawsCrossedSoldier(piece as XiangqiPiece, rank),
      });
    })
    .join('');
}

function boardSvg(
  board: XiangqiBoard,
  lastMove: XiangqiMove | undefined,
  perspective: XiangqiColor,
  _key: number,
  glyph?: string,
): string {
  const pw = BOARD_W + PAD * 2;
  const ph = BOARD_H + PAD * 2;
  // The site marks a last move with an origin wash and a destination ring
  // (board-lastmove.ts, shared by every live board). This widget used to draw
  // its own green arrow, which made an article embed look like a different
  // product from the game page. The markers sit under the pieces, so only the
  // halo outside the piece radius shows.
  const body = [
    gridSvg(perspective),
    lastMove ? lastMoveSvg(lastMove, perspective) : '',
    piecesSvg(board, perspective),
    // Over the pieces: the badge annotates the piece that just arrived, so it
    // has to sit on top of it rather than under.
    lastMove && glyph ? glyphMarkerSvg(lastMove, glyph, perspective) : '',
  ].join('');
  return `<svg class="xq-article-svg" data-xq-layout="single" style="--xq-svg-width: ${pw}px" viewBox="0 0 ${pw} ${ph}" role="img" xmlns="http://www.w3.org/2000/svg"><g transform="translate(${PAD} ${PAD})">${body}</g></svg>`;
}

function lastMoveSvg(move: XiangqiMove, perspective: XiangqiColor): string {
  const from = coord(move.from);
  const to = coord(move.to);
  return boardLastMoveMarkersSvg(
    {
      from: pointXY(from.file, from.rank, perspective),
      to: pointXY(to.file, to.rank, perspective),
    },
    PIECE,
  );
}

/** The judgment badge, pinned to the destination of the move just played. */
function glyphMarkerSvg(move: XiangqiMove, glyph: string, perspective: XiangqiColor): string {
  const kind = GLYPH_CLASS[glyph];
  if (!kind) return '';
  const to = coord(move.to);
  const at = pointXY(to.file, to.rank, perspective);
  // Screen-space offset, so the badge keeps the same corner when the board flips.
  const cx = at.x + GLYPH_OFFSET;
  const cy = at.y - GLYPH_OFFSET;
  return (
    `<g class="xq-marker xq-marker--glyph ${kind}">` +
    `<circle class="xq-marker__disc" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${GLYPH_RADIUS.toFixed(1)}"/>` +
    `<text class="xq-marker__label" x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" ` +
    `dominant-baseline="central" font-size="${(GLYPH_RADIUS * 1.15).toFixed(1)}">${glyph}</text>` +
    '</g>'
  );
}

function iccsToMove(tok: string): XiangqiMove {
  const conv = (c: string) => `${c[0]}${Number(c[1]) + 1}` as XiangqiSquare;
  return { from: conv(tok.slice(0, 2)), to: conv(tok.slice(2, 4)) };
}

export type XiangqiReplayMountOptions = {
  lang?: ArticleLang;
  /**
   * Where the result line sits. `end` (the default, the article widget's
   * choice) is the last item in the move scroller: the result belongs at the
   * end of the game and reaching it means scrolling there. `pinned` keeps it
   * under the list at all times, the way the game card's "Red wins" foot does,
   * for a host that frames the widget as one game among others (the embed).
   */
  resultPlacement?: 'end' | 'pinned';
};

/** "Red wins" for a PGN-style result tag; nothing for an unfinished `*`; the
 *  tag itself for a spelling this does not know. */
export function xiangqiResultLabel(resultText: string, copy: ReplayStepperCopy): string {
  const tag = resultText.trim();
  if (tag === '*' || tag === '') return '';
  if (tag === '1-0') return copy.wins(copy.first);
  if (tag === '0-1') return copy.wins(copy.second);
  if (tag === '1/2-1/2' || tag === '½-½') return copy.draw;
  return tag;
}

export function mountXiangqiReplay(
  host: HTMLElement,
  spec: XiangqiReplaySpec,
  options: XiangqiReplayMountOptions = {},
): XiangqiReplayController {
  const copy = replayStepperCopy(options.lang, 'xiangqi');
  let perspective: XiangqiColor = spec.perspective ?? 'red';
  const moves = spec.iccs
    .trim()
    .split(/\s+/)
    .filter((t) => /^[a-i]\d[a-i]\d$/.test(t))
    .map(iccsToMove);

  // Replay once; cache every position so stepping is instant.
  //
  // Resuming past an arbiter-adjudicated draw is what makes a tournament record
  // replayable at all. Xiangqi's repetition and progress-clock draws are claimed
  // by a player or called by an arbiter, not automatic, so records run straight
  // past them: a 2015 world championship game shuffled a horse and a cannon for
  // eight plies, our kernel called the threefold at ply 200, and every position
  // after that froze. The notation under the board stayed right, because
  // formatXiangqiMoves already resumes; the board did not, so half the engine
  // lines pointed at a position that no longer moved.
  //
  // Only the two reasons a human decides, from the kernel's own set. Checkmate
  // and stalemate stay terminal, because no ruleset plays on through those.
  const parsedStart = spec.startFen ? parseStandardXiangqiFen(spec.startFen, 'xq-replay') : null;
  const startState: XiangqiGameState =
    parsedStart?.ok === true ? parsedStart.state : createInitialXiangqiState('xq-replay');
  // Red opens a game, but not a chapter set from a FEN. Every ply-parity
  // decision below counts from here rather than assuming Red is odd: the move
  // numbers, the Red/Black columns, and the two adjudicated-draw resumes.
  const firstMover: XiangqiColor =
    startState.status.type === 'playing' ? startState.status.turn : 'red';
  const secondMover: XiangqiColor = firstMover === 'red' ? 'black' : 'red';
  // A black-first line is numbered "1... , 2. , 2... , 3.", so the pairing is
  // shifted by one half-move.
  const plyOffset = firstMover === 'red' ? 0 : 1;

  const states: XiangqiGameState[] = [startState];
  for (const [index, move] of moves.entries()) {
    let state = states[states.length - 1]!;
    if (state.status.type === 'finished' && ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)) {
      state = {
        ...state,
        status: { type: 'playing', turn: index % 2 === 0 ? firstMover : secondMover },
      };
    }
    states.push(applyXiangqiMove(state, move));
  }
  const total = moves.length;

  host.classList.add('xq-replay', 'stepper');
  host.tabIndex = 0;

  const header = document.createElement('div');
  header.className = 'xq-replay-header';
  header.textContent = spec.title
    ? `${spec.title} · ${spec.event}`
    : `${spec.red}${copy.firstRole} vs ${spec.black}${copy.secondRole} · ${spec.event}`;

  const frame = document.createElement('div');
  frame.className = 'raw-svg-stepper-frame raw-svg-stepper-frame-xq';

  const controls = document.createElement('div');
  controls.className = 'stepper-controls';
  // Drawn, not typed. The media glyphs (U+23EE/U+23ED) and the arrows
  // (U+2190/U+2192) resolve from different fallback fonts, so as text they
  // never match in weight or optical size, and on some platforms the media
  // pair renders as a colour emoji.
  const ICON: Record<'first' | 'prev' | 'next' | 'last', string> = {
    first: '<rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/>',
    prev: '<path d="M11 4.3v7.4L4.9 8z"/>',
    next: '<path d="M5 4.3v7.4L11.1 8z"/>',
    last: '<rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/>',
  };
  const mkButton = (icon: keyof typeof ICON, aria: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stepper-button';
    b.setAttribute('aria-label', aria);
    b.innerHTML =
      `<svg class="stepper-icon" viewBox="0 0 16 16" width="16" height="16" ` +
      `aria-hidden="true" focusable="false" fill="currentColor">${ICON[icon]}</svg>`;
    return b;
  };
  const first = mkButton('first', copy.firstMove);
  const prev = mkButton('prev', copy.previousMove);
  prev.classList.add('stepper-button-prev');

  // A three-control bar: back, a menu, forward. Jump-to-start and jump-to-end
  // are rare next to stepping, so they move into the menu rather than taking a
  // quarter of the bar each; nothing is lost, and the two controls a reader
  // actually uses get twice the target.
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'stepper-button stepper-button-menu';
  menuButton.setAttribute('aria-haspopup', 'true');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', 'More');
  menuButton.innerHTML =
    '<svg class="stepper-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ' +
    'focusable="false" fill="currentColor"><circle cx="8" cy="3.2" r="1.5"/>' +
    '<circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="12.8" r="1.5"/></svg>';

  const menu = document.createElement('div');
  menu.className = 'xq-replay-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');

  const menuItem = (label: string, onSelect: () => void) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'xq-replay-menu-item';
    item.setAttribute('role', 'menuitem');
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenu();
      onSelect();
    });
    menu.append(item);
    return item;
  };

  function closeMenu(): void {
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
  }
  function toggleMenu(): void {
    const open = menu.hidden;
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) menu.querySelector<HTMLElement>('.xq-replay-menu-item')?.focus();
  }
  menuButton.addEventListener('click', toggleMenu);
  const counter = document.createElement('span');
  counter.className = 'stepper-counter';
  const next = mkButton('next', copy.nextMove);
  next.classList.add('stepper-button-next');
  const last = mkButton('last', copy.lastMove);
  if (spec.annotations) controls.append(prev, menuButton, next);
  else controls.append(first, prev, counter, next, last);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'xq-replay-slider';
  slider.min = '0';
  slider.max = String(total);
  slider.step = '1';
  slider.setAttribute('aria-label', copy.sliderLabel);

  const narrative = document.createElement('div');
  narrative.className = 'stepper-narrative';

  // The annotated surface is additive: without annotations this renders exactly
  // as it always has, and none of the following nodes are attached.
  const annotated = spec.annotations;
  const moveList = document.createElement('ol');
  moveList.className = 'xq-replay-moves';

  const resultFoot = document.createElement('div');
  resultFoot.className = 'xq-replay-result';

  if (annotated) {
    // Study layout, built as ONE card rather than a board next to a bordered
    // box: seat bars top and bottom of the board the way a game page shows
    // them, the move tree flush against it behind a divider, and a single
    // control bar across the bottom. The plain stepper keeps its untouched
    // single-column stack.
    host.classList.add('xq-replay-annotated');

    // The names live in the seat bars now, so the line above the card carries
    // only the event; repeating the players there read as a caption on a card
    // that already names them.
    header.textContent = spec.title ? `${spec.title} · ${spec.event}` : spec.event;

    const seat = (name: string, side: 'red' | 'black') => {
      const el = document.createElement('div');
      el.className = `xq-replay-seat xq-replay-seat--${side}`;
      const dot = document.createElement('span');
      dot.className = 'xq-replay-seat-dot';
      const label = document.createElement('span');
      label.className = 'xq-replay-seat-name';
      label.textContent = name;
      // No RED/BLACK text: the dot already says it, and so does the board two
      // pixels below. The word was a third statement of the same fact.
      el.append(dot, label);
      return el;
    };
    // Bottom seat is whoever the board is oriented for; the other sits on top.
    const bottomSide = perspective === 'black' ? 'black' : 'red';
    const topSide = bottomSide === 'red' ? 'black' : 'red';
    const nameOf = (side: 'red' | 'black') => (side === 'red' ? spec.red : spec.black);

    const boardCol = document.createElement('div');
    boardCol.className = 'xq-replay-board-col';
    // No scrubber and no ply counter here: the move list is the position
    // indicator and it is clickable, so both were a second, worse copy of it.
    counter.remove();
    controls.classList.add('stepper-controls-compact');
    const controlWrap = document.createElement('div');
    controlWrap.className = 'xq-replay-controls-wrap';
    controlWrap.append(controls, menu);
    const seatTop = seat(nameOf(topSide), topSide);
    const seatBottom = seat(nameOf(bottomSide), bottomSide);
    boardCol.append(seatTop, frame, seatBottom, controlWrap);

    // Registered here, where the column's parts are in scope. The callbacks run
    // later, and goto/render are hoisted function declarations, so referring to
    // them before their definitions is fine.
    let flipped = false;
    menuItem('Flip the board', () => {
      perspective = perspective === 'red' ? 'black' : 'red';
      flipped = !flipped;
      // An explicit re-order of the whole column. Shuffling two nodes around
      // each other left the control bar above the board.
      boardCol.replaceChildren(
        flipped ? seatBottom : seatTop,
        frame,
        flipped ? seatTop : seatBottom,
        controlWrap,
      );
      render();
    });
    menuItem('Back to the start', () => gotoMainline(0));
    menuItem('Jump to the end', () => gotoMainline(total));
    const moveCol = document.createElement('div');
    moveCol.className = 'xq-replay-move-col';
    // The move panel is taken out of flow (see the CSS) so a 180-ply list
    // cannot set the card's height; the board column does. This wrapper is what
    // gets positioned, so the list, the engine line, and the result still stack
    // normally inside it.
    const moveInner = document.createElement('div');
    moveInner.className = 'xq-replay-move-inner';
    moveInner.append(moveList);
    if (options.resultPlacement === 'pinned') {
      resultFoot.classList.add('xq-replay-result--pinned');
      moveInner.append(resultFoot);
    }
    moveCol.append(moveInner);
    const grid = document.createElement('div');
    grid.className = 'xq-replay-grid';
    grid.append(boardCol, moveCol);
    host.append(header, grid);
  } else {
    host.append(header, frame, controls, slider, narrative);
  }

  let index = 0;
  /**
   * When set, the board is showing the engine's line instead of the game: the
   * mainline up to `atPly - 1`, then `moves` up to `cursor`. Mainline `index`
   * is left untouched so leaving a variation lands exactly where it started.
   */
  let variation: { atPly: number; moves: XiangqiMove[]; cursor: number } | null = null;

  function annotationAt(ply: number): XiangqiReplayAnnotation | undefined {
    return annotated?.byPly[ply];
  }

  // WXF is the notation English xiangqi material actually uses, and it is short
  // enough for a move column. formatXiangqiMoves replays from the line's own
  // start, so a variation is formatted as prefix+line with the prefix sliced
  // back off — no mid-game state to thread, and an illegal line cannot be
  // notated into something that looks real. Passing the start position is what
  // keeps an endgame chapter in real notation: from the opening, its first move
  // is illegal and every label silently degrades to coordinates.
  // Move labels follow the reader's notation setting, the same preference the
  // review pages use. Recomputed (not cached across changes) because the
  // variation labels are derived from the mainline prefix and would otherwise
  // keep the old style after a switch.
  let mainlineLabels: string[] = [];
  let variationLabels = new Map<number, string[]>();

  function relabel(): void {
    mainlineLabels = annotated
      ? formatXiangqiMoves(moves, currentXiangqiNotationStyle(), startState)
      : [];
    variationLabels = new Map<number, string[]>();
  }

  function parseLine(ply: number): XiangqiMove[] {
    const raw = annotationAt(ply)?.line;
    if (!raw) return [];
    const parsed = raw
      .trim()
      .split(/\s+/)
      .filter((t) => /^[a-i]\d[a-i]\d$/.test(t))
      .map(iccsToMove);
    // Truncate at the first move the rules reject rather than carrying it.
    //
    // The same adjudicated-draw resume the mainline needs, for the same reason:
    // an engine line out of a repetition-heavy endgame repeats too, and without
    // this it is cut to its first move. In the 2015 world final every ply from
    // 248 on re-triggers the threefold, so two twenty-move lines rendered as
    // one move each.
    let state = states[ply - 1]!;
    const legal: XiangqiMove[] = [];
    for (const [step, mv] of parsed.entries()) {
      if (state.status.type === 'finished' && ARBITER_ADJUDICATED_DRAWS.has(state.status.reason)) {
        // Moves made so far is (ply - 1 + step); an even count means the side
        // that opened the line is to move.
        const turn = (ply - 1 + step) % 2 === 0 ? firstMover : secondMover;
        state = { ...state, status: { type: 'playing', turn } };
      }
      const next = applyXiangqiMove(state, mv);
      if (next === state) break;
      legal.push(mv);
      state = next;
    }
    return legal;
  }

  function labelsForLine(ply: number, line: XiangqiMove[]): string[] {
    const cached = variationLabels.get(ply);
    if (cached) return cached;
    const prefix = moves.slice(0, ply - 1);
    const all = formatXiangqiMoves(
      [...prefix, ...line],
      currentXiangqiNotationStyle(),
      startState,
    ).slice(prefix.length);
    variationLabels.set(ply, all);
    return all;
  }

  function evalText(a: XiangqiReplayAnnotation | undefined): string {
    if (!a) return '';
    if (a.mate != null) return `#${a.mate}`;
    if (a.cp == null) return '';
    const pawns = a.cp / 100;
    return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`;
  }

  function leaveVariation(): void {
    if (!variation) return;
    variation = null;
    render();
  }

  // Board state for the current view. A variation replays from the position the
  // judged move was played in, so an illegal token (a stale line against a
  // corrected record) truncates rather than throwing.
  function viewState(): { board: XiangqiBoard; lastMove: XiangqiMove | undefined; key: number } {
    if (!variation) {
      return {
        board: states[index]!.board,
        lastMove: index > 0 ? moves[index - 1] : undefined,
        key: index,
      };
    }
    let state = states[variation.atPly - 1]!;
    let last: XiangqiMove | undefined;
    for (let i = 0; i < variation.cursor; i += 1) {
      const mv = variation.moves[i]!;
      const next = applyXiangqiMove(state, mv);
      if (next === state) break;
      state = next;
      last = mv;
    }
    return { board: state.board, lastMove: last, key: 1000 + variation.cursor };
  }
  /**
   * Set when a click on a move should leave the keyboard usable. renderMoveList
   * replaces every button, so the one the reader clicked is detached mid-render
   * and focus falls to <body>; the arrow handler is bound to `host` and stops
   * receiving anything. This is an explicit intent flag rather than a read of
   * document.activeElement because clicking a button focuses it in Chrome but
   * not in Safari, so sniffing focus would have fixed the bug in one browser
   * and left it in the other.
   */
  let takeFocusAfterRender = false;

  function moveButton(
    label: string,
    opts: { current: boolean; glyph?: string; onClick: () => void; title?: string },
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'xq-replay-move-button';
    if (opts.current) b.classList.add('is-current');
    if (opts.title) b.title = opts.title;
    const text = document.createElement('span');
    text.className = 'xq-replay-move-t';
    text.textContent = label;
    b.appendChild(text);
    if (opts.glyph) {
      const g = document.createElement('span');
      const kind = opts.glyph === '??' ? 'blunder' : opts.glyph === '?' ? 'mistake' : 'inaccuracy';
      g.className = `xq-replay-glyph xq-replay-glyph-${kind}`;
      g.textContent = opts.glyph;
      b.appendChild(g);
    }
    b.addEventListener('click', () => {
      takeFocusAfterRender = true;
      opts.onClick();
    });
    return b;
  }

  // The move tree: mainline in numbered pairs, and a judged move's engine line
  // rendered INLINE directly beneath the row it belongs to, the way a study
  // shows a variation.
  function renderMoveList(): void {
    if (!annotated) return;
    moveList.replaceChildren();
    for (let ply = 1; ply <= total; ply += 1) {
      // Odd plies belong to whoever opened the line, which is not always Red.
      const isRed = (ply % 2 === 1) === (firstMover === 'red');
      let row: HTMLElement;
      if (isRed) {
        row = document.createElement('div');
        row.className = 'xq-replay-row';
        const n = document.createElement('span');
        n.className = 'xq-replay-move-n';
        n.textContent = `${Math.ceil((ply + plyOffset) / 2)}.`;
        row.appendChild(n);
        moveList.appendChild(row);
      } else {
        row = moveList.lastElementChild as HTMLElement;
        // A line inserted after Red's move means Black's move needs a new row.
        if (!row?.classList.contains('xq-replay-row') || row.children.length > 2) {
          row = document.createElement('div');
          // A sideline between the pair splits the move number across two rows, so
          // Black's move has to land in Black's column rather than sliding into the
          // empty Red slot beside it.
          row.className = 'xq-replay-row xq-replay-row-black';
          const n = document.createElement('span');
          n.className = 'xq-replay-move-n';
          n.textContent = `${Math.ceil((ply + plyOffset) / 2)}\u2026`;
          row.appendChild(n);
          moveList.appendChild(row);
        }
      }
      const a = annotationAt(ply);
      row.appendChild(
        moveButton(mainlineLabels[ply - 1] ?? '', {
          current: !variation && ply === index,
          glyph: a?.glyph,
          title: judgmentTitle(a),
          onClick: () => gotoMainline(ply),
        }),
      );

      const line = a?.line ? parseLine(ply) : [];
      if (line.length === 0) continue;
      const labels = labelsForLine(ply, line);
      const branch = document.createElement('div');
      branch.className = 'xq-replay-branch';
      const tag = document.createElement('span');
      tag.className = 'xq-replay-branch-tag';
      // "engine" named the source; this names the thing, which is what a reader
      // needs. Every branch belongs to a ?!/?/?? move, so it is always a line
      // that was better than the one played.
      tag.textContent = copy.betterWas;
      branch.appendChild(tag);
      // A line replacing a Black move starts mid-pair, so it opens the way a
      // score sheet does: the move number, then an ellipsis standing in for
      // Red's move, rather than a bare move with no number at all.
      if (!isRed) {
        const lead = document.createElement('span');
        lead.className = 'xq-replay-move-n';
        lead.textContent = `${Math.ceil(ply / 2)}\u2026`;
        branch.appendChild(lead);
      }
      line.forEach((_mv, i) => {
        // Number the line from the move it replaces so it reads like a score.
        const movesIn = isRed ? i : i + 1;
        if (movesIn % 2 === 0) {
          const n = document.createElement('span');
          n.className = 'xq-replay-move-n';
          const num = Math.ceil(ply / 2) + Math.floor(movesIn / 2);
          n.textContent = `${num}.`;
          branch.appendChild(n);
        }
        branch.appendChild(
          moveButton(labels[i] ?? '', {
            current: variation?.atPly === ply && variation.cursor === i + 1,
            onClick: () => {
              variation = { atPly: ply, moves: line, cursor: i + 1 };
              render();
            },
          }),
        );
      });
      // The line's verdict, where a reader's eye already is: at its end.
      if (a?.lineEval) {
        const verdict = document.createElement('span');
        verdict.className = 'xq-replay-branch-eval';
        verdict.textContent = a.lineEval;
        branch.appendChild(verdict);
      }
      moveList.appendChild(branch);
    }
    // Last item in the scroller, not a pinned footer: the result belongs at the
    // end of the game, and reaching it should mean scrolling to the end. A host
    // that asked for it pinned has it under the list instead (see the mount).
    if (options.resultPlacement !== 'pinned') moveList.appendChild(resultFoot);
  }

  /**
   * Our own analysis writes judged-move notes to a fixed template. This used to
   * be rendered as a card under the move list, which restated the glyph already
   * on the move, pointed at a line already drawn beside it, and appeared and
   * disappeared as the reader stepped, shoving the list around. The one thing
   * only it carried was the numbers, so those move onto the move itself.
   *
   * The shape is `parseJudgmentComment` in @mistboard/game, not a pattern of our
   * own. This file used to carry its own copy, which required the eval to be a
   * single token: every `eval mate in 4 after` note therefore failed to match and
   * fell through to the branch below, printing the whole English sentence after a
   * Chinese label on five moves of the champions article.
   */

  /** Hover text for a judged move: the judgment, the cost, and the eval. */
  function judgmentTitle(a: XiangqiReplayAnnotation | undefined): string | undefined {
    if (!a?.glyph) return undefined;
    const label = copy.judgment[a.glyph as keyof typeof copy.judgment] ?? '';
    const machine = a.note ? parseJudgmentComment(a.note) : null;
    if (!machine) {
      // Prose we did not generate (the positive classifier writes its own).
      // It is English and stays English: it is authored text with no
      // translation, and a Chinese label in front of an English sentence reads
      // worse than leaving the pair alone.
      const note = a.note?.replace(/^(great|brilliant):\s*/i, '');
      return [label, note].filter(Boolean).join(': ');
    }
    const evaluation = evalText(a) || machine.evalText;
    return [
      label,
      copy.winChanceGivenUp(String(machine.lost)),
      evaluation ? `${copy.evalPrefix} ${evaluation}` : '',
    ]
      .filter(Boolean)
      .join(' \u00b7 ');
  }

  function render(): void {
    const view = viewState();
    // Only the mainline carries a verdict; a position inside an engine line is
    // not a move anyone played.
    const playedGlyph = !variation && index > 0 ? annotationAt(index)?.glyph : undefined;
    frame.innerHTML = boardSvg(view.board, view.lastMove, perspective, view.key, playedGlyph);
    if (counter.isConnected) counter.textContent = index === 0 ? copy.start : `${index} / ${total}`;
    // While a sideline is open the controls walk the LINE, so their enabled
    // state has to come from the line's cursor. Reading the mainline index here
    // meant entering a line from ply 0 left prev disabled, and stepping back
    // out is one of only two ways to leave a line.
    const line = variation;
    // Disabling the control the reader is CURRENTLY on hands focus back to the
    // document, and the arrow keys are bound to `host`, so they go dead exactly
    // when someone clicks their way to the last move and then wants to step
    // back. Remember what was focused, and catch it below if it just went away.
    const wasFocused = document.activeElement;
    if (line) {
      first.disabled = false;
      prev.disabled = false;
      next.disabled = line.cursor >= line.moves.length;
      last.disabled = line.cursor >= line.moves.length;
    } else {
      first.disabled = index === 0;
      prev.disabled = index === 0;
      next.disabled = index === total;
      last.disabled = index === total;
    }
    if (
      wasFocused instanceof HTMLButtonElement &&
      wasFocused.disabled &&
      host.contains(wasFocused)
    ) {
      // preventScroll: the widget can be taller than the viewport, and yanking
      // the page to it on every step at the end of a game is worse than the bug.
      host.focus({ preventScroll: true });
    }
    if (slider.isConnected) slider.value = String(index);
    if (variation) {
      narrative.textContent = `Engine line, ${variation.cursor} of ${variation.moves.length}`;
    } else if (index === 0) {
      narrative.textContent = copy.intro;
    } else if (index === total) {
      narrative.textContent = spec.resultText;
    } else {
      const mv = moves[index - 1]!;
      const mover = index % 2 === 1 ? copy.first : copy.second;
      narrative.textContent = `${copy.movePrefix(Math.ceil(index / 2))} · ${mover}: ${mv.from}–${mv.to}`;
    }
    // The card always shows the result, the way a game page does; the running
    // narrative line is the plain stepper's job. Pinned, it reads as the game
    // card's foot does ("Red wins"), not as a tag.
    resultFoot.textContent =
      options.resultPlacement === 'pinned'
        ? xiangqiResultLabel(spec.resultText, copy)
        : spec.resultText;
    renderMoveList();
    if (takeFocusAfterRender) {
      takeFocusAfterRender = false;
      // Prefer the move now being shown, so the reader keeps a visible anchor;
      // `host` is the fallback at ply zero, where no move is current. Either
      // way the arrow handler, which is bound to `host`, is back in range.
      const current = moveList.querySelector<HTMLElement>('.xq-replay-move-button.is-current');
      (current ?? host).focus({ preventScroll: true });
    }
    scrollCurrentIntoView();
  }

  /**
   * Keep the played move visible in the move column. Long games scroll the list
   * well past the viewport, and a highlight you have to hunt for is the same as
   * no highlight. `block: 'nearest'` so an already-visible move does not jerk
   * the list, and the scroll is confined to the list element rather than the
   * page: scrollIntoView on a nested scroller will happily drag the whole
   * article to it otherwise.
   */
  function scrollCurrentIntoView(): void {
    const current = moveList.querySelector<HTMLElement>('.xq-replay-move-button.is-current');
    if (!current) return;
    const listBox = moveList.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    if (box.top >= listBox.top && box.bottom <= listBox.bottom) return;
    const delta =
      box.top < listBox.top ? box.top - listBox.top - 8 : box.bottom - listBox.bottom + 8;
    moveList.scrollTop += delta;
  }

  // Fires once per mounted board. Stepping a move is the signal that a reader
  // actually engaged with an embed rather than scrolling past it; firing per
  // step would be high volume and answer the same question no better.
  let engagementReported = false;
  function reportEngagement(): void {
    if (engagementReported) return;
    engagementReported = true;
    track('article_replay_engaged', {
      slug: document.querySelector('[data-article-slug]')?.getAttribute('data-article-slug') ?? '',
      event: spec.event,
      annotated: Boolean(annotated),
    });
  }

  function goto(target: number): void {
    reportEngagement();
    // Stepping while a line is open walks the LINE, not the game; the mainline
    // cursor is preserved so leaving the line lands where it was entered.
    if (variation) {
      const step = target > index ? 1 : -1;
      const next = variation.cursor + step;
      if (next < 1) {
        leaveVariation();
        return;
      }
      variation.cursor = Math.min(variation.moves.length, next);
      render();
      return;
    }
    const clamped = Math.max(0, Math.min(total, target));
    if (clamped !== index) {
      index = clamped;
      render();
    }
  }
  /**
   * Put the board on a mainline ply, leaving any line that is open.
   *
   * Not `variation = null; goto(target)`, which is what the exits used to do:
   * goto repaints only when `index` moves, and opening a line leaves `index`
   * sitting on the move the line hangs off. Clicking that move to get back to
   * the game therefore cleared the variation and painted nothing, so the board
   * stayed in the sideline and the move read as a dead button. The two exits a
   * reader has are stepping off the head of the line and clicking a mainline
   * move; the second has to work for the move that owns the line too, which is
   * the one they are most likely to click.
   */
  function gotoMainline(target: number): void {
    reportEngagement();
    const wasInLine = variation !== null;
    variation = null;
    const clamped = Math.max(0, Math.min(total, target));
    const moved = clamped !== index;
    index = clamped;
    if (moved || wasInLine) render();
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
  const onDocPointer = (event: MouseEvent) => {
    if (menu.hidden) return;
    const target = event.target as Node | null;
    if (target && (menu.contains(target) || menuButton.contains(target))) return;
    closeMenu();
  };
  const onDocKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !menu.hidden) {
      closeMenu();
      menuButton.focus({ preventScroll: true });
    }
  };
  document.addEventListener('click', onDocPointer);
  document.addEventListener('keydown', onDocKey);
  // Piece set is inline glyphs, so re-render the current ply when the picker
  // changes (board + fog react through CSS, like the static diagrams).
  const onAppearance = () => render();
  window.addEventListener(xiangqiAppearanceChangedEvent, onAppearance);
  // Notation is a display preference like the piece set: relabel and repaint.
  const onNotation = () => {
    relabel();
    render();
  };
  window.addEventListener(xiangqiNotationChangedEvent, onNotation);

  relabel();
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
      window.removeEventListener(xiangqiNotationChangedEvent, onNotation);
      document.removeEventListener('click', onDocPointer);
      document.removeEventListener('keydown', onDocKey);
      host.replaceChildren();
      host.classList.remove('xq-replay', 'stepper');
    },
  };
}
