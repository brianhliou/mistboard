// Crazyhouse Xiangqi is an admin playtest, gated the way mahjong is: the flag
// opens room creation, the per-account allowlist (139) decides who sits down.
// These cases run the same two calls the WebSocket seat path makes
// (variant-tenant/ws.ts: mayPlayVariant, then assignTenantSeat) against a real
// crazyhouse room, so the refusal is proved on this tenant, not on a stand-in.
import assert from 'node:assert/strict';
import test from 'node:test';
import type pg from 'pg';
import {
  crazyhouseXiangqiRooms,
  createCrazyhouseXiangqiRoom,
} from './crazyhouse-xiangqi-registration.js';
import { crazyhouseXiangqiTenant } from './crazyhouse-xiangqi-tenant.js';
import type { UserAccount } from './persistence.js';
import { mayPlayVariant } from './persistence-variant-access.js';
import { CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID } from './server-crazyhouse-xiangqi-engine.js';
import { assignTenantSeat } from './variant-tenant/seat-session.js';

function account(overrides: Partial<UserAccount>): UserAccount {
  return {
    id: 'user-1',
    handle: 'tester',
    displayName: 'Tester',
    accountRole: 'player',
    playDisabledAt: null,
    ...overrides,
  } as UserAccount;
}

// A grant table with no rows: the account holds no grant for anything.
function noGrants() {
  const calls: unknown[][] = [];
  const pool = {
    query: async (_text: string, values: unknown[]) => {
      calls.push(values);
      return { rowCount: 0, rows: [] };
    },
  } as unknown as pg.Pool;
  return { pool, calls };
}

async function withFlag<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED;
  process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED = 'true';
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED;
    else process.env.MISTBOARD_CRAZYHOUSE_XIANGQI_ENABLED = previous;
  }
}

async function botRoom() {
  const created = await withFlag(() =>
    createCrazyhouseXiangqiRoom(undefined, 'red', false, {
      engineId: CRAZYHOUSE_XIANGQI_DEFAULT_ENGINE_ID,
      seat: 'black',
    }),
  );
  assert.ok(created.ok, 'the flag opens room creation');
  return created.room;
}

test('crazyhouse xiangqi: a signed-in player without a grant is refused the seat', async () => {
  const room = await botRoom();
  try {
    const player = account({ id: 'player-1' });
    const { pool, calls } = noGrants();
    const granted = await mayPlayVariant(player, crazyhouseXiangqiTenant.gameSpecId, pool);
    assert.equal(granted, false);
    assert.deepEqual(calls, [['player-1', 'crazyhouse-xiangqi']], 'the grant table was asked');
    const assignment = assignTenantSeat(
      crazyhouseXiangqiTenant,
      room,
      'player-client',
      undefined,
      player,
      null,
      granted,
    );
    assert.deepEqual(assignment, { ok: false, reason: 'variant not granted' });
  } finally {
    crazyhouseXiangqiRooms.delete(room.id);
  }
});

test('crazyhouse xiangqi: a signed-out visitor is refused the seat', async () => {
  const room = await botRoom();
  try {
    const granted = await mayPlayVariant(null, crazyhouseXiangqiTenant.gameSpecId);
    assert.equal(granted, false);
    const assignment = assignTenantSeat(
      crazyhouseXiangqiTenant,
      room,
      'guest-client',
      undefined,
      null,
      null,
      granted,
    );
    assert.deepEqual(assignment, { ok: false, reason: 'variant not granted' });
  } finally {
    crazyhouseXiangqiRooms.delete(room.id);
  }
});

test('crazyhouse xiangqi: an admin is seated without a grant row', async () => {
  const room = await botRoom();
  try {
    const admin = account({ id: 'admin-1', accountRole: 'admin' });
    const { pool, calls } = noGrants();
    const granted = await mayPlayVariant(admin, crazyhouseXiangqiTenant.gameSpecId, pool);
    assert.equal(granted, true);
    assert.deepEqual(calls, [], 'the admin role is the grant; no query');
    const assignment = assignTenantSeat(
      crazyhouseXiangqiTenant,
      room,
      'admin-client',
      undefined,
      admin,
      null,
      granted,
    );
    assert.ok(assignment.ok, 'the admin takes the open seat');
    assert.equal(assignment.seat, 'red');
  } finally {
    crazyhouseXiangqiRooms.delete(room.id);
  }
});
