import { expect, test } from 'vitest';
import { chapterAnnotations } from './study-chapter-annotations.js';
import { type StudyChapterPayload, studyChapterToReplaySpec } from './study-chapter-spec.js';

const chapter: StudyChapterPayload = {
  id: 'tree',
  root: {
    root: {
      children: [
        { uci: 'h3e3' },
        {
          uci: 'b1c3',
          annotations: { comments: [{ text: 'Develop the horse' }] },
          children: [
            { uci: 'h10g8', annotations: { glyphs: [16] } },
            {
              uci: 'b10c8',
              children: [
                { uci: 'h3e3', annotations: { glyphs: [10] } },
                { uci: 'h1g3' }, // Fourth level must be omitted.
              ],
            },
          ],
        },
        { uci: 'h1g3' },
      ],
    },
  },
};

test('keeps every sibling and reply with 1-based replacement plies, capped at three levels', () => {
  const result = chapterAnnotations(chapter);
  expect(result.branches?.[1]).toEqual([
    {
      moves: ['b1c3', 'h10g8'],
      verdict: '±',
      note: 'Develop the horse',
      replies: { 2: [{ moves: ['b10c8', 'h3e3'], verdict: '=' }] },
    },
    { moves: ['h1g3'] },
  ]);
  expect(studyChapterToReplaySpec(chapter)?.annotations?.byPly[1]?.branches).toEqual([
    {
      line: 'b0c2 h9g7',
      lineEval: '±',
      note: 'Develop the horse',
      replies: { 2: [{ line: 'b9c7 h2e2', lineEval: '=' }] },
    },
    { line: 'h0g2' },
  ]);
});

test('one sideline retains the exact legacy shared and xiangqi output', () => {
  const single: StudyChapterPayload = {
    id: 'single',
    root: {
      root: {
        children: [
          { uci: 'h3e3' },
          {
            uci: 'b1c3',
            annotations: { comments: [{ text: 'Horse' }] },
            children: [{ uci: 'h10g8', annotations: { glyphs: [16] } }],
          },
        ],
      },
    },
  };
  expect(chapterAnnotations(single)).toEqual({
    moves: ['h3e3'],
    glyphs: {},
    notes: {},
    assessments: {},
    shapes: {},
    lines: { 1: { moves: ['b1c3', 'h10g8'], verdict: '±', note: 'Horse' } },
  });
  expect(studyChapterToReplaySpec(single)?.annotations?.byPly).toEqual({
    1: { line: 'b0c2 h9g7', lineEval: '±', lineNote: 'Horse' },
  });
});
