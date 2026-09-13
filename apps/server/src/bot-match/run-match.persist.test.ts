import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import type { GameEvent } from '@mistboard/game';
import type { ArbiterResult } from './arbiter.js';
import {
  replaySafeId,
  resolveSeriesRunDir,
  writeSeriesGameArtifact,
  writeSeriesIndex,
} from './run-match.js';

function fakeResult(gameId: string): ArbiterResult {
  const events: GameEvent[] = [
    { type: 'room-created', at: 0, roomId: gameId, variant: 'dark-chess' },
    {
      type: 'move-played',
      at: 1,
      roomId: gameId,
      color: 'white',
      move: { from: 'e2', to: 'e4' },
      thinkTimeMs: 5,
    },
  ];
  return {
    gameId,
    variant: 'dark-chess',
    winner: 'white',
    outcome: 'king-captured',
    plyCount: 1,
    events,
    whiteEngineId: 'python-v2-v1.5',
    blackEngineId: 'python-v2-v1.1',
  };
}

test('replaySafeId strips characters the replay viewer would reject', () => {
  assert.equal(replaySafeId('two-endpoint/g 0!'), 'two-endpointg0');
  assert.equal(replaySafeId('botmatch-demo-0'), 'botmatch-demo-0');
});

test('resolveSeriesRunDir: undefined persists by default, null opts out, string is verbatim', () => {
  assert.equal(resolveSeriesRunDir({ persistDir: null }, 123), null);
  assert.equal(resolveSeriesRunDir({ persistDir: '/tmp/explicit' }, 123), '/tmp/explicit');
  const def = resolveSeriesRunDir({ gameIdPrefix: 'demo' }, 123);
  assert.ok(def, 'undefined persistDir must resolve to a default dir (persist-by-default)');
  assert.ok(def.includes('botmatch-runs'), `default under botmatch-runs, got ${def}`);
  assert.ok(def.endsWith(join('demo-123')), `default labelled by prefix+stamp, got ${def}`);
});

test('BOTMATCH_RUNS_DIR overrides the default runs root', () => {
  const prev = process.env.BOTMATCH_RUNS_DIR;
  process.env.BOTMATCH_RUNS_DIR = '/custom/root';
  try {
    const dir = resolveSeriesRunDir({ runLabel: 'r1' }, 1);
    assert.equal(dir, resolve('/custom/root', 'r1'));
  } finally {
    if (prev === undefined) delete process.env.BOTMATCH_RUNS_DIR;
    else process.env.BOTMATCH_RUNS_DIR = prev;
  }
});

test('writeSeriesGameArtifact writes a replayable JSONL round-trip', () => {
  const dir = mkdtempSync(join(tmpdir(), 'botmatch-persist-'));
  try {
    const result = fakeResult('demo-0');
    const file = writeSeriesGameArtifact(dir, result);
    assert.ok(existsSync(file));
    assert.ok(file.endsWith('demo-0.jsonl'));
    const events = readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as GameEvent);
    assert.equal(events.length, result.events.length);
    assert.equal(events[0]?.type, 'room-created');
    assert.equal(events[1]?.type, 'move-played');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeSeriesIndex writes a parseable index with game entries', () => {
  const dir = mkdtempSync(join(tmpdir(), 'botmatch-persist-'));
  try {
    writeSeriesIndex(dir, { timePolicy: 'self-managed' }, [
      {
        gameId: 'demo-0',
        file: join(dir, 'demo-0.jsonl'),
        variant: 'dark-chess',
        winner: 'white',
        outcome: 'king-captured',
        plyCount: 1,
        whiteEngineId: 'python-v2-v1.5',
        blackEngineId: 'python-v2-v1.1',
      },
    ]);
    const index = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as {
      timePolicy: string;
      games: { gameId: string }[];
    };
    assert.equal(index.timePolicy, 'self-managed');
    assert.equal(index.games.length, 1);
    assert.equal(index.games[0]?.gameId, 'demo-0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
