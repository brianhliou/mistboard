// Scope in-flight loads to the live map, so separate room registries never
// share instances. The callback must include recovery writes, token loading,
// reservation restoration and publication, not just the event-log read.
const pendingHydrations = new WeakMap<object, Map<string, Promise<unknown>>>();

export function hydrateRoomOnce<Result>(
  rooms: object,
  roomId: string,
  hydrate: () => Promise<Result>,
): Promise<Result> {
  let pending = pendingHydrations.get(rooms);
  if (!pending) {
    pending = new Map();
    pendingHydrations.set(rooms, pending);
  }
  // A map/room-id pair always uses the same hydrator and result type.
  const existing = pending.get(roomId) as Promise<Result> | undefined;
  if (existing) return existing;
  const loads = pending;
  // Defer execution until the promise is registered, including sync failures.
  const load = Promise.resolve()
    .then(hydrate)
    .finally(() => loads.delete(roomId));
  loads.set(roomId, load);
  return load;
}
