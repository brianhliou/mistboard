import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateStudyDecisions } from './study-chapter-decisions.js';

const rootFen =
  'xxxxkxxxx/9/1x5x1/x1x1x1x1x/9/9/X1X1X1X1X/1X5X1/9/XXXXKXXXX w R2A2C2P5N2B2r2a2c2p5n2b2 0 1 prnabpbrccppanpCNPNAPAPBRPPRCB';
const tree = {
  version: 1,
  rootFen,
  root: {
    children: [
      { uci: 'i4i5', children: [{ uci: 'a7a6', children: [{ uci: 'i5h3', children: [] }] }] },
    ],
  },
};
const row = { ply: 1, mover: 'red', playedWin: 50, realizedWin: 62 };
const input = { engineId: 'offline', source: 'match', decisions: [row] };

test('validates first-move = ply 1 and mover-POV percentages, including full rows', () => {
  assert.deepEqual(validateStudyDecisions('jieqi', tree, input), input);
  const full = {
    ...input,
    decisions: [
      { ...row, bestWin: 70, playedRank: 2, candidates: [{ move: 'i3i4', win: 50, played: true }] },
    ],
  };
  assert.deepEqual(validateStudyDecisions('jieqi', tree, full), full);
});
test('rejects other variants, root, non-mainline, non-reveal, duplicate and wrong-mover rows', () => {
  assert.throws(() => validateStudyDecisions('xiangqi', tree, input));
  assert.throws(() => validateStudyDecisions('jieqi', {}, input));
  for (const bad of [
    { ply: 0 },
    { ply: 99 },
    { ply: 3 },
    { mover: 'black' },
    { playedWin: NaN },
    { realizedWin: 101 },
    { capturedRole: 'horse' },
    { candidates: [{ move: 'i3i4', win: 50, capturedRole: 'horse' }] },
  ]) {
    assert.throws(() =>
      validateStudyDecisions('jieqi', tree, { ...input, decisions: [{ ...row, ...bad }] }),
    );
  }
  assert.throws(() => validateStudyDecisions('jieqi', tree, { ...input, decisions: [row, row] }));
});

const banqiTree = {
  version: 1,
  rootFen: '8/8/8/XX6 r H1s1 0 1 Hs',
  root: { children: [{ uci: 'a1a1', children: [{ uci: 'b1b1', children: [] }] }] },
};
const banqiInput = {
  engineId: 'offline',
  source: 'fixture',
  decisions: [
    {
      ply: 1,
      mover: 'red',
      bestWin: 70,
      playedWin: 50,
      realizedWin: 62,
      playedRank: 2,
      candidates: [
        { move: 'b0b0', win: 70 },
        { move: 'a0a0', win: 50, played: true },
      ],
    },
  ],
};
// Each planted rejection first proves the valid Banqi control is accepted.
for (const [name, variant, data] of [
  ['jieqi-shaped input', 'banqi', input],
  [
    'wrong ply count',
    'banqi',
    { ...banqiInput, decisions: [{ ...banqiInput.decisions[0], ply: 3 }] },
  ],
  ['unknown variant', 'future-banqi', banqiInput],
  ['prototype variant', 'constructor', banqiInput],
  [
    'hidden identity',
    'banqi',
    { ...banqiInput, decisions: [{ ...banqiInput.decisions[0], capturedRole: 'horse' }] },
  ],
  [
    'wrong mover',
    'banqi',
    { ...banqiInput, decisions: [{ ...banqiInput.decisions[0], mover: 'black' }] },
  ],
  [
    'bad candidate UCI',
    'banqi',
    {
      ...banqiInput,
      decisions: [{ ...banqiInput.decisions[0], candidates: [{ move: 'i3i4', win: 70 }] }],
    },
  ],
] as const) {
  test(`accepts Banqi decomposition and rejects ${name}`, () => {
    assert.deepEqual(validateStudyDecisions('banqi', banqiTree, banqiInput), banqiInput);
    assert.throws(() => validateStudyDecisions(variant, banqiTree, data));
  });
}
