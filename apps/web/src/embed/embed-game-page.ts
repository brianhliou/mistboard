// /embed/game/:roomId — one finished game, rendered alone, meant to be framed by
// someone else's page.
//
// One card, the same grammar as the study embed: the board column on the left
// (seat bar, board, seat bar, step controls), the move sheet on the right, and
// a credit line back to the review page under the card. That is the whole
// surface: no nav, no engine, no sign-in state. The board is the same renderer
// /watch uses for the same game, resolved by the game's own variant, so every
// variant the site can replay is embeddable without a per-variant branch here.
//
// Only FINISHED games load. The summary endpoint answers 404 for anything still
// in progress and the per-variant postgame endpoints apply the post-terminal
// reveal gate, so a fog game is framed only once its hidden information is
// public everywhere else too.

import '../app-base.css';
import '../review/move-list.css';
import type { EmbedPov, GameEvent } from '@mistboard/game';
import { banqiResultLabel } from '../banqi-result-label.js';
import { displayParticipantName, type FeaturedGame, matchupSeats } from '../game-display.js';
import { gameMetaForGame, reviewUrlForGame } from '../game-meta.js';
import { jungleFlipResultLabel } from '../jungle-flip-result-label.js';
import type { GameMeta, ReplayHandle } from '../replay.js';
import { reviewResultLabel } from '../review/game-review-meta.js';
import { createMoveList, type MoveList } from '../review/move-list.js';
import { showcaseRendererKindForSpec, specIdForShowcaseVariant } from '../showcase-dispatch.js';
import { webVariantTenantForSpecId } from '../variant-tenant/registry.js';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import type { EmbedGameRoute } from './embed-route.js';
import './embed.css';

// Below this frame width the move list drops under the board (mirrors the
// @media rule in embed.css; the two must agree or the board is sized for the
// wrong layout).
const STACK_BELOW_PX = 480;
// Width of the move sheet beside the board. The study widget's floor for the
// same column (articles.css): a move pair at 15px, number included, fits on one
// line. At 168px the shared list truncated every coordinate move to "g3-…".
const RAIL_WIDTH_PX = 226;
// The card's own border, left and right (or top and bottom when stacked).
const CARD_BORDER_PX = 2;
// Two seat bars (name + clock, 39px each) frame the tenant boards, and the
// step-control row sits under the bottom bar. Reserved out of the box height so
// the board never pushes them off the bottom. The chess renderer's board-edge
// clock rows are shorter; the board simply gets a few spare pixels there.
const SEAT_ROWS_PX = 78;
const CONTROLS_PX = 39;
// In the stacked layout the sheet keeps at least this much height: the result
// foot (37px) and three rows of moves (embed.css keeps the same number).
const STACKED_MOVES_MIN_PX = 112;
// Gap between the card and the credit line (.embed-frame in embed.css).
const FRAME_GAP_PX = 6;

export type EmbedGameOptions = {
  /** `?ply=N`: open on this ply rather than the final position. */
  startPly?: number | null;
  /** `?pov=white|black|truth`: which side's view, and which way up. */
  pov?: EmbedPov | null;
};

function note(root: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'embed-note';
  box.textContent = message;
  root.replaceChildren(box);
}

async function loadEvents(roomId: string): Promise<GameEvent[]> {
  const resp = await fetch(`/api/games/${encodeURIComponent(roomId)}/events`);
  if (!resp.ok) throw new Error(`failed to load events for ${roomId}: ${resp.status}`);
  const data = (await resp.json()) as { events: GameEvent[] };
  return data.events;
}

type MountBoardOptions = {
  metadataByRoomId: Record<string, GameMeta>;
  namesByRoomId: Record<string, { first: string; second: string }>;
  onPlyChange: (ply: number, maxPly: number) => void;
  pov: EmbedPov | null;
};

// The same dispatch /watch uses: a tenant with a watch renderer draws its own
// board; everything else is the chessground fallback, rendered as the single
// truth pane (a finished game's truth board is public by definition).
async function mountBoard(
  root: HTMLElement,
  specId: string,
  roomId: string,
  options: MountBoardOptions,
): Promise<ReplayHandle> {
  const kind = showcaseRendererKindForSpec(specId);
  const tenant = kind === 'chess' ? null : webVariantTenantForSpecId(specId);
  if (tenant?.watch) {
    return tenant.watch.mountReplay(root, roomId, {
      autoplay: false,
      compact: true,
      pov: options.pov ?? undefined,
      metadataByRoomId: options.metadataByRoomId,
      namesByRoomId: options.namesByRoomId,
      onGameEnd: () => {},
      onPlyChange: options.onPlyChange,
    });
  }
  const { mountReplay } = await import('../replay.js');
  // The chess path takes the orientation up front and switches the view (a
  // fogged side, or the truth board) through setPov once the game is loaded.
  return mountReplay(root, roomId, {
    autoplay: false,
    orientation: options.pov === 'black' ? 'black' : 'white',
    showControls: false,
    keyboardNav: false,
    revealOnFinish: true,
    clampPace: true,
    metadataMode: 'compact',
    compactClockLayout: 'board-edges',
    endStatusMode: 'clock',
    showCaptures: false,
    hideGameIdPill: true,
    loaderForId: loadEvents,
    metadataByRoomId: options.metadataByRoomId,
    onGameEnd: () => {},
    onPlyChange: options.onPlyChange,
  });
}

// Drawn, not typed, for the same reason the study widget draws its own: the
// media glyphs and the arrows resolve from different fallback fonts, never match
// in weight, and on some platforms the media pair renders as colour emoji.
const ICON = {
  first: '<rect x="3.4" y="4" width="1.7" height="8" rx="0.7"/><path d="M12.6 4.3v7.4L6.5 8z"/>',
  prev: '<path d="M11 4.3v7.4L4.9 8z"/>',
  next: '<path d="M5 4.3v7.4L11.1 8z"/>',
  last: '<rect x="10.9" y="4" width="1.7" height="8" rx="0.7"/><path d="M3.4 4.3v7.4L9.5 8z"/>',
} as const;

function control(icon: keyof typeof ICON, label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'embed-game-control';
  button.setAttribute('aria-label', label);
  button.innerHTML =
    '<svg class="embed-game-control-icon" viewBox="0 0 16 16" width="16" height="16" ' +
    `aria-hidden="true" focusable="false" fill="currentColor">${ICON[icon]}</svg>`;
  button.addEventListener('click', onClick);
  return button;
}

/** "Black wins" rather than the raw `black-wins` token, by ink for the flip
 *  variants (whose seat is not their colour) and by the variant's own seat
 *  colour word for the rest. Same dispatch /watch uses for its queue. */
export function embedResultLabel(
  game: Pick<FeaturedGame, 'variant' | 'result' | 'firstColor'>,
): string {
  if (game.variant === 'banqi') return banqiResultLabel(game.result, game.firstColor ?? null);
  if (game.variant === 'jungle-flip')
    return jungleFlipResultLabel(game.result, game.firstColor ?? null);
  return reviewResultLabel(game.result, game.variant);
}

/** Board width that fits the box: the narrower of the room beside the move
 *  sheet and the room under the seat bars and controls, at the variant's aspect
 *  ratio. Exported so the arithmetic is testable without a layout engine. */
export function fitBoardWidth(
  frame: { width: number; height: number },
  aspect: number,
  stacked: boolean,
): number {
  const availableWidth = frame.width - CARD_BORDER_PX - (stacked ? 0 : RAIL_WIDTH_PX);
  const reservedHeight =
    SEAT_ROWS_PX + CONTROLS_PX + CARD_BORDER_PX + (stacked ? STACKED_MOVES_MIN_PX : 0);
  const availableHeight = frame.height - reservedHeight;
  return Math.max(120, Math.floor(Math.min(availableWidth, availableHeight * aspect)));
}

// The TV frame keeps the compact seat rows (28px each); only the game card
// wears the study's taller bars.
const TV_SEAT_ROWS_PX = 56;

/** Board width for a board that stands alone in the box (the TV embed): the
 *  full width, or the height under the seat rows at the aspect ratio. */
export function fitSoloBoardWidth(
  frame: { width: number; height: number },
  aspect: number,
): number {
  return Math.max(
    120,
    Math.floor(Math.min(frame.width, (frame.height - TV_SEAT_ROWS_PX) * aspect)),
  );
}

export async function mountEmbedGame(
  root: HTMLElement,
  route: EmbedGameRoute,
  options: EmbedGameOptions = {},
): Promise<void> {
  document.body.classList.add('embed-body');
  document.documentElement.dataset.embed = 'game';
  root.className = 'embed-root';
  note(root, 'Loading…');

  let game: FeaturedGame | undefined;
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(route.roomId)}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      // In progress, private, or gone: all read as unavailable, never as broken.
      note(root, 'This game is not available.');
      return;
    }
    game = ((await response.json()) as { game?: FeaturedGame }).game;
  } catch {
    note(root, 'This game could not be loaded.');
    return;
  }
  if (!game || (game as { visibility?: string }).visibility === 'private') {
    note(root, 'This game is not available.');
    return;
  }

  const roomId = game.roomId ?? route.roomId;
  const specId = specIdForShowcaseVariant(game.variant);
  const aspect = boardAspectForSpec(specId);
  const metadataByRoomId: Record<string, GameMeta> = { [roomId]: gameMetaForGame(game) };
  const [firstSeat, secondSeat] = matchupSeats(game);
  const namesByRoomId = {
    [roomId]: {
      first: displayParticipantName(game, firstSeat),
      second: displayParticipantName(game, secondSeat),
    },
  };

  const frame = document.createElement('div');
  frame.className = 'embed-frame';
  const stage = document.createElement('div');
  stage.className = 'embed-game';
  const boardCol = document.createElement('div');
  boardCol.className = 'embed-game-board';
  const boardHost = document.createElement('div');
  boardHost.className = 'embed-board';
  const controls = document.createElement('div');
  controls.className = 'embed-game-controls';
  const status = document.createElement('span');
  status.className = 'embed-game-status';
  boardCol.append(boardHost, controls);
  const rail = document.createElement('div');
  rail.className = 'embed-game-rail';
  const railInner = document.createElement('div');
  railInner.className = 'embed-game-rail-inner';
  const movesRoot = document.createElement('div');
  movesRoot.className = 'embed-game-moves';
  const resultFoot = document.createElement('div');
  resultFoot.className = 'embed-game-result';
  resultFoot.textContent = embedResultLabel(game);
  railInner.append(movesRoot, resultFoot);
  rail.append(railInner);
  stage.append(boardCol, rail);
  frame.append(stage);

  const credit = document.createElement('a');
  credit.className = 'embed-credit';
  credit.href = reviewUrlForGame(game) ?? `/game/${encodeURIComponent(roomId)}`;
  credit.target = '_blank';
  credit.rel = 'noopener';
  const first = namesByRoomId[roomId]?.first ?? '';
  const second = namesByRoomId[roomId]?.second ?? '';
  credit.textContent = `${first} vs ${second} · mistboard.com`;
  frame.append(credit);
  root.replaceChildren(frame);

  let handle: ReplayHandle | null = null;
  let moveList: MoveList | null = null;
  let currentPly = 0;
  let maxPly = 0;
  const clampPly = (ply: number): number => Math.max(0, Math.min(maxPly, ply));
  const jump = (ply: number): void => {
    handle?.jumpToPly?.(clampPly(ply));
  };
  const onPlyChange = (ply: number, max: number): void => {
    currentPly = ply;
    maxPly = max;
    moveList?.update(ply, jump);
    status.textContent = max > 0 ? `${ply} / ${max}` : '';
  };

  // Size the board to the box before the renderer paints, so the first frame
  // is already the right size, and again whenever the host resizes the frame.
  // Measured from the frame, not the card: the card is only as tall as its
  // board column, so its own rect is the answer, not the question.
  const fitBoard = (): void => {
    const rect = frame.getBoundingClientRect();
    const box = { width: rect.width, height: rect.height - credit.offsetHeight - FRAME_GAP_PX };
    if (box.width <= 0 || box.height <= 0) return;
    const stacked = box.width < STACK_BELOW_PX;
    boardCol.style.width = `${fitBoardWidth(box, aspect, stacked)}px`;
  };
  fitBoard();
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(fitBoard).observe(frame);
  }

  try {
    handle = await mountBoard(boardHost, specId, roomId, {
      metadataByRoomId,
      namesByRoomId,
      onPlyChange,
      pov: options.pov ?? null,
    });
  } catch {
    note(root, 'This game could not be loaded.');
    return;
  }
  // The tenant path honoured the pov at mount; the chess path only took the
  // orientation, so ask it for the view here. A game without that view (a
  // perfect-information one has only truth) simply keeps what it showed.
  if (options.pov && handle.availablePovs?.().includes(options.pov)) {
    handle.setPov?.(options.pov);
  }

  const entries = handle.moveEntries?.() ?? [];
  maxPly = handle.plyCount?.() ?? entries.length;
  moveList = createMoveList(entries);
  movesRoot.append(moveList.el);

  controls.append(
    control('first', 'First move', () => jump(0)),
    control('prev', 'Previous move', () => jump(currentPly - 1)),
    status,
    control('next', 'Next move', () => jump(currentPly + 1)),
    control('last', 'Last move', () => jump(maxPly)),
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') jump(currentPly - 1);
    else if (event.key === 'ArrowRight') jump(currentPly + 1);
    else if (event.key === 'Home') jump(0);
    else if (event.key === 'End') jump(maxPly);
    else return;
    event.preventDefault();
  });

  // Land on the requested ply, or the final position: a finished game's embed
  // opens on its result, and the reader steps back from there.
  const start =
    options.startPly === null || options.startPly === undefined ? maxPly : options.startPly;
  if (handle.jumpToPly) jump(start);
  else onPlyChange(clampPly(start), maxPly);

  document.title = `${first} vs ${second} · Mistboard`;
}
