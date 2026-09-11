// Artifacts: one JSON file per run, named by what produced it.
//
// `<out>/<variant>/<command>-<fingerprint>-<seed>-<timestamp>.json`. The
// fingerprint is in the filename so a directory listing already groups runs
// by ruleset and engine, and the report never has to guess which rules a
// number was measured under.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, LAB_VERSION, rulesHash, shortHash } from './rules.js';
import type { Artifact, ArtifactHeader, EngineIdentity, RulesRecord, RuleValue } from './types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..', '..');

/**
 * Measurements are private planning material until a write-up publishes
 * them, so the default home is the docs-private repo. That repo is gitignored
 * by the main one, so a task worktree has no copy of it: look in the main
 * worktree, which every session shares. `LAB_OUT` overrides (tests point it
 * at a temp dir); without either, the lab refuses to write rather than
 * scatter results under the public tree.
 */
export function defaultOutDir(): string {
  if (process.env.LAB_OUT) return resolve(process.env.LAB_OUT);
  for (const root of [REPO_ROOT, mainWorktree()]) {
    if (!root) continue;
    const priv = join(root, 'docs-private');
    if (existsSync(priv)) return join(priv, 'variant-lab', 'out');
  }
  throw new Error('no docs-private/ in this or the main worktree and LAB_OUT is unset; pass --out');
}

function mainWorktree(): string | null {
  try {
    const first = execFileSync('git', ['-C', REPO_ROOT, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
    }).split('\n')[0];
    return first?.startsWith('worktree ') ? first.slice('worktree '.length) : null;
  } catch {
    return null;
  }
}

export function fingerprintOf(
  variant: string,
  rules: RulesRecord,
  engine: EngineIdentity | null,
): string {
  return shortHash(
    canonicalJson({
      lab: LAB_VERSION,
      variant,
      rules,
      engine: engine
        ? { binary: engine.binarySha256, ini: engine.iniSha256, variant: engine.variant }
        : null,
    }),
  );
}

export type HeaderInput = {
  command: string;
  variant: string;
  rules: RulesRecord;
  engine: EngineIdentity | null;
  args: Record<string, RuleValue>;
  seed: number | null;
  startedAt: Date;
};

export function makeHeader(input: HeaderInput): ArtifactHeader {
  return {
    lab: LAB_VERSION,
    command: input.command,
    variant: input.variant,
    rules: input.rules,
    rulesHash: rulesHash(input.variant, input.rules),
    engine: input.engine,
    fingerprint: fingerprintOf(input.variant, input.rules, input.engine),
    args: input.args,
    seed: input.seed,
    startedAt: input.startedAt.toISOString(),
    durationMs: Date.now() - input.startedAt.getTime(),
  };
}

export function writeArtifact<T>(outDir: string, header: ArtifactHeader, result: T): string {
  const dir = join(outDir, header.variant);
  mkdirSync(dir, { recursive: true });
  const stamp = header.startedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const file = join(
    dir,
    `${header.command}-${header.fingerprint}-${header.seed ?? 'x'}-${stamp}.json`,
  );
  const artifact: Artifact<T> = { ...header, result };
  writeFileSync(file, `${JSON.stringify(artifact, null, 1)}\n`);
  return file;
}

export function readArtifacts(outDir: string, variant: string): Artifact<unknown>[] {
  const dir = join(outDir, variant);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Artifact<unknown>);
}
