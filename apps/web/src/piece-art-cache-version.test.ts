import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { XiangqiPiece } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { jungleBoardAssetHref, jungleDobutsuPieceHref } from './jungle-art.js';
import {
  type AssetXiangqiPieceSet,
  animalTreasureHref,
  internationalTreasureHref,
  renderXiangqiPieceGlyphed,
} from './xiangqi-piece-sets.js';

// Piece art is served at stable URLs and swapped in place, so the only thing
// that tells a browser, the CDN or a cached share card that the picture changed
// is a version: the ?v= on the client's href, and the OG card versions in the
// server's cache keys. Forgetting the bump ships new art that most viewers never
// see (lesson mistboard:633a822). This test pins a content hash of every art
// folder next to the version it was served under, so changing the art without
// the bump fails here.
//
// When it fails after a deliberate art change: bump the version it names, then
// paste the entry it prints into piece-art-fingerprints.json.

const ROOT = path.resolve(__dirname, '../../..');
const ART = path.join(ROOT, 'apps/web/public/piece-sets');
const FINGERPRINTS = path.join(ROOT, 'apps/web/src/piece-art-fingerprints.json');

type Fingerprints = {
  folders: Record<string, { version: number | 'unserved'; sha: string }>;
  og: { folders: string[]; sha: string; versions: Record<string, number> };
};

const IMAGE = /\.(png|svg|webp|jpe?g)$/;

// Every image directly in one folder (subfolders are their own entries), hashed
// by name and bytes so a rename counts as a change.
function folderSha(rel: string): string {
  const dir = path.join(ART, rel);
  const hash = createHash('sha256');
  for (const name of readdirSync(dir)
    .filter((n) => IMAGE.test(n))
    .sort()) {
    hash
      .update(name)
      .update('\0')
      .update(readFileSync(path.join(dir, name)))
      .update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function artFolders(rel = ''): string[] {
  const dir = path.join(ART, rel);
  const out: string[] = [];
  const names = readdirSync(dir);
  if (rel && names.some((n) => IMAGE.test(n))) out.push(rel);
  for (const name of names) {
    if (statSync(path.join(dir, name)).isDirectory()) {
      out.push(...artFolders(rel ? `${rel}/${name}` : name));
    }
  }
  return out.sort();
}

const versionOf = (href: string): number => {
  const v = /[?&]v=(\d+)/.exec(href)?.[1];
  if (!v) throw new Error(`no ?v= on ${href}`);
  return Number(v);
};

const redGeneral = { color: 'red', role: 'general' } as XiangqiPiece;
const assetSetVersion = (set: AssetXiangqiPieceSet): number =>
  versionOf(/href="([^"]+)"/.exec(renderXiangqiPieceGlyphed(redGeneral, set, {}))![1]!);

// The version each served folder's hrefs carry today, read through the same
// helpers the boards use.
const SERVED: Record<string, () => number> = {
  'xiangqi/international': () => versionOf(internationalTreasureHref('red')),
  'xiangqi/international-grid': () => versionOf(internationalTreasureHref('red')),
  'xiangqi/animal-dobutsu': () => versionOf(animalTreasureHref('red')),
  'xiangqi/lacquer': () => assetSetVersion('lacquer'),
  'xiangqi/wood': () => assetSetVersion('wood'),
  'xiangqi/book': () => assetSetVersion('book'),
  'xiangqi/brush': () => assetSetVersion('brush'),
  'xiangqi/clerical': () => assetSetVersion('clerical'),
  'jungle/dobutsu': () => versionOf(jungleDobutsuPieceHref('red', 'elephant')),
  'jungle/dobutsu/board': () => versionOf(jungleBoardAssetHref('water')),
};

// The server's share cards draw pieces from disk (og-card-board.ts) and cache
// the result under these versions; a stale key keeps serving the old pieces.
const OG_VERSIONS: Record<string, [file: string, name: string]> = {
  game: ['apps/server/src/og-image.ts', 'GAME_OG_IMAGE_VERSION'],
  article: ['apps/server/src/og-image.ts', 'ARTICLE_OG_IMAGE_VERSION'],
  articleClient: ['apps/web/src/article-og-image.ts', 'ARTICLE_OG_IMAGE_VERSION'],
  study: ['apps/server/src/og-image.ts', 'STUDY_OG_IMAGE_VERSION'],
  position: ['apps/server/src/og-position.ts', 'POSITION_OG_IMAGE_VERSION'],
  broadcast: ['apps/server/src/og-broadcast.ts', 'BROADCAST_OG_IMAGE_VERSION'],
  player: ['apps/server/src/player-pages.ts', 'PLAYER_OG_IMAGE_VERSION'],
};

function ogVersions(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(OG_VERSIONS).map(([key, [file, name]]) => {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      const v = new RegExp(`export const ${name} = (\\d+);`).exec(src)?.[1];
      if (!v) throw new Error(`${name} not found in ${file}`);
      return [key, Number(v)];
    }),
  );
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|mjs|css|html)$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const pinned: Fingerprints = JSON.parse(readFileSync(FINGERPRINTS, 'utf8'));

describe('piece art cache versions', () => {
  it('pins every art folder, so a new one cannot be skipped', () => {
    expect(Object.keys(pinned.folders).sort()).toEqual(artFolders());
  });

  it.each(Object.keys(pinned.folders))('%s: the art changes only with its version', (folder) => {
    const want = pinned.folders[folder]!;
    const sha = folderSha(folder);
    if (want.version === 'unserved') {
      expect(SERVED[folder], `${folder} is pinned as unserved but has a version`).toBeUndefined();
      expect(sha, `${folder} is unserved; refresh its sha to ${sha}`).toBe(want.sha);
      return;
    }
    const read = SERVED[folder];
    expect(read, `${folder} has no version reader in this test`).toBeDefined();
    const version = read!();
    if (sha !== want.sha && version === want.version) {
      throw new Error(
        `${folder} art changed but its href is still ?v=${version}: bump the version, then pin ` +
          JSON.stringify({ [folder]: { version: version + 1, sha } }),
      );
    }
    expect({ version, sha }, `refresh ${folder} in piece-art-fingerprints.json`).toEqual(want);
  });

  it('the share cards re-render when the art they draw changes', () => {
    const hash = createHash('sha256');
    for (const folder of pinned.og.folders) hash.update(folder).update(folderSha(folder));
    const sha = hash.digest('hex').slice(0, 16);
    const versions = ogVersions();
    if (sha !== pinned.og.sha) {
      const stale = Object.keys(versions).filter((k) => versions[k] === pinned.og.versions[k]);
      if (stale.length) {
        throw new Error(
          `the art on the share cards changed; bump ${stale.map((k) => OG_VERSIONS[k]![1]).join(', ')} ` +
            `(${stale.map((k) => OG_VERSIONS[k]![0]).join(', ')}), then pin og ` +
            JSON.stringify({ sha, versions }),
        );
      }
    }
    expect({ sha, versions }, 'refresh og in piece-art-fingerprints.json').toEqual({
      sha: pinned.og.sha,
      versions: pinned.og.versions,
    });
  });

  it('an unserved folder really is unreferenced, and served art always carries ?v=', () => {
    const unserved = Object.keys(pinned.folders).filter(
      (f) => pinned.folders[f]!.version === 'unserved',
    );
    const offenders: string[] = [];
    for (const file of [
      ...sourceFiles(path.join(ROOT, 'apps/web/src')),
      ...sourceFiles(path.join(ROOT, 'packages/board-render/src')),
    ]) {
      const src = readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file);
      for (const f of unserved) {
        if (src.includes(`piece-sets/${f}/`)) offenders.push(`${rel} reads unserved ${f}`);
      }
      // A literal art URL a browser loads must carry a version (template
      // hrefs built by the helpers above are checked through them).
      for (const m of src.matchAll(/\/piece-sets\/[\w/-]+\.(?:png|svg|webp)(?!\?v=)/g)) {
        offenders.push(`${rel}: ${m[0]} has no ?v=`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
