import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  expandMoves,
  GALLERY_STATES,
  OLD_POOL_NOTE,
  parseMove,
  pickPolicyMove,
  pliesPlayed,
  renderGalleryHtml,
  resolveGalleryTargets,
  summarizeView,
} from './lib/jieqi-state-gallery-lib.mjs';

test('the gallery only ever drives a loopback dev pair', () => {
  assert.deepEqual(resolveGalleryTargets({ web: 'http://localhost:3150' }), {
    web: 'http://localhost:3150',
    api: 'http://localhost:3151',
    ws: 'ws://localhost:3151',
  });
  assert.equal(
    resolveGalleryTargets({ web: 'http://127.0.0.1:3150', api: 'http://127.0.0.1:4000' }).ws,
    'ws://127.0.0.1:4000',
  );
  for (const web of [
    'https://mistboard.com',
    'http://mistboard.com',
    'http://web-production.up.railway.app',
    'http://192.168.0.5:3150',
    'https://localhost:3150',
  ]) {
    assert.throws(() => resolveGalleryTargets({ web }), /refusing|expected http/, web);
  }
  assert.throws(
    () => resolveGalleryTargets({ web: 'http://localhost:3150', api: 'https://mistboard.com' }),
    /refusing/,
  );
});

test('moves parse and policy runs expand to one entry per ply', () => {
  assert.deepEqual(parseMove('h3-e3'), { from: 'h3', to: 'e3' });
  assert.deepEqual(parseMove('b10-b1'), { from: 'b10', to: 'b1' });
  for (const bad of ['h3e3', 'j3-e3', 'h0-e3', 'h11-e3', 'H3-E3']) {
    assert.throws(() => parseMove(bad), /bad move/, bad);
  }
  assert.deepEqual(expandMoves(['h3-e3', { policy: 2 }]), [
    { from: 'h3', to: 'e3' },
    'policy',
    'policy',
  ]);
  assert.throws(() => expandMoves([{ policy: 0 }]), /bad move entry/);
});

test('every catalogue state is well formed and leaves its seat a live position', () => {
  const ids = GALLERY_STATES.map((state) => state.id);
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  for (const state of GALLERY_STATES) {
    assert.ok(['red', 'black'].includes(state.seat), state.id);
    expandMoves(state.moves);
    for (const text of [state.title, state.scenario, state.reading]) {
      assert.ok(text && !text.includes('—'), `state ${state.id}: copy present, no em dash`);
    }
  }
  assert.deepEqual(
    GALLERY_STATES.find((state) => state.id === 'a').widths,
    ['desktop', 'mobile'],
    'the opening is also shot at phone width',
  );
  const f = GALLERY_STATES.find((state) => state.id === 'f');
  const g = GALLERY_STATES.find((state) => state.id === 'g');
  assert.deepEqual(g.moves, f.moves, '(g) is (f) from the other chair');
  assert.equal(expandMoves(f.moves).length % 2, 0, '(f) ends with Red to move');
  assert.ok(!OLD_POOL_NOTE.includes('—'));
});

test('plies come from the full-move number and the side to move', () => {
  assert.equal(pliesPlayed({ moveNumber: 1, status: { type: 'playing', turn: 'red' } }), 0);
  assert.equal(pliesPlayed({ moveNumber: 1, status: { type: 'playing', turn: 'black' } }), 1);
  assert.equal(pliesPlayed({ moveNumber: 8, status: { type: 'playing', turn: 'red' } }), 14);
});

test('the policy takes a face-down piece, else reveals, else plays the first move', () => {
  const base = {
    status: { type: 'playing', turn: 'red' },
    board: {
      a1: { color: 'red', faceDown: true },
      e1: { color: 'red', role: 'general', faceDown: false },
      a4: { color: 'red', faceDown: true },
      a7: { color: 'black', faceDown: true },
      b7: { color: 'black', role: 'horse', faceDown: false },
    },
  };
  const takes = pickPolicyMove({
    ...base,
    legalMoves: [
      { from: 'e1', to: 'e2' },
      { from: 'a4', to: 'a5' },
      { from: 'e1', to: 'b7' },
      { from: 'a1', to: 'a7' },
    ],
  });
  assert.deepEqual(takes, { from: 'a1', to: 'a7' }, 'face-down capture first');
  const reveals = pickPolicyMove({
    ...base,
    legalMoves: [
      { from: 'e1', to: 'b7' },
      { from: 'e1', to: 'e2' },
      { from: 'a4', to: 'a5' },
    ],
  });
  assert.deepEqual(reveals, { from: 'a4', to: 'a5' }, 'a face-up capture loses to a reveal');
  const first = pickPolicyMove({
    ...base,
    legalMoves: [
      { from: 'e1', to: 'e2' },
      { from: 'e1', to: 'd1' },
    ],
  });
  assert.deepEqual(first, { from: 'e1', to: 'd1' }, 'lexicographic tie-break');
  assert.throws(() => pickPolicyMove({ ...base, legalMoves: [] }), /no legal move/);
});

test('the view summary counts the board and each side’s losses as the seat knows them', () => {
  const summary = summarizeView(
    {
      moveNumber: 2,
      status: { type: 'playing', turn: 'black' },
      board: {
        e1: { color: 'red', role: 'general', faceDown: false },
        a1: { color: 'red', faceDown: true },
        e10: { color: 'black', role: 'general', faceDown: false },
      },
      captured: [
        { owner: 'red', role: null },
        { owner: 'black', role: 'chariot' },
      ],
    },
    'red',
  );
  assert.equal(summary.plies, 3);
  assert.deepEqual(summary.board, {
    red: { faceDown: 1, revealed: 1 },
    black: { faceDown: 0, revealed: 1 },
  });
  assert.deepEqual(summary.lost, { red: ['?'], black: ['chariot'] });
});

test('the gallery page escapes its text and links each screenshot', () => {
  const html = renderGalleryHtml({
    entries: [
      {
        id: 'a',
        title: 'Opening <script>',
        scenario: 'S & T',
        reading: 'R',
        seat: 'red',
        moveText: '',
        shots: [
          { width: 'desktop', file: 'state-a-desktop.png', viewport: { width: 1440, height: 900 } },
        ],
        facts: ['x < y'],
      },
    ],
    command: 'node scripts/jieqi-state-gallery.mjs',
    generatedAt: '2026-10-07T00:00:00.000Z',
    note: OLD_POOL_NOTE,
  });
  assert.match(html, /<title>Jieqi live baseline<\/title>/);
  assert.match(html, /src="state-a-desktop.png"/);
  assert.match(html, /Opening &lt;script&gt;/);
  assert.match(html, /x &lt; y/);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('—'), 'no em dashes in the page');
});
