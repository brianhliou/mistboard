// The root CHANGELOG.md, parsed for the /changelog page. The file is the
// record (one line per behaviour change, month by month, hash-linked); this
// module only reads it. Vite inlines it at build time, so the page is exactly
// the file at the release that served it and there is nothing to fetch.
//
// The parser covers the file's own conventions and nothing more: `## YYYY-MM`
// months, `### Heading` groups, `- ` entries, and inline links, code and bold
// inside an entry. It is not a markdown renderer; a construct the conventions
// do not use is kept as plain text rather than guessed at.
import changelogSource from '../../../CHANGELOG.md?raw';

export type ChangelogInline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'link'; text: string; href: string };

export type ChangelogEntry = {
  parts: ChangelogInline[];
};

export type ChangelogSection = {
  heading: string;
  entries: ChangelogEntry[];
};

export type ChangelogMonth = {
  /** `YYYY-MM`, also the anchor id on the page. */
  id: string;
  sections: ChangelogSection[];
};

const MONTH_HEADING = /^## (\d{4}-\d{2})\s*$/;
const SECTION_HEADING = /^### (.+?)\s*$/;
const ENTRY_LINE = /^- (.+)$/;

export function parseChangelog(source: string): ChangelogMonth[] {
  const months: ChangelogMonth[] = [];
  let month: ChangelogMonth | null = null;
  let section: ChangelogSection | null = null;
  let entry: ChangelogEntry | null = null;
  let entryText = '';

  const flushEntry = (): void => {
    if (entry && section) {
      entry.parts = parseInline(entryText.trim());
      section.entries.push(entry);
    }
    entry = null;
    entryText = '';
  };

  for (const rawLine of source.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const monthMatch = MONTH_HEADING.exec(line);
    if (monthMatch) {
      flushEntry();
      month = { id: monthMatch[1] as string, sections: [] };
      months.push(month);
      section = null;
      continue;
    }
    // Everything before the first month (title, conventions) is the file's
    // preamble, not part of the record.
    if (!month) continue;
    const sectionMatch = SECTION_HEADING.exec(line);
    if (sectionMatch) {
      flushEntry();
      section = { heading: sectionMatch[1] as string, entries: [] };
      month.sections.push(section);
      continue;
    }
    if (!section) continue;
    const entryMatch = ENTRY_LINE.exec(line);
    if (entryMatch) {
      flushEntry();
      entry = { parts: [] };
      entryText = entryMatch[1] as string;
      continue;
    }
    // A wrapped continuation of the current entry (indented, non-empty).
    if (entry && /^\s+\S/.test(line)) {
      entryText += ` ${line.trim()}`;
      continue;
    }
    flushEntry();
  }
  flushEntry();
  return months;
}

// Inline grammar, left to right: `code`, **strong**, [text](href). Code wins
// inside itself (a backtick span is literal), so `**` inside code stays text.
const INLINE_TOKEN = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g;

export function parseInline(text: string): ChangelogInline[] {
  const parts: ChangelogInline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) });
    const token = match[0];
    if (match[1]) {
      parts.push({ kind: 'code', text: token.slice(1, -1) });
    } else if (match[2]) {
      parts.push({ kind: 'strong', text: token.slice(2, -2) });
    } else {
      const close = token.indexOf('](');
      parts.push({
        kind: 'link',
        text: token.slice(1, close),
        href: token.slice(close + 2, -1),
      });
    }
    last = index + token.length;
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) });
  return parts;
}

let cached: ChangelogMonth[] | null = null;

/** The changelog as shipped in this build, newest month first (file order). */
export function changelogMonths(): ChangelogMonth[] {
  if (!cached) cached = parseChangelog(changelogSource);
  return cached;
}
