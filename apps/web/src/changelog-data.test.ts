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
});
