// The versions /bots shows come from pins, never from a hand table that can drift.
// Each value is checked against the file or constant that decides what prod runs.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  botEngineVersion,
  FAIRY_STOCKFISH_RELEASE_VERSION,
  PIKAFISH_XIANGQI_VERSION,
} from './bot-engine-versions.js';
import { FIRST_PARTY_BOT_PROFILES } from './first-party-bots.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path: string): string => readFileSync(resolve(repoRoot, path), 'utf8');
const pinnedSha = (refFile: string): string => read(refFile).split('\n')[0]!.trim();

test('mainline Pikafish shows the pikafish.ref commit under its own release name', () => {
  const sha = pinnedSha('pikafish.ref');
  assert.ok(PIKAFISH_XIANGQI_VERSION.endsWith(`-${sha.slice(0, 8)}`), PIKAFISH_XIANGQI_VERSION);
  assert.ok(read('pikafish.ref').includes(`Pikafish ${PIKAFISH_XIANGQI_VERSION}`));
  assert.equal(botEngineVersion('pikafish-xiangqi-level-8'), sha.slice(0, 8));
});

test('pinned source builds show the short sha of their .ref', () => {
  const cases: [engineId: string, refFile: string][] = [
    ['pikafish-jieqi-level-3', 'pikafish-jieqi.ref'],
    ['pikafish-jieqi-strongest', 'pikafish-jieqi.ref'],
    ['fairy-stockfish-xiangqi-level-5', 'fairy-stockfish-xiangqi.ref'],
    ['fairy-stockfish-xiangqi-worst', 'fairy-stockfish-xiangqi.ref'],
    ['fairy-stockfish-duck-xiangqi-level-2', 'fairy-stockfish-duck-xiangqi.ref'],
    ['fairy-stockfish-atomic-xiangqi-level-7', 'fairy-stockfish-atomic-xiangqi.ref'],
  ];
  for (const [engineId, refFile] of cases) {
    assert.equal(botEngineVersion(engineId), pinnedSha(refFile).slice(0, 8), engineId);
  }
});

test('the stock Fairy-Stockfish rungs show the release the build downloads', () => {
  assert.ok(
    read('scripts/fetch-fairy-stockfish-largeboard.sh').includes(
      `/releases/download/fairy_sf_${FAIRY_STOCKFISH_RELEASE_VERSION}/`,
    ),
  );
  assert.equal(botEngineVersion('fairy-stockfish-fortress-xiangqi-level-1'), '14');
  assert.equal(botEngineVersion('fairy-stockfish-crazyhouse-xiangqi-level-8'), '14');
});

test('AB-JChess, jqe and KataGo show the build their version constant names', () => {
  assert.equal(botEngineVersion('ab-jchess-jieqi'), '0.2d');
  const jqeSha = pinnedSha('jqe.ref').slice(0, 8);
  assert.equal(botEngineVersion('jqe-jieqi'), `${jqeSha} · it014`);
  const katagoSha = pinnedSha('katago-jungle.ref').slice(0, 8);
  assert.equal(botEngineVersion('katago-jungle'), `${katagoSha} · b10c384`);
});

test('Misty shows each engine build she plays', () => {
  assert.equal(botEngineVersion('python-v2-v1.6'), '1.6');
  assert.equal(botEngineVersion('python-fdx-v1.2'), '1.2');
  assert.equal(botEngineVersion('misty-banqi'), '0.2.7');
  assert.equal(botEngineVersion('misty-jungle-level-2'), '0.0.6');
  assert.equal(botEngineVersion('misty-jungle-flip'), '0.5.1');
});

test('an engine with no recorded version shows nothing rather than a guess', () => {
  assert.equal(botEngineVersion('misty-xiangqi-mahjong'), null);
  assert.equal(botEngineVersion('python-no-such-build'), null);
  assert.equal(botEngineVersion('made-up-engine'), null);
});

test('every first-party engine except the named exceptions has a version', () => {
  // A new engine added to a bot without a version source fails here, so the
  // page's silence for it is a decision, not an oversight.
  const unversioned = new Set(['misty-xiangqi-mahjong']);
  for (const bot of FIRST_PARTY_BOT_PROFILES) {
    for (const engineId of Object.values(bot.engines)) {
      if (unversioned.has(engineId)) continue;
      assert.ok(botEngineVersion(engineId), `${bot.id}: ${engineId} has no version`);
    }
  }
});
