import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getStandardXiangqiLegalMoves,
  parsePracticeGoal,
  parseStandardXiangqiFen,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_PRACTICE_SET,
  xiangqiEndgamePracticeChapters,
} from './index.js';

// The practice set is what the seeder writes into a study, so every chapter must
// open: a FEN the board accepts with Red to move and a move to make, a goal the
// practice runner parses, and the side with something to prove in front.

const chapters = xiangqiEndgamePracticeChapters();

test('the set holds every graded hub position exactly once', () => {
  assert.equal(chapters.length, 26);
  assert.deepEqual(
    [...chapters.map((c) => c.id)].sort(),
    [...XIANGQI_ENDGAME_HUB.map((row) => row.id)].sort(),
  );
});

test('every chapter has a legal Red-to-move root and a goal the runner parses', () => {
  for (const chapter of chapters) {
    const parsed = parseStandardXiangqiFen(chapter.fen);
    assert.ok(parsed.ok, `${chapter.id}: ${parsed.ok ? '' : parsed.error}`);
    assert.deepEqual(parsed.state.status, { type: 'playing', turn: 'red' }, chapter.id);
    assert.ok(getStandardXiangqiLegalMoves(parsed.state).length > 0, chapter.id);

    const goal = parsePracticeGoal(chapter.goal);
    assert.ok(goal, `${chapter.id}: goal "${chapter.goal}" does not parse`);
    if (chapter.grade === 'standard-draw') {
      assert.equal(goal.kind, 'draw', chapter.id);
      assert.equal(goal.moves, 15, chapter.id);
      assert.equal(chapter.orientation, 'black', chapter.id);
    } else {
      assert.equal(goal.kind, 'mate', chapter.id);
      assert.equal(chapter.orientation, 'red', chapter.id);
    }
  }
});

test('wins come first, standard before tricky, then the draws', () => {
  const grades = chapters.map((c) => c.grade);
  const firstTricky = grades.indexOf('tricky-win');
  const firstDraw = grades.indexOf('standard-draw');
  assert.ok(firstTricky > 0 && firstDraw > firstTricky);
  assert.ok(grades.slice(0, firstTricky).every((g) => g === 'standard-win'));
  assert.ok(grades.slice(firstTricky, firstDraw).every((g) => g === 'tricky-win'));
  assert.ok(grades.slice(firstDraw).every((g) => g === 'standard-draw'));
  assert.equal(chapters[0]?.id, 'chariot-cannon-vs-chariot-center');
});

test('chapter names are unique in every script, and every string is translated', () => {
  for (const lang of ['en', 'zh-Hans', 'zh-Hant'] as const) {
    const names = chapters.map((c) => c.name[lang]);
    assert.equal(new Set(names).size, names.length, `${lang} chapter names collide`);
    for (const chapter of chapters) {
      assert.ok(chapter.name[lang].trim(), `${chapter.id} ${lang} name`);
      assert.ok(chapter.brief[lang].trim(), `${chapter.id} ${lang} brief`);
    }
    assert.ok(XIANGQI_ENDGAME_PRACTICE_SET.name[lang].trim());
    assert.ok(XIANGQI_ENDGAME_PRACTICE_SET.description[lang].trim());
  }
});
