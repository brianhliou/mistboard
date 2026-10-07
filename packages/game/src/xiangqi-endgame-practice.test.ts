import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStandardXiangqiLegalMoves,
  parsePracticeGoal,
  parseStandardXiangqiFen,
  XIANGQI_ENDGAME_HUB,
  xiangqiEndgamePracticeSets,
} from './index.js';

// The sets are what the seeder writes into the five shelf studies, so every
// chapter must open: a FEN the board accepts with a move to make, a goal the
// practice runner parses, and the side with something to prove in front.

const sets = xiangqiEndgamePracticeSets();
const chapters = sets.flatMap((set) => set.chapters);
const board = (fen: string) => fen.split(' ')[0];

test('every article position is on the shelf once, and no board appears twice', () => {
  const ids = chapters.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'a position is in two sets');
  const boards = chapters.map((c) => board(c.fen));
  assert.equal(new Set(boards).size, boards.length, 'two chapters share a board');
  for (const row of XIANGQI_ENDGAME_HUB) {
    assert.ok(ids.includes(row.id), `${row.id} is on the article but in no set`);
  }
});

test('the five sets hold the 32 seeded positions plus the 14 folded in', () => {
  assert.deepEqual(
    sets.map((set) => [set.slug, set.chapters.length]),
    [
      ['endgames-soldier', 16],
      ['endgames-chariot', 14],
      ['endgames-horse', 7],
      ['endgames-cannon', 6],
      ['endgames-insufficient', 3],
    ],
  );
});

test('every chapter has a legal root and a goal the runner parses', () => {
  for (const chapter of chapters) {
    const parsed = parseStandardXiangqiFen(chapter.fen);
    assert.ok(parsed.ok, `${chapter.id}: ${parsed.ok ? '' : parsed.error}`);
    assert.equal(parsed.state.status.type, 'playing', chapter.id);
    assert.ok(getStandardXiangqiLegalMoves(parsed.state).length > 0, chapter.id);

    const goal = parsePracticeGoal(chapter.goal);
    assert.ok(goal, `${chapter.id}: goal "${chapter.goal}" does not parse`);
    if (chapter.entry.verdict === 'draw') {
      assert.equal(goal.kind, 'draw', chapter.id);
      assert.equal(goal.moves, 15, chapter.id);
      assert.equal(chapter.orientation, 'black', chapter.id);
    } else {
      assert.equal(goal.kind, 'mate', chapter.id);
      assert.equal(chapter.orientation, 'red', chapter.id);
    }
  }
});

test("an article row's goal agrees with its grade", () => {
  for (const row of XIANGQI_ENDGAME_HUB) {
    const chapter = chapters.find((c) => c.id === row.id);
    assert.equal(chapter?.goal === 'mate', row.grade !== 'standard-draw', row.id);
  }
});

test('in each set the wins come first, easiest first, then the draws', () => {
  for (const set of sets) {
    const goals = set.chapters.map((c) => c.goal);
    const firstDraw = goals.findIndex((g) => g !== 'mate');
    const wins = firstDraw === -1 ? set.chapters : set.chapters.slice(0, firstDraw);
    if (firstDraw !== -1) {
      assert.ok(
        goals.slice(firstDraw).every((g) => g !== 'mate'),
        `${set.slug}: a win after a draw`,
      );
    }
    for (let i = 1; i < wins.length; i += 1) {
      const before = wins[i - 1];
      const after = wins[i];
      assert.ok(before && after && before.distance <= after.distance, `${set.slug}: out of order`);
    }
  }
  assert.equal(sets[1]?.chapters[0]?.id, 'chariot-cannon-vs-chariot-center');
});

test('a written brief is filled in every script', () => {
  for (const chapter of chapters) {
    if (!chapter.brief) continue;
    for (const lang of ['en', 'zh-Hans', 'zh-Hant'] as const) {
      assert.ok(chapter.brief[lang].trim(), `${chapter.id} ${lang} brief`);
    }
  }
});
