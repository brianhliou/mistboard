import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DARK_XIANGQI_DEFAULT_ENGINE_ID,
  isDarkXiangqiEngineClientId,
  isPlayableLiveEngineClientId,
  loadEngine,
} from './engine-registry.js';

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
    version: '0.3.0',
  });
  assert.match(engine.playSignature, /0\.3\.0-nodes-10000$/);
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
    /^fsf-xiangqi-0\.2\.0-[0-9a-f]{8}-skill-20-nodes-1000000-xiangqi-c07e94a5c7cb$/,
  );
  assert.match(level1.configHash, /^fsf-xiangqi-0\.2\.0-[0-9a-f]{8}-skill--9-depth-5$/);
  assert.equal(level8.configHash, level8.playSignature);
});
