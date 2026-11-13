import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { runBroadcastPushLocalSmoke } from './broadcast-push-local-smoke.mjs';

async function setup() {
  const [fixture] = JSON.parse(
    await readFile(
      new URL(
        '../packages/game/fixtures/xiangqi-broadcast/2025-wxc-sample/boards.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  let slug;
  let tokenFile;
  const calls = [];
  return {
    calls,
    tokenFile: () => tokenFile,
    deps: {
      cli: async (args) => {
        calls.push(args[0]);
        if (args[0] === 'create-test-event') slug = args[args.indexOf('--slug') + 1];
        if (args[0] === 'issue') {
          tokenFile = args[args.indexOf('--out') + 1];
          await writeFile(tokenFile, 'private-test-file', { mode: 0o600 });
          return { id: 'bpt_12345678' };
        }
      },
      simulate: async (args) => {
        calls.push('simulator');
        const pgn = await readFile(args[args.indexOf('--pgn') + 1], 'utf8');
        assert.match(pgn, /\[Result "(?:1-0|0-1|1\/2-1\/2)"\]/);
      },
      fetch: async (url) => {
        calls.push(url.pathname);
        const boardId = `${slug}-r1-b01`;
        if (url.pathname.endsWith('/export'))
          return new Response(
            JSON.stringify({
              ...fixture,
              id: boardId,
              status: 'complete',
              result: fixture.result === '*' ? '1/2-1/2' : fixture.result,
            }),
            { headers: { 'X-Robots-Tag': 'noindex' } },
          );
        if (url.pathname.startsWith('/api/'))
          return new Response(
            JSON.stringify({
              board: {
                plyCount: fixture.moves.length,
                status: 'complete',
                result: fixture.result === '*' ? '1/2-1/2' : fixture.result,
              },
            }),
          );
        return new Response(
          '<html><head><meta name="robots" content="noindex, nofollow"></head></html>',
        );
      },
      log: () => {},
    },
  };
}

test('local smoke uses token CLI, simulator and public APIs, checks noindex pages and removes private files', async () => {
  const h = await setup();
  const result = await runBroadcastPushLocalSmoke([], h.deps);
  assert.match(result.slug, /^push-smoke-/);
  assert.deepEqual(h.calls.slice(0, 3), ['create-test-event', 'issue', 'simulator']);
  assert.equal(h.calls.filter((s) => s.startsWith('/broadcast/')).length, 2);
  await assert.rejects(readFile(h.tokenFile()), { code: 'ENOENT' });
});

test('local smoke rejects remote servers, incomplete games and pages missing noindex', async () => {
  await assert.rejects(
    runBroadcastPushLocalSmoke(['--url', 'https://mistboard.com']),
    /local HTTP/,
  );
  for (const broken of ['export', 'page', 'board']) {
    const h = await setup();
    const original = h.deps.fetch;
    h.deps.fetch = async (url) => {
      if (broken === 'export' && url.pathname.endsWith('/export'))
        return new Response(JSON.stringify({ moves: [], status: 'live', result: '*' }), {
          headers: { 'X-Robots-Tag': 'noindex' },
        });
      if (broken === 'page' && url.pathname.startsWith('/broadcast/'))
        return new Response('<html></html>');
      if (
        broken === 'board' &&
        url.pathname.startsWith('/api/') &&
        !url.pathname.endsWith('/export')
      )
        return new Response(
          JSON.stringify({ board: { plyCount: 0, status: 'live', result: '*' } }),
        );
      return original(url);
    };
    await assert.rejects(runBroadcastPushLocalSmoke([], h.deps));
    await assert.rejects(readFile(h.tokenFile()), { code: 'ENOENT' });
  }
});
