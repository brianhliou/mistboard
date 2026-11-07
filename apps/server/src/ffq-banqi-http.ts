import type { IncomingMessage, ServerResponse } from 'node:http';
import { FFQ_BANQI_SPEC_ID } from '@mistboard/game';
import { currentAccountUser } from './account-session.js';
import { ffqBanqiEnabled } from './feature-flags.js';
import { FFQ_BANQI_ROOM_ID_PREFIX, ffqBanqiAdmits } from './ffq-banqi-access.js';
import * as persistence from './persistence.js';
import { type HttpApiContext, writeJson } from './routes/lib.js';

type ReadContext = Pick<HttpApiContext, 'rooms' | 'inMemoryGameSummary'>;
type Target = { roomId: string; summary: boolean; shell: boolean; ffqPath: boolean };

// Collection endpoints aren't room ids. Keep every descendant of an addressed
// room inside the boundary, including unsupported/future reads and mutations.
const COLLECTIONS = new Set([
  '/api/games/current',
  '/api/games/recent',
  '/api/games/showcase',
  '/api/games/favorites',
  '/api/admin/games/query',
  '/api/correspondence/games/finished',
]);

export function ffqBanqiHttpTarget(url: URL): Target | null {
  const path = url.pathname;
  if (COLLECTIONS.has(path)) return null;
  if (path === '/api/oembed') {
    const embedded = url.searchParams.get('url');
    if (!embedded) return null;
    try {
      const target = ffqBanqiHttpTarget(new URL(embedded, 'http://localhost'));
      return target ? { ...target, summary: false, shell: false } : null;
    } catch {
      return null;
    }
  }
  const game = path.match(/^\/api\/(?:([^/]+)\/)?games\/([^/]+)(.*)$/);
  const room = path.match(/^\/api\/(?:[^/]+\/)?rooms\/([^/]+)(?:\/.*)?$/);
  const chat = path.match(/^\/api\/chat\/(?:game|player)\/([^/]+)(?:\/.*)?$/);
  const page = path.match(/^(?:\/([^/]+))?\/(?:game|room)\/([^/]+)(?:\/.*)?$/);
  const og = path.match(/^\/og\/game\/([^/]+)\.png$/);
  const queryRoom =
    path === '/api/admin/lifecycle'
      ? url.searchParams.get('roomId')?.trim()
      : ['/api/watch', '/api/watch/live', '/watch', '/embed/tv'].includes(path)
        ? url.searchParams.get('room')
        : null;
  const segment = game?.[2] ?? room?.[1] ?? chat?.[1] ?? og?.[1] ?? page?.[2];
  if (!segment && !queryRoom) return null;
  let roomId: string;
  try {
    // Match downstream decoding: query parameters have already been decoded.
    roomId = segment ? decodeURIComponent(segment) : queryRoom!;
  } catch {
    // An invalid addressed id is closed before any handler can decode/load it.
    roomId = '';
  }
  return {
    roomId,
    summary: !!game && !game[3] && (!game[1] || game[1] === FFQ_BANQI_SPEC_ID),
    shell: /^\/room\/[^/]+\/?$/.test(path),
    ffqPath: game?.[1] === FFQ_BANQI_SPEC_ID || page?.[1] === FFQ_BANQI_SPEC_ID,
  };
}

// Invoked BEFORE API route dispatch or HTML/OG/static handling. FFQ never
// falls through to another variant's serializer, even for an enabled admin.
// Owned review, export and card serializers run only after this gate.
export async function guardFFQBanqiHttpRead(
  ctx: ReadContext,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
): Promise<boolean> {
  const target = ffqBanqiHttpTarget(url);
  if (!target) return false;
  const { roomId } = target;
  const reserved = !roomId || roomId.startsWith(FFQ_BANQI_ROOM_ID_PREFIX) || target.ffqPath;
  const live = reserved ? null : ctx.rooms?.get(roomId);
  // Every persisted FFQ room is minted with the reserved prefix. Identity
  // checks must not add a database read to other variants' HTTP requests.
  const isFFQ = reserved || live?.gameSpecId === FFQ_BANQI_SPEC_ID;
  if (roomId && !isFFQ) return false;

  // Neither successful private summaries nor refusals may survive a flag or
  // account change in a shared cache. All closed doors have the same body.
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('x-robots-tag', 'noindex');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  const refuse = () => {
    writeJson(response, 404, { error: 'not_found' });
    return true;
  };
  const path = url.pathname;
  const review = /^\/ffq-banqi\/game\/[^/]+\/?$/.test(path);
  const replay = /^\/api\/ffq-banqi\/games\/[^/]+$/.test(path);
  const publication = /^\/api\/games\/[^/]+\/export\.(pgn|json)$/.test(path);
  const card = /^\/og\/game\/[^/]+\.png$/.test(path);
  if (
    (!target.summary && !target.shell && !review && !replay && !publication && !card) ||
    request.method !== 'GET'
  )
    return refuse();
  if (!ffqBanqiEnabled() || !ffqBanqiAdmits(await currentAccountUser(request))) return refuse();
  // Only these owned serializers may run after the gate. Aliases, raw events,
  // artifacts, embeds and all other descendants remain closed.
  if (review || replay || publication || card) return false;
  // Continue through the normal static shell only AFTER authorization, keeping
  // the private cache/robots headers. Other alias pages remain closed.
  if (target.shell) return false;

  const game =
    ctx.inMemoryGameSummary?.(roomId) ??
    (persistence.isInitialized() ? await persistence.getGameSummary(roomId) : null);
  if (!game || game.variant !== FFQ_BANQI_SPEC_ID) return refuse();
  // Explicit allowlist, never spread a record/state/event. Even finished FFQ
  // games retain their hidden identities; setup, deal and artifacts stay out.
  writeJson(response, 200, {
    game: {
      roomId,
      variant: FFQ_BANQI_SPEC_ID,
      mode: game.mode,
      result: game.result,
      termination: game.termination,
      plyCount: game.plyCount,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      rated: false,
    },
  });
  return true;
}
