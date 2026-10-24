import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as game from '../packages/game/src/index.ts';
import type { PikafishEngine } from './variant-lab/xiangqi-pikafish-uci.ts';
import {
  mineXiangqiPuzzleGame,
  type XiangqiPuzzleMinerMetrics,
  type XiangqiPuzzleMinerOptions,
} from './variant-lab/xiangqi-puzzle-miner.ts';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixtures = JSON.parse(
  source('../packages/game/fixtures/xiangqi-notation/adjudicated-records.json'),
) as {
  cases: { key: string; iccs: string; adjudicatedAt: number }[];
};

// These CLIs execute database/engine work at module scope. Evaluate their actual
// pure replay sections without starting those services; no replay is copied here.
function section(path: string, start: string, end: string) {
  const text = source(path);
  const first = text.indexOf(start);
  const last = text.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `replay section missing in ${path}`);
  return text.slice(first, last);
}
const context = { ...game, console: { log() {} } };
for (const record of fixtures.cases) {
  const moves = record.iccs.split(' ').map((uci) => game.pikafishUciToXiangqiSquares(uci)!);
  test(`${record.key}: annotation CLI notates PVs after a recorded draw`, () => {
    const code = section('./annotate-game.mjs', 'function notatePv(', '// --evals-from');
    const notate = vm.runInNewContext(`${code}; notatePv`, context);
    const prefix = moves.slice(0, record.adjudicatedAt + 1);
    const tail = moves.slice(record.adjudicatedAt + 1);
    const output = notate(prefix, tail.map(game.xiangqiMoveToPikafishUci));
    assert.deepEqual(
      Array.from(output.wxf),
      game.formatXiangqiMoves(moves, 'wxf').slice(prefix.length),
    );
  });
  test(`${record.key}: positive-glyph scan reaches the final recorded position`, () => {
    const code = section(
      './xq-positive-glyphs-scan.mjs',
      '  let state = createInitialXiangqiState(key);',
      "    // The opponent's previous row",
    );
    const state = vm.runInNewContext(`${code}\n} state;`, {
      ...context,
      key: record.key,
      game: { moves },
      anno: { rows: moves.map((_, i) => ({ ply: i + 1 })) },
      plies: 0,
    });
    assert.equal(state.moveLog.length, moves.length);
  });
  test(`${record.key}: rejected-candidate inspector rebuilds the full source prefix`, () => {
    const code = section(
      './xiangqi-puzzle-inspect.mjs',
      "  let state = createInitialXiangqiState('replay');",
      '  const legal =',
    );
    const state = vm.runInNewContext(`${code}\nstate;`, {
      ...context,
      moves,
      row: { post_blunder_ply: moves.length },
    });
    assert.equal(state.moveLog.length, moves.length);
  });
  test(`${record.key}: generated player thumbnail renders after a recorded draw`, () => {
    const template = section('./player-page-article.mjs', 'const thumbConst =', 'const readNext =');
    const generated = vm.runInNewContext(`${template}\nthumbConst;`, {
      boardThumb: { constName: 'RECORD', ply: moves.length, half: 'top', perspective: 'red' },
      meta: { slug: 'record', thumbnailAlt: 'Record' },
      q: JSON.stringify,
    });
    const js = ts.transpileModule(`${generated}\nTHUMBNAIL();`, {
      compilerOptions: { target: ts.ScriptTarget.ESNext },
    }).outputText;
    const state = vm.runInNewContext(js, {
      ...context,
      RECORD: record,
      xqHalfBoardThumbnailSvg: ({ state }: { state: game.XiangqiGameState }) => state,
    });
    assert.equal(state.moveLog.length, moves.length);
  });
  test(`${record.key}: puzzle miner scans the whole source record`, async () => {
    const seen: number[] = [];
    const engine = {
      newGame: async () => {},
      analyzeMoves: async (prefix: string[]) => {
        seen.push(prefix.length);
        return [];
      },
    } as unknown as PikafishEngine;
    const metrics: XiangqiPuzzleMinerMetrics = {
      gamesRequested: 0,
      gamesLoaded: 0,
      gamesScanned: 0,
      gamesFailed: 0,
      gamesIllegalReplay: 0,
      positionsEvaluated: 0,
      verifyEvals: 0,
      candidates: 0,
      verified: 0,
      rejects: {},
      themes: {},
    };
    const options = {
      minPly: 0,
      scanNodes: 1,
      swingCp: 250,
      winCp: 250,
      decidedCp: 800,
      perGame: 0,
    } as XiangqiPuzzleMinerOptions;
    await mineXiangqiPuzzleGame(engine, { id: record.key, moves }, options, metrics, new Set());
    assert.equal(seen.at(-1), moves.length);
    assert.equal(metrics.gamesIllegalReplay, 0);
  });
}
