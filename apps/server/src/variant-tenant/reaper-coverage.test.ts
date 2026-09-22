import assert from 'node:assert/strict';
import test from 'node:test';
import type { Color, RoomTimeControl } from '@mistboard/game';
import { type DarkChessTenantEvent, darkChessTenant } from '../dark-chess-tenant.js';
import {
  clearTenantRuntimeTimers,
  scheduleTenantLifecycleTimers,
  type TenantLifecycleClient,
} from './lifecycle.js';
import { appendTenantRuntimeEvent, createTenantRuntimeRoom } from './runtime.js';

// Reaper coverage: which non-terminal rooms are claimed by something that can
// end them, as a table, because the coverage is emergent rather than stated.
//
// Several independent mechanisms share the job and each bails on a different
// condition, so the state space is covered only by coincidence unless something
// asserts it. In-memory (lifecycle.ts): the clock timer needs an ARMED clock,
// the abort timer needs moveNumber < 2, the forfeit timer needs EXACTLY ONE
// seat absent AND a disconnect-forfeit policy that is on (both are off since
// #436, so this mechanism currently claims nothing). Durable: the guest-prestart sweep needs zero
// move-played/clock-started events AND no signed-in seat token
// (persistence-game-lifecycle.ts:356), the stale-paused sweep needs `paused`,
// the deadline sweeper needs days-per-move.
//
// A room in an unclaimed cell sits in `playing` until the process restarts.
// That was invisible until it reached the landing page, which counted raw
// status: prod served "7 games in play" against 0 players online.
//
// Add a row when you add a mechanism or a room shape. `reaped: true` rows pin
// the reapers that DO work, so a `reaped: false` row is evidence of absence
// rather than a broken harness.

const LIVE_TC: RoomTimeControl = { initialMs: 180_000, incrementMs: 2_000 };

type Cell = {
  name: string;
  timeControl: RoomTimeControl | undefined;
  seats: 'both' | 'white-only';
  moves: number;
  connected: Color[];
  reaped: boolean;
};

const CELLS: Cell[] = [
  {
    name: 'live clock, both seated, past move 1, both gone -> clock flags',
    timeControl: LIVE_TC,
    seats: 'both',
    moves: 2,
    connected: [],
    reaped: true,
  },
  {
    name: 'live clock, both seated, no moves, both gone -> pregame abort',
    timeControl: LIVE_TC,
    seats: 'both',
    moves: 0,
    connected: [],
    reaped: true,
  },
  {
    // The clock is the only reaper left in this cell: the disconnect forfeit is
    // off for PvE and, since the PvP half, for human opponents too (#436,
    // lifecycle-windows.ts). It is enough BECAUSE the clock runs through a
    // disconnect, so the absent seat flags. The clockless version of this same
    // shape is the row below, and it is why the create route defaults a clock.
    name: 'live clock, both seated, past move 1, one gone -> absent seat flags',
    timeControl: LIVE_TC,
    seats: 'both',
    moves: 2,
    connected: ['white'],
    reaped: true,
  },
  {
    // An abandoned invite link, and the likely source of the stale rooms seen
    // in prod. Fixed by the 'unjoined' abort phase: the room is `playing` from
    // creation with a seat still open, so the pregame window never opened
    // (nobody owes a move) and the forfeit window needs moveNumber >= 2.
    name: 'live clock, opponent never joined, creator gone',
    timeControl: LIVE_TC,
    seats: 'white-only',
    moves: 0,
    connected: [],
    reaped: true,
  },
  {
    // KNOWN GAP, deliberately left open -- but no longer reachable by creating
    // one. A room with no clock at all is claimed by nothing once it is past
    // move 1 with both players gone: nothing can flag it, the pregame window has
    // passed, and the leaver-forfeit needs exactly one seat absent.
    //
    // Rather than invent a terminal event for it (the game has real moves and no
    // winner, so aborting would erase a played game and forfeiting would award a
    // win to nobody -- the honest end is a draw by abandonment, a product
    // decision), the SOURCE is closed: the create route now defaults the time
    // control instead of yielding a clockless room. Engine self-play stays
    // untimed by design and runs headless in the worker, never through that
    // route or these maps.
    //
    // The row stays because the state is still expressible -- an old clockless
    // room hydrating from its event log would land here -- and because deleting
    // the row would hide that this cell has no reaper.
    name: 'NO clock, both seated, past move 1, both gone (known gap)',
    timeControl: undefined,
    seats: 'both',
    moves: 2,
    connected: [],
    reaped: false,
  },
];

function buildRoom(cell: Cell) {
  const created = createTenantRuntimeRoom(darkChessTenant, `dchx_reaper_${CELLS.indexOf(cell)}`, {
    now: 1_000,
    ...(cell.timeControl ? { timeControl: cell.timeControl } : {}),
  });
  assert.ok(created.ok, `fixture room must create (got ${created.ok ? '' : created.error})`);
  const room = created.room;

  const seatEvents: DarkChessTenantEvent[] = [
    { type: 'seat-assigned', at: 2_000, roomId: room.id, clientId: 'white-client', seat: 'white' },
    ...(cell.seats === 'both'
      ? ([
          {
            type: 'seat-assigned',
            at: 2_500,
            roomId: room.id,
            clientId: 'black-client',
            seat: 'black',
          },
        ] as DarkChessTenantEvent[])
      : []),
  ];
  const moveEvents: DarkChessTenantEvent[] = [
    {
      type: 'move-played',
      at: 10_000,
      roomId: room.id,
      color: 'white',
      move: { from: 'e2', to: 'e4' },
    },
    {
      type: 'move-played',
      at: 20_000,
      roomId: room.id,
      color: 'black',
      move: { from: 'e7', to: 'e5' },
    },
  ].slice(0, cell.moves) as DarkChessTenantEvent[];

  for (const event of [...seatEvents, ...moveEvents]) {
    appendTenantRuntimeEvent(darkChessTenant, room, event);
  }

  const clients = new Set<TenantLifecycleClient<Color>>();
  for (const seat of cell.connected) {
    clients.add({ displaced: false, seat });
  }
  return { ...room, clients };
}

// A room is claimed if some mechanism will act on it unprompted: an armed
// in-memory timer, or a durable deadline the sweeper will pick up.
function isClaimedByAReaper(room: ReturnType<typeof buildRoom>): boolean {
  return (
    room.clockTimer !== null ||
    room.abortTimer !== null ||
    room.forfeitTimer !== null ||
    room.abortDeadline !== null ||
    room.forfeitDeadline !== null
  );
}

for (const cell of CELLS) {
  test(`reaper coverage: ${cell.name}`, () => {
    const room = buildRoom(cell);
    assert.equal(
      room.projection.state.status.type,
      'playing',
      'fixture must be a non-terminal room',
    );
    assert.equal(
      room.projection.clock === undefined,
      cell.timeControl === undefined,
      'clock presence must follow the supplied time control',
    );

    scheduleTenantLifecycleTimers(darkChessTenant, room, {
      appendEvent: async () => {
        throw new Error('no lifecycle event expected while only scheduling');
      },
      broadcastEventAppended: () => {},
      now: () => 1_000_000,
    });

    try {
      assert.equal(
        isClaimedByAReaper(room),
        cell.reaped,
        cell.reaped
          ? 'expected some reaper to claim this room; nothing will ever end it'
          : 'expected no reaper (documented gap)',
      );
    } finally {
      clearTenantRuntimeTimers(room);
    }
  });
}
