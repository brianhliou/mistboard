import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyStandardXiangqiMove,
  createInitialXiangqiState,
  standardXiangqiPositionKey,
} from '@mistboard/game';
import { canonicalPosition, mirrorMove } from '../xiangqi-opening-mirror.js';
import {
  buildDecisiveMomentChapter,
  buildModelGameChapter,
  type ExplorerLookup,
  findOpeningDeviation,
  legalLine,
  moveOf,
  type SerializedNode,
} from './annotate.js';
import { CENTRAL_CANNON_SCREEN_HORSES, evalsOf, gameOf, recipeOf } from './fixtures.js';
import { judgeGame } from './moments.js';

const MOVES = CENTRAL_CANNON_SCREEN_HORSES;
const UCI = MOVES.map((m) => `${m.from}${m.to}`);

// Red wins. Black's ply 4 (i10h10) is graded a blunder; the engine wanted b10c8.
const EVALS = evalsOf([10, 20, 20, 20, 320, 300, 300, 300, 300, 300, 300], {
  3: { best: 'b10c8', pv: ['b10c8', 'i1h1', 'a10b10'] },
});

function mainline(root: SerializedNode): SerializedNode[] {
  const out: SerializedNode[] = [];
  let node = root;
  while (node.children[0]) {
    node = node.children[0];
    out.push(node);
  }
  return out;
}

test('a model-game chapter carries provenance, a glyph, a comment and a refutation sibling', async () => {
  const game = gameOf('b1', MOVES, '1-0');
  const verdicts = judgeGame(UCI, EVALS);
  const chapter = await buildModelGameChapter(
    game,
    verdicts,
    recipeOf({
      opening: {
        name: 'Central Cannon vs Screen Horses',
        nameZh: '中炮对屏风马',
        byPly: 8,
        red: ['C@e3'],
        black: ['H@c8', 'H@g8'],
      },
    }),
  );

  assert.equal(chapter.gamebook, false);
  assert.equal(chapter.orientation, 'red');
  assert.equal(chapter.name, 'Yin Sheng vs Yang Shizhe · Round 3 · 1-0');
  assert.deepEqual(chapter.tags, {
    red: 'Yin Sheng',
    black: 'Yang Shizhe',
    result: '1-0',
    event: '2026 National Xiangqi Men Division A League',
    date: '2026-09-15',
    round: 'Round 3',
    site: 'http://www.dpxq.com/hldcg/search/view_m_1.html',
  });
  const rootComment = chapter.root.root.annotations?.comments?.[0];
  assert.ok(rootComment);
  assert.match(rootComment.text, /Yin Sheng \(Red\) vs Yang Shizhe \(Black\)/);
  assert.match(rootComment.text, /Opening: Central Cannon vs Screen Horses/);
  assert.match(rootComment.text, /Accuracy: Red \d+\.\d, Black \d+\.\d/);
  assert.match(rootComment.i18n?.['zh-Hans'] ?? '', /尹昇（红）对杨世哲（黑）/);
  assert.match(
    rootComment.i18n?.['zh-Hant'] ?? '',
    /尹昇（紅）對楊世哲（黑）|尹昇（紅）對杨世哲（黑）/,
  );

  const line = mainline(chapter.root.root);
  assert.equal(line.length, MOVES.length);
  assert.deepEqual(
    line.map((n) => n.uci),
    UCI,
  );
  const blunder = line[3];
  assert.ok(blunder);
  assert.deepEqual(blunder.annotations?.glyphs, [4]);
  assert.match(blunder.annotations?.comments?.[0]?.text ?? '', /Blunder/i);
  // The refutation is a SIBLING of the played move, under the same parent.
  const parent = line[2];
  assert.ok(parent);
  assert.equal(parent.children.length, 2);
  assert.equal(parent.children[1]?.uci, 'b10c8');
  assert.equal(parent.children[1]?.children[0]?.uci, 'i1h1');
});

test('an unjudged move gets no annotations at all', async () => {
  const chapter = await buildModelGameChapter(
    gameOf('b2', MOVES, '1-0'),
    judgeGame(UCI, EVALS),
    recipeOf(),
  );
  const line = mainline(chapter.root.root);
  assert.equal(line[0]?.annotations, undefined);
});

test('the opening deviation is read mirror-canonically from the explorer', async () => {
  // The fake explorer answers in the STORED (canonical) frame, the way the real
  // table does: when the asked-for key is the mirror of the game's position,
  // the rows come back mirrored and the walker has to flip them home.
  const keys: string[] = [];
  let state = createInitialXiangqiState('t');
  const frames = MOVES.map((move) => {
    const key = standardXiangqiPositionKey(state);
    const canonical = canonicalPosition(key);
    state = applyStandardXiangqiMove(state, move);
    return canonical;
  });
  const explorer: ExplorerLookup = async (key) => {
    keys.push(key);
    const ply = keys.length;
    const frame = frames[ply - 1];
    assert.ok(frame);
    assert.equal(key, frame.key);
    const rows =
      ply === 4
        ? [
            { move: 'b10c8', games: 60 },
            { move: 'i10h10', games: 2 },
            { move: 'g7g6', games: 10 },
          ]
        : [{ move: UCI[ply - 1] ?? '', games: 50 }];
    return frame.mirrored
      ? rows.map((row) => {
          const parsed = moveOf(row.move);
          return parsed
            ? { ...row, move: `${mirrorMove(parsed).from}${mirrorMove(parsed).to}` }
            : row;
        })
      : rows;
  };
  const deviation = await findOpeningDeviation(MOVES, explorer);
  assert.ok(deviation);
  assert.equal(deviation.ply, 4);
  assert.equal(deviation.usual.uci, 'b10c8');
  assert.equal(deviation.games, 72);
  assert.ok(
    frames.some((f) => f.mirrored),
    'the fixture line reaches at least one mirrored key',
  );
});

test('the deviation comment lands on the deviating move', async () => {
  let calls = 0;
  const explorer: ExplorerLookup = async () => {
    calls += 1;
    if (calls === 1) return [{ move: 'h3e3', games: 50 }];
    return [
      { move: 'b10c8', games: 60 },
      { move: 'h10g8', games: 2 },
    ];
  };
  // Ply 2 (black's first move, h10g8) is what this explorer calls rare, so the
  // comment goes on ply 2 and the walk stops there.
  const chapter = await buildModelGameChapter(
    gameOf('b3', MOVES, '1-0'),
    judgeGame(UCI, EVALS),
    recipeOf(),
    explorer,
  );
  const line = mainline(chapter.root.root);
  assert.match(line[1]?.annotations?.comments?.[0]?.text ?? '', /Out of the usual line/);
  assert.match(line[1]?.annotations?.comments?.[0]?.text ?? '', /Hc8 was played 97%/);
});

test('a decisive-moment chapter opens on the move that led to it, then the engine line first', () => {
  const game = gameOf('b4', MOVES, '1-0');
  const chapter = buildDecisiveMomentChapter(game, judgeGame(UCI, EVALS));
  assert.ok(chapter);
  assert.equal(chapter.gamebook, true);
  assert.equal(chapter.orientation, 'black');
  // Rooted one ply early, with Red to move: the lesson auto-plays Red's actual
  // move on open, so the board shows it as the last move (a FEN has none).
  assert.ok(chapter.root.rootFen);
  assert.match(chapter.root.rootFen, / r /);
  assert.equal(chapter.name, 'Move 2, Black to play · Yin Sheng vs Yang Shizhe');
  const root = chapter.root.root;
  assert.equal(root.children.length, 1);
  assert.equal(root.annotations, undefined);
  const decisive = root.children[0];
  assert.equal(decisive?.uci, UCI[2]);
  assert.equal(decisive?.children.length, 2);
  assert.equal(decisive?.children[0]?.uci, 'b10c8');
  assert.equal(decisive?.children[0]?.children[0]?.uci, 'i1h1');
  assert.equal(decisive?.children[1]?.uci, 'i10h10');
  assert.deepEqual(decisive?.children[1]?.annotations?.glyphs, [4]);
  // The task, and nothing the game card already shows: provenance lives in the
  // chapter's tags, not in the intro. It rides the node the player lands on.
  const intro = decisive?.annotations?.comments?.[0]?.text ?? '';
  assert.match(
    intro,
    /^The game turned here\. Yang Shizhe played a move that gave up \d+ win% points\. Find the better one\.$/,
  );
  // The hint names the piece the engine moves (b10c8 is Black's horse).
  assert.equal(
    decisive?.annotations?.gamebook?.hint,
    'Look at your horse. One move keeps Black in the game.',
  );
  assert.equal(chapter.tags?.red, 'Yin Sheng');
  // One graded move and the reply, not the engine's whole line; the reply
  // carries the closing note the finished lesson shows.
  const reply = decisive?.children[0]?.children[0];
  assert.equal(reply?.children.length, 0);
  assert.match(reply?.annotations?.comments?.[0]?.text ?? '', /^Found it\. .* best reply\.$/);
});

test('a decisive-moment chapter is null when the loser has no open give-away', () => {
  const chapter = buildDecisiveMomentChapter(
    gameOf('b5', MOVES, '1-0'),
    judgeGame(UCI, evalsOf(new Array(11).fill(0))),
  );
  assert.equal(chapter, null);
});

test('legalLine truncates at the first refused move', () => {
  const state = createInitialXiangqiState('t');
  assert.deepEqual(
    legalLine(state, ['h3e3', 'h10g8', 'e3e10']).map((m) => `${m.from}${m.to}`),
    ['h3e3', 'h10g8'],
  );
  assert.equal(moveOf('zz'), null);
});
