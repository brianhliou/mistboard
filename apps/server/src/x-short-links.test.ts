import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applyStandardXiangqiMove,
  fsfUciToXiangqiSquares,
  isStandardXiangqiLegalMove,
  parseStandardXiangqiFen,
} from '@mistboard/game';
import { createHttpRequestHandler } from './server-http.js';
import { X_SHORT_LINKS, xShortLinkRedirect } from './x-short-links.js';

function parseTarget(location: string): URL {
  return new URL(location, 'https://mistboard.com');
}

test('x short link: a known slug points at the analysis board with its fen, line and UTM tags', () => {
  const location = xShortLinkRedirect('/x/1');
  assert.ok(location);
  const url = parseTarget(location);
  assert.equal(url.pathname, '/analysis/xiangqi');
  assert.equal(url.searchParams.get('fen'), X_SHORT_LINKS['1']!.target.fen);
  assert.equal(url.searchParams.get('moves'), X_SHORT_LINKS['1']!.target.moves);
  // Opens on the problem, not on the solution's last move.
  assert.equal(url.searchParams.get('ply'), '0');
  assert.equal(url.searchParams.get('utm_source'), 'x');
  assert.equal(url.searchParams.get('utm_medium'), 'social');
  assert.equal(url.searchParams.get('utm_campaign'), 'x-elegant-001-2026-10');
  // Never the study the problem comes from.
  assert.ok(!location.includes('/study/'));
  // A trailing slash is the same link.
  assert.equal(xShortLinkRedirect('/x/1/'), location);
});

test('x short link: an unknown slug lands on the homepage tagged x-unknown', () => {
  for (const path of ['/x/nope', '/x/toString', '/x/%E0%A4%A']) {
    const url = parseTarget(xShortLinkRedirect(path)!);
    assert.equal(url.pathname, '/', path);
    assert.equal(url.searchParams.get('utm_source'), 'x', path);
    assert.equal(url.searchParams.get('utm_campaign'), 'x-unknown', path);
  }
});

test('x short link: other paths are not short links', () => {
  for (const path of ['/x', '/x/', '/x/1/extra', '/xiangqi', '/analysis/xiangqi']) {
    assert.equal(xShortLinkRedirect(path), null, path);
  }
});

test('x short link: every campaign is unique and every slug is short', () => {
  const campaigns = Object.values(X_SHORT_LINKS).map((link) => link.campaign);
  assert.equal(new Set(campaigns).size, campaigns.length);
  for (const slug of Object.keys(X_SHORT_LINKS)) assert.match(slug, /^[a-z0-9-]{1,12}$/);
});

// The analysis page parses ?fen= and reads ?moves= as coordinate moves from it,
// stopping silently at the first illegal one, so a typo in a line would ship a
// truncated solution. Replay each line here with the rules kernel instead.
test('x short link: every seeded line replays legally from its FEN', () => {
  for (const [slug, { target }] of Object.entries(X_SHORT_LINKS)) {
    const parsed = parseStandardXiangqiFen(target.fen);
    assert.ok(parsed.ok, `${slug}: ${parsed.ok ? '' : parsed.error}`);
    let state = parsed.state;
    const tokens = target.moves.split(' ');
    assert.ok(tokens.length > 0, slug);
    for (const [index, token] of tokens.entries()) {
      const move = fsfUciToXiangqiSquares(token);
      assert.ok(move, `${slug}: move ${index + 1} "${token}" is not a coordinate move`);
      assert.equal(state.status.type, 'playing', `${slug}: game over before move ${index + 1}`);
      assert.ok(
        isStandardXiangqiLegalMove(state, move),
        `${slug}: move ${index + 1} "${token}" is illegal`,
      );
      state = applyStandardXiangqiMove(state, move);
    }
    // A solution ends the game: the side to move after it has lost.
    assert.notEqual(state.status.type, 'playing', `${slug}: the line does not end the game`);
  }
});

test('x short link: the server answers /x/<slug> with a 302 before the SPA', async () => {
  const staticDir = await mkdtemp(join(tmpdir(), 'mistboard-static-'));
  await writeFile(join(staticDir, 'index.html'), '<!doctype html><title>x</title>', 'utf-8');
  const handler = createHttpRequestHandler({
    staticDir,
    publicHost: 'https://mistboard.com',
    drainController: { isDraining: () => false },
  } as unknown as Parameters<typeof createHttpRequestHandler>[0]);
  const server = createServer(handler);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const known = await fetch(`${base}/x/2`, {
      redirect: 'manual',
      headers: { accept: 'text/html' },
    });
    assert.equal(known.status, 302);
    assert.equal(known.headers.get('cache-control'), 'no-store');
    const location = known.headers.get('location');
    assert.equal(location, xShortLinkRedirect('/x/2'));
    // The query is encoded: the FEN's slashes and spaces survive a round trip.
    const url = parseTarget(location!);
    assert.equal(url.searchParams.get('fen'), X_SHORT_LINKS['2']!.target.fen);
    assert.equal(url.searchParams.get('moves'), X_SHORT_LINKS['2']!.target.moves);
    assert.equal(url.searchParams.get('utm_campaign'), 'x-elegant-002-2026-10');
    assert.ok(!location!.includes(' '));
    await known.text();

    const unknown = await fetch(`${base}/x/999`, { redirect: 'manual' });
    assert.equal(unknown.status, 302);
    assert.equal(
      unknown.headers.get('location'),
      '/?utm_source=x&utm_medium=social&utm_campaign=x-unknown',
    );
    await unknown.text();
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
});
