#!/usr/bin/env node
// Rebuild internal packages whose dist/ is stale relative to src/.
//
// @mistboard/game, @mistboard/board-render and @mistboard/mahjong export ONLY dist/* (types and
// runtime), so after a pull or a cross-package edit, app typecheck/tests/dev
// resolve stale compiled output and fail with phantom errors that a manual
// `npm run build` clears. This guard runs as a pre-script for the app
// workspaces' typecheck/test/dev entries: ~no-op when fresh, one package
// build when stale.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['packages/game', 'packages/board-render', 'packages/mahjong'];

for (const pkg of PACKAGES) {
  const pkgDir = path.join(repoRoot, pkg);
  const inputsNewest = Math.max(
    newestMtime(path.join(pkgDir, 'src')),
    fileMtime(path.join(pkgDir, 'package.json')),
    fileMtime(path.join(pkgDir, 'tsconfig.json')),
  );
  const distDir = path.join(pkgDir, 'dist');
  const distNewest = existsSync(distDir) ? newestMtime(distDir) : -1;
  if (inputsNewest > distNewest) {
    console.log(`ensure-packages-built: ${pkg} dist is stale, rebuilding`);
    execFileSync('npm', ['run', 'build', '--workspace', pkg], {
      stdio: 'inherit',
      cwd: repoRoot,
    });
  }
}

function newestMtime(dir) {
  let newest = -1;
  if (!existsSync(dir)) return newest;
  // Directory mtimes are included so file deletions (which touch only the
  // parent directory) also invalidate dist.
  newest = Math.max(newest, fileMtime(dir));
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(entryPath) : fileMtime(entryPath));
  }
  return newest;
}

function fileMtime(filePath) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return -1;
  }
}
