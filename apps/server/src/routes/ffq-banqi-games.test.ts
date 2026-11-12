import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import test from 'node:test';
import {
  applyFFQBanqiMove,
  type BanqiDeal,
  createFFQBanqiDeal,
  createFFQBanqiStateFromSetup,
  FFQ_BANQI_DAMAGE,
  FFQ_BANQI_SPEC_ID,
  type FFQBanqiMove,
  getFFQBanqiLegalMoves,
} from '@mistboard/game';
import { ffqBanqiCardFen } from '../ffq-banqi-publication.js';
import { type FFQBanqiEvent, ffqBanqiTenant } from '../ffq-banqi-tenant.js';
import { resolveGameExport } from '../game-export-tenant.js';
import { type TenantGameCardStore, tenantGameCard, tenantGamePageMeta } from '../og-game-tenant.js';
import { resolvePositionOg } from '../og-position.js';
import type { GameRecord } from '../persistence.js';
import { variantTenantForRoomId } from '../variant-tenant/registry.js';
import { replayTenantEvents } from '../variant-tenant/runtime.js';
import '../ffq-banqi-registration.js';
import {
  type FFQBanqiPostgameRouteDeps,
  ffqBanqiPostgameForApi,
  handleFFQBanqiPostgame,
} from './ffq-banqi-games.js';

const ROOM = 'ffq_review';
const deal = createFFQBanqiDeal(800);
let state = createFFQBanqiStateFromSetup(ROOM, { deal });
const moves: FFQBanqiMove[] = [];
while (state.status.type === 'playing' && moves.length < 100) {
  const legal = getFFQBanqiLegalMoves(state);
  const move =
    legal.find((m) => m.from !== m.to && state.board[m.to]) ??
    legal.find((m) => m.from === m.to) ??
    legal[0];
  assert.ok(move);
  moves.push(move);
  state = applyFFQBanqiMove(state, move);
}
assert.equal(state.status.type, 'finished');
const i = state.board.findIndex((piece) => piece?.faceDown);
const j = state.board.findIndex(
  (piece, square) =>
    piece?.faceDown &&
    square !== i &&
    (piece.role !== state.board[i]!.role || piece.color !== state.board[i]!.color),
);
assert.ok(i >= 0 && j >= 0, 'plant two different, never-visible on-board identities');
const swapped = deal.map((piece) => ({ ...piece }));
[swapped[i], swapped[j]] = [swapped[j]!, swapped[i]!];

function events(setup: BanqiDeal = deal): FFQBanqiEvent[] {
  return [
    {
      type: 'room-created',
      at: 1,
      roomId: ROOM,
      gameSpecId: FFQ_BANQI_SPEC_ID,
      setup: { deal: setup },
    },
    { type: 'seat-assigned', at: 2, roomId: ROOM, clientId: 'r', seat: 'red' },
    { type: 'seat-assigned', at: 3, roomId: ROOM, clientId: 'b', seat: 'black' },
    ...moves.map(
      (move, ply): FFQBanqiEvent => ({
        type: 'move-played',
        at: ply + 10,
        roomId: ROOM,
        color: ply % 2 === 0 ? 'red' : 'black',
        move,
      }),
    ),
  ];
}
const game: GameRecord = {
  roomId: ROOM,
  variant: FFQ_BANQI_SPEC_ID,
  mode: 'pvp',
  result: 'red-wins',
  termination: 'points',
  plyCount: moves.length,
  startedAt: new Date(1),
  endedAt: new Date(100),
  whiteName: null,
  blackName: null,
  corpusId: null,
  rated: false,
  visibility: 'public',
  participants: ['red', 'black'].map((color) => ({
    color: color as 'red' | 'black',
    subjectType: 'user',
    subjectId: color,
    displayName: color,
    visibility: 'public',
  })),
};
const store = (log = events()): TenantGameCardStore => ({
  summary: async () => game,
  events: async () => log,
  analysis: async () => null,
});
const deps = (log = events()): FFQBanqiPostgameRouteDeps => ({
  getGameSummary: async () => ({
    ...game,
    jobId: null,
    gameIndex: null,
    whiteEngineId: null,
    blackEngineId: null,
    timeControl: null,
    initialMs: null,
    incrementMs: null,
  }),
  loadRoomEvents: async () => log,
  admits: async () => true,
  persistenceReady: () => true,
});
function serialized(value: unknown): string {
  const json = JSON.stringify(value);
  JSON.parse(json, (key, entry) => {
    assert.ok(
      !['setup', 'deal', 'seed', 'revealed', 'deal_fen'].includes(key),
      `secret field ${key}`,
    );
    if (entry?.faceDown === true) assert.deepEqual(entry, { faceDown: true });
    return entry;
  });
  return json;
}

// Serializes the entire result, with a real hidden-identity permutation that
// changes canonical state. A leak anywhere in the envelope breaks equality.
test('finished FFQ API is masked at every ply with exact HP and capture damage', async () => {
  assert.notDeepEqual(
    replayTenantEvents(ffqBanqiTenant, events()).state.board,
    replayTenantEvents(ffqBanqiTenant, events(swapped)).state.board,
  );
  const payload = await ffqBanqiPostgameForApi(ROOM, deps());
  assert.ok(payload);
  assert.equal(
    serialized(payload),
    serialized(await ffqBanqiPostgameForApi(ROOM, deps(events(swapped)))),
  );
  assert.equal(payload.history.truth.length, moves.length + 1);
  let before = createFFQBanqiStateFromSetup(ROOM, { deal });
  for (const [index, move] of moves.entries()) {
    const after = applyFFQBanqiMove(before, move);
    const frame: (typeof payload.history.truth)[number] = payload.history.truth[index + 1]!;
    assert.deepEqual(frame.view.hp, after.hp);
    assert.equal(after.hp.red, Math.max(0, before.hp.red - frame.damage.red));
    assert.equal(after.hp.black, Math.max(0, before.hp.black - frame.damage.black));
    const capture = after.captures.at(-1);
    if (after.captures.length > before.captures.length) {
      assert.ok(capture);
      assert.equal(frame.damage.red + frame.damage.black, FFQ_BANQI_DAMAGE[capture.role]);
      assert.deepEqual(frame.view.captured.at(-1), capture, 'covered victims stay public');
    }
    before = after;
  }
});

test('FFQ exports remain unavailable for both hidden deals', () => {
  for (const format of ['pgn', 'json'] as const) {
    const args = { roomId: ROOM, format };
    const summary = {
      ...game,
      jobId: null,
      gameIndex: null,
      whiteEngineId: null,
      blackEngineId: null,
      timeControl: null,
      initialMs: null,
      incrementMs: null,
    };
    const a = resolveGameExport({ ...args, summary, events: events() });
    const b = resolveGameExport({ ...args, summary, events: events(swapped) });
    assert.equal(a.status, 501);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.ok(!JSON.stringify(a).includes('deal_fen'));
    assert.deepEqual(a, {
      status: 501,
      body: { error: 'export_not_supported_for_variant', variant: FFQ_BANQI_SPEC_ID },
    });
  }
});

test('FFQ has no share card or page meta for either hidden deal', async () => {
  assert.equal(variantTenantForRoomId(ROOM)?.export, null);
  assert.equal(variantTenantForRoomId(ROOM)?.card, null);
  for (const log of [events(), events(swapped)]) {
    assert.equal(await tenantGameCard(ROOM, store(log)), null);
    assert.equal(await tenantGamePageMeta(`/ffq-banqi/game/${ROOM}`, store(log)), null);
  }
  // The unused card projection must still mask every covered on-board piece.
  const fen = ffqBanqiCardFen(state);
  assert.equal(fen, ffqBanqiCardFen(replayTenantEvents(ffqBanqiTenant, events(swapped)).state));
  const board = resolvePositionOg('banqi', fen);
  assert.ok(board && board.board.kind === 'grid');
  assert.equal(
    board.board.tiles.filter((tile) => tile.hidden).length,
    state.board.filter((piece) => piece?.faceDown).length,
  );
});

test('FFQ route gates before reads and rejects live, aborted, foreign and missing games', async () => {
  for (const admitted of [false, true]) {
    let reads = 0;
    let status = 0;
    let body = '';
    const routeDeps = {
      ...deps(),
      admits: async () => admitted,
      getGameSummary: async () => {
        reads++;
        return deps().getGameSummary(ROOM);
      },
      loadRoomEvents: async () => {
        reads++;
        return events();
      },
    };
    const response = {
      setHeader: () => {},
      writeHead: (code: number) => {
        status = code;
      },
      end: (value: string) => {
        body = value;
      },
    } as unknown as ServerResponse;
    assert.equal(
      await handleFFQBanqiPostgame(
        { method: 'GET' } as IncomingMessage,
        response,
        `/api/ffq-banqi/games/${ROOM}`,
        routeDeps,
      ),
      true,
    );
    assert.equal(status, admitted ? 200 : 404);
    if (!admitted) {
      assert.equal(reads, 0);
      assert.equal(body, '{"error":"not_found"}');
    } else serialized(JSON.parse(body));
  }
  assert.equal(await ffqBanqiPostgameForApi(ROOM, deps(events().slice(0, 4))), null);
  assert.equal(
    await ffqBanqiPostgameForApi(
      ROOM,
      deps([
        ...events().slice(0, 4),
        { type: 'game-aborted', at: 90, roomId: ROOM, reason: 'user-abort' } as FFQBanqiEvent,
      ]),
    ),
    null,
  );
  assert.equal(
    await ffqBanqiPostgameForApi(ROOM, { ...deps(), getGameSummary: async () => null }),
    null,
  );
  assert.equal(
    await ffqBanqiPostgameForApi(ROOM, {
      ...deps(),
      getGameSummary: async () => ({ ...(await deps().getGameSummary(ROOM))!, variant: 'banqi' }),
    }),
    null,
  );
});
