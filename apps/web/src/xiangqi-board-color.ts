// Board colour for the xiangqi family (2026-10-08, reworked the same day after
// Brian's review): a short row of muted, natural presets. The first two are the
// colours of the old International and Traditional boards, kept exactly, so
// folding those two themes into this row lost nothing. There is no free picker
// ("RGB selector is a bit too complex"). Pure colour math plus the preset table:
// no DOM, no storage.
//
// The reader picks only the fill. The two legacy presets carry their original
// ink; every other preset derives its ink (grid lines, palace diagonals, start
// brackets, river text, coordinates) from the fill, so the lines stay readable
// and keep the board's hue.
//
// Jungle is the one colour that is not a palette. It was a board tile of its own
// until Brian's third review (2026-10-08: "really just a reskin of the square
// grid"), so it is now the last swatch, offered only on the square grid: picking
// it turns on the Jungle theme (lawn, rugs, painted river; theme.ts), which has
// its own tokens in app-base.css. On the lined board it paints the default
// colour, and picking Lined while Jungle is chosen resets the colour (theme.ts).

export type XiangqiBoardColorPresetId =
  | 'international'
  | 'traditional'
  | 'paper'
  | 'birch'
  | 'oak'
  | 'grey'
  | 'slate'
  // Only offered behind ?boardgrain=1, for a taste call. Without the flag a
  // stored 'grain' renders as its plain fill.
  | 'grain';

/** The swatch that turns on the Jungle theme. Not a palette: see above. */
export const JUNGLE_XIANGQI_BOARD_COLOR = 'jungle';

export type XiangqiBoardColor = XiangqiBoardColorPresetId | typeof JUNGLE_XIANGQI_BOARD_COLOR;

/** The colour a browser gets before anyone picks one: the International board. */
export const DEFAULT_XIANGQI_BOARD_COLOR: XiangqiBoardColor = 'international';

export interface XiangqiBoardColorPreset {
  /** The panel labels a swatch with prefs.boardColor<Id> (theme-settings-panel.ts). */
  id: XiangqiBoardColorPresetId;
  fill: string;
  /** The ink, when it is not derived from the fill (the two legacy boards). */
  ink?: string;
  band?: string;
}

// Low saturation on purpose: each should read as a material (paper, wood,
// stone), never as a paint swatch. The default's ink and band are the same
// values app-base.css carries on :root.
export const XIANGQI_BOARD_COLOR_PRESETS: readonly XiangqiBoardColorPreset[] = [
  { id: 'international', fill: '#f5dca8', ink: '#5a3a14', band: 'rgba(90, 58, 20, 0.06)' },
  { id: 'traditional', fill: '#d9bd82', ink: '#4b3c2a', band: 'rgba(75, 60, 42, 0.07)' },
  { id: 'paper', fill: '#f3eee3' },
  { id: 'birch', fill: '#e9dcc0' },
  { id: 'oak', fill: '#c8a882' },
  { id: 'grey', fill: '#dadddf' },
  { id: 'slate', fill: '#454c54' },
];

const GRAIN_PRESET: XiangqiBoardColorPreset = { id: 'grain', fill: '#e2bf88' };

export function normalizeXiangqiBoardColor(value: string | null | undefined): XiangqiBoardColor {
  if (value === 'grain' || value === JUNGLE_XIANGQI_BOARD_COLOR) return value;
  const preset = XIANGQI_BOARD_COLOR_PRESETS.find((candidate) => candidate.id === value);
  return preset ? preset.id : DEFAULT_XIANGQI_BOARD_COLOR;
}

/** The preset a colour paints. Jungle paints no palette of its own (its theme
 *  carries the tokens), so on a board that cannot be Jungle it is the default. */
export function xiangqiBoardColorPreset(color: XiangqiBoardColor): XiangqiBoardColorPreset {
  if (color === 'grain') return GRAIN_PRESET;
  return (
    XIANGQI_BOARD_COLOR_PRESETS.find((preset) => preset.id === color) ??
    (XIANGQI_BOARD_COLOR_PRESETS[0] as XiangqiBoardColorPreset)
  );
}

export interface XiangqiBoardPalette {
  bg: string;
  ink: string;
  /** Faint ink for palace and river bands. */
  band: string;
  /** True when the fill is dark and the ink is light. */
  dark: boolean;
}

/** The fill, ink and band a preset paints. */
export function xiangqiBoardColorPalette(color: XiangqiBoardColor): XiangqiBoardPalette {
  const preset = xiangqiBoardColorPreset(color);
  const derived = xiangqiBoardPalette(preset.fill);
  return {
    ...derived,
    ink: preset.ink ?? derived.ink,
    band: preset.band ?? derived.band,
  };
}

// 6:1 between fill and ink. The coordinates draw the ink at 72% opacity and the
// lines are 1.2 units wide, so the ink needs headroom over the 4.5:1 text floor.
const TARGET_CONTRAST = 6;

/** Ink and band for a fill. Dark fills get light ink and light fills dark ink,
 *  each mixed from the fill itself so the lines keep the board's hue rather
 *  than going to a flat black or white. */
export function xiangqiBoardPalette(fill: string): XiangqiBoardPalette {
  const bg = parseHex(fill);
  const dark = contrastRatio(bg, WHITE) > contrastRatio(bg, BLACK);
  const toward = dark ? WHITE : BLACK;
  let ink = toward;
  for (let amount = 0.5; amount <= 1.0001; amount += 0.05) {
    const candidate = mix(bg, toward, Math.min(1, amount));
    if (contrastRatio(candidate, bg) >= TARGET_CONTRAST) {
      ink = candidate;
      break;
    }
  }
  return {
    bg: toHex(bg),
    ink: toHex(ink),
    band: `rgba(${ink.join(', ')}, ${dark ? 0.1 : 0.07})`,
    dark,
  };
}

type Rgb = readonly [number, number, number];
const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];
const HEX = /^#[0-9a-f]{6}$/i;

function parseHex(hex: string): Rgb {
  const value = HEX.test(hex) ? hex : '#f5dca8';
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * amount)) as unknown as Rgb;
}

/** WCAG relative luminance of an sRGB colour. */
export function relativeLuminance(color: string | Rgb): number {
  const rgb = typeof color === 'string' ? parseHex(color) : color;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1 to 21). */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
