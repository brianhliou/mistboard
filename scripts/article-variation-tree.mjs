#!/usr/bin/env node
// Local-only, baked article variations. Specs use JSON object literals, as
// emitted by player-page-article.mjs. No browser, database or network needed.
// node scripts/article-variation-tree.mjs --spec G_M_143657 --plies 31,53 --write
// --benchmark --limit 1 measures a root without writing. Defaults: 2M nodes,
// six threads, production-pinned local Pikafish and the adjacent pikafish.nnue.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { articleLineAssessment } from './lib/article-line-assessment.mjs';

/** Scores are from the side to move, ordered best first; mate is not cp. */
export function pruneCandidates(candidates, { threshold = 60, max = 3 } = {}) {
  if (!candidates.length) return [];
  const best = candidates[0];
  return candidates
    .filter((candidate) => {
      if (best.mate != null || candidate.mate != null) return candidate.mate === best.mate;
      return Number.isFinite(candidate.cp) && best.cp - candidate.cp <= threshold;
    })
    .slice(0, max);
}

export function replyAlternatives(candidates) {
  return pruneCandidates(candidates, { threshold: 40, max: 2 }).slice(1);
}

function engine(binary) {
  const proc = spawn(binary, { stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '';
  let pending;
  let failure;
  const fail = (error) => {
    failure = error;
    clearTimeout(pending?.timer);
    pending?.reject(error);
  };
  proc.on('error', fail);
  proc.on('exit', (code) => fail(new Error(`Pikafish exited (${code})`)));
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!pending) continue;
      pending.onLine?.(line);
      if (pending.match(line)) {
        clearTimeout(pending.timer);
        const { resolve: done } = pending;
        pending = undefined;
        done();
      }
    }
  });
  const send = (command) => proc.stdin.write(`${command}\n`);
  const command = (text, match, onLine) =>
    new Promise((resolve, reject) => {
      if (failure) return reject(failure);
      const timer = setTimeout(() => {
        pending = undefined;
        reject(new Error(`Pikafish timed out: ${text}`));
        proc.kill();
      }, 60000);
      pending = { match, onLine, resolve, reject, timer };
      send(text);
    });
  return { proc, send, command };
}

export async function main(args = process.argv.slice(2)) {
  const flag = (key, fallback) => {
    const index = args.indexOf(`--${key}`);
    return index < 0 ? fallback : args[index + 1];
  };
  const path = flag('article', 'apps/web/src/articles/content/meng-fanrui.ts');
  const nodes = Number(flag('nodes', '2000000'));
  const threads = Number(flag('threads', '6'));
  const limit = Number(flag('limit', '0'));
  const wantedPlies = flag('plies', '').split(',').filter(Boolean).map(Number);
  const source = readFileSync(path, 'utf8');
  const specs = [...source.matchAll(/^const (G_M_\d+): XiangqiReplaySpec = (\{.*?\n\});/gms)].map(
    (match) => ({ name: match[1], spec: JSON.parse(match[2]), match }),
  );
  const jobs = specs
    .flatMap(({ name, spec }) =>
      Object.entries(spec.annotations.byPly)
        .filter(
          ([ply, annotation]) =>
            annotation.line && (!wantedPlies.length || wantedPlies.includes(Number(ply))),
        )
        .filter(() => !flag('spec', '') || name === flag('spec', ''))
        .map(([ply]) => ({ name, spec, ply: Number(ply) })),
    )
    .slice(0, limit || undefined);
  if (!jobs.length) throw new Error('No matching article positions');
  const binary =
    process.env.MISTBOARD_PIKAFISH_XIANGQI_PATH ??
    resolve(process.env.HOME, 'projects/tools/pikafish-6a59ee2f/src/pikafish');
  const net =
    process.env.MISTBOARD_PIKAFISH_XIANGQI_NET ?? resolve(dirname(binary), 'pikafish.nnue');
  const uci = engine(binary);
  let searches = 0;
  const started = performance.now();
  try {
    await uci.command('uci', (line) => line === 'uciok');
    uci.send(`setoption name EvalFile value ${net}`);
    uci.send(`setoption name Threads value ${threads}`);
    uci.send('setoption name Hash value 256');
    await uci.command('isready', (line) => line === 'readyok');
    async function search(spec, moves, multiPV) {
      const candidates = new Map();
      uci.send(`setoption name MultiPV value ${multiPV}`);
      uci.send(
        `position ${spec.startFen ? `fen ${spec.startFen}` : 'startpos'}${moves.length ? ` moves ${moves.join(' ')}` : ''}`,
      );
      // A node budget with a wall-time ceiling makes the article's worst-case
      // budget bounded even on a slow position (20 roots, at most 16 searches/root).
      await uci.command(
        `go nodes ${nodes} movetime 7000`,
        (line) => line.startsWith('bestmove'),
        (line) => {
          const match = /depth (\d+).*multipv (\d+).*score (cp|mate) (-?\d+).* pv (.+)$/.exec(line);
          if (match && !/\b(lowerbound|upperbound)\b/.test(line))
            candidates.set(Number(match[2]), {
              [match[3]]: Number(match[4]),
              pv: match[5].split(/\s+/),
              depth: Number(match[1]),
            });
        },
      );
      searches += 1;
      if (!candidates.has(1)) throw new Error('Search returned no principal variation');
      return [...candidates.entries()].sort((a, b) => a[0] - b[0]).map((entry) => entry[1]);
    }
    async function extend(spec, prefix, pv, count) {
      const line = pv.slice(0, count);
      while (line.length < count) {
        const next = (await search(spec, [...prefix, ...line], 1))[0].pv;
        if (!next.length || next[0] === '(none)') break;
        line.push(...next.slice(0, count - line.length));
      }
      return line;
    }
    async function branch(spec, prefix, pv) {
      const line = await extend(spec, prefix, pv, 8);
      const end = [...prefix, ...line];
      const score = (await search(spec, end, 1))[0];
      const redFirst = !spec.startFen || !/\s[bB]\s/.test(spec.startFen);
      const redToMove = (end.length % 2 === 0) === redFirst;
      const sign = redToMove ? 1 : -1;
      return {
        line: line.join(' '),
        lineEval:
          articleLineAssessment({
            cp: score.cp == null ? null : score.cp * sign,
            mate: score.mate == null ? null : score.mate * sign,
          }) ?? '=',
      };
    }
    const results = {};
    for (const job of jobs) {
      const positionStart = performance.now();
      const mainline = job.spec.iccs.trim().split(/\s+/);
      const prefix = mainline.slice(0, job.ply - 1);
      uci.send('ucinewgame');
      await uci.command('isready', (line) => line === 'readyok');
      const rootStart = performance.now();
      const candidates = await search(job.spec, prefix, 3);
      const rootSeconds = (performance.now() - rootStart) / 1000;
      const branches = [];
      if (!args.includes('--benchmark')) {
        for (const candidate of pruneCandidates(candidates).filter(
          (c) => c.pv[0] !== mainline[job.ply - 1],
        )) {
          const replies = await search(job.spec, [...prefix, candidate.pv[0]], 2);
          const firstLine = [candidate.pv[0], ...replies[0].pv];
          const tree = await branch(job.spec, prefix, firstLine);
          for (const reply of replyAlternatives(replies)) {
            const replyPrefix = [...prefix, candidate.pv[0]];
            const alternative = await branch(job.spec, replyPrefix, reply.pv);
            tree.replies ??= {};
            tree.replies[2] = [alternative];
          }
          branches.push(tree);
        }
      }
      const seconds = (performance.now() - positionStart) / 1000;
      results[`${job.name}:${job.ply}`] = { rootSeconds, seconds, candidates, branches };
      console.log(
        `${job.name}:${job.ply} root ${rootSeconds.toFixed(2)}s, position ${seconds.toFixed(2)}s, ${branches.length} branches, ${branches.reduce((n, b) => n + (b.replies?.[2]?.length ?? 0), 0)} replies`,
      );
    }
    if (!args.includes('--benchmark')) {
      writeFileSync(
        flag('out', 'scripts/data/article-variation-trees.json'),
        `${JSON.stringify({ article: path, nodes, threads, seconds: (performance.now() - started) / 1000, searches, results }, null, 2)}\n`,
      );
      if (args.includes('--write')) {
        for (const { name, spec } of specs)
          for (const [ply, annotation] of Object.entries(spec.annotations.byPly)) {
            const result = results[`${name}:${ply}`];
            if (result) annotation.branches = result.branches;
          }
        let baked = source;
        for (const { spec, match } of specs)
          baked = baked.replace(
            match[0],
            `const ${match[1]}: XiangqiReplaySpec = ${JSON.stringify(spec, null, 2)};`,
          );
        writeFileSync(path, baked);
      }
    }
  } finally {
    uci.send('quit');
    uci.proc.stdin.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
