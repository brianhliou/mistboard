import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Builtins newer than the browsers that actually reach us. Vite's build.target
// lowers syntax only, never builtins, so one of these ships verbatim into the
// bundle and throws at runtime on an old engine. Nothing in the build catches
// it: the bundle is valid, the page just dies on load.
//
// This is not hypothetical. Chrome 92 / Android threw `Object.hasOwn is not a
// function` on /puzzles (PostHog error tracking, 2026-08-25 and 2026-08-29),
// hard-failing the page before the board rendered, and six call sites had
// accumulated by then. `hasOwnKey` / `deepCloneJson` in @mistboard/game are the
// replacements.
//
// packages/game is scanned too: it is a dependency of this client, so its code
// ships to the same browsers.
const BANNED = [
  {
    pattern: /\bObject\.hasOwn\s*\(/,
    name: 'Object.hasOwn',
    floor: 'Chrome 93 / Safari 15.4',
    use: 'hasOwnKey from @mistboard/game',
  },
  {
    pattern: /(?<!\.)\bstructuredClone\s*\(/,
    name: 'structuredClone',
    floor: 'Chrome 98 / Safari 15.4',
    use: 'deepCloneJson from @mistboard/game',
  },
];

// import.meta.url is not a file: URL under the vitest transform, so anchor on
// the repo root instead of the module's own path.
const REPO_ROOT = repoRoot();
const ROOTS = [join(REPO_ROOT, 'apps/web/src'), join(REPO_ROOT, 'packages/game/src')];

function repoRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'apps/web/src'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`repo root not found from ${process.cwd()}`);
    dir = parent;
  }
  return resolve(dir);
}

// The shim itself is the one place allowed to name the builtins.
const EXEMPT = new Set(['js-compat.ts', 'web-builtin-floor.test.ts']);

describe('browser builtin floor', () => {
  for (const { pattern, name, floor, use } of BANNED) {
    it(`keeps ${name} (${floor}) out of code that ships to the browser`, () => {
      const offenders = sourceFiles().filter(({ text }) => pattern.test(text));
      expect(
        offenders.map((f) => f.path),
        `${name} needs ${floor}; use ${use} instead`,
      ).toEqual([]);
    });
  }
});

function sourceFiles(): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const root of ROOTS) {
    walk(root, root, files);
  }
  expect(files.length, 'scanner found no source files').toBeGreaterThan(100);
  return files;
}

function walk(dir: string, root: string, out: { path: string; text: string }[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, root, out);
      continue;
    }
    if (!entry.name.endsWith('.ts') || EXEMPT.has(entry.name)) continue;
    // Tests run in Node, never a browser, so they may use whatever they like.
    if (entry.name.endsWith('.test.ts')) continue;
    out.push({ path: full.slice(root.length), text: readFileSync(full, 'utf8') });
  }
}
