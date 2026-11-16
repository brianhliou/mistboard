// Native serving identities. Source/network pins are checked against the asset
// recipe; budgets and weakening come from the same tables as live serving.
import { createHash } from 'node:crypto';
import { RAPFI_LEVELS, RAPFI_STRONGEST, type RapfiEngineId } from '@mistboard/game';
import type { EngineDefinition, RapfiGomocupEngineConfig } from './engines/types.js';

export const RAPFI_SOURCE_REF = '1387d11312190ec66665d361ff07a7c70221b78a';
export const RAPFI_NATIVE_NETWORK = 'mix9svqfreestyle_bsmix.bin.lz4';
export const RAPFI_NATIVE_NET_SHA256 =
  '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62';
export const GOMOKU_RANDOM_ENGINE_ID = 'random-legal-gomoku';

function nativeEngine(
  id: RapfiEngineId,
  tier: {
    nodes?: number;
    timeMs: number;
    candidateCount?: number;
    evalMargin?: number;
    bestRate?: number;
  },
): EngineDefinition {
  const config: RapfiGomocupEngineConfig = {
    kind: 'rapfi-gomocup',
    version: RAPFI_SOURCE_REF.slice(0, 10),
    source_ref: RAPFI_SOURCE_REF,
    network: RAPFI_NATIVE_NETWORK,
    net_sha256: RAPFI_NATIVE_NET_SHA256,
    threads: 1,
    hash_bytes: 32 * 1024 * 1024,
    rule: 0,
    process: 'fresh-per-move',
    clock_policy: 'live-bot-move-time-v1',
    movetime_ms: tier.timeMs,
    ...(tier.nodes === undefined ? {} : { nodes: tier.nodes }),
    ...(tier.candidateCount === undefined
      ? { selection: 'native-best' as const }
      : {
          selection: 'seeded-candidates-v1' as const,
          candidateCount: tier.candidateCount,
          evalMargin: tier.evalMargin!,
          ...(tier.bestRate === undefined ? {} : { bestRate: tier.bestRate }),
          seed_policy: 'game-absolute-ply-v1' as const,
        }),
  };
  // Includes the full source ref, network hash, all budgets, candidate options,
  // seed/clock policy versions and process settings. A changed dial is a new
  // identity, even when the engine id remains the same ladder rung.
  const signature = `rapfi-${config.version}-policy-${createHash('sha256').update(JSON.stringify(config)).digest('hex')}`;
  return {
    id,
    engineId: 'rapfi',
    engineName: 'Rapfi',
    name: id === 'rapfi-strongest' ? 'Rapfi Strongest' : `Rapfi Level ${id.at(-1)}`,
    kind: 'container',
    gameSpecId: 'gomoku',
    configHash: signature,
    playSignature: signature,
    config,
    notes:
      'Native Gomocup freestyle, pinned mix9svq network; one thread, fresh process per move. Clock-aware search ceiling; strongest has no node or weakening cap.',
  };
}

export const GOMOKU_CATALOG_ENGINES: readonly EngineDefinition[] = [
  ...RAPFI_LEVELS.map((tier) => nativeEngine(`rapfi-level-${tier.level}`, tier)),
  nativeEngine('rapfi-strongest', RAPFI_STRONGEST),
  {
    id: GOMOKU_RANDOM_ENGINE_ID,
    engineId: GOMOKU_RANDOM_ENGINE_ID,
    engineName: 'Random legal Gomoku',
    name: 'Random legal Gomoku',
    kind: 'builtin',
    gameSpecId: 'gomoku',
    configHash: 'random-legal-gomoku-v1',
    playSignature: 'random-legal-gomoku-v1',
    config: { kind: 'builtin', strategy: 'random-legal', version: 1 },
    notes: 'EvE-only uniformly random legal-move calibration floor; never player-facing.',
  },
];
