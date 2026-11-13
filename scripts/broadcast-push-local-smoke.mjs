#!/usr/bin/env node
// Requires a running persistent local dev pair. Creates only an unlisted event;
// the token file is private and is always removed. No credentials are printed.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { formatXiangqiMoves, importXiangqiPaste } from '@mistboard/game';
import { runBroadcastPushSim } from './broadcast-push-sim.mjs';

export async function runBroadcastPushLocalSmoke(argv = [], deps = {}) {
  const { values: v } = parseArgs({ args: argv, options: { url: { type: 'string' } } });
  const base = new URL(v.url ?? 'http://localhost:3001');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || base.protocol !== 'http:')
    throw new Error('The smoke requires a local HTTP server.');
  const request = deps.fetch ?? fetch;
  const cli =
    deps.cli ??
    (async (args) => {
      // Discard command output: even on failure no driver details reach logs.
      const { stdout } = await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL('./broadcast-push-token.mjs', import.meta.url)), ...args],
        {
          env: {
            ...process.env,
            DATABASE_URL:
              process.env.DATABASE_URL ?? 'postgres://mistboard:mistboard@localhost:5435/mistboard',
          },
        },
      );
      return JSON.parse(stdout);
    });
  const simulate = deps.simulate ?? runBroadcastPushSim;
  const slug = `push-smoke-${randomBytes(6).toString('hex')}`;
  const dir = await mkdtemp(join(tmpdir(), 'mistboard-push-smoke-'));
  const tokenFile = join(dir, 'token');
  let tokenId;
  try {
    await cli(['create-test-event', '--slug', slug, '--name', 'Broadcast push local smoke']);
    tokenId = (await cli(['issue', '--tour', slug, '--label', 'local smoke', '--out', tokenFile]))
      ?.id;
    assert.equal((await stat(tokenFile)).mode & 0o777, 0o600, 'token file must be private');
    // Use the repository's replay-validated standard-opening broadcast fixture.
    const [fixture] = JSON.parse(
      await readFile(
        new URL(
          '../packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample/boards.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    const pgnFile = join(dir, 'game.pgn');
    const moves = formatXiangqiMoves(fixture.moves, 'iccs');
    const result = fixture.result === '*' ? '1/2-1/2' : fixture.result;
    const pgn = `[Red "Smoke Red"]\n[Black "Smoke Black"]\n[Result "${result}"]\n\n${moves.join(' ')} ${result}`;
    await writeFile(pgnFile, pgn);
    const expected = importXiangqiPaste(pgn);
    assert.equal(expected.error, undefined);
    assert.deepEqual(expected.moves, fixture.moves);
    await simulate([
      '--url',
      base.href,
      '--token-file',
      tokenFile,
      '--pgn',
      pgnFile,
      '--round',
      '1',
      '--board',
      '1',
      '--interval-ms',
      '550',
    ]);
    const boardId = `${slug}-r1-b01`;
    const api = await request(new URL(`/api/xiangqi/broadcasts/boards/${boardId}/export`, base));
    assert.equal(api.status, 200, 'board export must open');
    assert.match(api.headers.get('X-Robots-Tag') ?? '', /noindex/);
    const board = await api.json();
    assert.deepEqual(board.moves, expected.moves, 'every ply must be saved');
    assert.equal(board.status, 'complete');
    assert.equal(board.result, result);
    const boardApi = await request(new URL(`/api/xiangqi/broadcasts/boards/${boardId}`, base));
    assert.equal(boardApi.status, 200, 'board API must open');
    const payload = await boardApi.json();
    assert.equal(payload.board.plyCount, expected.moves.length);
    assert.equal(payload.board.status, 'complete');
    assert.equal(payload.board.result, result);
    for (const path of [`/broadcast/xiangqi/${slug}`, `/broadcast/xiangqi/board/${boardId}`]) {
      const response = await request(new URL(path, base));
      assert.equal(response.status, 200, 'broadcast page must open');
      const html = await response.text();
      assert.match(
        html,
        /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i,
        'unlisted page must be noindex',
      );
    }
    (deps.log ?? console.log)(
      `Broadcast push local smoke passed: ${expected.moves.length} plies, complete, ${result}; tour and board pages open with noindex.`,
    );
    return { slug, boardId };
  } finally {
    // File removal is unconditional, including after simulator/HTTP failures.
    if (tokenId) await cli(['revoke', '--id', tokenId]).catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runBroadcastPushLocalSmoke(process.argv.slice(2)).catch(() => {
    console.error(
      'Broadcast push local smoke failed. Requires migrated local Postgres and a running persistent dev server.',
    );
    process.exitCode = 1;
  });
}
