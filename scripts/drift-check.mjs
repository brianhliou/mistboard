#!/usr/bin/env node
// Narrow drift checks for docs, SQL enum constraints, and live fog payload guards.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const checks = [
  { name: 'docs', run: checkDocs, severity: 'error' },
  { name: 'sql-enums', run: checkSqlEnums, severity: 'error' },
  { name: 'payload-redaction', run: checkPayloadRedaction, severity: 'error' },
  // INDEX coverage is a WARNING, not a push blocker: a missing entry (often a
  // file from another session) must never block an unrelated push. Run
  // `npm run index:fix` (or `--fix`) to append stub rows and keep the map honest.
  { name: 'index', run: checkIndex, severity: 'warn' },
];

const selected = options.only ? checks.filter((check) => check.name === options.only) : checks;
if (selected.length === 0) throw new Error(`unknown check: ${options.only}`);

if (options.fix) {
  const added = fixIndex();
  if (added.length > 0) {
    console.log(
      `index:fix appended ${added.length} stub entr${added.length === 1 ? 'y' : 'ies'} to INDEX.md (add real descriptions):`,
    );
    for (const file of added) console.log(`  + ${file}`);
  } else {
    console.log('index:fix: INDEX.md already covers every source file');
  }
}

const results = selected.map((check) => ({
  name: check.name,
  severity: check.severity,
  issues: check.run(),
}));
const errorCount = results
  .filter((result) => result.severity !== 'warn')
  .reduce((sum, result) => sum + result.issues.length, 0);

if (options.json) {
  console.log(JSON.stringify({ ok: errorCount === 0, results }, null, 2));
} else {
  for (const result of results) {
    if (result.issues.length === 0) {
      console.log(`${result.name}: ok`);
      continue;
    }
    const noun = result.severity === 'warn' ? 'warning' : 'issue';
    const suffix = result.severity === 'warn' ? ' (non-blocking)' : '';
    console.log(`${result.name}: ${result.issues.length} ${noun}(s)${suffix}`);
    for (const issue of result.issues) console.log(`  - ${issue}`);
    if (result.name === 'index') {
      console.log('  → run `npm run index:fix` to append stub entries');
    }
  }
}

process.exit(errorCount === 0 ? 0 : 1);

function parseArgs(args) {
  const parsed = { help: false, json: false, only: null, fix: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--fix') parsed.fix = true;
    else if (arg === '--only') parsed.only = requiredValue(args, ++index, arg);
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function checkDocs() {
  const issues = [];
  for (const file of publicMarkdownFiles()) {
    const text = stripHtmlComments(stripFencedBlocks(readFile(file)));
    for (const link of markdownLinks(text)) {
      const target = normalizeLinkTarget(link.raw);
      if (!target || shouldIgnoreLink(target)) continue;

      const cleanTarget = target.split(/[?#]/, 1)[0];
      const normalizedRepoTarget = path.posix.normalize(
        path.posix.join(path.posix.dirname(file), cleanTarget),
      );

      if (target.includes('docs-private/') || normalizedRepoTarget.startsWith('docs-private/')) {
        issues.push(`${file} links to private notes: ${target}`);
        continue;
      }

      const resolved = path.resolve(path.dirname(file), cleanTarget);
      if (!isInsideRepo(resolved)) {
        issues.push(`${file} link escapes repo root: ${target}`);
        continue;
      }
      if (!pathExistsWithMarkdownFallback(resolved)) {
        issues.push(`${file} has missing link target: ${target}`);
      }
    }
  }
  return issues;
}

function publicMarkdownFiles() {
  return gitLines(['ls-files', '*.md', 'docs/**/*.md'])
    .filter((file) => file.endsWith('.md'))
    .filter((file) => file.startsWith('docs/') || !file.includes('/'))
    .filter((file) => !file.startsWith('docs-private/'));
}

function stripFencedBlocks(text) {
  return text.replace(/^```[\s\S]*?^```/gm, '');
}

function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, '');
}

function markdownLinks(text) {
  const links = [];
  const pattern = /!?\[[^\]\n]*\]\(([^)\n]+)\)/g;
  let match = pattern.exec(text);
  while (match) {
    links.push({ raw: match[1] });
    match = pattern.exec(text);
  }
  return links;
}

function normalizeLinkTarget(raw) {
  let target = raw.trim();
  if (!target) return null;
  if (target.startsWith('<')) {
    const end = target.indexOf('>');
    if (end === -1) return target.slice(1);
    return target.slice(1, end).trim();
  }
  target = target.split(/\s+/)[0];
  return target.replace(/^['"]|['"]$/g, '');
}

function shouldIgnoreLink(target) {
  return (
    target.startsWith('#') ||
    target.startsWith('/') ||
    target.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(target)
  );
}

function isInsideRepo(absolutePath) {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathExistsWithMarkdownFallback(absolutePath) {
  if (existsSync(absolutePath)) return true;
  if (!path.extname(absolutePath) && existsSync(`${absolutePath}.md`)) return true;
  if (existsSync(path.join(absolutePath, 'README.md'))) return true;
  if (existsSync(path.join(absolutePath, 'INDEX.md'))) return true;
  return false;
}

function checkSqlEnums() {
  const constraints = latestNamedConstraints();
  const comparisons = [
    {
      label: 'games.mode',
      constraint: 'games_mode_check',
      file: 'apps/server/src/persistence-game-lifecycle.ts',
      type: 'GameMode',
    },
    {
      label: 'games.result',
      constraint: 'games_result_check',
      file: 'apps/server/src/persistence-games.ts',
      type: 'GameResult',
    },
    {
      label: 'games.termination',
      constraint: 'games_termination_check',
      file: 'apps/server/src/persistence-game-lifecycle.ts',
      type: 'GameTermination',
    },
    {
      label: 'games.review_status',
      constraint: 'games_review_status_check',
      file: 'apps/server/src/persistence-game-lifecycle.ts',
      type: 'GameReviewStatus',
    },
    {
      label: 'games.visibility',
      constraint: 'games_visibility_check',
      file: 'apps/server/src/persistence-game-lifecycle.ts',
      type: 'GameVisibility',
    },
    {
      label: 'users.account_role',
      constraint: 'users_account_role_check',
      file: 'apps/server/src/persistence-accounts.ts',
      type: 'AccountRole',
    },
    {
      label: 'user_ratings.time_class',
      constraint: 'user_ratings_time_class_check',
      file: 'packages/game/src/time-controls.ts',
      // RatedTimeClass, NOT TimeClass. TimeClass is the pace classifier's
      // output and carries 'classical' for arbitrary slow paces; this column
      // only ever receives a rated preset's class, and RatedTimeClass is
      // defined as exactly that set. Pointing this back at TimeClass would
      // demand a migration adding a value nothing is able to write.
      type: 'RatedTimeClass',
    },
  ];

  const issues = [];
  for (const comparison of comparisons) {
    const actual = constraints.get(comparison.constraint);
    if (!actual) {
      issues.push(`${comparison.label} is missing SQL constraint ${comparison.constraint}`);
      continue;
    }
    const expected = unionValues(comparison.file, comparison.type);
    const missingInSql = [...expected].filter((value) => !actual.has(value));
    const missingInType = [...actual].filter((value) => !expected.has(value));
    if (missingInSql.length > 0) {
      issues.push(`${comparison.label} SQL is missing: ${missingInSql.join(', ')}`);
    }
    if (missingInType.length > 0) {
      issues.push(`${comparison.label} TypeScript is missing: ${missingInType.join(', ')}`);
    }
  }
  return issues;
}

function latestNamedConstraints() {
  const constraints = new Map();
  for (const file of gitLines(['ls-files', 'apps/server/migrations/*.sql']).sort()) {
    const text = readFile(file);
    const pattern =
      /\bADD\s+CONSTRAINT\s+([a-z0-9_]+)\s+CHECK\s*\(([\s\S]*?)\)\s*(?=,?\s*(?:ADD\s+CONSTRAINT|;))/gi;
    let match = pattern.exec(text);
    while (match) {
      constraints.set(match[1], quotedValues(match[2]));
      match = pattern.exec(text);
    }
  }
  return constraints;
}

function unionValues(file, typeName) {
  const text = readFile(file);
  const pattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([\\s\\S]*?);`);
  const match = text.match(pattern);
  if (!match) throw new Error(`could not find exported type ${typeName} in ${file}`);
  return quotedValues(match[1]);
}

function quotedValues(text) {
  const values = new Set();
  const pattern = /'([^']+)'/g;
  let match = pattern.exec(text);
  while (match) {
    values.add(match[1]);
    match = pattern.exec(text);
  }
  return values;
}

function checkPayloadRedaction() {
  const file = 'apps/server/src/payloads.ts';
  const text = readFile(file);
  const issues = [];
  const requiredFragments = [
    [
      'snapshot payload filters events per recipient',
      'events: eventsForClient(normalized, client)',
    ],
    ['snapshot payload uses per-client PlayerView', 'state: getClientView(room, client)'],
    [
      'single event payload filters appended events',
      'filterEventForClient(normalized, client, event)',
    ],
    [
      'live fog view uses variant PlayerView',
      'variant.getPlayerView(room.projection.state, perspective)',
    ],
  ];

  for (const [label, fragment] of requiredFragments) {
    if (!text.includes(fragment)) issues.push(`${file} lost guard: ${label}`);
  }

  const forbiddenFragments = [
    ['snapshot state bypasses PlayerView', 'state: room.projection.state'],
    ['snapshot events bypass per-client filtering', 'events: room.events'],
  ];
  for (const [label, fragment] of forbiddenFragments) {
    if (text.includes(fragment)) issues.push(`${file} forbidden payload path: ${label}`);
  }

  return issues;
}

// INDEX.md is the agent-orientation map ("read this before opening any source
// file"). Every non-test source file under apps/{web,server}/src should appear
// as a backticked entry, else the map silently drifts (whole launched variant
// families went missing this way). This is now a WARNING rather than a push
// blocker, and `index:fix` auto-appends stub rows so the map stays honest
// without a missing entry ever blocking an unrelated push. Match by basename so
// the existing `dir/{a,b,c}.ts` shorthand still counts.
function missingIndexEntries() {
  const index = readFile('INDEX.md');
  const indexedBasenames = new Set();
  for (const match of index.matchAll(/`([^`]+)`/g)) {
    for (const token of expandBraces(match[1])) {
      if (token.includes('.')) indexedBasenames.add(token.split('/').pop());
    }
  }

  // Directories whose contents are intentionally not indexed file-by-file:
  // per-article content/data modules and one-off generators. Each is documented
  // in INDEX.md with a glob row, so the exclusion is explicit, not silent drift.
  const ignoredPrefixes = ['apps/web/src/articles/content/', 'apps/server/src/scripts/'];

  return (
    gitLines(['ls-files', 'apps/web/src', 'apps/server/src'])
      // Tests are not part of the orientation map.
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .filter((file) => !basename(file).startsWith('_')) // dev scratch (e.g. _harness.ts)
      .filter((file) => !ignoredPrefixes.some((prefix) => file.startsWith(prefix)))
      .filter((file) => !indexedBasenames.has(basename(file)))
  );
}

function checkIndex() {
  return missingIndexEntries().map((file) => `INDEX.md has no entry for ${file}`);
}

// Append a stub row per missing file under a dedicated section, so a human can
// backfill the description later. Idempotent: files already listed are skipped.
function fixIndex() {
  const missing = missingIndexEntries();
  if (missing.length === 0) return [];

  const marker = '## Unindexed (auto-added by `index:fix`, needs a description)';
  const rows = missing.map((file) => `| \`${file}\` | _needs a one-line description_ |`).join('\n');
  const body = readFile('INDEX.md').replace(/\s*$/, '');
  const next = body.includes(marker)
    ? `${body}\n${rows}\n`
    : `${body}\n\n${marker}\n\n| File | Owns |\n|------|------|\n${rows}\n`;
  writeFileSync('INDEX.md', next);
  return missing;
}

function basename(file) {
  return file.split('/').pop();
}

// Expand a single `dir/{a,b,c}.ts` INDEX token into its concrete filenames.
function expandBraces(token) {
  const match = token.match(/^([^{]*)\{([^}]*)\}(.*)$/);
  if (!match) return [token];
  const [, prefix, inner, suffix] = match;
  return inner.split(',').map((part) => `${prefix}${part.trim()}${suffix}`);
}

function readFile(file) {
  return readFileSync(file, 'utf8');
}

function gitLines(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function printHelp() {
  console.log(`Usage:
  npm run check:drift
  npm run check:drift -- --only docs
  npm run check:drift -- --json
  npm run index:fix              # append stub INDEX.md rows for any missing files

Checks:
  docs                public Markdown links resolve and do not link to docs-private/  [blocks push]
  sql-enums           selected SQL check constraints match TypeScript unions          [blocks push]
  payload-redaction   live snapshot/event payloads still use PlayerView filters       [blocks push]
  index               every apps/{web,server}/src source file is listed in INDEX.md   [warning; use --fix]`);
}
