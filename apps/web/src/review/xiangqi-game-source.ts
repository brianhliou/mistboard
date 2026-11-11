// Resolve a Mistboard game link into moves a study chapter can hold.
//
// This is the "add the game I am looking at to the study I am already in" half
// of the import story: the PGN tab covers games that live in a file, and this
// covers the ones that live on the site. Lichess's chapter dialog has the same
// pair (a PGN tab and a game-URL tab), for the same reason.
//
// Three surfaces publish standard-xiangqi games and each has its own read API,
// so the mapping from URL to moves lives here rather than being reinvented at
// the call site. No new server route: every one of these endpoints is already
// what its own page fetches.

import type { XiangqiMove } from '@mistboard/game';
import { t } from '../i18n/catalog.js';
import { currentLocale } from '../i18n/locale.js';

export type XiangqiGameSourceKind = 'mistboard' | 'historical' | 'broadcast';

export interface XiangqiGameSource {
  kind: XiangqiGameSourceKind;
  id: string;
}

export interface XiangqiGameSourceResult {
  /** Derived chapter name: players when the game has them, else the event. */
  name: string;
  moves: XiangqiMove[];
}

export type XiangqiGameFetch =
  | { ok: true; game: XiangqiGameSourceResult }
  | { ok: false; error: string };

// Accepts a full URL, a path, or a bare id. A bare id is routed by its prefix,
// which is how the ids are already spelled everywhere else: xq_… is a played
// room, hxq_… an archive game.
const ROUTES: Array<{ kind: XiangqiGameSourceKind; pattern: RegExp }> = [
  { kind: 'mistboard', pattern: /\/xiangqi\/game\/([^/?#]+)/ },
  { kind: 'historical', pattern: /\/historical-xiangqi\/game\/([^/?#]+)/ },
  { kind: 'broadcast', pattern: /\/broadcast\/xiangqi\/board\/([^/?#]+)/ },
];

/** Parse a link (or bare id) into a source, or null when it names nothing we
 *  can read. Deliberately strict: a silent wrong guess would import the wrong
 *  game, which is worse than refusing. */
export function parseXiangqiGameSource(input: string): XiangqiGameSource | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  for (const route of ROUTES) {
    const match = route.pattern.exec(trimmed);
    if (match?.[1]) return { kind: route.kind, id: decodeURIComponent(match[1]) };
  }
  if (/^xq_[\w-]+$/.test(trimmed)) return { kind: 'mistboard', id: trimmed };
  if (/^hxq_[\w-]+$/.test(trimmed)) return { kind: 'historical', id: trimmed };
  return null;
}

/** Fetch the moves behind a parsed source. Never throws. */
export async function fetchXiangqiGameSource(source: XiangqiGameSource): Promise<XiangqiGameFetch> {
  try {
    switch (source.kind) {
      case 'mistboard':
        return await fetchPlayedGame(source.id);
      case 'historical':
        return await fetchArchiveGame(source.id);
      case 'broadcast':
        return await fetchBroadcastBoard(source.id);
    }
  } catch {
    return { ok: false, error: t('review.gameSource.loadFailed') };
  }
}

async function fetchPlayedGame(roomId: string): Promise<XiangqiGameFetch> {
  const response = await fetch(`/api/xiangqi/games/${encodeURIComponent(roomId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return { ok: false, error: notFound(response.status) };
  const body = (await response.json()) as {
    // Seat names hang off the GAME, not off the response root; reading the root
    // silently produced "Xiangqi game" for every real game.
    game?: { plyCount?: number; players?: Array<{ color?: string; name?: string }> };
    timeline?: Array<{ type: string; move?: XiangqiMove }>;
  };
  const moves = (body.timeline ?? [])
    .filter((entry) => entry.type === 'move-played' && entry.move)
    .map((entry) => entry.move as XiangqiMove);
  if (moves.length === 0) return { ok: false, error: t('review.gameSource.noMovesYet') };
  // Xiangqi stores its first seat as 'red'; 'white' is the chess-family
  // spelling the shared layer sometimes uses (see jungle_flip_seat_vs_ink_disc).
  const seat = (color: string): string | undefined =>
    body.game?.players?.find((player) => player.color === color)?.name;
  return {
    ok: true,
    game: {
      name:
        pairName(seat('red') ?? seat('white'), seat('black')) ??
        t('review.gameSource.fallbackName'),
      moves,
    },
  };
}

async function fetchArchiveGame(gameId: string): Promise<XiangqiGameFetch> {
  const response = await fetch(`/api/historical-xiangqi/games/${encodeURIComponent(gameId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return { ok: false, error: notFound(response.status) };
  const body = (await response.json()) as {
    game?: {
      moves?: XiangqiMove[];
      redNameRaw?: string | null;
      blackNameRaw?: string | null;
      eventName?: string | null;
    };
  };
  const moves = body.game?.moves ?? [];
  if (moves.length === 0) return { ok: false, error: t('review.gameSource.noMoves') };
  const players = pairName(
    body.game?.redNameRaw ?? undefined,
    body.game?.blackNameRaw ?? undefined,
  );
  const event = body.game?.eventName?.trim();
  return {
    ok: true,
    game: {
      name:
        event && players
          ? t('review.gameSource.eventName', { players, event })
          : event || players || t('review.gameSource.fallbackName'),
      moves,
    },
  };
}

async function fetchBroadcastBoard(boardId: string): Promise<XiangqiGameFetch> {
  const response = await fetch(`/api/xiangqi/broadcasts/boards/${encodeURIComponent(boardId)}`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return { ok: false, error: notFound(response.status) };
  const body = (await response.json()) as {
    board?: {
      moves?: XiangqiMove[];
      red?: { name?: string; nameEn?: string };
      black?: { name?: string; nameEn?: string };
    };
  };
  const moves = body.board?.moves ?? [];
  if (moves.length === 0) return { ok: false, error: t('review.gameSource.boardNoMovesYet') };
  const red = body.board?.red;
  const black = body.board?.black;
  return {
    ok: true,
    game: {
      name:
        pairName(broadcastName(red), broadcastName(black)) ?? t('review.gameSource.fallbackName'),
      moves,
    },
  };
}

// Choose a recorded name, never transliterate or convert its script ourselves.
function broadcastName(player: { name?: string; nameEn?: string } | undefined): string | undefined {
  return currentLocale() === 'en'
    ? player?.nameEn?.trim() || player?.name
    : player?.name?.trim() || player?.nameEn;
}

// "vs", not a dash: engine seats carry their level in the name
// ("Fairy-Stockfish - Level 4"), so a dash separator produced
// "Fairy-Stockfish - Level 4 - test1", which reads as three players.
function pairName(red: string | undefined, black: string | undefined): string | undefined {
  const left = red?.trim();
  const right = black?.trim();
  return left && right ? t('review.gameSource.matchup', { red: left, black: right }) : undefined;
}

function notFound(status: number): string {
  if (status === 404) return t('review.gameSource.notFound');
  if (status === 401 || status === 403) return t('review.gameSource.private');
  return t('review.gameSource.loadFailed');
}
