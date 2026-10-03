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
//                                   identity it reveals rides beside the move in
//                                   `revealed` (hidden-piece-record.ts).
//   drop        "<ROLE>@<square>"   a piece placed from hand (fortress xiangqi),
//                                   role letter as in the fortress puzzle labels.
//   duck turn   "<from><to>@<duck>" both halves of a Duck Xiangqi turn, e.g.
//                                   "b3e3@e6". A turn capturing the general ends
//                                   the game before the duck moves and writes the
//                                   board move alone.
// `san` is null unless the tenant has a real notation for the ply (xiangqi
// WXF). Clocks-after ride under `<color>_clock_ms_after` for each tenant color.
// Hidden-piece tenants (jieqi, banqi, jungle-flip) add `revealed` and
// `captured_hidden` to a ply that turned a piece over or captured a face-down
// one, and `deal_fen` to a game that had a real deal (#484).

import {
  exportFormatsForVariant,
  type FortressXiangqiMove,
  fortressXiangqiPuzzleMoveLabel,
  type GameEvent,
  type GameExportFormat,
  type HiddenPieceIdentity,
  type HiddenPieceReveal,
  type HiddenPieceVariant,
  isFortressXiangqiDropMove,
  maybeGameSpecForId,
  writeHiddenPiecePgn,
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
  withMovetime,
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
import {
  applyTenantEvent,
  isTenantEventLog,
  replayTenantEvents,
} from './variant-tenant/runtime.js';
import type {
  TenantGameOrigin,
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
  // Hidden-identity variants: squares per color still holding a piece whose
  // identity the game never determined (see TenantExportGame.neverRevealed).
  neverRevealed?: (state: State) => Record<string, string[]> | null;
  // Tenants with an honest movetext notation bind the PGN writer here.
  writePgn?: (moves: readonly M[]) => NonNullable<TenantExportGame['writePgn']>;
  // Hidden-piece tenants (jieqi, banqi, jungle-flip): how a ply's reveals read
  // off the position before it, and the start as the variant's dealt FEN. The
  // binding then writes the reveals into every ply, the deal when it is real,
  // and the hidden-piece PGN (hidden-piece-record.ts).
  hiddenPieces?: {
    variant: HiddenPieceVariant;
    reveal: (before: State, move: M) => HiddenPieceReveal;
    dealFen: (start: State) => string;
  };
};

// A game's deal is real when the room was dealt by this site: a room-created
// `setup` and no import `origin`. An imported match's referee drew each
// identity when the piece was turned over, so the deal stored for it fills the
// never-revealed squares with a completion nobody played; it is never exported.
function exportedDealFen<State>(
  created: { setup?: unknown; origin?: unknown } | undefined,
  start: State,
  dealFen: (start: State) => string,
): string | null {
  if (!created || created.setup === undefined || created.origin) return null;
  const fen = dealFen(start);
  // `?` marks an identity the source never determined (jieqi-fen.ts). A site
  // deal never has one; refuse rather than export a partial deal.
  return fen.includes('?') ? null : fen;
}

function revealFields(reveal: HiddenPieceReveal | null): {
  revealed?: HiddenPieceIdentity;
  capturedHidden?: HiddenPieceIdentity;
} {
  if (!reveal) return {};
  return {
    ...(reveal.revealed ? { revealed: reveal.revealed } : {}),
    ...(reveal.capturedHidden ? { capturedHidden: reveal.capturedHidden } : {}),
  };
}

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
      // Hidden-piece tenants read each ply's reveals off the position before it,
      // replaying the log exactly as replayTenantEvents does.
      const hidden = options.hiddenPieces;
      const reveals: (HiddenPieceReveal | null)[] = [];
      let start: State | null = null;
      if (hidden) {
        let step = replayTenantEvents(tenant, events.slice(0, 1));
        start = step.state;
        for (const event of events.slice(1)) {
          if (event.type === 'move-played') reveals.push(hidden.reveal(step.state, event.move));
          step = applyTenantEvent(tenant, step, event);
        }
      }
      const created = events[0]?.type === 'room-created' ? events[0] : undefined;
      const dealFen = hidden && start ? exportedDealFen(created, start, hidden.dealFen) : null;
      const plies: TenantExportPly[] = moveEvents.map((event, index) => ({
        ply: index + 1,
        mover: event.color,
        uci: options.uci(event.move),
        san: labels?.[index] ?? null,
        clockMsAfter: event.clock ? { ...event.clock.remainingMs } : null,
        ...revealFields(reveals[index] ?? null),
      }));
      const hiddenPgn: TenantExportGame['writePgn'] | undefined = hidden
        ? (tags, result) =>
            writeHiddenPiecePgn({
              variant: hidden.variant,
              tags,
              result,
              dealFen,
              plies: plies.map((ply) => ({
                uci: ply.uci,
                revealed: ply.revealed ?? null,
                captured_hidden: ply.capturedHidden ?? null,
              })),
            })
        : undefined;
      const writePgn = options.writePgn ? options.writePgn(moves) : hiddenPgn;
      return {
        colors: tenant.colors,
        plies,
        ...(options.firstMoverInk
          ? { firstMoverInk: options.firstMoverInk(projection.state) }
          : {}),
        ...(events[0]?.type === 'room-created' && events[0].origin
          ? { origin: events[0].origin }
          : {}),
        ...(options.neverRevealed
          ? { neverRevealed: options.neverRevealed(projection.state) }
          : {}),
        ...(dealFen ? { dealFen } : {}),
        ...(writePgn ? { writePgn } : {}),
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
  // Hidden-piece variants only, and only on a ply that did it: the piece this
  // move turned over, and the face-down piece it captured (jieqi).
  revealed?: HiddenPieceIdentity;
  captured_hidden?: HiddenPieceIdentity;
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
  // Hidden-piece variants only, when the game had a real deal (every site game,
  // never an imported one): the start as the variant's dealt FEN, the public FEN
  // plus a sixth field naming each face-down piece in board order.
  deal_fen?: string;
  // Imported games only (a game played elsewhere, e.g. an off-site engine match):
  //   event: the event it was played in;
  //   credit: the credited work, its authors (as written) and link;
  //   never_revealed: per color, the squares of pieces still face-down at the
  //     end whose identity the source NEVER determined (it dealt at reveal
  //     time). No export states an identity for them; they are unknown, not
  //     hidden. Absent when every identity was determined.
  origin?: {
    event: string;
    credit: NonNullable<TenantGameOrigin['credit']> | null;
    never_revealed?: Record<string, string[]>;
  };
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
      ...(ply.revealed ? { revealed: { ...ply.revealed } } : {}),
      ...(ply.capturedHidden ? { captured_hidden: { ...ply.capturedHidden } } : {}),
      ...clocks,
    } as TenantPublicationPly;
  });
}

function publicationOrigin(game: TenantExportGame): NonNullable<TenantGamePublication['origin']> {
  const origin = game.origin!;
  const neverRevealed = game.neverRevealed;
  const hasUnknown = neverRevealed && Object.values(neverRevealed).some((s) => s.length > 0);
  return {
    event: origin.event,
    credit: origin.credit ?? null,
    ...(hasUnknown
      ? {
          never_revealed: Object.fromEntries(
            Object.entries(neverRevealed).map(([color, squares]) => [color, [...squares]]),
          ),
        }
      : {}),
  };
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
    time_control: withMovetime(timeControlFromSummary(summary), game.origin?.movetimeMs),
    players,
    started_at: summary.startedAt.toISOString(),
    ended_at: summary.endedAt.toISOString(),
    result: normalizeJsonResult(summary.result),
    termination: summary.termination,
    ply_count: game.plies.length,
    license: LICENSE,
    ...(game.firstMoverInk !== undefined ? { first_mover_ink: game.firstMoverInk } : {}),
    ...(game.dealFen ? { deal_fen: game.dealFen } : {}),
    ...(game.origin ? { origin: publicationOrigin(game) } : {}),
    plies: publicationPlies(game),
  };
}

// --- PGN -----------------------------------------------------------------------

// The PGN Variant tag is the variant's public name from the game-spec registry,
// so a newly launched variant's tag cannot be missed (a hand-kept list fell back
// to the raw id for four of them). The raw id only for a string that is no spec.
export function pgnVariantName(variant: string): string {
  return maybeGameSpecForId(variant)?.publicName ?? variant;
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
    TimeControl: withMovetime(timeControlFromSummary(summary), game.origin?.movetimeMs).label,
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
