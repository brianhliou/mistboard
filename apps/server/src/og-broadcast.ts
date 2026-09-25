// Share cards for the xiangqi broadcast pages (issue #454): a game link posted
// in a Discord, a forum or under a video previews as that game's position with
// both players' English names, and an event or round link previews as one of
// its games. The card is the same board card a site game gets
// (og-card-board.ts); the page meta rides the same slot as the tenant games'
// (server-static-pages.ts, liveGameMeta).

import type { ServerResponse } from 'node:http';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  isStandardXiangqiLegalMove,
  standardXiangqiFen,
  type XiangqiBroadcastPlayerTag,
  type XiangqiMove,
} from '@mistboard/game';
import { loadCardArt, renderBoardCard } from './og-card-board.js';
import type { TenantGamePageMeta } from './og-game-tenant.js';
import { resolvePositionOg } from './og-position.js';
import { createPngCache, redirectToDefault, svgToPng, writePng } from './og-raster.js';
import * as persistence from './persistence.js';

export const BROADCAST_OG_IMAGE_VERSION = 1;

const cache = createPngCache(64);

type Named = { name: string; nameEn?: string };

function english(entity: Named): string {
  return entity.nameEn?.trim() || entity.name;
}

/** The position after the last move that replays under standard rules. */
export function broadcastFinalFen(moves: readonly XiangqiMove[]): string {
  let state = createInitialXiangqiState('broadcast-og');
  for (const move of moves) {
    if (state.status.type !== 'playing' || !isStandardXiangqiLegalMove(state, move)) break;
    state = applyStandardXiangqiMove(state, move);
  }
  return standardXiangqiFen(state);
}

function seatScore(result: string, seat: 'red' | 'black'): string | undefined {
  if (result === '1-0') return seat === 'red' ? '1' : '0';
  if (result === '0-1') return seat === 'red' ? '0' : '1';
  if (result === '1/2-1/2') return '½';
  return undefined;
}

export function broadcastOutcome(board: {
  red: XiangqiBroadcastPlayerTag;
  black: XiangqiBroadcastPlayerTag;
  result: string;
  moves: readonly unknown[];
}): string {
  const moves = Math.max(1, Math.ceil(board.moves.length / 2));
  const count = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
  if (board.result === '1-0') return `${english(board.red)} won with Red in ${count}`;
  if (board.result === '0-1') return `${english(board.black)} won with Black in ${count}`;
  if (board.result === '1/2-1/2') return `Drawn in ${count}`;
  return `In play, ${count} so far`;
}

const BOARD_ROUTE = /^\/broadcast\/xiangqi\/board\/([^/]+)$/;
const ROUND_ROUTE = /^\/broadcast\/xiangqi\/([^/]+)\/round\/([^/]+)$/;
const TOUR_ROUTE = /^\/broadcast\/xiangqi\/([^/]+)$/;
// The section's own pages, which the tour route would read as tour slugs.
const SECTION_PAGES = new Set(['board', 'calendar', 'about', 'ops']);

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// The image is served immutable for a year, so the URL names the position:
// the move count changes as a live game moves, and so does the card's URL.
function imagePath(boardId: string, plies: number): string {
  return `/og/broadcast/board/${encodeURIComponent(boardId)}.png?v=${BROADCAST_OG_IMAGE_VERSION}&p=${plies}`;
}

/** Meta for a broadcast game, round or event page, or null when the path is
 *  not one or names nothing stored. */
export async function broadcastPageMeta(pathname: string): Promise<TenantGamePageMeta | null> {
  const boardMatch = BOARD_ROUTE.exec(pathname);
  if (boardMatch) {
    const boardId = decode(boardMatch[1]!);
    const board = boardId ? await persistence.getXiangqiBroadcastBoard(boardId) : null;
    if (!board) return null;
    const tour = await persistence.getXiangqiBroadcastTour(board.tourSlug);
    const rounds = tour ? await persistence.listXiangqiBroadcastRounds(tour.slug) : [];
    const round = rounds.find((entry) => entry.id === board.roundId);
    const where = [round ? english(round) : null, tour ? english(tour) : null].filter(Boolean);
    return {
      title: `${english(board.red)} vs ${english(board.black)}${where.length > 0 ? ` · ${where.join(' · ')}` : ''} | Mistboard`,
      description: `${broadcastOutcome(board)}. Replay it move by move with an engine eval, in English, on Mistboard.`,
      urlPath: pathname,
      imagePath: imagePath(board.id, board.moves.length),
    };
  }
  const roundMatch = ROUND_ROUTE.exec(pathname);
  const tourMatch = roundMatch ? null : TOUR_ROUTE.exec(pathname);
  const slug = decode((roundMatch ?? tourMatch)?.[1] ?? '');
  if (!slug || (tourMatch && SECTION_PAGES.has(slug))) return null;
  const tour = await persistence.getXiangqiBroadcastTour(slug);
  if (!tour) return null;
  const rounds = await persistence.listXiangqiBroadcastRounds(tour.slug);
  const roundId = roundMatch ? decode(roundMatch[2]!) : null;
  // A round link previews one of its games; an event link, a game from its
  // latest round that has one.
  const ordered = roundId ? rounds.filter((entry) => entry.id === roundId) : [...rounds].reverse();
  for (const round of ordered) {
    const boards = await persistence.listXiangqiBroadcastBoards(round.id);
    const shown = boards.find((board) => board.moves.length > 0);
    if (!shown && roundId) break;
    if (!shown) continue;
    const games = `${boards.length} ${boards.length === 1 ? 'game' : 'games'}`;
    return {
      title: roundId
        ? `${english(round)} · ${english(tour)} | Mistboard`
        : `${english(tour)} | Mistboard broadcast`,
      description: roundId
        ? `${games} of ${english(round)}, in English, with an engine eval on every board and the standings, on Mistboard.`
        : `Every game of ${english(tour)} in English, with engine evals, results and standings, on Mistboard.`,
      urlPath: pathname,
      imagePath: imagePath(shown.id, shown.moves.length),
    };
  }
  return null;
}

/** /og/broadcast/board/:id.png: the game's final position, the two players
 *  at their back ranks, the event under them. */
export async function serveBroadcastBoardOgImage(
  boardId: string,
  response: ServerResponse,
  staticDir?: string,
): Promise<void> {
  const board = await persistence.getXiangqiBroadcastBoard(boardId);
  const key = `broadcast-board:v${BROADCAST_OG_IMAGE_VERSION}:${boardId}:${board?.moves.length ?? 0}`;
  const cached = cache.get(key);
  if (cached) {
    writePng(response, cached, 'HIT');
    return;
  }
  const resolved = board ? resolvePositionOg('xiangqi', broadcastFinalFen(board.moves)) : null;
  if (!board || !resolved) {
    redirectToDefault(response);
    return;
  }
  const tour = await persistence.getXiangqiBroadcastTour(board.tourSlug);
  const art = staticDir ? await loadCardArt(staticDir) : new Map<string, string>();
  const redScore = seatScore(board.result, 'red');
  const blackScore = seatScore(board.result, 'black');
  const svg = renderBoardCard(resolved.board, art, {
    players: {
      top: {
        name: english(board.black),
        ink: 'black',
        ...(blackScore ? { score: blackScore } : {}),
      },
      bottom: { name: english(board.red), ink: 'red', ...(redScore ? { score: redScore } : {}) },
      variant: tour ? english(tour) : 'Xiangqi broadcast',
    },
  });
  const png = await svgToPng(svg);
  cache.set(key, png);
  writePng(response, png, 'MISS');
}
