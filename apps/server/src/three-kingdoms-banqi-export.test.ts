/**
 * Three Kingdoms Banqi export (#628, #1002): the downloadable record is the
 * finished public view and nothing more. Two finished games whose deals differ
 * only by swapping two tiles nobody turned over must export byte-identical JSON
 * and PGN; every flip names the piece it turned over; the record replays on its
 * own; and an unfinished game exports nothing.
 *
 * Planted failure: the deal-carrying binding this variant shipped with before
 * #1002 (tenantExportBinding with a dealFen) MUST differ between the two games,
 * so the invariance assertion is known to catch a leak.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyThreeKingdomsBanqiMove,
  type BanqiDeal,
  createThreeKingdomsBanqiSetup,
  createThreeKingdomsBanqiStateFromSetup,
  exportFormatsForVariant,
  getThreeKingdomsBanqiLegalMoves,
  parseHiddenPiecePgn,
  replayHiddenPieceRecord,
  THREE_KINGDOMS_BANQI_SETUP_SQUARES,
  THREE_KINGDOMS_BANQI_SPEC_ID,
  type ThreeKingdomsBanqiMove,
  threeKingdomsBanqiPlyReveal,
  threeKingdomsBanqiStateToDealtFen,
  threeKingdomsBanqiStateToPublicFen,
} from '@mistboard/game';
import {
  buildTenantGamePublicationJson,
  flipOrBoardMoveUci,
  resolveGameExport,
  tenantExportBinding,
} from './game-export-tenant.js';
import type { GameParticipant, RecentEveGameRecord } from './persistence.js';
import './three-kingdoms-banqi-registration.js';
import { threeKingdomsBanqiExport } from './three-kingdoms-banqi-game-export.js';
import {
  type ThreeKingdomsBanqiEvent,
  threeKingdomsBanqiTenant,
} from './three-kingdoms-banqi-tenant.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
import { replayTenantEvents } from './variant-tenant/runtime.js';

process.env.MISTBOARD_THREE_KINGDOMS_BANQI_ENABLED = 'true';

const ROOM = 'tkb_export';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Every capture, quiet moves often, flips otherwise: a line that turns some
// tiles over and leaves others covered.
function playLine(deal: BanqiDeal): ThreeKingdomsBanqiMove[] {
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
  const moves: ThreeKingdomsBanqiMove[] = [];
  for (let ply = 0; ply < 40 && state.status.type === 'playing'; ply += 1) {
    const legal = getThreeKingdomsBanqiLegalMoves(state);
    const captures = legal.filter((m) => m.from !== m.to && state.board[m.to]);
    const quiet = legal.filter((m) => m.from !== m.to && !state.board[m.to]);
    const flips = legal.filter((m) => m.from === m.to);
    const move =
      captures[0] ??
      (ply % 4 !== 0 && quiet.length > 0 ? quiet[(ply * 7) % quiet.length] : undefined) ??
      flips[(ply * 5) % Math.max(flips.length, 1)] ??
      legal[0]!;
    moves.push(move);
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  return moves;
}

function eventsFor(
  deal: BanqiDeal,
  moves: readonly ThreeKingdomsBanqiMove[],
  finished = true,
): ThreeKingdomsBanqiEvent[] {
  const events: ThreeKingdomsBanqiEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM,
      gameSpecId: THREE_KINGDOMS_BANQI_SPEC_ID,
      setup: { deal },
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: 'alice', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM, clientId: 'bob', seat: 'black' },
  ];
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal });
  let at = 10;
  for (const move of moves) {
    if (state.status.type !== 'playing') break;
    const color = state.status.turn;
    events.push({
      type: 'move-played',
      at: at,
      roomId: ROOM,
      color,
      move,
      clock: {
        activeColor: color === 'red' ? 'black' : 'red',
        initialMs: 300_000,
        incrementMs: 5_000,
        runningSince: at,
        remainingMs: { red: 300_000 - at, black: 300_000 - at * 2 },
      },
    } as ThreeKingdomsBanqiEvent);
    at += 1;
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  if (finished && state.status.type === 'playing') {
    events.push({ type: 'seat-resigned', at: 9_999, roomId: ROOM, color: 'red' });
  }
  return events;
}

function participant(color: GameParticipant['color'], displayName: string): GameParticipant {
  return { color, displayName, subjectType: 'user', subjectId: displayName, visibility: 'public' };
}

const summary: RecentEveGameRecord = {
  roomId: ROOM,
  variant: THREE_KINGDOMS_BANQI_SPEC_ID,
  mode: 'pvp',
  result: 'black-wins',
  termination: 'resignation',
  plyCount: 0,
  startedAt: new Date('2026-11-11T10:00:00Z'),
  endedAt: new Date('2026-11-11T10:20:00Z'),
  whiteName: null,
  blackName: null,
  corpusId: null,
  rated: false,
  visibility: 'public',
  participants: [participant('red', 'alice'), participant('black', 'bob')],
  jobId: null,
  gameIndex: null,
  whiteEngineId: null,
  blackEngineId: null,
  timeControl: null,
  initialMs: 300_000,
  incrementMs: 5_000,
};

function exportBody(events: readonly unknown[], format: 'pgn' | 'json'): string {
  const response = resolveGameExport({ roomId: ROOM, format, summary, events });
  assert.equal(response.status, 200, `${format}: ${JSON.stringify(response)}`);
  assert.ok(response.status === 200);
  return response.body;
}

const dealA = createThreeKingdomsBanqiSetup(seeded(1111)).deal;
const moves = playLine(dealA);
const eventsA = eventsFor(dealA, moves);
const finalA = replayTenantEvents(threeKingdomsBanqiTenant, eventsA).state;
const coveredIdx = THREE_KINGDOMS_BANQI_SETUP_SQUARES.flatMap((sq, i) =>
  finalA.board[sq]?.faceDown ? [i] : [],
);
const i = coveredIdx[0]!;
const j = coveredIdx.find(
  (k) => dealA[k]!.color !== dealA[i]!.color || dealA[k]!.role !== dealA[i]!.role,
)!;
const dealB = [...dealA];
[dealB[i], dealB[j]] = [dealA[j]!, dealA[i]!];
const eventsB = eventsFor(dealB, moves);

test('the line is finished, flips and captures, and leaves differing tiles covered', () => {
  assert.equal(finalA.status.type, 'finished');
  assert.ok(j !== undefined, 'two different covered tiles to swap');
  assert.ok(
    moves.some((m) => m.from === m.to),
    'the line flips',
  );
  assert.ok(finalA.captures.length > 0, 'the line captures');
  assert.equal(eventsB.length, eventsA.length, 'the swap leaves the same line legal');
  // The planted difference is real: the stored deals and final truths differ.
  assert.notDeepEqual(eventsA[0], eventsB[0]);
  const finalB = replayTenantEvents(threeKingdomsBanqiTenant, eventsB).state;
  assert.notEqual(
    threeKingdomsBanqiStateToDealtFen(finalA),
    threeKingdomsBanqiStateToDealtFen(finalB),
  );
});

test('TK is listed for JSON and PGN and the registration binds the masked export', () => {
  assert.deepEqual(exportFormatsForVariant(THREE_KINGDOMS_BANQI_SPEC_ID), ['pgn', 'json']);
  const registration = variantTenantForRoomId(ROOM);
  assert.equal(registration?.gameSpecId, THREE_KINGDOMS_BANQI_SPEC_ID);
  assert.equal(registration?.export, threeKingdomsBanqiExport);
  assert.equal(threeKingdomsBanqiExport.gameRouteBase, '/three-kingdoms-banqi/game');
});

test('the whole JSON and PGN exports are byte-identical under a swap of two never-flipped tiles', () => {
  for (const format of ['json', 'pgn'] as const) {
    const a = exportBody(eventsA, format);
    const b = exportBody(eventsB, format);
    assert.equal(a, b, `${format} leaks a never-flipped identity`);
    assert.doesNotMatch(a, /deal|captured_hidden|DealFEN|"setup"/i, format);
  }
});

test('the planted leak: a deal-carrying export differs under the same swap', () => {
  const leaky = tenantExportBinding(threeKingdomsBanqiTenant, {
    gameRouteBase: '/three-kingdoms-banqi/game',
    uci: flipOrBoardMoveUci,
    firstMoverInk: (state) => state.firstColor,
    hiddenPieces: {
      variant: 'three-kingdoms-banqi',
      reveal: threeKingdomsBanqiPlyReveal,
      dealFen: threeKingdomsBanqiStateToDealtFen,
    },
  });
  const json = (events: readonly unknown[]) =>
    JSON.stringify(
      buildTenantGamePublicationJson(
        summary,
        leaky.finishedGame(events, ROOM)!,
        leaky.gameRouteBase,
      ),
    );
  assert.notEqual(json(eventsA), json(eventsB), 'the invariance check can see a deal');
});

test('each flip names the piece it turned over; nothing else is named', () => {
  const record = JSON.parse(exportBody(eventsA, 'json')) as {
    variant: string;
    first_mover_ink: string | null;
    plies: Array<{ uci: string; revealed?: { color: string; role: string } }>;
  };
  assert.equal(record.variant, THREE_KINGDOMS_BANQI_SPEC_ID);
  assert.equal(record.plies.length, moves.length);
  let state = createThreeKingdomsBanqiStateFromSetup(ROOM, { deal: dealA });
  for (const [index, move] of moves.entries()) {
    const ply = record.plies[index]!;
    assert.equal(ply.uci, flipOrBoardMoveUci(move));
    const truth = threeKingdomsBanqiPlyReveal(state, move).revealed;
    assert.deepEqual(ply.revealed ?? null, truth, `ply ${index + 1}`);
    state = applyThreeKingdomsBanqiMove(state, move);
  }
  assert.equal(record.first_mover_ink, finalA.firstColor);
  // A covered tile is never a legal target, so every piece is either named by
  // its flip or still covered at the end, and the covered ones are named nowhere.
  const named = record.plies.filter((p) => p.revealed).length;
  const covered = Object.values(finalA.board).filter((p) => p?.faceDown).length;
  assert.ok(covered >= 2);
  assert.equal(named + covered, THREE_KINGDOMS_BANQI_SETUP_SQUARES.length);
});

test('the JSON and the PGN each replay on their own to the kernel final position', () => {
  const finalFen = threeKingdomsBanqiStateToPublicFen(finalA);
  const json = JSON.parse(exportBody(eventsA, 'json'));
  const fromJson = replayHiddenPieceRecord(json);
  assert.ok(fromJson.ok, JSON.stringify(fromJson));
  assert.equal(fromJson.finalFen, finalFen);
  assert.equal(fromJson.finalDealtFen, null, 'no deal, so no covered tile is named');

  const parsed = parseHiddenPiecePgn(exportBody(eventsA, 'pgn'));
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const fromPgn = replayHiddenPieceRecord(parsed.record);
  assert.ok(fromPgn.ok, JSON.stringify(fromPgn));
  assert.equal(fromPgn.finalFen, finalFen);
  assert.equal(fromPgn.plies, moves.length);
});

test('an unfinished game exports nothing, in either format', () => {
  const live = eventsFor(dealA, moves.slice(0, 12), false);
  assert.equal(replayTenantEvents(threeKingdomsBanqiTenant, live).state.status.type, 'playing');
  assert.equal(threeKingdomsBanqiExport.finishedGame(live, ROOM), null);
  for (const format of ['json', 'pgn'] as const) {
    const response = resolveGameExport({ roomId: ROOM, format, summary, events: live });
    assert.deepEqual(response, { status: 403, body: { error: 'game_not_public' } }, format);
  }
});
