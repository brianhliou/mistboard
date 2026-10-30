import { XIANGQI_MOTIFS, XIANGQI_TRAINING_TAGS } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { GROUP_ICON, missingThemeIcons, THEME_ICON, themeIconMarkup } from './theme-icons.js';

const ALL_IDS = [
  ...XIANGQI_MOTIFS.map((motif) => motif.id),
  ...XIANGQI_TRAINING_TAGS.map((tag) => tag.id),
];

/** Theme ids grouped as the themes page groups them. */
const GROUPS: Record<string, string[]> = {
  motif: XIANGQI_MOTIFS.map((motif) => motif.id),
};
for (const tag of XIANGQI_TRAINING_TAGS) {
  const ids = GROUPS[tag.group] ?? [];
  ids.push(tag.id);
  GROUPS[tag.group] = ids;
}

/** Pairs of ids in one group whose drawings are the same markup. */
function sharedDrawings(
  icons: Readonly<Record<string, string>>,
  groups: Record<string, string[]>,
): string[] {
  const shared: string[] = [];
  for (const ids of Object.values(groups)) {
    const seen = new Map<string, string>();
    for (const id of ids) {
      const markup = icons[id];
      if (markup === undefined) continue;
      const first = seen.get(markup);
      if (first) shared.push(`${first}=${id}`);
      else seen.set(markup, id);
    }
  }
  return shared;
}

/** Drawn points (circle edges, path move and line points) that reach past the ring's inside. */
function outsideRing(markup: string, limit = 43): string[] {
  const out: string[] = [];
  for (const [, cx, cy, r] of markup.matchAll(/cx="([\d.-]+)" cy="([\d.-]+)" r="([\d.]+)"/g)) {
    if (Math.hypot(Number(cx) - 50, Number(cy) - 50) + Number(r) > limit)
      out.push(`circle ${cx},${cy}`);
  }
  for (const [, x, y] of markup.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)) {
    if (Math.hypot(Number(x) - 50, Number(y) - 50) > limit) out.push(`point ${x},${y}`);
  }
  return out;
}

describe('puzzle theme icons', () => {
  it('draws every pattern and every training tag', () => {
    expect(ALL_IDS.length).toBe(36);
    expect(missingThemeIcons(ALL_IDS)).toEqual([]);
  });

  it('flags a planted id with no drawing', () => {
    // A tag added to the game package without a drawing must fail here, not
    // quietly wear its group's icon on the page.
    expect(missingThemeIcons(['ma-hou-pao', 'matein5'])).toEqual(['matein5']);
  });

  it("falls back to the group's icon for an id with no drawing", () => {
    expect(themeIconMarkup('matein5', 'mate')).toEqual({ markup: GROUP_ICON.mate, own: false });
    expect(themeIconMarkup('matein2', 'mate')).toEqual({ markup: THEME_ICON.matein2, own: true });
    expect(themeIconMarkup('mix', 'mix')).toEqual({ markup: GROUP_ICON.mix, own: false });
  });

  it('gives no two themes in a group the same drawing', () => {
    expect(sharedDrawings(THEME_ICON, GROUPS)).toEqual([]);
  });

  it('flags a planted pair of identical drawings', () => {
    const planted = { ...THEME_ICON, 'chong-pao': THEME_ICON['ma-hou-pao'] };
    expect(sharedDrawings(planted, GROUPS)).toEqual(['chong-pao=ma-hou-pao']);
  });

  it('keeps every drawing a line drawing inside the ring, with no text', () => {
    for (const id of ALL_IDS) {
      const markup = THEME_ICON[id];
      expect(markup, id).not.toMatch(/<text|<image|<foreignObject/);
      expect(markup, id).not.toBe(GROUP_ICON.motif);
      expect(outsideRing(markup), id).toEqual([]);
    }
  });

  it('flags a planted mark past the ring', () => {
    expect(outsideRing('<circle cx="90" cy="50" r="5" fill="currentColor"/>')).toEqual([
      'circle 90,50',
    ]);
    expect(outsideRing('<path d="M50 50 L50 96"/>')).toEqual(['point 50,96']);
  });
});
