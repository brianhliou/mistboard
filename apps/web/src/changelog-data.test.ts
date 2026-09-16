import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { changelogMonths, parseChangelog, parseInline } from './changelog-data.js';

const SAMPLE = `# Changelog

Preamble that must not become an entry.

- Not an entry either: no month yet.

## 2026-09

### Playing

- First line with a hash ([abc12345](https://github.com/x/y/commit/abc12345))
- Wrapped line that
  continues on the next line ([def67890](https://github.com/x/y/commit/def67890))

### Fixed

- Something \`code\` and **bold** ([0123abcd](https://github.com/x/y/commit/0123abcd))

## 2026-08

### Site

- Older month
`;

describe('parseChangelog', () => {
  it('keeps months in file order with their sections and entries', () => {
    const months = parseChangelog(SAMPLE);
    expect(months.map((month) => month.id)).toEqual(['2026-09', '2026-08']);
    const [sep] = months;
    expect(sep?.sections.map((section) => section.heading)).toEqual(['Playing', 'Fixed']);
    expect(sep?.sections[0]?.entries).toHaveLength(2);
    expect(months[1]?.sections[0]?.entries).toHaveLength(1);
  });

  it('ignores the preamble before the first month', () => {
    const months = parseChangelog(SAMPLE);
    const allEntries = months.flatMap((month) =>
      month.sections.flatMap((section) => section.entries),
    );
    expect(allEntries).toHaveLength(4);
  });

  it('joins a wrapped entry into one line', () => {
    const wrapped = parseChangelog(SAMPLE)[0]?.sections[0]?.entries[1];
    expect(wrapped?.parts[0]).toEqual({
      kind: 'text',
      text: 'Wrapped line that continues on the next line (',
    });
    expect(wrapped?.parts[1]).toEqual({
      kind: 'link',
      text: 'def67890',
      href: 'https://github.com/x/y/commit/def67890',
    });
  });
});

describe('parseInline', () => {
  it('splits code, strong and links out of plain text', () => {
    expect(
      parseInline('Something `code` and **bold** ([a](https://h/a), [b](https://h/b))'),
    ).toEqual([
      { kind: 'text', text: 'Something ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' and ' },
      { kind: 'strong', text: 'bold' },
      { kind: 'text', text: ' (' },
      { kind: 'link', text: 'a', href: 'https://h/a' },
      { kind: 'text', text: ', ' },
      { kind: 'link', text: 'b', href: 'https://h/b' },
      { kind: 'text', text: ')' },
    ]);
  });

  it('keeps markup inside a code span literal', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ kind: 'code', text: '**not bold**' }]);
  });
});

describe('the committed CHANGELOG.md', () => {
  it('parses to at least one month, every entry ending in a commit link', () => {
    const months = changelogMonths();
    expect(months.length).toBeGreaterThan(0);
    for (const month of months) {
      expect(month.id).toMatch(/^\d{4}-\d{2}$/);
      for (const section of month.sections) {
        expect(section.entries.length, `${month.id} / ${section.heading} is empty`).toBeGreaterThan(
          0,
        );
        for (const entry of section.entries) {
          const links = entry.parts.filter((part) => part.kind === 'link');
          expect(
            links.some((link) => /\/commit\/[0-9a-f]{7,40}$/.test(link.href)),
            `${month.id} / ${section.heading}: an entry has no commit link`,
          ).toBe(true);
        }
      }
    }
  });

  // The page renders whatever the file says and the parser is strict, so a
  // heading outside the set silently drops its entries from the page, and a
  // month out of order breaks "newest first". Both are the kind of slip a
  // human appending one line never notices. Lint them here rather than in a
  // pre-push nudge: this runs on every ci:quick already.
  it('keeps months newest first and headings from the fixed set, in order', () => {
    const months = changelogMonths();
    const ids = months.map((month) => month.id);
    expect(ids, 'months must be newest first').toEqual([...ids].sort().reverse());
    expect(new Set(ids).size, 'a month appears twice').toBe(ids.length);
    for (const month of months) {
      const headings = month.sections.map((section) => section.heading);
      for (const heading of headings) {
        expect(
          CHANGELOG_HEADINGS.includes(heading),
          `${month.id}: "${heading}" is not one of ${CHANGELOG_HEADINGS.join(', ')}`,
        ).toBe(true);
      }
      expect(new Set(headings).size, `${month.id}: a heading appears twice`).toBe(headings.length);
      const order = headings.map((heading) => CHANGELOG_HEADINGS.indexOf(heading));
      expect(order, `${month.id}: headings are out of order`).toEqual(
        [...order].sort((a, b) => a - b),
      );
    }
  });

  // A dead commit link on a public page is the other slip nobody sees. The
  // check needs history, so it is skipped in a shallow clone (hosted CI's
  // default checkout); locally and in the pre-push ci:quick the tree is full.
  it('links commits that exist in this repository', () => {
    const shallow = git('rev-parse', '--is-shallow-repository') === 'true';
    if (shallow) return;
    const hashes = new Set<string>();
    for (const month of changelogMonths()) {
      for (const section of month.sections) {
        for (const entry of section.entries) {
          for (const part of entry.parts) {
            if (part.kind !== 'link') continue;
            const hash = /\/commit\/([0-9a-f]{7,40})$/.exec(part.href)?.[1];
            if (hash) hashes.add(hash);
          }
        }
      }
    }
    const missing = [...hashes].filter((hash) => {
      try {
        execFileSync('git', ['cat-file', '-e', `${hash}^{commit}`], { stdio: 'ignore' });
        return false;
      } catch {
        return true;
      }
    });
    expect(missing, 'changelog links commits that do not exist').toEqual([]);
  });
});

// The heading set and order from the file's own conventions block.
const CHANGELOG_HEADINGS = [
  'Playing',
  'Learning and puzzles',
  'Watching and review',
  'Community',
  'Site',
  'Removed',
  'Fixed',
  'Technical',
];

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trim();
}
