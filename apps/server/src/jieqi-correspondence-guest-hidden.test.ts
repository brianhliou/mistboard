/**
 * #1059 hidden information for a guest-held correspondence seat in Jieqi. A
 * signed-out creator sits with a bearer token, an account joins, they play, and
 * the guest later signs in on the same browser (the seat binds to the account).
 * At every step the whole serialized snapshot for each seat must not depend on
 * which face-down piece sits where: two deals that differ only by a swap of two
 * still-hidden pieces produce byte-identical payloads. The seat token never
 * reaches any payload.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correspondenceTimeControl,
  getJieqiLegalMoves,
  JIEQI_SPEC_ID,
  type JieqiDeal,
  STANDARD_JIEQI_DEAL,
} from '@mistboard/game';
import type { JieqiEvent, JieqiRuntimeRoom, JieqiSeat } from './jieqi-runtime.js';
import { jieqiTenant } from './jieqi-tenant.js';
import type { UserAccount } from './persistence.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import { assignTenantSeat, type TenantSeatAssignment } from './variant-tenant/seat-session.js';

process.env.MISTBOARD_JIEQI_ENABLED = 'true';

const ROOM_ID = 'jq_guest-corr';
const SEATS: readonly JieqiSeat[] = ['red', 'black', 'spectator'];

const friend = { id: 'user-friend', handle: 'friend', displayName: 'Friend' } as UserAccount;
const guestAccount = { id: 'user-guest', handle: 'guest', displayName: 'Guest' } as UserAccount;

function room(setup: JieqiDeal): JieqiRuntimeRoom {
  const events: JieqiEvent[] = [
    {
      type: 'room-created',
      at: 1_000,
      roomId: ROOM_ID,
      gameSpecId: JIEQI_SPEC_ID,
      creatorPreference: 'red',
      timeControl: correspondenceTimeControl(3),
      setup,
    },
  ];
  const created = createTenantRuntimeRoomFromEvents(jieqiTenant, events);
  assert.ok(created.ok);
  return created.room;
}

// The whole snapshot each seat would be sent, as wire JSON. serverAt is the
// one wall-clock field.
function wire(target: JieqiRuntimeRoom, seat: JieqiSeat): string {
  const payload = tenantSnapshotPayload(jieqiTenant, target, {
    id: `client-${seat}`,
    seat,
    solo: false,
  });
  return JSON.stringify({ ...payload, serverAt: 0 });
}

function seat(
  target: JieqiRuntimeRoom,
  clientId: string,
  token: string | undefined,
  account: UserAccount | null,
): Extract<TenantSeatAssignment<'red' | 'black'>, { ok: true }> {
  const assigned = assignTenantSeat(jieqiTenant, target, clientId, token, account);
  assert.ok(assigned.ok, `seat for ${clientId}`);
  appendTenantRuntimeEvent(jieqiTenant, target, {
    type: 'seat-assigned',
    at: 2_000,
    roomId: ROOM_ID,
    clientId,
    seat: assigned.seat,
  });
  return assigned;
}

test('a guest-held Jieqi correspondence seat: no payload depends on a hidden piece (#1059)', () => {
  // Swap two black pieces of different roles; both rooms deal the same squares
  // with those two identities exchanged.
  const roles = STANDARD_JIEQI_DEAL.black;
  const i = roles.length - 1;
  const j = roles.findIndex((role) => role !== roles[i]);
  assert.ok(j >= 0);
  const swapped: JieqiDeal = { red: [...STANDARD_JIEQI_DEAL.red], black: [...roles] };
  [swapped.black[i], swapped.black[j]] = [swapped.black[j]!, swapped.black[i]!];
  const a = room(STANDARD_JIEQI_DEAL);
  const b = room(swapped);

  // The squares whose hidden identity differs between the two deals.
  const hidden = Object.keys(a.projection.state.board).filter(
    (square) =>
      JSON.stringify(a.projection.state.board[square as never]) !==
      JSON.stringify(b.projection.state.board[square as never]),
  );
  assert.equal(hidden.length, 2, 'exactly the two swapped squares differ');

  const tokens: string[] = [];
  const expectSame = (label: string) => {
    for (const viewer of SEATS) {
      const left = wire(a, viewer);
      assert.equal(left, wire(b, viewer), `${label}: ${viewer} payload reads a hidden piece`);
      for (const token of tokens) {
        assert.ok(!left.includes(token), `${label}: ${viewer} payload carries a seat token`);
      }
    }
  };

  // The guest creator sits first; the friend's account takes the other seat.
  const guestA = seat(a, 'guest', undefined, null);
  const guestB = seat(b, 'guest', undefined, null);
  assert.equal(guestA.seat, 'red');
  assert.equal(guestA.tokenState.userId, null);
  assert.ok(guestA.seatToken && guestB.seatToken);
  tokens.push(guestA.seatToken, guestB.seatToken, guestA.seatTokenHash);
  expectSame('guest seated');
  seat(a, 'friend', undefined, friend);
  seat(b, 'friend', undefined, friend);
  expectSame('friend seated');

  // Six plies, the same in both rooms, none touching the swapped squares (a
  // moved or captured face-down piece is revealed, which is public by rule).
  for (let ply = 0; ply < 6; ply += 1) {
    const status = a.projection.state.status;
    assert.equal(status.type, 'playing');
    const color = (status as { turn: 'red' | 'black' }).turn;
    const move = [...getJieqiLegalMoves(a.projection.state)]
      .sort((x, y) => `${x.from}${x.to}`.localeCompare(`${y.from}${y.to}`))
      .find((m) => !hidden.includes(m.from) && !hidden.includes(m.to));
    assert.ok(move, `ply ${ply} has a move clear of the swapped squares`);
    for (const target of [a, b]) {
      appendTenantRuntimeEvent(jieqiTenant, target, {
        type: 'move-played',
        at: 10_000 + ply * 1_000,
        roomId: ROOM_ID,
        color,
        move: { from: move.from, to: move.to },
      });
    }
    expectSame(`ply ${ply + 1}`);
  }

  // The guest signs in on the same browser: the seat binds, and binding adds
  // nothing hidden to anyone's payload.
  const boundA = seat(a, 'guest-2', guestA.seatToken, guestAccount);
  const boundB = seat(b, 'guest-2', guestB.seatToken, guestAccount);
  assert.equal(boundA.seat, 'red');
  assert.equal(boundA.tokenState.userId, guestAccount.id);
  assert.equal(boundB.tokenState.userId, guestAccount.id);
  expectSame('guest signed in');
});
