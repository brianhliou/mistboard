// Share cards for variant-tenant games (#368): the page meta a scraper reads on
// /<tenant>/game/:id and /room/:id, and the PNG behind it at /og/game/:id.png.
//
// The fog chess card (og-image.ts serveGameOgImage) draws both fog views of the
// final position. A tenant card draws ONE board, the position card's renderer
// (og-position.ts), framed by the pairing and the result; the position it
// shows is the game's turning point when the review has been analysed, else
// the final position (see cardPly).
//
// Finished games only, twice over: getGameSummary reads completed rows, and the
// tenant's fenAtPly (game-card-tenant.ts) yields nothing for a log that does
// not end finished. A live fog game has no card and no meta.

import type { ServerResponse } from 'node:http';
import { winPercent } from '@mistboard/game';
import { type CardArt, loadCardArt, renderBoardCard } from './og-card-board.js';
import { serveGameOgImage } from './og-image.js';
import { isPositionOgVariant, positionOgVariantLabel, resolvePositionOg } from './og-position.js';
import { escapeXml, OG_FONT, OG_HEIGHT, OG_WIDTH } from './og-primitives.js';
import { createPngCache, redirectToDefault, svgToPng, writePng } from './og-raster.js';
import * as persistence from './persistence.js';
import type { StoredPlyEval } from './persistence-game-analysis.js';
import { postgamePlayers } from './routes/lib.js';
import {
  type VariantTenantCard,
  type VariantTenantRegistration,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';

/** Bumped when the card's LOOK changes so scrapers holding an old PNG under the
 *  immutable Cache-Control re-fetch. The content is fixed per game (finished,
 *  immutable), so nothing else ever needs a bump. */
export const TENANT_GAME_OG_IMAGE_VERSION = 1;

/** Smallest eval swing, in win% points for the side that moved, that counts as
 *  the turning point. Lichess's "mistake" threshold (analysis.ts moveJudgment);
 *  under it the game had no turning point worth a picture and the final
 *  position is the honest card. */
export const CARD_PLY_MIN_SWING = 10;

const CACHE_ENTRIES = 500;
const cache = createPngCache(CACHE_ENTRIES);

/** The three reads a card needs, injectable so tests run without Postgres. */
export type TenantGameCardStore = {
  summary: (roomId: string) => Promise<persistence.GameRecord | null>;
  events: (roomId: string) => Promise<readonly { type: string; roomId: string }[] | null>;
  analysis: (roomId: string, engineId: string, depth: number) => Promise<StoredPlyEval[] | null>;
};

const liveStore: TenantGameCardStore = {
  summary: (roomId) => persistence.getGameSummary(roomId),
  events: (roomId) => persistence.loadRoomEvents(roomId),
  analysis: (roomId, engineId, depth) => persistence.getGameAnalysis(roomId, engineId, depth),
};

// ── The game behind a URL ──────────────────────────────────────────────────────

export type TenantGameCard = {
  registration: VariantTenantRegistration;
  card: VariantTenantCard;
  game: persistence.GameRecord;
  /** Seat display names in the tenant's colour order (first mover first). */
  players: [string, string];
  /** The variant's site name ("Jieqi"). */
  label: string;
  /** "Pikafish won by resignation" / "Drawn by repetition". */
  outcome: string;
  /** Review URL path, the canonical share target. */
  reviewPath: string;
};

/** The finished tenant game a room id names, or null when the id is not a
 *  tenant room, the tenant has no card, or the game is not finished. */
export async function tenantGameCard(
  roomId: string,
  store: TenantGameCardStore = liveStore,
): Promise<TenantGameCard | null> {
  const registration = variantTenantForRoomId(roomId);
  const card = registration?.card;
  const gameRouteBase = registration?.export?.gameRouteBase;
  if (!registration || !card || !gameRouteBase) return null;
  if (!isPositionOgVariant(card.variant)) return null;
  const game = await store.summary(roomId);
  if (!game || game.variant !== registration.gameSpecId) return null;
  const outcome = outcomeLine(game);
  if (!outcome) return null;
  // Tenant participants are written in tenant.colors order
  // (variant-tenant/events.ts buildTenantGameSummary), so the row order IS the
  // first-mover-first order the card wants, without knowing the colours.
  const named = postgamePlayers(game.participants, {
    whiteName: game.whiteName,
    blackName: game.blackName,
  });
  const players: [string, string] = [named[0]?.name ?? 'Player', named[1]?.name ?? 'Player'];
  return {
    registration,
    card,
    game,
    players,
    label: positionOgVariantLabel(card.variant),
    outcome,
    reviewPath: `${gameRouteBase}/${encodeURIComponent(roomId)}`,
  };
}

const TERMINATION_PHRASE: Record<string, string> = {
  checkmate: 'by checkmate',
  resignation: 'by resignation',
  timeout: 'on time',
  'general-captured': 'by capturing the general',
  'king-captured': 'by capturing the king',
  abandonment: 'by abandonment',
  abandoned: 'by abandonment',
  'no-legal-moves': 'on no legal moves',
  stalemate: 'by stalemate',
  repetition: 'by repetition',
  'progress-clock': 'by the no-progress rule',
  'den-entered': 'by entering the den',
};

/** A seat's score for the card: "1" / "0" for a decided game, "½" for a draw,
 *  undefined when the result names no seat. */
export function seatScore(result: string, seat: string): string | undefined {
  if (result === 'draw') return '½';
  const match = /^([a-z]+)-wins$/.exec(result);
  if (!match) return undefined;
  return match[1] === seat ? '1' : '0';
}

/** The result as one clause, naming the winner rather than an ink (a jungle
 *  side is not "Black" on the board). Null for anything that is not a decided
 *  or drawn game, which gets no card. */
export function outcomeLine(game: persistence.GameRecord): string | null {
  const phrase = TERMINATION_PHRASE[game.termination] ?? '';
  const withPhrase = (head: string) => (phrase ? `${head} ${phrase}` : head);
  if (game.result === 'draw') return withPhrase('Drawn');
  const winner = winnerName(game);
  if (!winner) return null;
  return withPhrase(`${winner} won`);
}

function winnerName(game: persistence.GameRecord): string | null {
  const match = /^([a-z]+)-wins$/.exec(game.result);
  if (!match) return null;
  const named = postgamePlayers(game.participants, {
    whiteName: game.whiteName,
    blackName: game.blackName,
  });
  return named.find((player) => player.color === match[1])?.name ?? null;
}

// ── Which ply to draw ─────────────────────────────────────────────────────────

/** The ply whose position the card shows: the position BEFORE the move that
 *  swung the eval the most (a "what happens here?" picture), or the final
 *  position when no analysed swing clears CARD_PLY_MIN_SWING.
 *
 *  Evals are Red-seat POV after `ply` plies, so |Δwin| between consecutive
 *  plies is the mover's loss whichever side moved; parity is not needed.
 *  Unstable plies (parent/child disagreement) are skipped on either side of
 *  the pair rather than trusted. */
export function cardPly(plies: readonly StoredPlyEval[], plyCount: number): number {
  const byPly = new Map<number, StoredPlyEval>();
  for (const entry of plies) {
    if (!entry.unstable && (entry.cp != null || entry.mate != null)) byPly.set(entry.ply, entry);
  }
  let best: { ply: number; swing: number } | null = null;
  for (let ply = 1; ply <= plyCount; ply += 1) {
    const before = byPly.get(ply - 1);
    const after = byPly.get(ply);
    if (!before || !after) continue;
    const swing = Math.abs(winPercent(after.cp, after.mate) - winPercent(before.cp, before.mate));
    if (swing < CARD_PLY_MIN_SWING) continue;
    if (!best || swing > best.swing) best = { ply, swing };
  }
  return best ? best.ply - 1 : plyCount;
}

async function chosenPly(
  entry: TenantGameCard,
  plyCount: number,
  store: TenantGameCardStore,
): Promise<number> {
  const { analysis } = entry.card;
  if (!analysis) return plyCount;
  try {
    const stored = await store.analysis(entry.game.roomId, analysis.engineId, analysis.depth);
    return stored ? cardPly(stored, plyCount) : plyCount;
  } catch {
    return plyCount;
  }
}

// ── Page meta ─────────────────────────────────────────────────────────────────

export type TenantGamePageMeta = {
  title: string;
  description: string;
  /** Canonical link path (the review URL, also for a /room/ request). */
  urlPath: string;
  /** Card path + cache-busting version. */
  imagePath: string;
};

const GAME_PAGE_ROUTE = /^(\/[a-z0-9-]+)?\/game\/([^/]+)$/;
const ROOM_PAGE_ROUTE = /^\/room\/([^/]+)$/;

/** Meta for a tenant game page, or null when the path is not one, names no
 *  finished tenant game, or pairs a tenant's room id with ANOTHER tenant's
 *  route base (fail closed: no card is better than a mislabelled one). */
export async function tenantGamePageMeta(
  pathname: string,
  store: TenantGameCardStore = liveStore,
): Promise<TenantGamePageMeta | null> {
  const gameMatch = GAME_PAGE_ROUTE.exec(pathname);
  const roomMatch = gameMatch ? null : ROOM_PAGE_ROUTE.exec(pathname);
  const encodedId = gameMatch?.[2] ?? roomMatch?.[1];
  if (!encodedId) return null;
  let roomId: string;
  try {
    roomId = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  const entry = await tenantGameCard(roomId, store);
  if (!entry) return null;
  if (gameMatch && `${gameMatch[1] ?? ''}/game` !== entry.registration.export?.gameRouteBase) {
    return null;
  }
  return {
    title: `${entry.players[0]} vs ${entry.players[1]} · ${entry.label} | Mistboard`,
    description: `${entry.outcome} after ${plural(moveCount(entry.game.plyCount), 'move')}. Replay this ${entry.label} game move by move on Mistboard.`,
    urlPath: entry.reviewPath,
    imagePath: `/og/game/${encodeURIComponent(roomId)}.png?v=${TENANT_GAME_OG_IMAGE_VERSION}`,
  };
}

function moveCount(plyCount: number): number {
  return Math.max(1, Math.ceil(plyCount / 2));
}

// ── The image ─────────────────────────────────────────────────────────────────

/** /og/game/:id.png for any room: a tenant room with a card draws here, every
 *  other id (chess rooms, tenants without a card) keeps the fog chess path.
 *  `staticDir` is the web build the piece art is read from. */
export async function serveAnyGameOgImage(
  roomId: string,
  response: ServerResponse,
  staticDir?: string,
): Promise<void> {
  if (variantTenantForRoomId(roomId)?.card) {
    await serveTenantGameOgImage(roomId, response, liveStore, staticDir);
    return;
  }
  await serveGameOgImage(roomId, response);
}

export async function serveTenantGameOgImage(
  roomId: string,
  response: ServerResponse,
  store: TenantGameCardStore = liveStore,
  staticDir?: string,
): Promise<void> {
  const key = `tenant-game:v${TENANT_GAME_OG_IMAGE_VERSION}:${roomId}`;
  const cached = cache.get(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  const entry = await tenantGameCard(roomId, store);
  if (!entry) {
    redirectToDefault(response);
    return;
  }
  const art = staticDir ? await loadCardArt(staticDir) : new Map<string, string>();
  const svg = await renderTenantGameCard(entry, store, art);
  const png = svgToPng(svg);
  cache.set(key, png);
  writePng(response, png, 'MISS');
}

/** The card SVG: the chosen position at full height, the pairing and the
 *  variant beside it (og-card-board.ts). Falls back one ply at a time when a
 *  position will not render (a final position the parser refuses, say a
 *  captured general), and to a board-less card when none does, so a shared
 *  link always resolves to some image. */
export async function renderTenantGameCard(
  entry: TenantGameCard,
  store: TenantGameCardStore = liveStore,
  art: CardArt = new Map(),
): Promise<string> {
  const events = await store.events(entry.game.roomId);
  const plyCount = entry.game.plyCount;
  if (events) {
    // Seats sit level with their back rank: black ink at the top of the board
    // as drawn, red at the bottom. The flip variants bind ink on the first
    // flip, so the card asks the finished state which ink each seat played.
    const inks = entry.card.seatInks(events, entry.game.roomId) ?? {};
    const seated = entry.game.participants.map((participant, index) => ({
      name: entry.players[index] ?? 'Player',
      ink: inks[participant.color] ?? (participant.color === 'black' ? 'black' : 'red'),
      score: seatScore(entry.game.result, participant.color),
    }));
    const black = seated.find((seat) => seat.ink === 'black') ?? seated[1];
    const red = seated.find((seat) => seat.ink === 'red') ?? seated[0];
    const caption = {
      players: {
        top: black ?? { name: 'Player', ink: 'black' as const },
        bottom: red ?? { name: 'Player', ink: 'red' as const },
        variant: entry.label,
      },
    };
    const wanted = await chosenPly(entry, plyCount, store);
    const candidates = [wanted, plyCount, plyCount - 1].filter(
      (ply, index, all) => ply >= 0 && all.indexOf(ply) === index,
    );
    for (const ply of candidates) {
      const fen = entry.card.fenAtPly(events, entry.game.roomId, ply);
      const resolved = fen ? resolvePositionOg(entry.card.variant, fen) : null;
      if (!resolved) continue;
      return renderBoardCard(resolved.board, art, caption);
    }
  }
  return pairingOnlyCard(entry);
}

/** No renderable position: the pairing carries the card. */
function pairingOnlyCard(entry: TenantGameCard): string {
  const line = (y: number, size: number, fill: string, text: string) =>
    `<text x="${OG_WIDTH / 2}" y="${y}" text-anchor="middle" fill="${fill}" font-family="${OG_FONT}" font-size="${size}" font-weight="700">${escapeXml(text)}</text>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_WIDTH}" height="${OG_HEIGHT}" viewBox="0 0 ${OG_WIDTH} ${OG_HEIGHT}">`,
    `<rect width="${OG_WIDTH}" height="${OG_HEIGHT}" fill="#0f1115"/>`,
    line(290, 56, '#f3f4f6', `${truncate(entry.players[0])} vs ${truncate(entry.players[1])}`),
    line(350, 30, '#c9cfc3', entry.label),
    line(560, 22, '#9ca3af', 'mistboard.com'),
    `</svg>`,
  ].join('');
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function truncate(name: string): string {
  return name.length > 24 ? `${name.slice(0, 23)}…` : name;
}
