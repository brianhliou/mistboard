// Inline board diagrams for the Jungle + Flip Jungle rules articles.
//
// Built on the live board renderers (renderJungleBoardSvg / renderJungleFlipBoardSvg)
// so every diagram shows the exact furniture a player sees (rivers, dens, traps,
// animal discs).
//
// Two rules this module holds itself to:
//
//  1. TARGETS COME FROM THE KERNEL, never from a hand-written list. Each diagram
//     declares a position and which piece is to move; getJungleLegalMovesFrom
//     decides what is reachable. A hand-listed target set is a second, silent
//     implementation of the rules that can disagree with the game the reader is
//     about to play (it did: the swimming-rat diagram was missing a legal move).
//     It also means a "cannot" diagram is honest by construction — the square is
//     unmarked because the kernel refuses it, not because the author left it out.
//  2. ONE VISUAL GRAMMAR: a dot (or ring, when occupied) is a square this piece
//     can reach; an arrow is a river leap. Steps and leaps look different because
//     they ARE different, and the leap is the rule readers get wrong.
//
// Each diagram passes a unique idSuffix so its namespaced <defs> (gradients, clip,
// drop-shadow) never collide when several boards share one article page.

import {
  ALL_JUNGLE_FLIP_SQUARES,
  createInitialJungleBoard,
  getJungleFlipLegalMovesFrom,
  getJungleLegalMovesFrom,
  type JungleBoard,
  type JungleFlipBoard,
  type JungleFlipGameState,
  type JungleFlipSquare,
  type JungleGameState,
  type JunglePieceRole,
  type JungleSquare,
  jungleCoordOf,
} from '@mistboard/game';
import { framedTokenSvg, jungleShadowFilterDef } from './jungle-art.js';
import {
  type JungleFlipRenderBoard,
  type JungleFlipRenderEntry,
  renderJungleFlipBoardSvg,
} from './jungle-flip-render.js';
import { renderJungleBoardSvg } from './jungle-render.js';

// The live renderers emit a viewBox-only <svg class="jungle(-flip)-live-svg"> whose
// global CSS rule is width/height 100% (sized by its live board container). In an
// article figure there is no such container, so each diagram carries its own inline
// width cap + height:auto (inline beats the class rule), exactly like the shogi4
// rules diagrams self-size.
function responsive(svg: string, maxWidth: number): string {
  return svg.replace(
    '<svg ',
    `<svg width="100%" style="max-width:${maxWidth}px;height:auto;display:block;margin:0 auto" `,
  );
}

// Diagrams are MODULE CONSTANTS, evaluated once at import, so they could never
// follow a live skin change anyway — they would just freeze whatever skin
// happened to be active on first load. They are pinned instead, to the pair the
// product ships as its default, so the board in the rules is the board in the
// game. Re-pin here if that default ever moves.
const DIAGRAM_SKIN = { boardSkin: 'bare', pieceSkin: 'animals' } as const;

// Wide enough to read alone in the column; the pairs get their own cap.
const FULL_WIDTH = 420;
const PAIR_WIDTH = 330;

// Leaps read in the same green as the reachable-square dots — one "you may go
// here" colour, two shapes for the two kinds of move.
const LEAP_ARROW = { color: '#1f6f5b', opacity: 0.88, width: 9 } as const;

function diagramState(board: JungleBoard, from: JungleSquare): JungleGameState {
  const piece = board[from];
  if (!piece) throw new Error(`jungle diagram: no piece on ${from}`);
  return {
    id: 'diagram',
    board,
    status: { type: 'playing', turn: piece.color },
    moveNumber: 1,
    progressClock: 0,
    positionCounts: {},
  };
}

function isStep(from: JungleSquare, to: JungleSquare): boolean {
  const a = jungleCoordOf(from);
  const b = jungleCoordOf(to);
  return Math.abs(a.file - b.file) + Math.abs(a.rank - b.rank) === 1;
}

/**
 * One position, one piece to move, every legal destination marked: dots for
 * steps, arrows for river leaps. A leap onto an occupied square also keeps its
 * capture ring, so "the leap can take the piece it lands on" is visible in a
 * single board rather than asserted in prose.
 */
function jungleMoveDiagram(opts: {
  id: string;
  board: JungleBoard;
  from: JungleSquare;
  // One step to draw as an arrow as well, for a diagram whose whole point is a
  // particular move. Only needed when the destination square is busy enough to
  // swallow a dot (the den tile is a tinted square with a mark already on it).
  arrowTo?: JungleSquare;
  maxWidth?: number;
}): string {
  const { board, from } = opts;
  const moves = getJungleLegalMovesFrom(diagramState(board, from), from);
  const steps = moves.filter((move) => isStep(from, move.to)).map((move) => move.to);
  const leaps = moves.filter((move) => !isStep(from, move.to)).map((move) => move.to);
  const arrows = [...leaps];
  if (opts.arrowTo) {
    // Same honesty rule as the dots: the arrow may only point at a move the
    // kernel actually allows.
    if (!moves.some((move) => move.to === opts.arrowTo)) {
      throw new Error(`jungle diagram ${opts.id}: ${from}-${opts.arrowTo} is not a legal move`);
    }
    if (!arrows.includes(opts.arrowTo)) arrows.push(opts.arrowTo);
  }
  return responsive(
    renderJungleBoardSvg(board, {
      // Published article artwork: these diagrams teach the rule in prose beside
      // them, and their pixels should not shift under an already-published piece.
      cueBadges: false,
      ...DIAGRAM_SKIN,
      idSuffix: opts.id,
      perspective: 'red',
      selected: from,
      targets: [...steps, ...leaps.filter((to) => board[to] !== undefined)],
      arrows: arrows.map((to) => ({ from, to, ...LEAP_ARROW })),
    }),
    opts.maxWidth ?? PAIR_WIDTH,
  );
}

// ── Vanilla Jungle (7×9) ─────────────────────────────────────────────────────

export const JUNGLE_START_BOARD = responsive(
  renderJungleBoardSvg(createInitialJungleBoard(), {
    // Published article artwork: these diagrams teach the rule in prose beside
    // them, and their pixels should not shift under an already-published piece.
    cueBadges: false,
    ...DIAGRAM_SKIN,
    idSuffix: '-start',
    perspective: 'red',
  }),
  440,
);

// The ordinary move, shown on open land so nothing else competes for attention.
export const JUNGLE_STEP = jungleMoveDiagram({
  id: '-step',
  board: { b8: { color: 'red', role: 'wolf' } },
  from: 'b8',
});

// The same step rule against the river: the elephant sits on the dry lane
// between the two lakes, and the two water squares beside it are simply not
// offered. d-file is land at every rank, which is why this position exists.
export const JUNGLE_NO_WATER = jungleMoveDiagram({
  id: '-no-water',
  board: { d4: { color: 'red', role: 'elephant' } },
  from: 'd4',
});

// Only the rat may leave land for water. From the dry lane at a5 it can step
// into the west lake.
export const JUNGLE_RAT_ENTERS_WATER = jungleMoveDiagram({
  id: '-rat-water',
  board: { a5: { color: 'red', role: 'rat' } },
  from: 'a5',
});

// Inside the lake the rat swims freely, but the shoreline blocks capture in both
// directions: the wolf on the bank is not a target, and it cannot reach the rat.
export const JUNGLE_RAT_SHORELINE = jungleMoveDiagram({
  id: '-shoreline',
  board: {
    b5: { color: 'red', role: 'rat' },
    a5: { color: 'black', role: 'wolf' },
  },
  from: 'b5',
});

// Across: the lion on the central dry lane faces water on both sides and clears
// each lake to the far bank. Two leaps and two steps from one square.
export const JUNGLE_LION_LEAP_ACROSS = jungleMoveDiagram({
  id: '-lion-across',
  board: { d4: { color: 'red', role: 'lion' } },
  from: 'd4',
});

// Along, and into a capture: the lion clears the west lake end to end and takes
// the wolf standing on the landing square.
export const JUNGLE_LION_LEAP_CAPTURE = jungleMoveDiagram({
  id: '-lion-capture',
  board: {
    b3: { color: 'red', role: 'lion' },
    b7: { color: 'black', role: 'wolf' },
  },
  from: 'b3',
});

// The tiger's leap along the lake: the same vertical clearance as the lion.
export const JUNGLE_TIGER_LEAP = jungleMoveDiagram({
  id: '-tiger-leap',
  board: { b3: { color: 'red', role: 'tiger' } },
  from: 'b3',
});

// Deliberately the same square as JUNGLE_LION_LEAP_ACROSS: identical position,
// different animal, identical arrows. The tiger has had the lion's sideways leap
// since 2026-09-21 (#430); this diagram is drawn from the move generator, so it
// is the proof that the two animals jump alike, not a claim about it.
export const JUNGLE_TIGER_LEAP_ACROSS = jungleMoveDiagram({
  id: '-tiger-flat',
  board: { d4: { color: 'red', role: 'tiger' } },
  from: 'd4',
});

// A rat anywhere in the water, either colour, cancels the leap: same lion, same
// square as the capture diagram, no arrow.
export const JUNGLE_RAT_BLOCKS = jungleMoveDiagram({
  id: '-blocked',
  board: {
    b3: { color: 'red', role: 'lion' },
    b5: { color: 'black', role: 'rat' },
  },
  from: 'b3',
});

// The rank exception, on land and away from the traps so nothing else explains
// the capture.
export const JUNGLE_RAT_ELEPHANT = jungleMoveDiagram({
  id: '-rat-elephant',
  board: {
    a3: { color: 'red', role: 'rat' },
    b3: { color: 'black', role: 'elephant' },
  },
  from: 'a3',
});

// The wrap only runs one way: the elephant beside the same rat has no capture,
// so b3 stays unmarked while its other steps are dotted.
export const JUNGLE_ELEPHANT_STUCK = jungleMoveDiagram({
  id: '-elephant-rat',
  board: {
    a3: { color: 'red', role: 'elephant' },
    b3: { color: 'black', role: 'rat' },
  },
  from: 'a3',
});

// A piece on an ENEMY trap loses all rank, so even a cat takes a lion. d2 is one
// of the three red traps ringing the red den on d1.
export const JUNGLE_TRAP = jungleMoveDiagram({
  id: '-trap',
  board: {
    d3: { color: 'red', role: 'cat' },
    d2: { color: 'black', role: 'lion' },
  },
  from: 'd3',
});

// The other half of the trap rule: red's elephant stands on red's OWN trap and
// keeps full rank, so the black cat beside it has no capture.
export const JUNGLE_OWN_TRAP = jungleMoveDiagram({
  id: '-own-trap',
  board: {
    d3: { color: 'black', role: 'cat' },
    d2: { color: 'red', role: 'elephant' },
  },
  from: 'd3',
});

// The win: any piece entering the enemy den ends the game, whatever its rank and
// whatever it is standing on (d8 is one of black's traps).
export const JUNGLE_DEN_ENTRY = jungleMoveDiagram({
  id: '-den',
  board: { d8: { color: 'red', role: 'wolf' } },
  from: 'd8',
  arrowTo: 'd9',
  maxWidth: FULL_WIDTH,
});

// ── Rank ladder (shared by both articles) ────────────────────────────────────
// The eight animals laid out strongest to weakest, drawn as the same FRAMED
// dobutsu tokens the boards use (cream disc + cutout + ink ring) so the animals
// read on any page background — the cream disc keeps them legible in dark mode,
// the same way banqi's ladder sits its pieces on a light panel. Labels use
// `currentColor` so they follow the article's theme-adaptive text colour. Each
// animal outranks everything to its right; the rat-beats-elephant wrap is left to
// the prose + the dedicated demo board.
const RANK_ORDER: JunglePieceRole[] = [
  'elephant',
  'lion',
  'tiger',
  'leopard',
  'wolf',
  'dog',
  'cat',
  'rat',
];
const RANK_LABEL: Record<JunglePieceRole, string> = {
  rat: 'Rat',
  cat: 'Cat',
  dog: 'Dog',
  wolf: 'Wolf',
  leopard: 'Leopard',
  tiger: 'Tiger',
  lion: 'Lion',
  elephant: 'Elephant',
};
export const JUNGLE_RANK_LADDER = (() => {
  const slot = 80;
  const token = 50;
  const topPad = 6;
  const redCy = topPad + token / 2;
  const blueCy = redCy + 48;
  const labelY = blueCy + token / 2 + 17;
  const width = RANK_ORDER.length * slot;
  const height = labelY + 8;
  const shadowId = 'jungle-rank-shadow';
  // No leading rank numbers: the left-to-right order already reads strongest to
  // weakest, and a "1./2." index just fights the "higher number = stronger"
  // instinct on a wrap-order ladder (the rat, last here, still beats the elephant).
  const cells = RANK_ORDER.map((role, i) => {
    const cx = i * slot + slot / 2;
    return [
      framedTokenSvg({ cx, cy: redCy, size: token, ink: 'red', role, filterId: shadowId }),
      framedTokenSvg({ cx, cy: blueCy, size: token, ink: 'black', role, filterId: shadowId }),
      `<text x="${cx}" y="${labelY}" font-size="12" fill="currentColor" text-anchor="middle" font-weight="600">${RANK_LABEL[role]}</text>`,
    ].join('');
  }).join('');
  const svg = `<svg class="jungle-rank-ladder" viewBox="0 0 ${width} ${height}" role="img" xmlns="http://www.w3.org/2000/svg" aria-label="The red and blue Jungle animals in rank order, strongest to weakest"><defs>${jungleShadowFilterDef(shadowId)}</defs>${cells}</svg>`;
  return responsive(svg, 680);
})();

// ── Flip Jungle (4×4) ────────────────────────────────────────────────────────

const FACE_DOWN: JungleFlipRenderEntry = { faceDown: true };
const FLIP_PAIR_WIDTH = 260;

// The kernel needs a colour and role under every face-down tile; a diagram does
// not know (or care) what is under one, because a face-down tile blocks movement
// and refuses capture whatever it hides. Any filler works, and nothing in the
// rendered board comes from it — JungleFlipRenderEntry stays the source of what
// is drawn.
const HIDDEN_FILLER = { color: 'black', role: 'rat', faceDown: true } as const;

function flipDiagramState(board: JungleFlipRenderBoard): JungleFlipGameState {
  const kernelBoard: JungleFlipBoard = {};
  for (const square of ALL_JUNGLE_FLIP_SQUARES) {
    const entry = board[square];
    if (!entry) continue;
    kernelBoard[square] = entry.faceDown
      ? { ...HIDDEN_FILLER }
      : { color: entry.color, role: entry.role, faceDown: false };
  }
  return {
    id: 'diagram',
    board: kernelBoard,
    status: { type: 'playing', turn: 'red' },
    ply: 0,
    // Seat red already holds the red ink, so a red piece is the one to move.
    firstColor: 'red',
    moveNumber: 1,
    noProgressClock: 0,
    repCounts: {},
    captures: [],
  };
}

/** Flip Jungle's jungleMoveDiagram: kernel-derived destinations, no leaps to draw. */
function flipMoveDiagram(opts: {
  id: string;
  board: JungleFlipRenderBoard;
  from: JungleFlipSquare;
  maxWidth?: number;
}): string {
  const moves = getJungleFlipLegalMovesFrom(flipDiagramState(opts.board), opts.from);
  return responsive(
    renderJungleFlipBoardSvg(opts.board, {
      ...DIAGRAM_SKIN,
      idSuffix: opts.id,
      selected: opts.from,
      // A flip is encoded from==to; it is the tile itself, not a destination.
      targets: moves.filter((move) => move.to !== move.from).map((move) => move.to),
    }),
    opts.maxWidth ?? FLIP_PAIR_WIDTH,
  );
}

function flipDiagram(
  idSuffix: string,
  board: JungleFlipRenderBoard,
  options: { selected?: JungleFlipSquare },
  maxWidth: number,
): string {
  return responsive(
    renderJungleFlipBoardSvg(board, {
      ...DIAGRAM_SKIN,
      idSuffix,
      selected: options.selected ?? null,
    }),
    maxWidth,
  );
}

const FLIP_SETUP_BOARD: JungleFlipRenderBoard = (() => {
  const board: JungleFlipRenderBoard = {};
  for (const square of ALL_JUNGLE_FLIP_SQUARES) board[square] = FACE_DOWN;
  return board;
})();
export const JUNGLE_FLIP_SETUP = flipDiagram('-flip-setup', FLIP_SETUP_BOARD, {}, 340);

const FLIP_REVEAL_BOARD: JungleFlipRenderBoard = {
  ...FLIP_SETUP_BOARD,
  b2: { faceDown: false, color: 'red', role: 'elephant' },
};
export const JUNGLE_FLIP_REVEAL = flipDiagram(
  '-flip-reveal',
  FLIP_REVEAL_BOARD,
  { selected: 'b2' },
  FLIP_PAIR_WIDTH,
);

// The other kind of turn, on the same board: the revealed wolf steps. The
// face-down tiles around it are not destinations, which is the rule that catches
// new players out.
export const JUNGLE_FLIP_MOVE = flipMoveDiagram({
  id: '-flip-move',
  board: {
    a1: FACE_DOWN,
    c1: FACE_DOWN,
    d1: FACE_DOWN,
    b2: { faceDown: false, color: 'red', role: 'wolf' },
    b3: FACE_DOWN,
    c3: { faceDown: false, color: 'black', role: 'leopard' },
    a4: FACE_DOWN,
    d4: FACE_DOWN,
  },
  from: 'b2',
});

export const JUNGLE_FLIP_CAPTURE = flipMoveDiagram({
  id: '-flip-capture',
  board: {
    a1: FACE_DOWN,
    d4: FACE_DOWN,
    b2: { faceDown: false, color: 'red', role: 'lion' },
    b3: { faceDown: false, color: 'black', role: 'wolf' },
  },
  from: 'b2',
});

// Equal ranks trade off the board (同归于尽): the red wolf and the black wolf meet,
// and both are removed.
export const JUNGLE_FLIP_MUTUAL = flipMoveDiagram({
  id: '-flip-mutual',
  board: {
    a1: FACE_DOWN,
    d4: FACE_DOWN,
    b2: { faceDown: false, color: 'red', role: 'wolf' },
    b3: { faceDown: false, color: 'black', role: 'wolf' },
  },
  from: 'b2',
});

// The wrap, both ways round, as a pair: the rat may take the elephant …
export const JUNGLE_FLIP_RAT_TAKES_ELEPHANT = flipMoveDiagram({
  id: '-flip-rat-elephant',
  board: {
    a1: FACE_DOWN,
    d4: FACE_DOWN,
    b2: { faceDown: false, color: 'red', role: 'rat' },
    b3: { faceDown: false, color: 'black', role: 'elephant' },
  },
  from: 'b2',
});

// … and the elephant may not take the rat, so b3 is unmarked while its other
// steps are.
export const JUNGLE_FLIP_ELEPHANT_STUCK = flipMoveDiagram({
  id: '-flip-elephant-rat',
  board: {
    a1: FACE_DOWN,
    d4: FACE_DOWN,
    b2: { faceDown: false, color: 'red', role: 'elephant' },
    b3: { faceDown: false, color: 'black', role: 'rat' },
  },
  from: 'b2',
});
