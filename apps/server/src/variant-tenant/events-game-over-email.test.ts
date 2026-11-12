import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type Color,
  correspondenceTimeControl,
  type Move,
  type RoomTimeControl,
} from '@mistboard/game';
import type { GameOverNotice } from '../correspondence-player-emails.js';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import { hashSeatToken } from '../server-seat-session.js';
import { appendTenantEvent, type TenantEventWriterPersistence } from './events.js';
import { createTenantRuntimeRoomFromEvents } from './runtime.js';
import type { TenantSeatTokenState } from './tenant.js';

// The correspondence game-over email (#1057) is asked for once per game, from
// the event writer, only for a days-per-move room, and only after the games row
// is written. Pinned through the dark-chess tenant like the other writer tests;
// the email itself is faked here (correspondence-player-emails.test.ts owns it).

const CORRESPONDENCE_TC = correspondenceTimeControl(3);
const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

function roomEvents(roomId: string, tc: RoomTimeControl): DarkChessTenantEvent[] {
  return [
    { type: 'room-created', at: 1_000, roomId, gameSpecId: 'dark-chess', timeControl: tc },
    {
      type: 'clock-started',
      at: 1_000,
      roomId,
      clock: {
        activeColor: null,
        incrementMs: tc.incrementMs,
        initialMs: tc.initialMs,
        remainingMs: { black: tc.initialMs, white: tc.initialMs },
        runningSince: null,
      },
    },
    { type: 'seat-assigned', at: 2_000, roomId, clientId: 'white-client', seat: 'white' },
    { type: 'seat-assigned', at: 5_000, roomId, clientId: 'black-client', seat: 'black' },
  ];
}

function seatToken(seat: Color, userId: string | null): TenantSeatTokenState<Color> {
  return {
    clientId: `${seat}-client`,
    seat,
    tokenHash: hashSeatToken(`${seat}-token`),
    userId,
    userHandle: userId ? `${seat}-handle` : null,
    userDisplayName: userId ? `${seat} player` : null,
    issuedAt: new Date(1_000),
    lastSeenAt: new Date(1_000),
    revokedAt: null,
  };
}

function seatedRoom(roomId: string, tc: RoomTimeControl, extra: DarkChessTenantEvent[] = []) {
  const hydrated = createTenantRuntimeRoomFromEvents(darkChessTenant, [
    ...roomEvents(roomId, tc),
    ...extra,
  ]);
  assert.ok(hydrated.ok, 'fixture event log must hydrate');
  const room = hydrated.room;
  room.seatTokens.white = seatToken('white', 'white-user');
  room.seatTokens.black = seatToken('black', 'black-user');
  return room;
}

function persistence(
  opts: { gameEndFails?: boolean } = {},
): TenantEventWriterPersistence<Color, Move, 'dark-chess'> {
  return {
    abortRunningGame: async () => true,
    appendRoomEvent: async () => {},
    deleteRoomDeadline: async () => {},
    isInitialized: () => true,
    recordGameEnd: async () => {
      if (opts.gameEndFails) throw new Error('db down');
    },
    upsertRoomDeadline: async () => {},
    upsertRoomSeatToken: async () => {},
  };
}

const firstMove: DarkChessTenantEvent = {
  type: 'move-played',
  at: 10_000,
  roomId: '',
  color: 'white',
  move: { from: 'e2', to: 'e4' },
};

test('a finished correspondence game asks for the game-over email once, with each seat', async () => {
  const roomId = 'dchx_over_email';
  const room = seatedRoom(roomId, CORRESPONDENCE_TC, [{ ...firstMove, roomId }]);
  const notices: GameOverNotice[] = [];
  const ctx = {
    persistence: persistence(),
    notifyCorrespondenceGameOver: (n: GameOverNotice) => notices.push(n),
  };
  await appendTenantEvent(
    darkChessTenant,
    room,
    { type: 'seat-resigned', at: 12_000, roomId, color: 'white' },
    ctx,
  );
  assert.equal(notices.length, 1);
  const notice = notices[0]!;
  assert.equal(notice.roomId, roomId);
  assert.equal(notice.result, 'black-wins');
  assert.equal(notice.aborted, false);
  assert.equal(notice.termination, 'resignation');
  assert.deepEqual(
    notice.seats.map((s) => [s.color, s.userId, s.name, s.winResult]),
    [
      ['white', 'white-user', 'white player', 'white-wins'],
      ['black', 'black-user', 'black player', 'black-wins'],
    ],
  );
});

test('a live game never asks for the game-over email', async () => {
  const roomId = 'dchx_over_email_live';
  const room = seatedRoom(roomId, LIVE_TC, [{ ...firstMove, roomId }]);
  const notices: GameOverNotice[] = [];
  await appendTenantEvent(
    darkChessTenant,
    room,
    { type: 'seat-resigned', at: 12_000, roomId, color: 'white' },
    { persistence: persistence(), notifyCorrespondenceGameOver: (n) => notices.push(n) },
  );
  assert.equal(notices.length, 0);
});

test('no email when the games row could not be written', async () => {
  const roomId = 'dchx_over_email_no_row';
  const room = seatedRoom(roomId, CORRESPONDENCE_TC, [{ ...firstMove, roomId }]);
  const notices: GameOverNotice[] = [];
  await appendTenantEvent(
    darkChessTenant,
    room,
    { type: 'seat-resigned', at: 12_000, roomId, color: 'white' },
    {
      persistence: persistence({ gameEndFails: true }),
      logGameEndRecordFailure: () => {},
      notifyCorrespondenceGameOver: (n) => notices.push(n),
    },
  );
  assert.equal(notices.length, 0);
});

test('an aborted correspondence game asks for the cancelled email', async () => {
  const roomId = 'dchx_over_email_abort';
  const room = seatedRoom(roomId, CORRESPONDENCE_TC);
  const notices: GameOverNotice[] = [];
  await appendTenantEvent(
    darkChessTenant,
    room,
    { type: 'game-aborted', at: 6_000, roomId, reason: 'user-abort' },
    { persistence: persistence(), notifyCorrespondenceGameOver: (n) => notices.push(n) },
  );
  assert.equal(notices.length, 1);
  assert.equal(notices[0]?.aborted, true);
  assert.equal(notices[0]?.result, null);
});
