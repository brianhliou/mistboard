// The list order is ended_at DESC, room_id DESC. Carry both fields so tied
// finish times page deterministically, without looking up a mutable offset.
export type GamePageCursor = { endedAt: string; roomId: string };

// null = first page; undefined = malformed cursor (routes return 400).
export function parseGamePageCursor(raw: string | null): GamePageCursor | null | undefined {
  if (raw === null) return null;
  if (raw.length > 512) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || value.length !== 2) return undefined;
    const [endedAt, roomId] = value;
    if (typeof endedAt !== 'string' || typeof roomId !== 'string' || !roomId || roomId.length > 256)
      return undefined;
    const date = new Date(endedAt);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== endedAt) return undefined;
    return { endedAt, roomId };
  } catch {
    return undefined;
  }
}
