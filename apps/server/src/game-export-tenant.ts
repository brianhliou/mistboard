// PGN/JSON export for variant-tenant games (xiangqi, fog xiangqi, jieqi,
// banqi, fortress xiangqi, jungle, flip jungle): the neutral builders, the
// per-registration binding helper, and the route dispatch.
//
// The chess builders in game-export.ts stay untouched: they label SAN with the
// chess move labeler and key players white/black. Tenants are genuinely
// red/black (persisted as red-wins/black-wins with red/black participants), so
// this module builds an honest publication keyed by the tenant's own colors and
// asks the tenant, through the registry seam, for everything variant-shaped.
//
// `uci` encoding for tenant plies (one scheme, documented once here):
//   board move  "<from><to>"        e.g. "b1b2". The 9x10 xiangqi family writes
//                                   ICCS, the 0-indexed-rank UCI dialect Pikafish
//                                   and the PGN reader speak ("h2e2" for h3-e3).
//   flip        "@<square>"         a face-down tile turned over in place (banqi,
//                                   flip jungle; the event has from === to). The
//                                   identity it reveals is not part of the move.
//   drop        "<ROLE>@<square>"   a piece placed from hand (fortress xiangqi),
//                                   role letter as in the fortress puzzle labels.
//   duck turn   "<from><to>@<duck>" both halves of a Duck Xiangqi turn, e.g.
//                                   "b3e3@e6". A turn capturing the general ends
//                                   the game before the duck moves and writes the
//                                   board move alone.
// `san` is null unless the tenant has a real notation for the ply (xiangqi
// WXF). Clocks-after ride under `<color>_clock_ms_after` for each tenant color.

import {
  exportFormatsForVariant,
  type FortressXiangqiMove,
  fortressXiangqiPuzzleMoveLabel,
  type GameEvent,
  type GameExportFormat,
  isFortressXiangqiDropMove,
} from '@mistboard/game';
import { buildGamePgn, buildGamePublicationJson } from './game-export.js';
import {
  DEFAULT_SITE_HOST,
  JSON_CONTENT_TYPE,
  LICENSE,
  normalizeJsonResult,
  PGN_CONTENT_TYPE,
  type PublicationTimeControl,
  pgnDate,
  pgnEventName,
  pgnResult,
  pgnStandardTermination,
  SCHEMA_VERSION,
  SITE_NAME,
  timeControlFromSummary,
} from './game-export-shared.js';
import type { RecentEveGameRecord } from './persistence.js';
import { postgamePlayers } from './routes/lib.js';
import { eventReplayResponse } from './server-policy.js';
import {
  type TenantExportGame,
  type TenantExportPly,
  type VariantTenantExport,
  type VariantTenantRegistration,
  variantTenantForRoomId,
} from './variant-tenant/registry.js';
import { isTenantEventLog, replayTenantEvents } from './variant-tenant/runtime.js';
import type {
  TenantGameStateLike,
  TenantRoomEvent,
  VariantTenant,
} from './variant-tenant/tenant.js';

// --- move encoders ------------------------------------------------------------

export function boardMoveUci(move: { from: string; to: string }): string {
  return `${move.from}${move.to}`;
}

export function flipUci(square: string): string {
  return `@${square}`;
}

// Flip variants (banqi, flip jungle) spell a flip as the self-move {X, X}.
export function flipOrBoardMoveUci(move: { from: string; to: string }): string {
  return move.from === move.to ? flipUci(move.from) : boardMoveUci(move);
}

// Duck Xiangqi: a move is a TURN, so the encoding has to carry all three
// squares or the export cannot be replayed. "b3e3@e6" is the piece move plus the
// duck's destination, reusing the `@` the flip encoders already spend on a
// square that is placed rather than moved from. A turn that captures the general
// ends the game before the duck moves and carries no third square.
export function duckXiangqiExportUci(move: { from: string; to: string; duckTo: string | null }) {
  return move.duckTo === null ? boardMoveUci(move) : `${boardMoveUci(move)}${flipUci(move.duckTo)}`;
}

// Fortress: drops reuse the puzzle label ("R@d4"); board moves drop the dash.
export function fortressXiangqiExportUci(move: FortressXiangqiMove): string {
  return isFortressXiangqiDropMove(move)
    ? fortressXiangqiPuzzleMoveLabel(move)
    : boardMoveUci(move);
}

// --- registration binding ------------------------------------------------------

export type TenantExportOptions<M, State> = {
  gameRouteBase: string;
  uci: (move: M) => string;
  // Whole-line labeler, so notations that depend on the position (WXF) replay
  // the line once. Omit for tenants with no notation; every `san` is then null.
  san?: (moves: readonly M[]) => readonly (string | null)[];
  // Flip variants: read the ink the first-mover seat bound, off the final state.
  firstMoverInk?: (state: State) => string | null;
  // Tenants with an honest movetext notation bind the PGN writer here.
  writePgn?: (moves: readonly M[]) => NonNullable<TenantExportGame['writePgn']>;
};

// Build a registration's export capability from its tenant. Validation and
// replay are the tenant's own (isTenantEventLog + replayTenantEvents, exactly
// what the postgame routes run), and only a log whose replay ends 'finished'
// yields anything: an in-progress or aborted game returns null, so no move of
// a live fog game can reach the export route.
export function tenantExportBinding<
  Kind extends string,
  C extends string,
  M,
  State extends TenantGameStateLike<C>,
  View,
  Spec extends string,
>(
  tenant: VariantTenant<Kind, C, M, State, View, Spec>,
  options: TenantExportOptions<M, State>,
): VariantTenantExport {
  return {
    gameRouteBase: options.gameRouteBase,
    finishedGame(events, roomId) {
      if (!isTenantEventLog(tenant, events, roomId)) return null;
      const projection = replayTenantEvents(tenant, events);
      if (projection.state.status.type !== 'finished') return null;
      const moveEvents = events.filter(
        (event): event is Extract<TenantRoomEvent<C, M, Spec>, { type: 'move-played' }> =>
          event.type === 'move-played',
      );
      const moves = moveEvents.map((event) => event.move);
      const labels = options.san ? options.san(moves) : null;
      const plies: TenantExportPly[] = moveEvents.map((event, index) => ({
        ply: index + 1,
        mover: event.color,
        uci: options.uci(event.move),
        san: labels?.[index] ?? null,
        clockMsAfter: event.clock ? { ...event.clock.remainingMs } : null,
      }));
      return {
        colors: tenant.colors,
        plies,
        ...(options.firstMoverInk
          ? { firstMoverInk: options.firstMoverInk(projection.state) }
          : {}),
        ...(options.writePgn ? { writePgn: options.writePgn(moves) } : {}),
      };
    },
  };
}

// --- JSON publication ----------------------------------------------------------

export type TenantPublicationPly = {
  ply: number;
  mover: string;
  uci: string;
  san: string | null;
} & Record<`${string}_clock_ms_after`, number | null>;

// Same top-level shape as the chess GamePublication; `players` and the per-ply
// clock keys are named by the tenant's colors instead of white/black.
export type TenantGamePublication = {
  schema_version: string;
  game_id: string;
  source: { name: string; url: string; game_url: string };
  variant: string;
  mode: string;
  time_control: PublicationTimeControl;
  players: Record<string, { handle: string | null }>;
  started_at: string;
  ended_at: string;
  result: string;
  termination: string;
  ply_count: number;
  license: string;
  // Flip variants only: which ink the first-mover seat played (results are
  // recorded by seat).
  first_mover_ink?: string | null;
  plies: TenantPublicationPly[];
};

// Display names by color, through the same private-seat redaction and corpus
// name override the postgame routes apply (a private seat exports as
// 'Anonymous', never its handle). games.white_name / black_name hold the
// first / second mover for every variant, so they are the last fallback.
function playerHandles(
  summary: RecentEveGameRecord,
  colors: readonly string[],
): Record<string, string | null> {
  const players = postgamePlayers(summary.participants ?? [], {
    whiteName: summary.whiteName,
    blackName: summary.blackName,
  });
  const handles: Record<string, string | null> = {};
  colors.forEach((color, index) => {
    const seat = players.find((player) => player.color === color);
    const fallback = index === 0 ? summary.whiteName : summary.blackName;
    handles[color] = seat?.name ?? fallback ?? null;
  });
  return handles;
}

function publicationPlies(game: TenantExportGame): TenantPublicationPly[] {
  return game.plies.map((ply) => {
    const clocks: Record<string, number | null> = {};
    for (const color of game.colors) {
      clocks[`${color}_clock_ms_after`] = ply.clockMsAfter?.[color] ?? null;
    }
    return {
      ply: ply.ply,
      mover: ply.mover,
      uci: ply.uci,
      san: ply.san,
      ...clocks,
    } as TenantPublicationPly;
  });
}

export function buildTenantGamePublicationJson(
  summary: RecentEveGameRecord,
  game: TenantExportGame,
  gameRouteBase: string,
  siteOrigin: string = DEFAULT_SITE_HOST,
): TenantGamePublication {
  const handles = playerHandles(summary, game.colors);
  const players: Record<string, { handle: string | null }> = {};
  for (const color of game.colors) players[color] = { handle: handles[color] ?? null };
  return {
    schema_version: SCHEMA_VERSION,
    game_id: summary.roomId,
    source: {
      name: SITE_NAME,
      url: siteOrigin,
      game_url: `${siteOrigin}${gameRouteBase}/${summary.roomId}`,
    },
    variant: summary.variant,
    mode: summary.mode,
    time_control: timeControlFromSummary(summary),
    players,
    started_at: summary.startedAt.toISOString(),
    ended_at: summary.endedAt.toISOString(),
    result: normalizeJsonResult(summary.result),
    termination: summary.termination,
    ply_count: game.plies.length,
    license: LICENSE,
    ...(game.firstMoverInk !== undefined ? { first_mover_ink: game.firstMoverInk } : {}),
    plies: publicationPlies(game),
  };
}

// --- PGN -----------------------------------------------------------------------

function pgnVariantName(variant: string): string {
  if (variant === 'xiangqi') return 'Xiangqi';
  if (variant === 'dark-xiangqi') return 'Fog Xiangqi';
  return variant;
}

// PGN player tags are the color words capitalized: Red / Black.
function pgnColorTag(color: string): string {
  return color.charAt(0).toUpperCase() + color.slice(1);
}

// Null when the tenant has no honest PGN notation (the route answers 501).
export function buildTenantGamePgn(
  summary: RecentEveGameRecord,
  game: TenantExportGame,
  gameRouteBase: string,
  siteOrigin: string = DEFAULT_SITE_HOST,
): string | null {
  if (!game.writePgn) return null;
  const [first, second] = game.colors;
  const handles = playerHandles(summary, game.colors);
  const termination = summary.termination ?? '';
  const result = pgnResult(summary.result);
  const tags: Record<string, string> = {
    Event: pgnEventName(summary.mode),
    Site: `${siteOrigin}${gameRouteBase}/${summary.roomId}`,
    Date: pgnDate(summary),
    Round: '-',
    [pgnColorTag(first)]: handles[first] ?? '?',
    [pgnColorTag(second)]: handles[second] ?? '?',
    Result: result,
    Variant: pgnVariantName(summary.variant),
    MistboardVariant: summary.variant,
    TimeControl: timeControlFromSummary(summary).label,
    Termination: pgnStandardTermination(termination),
    MistboardTermination: termination,
    License: LICENSE,
    MistboardSchema: SCHEMA_VERSION,
  };
  return game.writePgn(tags, result);
}

// --- route dispatch ------------------------------------------------------------

export type GameExportResponse =
  | { status: 200; format: GameExportFormat; contentType: string; body: string }
  | { status: 403; body: { error: 'game_not_public' } }
  | { status: 404; body: { error: 'not_found' } }
  | { status: 501; body: { error: 'export_not_supported_for_variant'; variant: string } };

function notSupported(variant: string): GameExportResponse {
  return { status: 501, body: { error: 'export_not_supported_for_variant', variant } };
}

const NOT_PUBLIC: GameExportResponse = { status: 403, body: { error: 'game_not_public' } };

// The whole decision behind GET /api/games/:roomId/export.{pgn,json}.
//
// Chess-family logs (the ones the legacy replay accepts as finished) keep the
// path they always had. Everything else resolves its tenant by room id and asks
// that tenant's export binding; the format is gated by the shared table in
// packages/game (export-formats.ts) so the download links and the route agree.
// There is no fallback from one variant's builder to another's: no registration,
// no binding, or a spec mismatch is 501, and a log that does not replay as this
// tenant's finished game is 403.
export function resolveGameExport(args: {
  roomId: string;
  format: GameExportFormat;
  summary: RecentEveGameRecord | null;
  events: readonly unknown[] | null;
  tenantForRoomId?: (roomId: string) => VariantTenantRegistration | null;
}): GameExportResponse {
  const { roomId, format, summary, events } = args;
  if (!summary || !events) return { status: 404, body: { error: 'not_found' } };

  // persistence.loadRoom types every room's log as chess GameEvent[]; the
  // legacy replay inside eventReplayResponse is what actually decides whether
  // the log is a finished chess-family game.
  const chessReplay = eventReplayResponse(events as unknown as GameEvent[]);
  if (chessReplay.status === 200) {
    const chessEvents = chessReplay.body.events;
    if (format === 'pgn') {
      return {
        status: 200,
        format,
        contentType: PGN_CONTENT_TYPE,
        body: buildGamePgn(summary, chessEvents),
      };
    }
    return {
      status: 200,
      format,
      contentType: JSON_CONTENT_TYPE,
      body: JSON.stringify(buildGamePublicationJson(summary, chessEvents)),
    };
  }

  const formats = exportFormatsForVariant(summary.variant);
  const registration = (args.tenantForRoomId ?? variantTenantForRoomId)(roomId);
  const tenantExport = registration?.export ?? null;
  if (!registration || !tenantExport) {
    // No tenant export for this room. A listed variant whose log did not pass
    // the chess replay (an unfinished fog chess game) keeps today's 403;
    // anything unlisted is unsupported.
    return formats.length > 0 ? NOT_PUBLIC : notSupported(summary.variant);
  }
  if (registration.gameSpecId !== summary.variant) return notSupported(summary.variant);
  if (!formats.includes(format)) return notSupported(summary.variant);

  const game = tenantExport.finishedGame(events, roomId);
  if (!game) return NOT_PUBLIC;
  if (format === 'pgn') {
    const pgn = buildTenantGamePgn(summary, game, tenantExport.gameRouteBase);
    if (pgn === null) return notSupported(summary.variant);
    return { status: 200, format, contentType: PGN_CONTENT_TYPE, body: pgn };
  }
  return {
    status: 200,
    format,
    contentType: JSON_CONTENT_TYPE,
    body: JSON.stringify(buildTenantGamePublicationJson(summary, game, tenantExport.gameRouteBase)),
  };
}
