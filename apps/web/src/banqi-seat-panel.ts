// The seat panel under a banqi-family board, shared by Three Kingdoms banqi
// (live-three-kingdoms-banqi.ts) and Fanfanqi (live-ffq-banqi.ts): one block
// per seat, its name over its score, then named lines of pieces at one disc
// size. Each room decides what the score is (points, HP) and which lines a
// seat carries; the blocks, lines and their style (banqi-seat-panel.css) are
// one implementation so the two rooms never drift apart.

import './banqi-seat-panel.css';
import { t } from './i18n/catalog.js';

/** Classes a line's piece row carries: the captured-pool row, sized by the panel. */
export const SEAT_PANEL_PIECES_CLASS = 'captures-row review-captures-row tk-seat__pieces';

/** One seat block with its head (name, then the score element). Lines follow. */
export function seatPanelBlock(opts: {
  name: string;
  score: HTMLElement;
  seat?: string;
  ink?: string | null;
  className?: string;
}): HTMLElement {
  const block = document.createElement('div');
  block.className = opts.className ? `tk-seat ${opts.className}` : 'tk-seat';
  if (opts.seat) block.dataset.seat = opts.seat;
  if (opts.ink) block.dataset.ink = opts.ink;
  const head = document.createElement('div');
  head.className = 'tk-seat__head';
  const label = document.createElement('span');
  label.className = 'tk-seat__name';
  label.textContent = opts.name;
  head.append(label, opts.score);
  block.append(head);
  return block;
}

/** A named line of pieces: the key in the label column, the pieces beside it. */
export function seatPanelLine(kind: string, key: string, pieces: HTMLElement): HTMLElement {
  const line = document.createElement('div');
  line.className = 'tk-seat__line';
  line.dataset.line = kind;
  const name = document.createElement('span');
  name.className = 'tk-seat__key';
  name.textContent = key;
  line.append(name, pieces);
  return line;
}

/** An empty line's "None", at the discs' height so the panel keeps its shape. */
export function seatPanelNone(): HTMLElement {
  const none = document.createElement('span');
  none.className = 'tk-seat__none';
  none.textContent = t('live.tk.none');
  return none;
}

/** Turn a filled captures host into a line's piece row, "None" when it is empty. */
export function seatPanelPieces(host: HTMLElement): HTMLElement {
  host.className = SEAT_PANEL_PIECES_CLASS;
  if (!host.querySelector('.review-capture-piece')) host.replaceChildren(seatPanelNone());
  return host;
}
