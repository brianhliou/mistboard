import { GOMOKU_BOARD_SIZE, type GomokuPlayerView, type GomokuSquare } from '@mistboard/game';
import { boardCoordinatesEnabled } from './display-preferences.js';

const CELL = 32;
const PAD = CELL;
const EDGE = PAD * 2 + CELL * (GOMOKU_BOARD_SIZE - 1);
const FILES = 'abcdefghijklmno';

export function gomokuBoardSvg(view: GomokuPlayerView, interactive: boolean): string {
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
        `<circle class="gomoku-ghost gomoku-stone--${view.perspective}" cx="${x}" cy="${y}" r="14" visibility="hidden" aria-hidden="true"/>`,
      );
    if (winning.has(square))
      nodes.push(`<circle class="gomoku-winning" cx="${x}" cy="${y}" r="14"/>`);
    if (view.lastMove?.to === square)
      nodes.push(`<rect class="gomoku-last" x="${x - 3}" y="${y - 3}" width="6" height="6"/>`);
    nodes.push(
      `<rect class="gomoku-hit" x="${x - 16}" y="${y - 16}" width="32" height="32" role="button" aria-label="${square}" aria-disabled="${!legal.has(square)}"${legal.has(square) ? ' tabindex="0"' : ''}/></g>`,
    );
  }
  nodes.push('</svg>');
  return nodes.join('');
}
