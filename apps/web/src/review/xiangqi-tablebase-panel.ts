// Tablebase panel (lichess's tablebase table, for xiangqi): every legal move of a
// covered endgame with its exact result and mate distance, best first. Clicking
// a row plays the move, the same as the opening explorer.
//
// It sits in the analyse box under the engine head and is INVISIBLE unless the
// position has an exact answer. There is no loading state, no "unavailable" line
// and no error: chessdb.cn being down, slow, rate-limited or simply not knowing
// the position all read the same as a middlegame, where the panel never shows.
// The engine keeps working either way, so a missing table costs the reader
// nothing they had before.
//
// Results come from xiangqi-tablebase-client.ts, which only ever hands back an
// exact answer or `none`; this file never turns anything into a draw.

import './xiangqi-tablebase-panel.css';
import {
  formatXiangqiMove,
  standardXiangqiPositionKey,
  type XiangqiGameState,
  type XiangqiMove,
  type XiangqiTablebaseMove,
  type XiangqiTablebaseResponse,
  xiangqiTablebaseMateMoves,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { currentXiangqiNotationStyle, xiangqiNotationChangedEvent } from '../xiangqi-notation.js';
import { fetchXiangqiTablebase } from './xiangqi-tablebase-client.js';

type Exact = Extract<XiangqiTablebaseResponse, { status: 'exact' }>;

export type XiangqiTablebaseLookup = (
  state: XiangqiGameState,
  signal: AbortSignal,
) => Promise<XiangqiTablebaseResponse>;

export type XiangqiTablebasePanel = {
  el: HTMLElement;
  /** Point the panel at a position; null hides it. Safe on every navigation:
   *  the previous lookup is aborted, and a late answer for an old position is
   *  dropped. */
  setState(state: XiangqiGameState | null): void;
  /** Play a move the reader clicked in the table. */
  onPlayMove(handler: (move: XiangqiMove) => void): void;
  /** Fires as the reader hovers a row (the move, or null on leave). */
  onHoverMove(handler: (move: XiangqiMove | null) => void): void;
};

export function createXiangqiTablebasePanel(
  lookup: XiangqiTablebaseLookup = fetchXiangqiTablebase,
): XiangqiTablebasePanel {
  const el = document.createElement('section');
  el.className = 'xq-tablebase';
  el.setAttribute('aria-label', t('analysis.tablebase.title'));
  el.hidden = true;

  const head = document.createElement('div');
  head.className = 'xq-tablebase__head';
  const title = document.createElement('span');
  title.className = 'xq-tablebase__title';
  title.textContent = t('analysis.tablebase.title');
  const summary = document.createElement('span');
  summary.className = 'xq-tablebase__summary';
  head.append(title, summary);

  const table = document.createElement('div');
  table.className = 'xq-tablebase__table';
  el.append(head, table);

  let currentKey: string | null = null;
  let currentState: XiangqiGameState | null = null;
  let shown: Exact | null = null;
  let inFlight: AbortController | null = null;
  let playMove: ((move: XiangqiMove) => void) | null = null;
  let hoverMove: ((move: XiangqiMove | null) => void) | null = null;

  function hide(): void {
    if (!el.hidden) hoverMove?.(null); // a hidden table must not strand its arrow
    el.hidden = true;
    shown = null;
    table.replaceChildren();
  }

  function setState(state: XiangqiGameState | null): void {
    const key = state ? standardXiangqiPositionKey(state) : null;
    if (key !== null && key === currentKey) return;
    currentKey = key;
    currentState = state;
    inFlight?.abort();
    inFlight = null;
    // Hide at once: the previous position's table is wrong for this one, and a
    // stale table that a click would play from is worse than a blank moment.
    hide();
    if (state?.status.type !== 'playing') return;
    const controller = new AbortController();
    inFlight = controller;
    void lookup(state, controller.signal)
      .catch((): XiangqiTablebaseResponse => ({ status: 'none' }))
      .then((response) => {
        if (controller.signal.aborted || currentKey !== key) return;
        inFlight = null;
        if (response.status !== 'exact') return;
        render(response);
      });
  }

  function render(data: Exact): void {
    const state = currentState;
    if (state?.status.type !== 'playing') return;
    shown = data;
    summary.textContent = positionSummary(data, state.status.turn);
    const style = currentXiangqiNotationStyle();
    table.replaceChildren(
      ...data.moves.map((row) =>
        moveRow(row, formatXiangqiMove(state, { from: row.from, to: row.to }, style), {
          play: (move) => playMove?.(move),
          hover: (move) => hoverMove?.(move),
        }),
      ),
    );
    el.hidden = false;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener(xiangqiNotationChangedEvent, () => {
      if (shown) render(shown);
    });
  }

  return {
    el,
    setState,
    onPlayMove(handler) {
      playMove = handler;
    },
    onHoverMove(handler) {
      hoverMove = handler;
    },
  };
}

/** "Red wins, mate in 5" / "Draw", for the side to move at the panel's position. */
function positionSummary(data: Exact, turn: 'red' | 'black'): string {
  if (data.result === 'draw') return t('watch.draw');
  const winner = data.result === 'win' ? turn : turn === 'red' ? 'black' : 'red';
  const side = t(winner === 'red' ? 'watch.redWins' : 'watch.blackWins');
  if (data.dtm === null) return side;
  const moves = xiangqiTablebaseMateMoves(data.dtm);
  return `${side} · ${t('analysis.tablebase.mateIn', { moves })}`;
}

function moveRow(
  row: XiangqiTablebaseMove,
  label: string,
  handlers: { play: (move: XiangqiMove) => void; hover: (move: XiangqiMove | null) => void },
): HTMLElement {
  const move: XiangqiMove = { from: row.from, to: row.to };
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `xq-tablebase__row xq-tablebase__row--${row.result}`;
  el.dataset.move = `${row.from}${row.to}`;
  el.dataset.result = row.result;

  const name = document.createElement('span');
  name.className = 'xq-tablebase__move';
  name.textContent = label;

  const distance = document.createElement('span');
  distance.className = 'xq-tablebase__dtm';
  if (row.dtm !== null && row.result !== 'draw') {
    const moves = xiangqiTablebaseMateMoves(row.dtm);
    distance.textContent = t(
      row.result === 'win' ? 'analysis.tablebase.mateIn' : 'analysis.tablebase.matedIn',
      {
        moves,
      },
    );
  }

  const badge = document.createElement('span');
  badge.className = `xq-tablebase__badge xq-tablebase__badge--${row.result}`;
  badge.textContent = t(`analysis.tablebase.${row.result}`);

  el.append(name, distance, badge);
  el.addEventListener('click', () => handlers.play(move));
  el.addEventListener('mouseenter', () => handlers.hover(move));
  el.addEventListener('mouseleave', () => handlers.hover(null));
  return el;
}
