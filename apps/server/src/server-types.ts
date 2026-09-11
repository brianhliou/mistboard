import type {
  Color,
  GameEvent,
  GameProjection,
  GameSpecId,
  RoomTimeControl,
  VariantId,
} from '@mistboard/game';
import type { WebSocket } from 'ws';
import type { Seat } from './payloads.js';
import type { GameMode } from './persistence.js';

export type RematchOffer = {
  tokenHash: string;
  userId: string | null;
  at: number;
};

export type RematchPendingRedirect = {
  roomId: string;
  seat: Color;
  rawToken: string;
  url: string;
};

export type RematchState = {
  offers: Partial<Record<Color, RematchOffer>>;
  finalizedRoomId?: string;
  // Keyed by the OLD-room seat. Re-emitted on reconnect to that seat so a
  // player who was offline during finalize still lands in the new room.
  pendingRedirects?: Partial<Record<Color, RematchPendingRedirect>>;
};

export type Client = {
  debugRequested: boolean;
  devViews: boolean;
  id: string;
  messageTimestamps: number[];
  socket: WebSocket;
  roomId: string;
  seat: Seat;
  seatTokenHash?: string;
  // Authenticated account id for this connection, or null when anonymous. Used
  // to displace another live connection from the same account across devices
  // (see seatsShareAuthority), independent of the bearer seat token.
  userId?: string | null;
  displaced: boolean;
  solo: boolean;
};

export type SeatTokenState = {
  clientId: string;
  // The connecting browser's durable id (migration 137), or null for a seat
  // pre-issued before its holder connected. Backfilled on reconnect.
  deviceId?: string | null;
  seat: Color;
  tokenHash: string;
  userId: string | null;
  userHandle: string | null;
  userDisplayName: string | null;
  issuedAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

export type SeatAssignment = {
  seat: Seat;
  seatToken?: string;
  seatTokenHash?: string;
  // Set when the connection was refused a playing seat for a policy reason the
  // client should surface as more than a plain spectator. Currently only the
  // rated account-gate: a guest may not take a color seat in a rated room, so
  // the connection layer closes with a 'rated requires account' reason instead
  // of the generic 'private room'.
  deniedReason?: 'rated-requires-account' | 'play-disabled';
};

export type Room = {
  id: string;
  clients: Set<Client>;
  events: GameEvent[];
  projection: GameProjection;
  seatTokens: Partial<Record<Color, SeatTokenState>>;
  clockTimer: ReturnType<typeof setTimeout> | null;
  engineTimer: ReturnType<typeof setTimeout> | null;
  // Pre-move abort window. While a game is playing but both players haven't yet
  // completed their first move, the side to move must move within ABORT_WINDOW_MS
  // or the game is aborted (no result). abortPhase tracks which side's window is
  // live ('white-1' | 'black-1') so the deadline only resets when the phase
  // changes, not on unrelated re-broadcasts. abortDeadline is the absolute ms
  // timestamp sent to clients for the countdown. All null once both first moves
  // are in (or the game isn't in a pre-move window).
  abortTimer: ReturnType<typeof setTimeout> | null;
  abortDeadline: number | null;
  abortPhase: 'white-1' | 'black-1' | 'unjoined' | null;
  // Post-move-1 leaver forfeit. When a seated player disconnects from an
  // in-progress game and their opponent is present, the absent side has
  // FORFEIT_WINDOW_MS to return or it forfeits (opponent wins by abandonment).
  // forfeitSeat is the absent side counting down; deadline is the absolute ms
  // timestamp sent to clients. Re-derived from seat presence on every
  // connect/disconnect and state change; the deadline only resets when
  // forfeitSeat changes, so a reconnect-then-redrop doesn't extend it.
  forfeitTimer: ReturnType<typeof setTimeout> | null;
  forfeitDeadline: number | null;
  forfeitSeat: Color | null;
  mode: GameMode;
  gameSpecId: GameSpecId;
  region?: string;
  rated: boolean;
  randomEngine: boolean;
  engineReservationId: string | null;
  randomSeating: boolean;
  // Honored on the first PvP arrival when set: assigns that color to the creator.
  // Random preference uses randomSeating instead, so this is null in that path.
  creatorPreference: 'white' | 'black' | null;
  pveEngineId: string | null;
  pveBotId: string | null;
  pendingWrites: Promise<void>;
  gameEndRecorded: boolean;
  variant: VariantId;
  hiddenDraft960: boolean;
  timeControl: RoomTimeControl | undefined;
  rematch: RematchState;
  // Pending seat-vacated timers keyed by color. If a seated player disconnects
  // before any move is played, we defer the seat-vacated event so a quick
  // reconnect cancels the abort.
  pendingVacates: Partial<Record<Color, ReturnType<typeof setTimeout>>>;
  // Set when a paused room is hydrated post-restart. Fires the grace resume
  // (reason='grace-elapsed') if both players don't show up within the window.
  // Cleared on resume.
  pauseGraceTimer: ReturnType<typeof setTimeout> | null;
};

export type LobbyTicket = {
  id: string;
  createdAt: number;
  gameSpecId: GameSpecId;
  hiddenDraft960: boolean;
  rated: boolean;
  region: string | null;
  matchedAt: number | null;
  roomId: string | null;
  timeControl: RoomTimeControl | undefined;
};
