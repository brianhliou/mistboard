// Head-to-head crosstable for the review page (lichess-style): the record of
// THIS room's two seats against each other in THIS variant, plus their most
// recent games. Pure: the route (routes/games.ts) loads the room summary and
// runs the persistence queries; every decision (which pair, whether the record
// may be shown, each game's outcome and review URL) lives here so it is
// testable without Postgres.
//
// Seats. `a` is the room's FIRST seat and `b` its second, reported to the client
// as 'white' / 'black' whatever the variant calls them: the xiangqi family,
// jungle and banqi persist the first seat as 'red'. A game's `outcome` is from
// a's side, so the client never re-derives who won from a variant result
// vocabulary it does not know.

import { DARK_CHESS_SPEC_ID, DARK_DRAFT960_SPEC_ID } from '@mistboard/game';
import type {
  GameParticipant,
  GameParticipantColor,
  GameResult,
  HeadToHeadGameRow,
  HeadToHeadSubject,
  HeadToHeadTally,
} from './persistence-games.js';
import { postgamePlayers } from './routes/lib.js';
import {
  type VariantTenantRegistration,
  variantTenantForRoomId,
  variantTenantForSpecId,
} from './variant-tenant/registry.js';

export const CROSSTABLE_GAME_LIMIT = 20;

export type CrosstableSeat = 'white' | 'black';
export type CrosstableOutcome = 'a' | 'b' | 'draw';
export type CrosstableUnavailableReason = 'guest' | 'private' | 'unsupported';
export type CrosstablePlayer = {
  name: string;
  kind: 'account' | 'engine';
  // Linkable profile identity, at most one set. Sourced from postgamePlayers,
  // so the private-seat redaction that drops the name drops these too.
  handle: string | null;
  botId: string | null;
};
export type CrosstableScore = { a: number; b: number; draws: number; total: number };
export type CrosstableGame = {
  roomId: string;
  reviewUrl: string;
  endedAt: string;
  aSeat: CrosstableSeat;
  outcome: CrosstableOutcome;
};
export type CrosstableResponse =
  | { available: false; reason: CrosstableUnavailableReason }
  | {
      available: true;
      variant: string;
      players: [CrosstablePlayer, CrosstablePlayer];
      score: CrosstableScore;
      games: CrosstableGame[];
    };

export type CrosstablePair = { a: HeadToHeadSubject; b: HeadToHeadSubject };

export type CrosstablePairResolution =
  | { ok: true; pair: CrosstablePair; players: [CrosstablePlayer, CrosstablePlayer] }
  | { ok: false; reason: CrosstableUnavailableReason };

export type CrosstableRoom = {
  roomId: string;
  variant: string;
  participants: readonly GameParticipant[];
};

// The registry seam, injectable so the pure functions are testable without
// loading every tenant registration module.
export type CrosstableTenantLookup = {
  forRoomId: (roomId: string) => Pick<VariantTenantRegistration, 'export'> | null;
  forSpecId: (gameSpecId: string) => Pick<VariantTenantRegistration, 'export'> | null;
};

const REGISTRY_LOOKUP: CrosstableTenantLookup = {
  forRoomId: variantTenantForRoomId,
  forSpecId: variantTenantForSpecId,
};

// The legacy chess stack (fog chess + fog draft960) reviews at /game/:id. It has
// no tenant registration of its own (the dark-chess `dchx_` correspondence
// registration exists but binds no export/route base), so its persisted variant
// strings are listed here explicitly, legacy spellings included. Deliberately an
// allowlist: an unknown variant gets NO review URL, never a guessed one.
const CHESS_STACK_VARIANTS: ReadonlySet<string> = new Set([
  DARK_CHESS_SPEC_ID,
  DARK_DRAFT960_SPEC_ID,
  'fog',
  'draft960',
  'fog-draft960',
]);

// The review URL for a finished game, or null when neither a tenant route base
// nor the chess stack claims it. Room-id prefix first (the room's own tenant),
// then the spec's routing owner (legacy room ids), then the chess allowlist.
export function crosstableReviewUrl(
  roomId: string,
  variant: string,
  lookup: CrosstableTenantLookup = REGISTRY_LOOKUP,
): string | null {
  const routeBase =
    lookup.forRoomId(roomId)?.export?.gameRouteBase ??
    lookup.forSpecId(variant)?.export?.gameRouteBase ??
    null;
  if (routeBase) return `${routeBase}/${encodeURIComponent(roomId)}`;
  if (CHESS_STACK_VARIANTS.has(variant)) return `/game/${encodeURIComponent(roomId)}`;
  return null;
}

type SeatResult = 'white-wins' | 'black-wins' | 'draw';

// A variant's persisted result in SEAT terms: 'white-wins' = the first seat won.
export function seatResultForVariant(result: GameResult, _variant: string): SeatResult {
  // Every red/black variant seats red first, so red's win is the first seat's win.
  if (result === 'red-wins') return 'white-wins';
  if (result === 'white-wins' || result === 'black-wins' || result === 'draw') return result;
  return 'draw';
}

// A persisted seat colour as a crosstable seat: first seat = 'white', second =
// 'black'. Red is the first seat everywhere.
export function crosstableSeatForColor(
  _variant: string,
  color: GameParticipantColor,
): CrosstableSeat | null {
  if (color === 'white') return 'white';
  if (color === 'black') return 'black';
  if (color === 'red') return 'white';
  return null;
}

// A game's result from a's side, given the seat a held in it.
export function crosstableOutcome(
  result: GameResult,
  variant: string,
  aSeat: CrosstableSeat,
): CrosstableOutcome {
  const seatResult = seatResultForVariant(result, variant);
  if (seatResult === 'draw') return 'draw';
  const winner: CrosstableSeat = seatResult === 'white-wins' ? 'white' : 'black';
  return winner === aSeat ? 'a' : 'b';
}

function crosstableSubject(participant: GameParticipant): HeadToHeadSubject | null {
  const kind = postgamePlayers([participant])[0]?.kind;
  if (kind !== 'account' && kind !== 'engine') return null;
  if (!participant.subjectId) return null;
  return { subjectType: participant.subjectType, subjectId: participant.subjectId };
}

// Which pair this room is about, and whether their record may be shown. Checked
// in this order:
//   'unsupported' - the variant has no review route (nothing to link to);
//   'guest'       - a seat with no subject to match on (guest / manual / imported
//                   seats, or a null subject id): no record exists;
//   'private'     - a seat whose participant is redacted on this page; showing a
//                   record against "Anonymous" would name them by their history;
//   'unsupported' - the two seats are the same subject (engine self-play).
export function resolveCrosstablePair(
  room: CrosstableRoom,
  lookup: CrosstableTenantLookup = REGISTRY_LOOKUP,
): CrosstablePairResolution {
  if (!crosstableReviewUrl(room.roomId, room.variant, lookup)) {
    return { ok: false, reason: 'unsupported' };
  }
  const seats = new Map<CrosstableSeat, GameParticipant>();
  for (const participant of room.participants) {
    const seat = crosstableSeatForColor(room.variant, participant.color);
    if (seat && !seats.has(seat)) seats.set(seat, participant);
  }
  const first = seats.get('white');
  const second = seats.get('black');
  if (!first || !second) return { ok: false, reason: 'unsupported' };

  const a = crosstableSubject(first);
  const b = crosstableSubject(second);
  if (!a || !b) return { ok: false, reason: 'guest' };
  if (first.visibility === 'private' || second.visibility === 'private') {
    return { ok: false, reason: 'private' };
  }
  if (a.subjectType === b.subjectType && a.subjectId === b.subjectId) {
    return { ok: false, reason: 'unsupported' };
  }

  const [rowA, rowB] = postgamePlayers([first, second]);
  return {
    ok: true,
    pair: { a, b },
    players: [
      {
        name: rowA!.name,
        kind: rowA!.kind as CrosstablePlayer['kind'],
        handle: rowA!.handle,
        botId: rowA!.botId,
      },
      {
        name: rowB!.name,
        kind: rowB!.kind as CrosstablePlayer['kind'],
        handle: rowB!.handle,
        botId: rowB!.botId,
      },
    ],
  };
}

// The response body from the resolved pair plus the persistence rows. A listed
// game with no review URL or an unmappable seat colour is dropped from `games`
// (it still counts in `score`, which is the whole record).
export function buildCrosstable(args: {
  variant: string;
  players: [CrosstablePlayer, CrosstablePlayer];
  games: readonly HeadToHeadGameRow[];
  tallies: readonly HeadToHeadTally[];
  lookup?: CrosstableTenantLookup;
}): CrosstableResponse {
  const lookup = args.lookup ?? REGISTRY_LOOKUP;
  const score: CrosstableScore = { a: 0, b: 0, draws: 0, total: 0 };
  for (const tally of args.tallies) {
    const aSeat = crosstableSeatForColor(args.variant, tally.aColor);
    if (!aSeat) continue;
    const outcome = crosstableOutcome(tally.result, args.variant, aSeat);
    if (outcome === 'a') score.a += tally.count;
    else if (outcome === 'b') score.b += tally.count;
    else score.draws += tally.count;
    score.total += tally.count;
  }

  const games: CrosstableGame[] = [];
  for (const row of args.games) {
    const aSeat = crosstableSeatForColor(args.variant, row.aColor);
    const reviewUrl = crosstableReviewUrl(row.roomId, args.variant, lookup);
    if (!aSeat || !reviewUrl) continue;
    games.push({
      roomId: row.roomId,
      reviewUrl,
      endedAt: row.endedAt.toISOString(),
      aSeat,
      outcome: crosstableOutcome(row.result, args.variant, aSeat),
    });
  }

  return { available: true, variant: args.variant, players: args.players, score, games };
}
