/**
 * Xiangqi mahjong by correspondence (days per move), casual and for granted
 * accounts only. The turn: after a discard the other seat owes the claim
 * decision, and on a pass it draws and discards on the same deadline; the next
 * hand deals itself. The deadline the sweeper enforces always names the seat
 * that owes the next move.
 *
 * And the hidden-information boundary: nothing a correspondence surface serves
 * one seat (the room snapshot, its event log, the inbox seat board, the public
 * current-games card) carries the other seat's concealed tiles or the walls.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  correspondenceTimeControl,
  createXmjSetup,
  DAY_MS,
  type DaysPerMove,
  XIANGQI_MAHJONG_SPEC_ID,
  type XmjMove,
  type XmjPlayerView,
  type XmjRoomState,
  type XmjSeat,
  xmjViewFor,
} from '@mistboard/game';
import { collectCurrentGames, currentGameBoardPayload } from './current-games.js';
import { correspondenceSeatBoard } from './routes/correspondence-games.js';
import type { HttpApiContext } from './routes/lib.js';
import { xmjBotMove } from './server-xiangqi-mahjong-bots.js';
// Side-effect import: every tenant registers, as the server boots.
import './variant-tenant/register-tenants.js';
import { tenantDurableDeadlineFor } from './variant-tenant/lifecycle.js';
import {
  correspondenceTenantForSpecId,
  type TenantManagedRoom,
} from './variant-tenant/registry.js';
import {
  appendTenantRuntimeEvent,
  createTenantRuntimeRoomFromEvents,
  tenantEventsForClient,
  tenantSnapshotPayload,
} from './variant-tenant/runtime.js';
import type { XmjRuntimeRoom } from './xiangqi-mahjong-registration.js';
import { xiangqiMahjongTenant as tenant, type XmjEvent } from './xiangqi-mahjong-tenant.js';

process.env.MISTBOARD_CORRESPONDENCE_ENABLED = 'true';
process.env.MISTBOARD_XIANGQI_MAHJONG_ENABLED = 'true';

const OTHER: Record<XmjSeat, XmjSeat> = { east: 'west', west: 'east' };

function registration() {
  const found = correspondenceTenantForSpecId(XIANGQI_MAHJONG_SPEC_ID);
  assert.ok(found, 'xiangqi mahjong has a correspondence registration');
  return found;
}

function liveRooms(): Map<string, TenantManagedRoom> {
  return registration().rooms as Map<string, TenantManagedRoom>;
}

async function acceptSeek(daysPerMove: DaysPerMove = 3): Promise<XmjRuntimeRoom> {
  const create = registration().createCorrespondenceGameForSeek;
  assert.ok(create);
  const created = await create({
    timeControl: correspondenceTimeControl(daysPerMove),
    first: { userId: 'first-xmj' },
    second: { userId: 'second-xmj' },
  });
  assert.ok(created.ok, `accept failed ${created.ok ? '' : created.error}`);
  const room = liveRooms().get(created.room.id);
  assert.ok(room, 'the room is in the live map');
  return room as unknown as XmjRuntimeRoom;
}

function state(room: XmjRuntimeRoom): XmjRoomState {
  return room.projection.state;
}

function view(room: XmjRuntimeRoom, seat: XmjSeat): XmjPlayerView {
  return xmjViewFor(state(room), seat);
}

function firstDiscard(room: XmjRuntimeRoom, seat: XmjSeat) {
  const tile = view(room, seat).legal.discard[0];
  assert.ok(tile, `${seat} has a discard`);
  return tile;
}

function play(room: XmjRuntimeRoom, move: XmjMove): void {
  const index = appendTenantRuntimeEvent(tenant, room, {
    type: 'move-played',
    at: move.at,
    roomId: room.id,
    color: move.by,
    move,
  } as XmjEvent);
  assert.notEqual(index, -1, `${move.by} ${move.action} is legal`);
}

function deadlineSeat(room: XmjRuntimeRoom): XmjSeat | null {
  return tenantDurableDeadlineFor(tenant, room)?.seat ?? null;
}

/** The move a seat owes now (the bot policy reads only that seat's view), else the runtime's. */
function nextMove(room: XmjRuntimeRoom, at: number): XmjMove {
  for (const seat of tenant.colors) {
    const move = xmjBotMove(state(room), seat, at);
    if (move) return move;
  }
  const pending = tenant.rules.pendingAction?.(state(room));
  assert.ok(pending, `no move owed at move ${state(room).moveNumber}`);
  return pending.move;
}

test('accepting a seek makes a casual correspondence table; east deals and owes the first move', async () => {
  try {
    const room = await acceptSeek(3);
    assert.equal(room.rated, false, 'never rated');
    assert.equal(room.projection.timeControl?.daysPerMove, 3);
    assert.equal(room.seatTokens.east?.userId, 'first-xmj');
    assert.equal(room.seatTokens.west?.userId, 'second-xmj');
    assert.equal(state(room).correspondence, true);
    assert.equal(view(room, 'east').dealer, 'east');
    const deadline = tenantDurableDeadlineFor(tenant, room);
    assert.equal(deadline?.seat, 'east');
    assert.ok(Math.abs((deadline?.dueAt ?? 0) - (Date.now() + 3 * DAY_MS)) < 60_000);
    assert.equal(registration().activeGameCount(), 0, 'a days-per-move table never pins a drain');
  } finally {
    registration().clearRooms();
  }
});

test('a discard hands the deadline to the other seat, which passes, draws and discards on it', async () => {
  try {
    const room = await acceptSeek(1);
    const t0 = Date.now();
    play(room, { by: 'east', at: t0, action: 'discard', tile: firstDiscard(room, 'east') });
    // West owes the claim decision; no window, no pause.
    assert.equal(deadlineSeat(room), 'west');
    assert.equal(state(room).claimPauseEndsAt, null);
    assert.equal(view(room, 'west').legal.pass, true);
    const decisionDue = tenantDurableDeadlineFor(tenant, room)?.dueAt;
    play(room, { by: 'west', at: t0 + 1_000, action: 'pass' });
    // The pass drew: west still owes its discard, on the same deadline.
    assert.equal(deadlineSeat(room), 'west');
    assert.equal(
      tenantDurableDeadlineFor(tenant, room)?.dueAt,
      decisionDue,
      'one turn, one deadline',
    );
    play(room, { by: 'west', at: t0 + 2_000, action: 'discard', tile: firstDiscard(room, 'west') });
    const deadline = tenantDurableDeadlineFor(tenant, room);
    assert.equal(deadline?.seat, 'east', 'back to east, which owes the claim decision');
    assert.ok(Math.abs((deadline?.dueAt ?? 0) - (t0 + 2_000 + DAY_MS)) < 60_000);
  } finally {
    registration().clearRooms();
  }
});

test('the sweeper flags the seat that let its turn lapse: a loss on time', async () => {
  try {
    const room = await acceptSeek(1);
    // The accepted log, moved to epoch-era time so a one-day allowance is long gone.
    const events = room.events.map((event, index) => ({ ...event, at: 1_000 + index * 1_000 }));
    const hydrated = createTenantRuntimeRoomFromEvents(tenant, events as XmjEvent[]);
    assert.ok(hydrated.ok);
    const overdue = hydrated.room as XmjRuntimeRoom;
    const at = 1_000 + events.length * 1_000;
    play(overdue, { by: 'east', at, action: 'discard', tile: firstDiscard(overdue, 'east') });
    play(overdue, { by: 'west', at: at + 1_000, action: 'pass' });
    assert.equal(deadlineSeat(overdue), 'west');
    liveRooms().set(overdue.id, overdue as unknown as TenantManagedRoom);
    await registration().sweepDueDeadline?.(overdue.id);
    assert.deepEqual(state(overdue).status, {
      type: 'finished',
      winner: 'east',
      reason: 'timeout',
    });
    assert.equal(overdue.events.at(-1)?.type, 'clock-expired');
  } finally {
    registration().clearRooms();
  }
});

/** The accepted log, moved to epoch-era time so a one-day allowance is long gone. */
function overdueRoom(room: XmjRuntimeRoom): { overdue: XmjRuntimeRoom; at: number } {
  const events = room.events.map((event, index) => ({ ...event, at: 1_000 + index * 1_000 }));
  const hydrated = createTenantRuntimeRoomFromEvents(tenant, events as XmjEvent[]);
  assert.ok(hydrated.ok);
  return { overdue: hydrated.room as XmjRuntimeRoom, at: 1_000 + events.length * 1_000 };
}

test('a first move never made aborts the table with no result, as in every other variant', async () => {
  try {
    const { overdue } = overdueRoom(await acceptSeek(1));
    // The match counts its moves from 0, where every other tenant starts at 1.
    assert.equal(state(overdue).moveNumber, 0);
    assert.equal(deadlineSeat(overdue), 'east');
    liveRooms().set(overdue.id, overdue as unknown as TenantManagedRoom);
    await registration().sweepDueDeadline?.(overdue.id);
    assert.deepEqual(state(overdue).status, { type: 'aborted', reason: 'pregame-timeout' });
    assert.equal(overdue.events.at(-1)?.type, 'game-aborted');
  } finally {
    registration().clearRooms();
  }
});

test('west never answering the first discard aborts too: neither seat has made a turn of its own', async () => {
  try {
    const { overdue, at } = overdueRoom(await acceptSeek(1));
    play(overdue, { by: 'east', at, action: 'discard', tile: firstDiscard(overdue, 'east') });
    assert.equal(deadlineSeat(overdue), 'west');
    liveRooms().set(overdue.id, overdue as unknown as TenantManagedRoom);
    await registration().sweepDueDeadline?.(overdue.id);
    assert.deepEqual(state(overdue).status, { type: 'aborted', reason: 'pregame-timeout' });
  } finally {
    registration().clearRooms();
  }
});

// ---- A whole match, with the hidden-information boundary checked at every step -------

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysOf(child, into);
    }
  }
  return into;
}

/** The path of every array in `value` that equals `needle` tile for tile, indices as `[]`. */
function pathsHolding(value: unknown, needle: string, path: string, into: string[] = []) {
  if (Array.isArray(value)) {
    if (JSON.stringify(value) === needle) into.push(path);
    for (const item of value) pathsHolding(item, needle, `${path}[]`, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      pathsHolding(child, needle, `${path}.${key}`, into);
    }
  }
  return into;
}

/**
 * The fields where a tile array may equal the other seat's live hand without
 * being it: the viewer's own hand and its own discard and claim options (each
 * checked against the viewer's own tiles below), and what the table already
 * shows face up (discard rivers, melds, the tiles a claim laid down, the
 * winning shapes of finished hands). Two seats can hold the same sorted hand
 * (["rP","rP","bP","bP"] in a seat's own `hands` failed a full run on main,
 * 2026-10-16), and a finished hand's pair can equal a two-tile hand, so a bare
 * substring search false-alarms; the same array anywhere else is a leak.
 */
function ownOrPublic(seat: XmjSeat): RegExp {
  return new RegExp(
    [
      `^snapshot\\.state\\.hands\\.${seat}$`,
      '^snapshot\\.state\\.legal\\.(discard|claims\\[\\]\\.fromHand)$',
      '^snapshot\\.state\\.(discards\\.(east|west)|melds\\.(east|west)\\[\\]\\.tiles)$',
      '^snapshot\\.state\\.results\\[\\]\\.score\\.shape\\.(pair|meld)$',
      '^(snapshot\\.)?events\\[\\]\\.move\\.fromHand$',
    ].join('|'),
  );
}

/** Nothing served to `seat` names the other hand, the live wall, or any wall of the match. */
async function assertSeatSeesOnlyItsOwn(room: XmjRuntimeRoom, seat: XmjSeat, where: string) {
  const s = state(room);
  const other = OTHER[seat];
  const own = s.match.hand.hands[seat === 'east' ? 0 : 1];
  const client = { id: room.seatTokens[seat]?.clientId ?? `client-${seat}`, seat, solo: false };
  const surfaces: Record<string, unknown> = {
    snapshot: tenantSnapshotPayload(tenant, room, client),
    events: tenantEventsForClient(tenant, room, client),
    seatBoard: await correspondenceSeatBoard({
      roomId: room.id,
      gameSpecId: XIANGQI_MAHJONG_SPEC_ID,
      mySeat: seat,
    }),
  };
  assert.equal(surfaces.seatBoard, null, `${where}: the inbox serves no board for this game`);
  const handLive = s.status.type === 'playing' && !s.match.between;
  if (handLive) {
    const shown = (surfaces.snapshot as { state: XmjPlayerView }).state;
    assert.equal(shown.hands[other], null, `${where}: ${seat} sees ${other}'s hand`);
    // The own-hand fields excused below hold the viewer's tiles, never the other's.
    assert.deepEqual(shown.hands[seat], own, `${where}: ${seat}'s own hand`);
    for (const tile of shown.legal.discard) {
      assert.ok(own.includes(tile), `${where}: ${seat} may discard ${tile}, not in its hand`);
    }
    for (const claim of shown.legal.claims) {
      assert.ok(
        claim.fromHand.every((tile) => own.includes(tile)),
        `${where}: ${seat} may claim with tiles not in its hand`,
      );
    }
    if (shown.phase.type === 'discard' && shown.turn !== seat) {
      assert.equal(shown.phase.drawn, null, `${where}: ${seat} sees the tile ${other} drew`);
    }
  }
  for (const [name, payload] of Object.entries(surfaces)) {
    const keys = keysOf(payload);
    for (const secret of ['setup', 'walls', 'wall', 'firstDealer']) {
      assert.equal(keys.has(secret), false, `${where} ${name}/${seat}: carries "${secret}"`);
    }
    const json = JSON.stringify(payload);
    const wall = s.match.hand.wall;
    if (handLive && wall.length >= 2) {
      assert.ok(!json.includes(JSON.stringify(wall)), `${where} ${name}/${seat}: the live wall`);
    }
    for (const future of s.match.walls.slice(s.match.handIndex + 1)) {
      assert.ok(!json.includes(JSON.stringify(future)), `${where} ${name}/${seat}: a future wall`);
    }
    if (handLive && s.match.hand.hands[other === 'east' ? 0 : 1].length > 0) {
      // Every length, by field: a coincidence is excused only where the array
      // is the viewer's own or already face up on the table.
      const concealed = s.match.hand.hands[other === 'east' ? 0 : 1];
      const allowed = ownOrPublic(seat);
      for (const path of pathsHolding(payload, JSON.stringify(concealed), name)) {
        assert.match(path, allowed, `${where} ${name}/${seat}: ${other}'s concealed tiles`);
      }
    }
  }
}

/** A mulberry32 stream, so a match is the same deal on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The accepted table rebuilt on seeded walls, in the live map under its own id. */
async function seededTable(seed: number): Promise<XmjRuntimeRoom> {
  const accepted = await acceptSeek(3);
  const events = accepted.events.map((event) =>
    event.type === 'room-created'
      ? { ...event, setup: createXmjSetup(seeded(seed), { correspondence: true }) }
      : event,
  );
  const hydrated = createTenantRuntimeRoomFromEvents(tenant, events as XmjEvent[]);
  assert.ok(hydrated.ok);
  const room = hydrated.room as XmjRuntimeRoom;
  liveRooms().set(room.id, room as unknown as TenantManagedRoom);
  return room;
}

// Fixed deals, so the match is the same on every run. Between them they reach
// every excused coincidence: seed 7 deals both seats the same four-tile hand,
// seed 12 a two-tile hand equal to a claim's tiles and a one-tile hand equal to
// a discard river, seed 55 a finished hand's pair equal to a two-tile hand.
for (const seed of [7, 12, 55]) {
  test(`a whole correspondence match (seed ${seed}): the deadline names the seat that owes each move, and no seat sees the other hand or the wall`, async () => {
    try {
      const room = await seededTable(seed);
      const ctx = { rooms: new Map() } as unknown as HttpApiContext;
      let at = Date.now();
      let steps = 0;
      let deals = 0;
      while (state(room).status.type === 'playing') {
        assert.ok(steps < 2_000, 'the match must end');
        steps += 1;
        for (const seat of tenant.colors)
          await assertSeatSeesOnlyItsOwn(room, seat, `step ${steps}`);
        // The public current-games card carries no board, so no tile.
        const card = collectCurrentGames(ctx, at).find((entry) => entry.roomId === room.id);
        if (card) {
          assert.equal('payload' in card, false);
          assert.equal(await currentGameBoardPayload(card), null);
        }
        const s = state(room);
        at += 1_000;
        if (s.match.between) {
          // No button: the deal is the runtime's, due at once.
          for (const seat of tenant.colors) assert.equal(view(room, seat).legal.nextHand, false);
          const pending = tenant.rules.pendingAction?.(s);
          assert.ok(pending, 'between hands the runtime owes the deal');
          assert.ok(pending.at <= at, 'due at once');
          deals += 1;
          play(room, { ...pending.move, at });
          continue;
        }
        const move = nextMove(room, at);
        assert.equal(deadlineSeat(room), move.by, `step ${steps}: the deadline names ${move.by}`);
        play(room, { ...move, at });
      }
      assert.equal(state(room).status.type, 'finished');
      assert.ok(deals >= 1, 'the match dealt past its first hand');
      assert.equal(tenantDurableDeadlineFor(tenant, room), null, 'a finished table owes nothing');
    } finally {
      registration().clearRooms();
    }
  });
}
