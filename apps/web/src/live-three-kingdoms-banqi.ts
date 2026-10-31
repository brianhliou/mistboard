// Live room client for Three Kingdoms banqi (三國暗棋, #628): a playtest for
// admin accounts on prod (#684) and for everyone in a local build with
// VITE_THREE_KINGDOMS_BANQI_ENABLED (three-kingdoms-banqi-access.ts). Built on the
// generic live-client core like live-jungle-flip.ts, which it follows closely:
// symmetric hidden identity (the server sends both seats the same masked board),
// seats are move order and the ink binds on the opening flip (view.firstColor),
// so there is no fog and the move list is unmasked.
//
// What is its own: the 9x5 intersection board (three-kingdoms-banqi-diagrams.ts),
// the score race to 100 (each seat's points and captures in a row under the
// board, the target once in the game card, and a moves-left line under the tally
// once the no-progress count nears its limit), and a plain move notation. The
// captures and the face-down tally with reveal odds are banqi's
// (banqi-material.ts): the same 32 pieces, the same never-moved face-down
// tiles. Sounds are banqi's, on this
// room's seats (live-three-kingdoms-banqi-sound.ts). A game that ends glides
// its last move, turns the still-hidden tiles over one by one, then badges the
// generals (Brian, 2026-10-30).

import type {
  BanqiColor,
  BanqiPieceRole,
  BanqiSeat,
  ThreeKingdomsBanqiMove,
  ThreeKingdomsBanqiSquare,
  ThreeKingdomsBanqiStatus,
} from '@mistboard/game';
import './live-xiangqi.css';
import { renderBanqiMaterial } from './banqi-material.js';
import { pieceAnimationDurationMs, pieceFlipDurationMs } from './board-anim.js';
import { flipSeatInk } from './flip-seat-ink.js';
import { placeHiddenPoolUnderBoard } from './hidden-pool-placement.js';
import { t } from './i18n/catalog.js';
import { banqiPieceGhostSvg, banqiRevealFlipSquare } from './live-banqi-render.js';
import { finishBadgesForResult } from './live-finish-badges.js';
import { playSound } from './live-sound.js';
import type { LiveRefs } from './live-state.js';
import {
  maybePlayThreeKingdomsBanqiSound,
  resetThreeKingdomsBanqiSoundState,
} from './live-three-kingdoms-banqi-sound.js';
import { xiangqiAppearanceChangedEvent } from './theme.js';
import {
  animateThreeKingdomsBanqiBoardMove,
  animateThreeKingdomsBanqiReveal,
  renderThreeKingdomsBanqiLiveBoardSvg,
  revealThreeKingdomsBanqiTilesInTurn,
  TK_LIVE_BOARD_VIEW,
  type TkLiveBoardEntry,
} from './three-kingdoms-banqi-diagrams.js';
import { tkMovesLeftLine, tkPoints, tkScoreTarget } from './three-kingdoms-banqi-score.js';
import { installBoardDrag } from './variant-tenant/board-drag.js';
import {
  createTenantLiveClient,
  type TenantLiveClientContext,
  type TenantLiveEvent,
  type TenantMovePlayed,
} from './variant-tenant/live-client.js';
import { adoptLiveHistory } from './variant-tenant/live-history.js';
import type {
  TenantReasonKey,
  TenantSeatKey,
  WebVariantTenant,
} from './variant-tenant/room-chrome.js';
import { installSelectionClickAway } from './variant-tenant/selection-click-away.js';

type Square = ThreeKingdomsBanqiSquare;

// ── Wire shape (mirror ThreeKingdomsBanqiPlayerView) ──────────────────────────

export type ThreeKingdomsBanqiWireView = {
  id: string;
  perspective: BanqiSeat;
  board: Partial<Record<Square, TkLiveBoardEntry>>;
  status: ThreeKingdomsBanqiStatus;
  ply: number;
  moveNumber: number;
  firstColor: BanqiColor | null;
  scores: Record<BanqiSeat, number>;
  noProgressClock: number;
  captured: { owner: BanqiColor; role: BanqiPieceRole }[];
  legalMoves: ThreeKingdomsBanqiMove[];
  lastMove?: ThreeKingdomsBanqiMove;
};

type TkMoveEvent = TenantMovePlayed<BanqiSeat, ThreeKingdomsBanqiMove>;

// ── Interaction/render state ──────────────────────────────────────────────────

let core: TenantLiveClientContext<BanqiSeat, ThreeKingdomsBanqiWireView> | null = null;
let selectedSquare: Square | null = null;
let draggingFrom: Square | null = null;
let roomMode: 'pve' | 'pvp' = 'pvp';
// The board the last live render showed, to know which tiles the final move
// left face down; and how long the finish takes before the badges come up.
let lastLiveBoard: ThreeKingdomsBanqiWireView['board'] | null = null;
let finishHoldMs = 0;

// The end of the game in order: the last move lands, the tiles still face down
// turn over one by one in under a second, then the badges.
const FINISH_PAUSE_MS = 150;
const FINISH_REVEAL_SPAN_MS = 900;
const FINISH_STAGGER_MAX_MS = 70;

function isSeat(value: unknown): value is BanqiSeat {
  return value === 'red' || value === 'black';
}

function seatInk(seat: BanqiSeat, view: ThreeKingdomsBanqiWireView | null): BanqiColor | null {
  return flipSeatInk(seat, view?.firstColor ?? null);
}

function liveSeatInk(seat: BanqiSeat): BanqiColor | null {
  return seatInk(seat, core?.state.view ?? null);
}

function seatLabel(seat: BanqiSeat): TenantSeatKey {
  const ink = liveSeatInk(seat);
  if (ink) return ink === 'red' ? 'setup.red' : 'setup.black';
  return seat === 'red' ? 'setup.first' : 'setup.second';
}

function reasonPhrase(reason: string): TenantReasonKey {
  switch (reason) {
    case 'score':
      return 'result.onPoints';
    case 'no-progress':
      return 'result.noProgress';
    case 'no-legal-move':
      return 'result.noLegalMove';
    case 'timeout':
      return 'result.timeout';
    case 'resignation':
      return 'result.resignation';
    case 'abandonment':
      return 'result.abandonment';
    default:
      return 'result.gameRules';
  }
}

const tkWebTenant: WebVariantTenant<BanqiSeat> = {
  displayName: 'variant.threeKingdomsBanqi.name',
  colors: ['red', 'black'],
  isColor: isSeat,
  oppositeColor: (color) => (color === 'red' ? 'black' : 'red'),
  // The room is gated on the server, never here: its WebSocket refuses a
  // non-admin with 1008 'game spec disabled' (three-kingdoms-banqi-access.ts),
  // and the notice says the playtest is admin-only. A client gate read the
  // admin hint, which a fresh browser does not have yet, and drew a dead room
  // for a real admin. 'room unavailable' keeps the generic no-such-room line.
  enabled: () => true,
  rejectedBodyByReason: { 'game spec disabled': 'live.tk.adminOnly' },
  // The finished game's review page (live-three-kingdoms-banqi-postgame.ts).
  reviewUrl: (roomId) => `/three-kingdoms-banqi/game/${encodeURIComponent(roomId)}`,
  reasonPhrase,
  spectatorBody: 'live.spectatorWatchingGame',
  selectInstruction: 'live.selectBanqi',
  seatLabel,
  seatInk: liveSeatInk,
  showPregameTurn: true,
  // Each seat's points sit under the board with its captures (renderMaterial);
  // the target is said once, in the card.
};

const client = createTenantLiveClient<
  BanqiSeat,
  ThreeKingdomsBanqiWireView,
  ThreeKingdomsBanqiMove
>({
  tenant: tkWebTenant,
  gameSpecId: 'three-kingdoms-banqi',
  defaultRoomId: 'tkb_dev',
  boardClass: 'tk-banqi-live-board',
  chrome: {
    roomMode: () => roomMode,
    variantDetail: () => tkScoreTarget(),
  },
  playAgainRequestBody: (state) => ({
    mode: roomMode,
    gameSpecId: 'three-kingdoms-banqi',
    preferredColor: isSeat(state.seat) ? (state.seat === 'red' ? 'black' : 'red') : 'random',
    ...(state.timeControl ? { timeControl: state.timeControl } : {}),
  }),
  onFrame: (frame) => {
    if (frame.roomMode === 'pve' || frame.roomMode === 'pvp') roomMode = frame.roomMode;
  },
  onSnapshotApplied: () => {
    if (core) maybePlayThreeKingdomsBanqiSound(core.state.view, core.state.seat);
  },
  onEventApplied: () => {
    if (core) maybePlayThreeKingdomsBanqiSound(core.state.view, core.state.seat);
  },
  resetSounds: resetThreeKingdomsBanqiSoundState,
  resetState: () => {
    selectedSquare = null;
    draggingFrom = null;
    roomMode = 'pvp';
    lastLiveBoard = null;
    finishHoldMs = 0;
  },
  // The generals, in the ink each seat bound; a general taken earlier has no
  // badge. TK's own end reasons borrow the labels that say the same thing.
  finishBadges: (view) =>
    view.status.type === 'finished'
      ? finishBadgesForResult({
          colors: tkWebTenant.colors,
          winner: view.status.winner,
          reason: TK_BADGE_REASON[view.status.reason] ?? view.status.reason,
          generalSquare: (seat) => {
            const ink = seatInk(seat, view);
            return ink ? tkGeneralSquare(view.board, ink) : null;
          },
        })
      : [],
  // Read when the badges start, after animateBoard set it for this render.
  get finishBadgeDelayMs() {
    return finishHoldMs;
  },
  renderBoard,
  // Banqi's glides (pieceAnimation pref), live and on scrubs. Unlike banqi,
  // the room's own moves glide too: nothing draws a move before the server
  // echoes it (a dropped piece snaps back to its origin until then), so the
  // echo is the first time the piece moves and gliding it is not a replay.
  animateBoard: (liveRefs, view, takePendingAnimation) => {
    // Only a live pending plays the finish, and the core arms one only while
    // the replay is at the live ply, so the board drawn before it is live too.
    const before = lastLiveBoard;
    lastLiveBoard = view?.board ?? null;
    finishHoldMs = 0;
    if (!view || draggingFrom) return;
    const pending = takePendingAnimation();
    if (!pending) return;
    if (pending.kind === 'live') {
      const flipped = banqiRevealFlipSquare(pending, view.board);
      if (flipped) animateThreeKingdomsBanqiReveal(liveRefs.board, flipped);
      else animateThreeKingdomsBanqiBoardMove(liveRefs.board, pending.move);
      if (view.status.type === 'finished' && before) {
        finishHoldMs = playFinishReveal(liveRefs, view, before, flipped !== null);
        return finishHoldMs;
      }
      // Held for the core: the bot's instant reply waits for the move to land.
      return flipped ? pieceFlipDurationMs() : pieceAnimationDurationMs();
    }
    if (pending.direction === 'forward') {
      const stepped = view.lastMove;
      if (!stepped) return;
      // A step onto a flip turns the tile over, as it did live (and as banqi's
      // replay does).
      if (stepped.from === stepped.to) animateThreeKingdomsBanqiReveal(liveRefs.board, stepped.to);
      else animateThreeKingdomsBanqiBoardMove(liveRefs.board, stepped);
      return;
    }
    const undone = pending.prevView?.lastMove;
    if (undone) animateThreeKingdomsBanqiBoardMove(liveRefs.board, undone, { reverse: true });
  },
  renderExtras: (refs, view) => renderMaterial(refs, view),
  onDisabled: (refs) => {
    renderMaterial(refs, core?.displayedView() ?? null);
    selectedSquare = null;
  },
  setup: (ctx) => {
    core = ctx;
    installInteraction(ctx.refs);
    placeHiddenPoolUnderBoard(ctx.refs);
    // The captured strips and the tally draw in the chosen piece set.
    window.addEventListener(xiangqiAppearanceChangedEvent, ctx.renderAll);
    installSelectionClickAway({
      roots: () => [core?.refs.board],
      hasSelection: () => selectedSquare !== null,
      clearSelection: () => {
        selectedSquare = null;
        draggingFrom = null;
        if (core) renderBoard(core.refs, core.displayedView());
      },
    });
  },
  moveList: {
    rowClass: 'move-row xiangqi-move-row',
    cellPrefix: 'xiangqi-move-row',
    listClass: 'xiangqi-move-list',
    masked: false,
    notate: (move) => notate(move, undefined),
    notateWithView: (move, viewAfter) => notate(move, viewAfter?.board),
    isMoveEvent,
  },
  replayCapture: {
    positionKey: (view) =>
      JSON.stringify({
        board: view.board,
        lastMove: view.lastMove ?? null,
        status: view.status,
        ply: view.ply,
        scores: view.scores,
      }),
    plyForView: (view) => view.ply,
  },
  // The deal is a server secret, so the client never replays the log: the
  // hello carries this viewer's per-ply masked views (live and finished).
  replayHistory: {
    rebuild: ({ events, view, frame }) =>
      adoptLiveHistory(frame.liveHistory, view, events.filter(isMoveEvent).length, {
        finished: true,
      }),
  },
});

export function bootstrapThreeKingdomsBanqiLiveRoom(): void {
  client.bootstrap();
}

const TK_BADGE_REASON: Partial<Record<string, string>> = {
  score: 'points',
  'no-legal-move': 'no-legal-moves',
  agreement: 'draw',
};

/** A finished room shows every tile face up, so the general is found by face. */
function tkGeneralSquare(
  board: ThreeKingdomsBanqiWireView['board'],
  ink: BanqiColor,
): Square | null {
  for (const [square, entry] of Object.entries(board)) {
    if (entry && !entry.faceDown && entry.color === ink && entry.role === 'general') {
      return square as Square;
    }
  }
  return null;
}

/** After the final move: every tile the last live board still showed face
 *  down turns over in turn, once the move has landed. Returns when the badges
 *  may start. */
function playFinishReveal(
  liveRefs: LiveRefs,
  view: ThreeKingdomsBanqiWireView,
  before: ThreeKingdomsBanqiWireView['board'],
  flip: boolean,
): number {
  const landMs = Math.max(0, flip ? pieceFlipDurationMs() : pieceAnimationDurationMs());
  const hidden = new Set<Square>();
  for (const [square, entry] of Object.entries(before)) {
    const now = view.board[square as Square];
    if (entry?.faceDown && now && !now.faceDown && square !== view.lastMove?.to) {
      hidden.add(square as Square);
    }
  }
  const staggerMs = hidden.size
    ? Math.min(FINISH_STAGGER_MAX_MS, FINISH_REVEAL_SPAN_MS / hidden.size)
    : 0;
  const revealEnd = revealThreeKingdomsBanqiTilesInTurn(liveRefs.board, hidden, {
    startMs: landMs + FINISH_PAUSE_MS,
    staggerMs,
  });
  return Math.max(landMs, revealEnd);
}

// ── Notation ──────────────────────────────────────────────────────────────────

// Banqi's letters, so the move list reads like a banqi study (G general, S soldier).
const ROLE_LETTER: Record<BanqiPieceRole, string> = {
  general: 'G',
  advisor: 'A',
  elephant: 'E',
  chariot: 'R',
  horse: 'H',
  cannon: 'C',
  soldier: 'S',
};

// "c2-c4", a capture "c2xc4", and a flip names what it turned up: "c2(H)".
function notate(
  move: ThreeKingdomsBanqiMove,
  boardAfter: Partial<Record<Square, TkLiveBoardEntry>> | undefined,
): string {
  if (move.from === move.to) {
    const entry = boardAfter?.[move.to];
    return entry && !entry.faceDown ? `${move.to}(${ROLE_LETTER[entry.role]})` : `${move.to}()`;
  }
  return `${move.from}-${move.to}`;
}

// ── Material and the no-progress line ─────────────────────────────────────────

// Banqi's material (banqi-material.ts), from this viewer's masked view only:
// the captured strips beside each seat and the face-down tally with reveal odds
// under the board. A finished room serves the truth view, and the move log
// recovers which tiles were still face-down when play ended. Then, once the
// quiet-move count nears the limit, how many moves are left before points
// decide the game.
function renderMaterial(liveRefs: LiveRefs, view: ThreeKingdomsBanqiWireView | null): void {
  const moves = (core?.state.events ?? []).filter(isMoveEvent).map((event) => event.move);
  const bottomSeat: BanqiSeat = core?.orientation() ?? 'red';
  const topSeat: BanqiSeat = bottomSeat === 'red' ? 'black' : 'red';
  const viewerInk = view && core ? seatInk(bottomSeat, view) : null;
  // Banqi's renderer fills scratch hosts; the panel under the board regroups
  // what it drew by seat, so each seat's points, captures and face-down
  // pieces read as one block (Brian, 2026-10-30: two blocks in two orders
  // read as unrelated).
  const topCaptures = document.createElement('div');
  const bottomCaptures = document.createElement('div');
  const pool = document.createElement('div');
  renderBanqiMaterial(
    { capturesTop: topCaptures, capturesBottom: bottomCaptures, hiddenPool: pool },
    view,
    viewerInk,
    moves,
  );
  liveRefs.capturesTop.replaceChildren();
  liveRefs.capturesBottom.replaceChildren();
  const host = liveRefs.hiddenPool;
  host.replaceChildren();
  host.classList.remove('hidden-pool--odds');
  if (!view || Object.keys(view.board).length === 0) return;
  const playing = view.status.type === 'playing';
  const odds = pool.classList.contains('hidden-pool--odds');
  host.classList.toggle('tk-material--odds', odds);
  // The odds caption says what the percentages are; at the end the line's
  // own name says it.
  const caption = pool.querySelector('.hidden-pool__caption');
  if (playing && odds && caption) host.append(caption);
  const bound = liveSeatInk(topSeat) !== null && liveSeatInk(bottomSeat) !== null;
  // One name for the line in play and after it: at the end it still lists
  // what was face-down when play stopped (Brian, 2026-10-30: "Face-down at the
  // end" read oddly mid-game).
  const faceDownKey = t('live.stillFaceDown');
  if (bound) {
    for (const [seat, captures] of [
      [topSeat, topCaptures],
      [bottomSeat, bottomCaptures],
    ] as const) {
      const row = pool.querySelector<HTMLElement>(
        `.hidden-pool__row[data-ink="${liveSeatInk(seat)}"]`,
      );
      host.append(seatBlock(seat, view.scores[seat], captures, row, faceDownKey));
    }
  } else {
    // Before the first flip binds the inks no seat owns a colour and nothing
    // can have been captured: the panel is each ink's face-down pieces, in
    // the seat layout without points.
    for (const row of pool.querySelectorAll<HTMLElement>('.hidden-pool__row')) {
      host.append(inkBlock(row, faceDownKey));
    }
  }
  if (!playing) return;
  const left = tkMovesLeftLine(view.noProgressClock);
  if (!left) return;
  const line = document.createElement('p');
  line.className = 'tk-banqi-moves-left';
  line.textContent = left;
  host.append(line);
}

// One seat under the board: its name (the ink once the opening flip binds
// it) over its points, large enough to read across the table (Brian,
// 2026-10-30: the tag beside the name was too small), then two named lines
// at one disc size: the pieces it took, and its own pieces still face-down.
function seatBlock(
  seat: BanqiSeat,
  points: number,
  captures: HTMLElement,
  poolRow: HTMLElement | null,
  faceDownKey: string,
): HTMLElement {
  const block = document.createElement('div');
  block.className = 'tk-seat';
  block.dataset.seat = seat;
  const ink = liveSeatInk(seat);
  if (ink) block.dataset.ink = ink;
  const head = document.createElement('div');
  head.className = 'tk-seat__head';
  const label = document.createElement('span');
  label.className = 'tk-seat__name';
  label.textContent = t(seatLabel(seat));
  const value = document.createElement('span');
  value.className = 'tk-seat__points';
  value.textContent = tkPoints(points);
  head.append(label, value);
  block.append(head);
  captures.className = 'captures-row review-captures-row tk-seat__pieces';
  if (!captures.querySelector('.review-capture-piece')) captures.replaceChildren(noneMark());
  block.append(seatLine('captured', t('live.tk.captured'), captures));
  block.append(faceDownLine(poolRow, faceDownKey));
  return block;
}

// One ink's face-down pieces before the opening flip, named by the ink.
function inkBlock(poolRow: HTMLElement, faceDownKey: string): HTMLElement {
  const block = document.createElement('div');
  block.className = 'tk-seat';
  if (poolRow.dataset.ink) block.dataset.ink = poolRow.dataset.ink;
  const head = document.createElement('div');
  head.className = 'tk-seat__head';
  const label = document.createElement('span');
  label.className = 'tk-seat__name';
  label.textContent = poolRow.querySelector('.hidden-pool__label')?.textContent ?? '';
  head.append(label);
  block.append(head);
  block.append(faceDownLine(poolRow, faceDownKey));
  return block;
}

// Every seat shows both lines in every state, an empty one saying "None", so
// the panel keeps one shape from the first flip to the end (Brian,
// 2026-10-30: "always show both").
function faceDownLine(poolRow: HTMLElement | null, key: string): HTMLElement {
  const found = poolRow?.querySelector<HTMLElement>('.hidden-pool__pieces');
  const pieces = found ?? document.createElement('div');
  if (!found || pieces.querySelector('.hidden-pool__none')) pieces.replaceChildren(noneMark());
  pieces.classList.add('tk-seat__pieces');
  const line = seatLine('face-down', key, pieces);
  const note = poolRow?.querySelector('.hidden-pool__note');
  if (note) line.append(note);
  return line;
}

function noneMark(): HTMLElement {
  const none = document.createElement('span');
  none.className = 'tk-seat__none';
  none.textContent = t('live.tk.none');
  return none;
}

function seatLine(kind: string, key: string, pieces: HTMLElement): HTMLElement {
  const line = document.createElement('div');
  line.className = 'tk-seat__line';
  line.dataset.line = kind;
  const name = document.createElement('span');
  name.className = 'tk-seat__key';
  name.textContent = key;
  line.append(name, pieces);
  return line;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderBoard(liveRefs: LiveRefs, view: ThreeKingdomsBanqiWireView | null): void {
  liveRefs.board.className = 'board tk-banqi-live-board';
  liveRefs.board.setAttribute('aria-label', 'Three Kingdoms banqi board');
  if (!view) {
    liveRefs.board.replaceChildren();
    return;
  }
  const targets = selectedSquare
    ? view.legalMoves.filter((m) => m.from === selectedSquare && m.to !== m.from).map((m) => m.to)
    : [];
  liveRefs.board.innerHTML = renderThreeKingdomsBanqiLiveBoardSvg(view.board, {
    selected: selectedSquare,
    targets,
    draggingFrom,
    lastMove: view.lastMove ?? null,
    lastMoveInk: lastMoverInk(view),
  });
}

/** The ink of the seat that made the last move. Read after the move, so the
 *  opening flip already has the ink it bound. */
function lastMoverInk(view: ThreeKingdomsBanqiWireView): BanqiColor | null {
  if (!view.lastMove || view.ply < 1) return null;
  return seatInk((view.ply - 1) % 2 === 0 ? 'red' : 'black', view);
}

// ── Interaction ───────────────────────────────────────────────────────────────

function installInteraction(liveRefs: LiveRefs): void {
  installBoardDrag({
    board: liveRefs.board,
    ghostSizePx: () => {
      const width = liveRefs.board.getBoundingClientRect().width;
      return width > 0
        ? (width * TK_LIVE_BOARD_VIEW.cell) / TK_LIVE_BOARD_VIEW.width
        : TK_LIVE_BOARD_VIEW.cell;
    },
    onSquareClick: (square) => {
      const view = core?.state.view;
      if (!view) return;
      handleSquareClick(view, square as Square);
      renderBoard(liveRefs, view);
    },
    canDragFrom: (square) => canDrag(square as Square),
    ghostHtml: (square) => {
      const entry = core?.state.view?.board[square as Square];
      return entry && !entry.faceDown ? banqiPieceGhostSvg(entry) : null;
    },
    onDragStart: (from) => {
      selectedSquare = from as Square;
      draggingFrom = from as Square;
      if (core?.state.view) renderBoard(liveRefs, core.state.view);
    },
    onDrop: (from, to) => drop(liveRefs, from as Square, to as Square | null),
  });
}

function myTurn(view: ThreeKingdomsBanqiWireView): BanqiSeat | null {
  if (!core?.replay.isLive() || core.connection() !== 'connected') return null;
  const seat = core.state.seat;
  if (!isSeat(seat) || view.status.type !== 'playing' || view.status.turn !== seat) return null;
  return seat;
}

function canDrag(square: Square): boolean {
  const view = core?.state.view;
  if (!view) return false;
  const seat = myTurn(view);
  if (!seat) return false;
  const entry = view.board[square];
  const ink = seatInk(seat, view);
  return !!entry && !entry.faceDown && !!ink && entry.color === ink;
}

function sendMove(view: ThreeKingdomsBanqiWireView, move: ThreeKingdomsBanqiMove): void {
  selectedSquare = null;
  core?.send({ type: 'move', from: move.from, to: move.to });
  playSound(move.from === move.to ? 'flip' : view.board[move.to] ? 'capture' : 'move');
}

function drop(liveRefs: LiveRefs, from: Square, to: Square | null): void {
  draggingFrom = null;
  const view = core?.state.view;
  const move =
    to && view
      ? view.legalMoves.find((m) => m.from === from && m.to === to && m.to !== m.from)
      : undefined;
  if (move && view) sendMove(view, move);
  else selectedSquare = null;
  if (core?.state.view) renderBoard(liveRefs, core.state.view);
}

function handleSquareClick(view: ThreeKingdomsBanqiWireView, square: Square): void {
  const seat = myTurn(view);
  if (!seat) {
    selectedSquare = null;
    return;
  }
  const entry = view.board[square];
  if (entry?.faceDown) {
    const flip = view.legalMoves.find((m) => m.from === square && m.to === square);
    if (flip) sendMove(view, flip);
    else selectedSquare = null;
    return;
  }
  const ink = seatInk(seat, view);
  if (entry && !entry.faceDown && ink && entry.color === ink) {
    selectedSquare = square;
    return;
  }
  if (selectedSquare) {
    const move = view.legalMoves.find(
      (m) => m.from === selectedSquare && m.to === square && m.to !== m.from,
    );
    if (move) {
      sendMove(view, move);
      return;
    }
  }
  selectedSquare = null;
}

function isMoveEvent(event: TenantLiveEvent): event is TkMoveEvent {
  const move = (event as { move?: unknown }).move;
  return (
    event.type === 'move-played' &&
    isSeat((event as { color?: unknown }).color) &&
    typeof move === 'object' &&
    move !== null &&
    typeof (move as { from?: unknown }).from === 'string' &&
    typeof (move as { to?: unknown }).to === 'string'
  );
}
