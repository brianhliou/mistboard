// Whole-payload leak tests for a FINISHED jieqi game, one per surface that
// serves it (Brian, 2026-10-16): a piece captured face-down is known only to
// the player who captured it, in every byte sent anywhere, after the game too,
// and a piece never turned face-up stays unknown to everyone.
//
// Each test serializes a surface's whole output for the same finished game
// played from three deals: the standard one; one where the piece Red takes
// face-down on b10 is an elephant instead of a horse; and that one with Red's
// never-moved a1 and b1 swapped too. It asserts:
//   - the output is byte-identical for all three, so it carries neither the dark
//     capture's identity nor any never-moved piece's, in any field, under any
//     name, directly or by elimination;
//   - no role of a piece that never moved is named anywhere it could be.
// The capturer's own seat in the live room is the one place the dark capture
// may differ, and even that seat never learns its own never-moved pieces.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createInitialJieqiState,
  JIEQI_SPEC_ID,
  type JieqiDeal,
  jieqiHomeSquares,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import { buildTenantGamePgn, buildTenantGamePublicationJson } from './game-export-tenant.js';
import { analyzeJieqiDecisions, analyzeJieqiPostgame } from './jieqi-analysis.js';
import type { JieqiEvent } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { RecentEveGameRecord } from './persistence.js';
import {
  clearJieqiWatchPostgameCache,
  jieqiAnalysisInputsFromEvents,
  jieqiPostgameForApi,
  jieqiWatchPostgameForApi,
} from './routes/jieqi-games.js';
import './variant-tenant/register-tenants.js';
import { variantTenantForRoomId } from './variant-tenant/registry.js';
import {
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';

const ROOM_ID = 'jq_leak';

// Red's b3 cannon jumps the b8 screen and takes Black's face-down b10 piece;
// Black's a10 chariot (revealed by moving) takes the cannon back; Red resigns.
function finishedEvents(deal: JieqiDeal): JieqiEvent[] {
  return [
    { type: 'room-created', at: 1, roomId: ROOM_ID, gameSpecId: JIEQI_SPEC_ID, setup: deal },
    { type: 'seat-assigned', at: 2, roomId: ROOM_ID, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM_ID, clientId: 'b', seat: 'black' },
    { type: 'move-played', at: 4, roomId: ROOM_ID, color: 'red', move: { from: 'b3', to: 'b10' } },
    {
      type: 'move-played',
      at: 5,
      roomId: ROOM_ID,
      color: 'black',
      move: { from: 'a10', to: 'b10' },
    },
    { type: 'seat-resigned', at: 6, roomId: ROOM_ID, color: 'red' },
  ];
}

// The standard deal with Black's b10 and c10 swapped: b10 becomes the elephant.
function swappedDeal(): JieqiDeal {
  const home = jieqiHomeSquares('black');
  const black = [...STANDARD_JIEQI_DEAL.black];
  const b10 = home.indexOf('b10');
  const c10 = home.indexOf('c10');
  [black[b10], black[c10]] = [black[c10]!, black[b10]!];
  assert.equal(STANDARD_JIEQI_DEAL.black[b10], 'horse');
  assert.equal(black[b10], 'elephant');
  return { red: [...STANDARD_JIEQI_DEAL.red], black };
}

// ...and Red's never-moved a1 chariot and b1 horse swapped as well.
function swappedRedDeal(): JieqiDeal {
  const deal = swappedDeal();
  const home = jieqiHomeSquares('red');
  const a1 = home.indexOf('a1');
  const b1 = home.indexOf('b1');
  [deal.red[a1], deal.red[b1]] = [deal.red[b1]!, deal.red[a1]!];
  assert.equal(deal.red[a1], 'horse');
  return deal;
}

const DEALS = [STANDARD_JIEQI_DEAL, swappedDeal(), swappedRedDeal()] as const;

function record(): RecentEveGameRecord {
  return {
    roomId: ROOM_ID,
    variant: JIEQI_SPEC_ID,
    mode: 'pvp',
    result: 'black-wins',
    termination: 'resignation',
    plyCount: 2,
    startedAt: new Date(1),
    endedAt: new Date(6),
    whiteName: null,
    blackName: null,
    corpusId: null,
    rated: false,
    visibility: 'public',
    participants: [],
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
  };
}

function deps(deal: JieqiDeal) {
  return {
    getGameSummary: async () => record(),
    loadRoomEvents: async () => finishedEvents(deal),
  };
}

// The only roles a viewer may see named: each general, and the one piece per
// side that moved (Red's b3 cannon, Black's a10 chariot). Every other role was
// dealt face-down and stayed so, and one black piece is the dark capture. A role
// is written as a board entry or a capture, in the JSON forms below.
const NAMEABLE: Record<'red' | 'black', readonly string[]> = {
  red: ['general', 'cannon'],
  black: ['general', 'chariot'],
};
const ROLES = ['general', 'advisor', 'elephant', 'horse', 'chariot', 'cannon', 'soldier'];

function assertNamesNoHiddenPiece(wire: string, label: string): void {
  for (const color of ['red', 'black'] as const) {
    for (const role of ROLES.filter((r) => !NAMEABLE[color].includes(r))) {
      for (const form of [
        `"color":"${color}","role":"${role}"`,
        `"owner":"${color}","role":"${role}"`,
      ]) {
        assert.equal(wire.includes(form), false, `${label}: ${form}`);
      }
    }
  }
}

function assertSameForEveryDeal(label: string, wires: readonly string[]): void {
  for (const [index, wire] of wires.entries()) {
    assert.equal(wire, wires[0], `${label}: deal ${index} changes the payload`);
  }
  assertNamesNoHiddenPiece(wires[0]!, label);
}

function sameForEveryDeal<T>(label: string, build: (deal: JieqiDeal) => T): T {
  const wires = DEALS.map((deal) => JSON.stringify(build(deal)));
  assertSameForEveryDeal(label, wires);
  return JSON.parse(wires[0]!) as T;
}

test('finished jieqi leak: the review API is the same whatever was dealt face-down', async () => {
  const payloads = await Promise.all(DEALS.map((deal) => jieqiPostgameForApi(ROOM_ID, deps(deal))));
  assertSameForEveryDeal(
    'api',
    payloads.map((payload) => JSON.stringify(payload)),
  );
  const standard = payloads[0];
  assert.ok(standard);
  // Not vacuous: the pieces that moved are named, the dark capture is not.
  assert.deepEqual(standard.view.board.b10, { color: 'black', role: 'chariot', faceDown: false });
  assert.deepEqual(standard.view.captured, [
    { owner: 'black', role: null },
    { owner: 'red', role: 'cannon' },
  ]);
});

test('finished jieqi leak: the watch payload is the same whatever was dealt face-down', async () => {
  const payloads = [];
  for (const deal of DEALS) {
    clearJieqiWatchPostgameCache();
    payloads.push(await jieqiWatchPostgameForApi(ROOM_ID, deps(deal)));
  }
  clearJieqiWatchPostgameCache();
  assert.ok(payloads[0]);
  assertSameForEveryDeal(
    'watch',
    payloads.map((payload) => JSON.stringify(payload)),
  );
});

test('finished jieqi leak: the JSON and PGN exports are the same whatever was dealt face-down', () => {
  const exporter = variantTenantForRoomId(ROOM_ID)?.export;
  assert.ok(exporter);
  const json = sameForEveryDeal('export json', (deal) => {
    const game = exporter.finishedGame(finishedEvents(deal), ROOM_ID);
    assert.ok(game);
    return buildTenantGamePublicationJson(record(), game, exporter.gameRouteBase);
  });
  assert.equal('deal_fen' in json, false);
  assert.ok(json.plies.every((ply) => !('captured_hidden' in ply)));
  const pgn = sameForEveryDeal('export pgn', (deal) => {
    const game = exporter.finishedGame(finishedEvents(deal), ROOM_ID);
    assert.ok(game);
    return buildTenantGamePgn(record(), game, exporter.gameRouteBase);
  });
  assert.ok(pgn);
  assert.equal(pgn.includes('DealFEN'), false);
  // A PGN names a dark capture as `x=<letter>`; none is written.
  assert.equal(/x=[a-z]/i.test(pgn), false, pgn);
});

test('finished jieqi leak: the share card FEN is the same at every ply whatever was dealt face-down', () => {
  const card = variantTenantForRoomId(ROOM_ID)?.card;
  assert.ok(card);
  if (card.layout === 'match') assert.fail('jieqi uses a board card');
  for (const ply of [0, 1, 2]) {
    const fen = sameForEveryDeal(`card ply ${ply}`, (deal): string | null =>
      card.fenAtPly(finishedEvents(deal), ROOM_ID, ply),
    );
    assert.ok(fen, `card ply ${ply}`);
    // The 5-field public FEN: no sixth field naming the face-down pieces.
    assert.equal(fen.split(' ').length, 5, fen);
  }
});

test('finished jieqi leak: the live room serves the victim and spectators the same bytes', () => {
  // The whole snapshot frame each client gets on joining the finished room,
  // through the runtime's finished-room policy (roomViewPolicy), not a direct
  // view call. serverAt is the send time, the one field that is not a game fact.
  const frame = (deal: JieqiDeal, seat: 'red' | 'black' | 'spectator') => {
    const hydrated = createTenantRuntimeRoomFromEvents(jieqiTenant, finishedEvents(deal));
    assert.ok(hydrated.ok);
    assert.equal(hydrated.room.projection.state.status.type, 'finished');
    const { serverAt: _serverAt, ...payload } = tenantSnapshotPayload(jieqiTenant, hydrated.room, {
      id: seat,
      seat,
      solo: false,
    });
    return payload;
  };
  for (const seat of ['black', 'spectator'] as const) {
    assertSameForEveryDeal(
      seat,
      DEALS.map((deal) => JSON.stringify(frame(deal, seat))),
    );
  }
  // The capturer keeps what it saw when it took the piece, and nothing more: not
  // the deal, and not its own pieces that never moved.
  const red = DEALS.map((deal) => frame(deal, 'red'));
  assert.deepEqual(red[0]?.state.captured[0], { owner: 'black', role: 'horse' });
  assert.deepEqual(red[1]?.state.captured[0], { owner: 'black', role: 'elephant' });
  assert.equal(JSON.stringify(red[1]), JSON.stringify(red[2]), 'red learns its own a1 and b1');
  assert.deepEqual(red[0]?.state.board.c10, { color: 'black', faceDown: true });
  assert.deepEqual(red[0]?.state.board.a1, { color: 'red', faceDown: true });
});

// A deterministic stand-in engine: any two positions it could tell apart score differently.
function fenHashCp(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 100_003;
  return (h % 601) - 300;
}

test('finished jieqi leak: the analysis chart and decisions are the same whatever was dealt face-down', async () => {
  const inputs = sameForEveryDeal('analysis inputs', (deal) =>
    jieqiAnalysisInputsFromEvents(finishedEvents(deal)),
  );
  assert.ok(inputs);
  // Not vacuous: the pieces that moved keep their real identities, so the replay reveals them.
  const start = createInitialJieqiState('t', inputs.deal);
  assert.equal(start.board.b3?.role, 'cannon');
  assert.equal(start.board.b3?.unknown, undefined);
  assert.equal(start.board.a10?.role, 'chariot');
  assert.equal(start.board.b10?.unknown, true);
  const fens: string[] = [];
  await sameForEveryDealAsync('analysis', async (deal) => {
    const { deal: analysed, moves } = jieqiAnalysisInputsFromEvents(finishedEvents(deal))!;
    const chart = await analyzeJieqiPostgame(moves, analysed, async (_state, window) => {
      const key = `${window.fen}|${window.moves.join(',')}`;
      fens.push(key);
      return { cp: fenHashCp(key), mate: null, best: null };
    });
    const decisions = await analyzeJieqiDecisions(moves, analysed, {
      multiPv: async (fen) => [
        { index: 1, move: 'a0a1', cp: fenHashCp(fen), mate: null, depth: 1, pv: [], bound: null },
      ],
      evalPosition: async (fen, window) => ({
        cp: fenHashCp(`${fen}|${window?.moves.join(',') ?? ''}`),
        mate: null,
      }),
    });
    return { chart, decisions };
  });
  assert.ok(fens.length > 0, 'the stand-in engine was asked');
});

async function sameForEveryDealAsync<T>(
  label: string,
  build: (deal: JieqiDeal) => Promise<T>,
): Promise<void> {
  const wires: string[] = [];
  for (const deal of DEALS) wires.push(JSON.stringify(await build(deal)));
  assertSameForEveryDeal(label, wires);
}
