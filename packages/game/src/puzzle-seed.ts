// Node-only loader for the committed puzzle seed assets (packages/game/seed/).
//
// The seed JSON files are the committed source of truth for the SERVED puzzle
// corpus since #183 moved puzzle content out of compiled TS modules: the server
// syncs them into the `puzzles` / `puzzle_source_games` tables at first use
// (apps/server/src/puzzle-store.ts) and serves the persistence-off dev pair
// straight from them. The small `*_PUZZLES` fixture arrays that remain in this
// package are TEST fixtures (kernel/unit/adapter tests), not the serving set;
// puzzles-seed.test.ts pins each fixture as a verbatim subset of the seed.
//
// This module reads from disk with node:fs, so it is deliberately NOT exported
// from the package barrel (index.ts): web bundles imported from '@mistboard/game'
// must stay free of node builtins. Server code and node-run tests import it via
// the '@mistboard/game/puzzle-seed' subpath export instead.
//
// Path resolution works from both src (tsx: src/../seed) and dist
// (node: dist/../seed) because the seed directory sits next to both.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  FortressXiangqiPuzzle,
  FortressXiangqiSourceGame,
} from './puzzles-fortress-xiangqi.js';
import type { JunglePuzzle, JungleSourceGame } from './puzzles-jungle.js';
import type { XiangqiPuzzle } from './puzzles-xiangqi.js';

export type SeedPuzzle = FortressXiangqiPuzzle | JunglePuzzle | XiangqiPuzzle;

export type SeedPuzzleRegistry = 'fortress-xiangqi' | 'jungle' | 'xiangqi';

// Registry concatenation order. This is load-bearing for the serving contract:
// it reproduces the pre-#183 aggregation order of the server's id resolution
// (Fortress, then Jungle, then standard xiangqi; the retired mini registry
// led it), so
// the DB `seq` column and the /api/puzzles list ordering match what the old
// in-memory arrays served byte for byte.
export const SEED_PUZZLE_REGISTRIES: readonly SeedPuzzleRegistry[] = [
  'fortress-xiangqi',
  'jungle',
  'xiangqi',
];

type SeedPuzzleFile = {
  format: string;
  registry: string;
  puzzles: SeedPuzzle[];
};

type SeedSourceGamesFile = {
  format: string;
  registry: string;
  games: Array<JungleSourceGame | FortressXiangqiSourceGame>;
};

export type SeedSourceGames = {
  jungle: readonly JungleSourceGame[];
  fortressXiangqi: readonly FortressXiangqiSourceGame[];
};

const PUZZLE_FORMAT = 'mistboard-puzzle-seed-v1';
const SOURCE_GAMES_FORMAT = 'mistboard-puzzle-source-games-v1';

// Resolved via fileURLToPath + join rather than `new URL(..., import.meta.url)`
// on purpose: bundler asset pipelines (Vite in the web test runner) statically
// rewrite the URL-constructor pattern and mangle the path; the plain node:path
// form is left alone in every runtime that can reach this module (node, tsx,
// vitest node env).
const SEED_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'seed');

function readSeedFile(relative: string): string {
  return readFileSync(join(SEED_DIR, relative), 'utf-8');
}

const puzzleCache = new Map<SeedPuzzleRegistry, readonly SeedPuzzle[]>();
let allPuzzlesCache: readonly SeedPuzzle[] | null = null;
let sourceGamesCache: SeedSourceGames | null = null;
let contentHashCache: string | null = null;

// The puzzles of one registry, in the registry's committed (served) order.
export function loadSeedPuzzleRegistry(registry: SeedPuzzleRegistry): readonly SeedPuzzle[] {
  const cached = puzzleCache.get(registry);
  if (cached) return cached;
  const parsed = JSON.parse(readSeedFile(`puzzles/${registry}.json`)) as SeedPuzzleFile;
  if (parsed.format !== PUZZLE_FORMAT || parsed.registry !== registry) {
    throw new Error(`puzzle seed ${registry}.json has unexpected format/registry`);
  }
  puzzleCache.set(registry, parsed.puzzles);
  return parsed.puzzles;
}

// Every seeded puzzle across all registries, in serving order (see
// SEED_PUZZLE_REGISTRIES). Ids are prefix-disjoint across registries.
export function loadAllSeedPuzzles(): readonly SeedPuzzle[] {
  if (!allPuzzlesCache) {
    allPuzzlesCache = SEED_PUZZLE_REGISTRIES.flatMap((registry) => [
      ...loadSeedPuzzleRegistry(registry),
    ]);
  }
  return allPuzzlesCache;
}

// Full recorded source games the Jungle/Fortress tactics were mined from.
// (Standard-xiangqi puzzles reference historical_xiangqi_games rows instead
// and carry denormalized attribution inline; they have no seed source games.)
export function loadSeedSourceGames(): SeedSourceGames {
  if (!sourceGamesCache) {
    const jungle = JSON.parse(readSeedFile('source-games/jungle.json')) as SeedSourceGamesFile;
    const fortress = JSON.parse(
      readSeedFile('source-games/fortress-xiangqi.json'),
    ) as SeedSourceGamesFile;
    if (jungle.format !== SOURCE_GAMES_FORMAT || fortress.format !== SOURCE_GAMES_FORMAT) {
      throw new Error('puzzle source-games seed has unexpected format');
    }
    sourceGamesCache = {
      jungle: jungle.games as JungleSourceGame[],
      fortressXiangqi: fortress.games as FortressXiangqiSourceGame[],
    };
  }
  return sourceGamesCache;
}

// Deterministic hash over the raw seed bytes (all files, fixed order). The
// server's seed sync is gated on this: a re-mine or corpus edit changes the
// hash, an unchanged deploy skips the re-upsert.
export function seedPuzzleContentHash(): string {
  if (!contentHashCache) {
    const hash = createHash('sha256');
    for (const registry of SEED_PUZZLE_REGISTRIES) {
      hash.update(readSeedFile(`puzzles/${registry}.json`));
    }
    hash.update(readSeedFile('source-games/jungle.json'));
    hash.update(readSeedFile('source-games/fortress-xiangqi.json'));
    contentHashCache = hash.digest('hex');
  }
  return contentHashCache;
}
