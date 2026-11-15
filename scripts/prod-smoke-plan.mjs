#!/usr/bin/env node
// Decide whether a pushed commit should wait for a Railway web deployment.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

import { DEFAULT_PROD_BASE_URL, normalizeBaseUrl, revisionMatches } from './lib/base-url.mjs';
import { fetchWithTimeout } from './lib/http.mjs';
import { parsePositiveInteger, requiredValue } from './lib/smoke-args.mjs';

// web's watch patterns (#980: the Infrastructure as Code data file).
const DEFAULT_CONFIG = '.railway/web.json';
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_PRINTED_FILES = 30;

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const configPath = options.configPath ?? DEFAULT_CONFIG;
const watchPatterns = readWatchPatterns(configPath);
const plan = await buildPlan({ configPath, options, watchPatterns });

printPlan(plan);
writeGithubOutputs(plan);
writeGithubSummary(plan);

function parseArgs(args) {
  const parsed = {
    base: null,
    configPath: null,
    files: [],
    githubOutput: null,
    head: 'HEAD',
    help: false,
    baseFromProd: false,
    baseUrl: null,
    requestTimeoutMs: null,
    summary: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--base') {
      parsed.base = requiredValue(args, ++index, arg);
    } else if (arg === '--base-from-prod') {
      parsed.baseFromProd = true;
    } else if (arg === '--base-url') {
      parsed.baseUrl = requiredValue(args, ++index, arg);
    } else if (arg === '--config') {
      parsed.configPath = requiredValue(args, ++index, arg);
    } else if (arg === '--file') {
      parsed.files.push(requiredValue(args, ++index, arg));
    } else if (arg === '--github-output') {
      parsed.githubOutput = requiredValue(args, ++index, arg);
    } else if (arg === '--head') {
      parsed.head = requiredValue(args, ++index, arg);
    } else if (arg === '--request-timeout-ms') {
      parsed.requestTimeoutMs = parsePositiveInteger(requiredValue(args, ++index, arg), arg);
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

async function buildPlan({ configPath, options, watchPatterns }) {
  let changedFiles = [];
  let deployRequired = false;
  let reason = 'no_railway_watch_pattern_match';
  let baseRevision = options.base;
  let prodRevision = null;
  let warning = null;

  const headRevision = git(['rev-parse', '--verify', options.head]);

  if (options.files.length > 0) {
    changedFiles = options.files.map(normalizePath);
  } else {
    if (options.baseFromProd) {
      try {
        prodRevision = await fetchProdRevision(options);
        if (revisionMatches(prodRevision, headRevision)) {
          return {
            changedFiles: [],
            configPath,
            deployRequired: true,
            excluded: [],
            headRevision,
            matched: [],
            prodRevision,
            reason: 'head_already_deployed',
            unmatched: [],
            warning,
            watchPatterns,
          };
        }
        baseRevision = prodRevision;
      } catch (error) {
        warning = error instanceof Error ? error.message : String(error);
        return {
          changedFiles: [],
          configPath,
          deployRequired: true,
          excluded: [],
          headRevision,
          matched: [],
          prodRevision,
          reason: 'prod_revision_lookup_failed_conservative',
          unmatched: [],
          warning,
          watchPatterns,
        };
      }
    }

    try {
      changedFiles = readChangedFiles({ base: baseRevision, head: options.head });
    } catch (error) {
      warning = error instanceof Error ? error.message : String(error);
      return {
        changedFiles: [],
        configPath,
        deployRequired: true,
        excluded: [],
        headRevision,
        matched: [],
        prodRevision,
        reason: 'diff_failed_conservative',
        unmatched: [],
        warning,
        watchPatterns,
      };
    }
  }

  const excluded = [];
  const matched = [];
  const unmatched = [];

  for (const file of changedFiles) {
    const result = evaluateWatchPatterns(file, watchPatterns);
    if (result.status === 'matched') matched.push({ file, pattern: result.pattern });
    else if (result.status === 'excluded') excluded.push({ file, pattern: result.pattern });
    else unmatched.push(file);
  }

  deployRequired = matched.length > 0;
  reason = deployRequired
    ? 'matched_railway_watch_pattern'
    : excluded.length > 0
      ? 'excluded_by_railway_watch_negation'
      : 'no_railway_watch_pattern_match';
  if (changedFiles.length === 0) {
    deployRequired = true;
    reason = 'empty_diff_conservative';
  }

  return {
    changedFiles,
    configPath,
    deployRequired,
    excluded,
    headRevision,
    matched,
    prodRevision,
    reason,
    unmatched,
    warning,
    watchPatterns,
  };
}

function readWatchPatterns(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const patterns = config?.build?.watchPatterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error(`${configPath} does not define build.watchPatterns`);
  }
  return patterns.map((pattern) => {
    if (typeof pattern !== 'string' || pattern.trim() === '') {
      throw new Error(`${configPath} contains an invalid watch pattern`);
    }
    const normalized = pattern.trim();
    const target = normalized.startsWith('!') ? normalized.slice(1) : normalized;
    if (target.trim() === '') {
      throw new Error(`${configPath} contains an invalid watch pattern`);
    }
    return normalized;
  });
}

function readChangedFiles({ base, head }) {
  const args = base
    ? ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}..${head}`]
    : ['diff-tree', '--no-commit-id', '--name-only', '-r', head];
  const output = execFileSync('git', args, { encoding: 'utf8' }).trim();
  if (!output) return [];
  return output.split('\n').map(normalizePath).filter(Boolean);
}

function evaluateWatchPatterns(file, patterns) {
  let excludedPattern = null;
  let matchedPattern = null;

  for (const pattern of patterns) {
    if (!matchesWatchPattern(file, pattern)) continue;
    if (isNegatedWatchPattern(pattern)) {
      if (matchedPattern) {
        excludedPattern = pattern;
        matchedPattern = null;
      }
    } else {
      excludedPattern = null;
      matchedPattern = pattern;
    }
  }

  if (matchedPattern) return { status: 'matched', pattern: matchedPattern };
  if (excludedPattern) return { status: 'excluded', pattern: excludedPattern };
  return { status: 'unmatched' };
}

async function fetchProdRevision({ baseUrl, requestTimeoutMs }) {
  const url = normalizeBaseUrl(baseUrl ?? process.env.MISTBOARD_BASE_URL ?? DEFAULT_PROD_BASE_URL);
  const response = await fetchWithTimeout(
    new URL('/api/server-status', url),
    requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  );
  const body = await response.json();
  const revision = body?.build?.revision;
  if (!response.ok) {
    throw new Error(`/api/server-status failed: ${response.status}`);
  }
  if (typeof revision !== 'string' || revision.length === 0) {
    throw new Error('/api/server-status did not report build.revision');
  }
  return revision;
}

function matchesWatchPattern(file, pattern) {
  const normalizedPattern = normalizeWatchPattern(pattern);
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -'/**'.length);
    return file === prefix || file.startsWith(`${prefix}/`);
  }
  if (!normalizedPattern.includes('*')) return file === normalizedPattern;

  return watchGlobToRegex(normalizedPattern).test(file);
}

function watchGlobToRegex(pattern) {
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

function isNegatedWatchPattern(pattern) {
  return pattern.startsWith('!');
}

function normalizeWatchPattern(pattern) {
  const target = isNegatedWatchPattern(pattern) ? pattern.slice(1) : pattern;
  return normalizePath(target.replace(/^\/+/, ''));
}

function normalizePath(file) {
  return file
    .replaceAll('\\', '/')
    .replace(/^\.?\//, '')
    .trim();
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeGithubOutputs({ changedFiles, deployRequired, excluded, matched, reason }) {
  const outputPath = options.githubOutput ?? process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(
    outputPath,
    [
      `deploy_required=${deployRequired ? 'true' : 'false'}`,
      `changed_count=${changedFiles.length}`,
      `matched_count=${matched.length}`,
      `excluded_count=${excluded.length}`,
      `reason=${reason}`,
      '',
    ].join('\n'),
  );
}

function writeGithubSummary({
  changedFiles,
  configPath,
  deployRequired,
  excluded,
  headRevision,
  matched,
  prodRevision,
  reason,
  unmatched,
  warning,
}) {
  const summaryPath = options.summary ?? process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  appendFileSync(
    summaryPath,
    [
      '### Prod Smoke Plan',
      '',
      `- Deploy wait required: **${deployRequired ? 'yes' : 'no'}**`,
      `- Reason: \`${reason}\``,
      `- Config: \`${configPath}\``,
      `- Head revision: \`${headRevision.slice(0, 12)}\``,
      `- Production revision: \`${prodRevision ? prodRevision.slice(0, 12) : 'not checked'}\``,
      `- Changed files: ${changedFiles.length}`,
      `- Railway matches: ${matched.length}`,
      `- Railway exclusions: ${excluded.length}`,
      ...(warning ? [`- Warning: \`${warning}\``] : []),
      '',
      ...formatFileSection(
        'Matched files',
        matched.map((entry) => `${entry.file} -> ${entry.pattern}`),
      ),
      ...formatFileSection(
        'Excluded files',
        excluded.map((entry) => `${entry.file} -> ${entry.pattern}`),
      ),
      ...formatFileSection('Unmatched files', unmatched),
      '',
    ].join('\n'),
  );
}

function printPlan({
  changedFiles,
  configPath,
  deployRequired,
  excluded,
  headRevision,
  matched,
  prodRevision,
  reason,
  unmatched,
  warning,
}) {
  console.log(`prod-smoke-plan: deploy_required=${deployRequired ? 'true' : 'false'}`);
  console.log(`reason: ${reason}`);
  console.log(`config: ${configPath}`);
  console.log(`head_revision: ${headRevision}`);
  if (prodRevision) console.log(`production_revision: ${prodRevision}`);
  if (warning) console.log(`warning: ${warning}`);
  console.log(`changed_count: ${changedFiles.length}`);
  console.log(`matched_count: ${matched.length}`);
  console.log(`excluded_count: ${excluded.length}`);
  printList(
    'matched',
    matched.map((entry) => `${entry.file} -> ${entry.pattern}`),
  );
  printList(
    'excluded',
    excluded.map((entry) => `${entry.file} -> ${entry.pattern}`),
  );
  printList('unmatched', unmatched);
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

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function printHelp() {
  console.log(`Usage:
  npm run prod:smoke:plan -- --base HEAD^ --head HEAD
  npm run prod:smoke:plan -- --base-from-prod --head HEAD
  npm run prod:smoke:plan -- --file docs/example.md

Options:
  --base <ref>             Base ref for git diff. If omitted, reads files changed by --head.
  --base-from-prod         Compare from the current production /api/server-status revision.
  --base-url <url>         Production URL for --base-from-prod, default ${DEFAULT_PROD_BASE_URL}.
  --head <ref>             Head ref, default HEAD.
  --config <path>          Railway config to read, default ${DEFAULT_CONFIG}.
  --file <path>            Explicit changed file. Repeatable; skips git diff.
  --github-output <path>   Write GitHub Actions outputs. Defaults to GITHUB_OUTPUT.
  --request-timeout-ms <ms>
                           Timeout for production revision lookup, default ${DEFAULT_REQUEST_TIMEOUT_MS}.
  --summary <path>         Write markdown summary. Defaults to GITHUB_STEP_SUMMARY.
`);
}
