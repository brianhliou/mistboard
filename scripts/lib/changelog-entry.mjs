// Insert release lines into CHANGELOG.md, the shape the file's own
// conventions block and apps/web/src/changelog-data.test.ts define: months as
// `## YYYY-MM`, newest first; within a month only the fixed headings, in their
// fixed order; one `- line` per change ending in the landed commit's link.
//
// release-prod.mjs --changelog uses this so the line ships in the same release
// as the change it describes. Until 2026-09-30 it was a second commit pushed as
// a second release, which Railway skipped (CHANGELOG.md matches no watch
// pattern) and which still cost a CI run and a release slot.

export const CHANGELOG_HEADINGS = [
  'Playing',
  'Learning and puzzles',
  'Watching and review',
  'Community',
  'Site',
  'Removed',
  'Fixed',
  'Technical',
];

export const COMMIT_URL_BASE = 'https://github.com/brianhliou/mistboard/commit/';

const MONTH_LINE = /^## (\d{4}-\d{2})\s*$/;
const HEADING_LINE = /^### (.+?)\s*$/;

/**
 * Parse one --changelog value, "<Heading>: <line text>". The heading is
 * matched case-insensitively against the fixed set and returned canonical.
 */
export function parseChangelogArg(raw) {
  const value = String(raw ?? '').trim();
  const colon = value.indexOf(':');
  if (colon === -1) {
    throw new Error(
      `--changelog expects "<Heading>: <line>", got ${JSON.stringify(value)}; headings: ${CHANGELOG_HEADINGS.join(', ')}`,
    );
  }
  const given = value.slice(0, colon).trim();
  const heading = CHANGELOG_HEADINGS.find((name) => name.toLowerCase() === given.toLowerCase());
  if (!heading) {
    throw new Error(
      `--changelog heading ${JSON.stringify(given)} is not one of: ${CHANGELOG_HEADINGS.join(', ')}`,
    );
  }
  const text = value.slice(colon + 1).trim();
  validateLineText(text);
  return { heading, text };
}

export function validateLineText(text) {
  if (!text) throw new Error('--changelog line is empty');
  if (/[\r\n]/.test(text)) throw new Error('--changelog line must be one line');
  if (text.includes('—')) {
    throw new Error(`--changelog line contains an em dash (site copy uses none): ${text}`);
  }
  if (text.startsWith('- ')) throw new Error('--changelog line: leave out the leading "- "');
  if (/\.$/.test(text)) throw new Error('--changelog line: no trailing period (file convention)');
  if (/\/commit\/[0-9a-f]{7,40}\)\)?$/.test(text)) {
    throw new Error('--changelog line: leave out the commit link; the release appends it');
  }
}

export function commitLink(shortHash) {
  return `([${shortHash}](${COMMIT_URL_BASE}${shortHash}))`;
}

export function currentMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Return `source` with each entry inserted under `month` and its heading,
 * creating the month (in newest-first position) and the heading (in canonical
 * order) when missing. New lines go at the top of their section, in the order
 * given. Throws when the existing file breaks the order it relies on.
 */
export function insertChangelogEntries(source, { month, entries, shortHash }) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`bad month ${month}`);
  if (!/^[0-9a-f]{7,40}$/.test(shortHash)) throw new Error(`bad commit hash ${shortHash}`);
  const lines = source.split('\n');
  const groups = new Map();
  for (const entry of entries) {
    if (!CHANGELOG_HEADINGS.includes(entry.heading)) {
      throw new Error(`unknown changelog heading ${entry.heading}`);
    }
    validateLineText(entry.text);
    if (!groups.has(entry.heading)) groups.set(entry.heading, []);
    groups.get(entry.heading).push(`- ${entry.text} ${commitLink(shortHash)}`);
  }

  let monthStart = ensureMonth(lines, month);
  for (const [heading, bullets] of groups) {
    monthStart = lines.findIndex((line) => MONTH_LINE.exec(line)?.[1] === month);
    const monthEnd = nextMonthIndex(lines, monthStart + 1);
    const headingIndex = findHeading(lines, monthStart, monthEnd, heading);
    if (headingIndex !== -1) {
      let at = headingIndex + 1;
      while (at < monthEnd && lines[at].trim() === '') at += 1;
      // `at` is the first entry; when the section is empty, write after one blank.
      if (at >= monthEnd || HEADING_LINE.test(lines[at]) || MONTH_LINE.test(lines[at])) {
        lines.splice(headingIndex + 1, at - headingIndex - 1, '', ...bullets, '');
      } else {
        lines.splice(at, 0, ...bullets);
      }
      continue;
    }
    const rank = CHANGELOG_HEADINGS.indexOf(heading);
    let before = monthEnd;
    for (let index = monthStart + 1; index < monthEnd; index += 1) {
      const name = HEADING_LINE.exec(lines[index])?.[1];
      if (name !== undefined && CHANGELOG_HEADINGS.indexOf(name) > rank) {
        before = index;
        break;
      }
    }
    if (before === monthEnd) {
      // Append at the end of the month: back up over trailing blank lines.
      let end = monthEnd;
      while (end > monthStart + 1 && lines[end - 1].trim() === '') end -= 1;
      lines.splice(end, monthEnd - end, '', `### ${heading}`, '', ...bullets, '');
    } else {
      lines.splice(before, 0, `### ${heading}`, '', ...bullets, '');
    }
  }
  return normalizeTrailingNewline(lines.join('\n'), source);
}

function ensureMonth(lines, month) {
  const existing = lines.findIndex((line) => MONTH_LINE.exec(line)?.[1] === month);
  if (existing !== -1) return existing;
  // Months are newest first: the new one goes above the first older month.
  const older = lines.findIndex((line) => {
    const id = MONTH_LINE.exec(line)?.[1];
    return id !== undefined && id < month;
  });
  if (older !== -1) {
    lines.splice(older, 0, `## ${month}`, '');
    return older;
  }
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end -= 1;
  lines.splice(end, lines.length - end, '', `## ${month}`, '');
  return end + 1;
}

function nextMonthIndex(lines, from) {
  for (let index = from; index < lines.length; index += 1) {
    if (MONTH_LINE.test(lines[index])) return index;
  }
  return lines.length;
}

function findHeading(lines, monthStart, monthEnd, heading) {
  for (let index = monthStart + 1; index < monthEnd; index += 1) {
    if (HEADING_LINE.exec(lines[index])?.[1] === heading) return index;
  }
  return -1;
}

function normalizeTrailingNewline(output, source) {
  const trimmed = output.replace(/\n+$/, '');
  return source.endsWith('\n') ? `${trimmed}\n` : trimmed;
}

/** The unified-ish preview a dry run prints: the inserted lines with context. */
export function previewInsertion(before, after) {
  const a = before.split('\n');
  const b = after.split('\n');
  const out = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    // Lines are only ever inserted, never changed or removed.
    const contextStart = Math.max(0, j - 2);
    const block = [];
    for (let k = contextStart; k < j; k += 1) block.push(`  ${b[k]}`);
    while (j < b.length && (i >= a.length || a[i] !== b[j])) {
      block.push(`+ ${b[j]}`);
      j += 1;
    }
    for (let k = j; k < Math.min(b.length, j + 1); k += 1) block.push(`  ${b[k]}`);
    out.push(block.join('\n'));
  }
  return out.join('\n...\n');
}
