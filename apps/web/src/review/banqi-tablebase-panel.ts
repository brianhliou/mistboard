// Banqi tablebase panel: every legal move of a covered endgame with its exact
// result, best first, the banqi counterpart of xiangqi-tablebase-panel.ts.
// Clicking a row plays the move; hovering one previews it as an arrow.
//
// Covered means every piece on the board is face up and the material is one
// the site ships (chariot and horse against chariot, horse and soldier, and
// everything a capture reaches from there; packages/game
// banqi-endgame-tablebase.ts). The check runs on the position before anything
// is fetched, so a position with a single face-down tile never asks for a file
// and never builds a row: a tile's identity cannot reach the table, the fetch
// or the DOM.
//
// The panel is INVISIBLE unless the position is covered. There is no loading
// state and no error line: a file that fails to load reads as "not covered".
//
// It mounts through the tree-review `explorer` slot (the book button opens
// it), relabelled "Tablebase" for banqi, which has no opening book. Files are
// fetched only while the pane is open.
//
// Results are from the side to move's view in the site's good / bad for the
// mover grammar (teal / grey / violet, never red or green), and the header
// names the winning side outright ("Black wins in 67").

import './banqi-tablebase-panel.css';
import {
  type BanqiGameState,
  type BanqiMove,
  type BanqiTablebaseAnswer,
  type BanqiTablebaseResult,
  type BanqiTablebaseRow,
  type BanqiTablebaseTable,
  banqiTablebaseKeysFor,
  DEFAULT_NO_PROGRESS_PLY_LIMIT,
  readBanqiTablebase,
} from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { type BanqiTablebaseLoader, loadBanqiTablebase } from './banqi-tablebase-client.js';

export type BanqiTablebasePanel = {
  el: HTMLElement;
  /** Point the panel at a position; null hides it. Resolves true once THIS
   *  position's table is showing, false for a position that is not covered,
   *  a pane that is closed, or a position the reader already left. */
  setState(state: BanqiGameState | null): Promise<boolean>;
  /** Whether the pane is open. Closed, it fetches nothing and remembers the
   *  latest position for when it opens. */
  setActive(active: boolean): void;
  onPlayMove(handler: (move: BanqiMove) => void): void;
  onHoverMove(handler: (move: BanqiMove | null, result: BanqiTablebaseResult | null) => void): void;
};

export function createBanqiTablebasePanel(
  load: BanqiTablebaseLoader = loadBanqiTablebase,
): BanqiTablebasePanel {
  const el = document.createElement('section');
  el.className = 'bq-tablebase';
  el.setAttribute('aria-label', t('analysis.tablebase.title'));
  el.hidden = true;

  let active = false;
  let pending: BanqiGameState | null = null;
  let token = 0;
  let answer: Promise<boolean> = Promise.resolve(false);
  let playMove: ((move: BanqiMove) => void) | null = null;
  let hoverMove: ((move: BanqiMove | null, result: BanqiTablebaseResult | null) => void) | null =
    null;

  function hide(): void {
    if (!el.hidden) hoverMove?.(null, null); // a hidden table must not strand its arrow
    el.hidden = true;
    el.replaceChildren();
  }

  function show(state: BanqiGameState | null): Promise<boolean> {
    const mine = ++token;
    hide();
    // Coverage is decided on the position alone, before any fetch: a face-down
    // tile anywhere, or material outside the shipped set, ends it here.
    const keys = state ? banqiTablebaseKeysFor(state) : [];
    if (!state || keys.length === 0) {
      answer = Promise.resolve(false);
      return answer;
    }
    answer = Promise.all(keys.map((key) => load(key).catch(() => null))).then((loaded) => {
      if (mine !== token) return false;
      const tables = new Map<string, BanqiTablebaseTable>();
      keys.forEach((key, i) => {
        const table = loaded[i];
        if (table) tables.set(key, table);
      });
      // Past the clock (study and analysis boards only) the rule has already
      // drawn the game, so the rows carry the plain results and no clock tags.
      const pastClock = state.noProgressClock >= DEFAULT_NO_PROGRESS_PLY_LIMIT;
      const data = readBanqiTablebase(
        state,
        (key) => tables.get(key),
        pastClock ? Number.POSITIVE_INFINITY : DEFAULT_NO_PROGRESS_PLY_LIMIT,
      );
      if (!data) return false;
      render(state, data);
      return true;
    });
    return answer;
  }

  function render(state: BanqiGameState, data: BanqiTablebaseAnswer): void {
    const head = document.createElement('div');
    head.className = 'bq-tablebase__head';
    const title = document.createElement('span');
    title.className = 'bq-tablebase__title';
    title.textContent = t('analysis.tablebase.title');
    const verdict = document.createElement('span');
    verdict.className = 'bq-tablebase__verdict';
    verdict.textContent = positionVerdict(data);
    head.append(title, verdict);

    const parts: HTMLElement[] = [head];
    const count = keepCount(data);
    if (count) {
      const summary = document.createElement('div');
      summary.className = 'bq-tablebase__summary';
      summary.textContent = count;
      parts.push(summary);
    }
    if (state.noProgressClock >= DEFAULT_NO_PROGRESS_PLY_LIMIT) {
      // Only a study or analysis board gets here: it plays on past the clock.
      const note = document.createElement('div');
      note.className = 'bq-tablebase__note';
      note.textContent = t('analysis.banqiTablebase.pastClock', {
        count: state.noProgressClock - DEFAULT_NO_PROGRESS_PLY_LIMIT,
      });
      parts.push(note);
    } else if (data.clockDraw && data.dtz !== null) {
      const note = document.createElement('div');
      note.className = 'bq-tablebase__note';
      note.textContent = t('analysis.banqiTablebase.positionClockDraw', {
        count: data.dtz,
        left: DEFAULT_NO_PROGRESS_PLY_LIMIT - state.noProgressClock,
      });
      parts.push(note);
    }

    const table = document.createElement('div');
    table.className = 'bq-tablebase__table';
    table.append(
      ...data.rows.map((row) =>
        moveRow(row, {
          play: (move) => playMove?.(move),
          hover: (move, result) => hoverMove?.(move, result),
        }),
      ),
    );
    const foot = document.createElement('p');
    foot.className = 'bq-tablebase__foot';
    foot.textContent = t('analysis.banqiTablebase.footnote');
    el.replaceChildren(...parts, table, foot);
    el.hidden = false;
  }

  return {
    el,
    setState(state) {
      if (!active) {
        pending = state;
        token += 1; // a lookup still in flight is for a position no longer shown
        hide();
        answer = Promise.resolve(false);
        return answer;
      }
      return show(state);
    },
    setActive(next) {
      if (active === next) return;
      active = next;
      if (!active) {
        token += 1;
        hide();
        return;
      }
      const state = pending;
      pending = null;
      void show(state);
    },
    onPlayMove(handler) {
      playMove = handler;
    },
    onHoverMove(handler) {
      hoverMove = handler;
    },
  };
}

/** "Black wins in 67" / "Draw", from the board's view rather than the mover's. */
function positionVerdict(data: BanqiTablebaseAnswer): string {
  if (data.result === 'draw' || data.dtm === null) return t('watch.draw');
  const winner = data.result === 'win' ? data.moverInk : data.moverInk === 'red' ? 'black' : 'red';
  const side = t(winner === 'red' ? 'replay.red' : 'replay.black');
  return t('analysis.banqiTablebase.sideWinsIn', { side, count: data.dtm });
}

/** "2 of 9 moves keep the win", for the side that has something to keep. */
function keepCount(data: BanqiTablebaseAnswer): string | null {
  const total = data.rows.length;
  if (data.result === 'win') {
    const count = data.rows.filter((row) => row.result === 'win').length;
    return t('analysis.banqiTablebase.keepWin', { count, total });
  }
  if (data.result === 'draw') {
    const count = data.rows.filter((row) => row.result === 'draw').length;
    return t('analysis.banqiTablebase.holdDraw', { count, total });
  }
  return null;
}

function moveRow(
  row: BanqiTablebaseRow,
  handlers: {
    play: (move: BanqiMove) => void;
    hover: (move: BanqiMove | null, result: BanqiTablebaseResult | null) => void;
  },
): HTMLElement {
  const move: BanqiMove = { from: row.move.from, to: row.move.to };
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `bq-tablebase__row bq-tablebase__row--${row.result}`;
  el.dataset.move = `${move.from}${move.to}`;
  el.dataset.result = row.result;
  if (row.clockDraw) el.dataset.clockDraw = '';

  const name = document.createElement('span');
  name.className = 'bq-tablebase__move';
  // The move list's own label (banqi-tree-adapter moveLabel).
  name.textContent = `${move.from}-${move.to}`;

  const distance = document.createElement('span');
  distance.className = 'bq-tablebase__distance';
  if (row.result !== 'draw' && row.dtm !== null) {
    const parts = [
      t(
        row.result === 'win' ? 'analysis.banqiTablebase.winsIn' : 'analysis.banqiTablebase.losesIn',
        {
          count: row.dtm,
        },
      ),
    ];
    if (row.result === 'win' && row.nextCapture !== null) {
      parts.push(t('analysis.banqiTablebase.nextCapture', { count: row.nextCapture }));
    }
    distance.textContent = parts.join(' · ');
  }
  if (row.clockDraw) {
    const clock = document.createElement('span');
    clock.className = 'bq-tablebase__clock';
    clock.textContent = t('analysis.banqiTablebase.clockDraw');
    clock.title = t('analysis.banqiTablebase.clockDrawTitle');
    distance.append(clock);
  }

  const badge = document.createElement('span');
  badge.className = `bq-tablebase__badge bq-tablebase__badge--${row.result}`;
  badge.textContent = t(`analysis.tablebase.${row.result}`);

  el.append(name, distance, badge);
  el.addEventListener('click', () => handlers.play(move));
  el.addEventListener('mouseenter', () => handlers.hover(move, row.result));
  el.addEventListener('mouseleave', () => handlers.hover(null, null));
  return el;
}
