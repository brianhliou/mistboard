// River text (2026-10-08): what the lined board prints in the river, as its own
// switch in the gear's Board panel. It used to ride on the Traditional board
// theme (a darker board that also showed 楚河 漢界); Brian: "it's just
// inconsistent how we present these options", and the river is a place to
// brand the board with our own name. So three choices, each doing one thing:
// nothing, the classic inscription, or the Mistboard wordmark.
//
// Every renderer draws both captions and CSS shows the chosen one
// (--xq-river-label-display / --xq-river-brand-display, app-base.css), so a
// change needs no re-render and static article diagrams follow it too.

export type XiangqiRiverText = 'off' | 'classic' | 'brand';

export const XIANGQI_RIVER_TEXTS: readonly XiangqiRiverText[] = ['off', 'classic', 'brand'];

/** Before anyone picks: no river text, which is what the default board showed. */
export const DEFAULT_XIANGQI_RIVER_TEXT: XiangqiRiverText = 'off';

/** The wordmark. Set in title case, large and lightly tracked so it fills the
 *  river the way 楚河 漢界 does (Brian, 2026-10-08: the spaced capitals looked
 *  "a little bit too clinical and not big enough"). Style 'a' (the default) is a
 *  serif; the alternate 'b' (?xqRiverStyle=b) is the site's nav wordmark, Noto
 *  Sans in lower case. Both are CSS on the same text (live-xiangqi.css,
 *  articles.css). */
export const XIANGQI_RIVER_BRAND_TEXT = 'Mistboard';

/** The brand caption's letter-spacing as a fraction of its font size. SVG adds
 *  the spacing after the last letter too, which pulls centred text left by half
 *  of it, so renderers shift the caption right by that much. */
export const XIANGQI_RIVER_BRAND_TRACKING = 0.04;

/** The brand caption's size relative to the classic inscription's. */
export const XIANGQI_RIVER_BRAND_SCALE = 1.45;

export function normalizeXiangqiRiverText(value: string | null | undefined): XiangqiRiverText {
  return XIANGQI_RIVER_TEXTS.includes(value as XiangqiRiverText)
    ? (value as XiangqiRiverText)
    : DEFAULT_XIANGQI_RIVER_TEXT;
}

/** The inscription as real boards set it (Brian picked it from a sheet of five,
 *  2026-10-29): each pair near its own edge, one character to a square, 漢界
 *  turned to face the far player, in old printed type. Offsets are in cells from
 *  the river's centre; true turns the character 180 degrees. */
const RIVER_CHARACTERS: readonly [string, number, boolean][] = [
  ['楚', -2.5, false],
  ['河', -1.5, false],
  ['界', 1.5, true],
  ['漢', 2.5, true],
];

/** Character height as a share of the cell. */
export const XIANGQI_RIVER_CHARACTER_SCALE = 0.7;

/** A four-character cut of Zen Antique (app-base.css, public/fonts), so every
 *  device draws the same old printed type; the system Song faces follow. */
export const XIANGQI_RIVER_FONT_FAMILY =
  "'Mistboard River', 'Songti TC', 'STSong', 'SimSun', serif";

/** The "Mistboard" caption in the same cut (it carries the nine letters), so
 *  the two river choices share one face; Georgia follows, not a Song face's
 *  Latin. */
export const XIANGQI_RIVER_BRAND_FONT_FAMILY = "'Mistboard River', ui-serif, Georgia, serif";

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** The four characters around the river's centre (x, y), each a <text> with
 *  `attrs`. The caller's stylesheet or attrs set the font. */
export function xiangqiRiverCharacters(x: number, y: number, cell: number, attrs: string): string {
  return RIVER_CHARACTERS.map(([char, offset, turned]) => {
    const cx = round1(x + offset * cell);
    const turn = turned ? ` transform="rotate(180 ${cx} ${y})"` : '';
    return `<text ${attrs} x="${cx}" y="${y}"${turn}>${char}</text>`;
  }).join('');
}

/** Both captions for the article and replay diagrams, centred on (x, y) on a
 *  board of `cell` units a square. The stylesheet (articles.css) shows at most
 *  one of them. The wordmark carries translate="no": it is the site's name, so
 *  the zh label swap and the translation coverage gates (articles/svg-labels.ts)
 *  skip it. */
export function xiangqiDiagramRiverText(x: number, y: number, cell: number, fontSize = 16): string {
  const brandSize = Math.round(fontSize * XIANGQI_RIVER_BRAND_SCALE * 10) / 10;
  const tracking = Math.round(brandSize * XIANGQI_RIVER_BRAND_TRACKING * 10) / 10;
  const labelFont = XIANGQI_RIVER_FONT_FAMILY.replaceAll("'", '&quot;');
  const brandFont = XIANGQI_RIVER_BRAND_FONT_FAMILY.replaceAll("'", '&quot;');
  return (
    xiangqiRiverCharacters(
      x,
      y,
      cell,
      `font-family="${labelFont}" font-size="${round1(cell * XIANGQI_RIVER_CHARACTER_SCALE)}" font-weight="700" class="xq-diagram-ink xq-diagram-river-label" text-anchor="middle" dominant-baseline="central"`,
    ) +
    `<text x="${Math.round((x + tracking / 2) * 10) / 10}" y="${y}" font-family="${brandFont}" font-size="${brandSize}" font-weight="700" letter-spacing="${tracking}" class="xq-diagram-ink xq-diagram-river-brand" translate="no" text-anchor="middle" dominant-baseline="central">${XIANGQI_RIVER_BRAND_TEXT}</text>`
  );
}
