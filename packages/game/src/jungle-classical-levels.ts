/** Classical Jungle levels shared by live play, the picker and offline calibration. */
export type JungleClassicalEngineId =
  | 'misty-jungle-level-2'
  | `misty-jungle-classical-level-${1 | 2 | 3 | 4 | 5 | 6}`;

export type JungleClassicalPolicy = {
  id: JungleClassicalEngineId;
  level: number;
  nodes: number;
  movetimeCapMs: number;
  depth?: number;
  noise?: number;
};

export const JUNGLE_CLASSICAL_POLICIES: readonly JungleClassicalPolicy[] = [
  {
    id: 'misty-jungle-classical-level-1',
    level: 1,
    nodes: 20_000,
    movetimeCapMs: 1500,
    depth: 1,
    noise: 1000,
  },
  {
    id: 'misty-jungle-classical-level-2',
    level: 2,
    nodes: 20_000,
    movetimeCapMs: 1500,
    depth: 2,
    noise: 350,
  },
  {
    id: 'misty-jungle-classical-level-3',
    level: 3,
    nodes: 50_000,
    movetimeCapMs: 1500,
    depth: 2,
    noise: 100,
  },
  {
    id: 'misty-jungle-classical-level-4',
    level: 4,
    nodes: 100_000,
    movetimeCapMs: 1500,
    depth: 3,
    noise: 35,
  },
  {
    id: 'misty-jungle-classical-level-5',
    level: 5,
    nodes: 200_000,
    movetimeCapMs: 1500,
    depth: 4,
    noise: 10,
  },
  { id: 'misty-jungle-classical-level-6', level: 6, nodes: 200_000, movetimeCapMs: 3000 },
  // The persisted full-strength id remains unchanged. Never reuse legacy L1/L3.
  { id: 'misty-jungle-level-2', level: 7, nodes: 5_000_000, movetimeCapMs: 6000 },
];

/** A stable per-game/ply seed, retained by calibration and live decision records. */
export function jungleClassicalSeed(gameId: string, ply: number, level: number): number {
  let hash = 2166136261;
  for (const c of `${gameId}:${ply}:${level}`) {
    hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  }
  return hash;
}

export function buildJungleClassicalGoCommand(
  policy: JungleClassicalPolicy,
  seed: number,
  movetimeMs = policy.movetimeCapMs,
): string {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new Error('invalid Jungle difficulty seed');
  }
  if (!Number.isSafeInteger(movetimeMs) || movetimeMs < 0) {
    throw new Error('invalid Jungle search deadline');
  }
  return `go nodes ${policy.nodes} movetime ${movetimeMs}${
    policy.depth === undefined ? '' : ` depth ${policy.depth}`
  }${policy.noise === undefined ? '' : ` noise ${policy.noise} seed ${seed}`}`;
}
