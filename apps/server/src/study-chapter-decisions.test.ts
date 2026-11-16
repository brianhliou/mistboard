import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  banqiPieceLetter,
  createInitialThreeKingdomsBanqiState,
  threeKingdomsBanqiStateToDealtFen,
} from '@mistboard/game';
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

const tkTree = {
  version: 1,
  replay: 'three-kingdoms-banqi-public-v1',
  root: {
    children: [
      { uci: '@a1:R', children: [{ uci: '@b1:s', children: [{ uci: 'a1b1', children: [] }] }] },
    ],
  },
};
const tkInput = {
  engineId: 'misty-three-kingdoms-banqi',
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
        { move: 'b1b1', win: 70 },
        { move: 'a1a1', win: 50, played: true },
      ],
    },
  ],
};
test('Three Kingdoms accepts public replay flip decisions and serializes only public scores and moves', () => {
  const checked = validateStudyDecisions('three-kingdoms-banqi', tkTree, tkInput);
  assert.deepEqual(checked, tkInput);
  assert.deepEqual(JSON.parse(JSON.stringify({ chapter: tkTree, analysis: checked })), {
    chapter: tkTree,
    analysis: tkInput,
  });
  assert.doesNotMatch(JSON.stringify(checked), /role|color|captured|deal|seed|board/);
  const second = {
    ...tkInput,
    decisions: [
      { ...tkInput.decisions[0], ply: 2, mover: 'black', candidates: [{ move: 'b1b1', win: 70 }] },
    ],
  };
  assert.deepEqual(validateStudyDecisions('three-kingdoms-banqi', tkTree, second), second);
  const dealt = {
    ...tkTree,
    replay: undefined,
    rootFen: threeKingdomsBanqiStateToDealtFen(createInitialThreeKingdomsBanqiState('study', 42)),
    root: { children: [{ uci: 'a1a1', children: [] }] },
  };
  assert.deepEqual(validateStudyDecisions('three-kingdoms-banqi', dealt, tkInput), tkInput);
});

test('Three Kingdoms strictly rejects invalid decisions, illegal candidates and planted hidden identities', () => {
  // The valid control must pass, so unsupported-variant rejection cannot satisfy these cases.
  assert.deepEqual(validateStudyDecisions('three-kingdoms-banqi', tkTree, tkInput), tkInput);
  const row = tkInput.decisions[0]!;
  for (const bad of [
    { ply: 0 },
    { ply: 1.5 },
    { ply: 3 },
    { ply: 99 },
    { mover: 'black' },
    { bestWin: Infinity },
    { playedWin: NaN },
    { realizedWin: -1 },
    { realizedWin: 101 },
    { playedRank: 0 },
    { playedRank: 1.5 },
    { playedRank: undefined },
    { candidates: [] },
    { bestWin: 71 },
    { capturedRole: 'horse' },
    { unknown: true },
    { candidates: [{ move: 'a0a0', win: 70 }] },
    { candidates: [{ move: 'a1b1', win: 70 }] },
    { candidates: [{ move: 'e3e3', win: 70 }] },
    { candidates: [{ move: 'a1a1 ', win: 70 }] },
    { candidates: [{ move: '@a1:R', win: 70 }] },
    { candidates: [{ move: 'a1a1', win: NaN }] },
    { candidates: [{ move: 'a1a1', win: 70, played: 'yes' }] },
    { candidates: [{ move: 'a1a1', win: 70, captured: { role: 'horse', color: 'red' } }] },
  ])
    assert.throws(
      () =>
        validateStudyDecisions('three-kingdoms-banqi', tkTree, {
          ...tkInput,
          decisions: [{ ...row, ...bad }],
        }),
      JSON.stringify(bad),
    );
  assert.throws(() =>
    validateStudyDecisions('three-kingdoms-banqi', tkTree, { ...tkInput, decisions: [row, row] }),
  );
  assert.throws(() =>
    validateStudyDecisions('three-kingdoms-banqi', tkTree, { ...tkInput, capturedRole: 'horse' }),
  );
  for (const root of [
    {},
    { ...tkTree, replay: 'unknown' },
    { ...tkTree, rootFen: 'secret' },
    { ...tkTree, root: { children: [{ uci: '@e3:R', children: [] }] } },
  ])
    assert.throws(() => validateStudyDecisions('three-kingdoms-banqi', root, tkInput));
});

test('Three Kingdoms validates every observed flip in the complete 78-ply public game', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('../../../packages/game/fixtures/three-kingdoms-banqi-78.json', import.meta.url),
      'utf8',
    ),
  );
  const root: { children: { uci: string; children: unknown[] }[] } = { children: [] };
  let node = root;
  const decisions = [];
  for (const [index, ply] of fixture.plies.entries()) {
    const uci = ply.revealed ? `${ply.uci}:${banqiPieceLetter(ply.revealed)}` : ply.uci;
    const child = { uci, children: [] };
    node.children.push(child);
    node = child;
    if (ply.revealed)
      decisions.push({
        ply: index + 1,
        mover: index % 2 === 0 ? 'red' : 'black',
        bestWin: 50,
        playedWin: 50,
        realizedWin: 62,
        playedRank: 1,
        candidates: [{ move: `${ply.uci.slice(1)}${ply.uci.slice(1)}`, win: 50, played: true }],
      });
  }
  const input = { engineId: 'offline', source: 'complete-game', decisions };
  const checked = validateStudyDecisions(
    'three-kingdoms-banqi',
    { version: 1, replay: tkTree.replay, root },
    input,
  );
  assert.deepEqual(checked, input);
  assert.doesNotMatch(JSON.stringify(checked), /role|color|captured|deal|seed|board/);
});

const flipPlan = JSON.parse(
  readFileSync(
    new URL(
      '../../../scripts/variant-lab/rules-page-games/plans/jungle-flip.plan.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const flipLuck = JSON.parse(
  readFileSync(
    new URL(
      '../../../scripts/variant-lab/rules-page-games/plans/jungle-flip.luck.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const flipTree = flipPlan.create.chapter.tree;

test('Flip Jungle validates the complete rules-game mainline and its identity-free embed payload', () => {
  const checked = validateStudyDecisions('jungle-flip', flipTree, flipLuck);
  assert.deepEqual(checked, flipLuck);
  assert.equal(checked.decisions.length, 16);
  // The finished study's dealt root is the sole identity-bearing exception.
  const { tree, ...chapter } = flipPlan.create.chapter;
  const payload = JSON.parse(
    JSON.stringify({
      study: { id: '7d1IkHPE', visibility: 'public' },
      chapters: [{ ...chapter, id: 'vUJ3Yodx', root: tree, hasDecisions: true }],
      decisions: checked,
    }),
  );
  assert.equal(payload.chapters[0].root.rootFen, flipTree.rootFen);
  delete payload.chapters[0].root.rootFen;
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /"(?:role|faceDown|capturedRole|deal|seed|board|rootFen)"/);
  assert.ok(!serialized.includes(flipTree.rootFen.split(' ').at(-1)));
  assert.doesNotMatch(serialized, /[a-d][0-4](?:[a-d][0-4])?:[RCDWPTLErcdwptle]/);
});

test('Flip Jungle rejects wrong flip plies, movers, illegal candidates and planted identities', () => {
  assert.deepEqual(validateStudyDecisions('jungle-flip', flipTree, flipLuck), flipLuck);
  const row = flipLuck.decisions[0];
  for (const bad of [
    { ply: 0 },
    { ply: 1.5 },
    { ply: 7 },
    { ply: 99 },
    { mover: 'black' },
    { bestWin: Infinity },
    { playedWin: NaN },
    { realizedWin: -1 },
    { realizedWin: 101 },
    { playedRank: 0 },
    { playedRank: 1.5 },
    { playedRank: undefined },
    { candidates: [] },
    { bestWin: 71 },
    { capturedRole: 'elephant' },
    { faceDown: { role: 'rat', color: 'red' } },
    { candidates: [{ move: 'a0b0', win: row.bestWin }] },
    { candidates: [{ move: 'e0e0', win: row.bestWin }] },
    { candidates: [{ move: 'a4a4', win: row.bestWin }] },
    { candidates: [{ move: 'a0a0 ', win: row.bestWin }] },
    { candidates: [{ move: 'a0a0:R', win: row.bestWin }] },
    { candidates: [{ move: 'a0a0', win: NaN }] },
    { candidates: [{ move: 'a0a0', win: row.bestWin, played: 'yes' }] },
    { candidates: [{ move: 'a0a0', win: row.bestWin, role: 'rat' }] },
    {
      candidates: [
        { move: 'a0a0', win: row.bestWin },
        { move: 'b0b0', win: 100 },
      ],
    },
  ])
    assert.throws(
      () =>
        validateStudyDecisions('jungle-flip', flipTree, {
          ...flipLuck,
          decisions: [{ ...row, ...bad }],
        }),
      JSON.stringify(bad),
    );
  assert.throws(() =>
    validateStudyDecisions('jungle-flip', flipTree, { ...flipLuck, decisions: [row, row] }),
  );
  assert.throws(() =>
    validateStudyDecisions('jungle-flip', flipTree, { ...flipLuck, deal: 'secret' }),
  );
  for (const root of [
    {},
    { ...flipTree, rootFen: 'invalid' },
    { ...flipTree, rootFen: flipTree.rootFen.split(' ').slice(0, 5).join(' ') },
    { ...flipTree, root: { children: [{ uci: 'a1b1', children: [] }] } },
    {
      ...flipTree,
      root: { children: [{ uci: 'a1a1', children: [{ uci: 'a1a1', children: [] }] }] },
    },
  ])
    assert.throws(() => validateStudyDecisions('jungle-flip', root, flipLuck));
});
