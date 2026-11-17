// Client ids are untrusted. Only an anonymous human playing server engines
// may opt out this way: a PvP opponent or any account seat keeps the game public.
export function isReleaseSmokeClientId(id: unknown): id is string {
  return typeof id === 'string' && /^prod-[a-z0-9-]+-smoke-\d+$/.test(id);
}

export function isReleaseSmokeRoom(
  room: {
    projection?: { seats?: Partial<Record<string, string>> };
    seatTokens?: Partial<Record<string, { userId?: string | null }>>;
  },
  isEngine: (id: string) => boolean,
): boolean {
  if (Object.values(room.seatTokens ?? {}).some((token) => token?.userId)) return false;
  const ids = Object.values(room.projection?.seats ?? {}).filter(
    (id): id is string => typeof id === 'string',
  );
  return (
    ids.some(isEngine) &&
    ids.some(isReleaseSmokeClientId) &&
    ids.every((id) => isEngine(id) || isReleaseSmokeClientId(id))
  );
}
