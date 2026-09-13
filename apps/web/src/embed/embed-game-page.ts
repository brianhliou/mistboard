// /embed/game/:roomId — one finished game, rendered alone, meant to be framed by
// someone else's page.
//
// The card is the shared embed card (embed-card.ts): the same one the study
// embed sits in, so a game and a study framed side by side are one object with
// two boards. This page supplies what the card needs to know about a GAME: the
// header (variant and clock), the two seats with their inks, the result, the
// credit link, and the board, which is the same renderer /watch uses for the
// same game, resolved by the game's own variant, so every variant the site can
// replay is embeddable without a per-variant branch here.
//
// Only FINISHED games load. The summary endpoint answers 404 for anything still
// in progress and the per-variant postgame endpoints apply the post-terminal
// reveal gate, so a fog game is framed only once its hidden information is
// public everywhere else too.

import '../app-base.css';
import type { EmbedPov, GameEvent } from '@mistboard/game';
import { banqiResultLabel } from '../banqi-result-label.js';
import { seatInkForVariant } from '../flip-seat-ink.js';
import {
  displayParticipantName,
  type FeaturedGame,
  matchupSeats,
  variantDisplayLabel,
} from '../game-display.js';
import { gameMetaForGame, reviewUrlForGame, timeControlLabelForGame } from '../game-meta.js';
import { jungleFlipResultLabel } from '../jungle-flip-result-label.js';
import type { GameMeta, ReplayHandle } from '../replay.js';
import { reviewResultLabel } from '../review/game-review-meta.js';
import { showcaseRendererKindForSpec, specIdForShowcaseVariant } from '../showcase-dispatch.js';
import { seatInkFamily } from '../variant-seat-label.js';
import { webVariantTenantForSpecId } from '../variant-tenant/registry.js';
import { boardAspectForSpec } from '../watch-board-aspect.js';
import { embedRailWidthPx, mountEmbedCard } from './embed-card.js';
import type { EmbedGameRoute } from './embed-route.js';
import './embed.css';

export { fitBoardWidth } from './embed-card.js';

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
// board; everything else is the chessground fallback.
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
  // The chess path draws three panes (white's view, truth, black's view) and
  // embed.css shows one of them. A side's pov renders that side's own pane and
  // keeps it fogged at game end (revealOnFinish false), which is the view the
  // player actually had; anything else is the truth board, revealed. setPov is
  // NOT the mechanism here: it flips a data attribute that only /watch's
  // stylesheet reads, so it did nothing in a frame.
  const side = options.pov === 'white' || options.pov === 'black' ? options.pov : null;
  return mountReplay(root, roomId, {
    autoplay: false,
    orientation: options.pov === 'black' ? 'black' : 'white',
    ...(side ? { panes: { resolver: () => side } } : {}),
    showControls: false,
    keyboardNav: false,
    revealOnFinish: side === null,
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
  const metadataByRoomId: Record<string, GameMeta> = { [roomId]: gameMetaForGame(game) };
  const [firstSeat, secondSeat] = matchupSeats(game);
  const names = {
    first: displayParticipantName(game, firstSeat),
    second: displayParticipantName(game, secondSeat),
  };

  try {
    await mountEmbedCard(root, {
      header: embedGameHeader(game),
      seats: {
        first: { name: names.first, ink: seatDiscInk(game, 'first') },
        second: { name: names.second, ink: seatDiscInk(game, 'second') },
      },
      result: embedResultLabel(game),
      credit: {
        href: reviewUrlForGame(game) ?? `/game/${encodeURIComponent(roomId)}`,
        text: `${names.first} vs ${names.second} · mistboard.com`,
      },
      aspect: boardAspectForSpec(specId),
      railWidthPx: embedRailWidthPx(specId),
      startPly: options.startPly ?? null,
      inkFamily: seatInkFamily(game.variant),
      mountBoard: (host, hooks) =>
        mountBoard(host, specId, roomId, {
          metadataByRoomId,
          namesByRoomId: { [roomId]: names },
          onPlyChange: hooks.onPlyChange,
          pov: options.pov ?? null,
        }),
    });
  } catch {
    note(root, 'This game could not be loaded.');
    return;
  }

  document.title = `${names.first} vs ${names.second} · Mistboard`;
}

/** "Xiangqi · 10 + 5", or the variant alone for an unclocked game. */
export function embedGameHeader(game: FeaturedGame): string {
  const clock = timeControlLabelForGame(game);
  const variant = variantDisplayLabel(game.variant);
  return clock ? `${variant} · ${clock}` : variant;
}

/**
 * The ink a seat's disc paints, or null for a flip variant whose opening flip
 * has not bound a colour (never for a finished game, but the tokens allow it).
 * The seats are move-order slots; the ink is what is on the board, which for
 * banqi and flip jungle is decided by the first flip.
 */
export function seatDiscInk(game: FeaturedGame, side: 'first' | 'second'): string | null {
  const [firstSeat, secondSeat] = matchupSeats(game);
  return seatInkForVariant(
    game.variant,
    side === 'first' ? firstSeat : secondSeat,
    game.firstColor ?? null,
  );
}
