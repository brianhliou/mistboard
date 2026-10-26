// Mistboard TV renderer for Xiangqi Mahjong: the room's own table, stepped one
// recorded view at a time, with the room's hand-by-hand move log and points
// table in the rail.
//
// The generic tenant replay (watch-tenant-replay.ts) assumes a red/black board
// whose turns alternate; a mahjong match is neither, so this is its own small
// mount behind the same ReplayHandle contract.
//
// HIDDEN INFORMATION. Nothing here decides what may be seen: every frame is a
// view the server already shaped for this audience. A live match arrives from
// /api/watch/live as the spectator track (xmjViewFor(state, 'spectator'), hands
// null and no drawn tile while a hand is in play; server
// xiangqi-mahjong-watch.ts), a finished one from /api/xiangqi-mahjong/games/:id,
// where every hand is face up because the match is over. The client renders
// what it is given and never reconstructs a hand.

import type { XmjMove, XmjPlayerView, XmjSeat } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import type { SoundKind } from './live-state.js';
import type { GameMeta, ReplayHandle, ReplayMaterialSlots } from './replay.js';
import type { MoveList } from './review/move-list.js';
import { syncMoveListScroll } from './variant-tenant/chrome-dom.js';
import './xiangqi-mahjong.css';
import { xmjHandLog } from './xiangqi-mahjong-log.js';
import {
  toggleXmjLogHand,
  xiangqiMahjongTableHtml,
  xmjHandsTableHtml,
  xmjLogHtml,
  xmjPoints,
} from './xiangqi-mahjong-table.js';
import { xmjMoveSound } from './xiangqi-mahjong-terminal-sound.js';

/** Autoplay step for a played-back match (no recorded pacing to follow). */
const XMJ_STEP_MS = 900;
const XMJ_END_HOLD_MS = 4000;

export type XmjWatchReplayOptions = {
  autoplay: boolean;
  metadataByRoomId: Record<string, GameMeta>;
  compact?: boolean;
  namesByRoomId?: Record<string, { first: string; second: string }>;
  onGameEnd?: () => void;
  onPlyChange?: (ply: number, maxPly: number) => void;
  live?: boolean;
  loadPostgameOverride?: (
    roomId: string,
  ) => Promise<{ ok: true; postgame: unknown } | { ok: false }>;
  onLoadError?: () => boolean;
};

type XmjFrame = { ply: number; view: XmjPlayerView };

type XmjTimelineEntry = {
  type?: string;
  at?: number;
  color?: string;
  ply?: number;
  move?: XmjMove;
};

/** The two payloads this mount reads: the live frame and the finished game. */
type XmjWatchPayload = {
  game?: { result?: string; termination?: string };
  timeline?: readonly XmjTimelineEntry[];
  seatDisplayNames?: Partial<Record<XmjSeat, string>>;
  // Live: { spectator: frames }. Finished: the frames themselves.
  history?: readonly XmjFrame[] | { spectator?: readonly XmjFrame[] };
};

type LoadedMatch = {
  frames: XmjFrame[];
  moves: Array<{ move: XmjMove; ply: number }>;
  events: XmjTimelineEntry[];
  names: Record<XmjSeat, string>;
  result: string;
};

function isFrame(value: unknown): value is XmjFrame {
  const frame = value as { ply?: unknown; view?: unknown } | null;
  return (
    !!frame &&
    typeof frame.ply === 'number' &&
    !!frame.view &&
    typeof frame.view === 'object' &&
    'hands' in (frame.view as object)
  );
}

/** The frames in ply order, whichever payload carried them. */
export function xmjWatchFrames(payload: XmjWatchPayload): XmjFrame[] {
  const history = payload.history;
  const list = Array.isArray(history)
    ? history
    : ((history as { spectator?: readonly XmjFrame[] } | undefined)?.spectator ?? []);
  return list.filter(isFrame).sort((a, b) => a.ply - b.ply);
}

function seatNames(
  payload: XmjWatchPayload,
  fallback: { first: string; second: string } | undefined,
): Record<XmjSeat, string> {
  const guest = t('live.xmj.guest');
  const given = payload.seatDisplayNames ?? {};
  return {
    east: given.east || fallback?.first || guest,
    west: given.west || fallback?.second || guest,
  };
}

function readMatch(
  payload: XmjWatchPayload,
  fallback: { first: string; second: string } | undefined,
): LoadedMatch | null {
  const frames = xmjWatchFrames(payload);
  if (frames.length === 0) return null;
  const events = (payload.timeline ?? []).filter(
    (entry) => entry.type === 'move-played' && entry.move !== undefined,
  );
  // Plies count the move events in order, as the frames do.
  const moves = events.map((entry, index) => ({ move: entry.move as XmjMove, ply: index + 1 }));
  return {
    frames,
    moves,
    events,
    names: seatNames(payload, fallback),
    result: payload.game?.result ?? 'in-progress',
  };
}

/** What the table needs when laid out at a given width, in unzoomed px. */
export type XmjTableMeasure = { height: number; overflow: number };

/**
 * The zoom that fits a compact table inside its host's box, and the width to
 * lay it out at so it fills that box once zoomed. A feed card is a fixed
 * square narrower than the table wants: unscaled, the bottom rack fell below
 * it and the seat badges spilled past the table's edge, and both were clipped.
 * Laying out wider at a smaller zoom gives the badges their columns back and
 * shrinks tiles and badges together. `overflow` is how far the widest thing
 * reaches past the table's edge on its worse side; the badge columns share
 * any extra width, so each side gets half of it.
 */
export function xmjCompactFit(
  availW: number,
  availH: number,
  measure: (width: number) => XmjTableMeasure,
): { zoom: number; width: number } {
  let zoom = 1;
  for (let pass = 0; pass < 4; pass += 1) {
    const width = availW / zoom;
    const { height, overflow } = measure(width);
    const next = Math.min(zoom, availH / height, availW / (width + 2 * overflow));
    if (next >= zoom - 0.001) break;
    zoom = next;
  }
  return { zoom, width: availW / zoom };
}

export function mountXiangqiMahjongWatchReplay(
  root: HTMLElement,
  initialRoomId: string,
  options: XmjWatchReplayOptions,
): Promise<ReplayHandle> {
  const live = options.live === true;
  let roomId = initialRoomId;
  let match: LoadedMatch | null = null;
  let ply = 0;
  let timer: number | null = null;
  let destroyed = false;
  let loadSeq = 0;
  let log: XmjMoveLog | null = null;

  const board = document.createElement('div');
  // A compact host (the homepage viewer, feed cards) gets a smaller table that
  // keeps to a xiangqi board's footprint: small tiles, the hand's result without
  // its scoring lines.
  board.className = `board xiangqi-mahjong-live-board xmj-watch-board${options.compact ? ' xmj-watch-board--compact' : ''}`;
  // Names sit above and below the felt, as every other variant's board: the
  // spectator's table puts east at the bottom. The clock slot holds the match
  // points, since a frame carries no clocks. A host that has the names in its
  // own chrome hides these rows, as it does for the other variants.
  const seatRow = (seat: XmjSeat) => {
    const row = document.createElement('div');
    row.className = 'showcase-seat';
    row.dataset.seat = seat === 'east' ? 'first' : 'second';
    const nameEl = document.createElement('span');
    nameEl.className = 'showcase-seat-name';
    const clockEl = document.createElement('span');
    clockEl.className = 'showcase-seat-clock';
    row.append(nameEl, clockEl);
    return { seat, row, nameEl, clockEl };
  };
  const seatRows = [seatRow('west'), seatRow('east')] as const;
  const layout = document.createElement('div');
  layout.className = 'replay-layout replay-layout-solo xmj-watch-layout';
  layout.append(seatRows[0].row, board, seatRows[1].row);
  root.replaceChildren(layout);

  const maxPly = (): number => (match ? match.frames.length - 1 : 0);

  const stop = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };

  // A compact host scales the table to its box; a host whose height follows
  // its content measures as fitting and keeps the table at full size.
  let fitted = '';
  const fitToHost = (): void => {
    if (!options.compact || !board.isConnected) return;
    board.style.removeProperty('zoom');
    board.style.removeProperty('width');
    board.style.removeProperty('max-width');
    const availW = board.offsetWidth;
    const shown = [...layout.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement && child.offsetHeight > 0,
    );
    const rows = shown.reduce((sum, child) => sum + child.offsetHeight, 0) - board.offsetHeight;
    // A pixel spare, so a rounded box never clips the rack's bottom edge.
    const availH = root.clientHeight - rows - 1;
    const table = board.querySelector<HTMLElement>('.xmj-table');
    if (!table || availW <= 0 || availH <= 0) return;
    const { zoom, width } = xmjCompactFit(availW, availH, (at) => {
      board.style.width = `${at}px`;
      board.style.maxWidth = 'none';
      const edge = table.getBoundingClientRect();
      let overflow = 0;
      for (const el of table.querySelectorAll<HTMLElement>('.xmj-rack__tag > *')) {
        const box = el.getBoundingClientRect();
        overflow = Math.max(overflow, edge.left - box.left, box.right - edge.right);
      }
      return { height: board.offsetHeight, overflow };
    });
    if (zoom >= 1) {
      board.style.removeProperty('width');
      board.style.removeProperty('max-width');
    } else {
      board.style.width = `${width}px`;
      board.style.maxWidth = 'none';
      board.style.zoom = String(zoom);
    }
    fitted = `${root.clientWidth}x${root.clientHeight}`;
  };
  const resized = new ResizeObserver(() => {
    if (`${root.clientWidth}x${root.clientHeight}` !== fitted) fitToHost();
  });
  if (options.compact) resized.observe(root);

  const render = (): void => {
    if (!match) return;
    const frame = match.frames[Math.max(0, Math.min(ply, maxPly()))];
    if (!frame) return;
    board.innerHTML = xiangqiMahjongTableHtml(frame.view, {
      canAct: false,
      names: match.names,
      now: Date.now(),
    });
    const view = frame.view;
    const winner = view.status.type === 'finished' ? view.status.winner : null;
    for (const { seat, row, nameEl, clockEl } of seatRows) {
      nameEl.textContent = match.names[seat];
      clockEl.textContent = xmjPoints(view.scores[seat]);
      row.classList.toggle(
        'active',
        view.status.type === 'playing' &&
          !view.between &&
          view.phase.type === 'discard' &&
          view.turn === seat,
      );
      row.classList.toggle('result-win', winner === seat);
    }
    fitToHost();
    log?.render(ply);
    options.onPlyChange?.(ply, maxPly());
  };

  const step = (): void => {
    if (destroyed || !match) return;
    if (ply >= maxPly()) {
      timer = window.setTimeout(() => {
        timer = null;
        options.onGameEnd?.();
      }, XMJ_END_HOLD_MS);
      return;
    }
    ply += 1;
    render();
    timer = window.setTimeout(step, XMJ_STEP_MS);
  };

  const fail = (): void => {
    if (options.onLoadError?.()) return;
    const notice = document.createElement('p');
    notice.className = 'watch-empty';
    notice.textContent = t('watch.gameLoadFailed');
    root.replaceChildren(notice);
  };

  const fetchFinished = async (id: string): Promise<XmjWatchPayload | null> => {
    try {
      const response = await fetch(`/api/xiangqi-mahjong/games/${encodeURIComponent(id)}`, {
        credentials: 'same-origin',
      });
      if (!response.ok) return null;
      return (await response.json()) as XmjWatchPayload;
    } catch {
      return null;
    }
  };

  const loadGame = async (
    nextId: string,
    loadOptions?: { initialPly?: number; startAutoplay?: boolean },
  ): Promise<void> => {
    const seq = ++loadSeq;
    stop();
    roomId = nextId;
    let payload: XmjWatchPayload | null = null;
    if (options.loadPostgameOverride) {
      // Live follow. An empty answer falls through to the finished game (the
      // live to finished handoff).
      const overridden = await options
        .loadPostgameOverride(nextId)
        .catch(() => ({ ok: false as const }));
      if (overridden.ok) payload = overridden.postgame as XmjWatchPayload;
    }
    payload ??= await fetchFinished(nextId);
    if (destroyed || seq !== loadSeq) return;
    const loaded = payload ? readMatch(payload, options.namesByRoomId?.[nextId]) : null;
    if (!loaded) {
      fail();
      return;
    }
    if (!layout.isConnected) root.replaceChildren(layout);
    match = loaded;
    log = new XmjMoveLog(() => match, jumpToPly);
    const autoplay = loadOptions?.startAutoplay ?? options.autoplay;
    const wanted = loadOptions?.initialPly;
    // A live frame lands caught up; a feed board lands on the final position;
    // an autoplayed one starts from the deal.
    ply =
      typeof wanted === 'number'
        ? Math.max(0, Math.min(wanted, maxPly()))
        : autoplay && !live
          ? 0
          : maxPly();
    render();
    if (autoplay && !live) timer = window.setTimeout(step, XMJ_STEP_MS);
  };

  function jumpToPly(next: number): void {
    stop();
    ply = Math.max(0, Math.min(Math.trunc(next), maxPly()));
    render();
  }

  const handle: ReplayHandle = {
    activeSampleId: () => roomId,
    destroy: () => {
      destroyed = true;
      stop();
      resized.disconnect();
      root.replaceChildren();
    },
    loadGame,
    updateLoopPool: () => {},
    jumpToPly,
    plyCount: maxPly,
    moveEntries: () => [],
    moveLog: () => log?.list ?? null,
    gameResult: () => match?.result ?? null,
    availablePovs: () => ['truth'],
    moveSoundAtPly: (at: number): SoundKind | null => {
      if (!match || at < 1 || at > match.events.length) return null;
      const matchOver = at === maxPly() && match.result !== 'in-progress';
      return xmjMoveSound(match.events[at - 1], null, matchOver);
    },
    fillMaterial: (slots: ReplayMaterialSlots) => {
      const frame = match?.frames[ply];
      if (!match || !frame) return;
      // The points by hand, as the room's meta card shows them.
      slots.pool.innerHTML = xmjHandsTableHtml(frame.view, match.names);
    },
  };

  return loadGame(initialRoomId).then(() => handle);
}

/**
 * The rail's move list: the room's own hand-by-hand log (xmjLogHtml), behind
 * the MoveList contract the TV rail drives. Earlier hands fold to a line that
 * opens; the hand holding the ply on the board opens by itself. Every heading
 * folds, the latest hand's too.
 */
class XmjMoveLog {
  readonly list: MoveList;
  private readonly el: HTMLOListElement;
  private readonly expanded = new Set<number>();
  private readonly collapsed = new Set<number>();
  private activePly = 0;

  constructor(
    private readonly current: () => LoadedMatch | null,
    private jump: (ply: number) => void,
  ) {
    this.el = document.createElement('ol');
    this.el.className = 'xmj-log xmj-watch-log';
    this.el.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
        '[data-xmj-ply], [data-xmj-hand]',
      );
      if (!target) return;
      const hand = Number(target.dataset.xmjHand);
      if (Number.isInteger(hand) && hand > 0) {
        const wasOpen = target.getAttribute('aria-expanded') === 'true';
        toggleXmjLogHand(hand, wasOpen, this.expanded, this.collapsed);
        this.render(this.activePly);
        return;
      }
      const ply = Number(target.dataset.xmjPly);
      if (Number.isInteger(ply) && ply > 0) this.jump(ply);
    });
    this.list = {
      el: this.el,
      update: (currentPly, jump) => {
        this.jump = jump;
        this.render(currentPly);
      },
      annotate: () => {},
      bindLine: () => {},
      highlightLine: () => {},
    };
  }

  render(activePly: number): void {
    this.activePly = activePly;
    const match = this.current();
    if (!match) return;
    const maxPly = match.frames.length - 1;
    const view = match.frames[maxPly]?.view;
    this.el.innerHTML = xmjLogHtml(xmjHandLog(match.moves), {
      names: match.names,
      viewer: null,
      // Every hand's result so far, as the room's log shows them.
      results: view?.results ?? [],
      activePly,
      expanded: this.expanded,
      collapsed: this.collapsed,
      hasPly: (ply) => ply >= 0 && ply <= maxPly,
    });
    syncMoveListScroll(this.el, { live: activePly >= maxPly, plyCount: maxPly });
  }
}
