import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ASSESSMENT_GLYPH } from '../apps/web/src/assessment-glyphs.ts';
import {
  annotateFromEngine,
  assessmentForRedScore,
  cpForRedScore,
  judgedMoves,
  moveGlyphFor,
  type StudyNode,
} from './study-annotate.ts';

describe('study-annotate', () => {
  it('reads an expected score through the win curve and the review bands', () => {
    // The bands the review's engine lines close on: 60 / 180 / 450 cp.
    const at = (cp: number): number => 1 / (1 + Math.exp(-0.00368208 * cp));
    assert.equal(Math.round(cpForRedScore(at(123))), 123);
    assert.equal(assessmentForRedScore(0.5).symbol, '=');
    assert.equal(assessmentForRedScore(at(59)).symbol, '=');
    assert.equal(assessmentForRedScore(at(61)).symbol, '⩲');
    assert.equal(assessmentForRedScore(at(181)).symbol, '±');
    assert.equal(assessmentForRedScore(at(451)).symbol, '+−');
    assert.equal(assessmentForRedScore(1 - at(61)).symbol, '⩱');
    assert.equal(assessmentForRedScore(1 - at(181)).symbol, '∓');
    assert.equal(assessmentForRedScore(0).symbol, '−+');
    // Thresholds as expected scores, as the docs state them.
    assert.equal((at(60) * 100).toFixed(1), '55.5');
    assert.equal((at(180) * 100).toFixed(1), '66.0');
    assert.equal((at(450) * 100).toFixed(1), '84.0');
    // Every symbol it can emit is one the study decodes.
    for (const score of [0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 1]) {
      const { symbol, nag } = assessmentForRedScore(score);
      assert.equal(ASSESSMENT_GLYPH[nag], symbol);
    }
  });

  it('grades a move on the site review cutoffs', () => {
    assert.equal(moveGlyphFor(0.5, 0.46), null);
    assert.equal(moveGlyphFor(0.5, 0.44), '?!');
    assert.equal(moveGlyphFor(0.5, 0.39), '?');
    assert.equal(moveGlyphFor(0.39, 0.08), '??');
  });

  it('builds the tree: move glyphs on the mainline, a verdict only at each line end', () => {
    // Red's move at ply 3 drops red from 60% to 20%, a move the engine did not choose.
    const input = {
      rootFen: 'root',
      moves: ['a1a2', 'b9b8', 'c1c2', 'd9d8'],
      redScore: [0.5, 0.6, 0.6, 0.2],
      best: ['a1a2', 'b9b8', 'e1e2', null],
      sidelines: [{ ply: 2, moves: ['e1e2', 'f9f8'], redScoreEnd: 0.62, comment: 'Engine line.' }],
      comments: { 1: 'Opening note.' },
      judgedComment: (m: { glyph: string }) => `${m.glyph} judged.`,
      intro: 'Intro.',
    };
    assert.deepEqual(
      judgedMoves(input).map((m) => [m.ply, m.glyph, m.mover]),
      [[3, '??', 'red']],
    );
    const tree = annotateFromEngine(input);
    const main: StudyNode[] = [];
    for (let n = tree.root.children[0]; n; n = n.children[0]!) main.push(n);
    assert.equal(tree.root.annotations?.comments?.[0]?.text, 'Intro.');
    // ply 1: a note and nothing else; a mainline move never carries a verdict.
    assert.equal(main[0]!.annotations?.glyphs, undefined);
    // ply 3: its move glyph alone, one joined comment.
    assert.deepEqual(main[2]!.annotations?.glyphs, [4]);
    assert.equal(main[2]!.annotations?.comments?.length, 1);
    // The sideline hangs off the position before ply 3, beside the played move,
    // with a green arrow on that position and a verdict on its last move.
    const parent = main[1]!;
    assert.equal(parent.children[1]!.uci, 'e1e2');
    assert.equal(parent.children[1]!.annotations?.comments?.[0]?.text, 'Engine line.');
    assert.deepEqual(parent.children[1]!.children[0]!.annotations?.glyphs, [14]);
    assert.deepEqual(parent.annotations?.shapes, [
      { kind: 'arrow', brush: 'green', orig: 'e1', dest: 'e2' },
    ]);
  });

  it("closes the KataGo post's lines with the verdict for the right side", () => {
    // KataGo's score is black's; the verdict is red's. Game 94's line for black
    // (KataGo red) leaves black at 40%, red at 60%: red slightly better, ⩲.
    const lines = JSON.parse(
      readFileSync(
        new URL('../apps/web/src/articles/content/katago-jungle-lines.json', import.meta.url),
        'utf8',
      ),
    ) as Array<{ game: number; ply: number; kataBlackEnd: number }>;
    const verdict = (game: number, ply: number): string =>
      assessmentForRedScore(1 - lines.find((l) => l.game === game && l.ply === ply)!.kataBlackEnd)
        .symbol;
    assert.equal(verdict(94, 99), '⩲');
    // Game 67 (KataGo black): lion b1-b2 holds red at 37%, black slightly better.
    assert.equal(verdict(67, 56), '⩱');
    // Wolf d2-e2 instead of taking the tiger: black winning either way.
    assert.equal(verdict(67, 68), '−+');
  });
});
