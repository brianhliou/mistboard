import './room-invite-preview.css';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { renderStartPositionSvg } from './start-position-board.js';

// A signed-out visitor opening a correspondence room's invite link (#1058): the
// room refuses the seat until they sign in, and instead of "Access rejected" the
// page heads with "Alice invited you to Xiangqi, 3 days per move", the variant's
// start board, then "Sign in to take your seat". The server answers only for a
// correspondence room waiting on its second player, and only with the game, the
// pace and the creator's display name (routes/correspondence-invite.ts); a 404
// keeps today's copy. Shared by the Fog Chess room and the tenant rooms.

export type RoomInvitePreview = {
  gameSpecId: string;
  daysPerMove: number;
  creatorName: string;
};

type Entry = { value: RoomInvitePreview | null };
const entries = new Map<string, Entry>();

export function parseRoomInvitePreview(value: unknown): RoomInvitePreview | null {
  if (!value || typeof value !== 'object') return null;
  const body = value as Record<string, unknown>;
  if (typeof body.gameSpecId !== 'string' || body.gameSpecId === '') return null;
  if (typeof body.daysPerMove !== 'number' || !(body.daysPerMove > 0)) return null;
  if (typeof body.creatorName !== 'string' || body.creatorName.trim() === '') return null;
  return {
    gameSpecId: body.gameSpecId,
    daysPerMove: body.daysPerMove,
    creatorName: body.creatorName.trim(),
  };
}

/**
 * The preview for this room once loaded, else null. The first call starts the
 * one fetch; `onLoad` runs when a preview arrives so the caller can re-render.
 */
export function roomInvitePreview(roomId: string, onLoad?: () => void): RoomInvitePreview | null {
  if (!roomId) return null;
  const known = entries.get(roomId);
  if (known) return known.value;
  const entry: Entry = { value: null };
  entries.set(roomId, entry);
  void fetch(`/api/correspondence/rooms/${encodeURIComponent(roomId)}/invite`)
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((body) => {
      entry.value = parseRoomInvitePreview(body);
      if (entry.value) onLoad?.();
    });
  return null;
}

/** "Alice invited you to Xiangqi, 3 days per move". */
export function roomInviteHeading(preview: RoomInvitePreview): string {
  return t(
    preview.daysPerMove === 1 ? 'correspondence.invitedYouDay' : 'correspondence.invitedYouDays',
    {
      name: preview.creatorName,
      variant: variantDisplayLabel(preview.gameSpecId),
      days: preview.daysPerMove,
    },
  );
}

/**
 * The variant's start position, drawn with no side: the same picture as its seek
 * tile, so a fog or face-down variant stays covered (start-position-board.ts).
 * A variant with no start renderer keeps the labelled tile.
 */
export function buildRoomInviteBoard(gameSpecId: string): HTMLElement {
  const board = document.createElement('div');
  board.className = 'room-invite-board';
  board.setAttribute('aria-hidden', 'true');
  const label = document.createElement('span');
  label.className = 'room-invite-board-label';
  label.textContent = variantDisplayLabel(gameSpecId);
  board.append(label);
  void renderStartPositionSvg(gameSpecId)
    .then((svg) => {
      if (!svg) return;
      const frame = document.createElement('div');
      frame.className = 'room-invite-board-frame notranslate';
      frame.setAttribute('translate', 'no');
      frame.innerHTML = svg;
      frame.querySelector('svg')?.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      board.replaceChildren(frame);
    })
    .catch((err) => console.warn('[room-invite] start board failed', err));
  return board;
}

/** The preview already loaded for this room, without starting a fetch. */
export function loadedRoomInvitePreview(roomId: string): RoomInvitePreview | null {
  return entries.get(roomId)?.value ?? null;
}

// The Play Brian host's handle (GET /api/correspondence/host, public), so a room
// against him can say once that he is a person who replies within the pace.
let hostEntry: { value: string | null } | null = null;

export function correspondenceHostHandle(onLoad?: () => void): string | null {
  if (hostEntry) return hostEntry.value;
  const entry: { value: string | null } = { value: null };
  hostEntry = entry;
  void fetch('/api/correspondence/host')
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null)
    .then((body: { enabled?: unknown; host?: { handle?: unknown } } | null) => {
      const handle = body?.enabled === true ? body.host?.handle : null;
      entry.value = typeof handle === 'string' && handle !== '' ? handle : null;
      if (entry.value) onLoad?.();
    });
  return null;
}

/** Tests only. */
export function resetRoomInvitePreviews(): void {
  entries.clear();
  hostEntry = null;
}
