// Flipping a xiangqi board is a 180 degree rotation: the file mirrors along with
// the rank. The shared xiangqiBoardPoint got that right on 2026-08-27, and three
// private copies of the point maths (the article replay, the video overlays, the
// dark-xiangqi fog) kept flipping the rank alone, so a1 stayed on the reader's
// left after "Flip the board". Every one of those copies was a perspective-
// conditioned rank flip written out by hand. This test keeps them from coming
// back: board code converts a rank to a display row through
// xiangqiDisplayRow / xiangqiBoardPoint (which flip the file too), and only the
// files below may spell the flip out.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const ROOTS = ['apps/web/src', 'packages/board-render/src', 'apps/server/src'];

/** `perspective === 'red' ? 10 - rank : …` and its spellings. */
const RANK_FLIP =
  /(perspective|orientation|flip\w*)( === '\w+')? \? [^:;]*\b(\d+|[A-Z_]*RANK[A-Z_]*|rankCount|ranks) - (rank|r|rankIdx|row)\b/;

/** Files allowed to write the flip out, and why. Each entry must still match:
 *  a stale entry would be a hole the next copy walks through. */
const ALLOWED: Record<string, string> = {
  'apps/web/src/xiangqi-board-geometry.ts': 'the shared helper itself',
  'apps/web/src/articles.ts': 'chess diagram; flips the file on the adjacent line',
  'apps/web/src/replay-board.ts': 'chess replay; flips the file on the adjacent line',
  'packages/board-render/src/board-svg.ts': 'chess board; flips the file on the adjacent line',
  'packages/board-render/src/interactive/board.ts':
    'chess board; flips the file on the adjacent line',
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|mts|mjs)$/.test(name) && !/\.test\.\w+$/.test(name)) out.push(path);
  }
  return out;
}

function offenders(): string[] {
  const hits: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(resolve(REPO, root))) {
      const rel = relative(REPO, file);
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (RANK_FLIP.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
  }
  return hits;
}

describe('board flip guard', () => {
  const hits = offenders();

  it('no board code flips the rank by hand outside the allowlist', () => {
    const outside = hits.filter((hit) => !(hit.split(':')[0]! in ALLOWED));
    expect(
      outside,
      'route the point through xiangqiBoardPoint / xiangqiDisplayRow, which rotate the file too',
    ).toEqual([]);
  });

  it('every allowlisted file still matches (no stale entries)', () => {
    const matched = new Set(hits.map((hit) => hit.split(':')[0]));
    expect(Object.keys(ALLOWED).filter((file) => !matched.has(file))).toEqual([]);
  });

  it('would have flagged the original replay bug', () => {
    expect(RANK_FLIP.test("  const row = perspective === 'red' ? 10 - rank : rank - 1;")).toBe(
      true,
    );
    expect(
      RANK_FLIP.test("  const displayRank = perspective === 'red' ? RANK_COUNT - rank : rank - 1;"),
    ).toBe(true);
  });
});
