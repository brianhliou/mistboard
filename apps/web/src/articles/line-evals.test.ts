import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { articles } from '../articles-data.js';

// Every engine sideline gets an assessment symbol at its end, measured by
// scripts/article-line-evals.mjs and baked into the article source.
//
// Two failure modes, both silent, both seen while building this:
//
//   1. A new annotated article ships with no assessments at all, because the
//      script is a manual step and nobody remembers a step. The first test makes
//      that a build failure instead of a thing you notice in a screenshot.
//   2. Assessments land against the WRONG game. The specs are top-level consts
//      whose file order is not the order sections reference them in, so a bake
//      that counts occurrences puts symbols on the wrong boards. Nothing looks
//      broken. The second test compares what is baked against what was measured.
const measuredPath = ['scripts/data/article-line-evals.json', '../../scripts/data/article-line-evals.json']
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

type Annotation = { line?: string; lineEval?: string; note?: string };
type Board = { spec: { iccs: string; annotations?: { byPly: Record<string, Annotation> } } };

const annotated = articles
  .map((article) => ({
    slug: article.slug,
    // Intro boards first, then sections: the order the page renders and the
    // order the script indexes.
    boards: [...(article.intro ?? []), ...(article.sections ?? []).flatMap((s) => s.blocks ?? [])]
      .flatMap((block) => (block?.kind === 'xq-replay' ? [block as unknown as Board] : [])),
  }))
  .filter(({ boards }) =>
    boards.some((b) => Object.values(b.spec.annotations?.byPly ?? {}).some((a) => a.line)),
  );

describe('sideline assessments', () => {
  it('exist for every article that has engine lines', () => {
    expect(annotated.length, 'no annotated article found at all').toBeGreaterThan(0);
    const missing: string[] = [];
    for (const { slug, boards } of annotated) {
      boards.forEach((board, index) => {
        for (const [ply, a] of Object.entries(board.spec.annotations?.byPly ?? {})) {
          if (a.line && !a.lineEval) missing.push(`${slug} board ${index} ply ${ply}`);
        }
      });
    }
    expect(
      missing,
      `lines with no assessment (run: node scripts/article-line-evals.mjs --write):\n${missing.slice(0, 12).join('\n')}`,
    ).toEqual([]);
  });

  it('match the measurement they were baked from', () => {
    expect(measuredPath, 'the measurement file is gone').toBeTruthy();
    const measured = JSON.parse(readFileSync(measuredPath as string, 'utf8')) as Record<
      string,
      { symbol: string | null }
    >;
    const wrong: string[] = [];
    let compared = 0;
    for (const { slug, boards } of annotated) {
      boards.forEach((board, index) => {
        for (const [ply, a] of Object.entries(board.spec.annotations?.byPly ?? {})) {
          if (!a.lineEval) continue;
          compared += 1;
          const key = `${slug}:${index}:${ply}`;
          if (measured[key]?.symbol !== a.lineEval) {
            wrong.push(`${key}: baked ${a.lineEval}, measured ${measured[key]?.symbol ?? 'nothing'}`);
          }
        }
      });
    }
    expect(wrong, `assessments on the wrong line:\n${wrong.slice(0, 10).join('\n')}`).toEqual([]);
    expect(compared, 'nothing was compared').toBeGreaterThan(100);
  });

  // The check that matters, and the one that was missing while the symbols were
  // measured in the wrong place.
  //
  // A sideline exists because the move actually played gave something up, so the
  // line is the better alternative BY CONSTRUCTION. Its score therefore cannot be
  // worse for the side that plays it than the score after the move they chose.
  // Best play is not worse than the move you played.
  //
  // The first version of article-line-evals.mjs searched the position at the END
  // of the stored line instead of the position the line starts from. A principal
  // variation's tail is the least verified part of a search, so lines routinely
  // ended on a move the engine would never play, and the score after it described
  // a position the line never reaches. Under that measurement 16 of these 168
  // lines came out worse for the mover than the move they replaced, one by 191cp
  // — including a line offered to Black that was labelled `+−`, Red winning.
  // Measuring the root drops that to zero above the tolerance.
  //
  // The tolerance absorbs the fact that the two numbers come from different
  // engine runs: `note` is written by the annotation sweep and `cp` by the
  // line-eval script, at different budgets and with threads, so they disagree by
  // a few tens of centipawns on the same position. It is nowhere near wide enough
  // to hide the class of bug above.
  it('never score a line worse for the mover than the move it replaces', () => {
    const TOLERANCE_CP = 75;
    expect(measuredPath, 'the measurement file is gone').toBeTruthy();
    const measured = JSON.parse(readFileSync(measuredPath as string, 'utf8')) as Record<
      string,
      { cp: number | null }
    >;
    const impossible: string[] = [];
    let compared = 0;
    for (const { slug, boards } of annotated) {
      boards.forEach((board, index) => {
        for (const [ply, a] of Object.entries(board.spec.annotations?.byPly ?? {})) {
          if (!a.line || !a.note) continue;
          const evalAfter = /eval ([+-]?[\d.]+) after/.exec(a.note);
          if (!evalAfter) continue;
          const line = measured[`${slug}:${index}:${ply}`]?.cp;
          if (line == null) continue;
          compared += 1;
          const played = Number(evalAfter[1]) * 100;
          // Both numbers are Red POV, so "better for the mover" flips with turn.
          const redToMove = Number(ply) % 2 === 1;
          const worseBy = redToMove ? played - line : line - played;
          if (worseBy > TOLERANCE_CP) {
            impossible.push(
              `${slug} board ${index} ply ${ply}: line ${line}cp, played ${played}cp, worse by ${Math.round(worseBy)}cp`,
            );
          }
        }
      });
    }
    expect(
      impossible,
      `lines scored worse than the move they replace:\n${impossible.slice(0, 10).join('\n')}`,
    ).toEqual([]);
    expect(compared, 'nothing was compared').toBeGreaterThan(100);
  });

  // The literature's glyphs, not ASCII stand-ins for them, and the same strings
  // advantageSymbol() emits so an engine line and an annotated one agree. Note
  // the decisive pair uses MINUS SIGN (U+2212), not a hyphen.
  it('only use symbols a reader of chess literature knows', () => {
    const allowed = new Set(['+−', '±', '⩲', '=', '⩱', '∓', '−+']);
    const odd = new Set<string>();
    for (const { boards } of annotated) {
      for (const board of boards) {
        for (const a of Object.values(board.spec.annotations?.byPly ?? {})) {
          if (a.lineEval && !allowed.has(a.lineEval)) odd.add(a.lineEval);
        }
      }
    }
    expect([...odd]).toEqual([]);
  });
});
