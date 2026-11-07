import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { XIANGQI_MOTIFS, XIANGQI_TRAINING_TAGS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { GROUP_ICON, THEME_ICON_PATH, themeIconMarkup } from './theme-icons.js';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ART_DIR = 'puzzle-theme-icons';
type Group = keyof typeof GROUP_ICON;

/** Every row the themes page can show: the mix, each pattern, each training tag. */
const SHOWN: string[] = [
  'mix',
  ...XIANGQI_MOTIFS.map((motif) => motif.id),
  ...XIANGQI_TRAINING_TAGS.map((tag) => tag.id),
];
const GROUP = new Map<string, Group>([
  ['mix', 'mix'],
  ...XIANGQI_MOTIFS.map((motif): [string, Group] => [motif.id, 'motif']),
  ...XIANGQI_TRAINING_TAGS.map((tag): [string, Group] => [tag.id, tag.group]),
]);
const PATHS = THEME_ICON_PATH as Readonly<Record<string, string | undefined>>;

/** The ids whose path is not a PNG on disk under apps/web/public. */
function missingArt(paths: Readonly<Record<string, string | undefined>>): string[] {
  const missing: string[] = [];
  for (const [id, path] of Object.entries(paths)) {
    if (!path) continue;
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(PUBLIC, path));
    } catch {
      missing.push(id);
      continue;
    }
    if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) missing.push(id);
  }
  return missing;
}

describe('puzzle theme icons', () => {
  it('points every theme with art at a 256px PNG mask on disk, named by its id', () => {
    expect(Object.keys(PATHS).length).toBe(22);
    expect(missingArt(PATHS)).toEqual([]);
    for (const [id, path] of Object.entries(PATHS)) {
      expect(path, id).toBe(`/${ART_DIR}/${id}.png`);
      const bytes = readFileSync(join(PUBLIC, path as string));
      // IHDR: width and height are the big-endian u32s at bytes 16 and 20.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], id).toEqual([256, 256]);
    }
  });

  it('reports a planted id whose file does not exist', () => {
    expect(
      missingArt({ 'ma-hou-pao': PATHS['ma-hou-pao'], matein5: `/${ART_DIR}/matein5.png` }),
    ).toEqual(['matein5']);
  });

  it('has no art file on disk that no theme uses', () => {
    const used = new Set(Object.values(PATHS).map((path) => path?.split('/').pop()));
    const files = readdirSync(join(PUBLIC, ART_DIR)).filter((name) => name.endsWith('.png'));
    expect(files.filter((name) => !used.has(name))).toEqual([]);
  });

  it('gives art only to real theme ids', () => {
    const known = new Set(SHOWN);
    expect(Object.keys(PATHS).filter((id) => !known.has(id))).toEqual([]);
  });

  it('renders every shown theme as its art or its group icon, never nothing', () => {
    expect(SHOWN.length).toBe(37);
    for (const id of SHOWN) {
      const group = GROUP.get(id);
      if (!group) throw new Error(`${id} has no group`);
      expect(GROUP_ICON[group].length, id).toBeGreaterThan(0);
      const { markup, own } = themeIconMarkup(id, group);
      const path = PATHS[id];
      if (path) {
        expect(own, id).toBe(true);
        expect(markup, id).toContain('class="variant-marker"');
        expect(markup, id).toContain(`url('${path}')`);
      } else {
        expect(own, id).toBe(false);
        expect(markup, id).toContain(GROUP_ICON[group]);
      }
    }
  });

  it("falls back to the group's line icon for an id with no art", () => {
    const fallback = themeIconMarkup('matein5', 'mate');
    expect(fallback.own).toBe(false);
    expect(fallback.markup).toContain('<svg');
    expect(fallback.markup).toContain(GROUP_ICON.mate);
    expect(themeIconMarkup('matein2', 'mate').own).toBe(true);
  });
});
