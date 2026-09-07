import assert from 'node:assert/strict';
import test from 'node:test';
import {
  darkChessVariant,
  type GameEvent,
  generateChess960Starts,
  replayGameEvents,
} from '@mistboard/game';
import { type SnapshotClient, type SnapshotRoom, snapshotPayload } from './payloads.js';
import { eventReplayResponse } from './server-policy.js';
import {
  gameProjectionFixture,
  snapshotClientFixture,
  snapshotRoomFixture,
} from './test-builders.js';

test('Fog of War snapshot payload does not include hidden opponent pieces or move events', () => {
  const state = {
    ...darkChessVariant.createInitialState('fog-payload'),
    board: {
      a1: { color: 'white', role: 'rook' },
      e1: { color: 'white', role: 'king' },
      a4: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'queen' },
    },
    status: { type: 'playing', turn: 'white' } as const,
    castlingRights: [],
  } satisfies ReturnType<typeof darkChessVariant.createInitialState>;
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fog-payload',
      variant: 'dark-chess',
      offer: [],
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fog-payload',
      color: 'black',
      move: { from: 'h8', to: 'h7' },
    },
  ];
  const projection = gameProjectionFixture({
    roomId: 'fog-payload',
    variant: 'dark-chess',
    seats: { white: 'white-client', black: 'black-client' },
    state,
  });
  const room = snapshotRoomFixture({
    id: 'fog-payload',
    clients: new Set([
      { seat: 'white', displaced: false },
      { seat: 'black', displaced: false },
    ]),
    events,
    projection,
  });
  const client = snapshotClientFixture({
    id: 'white-client',
    seat: 'white',
  });

  const payload = JSON.stringify(snapshotPayload(room, client));

  assert.match(payload, /"gameSpecId":"dark-chess"/);
  assert.match(payload, /"a4"/);
  assert.doesNotMatch(payload, /"h8"/);
  assert.doesNotMatch(payload, /queen/);
  assert.doesNotMatch(payload, /move-played/);
  assert.doesNotMatch(payload, /h7/);
});

test('live Fog of War spectator payload has no board or move events', () => {
  const room = fogRoomFixture({ status: { type: 'playing', turn: 'white' } });
  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  });

  assert.deepEqual(payload.state.board, {});
  assert.deepEqual(payload.state.visibleSquares, []);
  assert.deepEqual(payload.state.legalMoves, []);
  assert.equal(
    payload.events.some((event) => event.type === 'move-played'),
    false,
  );
});

test('live Fog of War seated payload exposes own last move and own move event', () => {
  const room = lastMoveRoomFixture();
  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'white-client',
    seat: 'white',
    solo: false,
  });

  assert.deepEqual(payload.state.lastMove, { from: 'e2', to: 'e4' });
  assert.deepEqual(
    payload.events.filter((event) => event.type === 'move-played'),
    [
      {
        type: 'move-played',
        at: 2,
        roomId: 'fog-last-move-payload',
        color: 'white',
        move: { from: 'e2', to: 'e4' },
      },
    ],
  );
});

test('live Fog of War seated payload does not expose opponent last-move coordinates', () => {
  const room = lastMoveRoomFixture();
  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'black-client',
    seat: 'black',
    solo: false,
  });

  assert.deepEqual(payload.state.board.e4, { color: 'white', role: 'pawn' });
  assert.equal(payload.state.lastMove, undefined);
  assert.equal(
    payload.events.some((event) => event.type === 'move-played'),
    false,
  );
});

test('live Fog Draft960 payload hides opponent offer and selection', () => {
  const starts = generateChess960Starts();
  const whiteOffer = starts.slice(0, 3);
  const blackOffer = starts.slice(3, 6);
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fog-draft-payload',
      variant: 'dark-chess',
      offer: whiteOffer,
      offers: {
        white: whiteOffer,
        black: blackOffer,
      },
    },
    {
      type: 'seat-assigned',
      at: 2,
      roomId: 'fog-draft-payload',
      clientId: 'white-client',
      seat: 'white',
    },
    {
      type: 'seat-assigned',
      at: 3,
      roomId: 'fog-draft-payload',
      clientId: 'black-client',
      seat: 'black',
    },
    {
      type: 'draft-start-selected',
      at: 4,
      roomId: 'fog-draft-payload',
      color: 'white',
      startId: whiteOffer[1]!.id,
    },
    {
      type: 'draft-start-selected',
      at: 5,
      roomId: 'fog-draft-payload',
      color: 'black',
      startId: blackOffer[1]!.id,
    },
    {
      type: 'draft-start-resolved',
      at: 6,
      roomId: 'fog-draft-payload',
      startIds: {
        white: whiteOffer[1]!.id,
        black: blackOffer[1]!.id,
      },
    },
  ];
  const room: SnapshotRoom = {
    id: 'fog-draft-payload',
    clients: new Set([
      { seat: 'white', displaced: false },
      { seat: 'black', displaced: false },
    ]),
    events,
    projection: replayGameEvents(events),
  };

  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'white-client',
    seat: 'white',
    solo: false,
  });
  const visibleEventTypes = payload.events.map((event) => event.type);
  const roomCreated = payload.events.find((event) => event.type === 'room-created');

  assert.deepEqual(
    payload.offer.map((start) => start.id),
    whiteOffer.map((start) => start.id),
  );
  assert.deepEqual(payload.offers, { white: whiteOffer });
  assert.deepEqual(payload.selections, { white: whiteOffer[1]!.id });
  assert.equal(payload.resolvedStartId, null);
  assert.deepEqual(payload.resolvedStartIds, { white: whiteOffer[1]!.id });
  assert.deepEqual(visibleEventTypes, [
    'room-created',
    'seat-assigned',
    'seat-assigned',
    'draft-start-selected',
  ]);
  assert.equal(roomCreated?.type, 'room-created');
  if (roomCreated?.type === 'room-created') {
    assert.deepEqual(
      roomCreated.offer?.map((start) => start.id),
      whiteOffer.map((start) => start.id),
    );
    assert.deepEqual(roomCreated.offers, { white: whiteOffer });
  }

  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, new RegExp(`"id":${blackOffer[1]!.id}\\b`));
  assert.doesNotMatch(json, new RegExp(`"fenPlacement":"${blackOffer[1]!.fenPlacement}"`));
  assert.doesNotMatch(json, /draft-start-resolved/);
});

test('live fog spectator payload is empty regardless of mode (PvP, PvE, EvE)', () => {
  // Uniform rule: live games are private to seated players. Spectators are
  // rejected at the connection layer; if a SnapshotClient with seat='spectator'
  // ever reaches snapshotPayload for a live fog game, defense-in-depth returns
  // an empty view rather than leaking any board state. This test pins the
  // defense-in-depth behavior for all three modes.
  const fixtures = [
    {
      label: 'pvp',
      room: replayRoomFixture({
        roomId: 'pvp-spectator-empty',
        seats: { white: 'human-white', black: 'human-black' },
        mode: 'pvp',
      }),
    },
    {
      label: 'pve',
      room: replayRoomFixture({
        roomId: 'pve-spectator-empty',
        seats: { white: 'human-white', black: 'random-engine' },
        mode: 'pve',
        pveEngineId: 'builtin-random-legal',
      }),
    },
    {
      label: 'eve',
      room: replayRoomFixture({
        roomId: 'eve-spectator-empty',
        seats: { white: 'engine:white', black: 'engine:black' },
        mode: 'eve',
      }),
    },
  ];

  for (const { label, room } of fixtures) {
    const payload = snapshotPayload(room, spectatorClient());
    assert.deepEqual(payload.state.board, {}, `${label} board not empty`);
    assert.deepEqual(payload.state.visibleSquares, [], `${label} visibleSquares not empty`);
    assert.deepEqual(payload.state.legalMoves, [], `${label} legalMoves not empty`);
    assert.equal(
      payload.events.some((event) => event.type === 'move-played'),
      false,
      `${label} leaked move-played`,
    );
  }
});

test('live fog replay API returns 403 for every mode', () => {
  const pveRoom = replayRoomFixture({
    roomId: 'pve-policy-alignment',
    seats: { white: 'human-white', black: 'random-engine' },
    mode: 'pve',
  });
  assert.deepEqual(eventReplayResponse(pveRoom.events), {
    status: 403,
    body: { error: 'game_not_public' },
  });

  const eveRoom = replayRoomFixture({
    roomId: 'eve-policy-alignment',
    seats: { white: 'engine:white', black: 'engine:black' },
    mode: 'eve',
  });
  assert.deepEqual(eventReplayResponse(eveRoom.events), {
    status: 403,
    body: { error: 'game_not_public' },
  });

  const pvpRoom = replayRoomFixture({
    roomId: 'pvp-policy-alignment',
    seats: { white: 'human-white', black: 'human-black' },
    mode: 'pvp',
  });
  assert.deepEqual(eventReplayResponse(pvpRoom.events), {
    status: 403,
    body: { error: 'game_not_public' },
  });
});

// The finished half of the visibility matrix. The LIVE half is covered by the
// four 'live Fog of War ...' tests above, and those must keep passing untouched:
// this pair changing is a deliberate behaviour change, those changing would be a
// hidden-information leak.
test('finished Fog of War room reveals the whole game to a seated player', () => {
  const room = fogRoomFixture({
    status: { type: 'finished', winner: 'white', reason: 'king-captured' },
  });
  const payload = JSON.stringify(
    snapshotPayload(room, {
      devViews: false,
      id: 'white-client',
      seat: 'white',
      solo: false,
    }),
  );

  // Once the game is over the fog lifts in the room too: white now sees the
  // opponent's queen on h8 and black's move events. This is the same content
  // /game/:id (eventReplayResponse) already serves to any signed-out stranger,
  // so nothing escapes here that was not already public.
  assert.match(payload, /"a1"/);
  assert.match(payload, /"h8"/);
  assert.match(payload, /queen/);
  assert.match(payload, /move-played/);
});

test('finished Fog of War room reveals the whole game to a spectator', () => {
  const room = fogRoomFixture({
    status: { type: 'finished', winner: 'white', reason: 'king-captured' },
  });
  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  });

  // The row that makes a shared room link worth sending: a stranger opening a
  // finished fog room gets the game rather than a blank board.
  assert.ok(Object.keys(payload.state.board).length > 0, 'finished board must not be empty');
  assert.ok(payload.state.visibleSquares.length > 0, 'finished view must see the whole board');
  assert.equal(
    payload.events.some((event) => event.type === 'move-played'),
    true,
    'a finished room must hand the spectator the move log',
  );
});

test('dev Fog of War payload can include player, opponent, and true views', () => {
  const room = fogRoomFixture({ status: { type: 'playing', turn: 'white' } });
  const payload = snapshotPayload(room, {
    devViews: true,
    id: 'white-client',
    seat: 'white',
    solo: false,
  });

  assert.equal(payload.devViews?.opponent, 'black');
  assert.deepEqual(payload.devViews?.player.board.a1, { color: 'white', role: 'rook' });
  assert.deepEqual(payload.devViews?.opponentView.board.h8, { color: 'black', role: 'queen' });
  assert.deepEqual(payload.devViews?.truth.board.h8, { color: 'black', role: 'queen' });
  assert.equal(payload.devViews?.truth.visibleSquares.length, 64);
});

test('regular Fog of War payload does not include dev views', () => {
  const room = fogRoomFixture({ status: { type: 'playing', turn: 'white' } });
  const payload = snapshotPayload(room, {
    devViews: false,
    id: 'white-client',
    seat: 'white',
    solo: false,
  });

  assert.equal(payload.devViews, null);
});

function fogRoomFixture({
  status,
}: {
  status: ReturnType<typeof darkChessVariant.createInitialState>['status'];
}): SnapshotRoom {
  const state = {
    ...darkChessVariant.createInitialState('fog-payload'),
    board: {
      a1: { color: 'white', role: 'rook' },
      e1: { color: 'white', role: 'king' },
      a4: { color: 'black', role: 'rook' },
      e8: { color: 'black', role: 'king' },
      h8: { color: 'black', role: 'queen' },
    },
    status,
    castlingRights: [],
  } satisfies ReturnType<typeof darkChessVariant.createInitialState>;
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fog-payload',
      variant: 'dark-chess',
      offer: [],
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fog-payload',
      color: 'black',
      move: { from: 'h8', to: 'h7' },
    },
  ];
  const projection = gameProjectionFixture({
    roomId: 'fog-payload',
    variant: 'dark-chess',
    seats: { white: 'white-client', black: 'black-client' },
    state,
  });
  return snapshotRoomFixture({
    id: 'fog-payload',
    clients: new Set([
      { seat: 'white', displaced: false },
      { seat: 'black', displaced: false },
    ]),
    events,
    projection,
  });
}

function lastMoveRoomFixture(): SnapshotRoom {
  const state = {
    ...darkChessVariant.createInitialState('fog-last-move-payload'),
    board: {
      e1: { color: 'white', role: 'king' },
      e4: { color: 'white', role: 'pawn' },
      e8: { color: 'black', role: 'rook' },
      h8: { color: 'black', role: 'king' },
    },
    status: { type: 'playing', turn: 'black' } as const,
    castlingRights: [],
    lastMove: { from: 'e2', to: 'e4' },
  } satisfies ReturnType<typeof darkChessVariant.createInitialState>;
  const events: GameEvent[] = [
    {
      type: 'room-created',
      at: 1,
      roomId: 'fog-last-move-payload',
      variant: 'dark-chess',
      offer: [],
    },
    {
      type: 'move-played',
      at: 2,
      roomId: 'fog-last-move-payload',
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
  ];
  return snapshotRoomFixture({
    id: 'fog-last-move-payload',
    clients: new Set([
      { seat: 'white', displaced: false },
      { seat: 'black', displaced: false },
    ]),
    events,
    projection: gameProjectionFixture({
      roomId: 'fog-last-move-payload',
      variant: 'dark-chess',
      seats: { white: 'white-client', black: 'black-client' },
      state,
    }),
  });
}

function replayRoomFixture({
  mode,
  pveEngineId,
  roomId,
  seats,
}: {
  mode: SnapshotRoom['mode'];
  pveEngineId?: string | null;
  roomId: string;
  seats: { white: string; black: string };
}): SnapshotRoom {
  const events: GameEvent[] = [
    { type: 'room-created', at: 1, roomId, variant: 'dark-chess', offer: [] },
    { type: 'seat-assigned', at: 1, roomId, clientId: seats.white, seat: 'white' },
    { type: 'seat-assigned', at: 1, roomId, clientId: seats.black, seat: 'black' },
    { type: 'move-played', at: 2, roomId, color: 'white', move: { from: 'e2', to: 'e4' } },
    { type: 'move-played', at: 3, roomId, color: 'black', move: { from: 'e7', to: 'e5' } },
  ];
  return {
    id: roomId,
    clients: new Set([
      { seat: 'white', displaced: false },
      { seat: 'black', displaced: false },
      { seat: 'spectator', displaced: false },
    ]),
    events,
    mode,
    projection: replayGameEvents(events),
    pveEngineId,
  };
}

function spectatorClient(): SnapshotClient {
  return {
    devViews: false,
    id: 'spectator-client',
    seat: 'spectator',
    solo: false,
  };
}
