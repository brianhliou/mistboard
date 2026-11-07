import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Every folder of art under public/piece-sets/ is credited in its CREDITS.md
// (#319): who made it and under what licence. A new set without a row fails
// here, and so does a row for a folder that no longer exists.

const ROOT = path.resolve(__dirname, '../../..');
const ART = path.join(ROOT, 'apps/web/public/piece-sets');
const CREDITS = path.join(ART, 'CREDITS.md');
const CHESS_CREDITS = path.join(ROOT, 'apps/web/public/pieces/CREDITS.md');

const IMAGE = /\.(png|svg|webp|jpe?g)$/;

function artFolders(rel = ''): string[] {
  const dir = path.join(ART, rel);
  const out: string[] = [];
  const names = readdirSync(dir);
  if (rel && names.some((n) => IMAGE.test(n))) out.push(rel);
  for (const name of names) {
    if (statSync(path.join(dir, name)).isDirectory()) {
      out.push(...artFolders(rel ? `${rel}/${name}` : name));
    }
  }
  return out.sort();
}

// The folder each table row credits: its first cell, a code span.
function creditedFolders(markdown: string): string[] {
  return [...markdown.matchAll(/^\| `([\w/-]+)\/?` \|/gm)].map((m) => m[1]!);
}

const covers = (credited: string, folder: string) =>
  folder === credited || folder.startsWith(`${credited}/`);

const uncreditedIn = (markdown: string) => {
  const credited = creditedFolders(markdown);
  return artFolders().filter((f) => !credited.some((c) => covers(c, f)));
};

describe('piece-sets CREDITS.md', () => {
  it('credits every art folder', () => {
    expect(existsSync(CREDITS), 'apps/web/public/piece-sets/CREDITS.md is missing').toBe(true);
    expect(uncreditedIn(readFileSync(CREDITS, 'utf8'))).toEqual([]);
  });

  // Planted failure: the same file with the Wood row removed must not pass,
  // and a row for a parent folder must not pass for a sibling that shares its
  // prefix (`xiangqi/international` does not cover `xiangqi/international-grid`).
  it('catches a dropped row', () => {
    const markdown = readFileSync(CREDITS, 'utf8');
    const noWood = markdown.replace(/^\| `xiangqi\/wood` \|.*\n/m, '');
    expect(uncreditedIn(noWood)).toEqual(['xiangqi/wood', 'xiangqi/wood/tile']);
    const noGrid = markdown.replace(/^\| `xiangqi\/international-grid` \|.*\n/m, '');
    expect(uncreditedIn(noGrid)).toEqual(['xiangqi/international-grid']);
  });

  it('has no row for a folder that is gone', () => {
    const credited = creditedFolders(readFileSync(CREDITS, 'utf8'));
    expect(credited.length).toBeGreaterThan(0);
    expect(credited.filter((c) => !existsSync(path.join(ART, c)))).toEqual([]);
  });

  it('a per-set README a row points to exists', () => {
    const markdown = readFileSync(CREDITS, 'utf8');
    const readmes = [...markdown.matchAll(/\]\(\.\/([\w/-]+\/README\.md)\)/g)].map((m) => m[1]!);
    expect(readmes.length).toBeGreaterThan(0);
    expect(readmes.filter((r) => !existsSync(path.join(ART, r)))).toEqual([]);
  });

  it('cross-links the chess credits, so neither reads as the whole picture', () => {
    expect(readFileSync(CREDITS, 'utf8')).toContain('../pieces/CREDITS.md');
    expect(readFileSync(CHESS_CREDITS, 'utf8')).toContain('../piece-sets/CREDITS.md');
  });
});
