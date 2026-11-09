/** Durable, server-written provenance for the one private Banqi worker canary.
 * No endpoint, credential, command or filesystem path belongs in this record. */
export const INTERNAL_BANQI_ENGINE_ID = 'private-banqi-worker';
export const INTERNAL_BANQI_CORPUS_ID = 'internal-banqi-provider';
export type InternalEngineTest = {
  kind: 'banqi-provider';
  ownerUserId: string;
  engineId: typeof INTERNAL_BANQI_ENGINE_ID;
  engineVersion: string;
  displayName: string;
  nodes: number;
  budgetMs: number;
};

export function isInternalEngineTest(value: unknown): value is InternalEngineTest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).sort().join(',') ===
      'budgetMs,displayName,engineId,engineVersion,kind,nodes,ownerUserId' &&
    v.kind === 'banqi-provider' &&
    v.engineId === INTERNAL_BANQI_ENGINE_ID &&
    typeof v.ownerUserId === 'string' &&
    /^[a-zA-Z0-9_-]{1,120}$/.test(v.ownerUserId) &&
    typeof v.engineVersion === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9_.:+-]{0,119}$/.test(v.engineVersion) &&
    typeof v.displayName === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9 ._()+-]{0,79}$/.test(v.displayName) &&
    Number.isInteger(v.nodes) &&
    Number(v.nodes) >= 1 &&
    Number(v.nodes) <= 3_500_000 &&
    Number.isInteger(v.budgetMs) &&
    Number(v.budgetMs) >= 100 &&
    Number(v.budgetMs) <= 8000
  );
}

export function internalEngineTestFor(
  events: readonly unknown[] | undefined,
): InternalEngineTest | null {
  const first = events?.[0] as { type?: unknown; internalEngineTest?: unknown } | undefined;
  return first?.type === 'room-created' && isInternalEngineTest(first.internalEngineTest)
    ? first.internalEngineTest
    : null;
}

/** Even a malformed marked log must be withheld from public surfaces. */
export function isInternalEngineTestLog(events: readonly unknown[] | undefined): boolean {
  const first = events?.[0] as { internalEngineTest?: unknown } | undefined;
  return first?.internalEngineTest !== undefined;
}
