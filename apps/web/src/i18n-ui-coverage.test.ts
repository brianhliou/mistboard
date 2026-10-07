// The whole-surface gate for interface translations.
//
// The tenant live room (#427) was English from the first move to game over for
// every zh visitor, for weeks, with every suite green: the file had zero t()
// calls and nothing counted that. A render sweep finds English composed at
// runtime; this finds the other class, a visitor-facing file that was never
// wired to the catalog at all, which is cheap to catch from source.
//
// The signal is deliberately coarse: a file with three or more English UI
// phrases and no import of the i18n catalog or locale (and no zh dictionary of
// its own) fails. A file that IS localized but still leaks a string passes
// here; that class belongs to the render sweep (memory zh_fragment_sweep_recipe).
//
// The allowlist is today's debt, not a place to park new work. Every entry
// names why it is English. A tracked entry is removed by the fix that
// localizes it, and the stale-entry test below makes a fixed file leave the
// list in the same change, so the list only shrinks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

type Reason =
  | 'admin' // admin, ops, lab and dev-only surfaces; never shown to a visitor
  | 'content' // authored content or data with its own gate, or English by design
  | '#464'; // visitor-facing, not yet localized; tracked

const ALLOWED: Record<string, Reason> = {
  // admin / ops / labs
  'accounts-admin.ts': 'admin',
  'belief-panel.ts': 'admin',
  'database.ts': 'admin',
  'engine-profile.ts': 'admin',
  'engines.ts': 'admin',
  'readouts-admin.ts': 'admin',
  'replay-engine-panels.ts': 'admin',
  'sound-lab.ts': 'admin',
  'titles-admin.ts': 'admin',
  'xiangqi-broadcast-ops.ts': 'admin',
  // content with its own gate, or English by design
  'announcements.ts': 'content', // announcement-i18n.coverage.test.ts
  'anti-xiangqi-article-diagrams.ts': 'content', // generated step notes; article-i18n.coverage.test.ts
  'players/ecco-english.ts': 'content', // the English opening-name table itself
  'study-thumbnails.ts': 'content', // archive cover credits
  'videos-data.ts': 'content', // third-party video titles
  // visitor-facing debt
  'replay-board.ts': '#464',
  'replay-icons.ts': '#464',
  'review/move-tree.ts': '#464',
  'review/opening-explorer.ts': '#464',
  'review/xiangqi-gamebook.ts': '#464',
  'review/xiangqi-game-source.ts': '#464',
  'variant-mini-boards.ts': '#464',
  'xiangqi-import-page.ts': '#464',
};

// A capitalised English phrase of two or more words: 'Game aborted',
// 'Make your first move.', 'Copy invite'. Single words ('Resign') are left out
// on purpose; they collide with identifiers and enum values.
const PHRASE = /^[A-Z][a-z]+(?:[ ,'’-]+[A-Za-z][a-z'’]*)+[.!?…]?$/;
const LITERAL = /'([^'\\\n]{3,80})'|`([^`$\\\n]{3,80})`/g;
// Catalog-shaped copy tables ('learn.xiangqi.chariot.title': 'The chariot')
// are localized by key elsewhere.
const KEYED_VALUE = /^\s*'[a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+':/;
const LOCALIZED = /from '(?:\.\.\/)*(?:\.\/)?i18n\/(?:catalog|locale)\.js'|'zh-Han[st]'/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function englishPhrases(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(
      (line) =>
        !/^\s*(\/\/|import |export \* from)/.test(line) &&
        !/console\.|new Error\(|throw /.test(line) &&
        !KEYED_VALUE.test(line),
    )
    .join('\n');
  return [...code.matchAll(LITERAL)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((text) => PHRASE.test(text));
}

function unlocalizedFiles(): Map<string, string[]> {
  const flagged = new Map<string, string[]>();
  for (const path of sourceFiles(SRC)) {
    const rel = relative(SRC, path);
    if (/\.test\.ts$|\.d\.ts$|^i18n\/|^articles\/content\/|^article-i18n\.ts$/.test(rel)) continue;
    const source = readFileSync(path, 'utf8');
    if (LOCALIZED.test(source)) continue;
    const phrases = englishPhrases(source);
    if (phrases.length >= 3) flagged.set(rel, phrases);
  }
  return flagged;
}

describe('interface translation coverage', () => {
  const flagged = unlocalizedFiles();

  it('every visitor-facing file with English copy is wired to the i18n catalog', () => {
    const unexpected = [...flagged].filter(([rel]) => !(rel in ALLOWED));
    expect(
      unexpected.map(([rel]) => rel),
      `These files render English and never import the i18n catalog, so a zh visitor reads English:\n${unexpected
        .map(([rel, phrases]) => `  - ${rel}: ${phrases.slice(0, 3).join(' | ')}`)
        .join(
          '\n',
        )}\nRoute the strings through t() (apps/web/src/i18n/catalog.ts). Only an admin or lab surface belongs on the allowlist.`,
    ).toEqual([]);
  });

  it('the allowlist names only files that still need it', () => {
    const stale = Object.keys(ALLOWED).filter((rel) => !flagged.has(rel));
    expect(
      stale,
      'These allowlisted files are localized (or gone) now; remove them from ALLOWED so the list only shrinks.',
    ).toEqual([]);
  });
});
