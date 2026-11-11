// Wall-clock projection of a server clock snapshot, shared by every surface that
// renders a live tenant clock: the room rail (room-chrome.ts) and the TV / homepage
// live follow (watch-tenant-replay.ts). Mirrors packages/game clockRemainingMs, but
// generic over the tenant's color set (red/black, white/black, ...) instead of the
// chess kernel's Color.
export type TenantWebClock<C extends string> = {
  activeColor: C | null;
  incrementMs: number;
  initialMs: number;
  remainingMs: Record<C, number>;
  runningSince: number | null;
};

export function isClockReconnecting(connection: string): boolean {
  return connection === 'disconnected' || connection === 'reconnecting';
}

// Both live shells render synchronously when the socket drops. Hold that
// instant across ticks, full renders and reconnect attempts; the server's next
// snapshot remains authoritative when the connection comes back.
export function createClockDisplayTime(): (connection: string) => number {
  let frozenAt: number | null = null;
  return (connection) => {
    if (connection === 'connected') {
      frozenAt = null;
      return Date.now();
    }
    frozenAt ??= Date.now();
    return frozenAt;
  };
}

export function clockRemainingMs<C extends string>(
  clock: TenantWebClock<C>,
  color: C,
  at: number,
): number {
  const remaining = clock.remainingMs[color];
  if (clock.activeColor !== color || clock.runningSince === null) return remaining;
  return Math.max(0, remaining - Math.max(0, at - clock.runningSince));
}

/** Narrow an untyped payload field (`state.clock` on a tenant postgame / live frame)
 *  to a clock snapshot for the two named colors, or null when it is absent or
 *  malformed. Live frames carry the server's authoritative clock; finished-game
 *  postgames may carry one too, and every reader treats a missing one as "no clock". */
export function readTenantWebClock<C extends string>(
  value: unknown,
  colors: readonly C[],
): TenantWebClock<C> | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const remaining = raw.remainingMs;
  if (!remaining || typeof remaining !== 'object') return null;
  const remainingMs = {} as Record<C, number>;
  for (const color of colors) {
    const ms = (remaining as Record<string, unknown>)[color];
    if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
    remainingMs[color] = ms;
  }
  const activeColor =
    typeof raw.activeColor === 'string' && (colors as readonly string[]).includes(raw.activeColor)
      ? (raw.activeColor as C)
      : null;
  const runningSince =
    typeof raw.runningSince === 'number' && Number.isFinite(raw.runningSince)
      ? raw.runningSince
      : null;
  return {
    activeColor,
    incrementMs: typeof raw.incrementMs === 'number' ? raw.incrementMs : 0,
    initialMs: typeof raw.initialMs === 'number' ? raw.initialMs : 0,
    remainingMs,
    runningSince,
  };
}
