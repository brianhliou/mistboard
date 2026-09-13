import {
  type Color,
  type GameEvent,
  type GameProjection,
  type GameState,
  initialGameProjection,
  type PlayerView,
  replayGameEvents,
  type VariantId,
  variantForId,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { Seat, SnapshotClient, SnapshotRoom } from './payloads.js';
import type { Client, Room, SeatTokenState } from './server-types.js';

export type GameProjectionFixtureOptions = Omit<Partial<GameProjection>, 'state'> & {
  events?: GameEvent[];
  state?: Partial<GameState>;
};

export function gameProjectionFixture({
  events,
  state,
  ...overrides
}: GameProjectionFixtureOptions = {}): GameProjection {
  const roomId = overrides.roomId ?? events?.[0]?.roomId ?? 'fixture-room';
  const variant = overrides.variant ?? 'dark-chess';
  const base = events ? replayGameEvents(events) : initialGameProjection(roomId, variant);

  return {
    ...base,
    ...overrides,
    state: state ? { ...base.state, ...state } : base.state,
  };
}

export type PlayerViewFixtureOptions = Partial<PlayerView> & {
  projection?: GameProjection;
  perspective?: Color;
};

export function playerViewFixture({
  projection,
  perspective = 'white',
  ...overrides
}: PlayerViewFixtureOptions = {}): PlayerView {
  const source = projection ?? gameProjectionFixture();
  const base = variantForId(source.variant).getPlayerView(source.state, perspective);
  return {
    ...base,
    ...overrides,
    perspective,
  };
}

export type SnapshotRoomFixtureOptions = Omit<
  Partial<SnapshotRoom>,
  'clients' | 'events' | 'projection'
> & {
  clients?: Iterable<{ seat: Seat; displaced: boolean }>;
  events?: GameEvent[];
  projection?: GameProjection;
  variant?: VariantId;
};

export function snapshotRoomFixture({
  clients,
  events,
  projection,
  variant = 'dark-chess',
  ...overrides
}: SnapshotRoomFixtureOptions = {}): SnapshotRoom {
  const roomId = overrides.id ?? projection?.roomId ?? events?.[0]?.roomId ?? 'fixture-room';
  const roomEvents = events ?? [{ type: 'room-created', at: 1, roomId, variant, offer: [] }];
  const roomProjection =
    projection ?? gameProjectionFixture({ events: roomEvents, roomId, variant });

  return {
    id: roomId,
    clients: new Set(clients ?? connectedSeats()),
    events: roomEvents,
    projection: roomProjection,
    ...overrides,
  };
}

export function snapshotClientFixture(overrides: Partial<SnapshotClient> = {}): SnapshotClient {
  return {
    devViews: false,
    id: 'fixture-client',
    seat: 'white',
    solo: false,
    ...overrides,
  };
}

export type ClientFixtureOptions = Partial<Client> & {
  seat?: Seat;
};

export function clientFixture({ seat = 'white', ...overrides }: ClientFixtureOptions = {}): Client {
  const id = overrides.id ?? `${seat}-client`;
  return {
    debugRequested: false,
    devViews: false,
    displaced: false,
    id,
    messageTimestamps: [],
    roomId: overrides.roomId ?? 'fixture-room',
    seat,
    socket: { send: () => {} } as unknown as WebSocket,
    solo: false,
    ...overrides,
  };
}

export type SeatTokenFixtureOptions = Partial<SeatTokenState> & {
  hash?: string;
  seat: Color;
};

export function seatTokenFixture({
  hash,
  seat,
  ...overrides
}: SeatTokenFixtureOptions): SeatTokenState {
  const now = new Date();
  return {
    clientId: `${seat}-client`,
    issuedAt: now,
    lastSeenAt: now,
    revokedAt: null,
    seat,
    tokenHash: hash ?? `${seat}-token-hash`,
    userDisplayName: null,
    userHandle: null,
    userId: null,
    ...overrides,
  };
}

export type RoomFixtureOptions = Omit<Partial<Room>, 'clients' | 'events' | 'projection'> & {
  clients?: Iterable<Client>;
  events?: GameEvent[];
  projection?: GameProjection;
};

export function roomFixture({
  clients,
  events,
  projection,
  ...overrides
}: RoomFixtureOptions = {}): Room {
  const roomId = overrides.id ?? projection?.roomId ?? events?.[0]?.roomId ?? 'fixture-room';
  const variant = overrides.variant ?? projection?.variant ?? 'dark-chess';
  const roomEvents = events ?? [{ type: 'room-created', at: 1, roomId, variant, offer: [] }];
  const roomProjection =
    projection ?? gameProjectionFixture({ events: roomEvents, roomId, variant });

  return {
    abortDeadline: null,
    abortPhase: null,
    abortTimer: null,
    clients: new Set(clients ?? []),
    clockTimer: null,
    creatorPreference: null,
    engineReservationId: null,
    engineTimer: null,
    events: [...roomEvents],
    forfeitDeadline: null,
    forfeitSeat: null,
    forfeitTimer: null,
    gameEndRecorded: false,
    gameSpecId: roomProjection.gameSpecId,
    id: roomId,
    mode: 'pvp',
    pauseGraceTimer: null,
    pendingVacates: {},
    pendingWrites: Promise.resolve(),
    projection: roomProjection,
    pveBotId: null,
    pveEngineId: null,
    randomEngine: false,
    randomSeating: false,
    rated: false,
    rematch: { offers: {} },
    seatTokens: {},
    timeControl: undefined,
    variant,
    ...overrides,
  };
}

function connectedSeats(): Array<{ seat: Seat; displaced: boolean }> {
  return [
    { seat: 'white', displaced: false },
    { seat: 'black', displaced: false },
  ];
}
