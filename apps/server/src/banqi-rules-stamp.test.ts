/**
 * Every place that builds a banqi game state says which rules it is played under.
 *
 * The 長捉 (perpetual chase) rule shipped in 2026-10, and a stored banqi game is
 * its event log replayed through the kernel. applyBanqiMove silently ignores a
 * move the rules call illegal, so a game played before the rule and replayed
 * under it can drop a chase move that repeated a position a third time and replay
 * to a different board (and a chase repetition draw replays as still playing). Each room records its rules in the
 * room-created setup (createBanqiSetup / readBanqiSetup), and every replay path
 * must carry them through.
 *
 * createInitialBanqiState defaults to the CURRENT rules, so a replay call site
 * that forgets its stamp would compile and quietly apply the new rule to old
 * games. This scan makes the third argument mandatory outside an allowlist of
 * fresh-game call sites (a new deal or the start position, no stored moves).
 */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// file (repo-relative) → why a call there may use the current rules.
const FRESH_GAME_CALL_SITES: Record<string, string> = {
  'apps/web/src/start-position-board.ts': 'the start diagram: no moves',
  'apps/web/src/variant-analysis.ts': 'a new random deal on the analysis board',
  'apps/server/src/og-position.ts': 'the start-position share card: no moves',
  'packages/game/src/hidden-piece-record.ts': 'the start FEN: no moves',
  'packages/game/src/start-fen.ts': 'a fresh dealt start position',
};

const SCAN_ROOTS = ['apps/server/src', 'apps/web/src', 'packages/game/src', 'scripts'];

function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(join(dir, 'apps', 'web', 'src'))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error('repo root not found');
    dir = parent;
  }
  return dir;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(ts|mts|mjs)$/.test(name) && !/\.test\.(ts|mts|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/** Top-level argument count of the call whose `(` is at `open`. */
function argumentCount(source: string, open: number): number {
  let depth = 0;
  let commas = 0;
  let sawArg = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]!;
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return sawArg ? commas + 1 : 0;
    } else if (depth === 1 && ch === ',') {
      // A trailing comma before `)` is not another argument.
      if (/^\s*\)/.test(source.slice(i + 1))) continue;
      commas += 1;
    } else if (depth === 1 && !/\s/.test(ch)) sawArg = true;
  }
  throw new Error('unterminated call');
}

type CallSite = { file: string; line: number; args: number };

function constructorCallSites(): CallSite[] {
  const root = repoRoot();
  const sites: CallSite[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    for (const path of sourceFiles(join(root, scanRoot))) {
      const source = readFileSync(path, 'utf8');
      const pattern = /createInitialBanqiState\(/g;
      for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
        const lineStart = source.lastIndexOf('\n', match.index) + 1;
        const lineText = source.slice(lineStart, source.indexOf('\n', match.index));
        const trimmed = lineText.trim();
        // Comments and the definition itself.
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (/function\s+createInitialBanqiState\(/.test(lineText)) continue;
        sites.push({
          file: relative(root, path),
          line: source.slice(0, match.index).split('\n').length,
          args: argumentCount(source, match.index + match[0].length - 1),
        });
      }
    }
  }
  return sites;
}

test('every banqi state built from a deal outside a fresh game passes its rules', () => {
  const sites = constructorCallSites();
  assert.ok(sites.length >= 10, `found ${sites.length} call sites; the scan is broken`);
  const unstamped = sites.filter((s) => s.args < 3 && !(s.file in FRESH_GAME_CALL_SITES));
  assert.deepEqual(
    unstamped.map((s) => `${s.file}:${s.line}`),
    [],
    'pass the rules the game was played under (readBanqiSetup, banqiRulesFromView, ' +
      'LEGACY_BANQI_RULES for a record from before the 長捉 rule), or add a fresh-game ' +
      'call site to FRESH_GAME_CALL_SITES with the reason',
  );
});

test('the fresh-game allowlist names only files that still build a banqi state', () => {
  const files = new Set(constructorCallSites().map((s) => s.file));
  for (const file of Object.keys(FRESH_GAME_CALL_SITES)) {
    assert.ok(files.has(file), `${file} no longer calls createInitialBanqiState; drop it`);
  }
});
