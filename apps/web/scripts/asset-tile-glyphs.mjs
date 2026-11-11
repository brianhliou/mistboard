#!/usr/bin/env node
// Splits each third-party xiangqi piece set into the two layers a Xiangqi
// Mahjong tile needs: the character alone, and the disc's surface (lacquer,
// wood grain, paper, ground) to lay over the whole tile face.
//
//   node apps/web/scripts/asset-tile-glyphs.mjs          write the files
//   node apps/web/scripts/asset-tile-glyphs.mjs --check  exit 1 if stale
//
// Input:  apps/web/public/piece-sets/xiangqi/<set>/<color>-<role>.svg
// Output: apps/web/public/piece-sets/xiangqi/<set>/tile/<color>-<role>.svg
//         (the character, in the source's viewBox, so it sits where it sat
//         on the disc) and <set>/tile/<color>-face.svg (the general's file
//         with the character removed, its viewBox cropped to a square inside
//         the disc's rim, so it can cover a tile of any shape).
//
// Each set bakes disc and character into one file, laid out differently, so
// each has its own rule below naming the character's elements. Never edit the
// outputs by hand: change a rule here and re-run.
// `src/asset-tile-glyphs.test.ts` re-derives every file and fails when a
// committed one differs.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASSET_TILE_GLYPH_SETS = ['lacquer', 'wood', 'book', 'brush', 'clerical'];
export const ASSET_TILE_GLYPH_COLORS = ['red', 'black'];
export const ASSET_TILE_GLYPH_ROLES = [
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
  'cannon',
  'soldier',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFS = 'linearGradient, radialGradient, filter, clipPath, mask';

function removeAll(nodes) {
  for (const node of [...nodes]) node.parentNode?.removeChild(node);
}

function drawing(svg) {
  // Every element that draws, i.e. not the gradient/filter definitions.
  return [...svg.querySelectorAll('*')].filter(
    (el) => !el.closest(`defs, ${DEFS}`) && el.tagName.toLowerCase() !== 'stop',
  );
}

/**
 * Per set: the character's elements, and the half side of the face square as
 * a share of the viewBox width (the disc is centred in the viewBox; the
 * square stays inside its rim).
 */
export const ASSET_TILE_RULES = {
  // Shadow circle, disc, gloss, rim and inner disc, then one white character.
  lacquer: { glyph: (svg) => [...svg.querySelectorAll('path')].slice(-1), faceHalf: 0.25 },
  // Disc grain, rims and a highlight, then a white cut and the inked character
  // (the last two paths, inside a group or not).
  wood: { glyph: (svg) => [...svg.querySelectorAll('path')].slice(-2), faceHalf: 0.22 },
  // Disc, ring (both the same outline), then the character.
  book: { glyph: (svg) => [...svg.querySelectorAll('path')].slice(-1), faceHalf: 0.28 },
  // One disc circle; everything else drawn is the character (a group with its
  // own inset filter, or bare paths).
  brush: { glyph: (svg) => besideDisc(svg), faceHalf: 0.3 },
  clerical: { glyph: (svg) => besideDisc(svg), faceHalf: 0.3 },
};

function besideDisc(svg) {
  const top = [...svg.children].filter((el) => drawing(svg).includes(el));
  const discs = top.filter((el) => el.tagName.toLowerCase() === 'circle');
  if (discs.length !== 1) throw new Error(`expected one disc circle, found ${discs.length}`);
  return top.filter((el) => el !== discs[0]);
}

function parse(set, source, parser) {
  if (!ASSET_TILE_RULES[set]) throw new Error(`no tile rule for set ${set}`);
  const doc = parser.parseFromString(source, 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.namespaceURI !== SVG_NS || svg.tagName.toLowerCase() !== 'svg') {
    throw new Error(`${set}: not an SVG document`);
  }
  const glyph = ASSET_TILE_RULES[set].glyph(svg);
  if (glyph.length === 0) throw new Error(`${set}: no character found`);
  return { svg, glyph };
}

function tidy(svg, serializer) {
  // Drop the definitions nothing draws with any more (a gradient may point at
  // another, so repeat until none goes), then empty groups.
  for (let pass = 0; pass < 8; pass++) {
    const text = serializer.serializeToString(svg);
    const unused = [...svg.querySelectorAll(DEFS)].filter((def) => {
      const id = def.getAttribute('id');
      return !id || (!text.includes(`url(#${id})`) && !text.includes(`href="#${id}"`));
    });
    if (unused.length === 0) break;
    removeAll(unused);
  }
  for (let pass = 0; pass < 8; pass++) {
    const empty = [...svg.querySelectorAll('g, defs')].filter((el) => el.children.length === 0);
    if (empty.length === 0) break;
    removeAll(empty);
  }
  return `${serializer
    .serializeToString(svg)
    .replace(/>\s+</g, '><')
    .replace(/<!--[\s\S]*?-->/g, '')}\n`;
}

/**
 * The character layer of one piece file. `parser` and `serializer` are a
 * DOMParser and XMLSerializer (the browser's, or happy-dom's in Node).
 */
export function extractTileGlyph(set, source, parser, serializer) {
  const { svg, glyph } = parse(set, source, parser);
  const keep = new Set();
  for (const root of glyph) {
    keep.add(root);
    for (const el of root.querySelectorAll('*')) keep.add(el);
    for (let node = root.parentNode; node && node !== svg; node = node.parentNode) keep.add(node);
  }
  removeAll(drawing(svg).filter((el) => !keep.has(el)));
  return tidy(svg, serializer);
}

/** The disc's surface with no character, cropped to a square inside the rim. */
export function extractTileFace(set, source, parser, serializer) {
  const { svg, glyph } = parse(set, source, parser);
  removeAll(glyph);
  const [x, y, w, h] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (![x, y, w, h].every(Number.isFinite)) throw new Error(`${set}: no viewBox`);
  const half = w * ASSET_TILE_RULES[set].faceHalf;
  const round = (v) => Math.round(v * 1000) / 1000;
  svg.setAttribute(
    'viewBox',
    [x + w / 2 - half, y + h / 2 - half, 2 * half, 2 * half].map(round).join(' '),
  );
  return tidy(svg, serializer);
}

const HEADER = (set, what, from) =>
  `<!-- Mistboard tile layer: the ${set} set's ${what}, derived by apps/web/scripts/asset-tile-glyphs.mjs from ../${from}; the source file's comment and README hold its origin and licence. -->\n`;

export function tileGlyphFile(set, name, source, parser, serializer) {
  return (
    HEADER(set, 'character with its disc removed', name) +
    extractTileGlyph(set, source, parser, serializer)
  );
}

export function tileFaceFile(set, name, source, parser, serializer) {
  return (
    HEADER(set, 'disc surface with the character removed, cropped inside the rim', name) +
    extractTileFace(set, source, parser, serializer)
  );
}

/** Every derived file: [set, output name, source name, builder]. */
export function tileLayerFiles() {
  const files = [];
  for (const set of ASSET_TILE_GLYPH_SETS) {
    for (const color of ASSET_TILE_GLYPH_COLORS) {
      for (const role of ASSET_TILE_GLYPH_ROLES) {
        files.push([set, `${color}-${role}.svg`, `${color}-${role}.svg`, tileGlyphFile]);
      }
      files.push([set, `${color}-face.svg`, `${color}-general.svg`, tileFaceFile]);
    }
  }
  return files;
}

export function piecesDir(webRoot) {
  return join(webRoot, 'public', 'piece-sets', 'xiangqi');
}

async function main() {
  const { Window } = await import('happy-dom');
  const window = new Window();
  const parser = new window.DOMParser();
  const serializer = new window.XMLSerializer();
  const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
  const check = process.argv.includes('--check');
  const stale = [];
  for (const [set, name, from, build] of tileLayerFiles()) {
    const dir = join(piecesDir(webRoot), set);
    mkdirSync(join(dir, 'tile'), { recursive: true });
    const out = build(set, from, readFileSync(join(dir, from), 'utf8'), parser, serializer);
    const target = join(dir, 'tile', name);
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {}
    if (current === out) continue;
    if (check) stale.push(`${set}/tile/${name}`);
    else writeFileSync(target, out);
  }
  await window.happyDOM.close();
  if (stale.length) {
    console.error(`stale tile layers (run the script): ${stale.join(', ')}`);
    process.exit(1);
  }
  console.log(check ? 'tile layers up to date' : 'tile layers written');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
