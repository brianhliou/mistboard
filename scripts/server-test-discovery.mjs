#!/usr/bin/env node
// A test outside a runner's globs must fail the gate, even before tsc emits it.
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SERVER_DIR = resolve(import.meta.dirname, '..', 'apps', 'server');
const SUITES = ['test:unit', 'test', 'test:persistent'];

export function serverTestGlobs(script, suite) {
  const source = suite === 'test:unit';
  const root = source ? 'src' : 'dist';
  const extension = source ? 'ts' : 'js';
  if (typeof script !== 'string' || !/\b(?:tsx|node) --test(?:\s|$)/.test(script)) {
    throw new Error(`${suite}: expected an explicit node/tsx --test command`);
  }
  const patterns = script.split(/\s+/).filter((token) => /^(?:src|dist)\//.test(token));
  // These are POSIX shell arguments, not globstar patterns: sh does not give
  // ** recursive semantics. Refuse unsupported syntax rather than overstate
  // what the real runner will execute (including quoted or delegated globs).
  const supported = new RegExp(`^${root}/(?:[\\w.-]+/)*[\\w.*-]+\\.test\\.${extension}$`);
  if (patterns.length === 0 || patterns.some((pattern) => !supported.test(pattern))) {
    throw new Error(`${suite}: expected unquoted ${root}/*.test.${extension} file globs`);
  }
  return patterns;
}

export function readServerTestScripts(serverDir = SERVER_DIR) {
  return JSON.parse(readFileSync(resolve(serverDir, 'package.json'), 'utf8')).scripts;
}

export function checkServerTestDiscovery(serverDir = SERVER_DIR) {
  const scripts = readServerTestScripts(serverDir);
  const sources = [...globSync('src/**/*.test.ts', { cwd: serverDir })].sort();
  if (sources.length === 0) throw new Error('server test discovery: no src/**/*.test.ts files');
  const issues = [];
  const filesBySuite = {};
  for (const suite of SUITES) {
    const patterns = serverTestGlobs(scripts?.[suite], suite);
    // Check the source inventory, never stale/missing dist output. tsc emits
    // src/**/*.ts to the same relative path under dist/ (server tsconfig).
    const sourcePatterns = patterns.map((pattern) =>
      pattern.replace(/^dist\//, 'src/').replace(/\.js$/, '.ts'),
    );
    const selected = new Set(
      sourcePatterns.flatMap((pattern) => globSync(pattern, { cwd: serverDir })),
    );
    filesBySuite[suite] = sources
      .filter((file) => selected.has(file))
      .map((file) =>
        suite === 'test:unit' ? file : file.replace(/^src\//, 'dist/').replace(/\.ts$/, '.js'),
      );
    for (const file of sources) {
      if (!selected.has(file))
        issues.push(`${suite}: ${file} is outside every configured test glob`);
    }
  }
  return { sourceCount: sources.length, filesBySuite, issues };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== '--list'))
      throw new Error('usage: server-test-discovery.mjs [--list]');
    const result = checkServerTestDiscovery();
    for (const [suite, files] of Object.entries(result.filesBySuite)) {
      console.log(`${suite}: ${files.length}/${result.sourceCount} server test files selected`);
      if (process.argv.includes('--list')) for (const file of files) console.log(`  ${file}`);
    }
    for (const issue of result.issues) console.error(issue);
    process.exitCode = result.issues.length > 0 ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
