import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { RAPFI_LEVELS, RAPFI_STRONGEST } from '@mistboard/game';
import {
  DARK_XIANGQI_DEFAULT_ENGINE_ID,
  isDarkXiangqiEngineClientId,
  isKnownEngineClientId,
  isPlayableLiveEngineClientId,
  knownEngineIds,
  loadEngine,
  playableLiveEngines,
  upsertBuiltinEngineVersions,
} from './engine-registry.js';
import { gomokuTenant, isGomokuEngineClientId } from './gomoku-tenant.js';

test('playable live engine client ids = the single streamlined PVE engine (Misty)', () => {
  // Streamlined release (2026-06-02): only the latest Misty is player-facing.
  // v1.5 shipped 2026-06-21, superseding v1.4 in the picker (opening-book update:
  // drop redundant Nc3 forces, force ...dxe4). Older versions stay in the registry
  // so historical games resolve, but are no longer offered.
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.6'), true);
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.4'), false);
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.3'), false);
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.2'), false);
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.1'), false);
  assert.equal(isPlayableLiveEngineClientId('python-v2-v1.0'), false);
});

test('playable live engine client ids exclude hidden, retired, EvE aliases, and humans', () => {
  // Legacy + Random remain in the registry (EvE/testing/records) but are no
  // longer offered in the live PvE picker → not playable. The 'random-engine'
  // sentinel resolves to builtin-random-legal, so it is excluded too.
  assert.equal(isPlayableLiveEngineClientId('builtin-random-legal'), false);
  assert.equal(isPlayableLiveEngineClientId('python-tier1-v0.9.5'), false);
  assert.equal(isPlayableLiveEngineClientId('random-engine'), false);
  assert.equal(isPlayableLiveEngineClientId('builtin-capture-seeker'), false);
  assert.equal(isPlayableLiveEngineClientId('python-tier1-v0.9.1'), false);
  assert.equal(isPlayableLiveEngineClientId('python-tier1-v0.8.9'), false);
  assert.equal(isPlayableLiveEngineClientId('python-tier1-v0.7.22'), false);
  assert.equal(isPlayableLiveEngineClientId('engine:black'), false);
  assert.equal(isPlayableLiveEngineClientId('human-black'), false);
  assert.equal(isPlayableLiveEngineClientId(undefined), false);
});

test('Dark Xiangqi has a dedicated local engine that stays out of the chess PvE picker', () => {
  const engine = loadEngine(DARK_XIANGQI_DEFAULT_ENGINE_ID);
  assert.equal(engine.id, 'python-fdx-v1.2');
  assert.equal(engine.name, 'Misty DXQ 1.2');
  assert.equal(engine.gameSpecId, 'dark-xiangqi');
  assert.equal(isDarkXiangqiEngineClientId(engine.id), true);
  assert.equal(isPlayableLiveEngineClientId(engine.id), false);
});

test('standard Xiangqi Pikafish tiers are first-class reproducible engine versions', () => {
  const engine = loadEngine('pikafish-xiangqi-level-3');
  assert.equal(engine.engineId, 'pikafish-xiangqi');
  assert.equal(engine.gameSpecId, 'xiangqi');
  assert.equal(engine.config.kind, 'pikafish-xiangqi');
  assert.deepEqual(engine.config, {
    kind: 'pikafish-xiangqi',
    nodes: 10_000,
    movetime_ms: 500,
    version: '0.4.0',
  });
  assert.match(engine.playSignature, /0\.4\.0-nodes-10000$/);
  assert.equal(engine.configHash, engine.playSignature);
  assert.equal(engine.engineName, 'Pikafish');
  assert.match(engine.notes ?? '', /Pikafish search, Fairy-Stockfish CC0 net/);
  assert.match(engine.notes ?? '', /6a59ee2f.*cc0-790609318c02.*xiangqi-c07e94a5c7cb/);
  assert.equal(isPlayableLiveEngineClientId(engine.id), false);
});

test('standard Xiangqi FSF ladder preserves the PlayStrategy weakening parameters', () => {
  const level1 = loadEngine('fairy-stockfish-xiangqi-level-1');
  assert.equal(level1.engineId, 'fairy-stockfish-xiangqi');
  assert.equal(level1.gameSpecId, 'xiangqi');
  assert.deepEqual(level1.config, {
    kind: 'fairy-stockfish',
    skill: -9,
    depth: 5,
    movetime_ms: 50,
  });
  // Level 8 left the PlayStrategy profile on 2026-09-02: node-anchored, NNUE net,
  // no depth cap. The hash names the pinned build and the net so the EvE ladder
  // sees a new engine identity, not a stronger version of the old one.
  const level8 = loadEngine('fairy-stockfish-xiangqi-level-8');
  assert.deepEqual(level8.config, {
    kind: 'fairy-stockfish',
    skill: 20,
    movetime_ms: 6_000,
    nodes: 1_000_000,
    hash_mb: 64,
    nnue: 'xiangqi-c07e94a5c7cb.nnue',
  });
  assert.match(
    level8.configHash,
    /^fsf-xiangqi-0\.2\.2-[0-9a-f]{8}-skill-20-nodes-1000000-xiangqi-c07e94a5c7cb$/,
  );
  assert.match(level1.configHash, /^fsf-xiangqi-0\.2\.2-[0-9a-f]{8}-skill--9-depth-5$/);
  assert.equal(level8.configHash, level8.playSignature);
});

test('native Rapfi catalogue preserves eight numbered identities with Level 8 sharing strongest', () => {
  const ids = [...RAPFI_LEVELS.map(({ level }) => `rapfi-level-${level}`), 'rapfi-strongest'];
  const source = '1387d11312190ec66665d361ff07a7c70221b78a';
  const net = '6bc0d1b0ff8e1d857f7f412923cd458f38f1a435087c91ae71fec3676c23ef62';
  assert.equal(
    readFileSync(new URL('../../../rapfi.ref', import.meta.url), 'utf8').split('\n')[0],
    source,
  );
  assert.match(
    readFileSync(new URL('../../../scripts/rapfi-assets.mjs', import.meta.url), 'utf8'),
    new RegExp(net),
  );
  const signatures = new Set<string>();
  for (const id of ids) {
    const engine = loadEngine(id);
    assert.ok(knownEngineIds().includes(engine.id));
    assert.equal(isKnownEngineClientId(id), true);
    assert.equal(engine.engineId, 'rapfi');
    assert.equal(engine.engineName, 'Rapfi');
    assert.equal(engine.name, gomokuTenant.engine!.displayName(id));
    assert.equal(engine.gameSpecId, 'gomoku');
    assert.equal(engine.kind, 'container');
    assert.ok(engine.config.kind === 'rapfi-gomocup');
    assert.equal(engine.config.source_ref, source);
    assert.equal(engine.config.net_sha256, net);
    assert.equal(engine.config.network, 'mix9svqfreestyle_bsmix.bin.lz4');
    assert.equal(engine.config.threads, 1);
    assert.equal(engine.config.hash_bytes, 32 * 1024 * 1024);
    assert.equal(engine.config.version, gomokuTenant.engine!.engineVersion!(id));
    assert.equal(
      engine.configHash,
      `rapfi-${source.slice(0, 10)}-policy-${createHash('sha256').update(JSON.stringify(engine.config)).digest('hex')}`,
    );
    assert.equal(engine.configHash, engine.playSignature);
    signatures.add(engine.configHash);
    const tier = RAPFI_LEVELS.find(({ level }) => id === `rapfi-level-${level}`);
    assert.equal(engine.config.movetime_ms, tier?.timeMs ?? RAPFI_STRONGEST.timeMs);
    if (tier) assert.equal(engine.config.nodes, tier.nodes);
    else assert.equal(Object.hasOwn(engine.config, 'nodes'), false);
    assert.equal(
      engine.config.selection,
      tier?.candidateCount ? 'seeded-candidates-v1' : 'native-best',
    );
    if (tier?.candidateCount) {
      assert.equal(engine.config.candidateCount, tier.candidateCount);
      assert.equal(engine.config.evalMargin, tier.evalMargin);
      assert.equal(engine.config.bestRate, tier.bestRate);
      assert.equal(engine.config.seed_policy, 'game-absolute-ply-v1');
    } else {
      for (const key of ['candidateCount', 'evalMargin', 'bestRate', 'seed_policy'])
        assert.equal(Object.hasOwn(engine.config, key), false, `${id}: unexpected ${key}`);
    }
  }
  assert.equal(signatures.size, 8);
  assert.equal(
    loadEngine('rapfi-level-8').playSignature,
    loadEngine('rapfi-strongest').playSignature,
  );
  for (const id of ['rapfi-level-0', 'rapfi-level-9', 'rapfi-level-01', 'rapfi-strongest-other']) {
    assert.equal(isKnownEngineClientId(id), false);
    assert.throws(() => loadEngine(id), /not loadable/);
  }
});

test('Gomoku random floor is catalogued for EvE but never offered to players, even via extras', () => {
  const id = 'random-legal-gomoku';
  const engine = loadEngine(id);
  assert.equal(engine.gameSpecId, 'gomoku');
  assert.equal(engine.kind, 'builtin');
  assert.deepEqual(engine.config, { kind: 'builtin', strategy: 'random-legal', version: 1 });
  assert.equal(engine.configHash, 'random-legal-gomoku-v1');
  assert.equal(engine.configHash, engine.playSignature);
  assert.equal(isKnownEngineClientId(id), true);
  assert.equal(isGomokuEngineClientId(id), false);
  const saved = process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES;
  try {
    process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES = id;
    assert.equal(isPlayableLiveEngineClientId(id), false);
    assert.equal(
      playableLiveEngines().some((entry) => entry.id === id),
      false,
    );
  } finally {
    if (saved === undefined) delete process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES;
    else process.env.MISTBOARD_EXTRA_PLAYABLE_ENGINES = saved;
  }
});

test('catalogue persistence records native Rapfi protocol and exact policy without touching ratings', async () => {
  const calls: { sql: string; values: unknown[] }[] = [];
  await upsertBuiltinEngineVersions(
    {
      query: async (sql: string, values: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [] };
      },
    } as never,
    ['rapfi-level-1', 'rapfi-strongest', 'random-legal-gomoku'],
  );
  assert.equal(calls.length, 6);
  for (const { sql, values } of calls) {
    assert.doesNotMatch(sql, /bot_rating|UPDATE bot_profiles/);
    if (!sql.includes('INSERT INTO engine_versions')) continue;
    const engine = loadEngine(String(values[0]));
    assert.equal(values[4], engine.configHash);
    assert.equal(values[5], engine.playSignature);
    assert.deepEqual(values[7], engine.config);
    assert.equal(
      (values[8] as { runtime: string }).runtime,
      engine.config.kind === 'builtin' ? 'in-process-typescript' : 'gomocup-subprocess',
    );
  }
});
