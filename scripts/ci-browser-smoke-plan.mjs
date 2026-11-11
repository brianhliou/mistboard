#!/usr/bin/env node
// Decide whether CI should pay the Playwright browser-smoke cost.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const BROWSER_SMOKE_PATTERNS = [
  '.github/workflows/ci.yml',
  'apps/web/**',
  'packages/board-render/**',
  'package.json',
  'package-lock.json',
  'scripts/ci-browser-smoke-plan.mjs',
];
const MAX_PRINTED_FILES = 30;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    const plan = buildPlan(readChangedFiles(options));
    printPlan(plan);
    writeGithubOutputs(plan, options);
    writeGithubSummary(plan, options);
  }
}

function parseArgs(args) {
  const parsed = {
    base: null,
    files: [],
    githubOutput: null,
    head: 'HEAD',
    help: false,
    summary: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base') {
      parsed.base = requiredValue(args, ++index, arg);
    } else if (arg === '--file') {
      parsed.files.push(requiredValue(args, ++index, arg));
    } else if (arg === '--github-output') {
      parsed.githubOutput = requiredValue(args, ++index, arg);
    } else if (arg === '--head') {
      parsed.head = requiredValue(args, ++index, arg);
    } else if (arg === '--summary') {
      parsed.summary = requiredValue(args, ++index, arg);
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return parsed;
}

// Local preship and hosted CI deliberately share the same patterns and
// conservative fallback, even though they obtain their changed paths differently.
export function buildPlan({ changedFiles, warning = null }) {
  const matched = [];
  const unmatched = [];

  for (const file of changedFiles) {
    const pattern = BROWSER_SMOKE_PATTERNS.find((candidate) => matchesPattern(file, candidate));
    if (pattern) matched.push({ file, pattern });
    else unmatched.push(file);
  }

  const conservativeRun = changedFiles.length === 0 || warning !== null;
  const runBrowserSmoke = conservativeRun || matched.length > 0;

  return {
    changedFiles,
    matched,
    reason: conservativeRun
      ? warning
        ? 'changed_files_unknown_conservative'
        : 'empty_change_set_conservative'
      : runBrowserSmoke
        ? 'browser_smoke_pattern_match'
        : 'no_browser_smoke_pattern_match',
    runBrowserSmoke,
    unmatched,
    warning,
  };
}

function readChangedFiles(options) {
  if (options.files.length > 0) {
    return {
      changedFiles: unique(options.files.map(normalizePath)),
      reason: 'explicit_files',
      warning: null,
    };
  }

  const eventPlan = readGithubEventFiles();
  if (eventPlan) return eventPlan;

  if (options.base) {
    try {
      return {
        changedFiles: readGitDiffFiles(options.base, options.head),
        reason: 'git_diff',
        warning: null,
      };
    } catch (error) {
      return {
        changedFiles: [],
        reason: 'git_diff_failed',
        warning: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    changedFiles: [],
    reason: 'changed_files_unavailable',
    warning: 'no GitHub push file list or --base diff was available',
  };
}

function readGithubEventFiles() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return null;

  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, 'utf8'));
  } catch (error) {
    return {
      changedFiles: [],
      reason: 'github_event_read_failed',
      warning: error instanceof Error ? error.message : String(error),
    };
  }

  if (Array.isArray(event.commits)) {
    const files = [];
    for (const commit of event.commits) {
      for (const key of ['added', 'modified', 'removed']) {
        if (!Array.isArray(commit?.[key])) continue;
        files.push(...commit[key]);
      }
    }
    if (files.length === 0) return readGithubEventDiffFiles(event);
    return {
      changedFiles: unique(files.map(normalizePath)),
      reason: 'github_push_event',
      warning: null,
    };
  }

  return {
    changedFiles: [],
    reason: 'github_event_no_push_files',
    warning: 'GitHub event did not include push commit file lists',
  };
}

function readGithubEventDiffFiles(event) {
  const before = typeof event.before === 'string' ? event.before : '';
  const after = typeof event.after === 'string' ? event.after : '';
  if (!isRevision(before) || !isRevision(after) || isZeroRevision(before)) {
    return {
      changedFiles: [],
      reason: 'github_push_event_empty_files',
      warning: 'GitHub push event did not include changed files or a usable before/after diff',
    };
  }

  try {
    return {
      changedFiles: readGitDiffFiles(before, after),
      reason: 'github_push_event_diff',
      warning: null,
    };
  } catch (error) {
    return {
      changedFiles: [],
      reason: 'github_push_event_diff_failed',
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

function readGitDiffFiles(base, head) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}..${head}`],
    { encoding: 'utf8' },
  ).trim();
  if (!output) return [];
  return unique(output.split('\n').map(normalizePath));
}

function matchesPattern(file, pattern) {
  const normalized = normalizePath(pattern);
  if (normalized.endsWith('/**')) {
    const prefix = normalized.slice(0, -'/**'.length);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (!normalized.includes('*')) return file === normalized;
  return globToRegex(normalized).test(file);
}

function globToRegex(pattern) {
  let source = '';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char !== '*') {
      source += escapeRegex(char);
      continue;
    }

    if (pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else {
      source += '[^/]*';
    }
  }
  return new RegExp(`^${source}$`);
}

function printPlan({ changedFiles, matched, reason, runBrowserSmoke, unmatched, warning }) {
  console.log(`ci-browser-smoke-plan: run_browser_smoke=${runBrowserSmoke ? 'true' : 'false'}`);
  console.log(`reason: ${reason}`);
  if (warning) console.log(`warning: ${warning}`);
  console.log(`changed_count: ${changedFiles.length}`);
  console.log(`matched_count: ${matched.length}`);
  printList(
    'matched',
    matched.map((entry) => `${entry.file} -> ${entry.pattern}`),
  );
  printList('unmatched', unmatched);
}

function writeGithubOutputs({ changedFiles, matched, reason, runBrowserSmoke, warning }, options) {
  const outputPath = options.githubOutput ?? process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `run_browser_smoke=${runBrowserSmoke ? 'true' : 'false'}`,
      `changed_count=${changedFiles.length}`,
      `matched_count=${matched.length}`,
      `reason=${reason}`,
      `warning=${warning ?? ''}`,
      '',
    ].join('\n'),
  );
}

function writeGithubSummary(
  { changedFiles, matched, reason, runBrowserSmoke, unmatched, warning },
  options,
) {
  const summaryPath = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  appendFileSync(
    summaryPath,
    [
      '### Browser Smoke Plan',
      '',
      `- Browser smoke: **${runBrowserSmoke ? 'run' : 'skip'}**`,
      `- Reason: \`${reason}\``,
      `- Changed files: ${changedFiles.length}`,
      `- Pattern matches: ${matched.length}`,
      ...(warning ? [`- Warning: \`${warning}\``] : []),
      '',
      ...formatFileSection(
        'Matched files',
        matched.map((entry) => `${entry.file} -> ${entry.pattern}`),
      ),
      ...formatFileSection('Unmatched files', unmatched),
      '',
    ].join('\n'),
  );
}

function printList(label, values) {
  if (values.length === 0) return;
  console.log(`${label}:`);
  for (const value of values.slice(0, MAX_PRINTED_FILES)) console.log(`  ${value}`);
  if (values.length > MAX_PRINTED_FILES) {
    console.log(`  ... ${values.length - MAX_PRINTED_FILES} more`);
  }
}

function formatFileSection(label, values) {
  if (values.length === 0) return [];
  const printed = values.slice(0, MAX_PRINTED_FILES).map((value) => `- \`${value}\``);
  if (values.length > MAX_PRINTED_FILES) {
    printed.push(`- ... ${values.length - MAX_PRINTED_FILES} more`);
  }
  return [`#### ${label}`, '', ...printed, ''];
}

function normalizePath(file) {
  return file
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .trim();
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isRevision(value) {
  return /^[0-9a-f]{40}$/i.test(value);
}

function isZeroRevision(value) {
  return /^0{40}$/.test(value);
}

function requiredValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/ci-browser-smoke-plan.mjs --file scripts/release-prod.mjs
  node scripts/ci-browser-smoke-plan.mjs --base HEAD^ --head HEAD

The planner skips the Playwright browser smoke when changed files cannot affect
the browser surface. It defaults to running browser smoke when changed files are
unknown.`);
}
