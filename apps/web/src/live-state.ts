import type {
  Chess960Start,
  Color,
  GameEvent,
  GameSpecId,
  Move,
  PieceRole,
  PlayerView,
  Square,
  XiangqiColor,
} from '@mistboard/game';
import type { Api } from 'chessground/api';
import type { ProfileIdentity } from './profile-link.js';
import { isColor } from './web-utils.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlayableSeat = Color | XiangqiColor;
export type Seat = PlayableSeat | 'spectator';
export type RoomMode = 'pvp' | 'pve' | 'eve' | 'imported' | 'manual' | 'correspondence';

// Shared rematch state for chess (white/black) and Dark Mini Xiangqi (red/black).
// `declined` is a transient, client-only cue (the server doesn't send it); see the
// rematch:state handling in live-socket.ts.
export type RematchClientState = {
  offers: { white?: boolean; black?: boolean; red?: boolean };
  finalizedRoomId: string | null;
  declined?: boolean;
};

// Set when the local player clicks "Cancel rematch", consumed by the next
// rematch:state frame so the socket can distinguish a self-cancel from an
// opponent decline (both clear the pending offer the same way on the wire).
let pendingRematchCancel = false;
export function noteRematchCancel(): void {
  pendingRematchCancel = true;
}
export function takeRematchCancel(): boolean {
  const was = pendingRematchCancel;
  pendingRematchCancel = false;
  return was;
}
export type PauseReason = 'shutdown' | 'admin' | 'engine-error';
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'displaced'
  | 'rejected';
// How prominently a mid-game reconnect is surfaced. A dropped socket reconnects
// on its own in well under a second most of the time, so we stage the UI rather
// than flashing the full notice on every blip: 'none' = stay silent during the
// grace window, 'dot' = the player's own presence dot goes grey/pulsing, 'banner'
// = the full notice + "Reconnect now" once retries have genuinely been failing.
// Driven by timers in live-socket; reset to 'none' on (re)connect.
export type ConnectionNoticeTier = 'none' | 'dot' | 'banner';
export type PlayAgainStatus = 'creating' | 'failed' | 'idle';
export type DraftOffers = Partial<Record<Color, Chess960Start[]>>;
export type DraftResolvedStartIds = Partial<Record<Color, number>>;
export type PromotionRole = Exclude<PieceRole, 'king' | 'pawn'>;
export type MovePlayedEvent = Extract<GameEvent, { type: 'move-played' }>;
export type MoveListEntry = {
  event: MovePlayedEvent;
  eventIndex: number;
  ply: number;
};
export type PendingPromotion = {
  color: Color;
  from: Square;
  moves: Move[];
  to: Square;
};
export type InfoTone = 'danger' | 'default' | 'pending' | 'success';
export type DevViews = {
  opponent: Color;
  opponentView: PlayerView;
  player: PlayerView;
  truth: PlayerView;
};
export type StoredSeatToken = {
  seat: PlayableSeat;
  token: string;
};
export type ConnectedSeats = Partial<Record<PlayableSeat, boolean>>;

// Top-level clock for the xiangqi-family runtimes (Dark Mini Xiangqi, Dark
// Xiangqi). Standard chess carries its clock inside the PlayerView; these
// runtimes deliver it alongside the view in the snapshot, so it lives here.
export type XiangqiFamilyClock = {
  activeColor: XiangqiColor | null;
  incrementMs: number;
  initialMs: number;
  remainingMs: Record<XiangqiColor, number>;
  runningSince: number | null;
};

export type LiveRefs = {
  board: HTMLDivElement;
  boardPaused: HTMLDivElement;
  boardStatus: HTMLDivElement;
  clockBottom: HTMLDivElement;
  clockNote: HTMLParagraphElement;
  clockTop: HTMLDivElement;
  draftPicker: HTMLDivElement;
  actionStatus: HTMLDivElement;
  actionSection: HTMLElement;
  capturesBottom: HTMLDivElement;
  capturesTop: HTMLDivElement;
  devViews: HTMLDivElement;
  devViewsSection: HTMLElement;
  gameInfo: HTMLDivElement;
  hiddenPool: HTMLDivElement;
  moveList: HTMLOListElement;
  offerSection: HTMLElement;
  playerBottom: HTMLDivElement;
  playerTop: HTMLDivElement;
  promotion: HTMLDivElement;
  replayControls: NodeListOf<HTMLButtonElement>;
  replayMeta: HTMLParagraphElement;
  roomActions: HTMLDivElement;
  selectionSection: HTMLElement;
  roomMeta: HTMLParagraphElement;
  selectionList: HTMLDivElement;
  starts: HTMLDivElement;
  gameControls: HTMLDivElement;
  gameControlsSection: HTMLElement;
};

export type SoundController = {
  play(kind: SoundKind): void;
  // Play once the audio context is unlocked. If already unlocked, plays
  // immediately; otherwise defers a single pending sound until the first user
  // gesture. Used for the engine's opening move, which can arrive before the
  // player has interacted with the room page (so the context is still locked).
  playWhenUnlocked(kind: SoundKind): void;
};

export type SoundKind =
  | 'cannon-capture'
  | 'capture'
  | 'captured'
  | 'castle'
  | 'draw'
  | 'drop'
  | 'flip'
  | 'game-start'
  | 'king-capture'
  | 'king-fall'
  // Learn and puzzle event sounds are synth-only: no sound set maps files for
  // them, so every set uses the same purpose-built tones.
  | 'learn-failure'
  | 'learn-take'
  | 'level-end'
  | 'level-start'
  | 'lose'
  | 'low-time'
  | 'move'
  | 'puzzle-solved'
  | 'stage-end'
  | 'stage-start'
  | 'win';

// ── Shared mutable state (accessed by both live-socket and live-render) ────────

export const liveState = {
  // Setup fields — set once by live.ts before first socket/render call
  room: '',
  socketUrl: '',
  engineRequested: false,
  debugRequested: false,
  variantRequested: null as string | null,
  gameSpecId: null as GameSpecId | null,

  // Cross-module runtime state
  clientId: '',
  clientCount: 0,
  connectionState: 'connecting' as ConnectionState,
  // See ConnectionNoticeTier: staged visibility for an in-progress reconnect.
  connectionNoticeTier: 'none' as ConnectionNoticeTier,
  closeReason: '',
  latencyMs: null as number | null,
  lastServerAt: null as number | null,
  lastSnapshotAt: null as number | null,
  roomRegion: 'global' as string,
  roomMode: 'pvp' as RoomMode,
  rated: true,
  paused: false,
  pauseReason: null as PauseReason | null,
  // Absolute ms deadline of the live pre-move abort window, or null. Drives the
  // "Aborting in 0:NN" countdown; an absolute timestamp so it survives reconnect.
  abortDeadline: null as number | null,
  // Absolute ms deadline of the post-move-1 leaver forfeit window, or null. Only
  // a present (winning) player ever receives this set — drives the "opponent
  // left, you win in 0:NN" banner.
  forfeitDeadline: null as number | null,
  pveEngineId: null as string | null,
  pveEngineName: null as string | null,
  // Keyed by PlayableSeat (not just chess Color): the mini-xiangqi rooms ride
  // this same shell and their seats are red/black.
  seatDisplayNames: {} as Partial<Record<PlayableSeat, string>>,
  // Where each seat name links, parallel to seatDisplayNames. A seat with no
  // public page (a guest, an engine with no bot fronting it) is simply absent.
  seatProfiles: {} as Partial<Record<PlayableSeat, ProfileIdentity>>,
  seat: 'spectator' as Seat,
  solo: false,
  offer: [] as Chess960Start[],
  offers: {} as DraftOffers,
  selections: {} as Partial<Record<Color, number>>,
  devViews: null as DevViews | null,
  resolvedStartId: null as number | null,
  resolvedStartIds: {} as DraftResolvedStartIds,
  state: null as PlayerView | null,
  // Top-level clock + time control for the xiangqi-family runtimes (null for
  // chess, which embeds its clock in the PlayerView, and for untimed games).
  clock: null as XiangqiFamilyClock | null,
  // daysPerMove marks a correspondence clock; the shell switches to day-scale
  // clock rendering and drops live-only chrome (low-time sound) off it.
  timeControl: null as { initialMs: number; incrementMs: number; daysPerMove?: number } | null,
  events: [] as GameEvent[],
  reconnectAttempt: 0,
  // Dark Mini Xiangqi reuses this shared rematch state over red/black, so the
  // offers map carries an optional `red` alongside chess's white/black. `declined`
  // is a transient client-only cue set when the opponent declines our offer.
  rematch: { offers: { white: false, black: false }, finalizedRoomId: null } as RematchClientState,
  connectedSeats: { white: false, black: false } as ConnectedSeats,

  // Chessground instance — owned by live-render, typed here for cross-module access
  ground: null as Api | null,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

export function resolveWebSocketBaseUrl(): string {
  const configured = import.meta.env.VITE_MISTBOARD_WS_URL;
  if (configured) return (configured as string).replace(/\?$/, '');
  if (import.meta.env.DEV) return 'ws://localhost:3001';
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

export function normalizedOffers(
  primaryOffer: Chess960Start[],
  nextOffers: DraftOffers | undefined,
): DraftOffers {
  if (nextOffers?.white || nextOffers?.black) return nextOffers;
  if (primaryOffer.length === 0) return {};
  return { white: primaryOffer, black: primaryOffer };
}

// The browser's durable id, one per localStorage, sent on every live connect
// so a guest seat can be attributed to this browser at game end (server
// migration 137). Random, first-party, never a cookie, never shown to another
// visitor. Regenerated only if storage is cleared. Returns null when storage
// is unavailable (private mode that throws), in which case the seat simply
// has no device and the game counts as an anonymous guest game.
export function deviceIdForBrowser(): string | null {
  const key = 'mistboard.device';
  const existing = readLocalStorage(key);
  if (existing && /^[a-zA-Z0-9:_-]{8,80}$/.test(existing)) return existing;
  const next =
    window.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  writeLocalStorage(key, next);
  return readLocalStorage(key) === next ? next : null;
}

export function clientIdForRoom(roomId: string): string {
  const key = `mistboard.client.${roomId}`;
  const existing = readLocalStorage(key);
  if (existing && /^[a-zA-Z0-9:_-]{8,80}$/.test(existing)) return existing;
  const next =
    window.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  writeLocalStorage(key, next);
  return next;
}

export function seatTokenForRoom(roomId: string): string | null {
  const stored = readSeatTokenForRoom(roomId);
  return stored?.token ?? null;
}

export function readSeatTokenForRoom(roomId: string): StoredSeatToken | null {
  const raw = readLocalStorage(`mistboard.seatToken.${roomId}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSeatToken>;
    if (!isPlayableSeat(parsed.seat)) return null;
    if (typeof parsed.token !== 'string' || !/^[a-zA-Z0-9_-]{32,128}$/.test(parsed.token))
      return null;
    return { seat: parsed.seat, token: parsed.token };
  } catch {
    return null;
  }
}

export function isPlayableSeat(value: unknown): value is PlayableSeat {
  return isColor(value) || value === 'red';
}

export function writeSeatTokenForRoom(roomId: string, token: StoredSeatToken): void {
  writeLocalStorage(`mistboard.seatToken.${roomId}`, JSON.stringify(token));
}

export function clearSeatTokenForRoom(roomId: string): void {
  try {
    window.localStorage.removeItem(`mistboard.seatToken.${roomId}`);
  } catch {
    // Storage may be unavailable; reset still proceeds server-side.
  }
}

export function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The room still works without seat recovery if storage is unavailable.
  }
}
