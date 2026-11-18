import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  banqiAnalysisQueryStats,
  closeBanqiAnalysisQueries,
  openBanqiAnalysisQueries,
  runBanqiAnalysisQuery,
} from './banqi-analysis-runner.js';
import { UciEnginePool } from './uci-engine-harness.js';

const pause = () => new Promise<void>((r) => setTimeout(r, 5));
test('cold analysis cache coalesces exact queries, guards assets and drains cancelled work', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'banqi-runner-'));
  const binary = join(dir, 'engine'),
    model = join(dir, 'net'),
    counter = join(dir, 'count'),
    started = join(dir, 'started');
  const source = `#!${process.execPath}\nconst fs=require('node:fs');const readline=require('node:readline');fs.appendFileSync(${JSON.stringify(counter)},'spawn\\n');let model='';readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='uci')console.log('option name EvalFile type string default empty\\noption name NoProgressLimit type spin default 60 min 1 max 1000\\nuciok');if(line.startsWith('setoption name EvalFile value '))model=line.slice(30);if(line==='isready'){if(fs.readFileSync(model,'utf8')==='reject')console.log('info string error EvalFile: sensitive-path; using classical');console.log('readyok');}if(line.startsWith('go ')){fs.writeFileSync(${JSON.stringify(started)},'go');const nodes=Number(line.match(/nodes (\\d+)/)[1]);const emit=()=>console.log('info depth 4 score cp 10 nodes '+nodes+' time 1 pv a0a0\\nbestmove a0a0');if(fs.readFileSync(model,'utf8')==='slow')setTimeout(emit,150);else emit();}});`;
  try {
    await writeFile(binary, source, { mode: 0o700 });
    await writeFile(model, 'valid');
    const pool = new UciEnginePool({
      name: 'banqi-runner-test',
      defaultMaxProcesses: 2,
      maxProcessesEnvVar: 'MISTBOARD_TEST_BQ_RUNNER_PROCESSES',
      queueTimeoutEnvVar: 'MISTBOARD_TEST_BQ_RUNNER_QUEUE_TIMEOUT_MS',
      queueTimeoutMessage: 'test queue timeout',
    });
    const args = {
      binaryPath: binary,
      modelPath: model,
      initCommands: [
        'uci',
        `setoption name EvalFile value ${model}`,
        'setoption name NoProgressLimit value 60',
        'ucinewgame',
        'isready',
      ],
      positionCommand: 'position fen masked',
      goCommand: 'go nodes 200 movetime 30000 searchmoves a0a0',
      nodes: 200,
      movetimeCapMs: 30000,
      pool,
    };
    const [a, b] = await Promise.all([runBanqiAnalysisQuery(args), runBanqiAnalysisQuery(args)]);
    assert.deepEqual(a, b);
    a.lines![0]!.pv[0] = 'mutated';
    const hit = await runBanqiAnalysisQuery(args);
    assert.equal(hit.lines![0]!.pv[0], 'a0a0');
    assert.equal((await readFile(counter, 'utf8')).trim().split('\n').length, 1);
    await rm(model);
    await assert.rejects(runBanqiAnalysisQuery(args), /net.*not available/);
    await writeFile(model, 'reject');
    await assert.rejects(runBanqiAnalysisQuery(args), /query failed/);
    await writeFile(model, 'slow');
    await rm(started, { force: true });
    const rotating = runBanqiAnalysisQuery(args);
    while (true) {
      try {
        await access(started);
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    await writeFile(model, 'changed');
    await assert.rejects(rotating, /query failed/);
    await writeFile(model, 'valid');
    const blockPool = new UciEnginePool({
      name: 'blocked-bq-test',
      defaultMaxProcesses: 1,
      maxProcessesEnvVar: 'MISTBOARD_TEST_BQ_BLOCKED_PROCESSES',
      queueTimeoutEnvVar: 'MISTBOARD_TEST_BQ_BLOCKED_QUEUE_TIMEOUT_MS',
      queueTimeoutMessage: 'test blocked timeout',
    });
    const release = await blockPool.acquire();
    const queued = runBanqiAnalysisQuery({ ...args, nodes: 201, pool: blockPool });
    // Observe the rejection now: if the queue check fails, the cleanup abort would
    // otherwise surface as an unhandled rejection that hides the real assertion.
    const queuedRejects = assert.rejects(queued, /closed|failed/);
    // A loaded CI runner can take longer than a fixed number of turns to stat the
    // assets and reach the pool queue, so wait on time, not turns.
    const queueBy = Date.now() + 5000;
    while (blockPool.stats().queueDepth === 0 && Date.now() < queueBy) await pause();
    assert.equal(blockPool.stats().queueDepth, 1);
    closeBanqiAnalysisQueries();
    await queuedRejects;
    release();
    await assert.rejects(runBanqiAnalysisQuery(args), /closed/);
    openBanqiAnalysisQueries();
    await runBanqiAnalysisQuery({ ...args, nodes: 201, goCommand: 'go nodes 201 movetime 30000' });
    assert.equal(banqiAnalysisQueryStats().cache.inflight, 0);
  } finally {
    closeBanqiAnalysisQueries();
    await rm(dir, { recursive: true, force: true });
  }
});
