import {
  applyGomokuRoomMove,
  GOMOKU_BOARD_SIZE,
  type GomokuMove,
  type GomokuPlayerView,
  type GomokuRoomState,
  type GomokuSquare,
  parseGomokuMove,
} from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';
import type { MoveGlyphTone } from './review/move-glyph.js';
import { svgBoardGlyphMarker } from './svg-board-marker.js';

const CELL = 32;
const PAD = CELL;
const EDGE = PAD * 2 + CELL * (GOMOKU_BOARD_SIZE - 1);
const FILES = 'abcdefghijklmno';

export type GomokuBoardMarker =
  | { kind: 'best' | 'circle'; square: string }
  | { kind: 'pv'; moves: readonly GomokuMove[] }
  | { kind: 'glyph'; square: string; text: string; tone: MoveGlyphTone };

export function gomokuBoardSvg(
  view: GomokuPlayerView,
  interactive: boolean,
  markers: readonly GomokuBoardMarker[] = [],
  preview: GomokuSquare | null = null,
): string {
  const winning = new Set(view.winningLine);
  const legal = new Set(interactive ? view.legalMoves.map((move) => move.to) : []);
  const coordinates = boardCoordinatesEnabled();
  // Gomoku coordinates never rotate with the seat: a1 is always bottom left.
  const filePoint = (index: number) => PAD + CELL * index;
  const rankPoint = (index: number) => filePoint(GOMOKU_BOARD_SIZE - 1 - index);
  const nodes: string[] = [
    `<svg class="gomoku-svg" viewBox="0 0 ${EDGE} ${EDGE}" xmlns="http://www.w3.org/2000/svg"><rect width="${EDGE}" height="${EDGE}" class="gomoku-wood"/>`,
  ];
  for (let i = 0; i < GOMOKU_BOARD_SIZE; i += 1) {
    const p = PAD + i * CELL;
    nodes.push(
      `<path class="gomoku-grid" d="M${PAD} ${p}H${EDGE - PAD}M${p} ${PAD}V${EDGE - PAD}"/>`,
    );
    if (coordinates)
      nodes.push(
        `<text class="gomoku-coordinate" x="${p}" y="${EDGE - 6}">${FILES[i]}</text><text class="gomoku-coordinate" x="12" y="${rankPoint(i) + 4}">${i + 1}</text>`,
      );
  }
  for (const x of [3, 7, 11])
    for (const y of [3, 7, 11]) {
      nodes.push(`<circle class="gomoku-star" cx="${filePoint(x)}" cy="${rankPoint(y)}" r="3"/>`);
    }
  for (let index = 0; index < view.board.length; index += 1) {
    const x = filePoint(index % 15);
    const y = rankPoint(Math.floor(index / 15));
    const square = `${FILES[index % 15]}${1 + Math.floor(index / 15)}` as GomokuSquare;
    const color = view.board[index];
    nodes.push(`<g data-square="${square}">`);
    if (color)
      nodes.push(
        `<circle data-piece-square="${square}" class="gomoku-stone gomoku-stone--${color}" cx="${x}" cy="${y}" r="14"/>`,
      );
    else if (legal.has(square))
      nodes.push(
        `<circle class="gomoku-ghost${square === preview ? ' gomoku-preview' : ''} gomoku-stone--${view.perspective}" cx="${x}" cy="${y}" r="14" visibility="${square === preview ? 'visible' : 'hidden'}" aria-hidden="true"/>`,
      );
    if (winning.has(square))
      nodes.push(`<circle class="gomoku-winning" cx="${x}" cy="${y}" r="14"/>`);
    if (view.lastMove?.to === square)
      nodes.push(`<rect class="gomoku-last" x="${x - 3}" y="${y - 3}" width="6" height="6"/>`);
    nodes.push(
      `<rect class="gomoku-hit" x="${x - 16}" y="${y - 16}" width="32" height="32" role="button" aria-label="${square}" aria-disabled="${!legal.has(square)}"${legal.has(square) ? ' tabindex="0"' : ''}/></g>`,
    );
  }
  const overlays: string[] = [];
  const glyphs: string[] = [];
  const point = (square: GomokuSquare) => ({
    x: filePoint(square.charCodeAt(0) - 97),
    y: rankPoint(Number(square.slice(1)) - 1),
  });
  for (const marker of markers) {
    if (marker.kind === 'pv') {
      let state: GomokuRoomState = view;
      for (const [index, move] of marker.moves.entries()) {
        if (state.status.type !== 'playing') break;
        const color = state.status.turn;
        const next = applyGomokuRoomMove(state, move);
        if (next === state) break;
        const { x, y } = point(move.to);
        overlays.push(
          `<g class="gomoku-pv" data-square="${move.to}" opacity="0.43"><circle class="gomoku-stone gomoku-stone--${color}" cx="${x}" cy="${y}" r="14"/><text class="gomoku-pv-number gomoku-pv-number--${color}" x="${x}" y="${y}">${index + 1}</text></g>`,
        );
        state = next;
      }
    } else {
      const move = parseGomokuMove(marker.square);
      if (!move || (marker.kind === 'best' && !view.legalMoves.some((m) => m.to === move.to)))
        continue;
      const { x, y } = point(move.to);
      if (marker.kind === 'glyph') {
        // Shared verdict badge, scaled to 32-unit spacing. Its upper-right
        // corner clears the move number; clamp the complete disc to the wood.
        const radius = 6;
        const offset = 10;
        const inset = radius + 1;
        const cx = Math.min(EDGE - inset, x + offset);
        const cy = Math.max(inset, y - offset);
        glyphs.push(
          `<g class="gomoku-glyph" data-square="${move.to}">${svgBoardGlyphMarker(
            { text: marker.text, className: `xq-marker--${marker.tone}` },
            { x: cx - offset, y: cy + offset },
            radius,
            offset,
          )}</g>`,
        );
        continue;
      }
      overlays.push(
        `<circle class="gomoku-${marker.kind}" data-square="${move.to}" cx="${x}" cy="${y}" r="15"/>`,
      );
    }
  }
  if (overlays.length)
    nodes.push(
      `<g class="gomoku-engine-overlay" pointer-events="none" aria-hidden="true">${overlays.join('')}</g>`,
    );
  if (glyphs.length)
    nodes.push(
      `<g class="gomoku-glyph-layer" pointer-events="none" aria-hidden="true">${glyphs.join('')}</g>`,
    );
  nodes.push('</svg>');
  return nodes.join('');
}

/** Below this rendered width a two-digit stone number drops under ~7px and
 * reads as noise (the /games cards are 178px); the homepage viewer is 340px. */
export const GOMOKU_MOVE_NUMBER_MIN_PX = 300;

/** Numbers the recorded placements on a board painted by `gomokuBoardSvg`.
 * Dealt opening stones are not placements, so they stay unnumbered. */
export function numberGomokuStones(
  board: Element,
  placements: readonly Pick<GomokuMove, 'to'>[],
): void {
  for (const [index, move] of placements.entries()) {
    const group = board.querySelector(`[data-square="${move.to}"]`);
    const stone = group?.querySelector('[data-piece-square]');
    if (!group || !stone) continue;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute(
      'class',
      `gomoku-move-number gomoku-pv-number gomoku-pv-number--${stone.classList.contains('gomoku-stone--black') ? 'black' : 'white'}`,
    );
    label.setAttribute('x', stone.getAttribute('cx')!);
    label.setAttribute('y', stone.getAttribute('cy')!);
    label.setAttribute('pointer-events', 'none');
    label.textContent = String(index + 1);
    group.insertBefore(label, group.querySelector('.gomoku-hit'));
    // Keep the last-move square visible beside the move number.
    const last = group.querySelector('.gomoku-last');
    last?.setAttribute('x', String(Number(stone.getAttribute('cx')) + 6));
    last?.setAttribute('y', String(Number(stone.getAttribute('cy')) + 6));
  }
}
