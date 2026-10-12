#!/usr/bin/env node
// Harvest player portraits from xiangqiqipu.com (永乐象棋棋谱网) for the
// /players/<slug> pages, under the owner's permission of 2026-10-11 ("可以，
// 需要注明出处，并做链接": credit the source and link to it). Record:
// docs-private/broadcast-outreach.md §7; survey: issue #452.
//
// Matching is by exact Chinese name, and only when the name is unique on both
// sides: one player of ours, one player page of theirs. Then the detail page's
// <h1> must read the same name, and the men's/women's tab it is listed under
// must agree with our events. Anything else is skipped and listed, never
// guessed. Players with an authored photo (players/profiles.ts) are skipped:
// the authored photo wins.
//
// Politeness: sequential requests, one second apart, a clear User-Agent, and
// images already on disk are not fetched again (--refresh re-fetches them).
//
// Images: kept byte for byte when the source is already a small JPEG (long
// side <= 400 px, <= 48 KB), else scaled once to 320 px on the long side with
// macOS `sips`. Never resampled from an earlier output.
//
// Writes apps/web/public/player-photos/<slug>.jpg and the data file
// apps/web/src/players/xiangqiqipu-photos.ts (generated; do not hand-edit).
//
//   node scripts/harvest-player-photos.mjs            # harvest, write both
//   node scripts/harvest-player-photos.mjs --dry-run  # match and report only
//   node scripts/harvest-player-photos.mjs --check    # every entry is a live slug
//                                                      # with the same Chinese name
//   node scripts/harvest-player-photos.mjs --roster <file|url>  # default: prod API

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PHOTO_DIR = join(ROOT, 'apps/web/public/player-photos');
const PHOTO_URL_BASE = '/player-photos';
const DATA_FILE = join(ROOT, 'apps/web/src/players/xiangqiqipu-photos.ts');
const PROFILES_FILE = join(ROOT, 'apps/web/src/players/profiles.ts');
const SITE = 'https://www.xiangqiqipu.com';
const USER_AGENT = 'MistboardPlayerPhotos/1.0 (+https://mistboard.com/players)';
const PERMISSION_DATE = '2026-10-11';
const DELAY_MS = 1000;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const refresh = args.includes('--refresh');
const checkOnly = args.includes('--check');
const rosterArg = args.includes('--roster')
  ? args[args.indexOf('--roster') + 1]
  : 'https://mistboard.com/api/xiangqi/players';

let lastRequestAt = 0;
async function politeFetch(url, referer) {
  const wait = lastRequestAt + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  const headers = { 'User-Agent': USER_AGENT };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

async function loadRoster() {
  if (/^https?:/.test(rosterArg)) {
    const res = await fetch(rosterArg, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`roster ${rosterArg}: HTTP ${res.status}`);
    return (await res.json()).players;
  }
  return JSON.parse(readFileSync(rosterArg, 'utf8')).players;
}

/** Slugs with an authored photo in profiles.ts; the authored photo wins. */
function authoredPhotoSlugs() {
  const src = readFileSync(PROFILES_FILE, 'utf8');
  const slugs = new Set();
  for (const m of src.matchAll(/'([a-z0-9-]+)':\s*\{\s*photo:/g)) slugs.add(m[1]);
  return slugs;
}

/** Their list page: name -> [{ id, group }], one entry per distinct id. */
function parseList(html) {
  const womanAt = html.indexOf('id="woman"');
  const byName = new Map();
  for (const m of html.matchAll(/<a href="\/Player\/View-(\d+)\.html">([^<]+)<\/a>/g)) {
    const id = Number(m[1]);
    const name = m[2].trim();
    const group = womanAt >= 0 && m.index > womanAt ? 'women' : 'men';
    const list = byName.get(name) ?? [];
    if (!list.some((e) => e.id === id)) list.push({ id, group });
    byName.set(name, list);
  }
  return byName;
}

/** Our side's group, from the events: all women's events => women. */
function ourGroup(player) {
  const names = player.events.map((e) => e.tourName);
  if (names.length === 0) return null;
  if (names.every((n) => n.includes('女'))) return 'women';
  if (names.every((n) => !n.includes('女'))) return 'men';
  return null;
}

/** The portrait: the first upload image after the page's <h1>. */
function parseDetail(html) {
  const h1 = html.match(/<h1>([^<]+)<\/h1>/);
  if (!h1) return null;
  const after = html.slice(h1.index, h1.index + 2000);
  const img = after.match(/<img src="((?:https?:)?\/\/static\.xiangqiqipu\.com\/Uploads\/[^"]+)"/);
  return {
    name: h1[1].trim(),
    image: img ? (img[1].startsWith('//') ? `https:${img[1]}` : img[1]) : null,
  };
}

function imageSize(file) {
  const out = execFileSync(
    'sips',
    ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', file],
    {
      encoding: 'utf8',
    },
  );
  const num = (k) => Number(out.match(new RegExp(`${k}: (\\d+)`))?.[1] ?? 0);
  return {
    width: num('pixelWidth'),
    height: num('pixelHeight'),
    format: out.match(/format: (\w+)/)?.[1],
  };
}

/** One pass from the source: keep a small JPEG as is, else scale to 320. */
function writeWebImage(source, target) {
  const { width, height, format } = imageSize(source);
  const long = Math.max(width, height);
  const bytes = statSync(source).size;
  if (format === 'jpeg' && long <= 400 && bytes <= 48 * 1024) {
    writeFileSync(target, readFileSync(source));
    return { width, height, kept: true };
  }
  const opts = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80'];
  if (long > 320) opts.unshift('-Z', '320');
  execFileSync('sips', [...opts, source, '--out', target], { stdio: 'ignore' });
  const out = imageSize(target);
  return { width: out.width, height: out.height, kept: false };
}

function tsString(s) {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function writeDataFile(entries) {
  const lines = [
    '// Generated by scripts/harvest-player-photos.mjs; do not hand-edit (re-run the',
    '// script). Portraits from xiangqiqipu.com (永乐象棋棋谱网), used with the',
    "// owner's permission of 2026-10-11 on condition of a credit and a link per",
    '// photo (docs-private/broadcast-outreach.md §7). The player page renders',
    '// both under the photo; a list of players carries one credit line, linked',
    '// to the site, for the photos in its rows.',
    '',
    'export type SourcedPlayerPhoto = {',
    '  slug: string;',
    '  /** Chinese name, as both sites spell it. */',
    '  name: string;',
    '  xiangqiqipuId: number;',
    "  /** The player's page on xiangqiqipu.com; the credit links here. */",
    '  sourceUrl: string;',
    '  photo: string;',
    '  width: number;',
    '  height: number;',
    '  credit: string;',
    '  permission: string;',
    '};',
    '',
    `export const XIANGQIQIPU_CREDIT = ${tsString('永乐象棋棋谱网')};`,
    '',
    'export const XIANGQIQIPU_PHOTOS: readonly SourcedPlayerPhoto[] = [',
  ];
  for (const e of entries) {
    lines.push(
      '  {',
      `    slug: ${tsString(e.slug)},`,
      `    name: ${tsString(e.name)},`,
      `    xiangqiqipuId: ${e.id},`,
      `    sourceUrl: ${tsString(e.sourceUrl)},`,
      `    photo: ${tsString(e.photo)},`,
      `    width: ${e.width},`,
      `    height: ${e.height},`,
      '    credit: XIANGQIQIPU_CREDIT,',
      `    permission: ${tsString(PERMISSION_DATE)},`,
      '  },',
    );
  }
  lines.push('];', '');
  writeFileSync(DATA_FILE, lines.join('\n'));
}

function existingEntries() {
  if (!existsSync(DATA_FILE)) return new Map();
  const src = readFileSync(DATA_FILE, 'utf8');
  const map = new Map();
  const re =
    /slug: '([^']+)',\s*name: '([^']+)',\s*xiangqiqipuId: (\d+),\s*sourceUrl: '([^']+)',\s*photo: '([^']+)',\s*width: (\d+),\s*height: (\d+),/g;
  for (const m of src.matchAll(re)) {
    map.set(m[1], {
      slug: m[1],
      name: m[2],
      id: Number(m[3]),
      sourceUrl: m[4],
      photo: m[5],
      width: Number(m[6]),
      height: Number(m[7]),
    });
  }
  return map;
}

/** No roster lives in the repo, so the slug check runs against the live one. */
function check(roster) {
  const bySlug = new Map(roster.map((p) => [p.slug, p]));
  const bad = [];
  const entries = [...existingEntries().values()];
  for (const e of entries) {
    const player = bySlug.get(e.slug);
    if (!player) bad.push(`${e.slug}: no such player`);
    else if (player.name !== e.name) bad.push(`${e.slug}: is ${player.name}, entry says ${e.name}`);
  }
  console.log(
    `${entries.length - bad.length} of ${entries.length} entries resolve to live players`,
  );
  for (const b of bad) console.log(`  ${b}`);
  if (bad.length > 0) process.exitCode = 1;
}

async function main() {
  const roster = await loadRoster();
  if (checkOnly) return check(roster);
  const authored = authoredPhotoSlugs();
  const previous = existingEntries();
  const listUrl = `${SITE}/Player.html`;
  const theirs = parseList(await (await politeFetch(listUrl)).text());

  const ourByName = new Map();
  for (const p of roster) ourByName.set(p.name, [...(ourByName.get(p.name) ?? []), p]);

  const skipped = [];
  const candidates = [];
  for (const [name, ours] of ourByName) {
    const found = theirs.get(name);
    if (!found) continue; // not on their site: the tile stays
    if (ours.length > 1) {
      skipped.push(`${name}: ${ours.length} players of ours share the name`);
      continue;
    }
    if (found.length > 1) {
      skipped.push(`${name}: ${found.length} xiangqiqipu pages share the name`);
      continue;
    }
    const player = ours[0];
    if (authored.has(player.slug)) {
      skipped.push(`${name} (${player.slug}): has an authored photo`);
      continue;
    }
    const group = ourGroup(player);
    if (group && group !== found[0].group) {
      skipped.push(`${name}: listed under ${found[0].group} there, ${group} here`);
      continue;
    }
    candidates.push({ player, id: found[0].id });
  }
  console.log(`matched ${candidates.length} of ${roster.length} players by unique name`);
  if (dryRun) {
    for (const c of candidates) console.log(`  ${c.player.slug} -> View-${c.id}`);
    for (const s of skipped) console.log(`skip ${s}`);
    return;
  }

  mkdirSync(PHOTO_DIR, { recursive: true });
  const work = join(tmpdir(), `mistboard-player-photos-${process.pid}`);
  mkdirSync(work, { recursive: true });
  const entries = [];
  try {
    for (const { player, id } of candidates) {
      const sourceUrl = `${SITE}/Player/View-${id}.html`;
      const target = join(PHOTO_DIR, `${player.slug}.jpg`);
      const prior = previous.get(player.slug);
      if (!refresh && prior && prior.id === id && existsSync(target)) {
        entries.push(prior);
        continue;
      }
      const detail = parseDetail(await (await politeFetch(sourceUrl, listUrl)).text());
      if (!detail || detail.name !== player.name) {
        skipped.push(`${player.name}: View-${id} reads "${detail?.name ?? '?'}"`);
        continue;
      }
      if (!detail.image) {
        skipped.push(`${player.name}: View-${id} has no portrait`);
        continue;
      }
      const raw = join(work, `${player.slug}.src`);
      const res = await politeFetch(detail.image, sourceUrl);
      writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
      const { width, height } = writeWebImage(raw, target);
      entries.push({
        slug: player.slug,
        name: player.name,
        id,
        sourceUrl,
        photo: `${PHOTO_URL_BASE}/${player.slug}.jpg`,
        width,
        height,
      });
      console.log(`  ${player.slug} <- View-${id} (${width}x${height})`);
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  entries.sort((a, b) => a.slug.localeCompare(b.slug));
  writeDataFile(entries);
  const bytes = entries.reduce((n, e) => n + statSync(join(PHOTO_DIR, `${e.slug}.jpg`)).size, 0);
  console.log(`wrote ${entries.length} photos, ${(bytes / 1024).toFixed(0)} KB total`);
  for (const s of skipped) console.log(`skip ${s}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
