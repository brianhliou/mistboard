// The text cards on the articles index: three lines of type in place of a board.
//
//   eyebrow   the game, small and faint        XIANGQI / JUNGLE CHESS
//   lead      what the article is about, big   CHAMPIONS / KATAGO
//   tagline   one quieter line                  EVERY NATIONAL TITLE
//   footer    optional, quieter still           SINCE 1956
//
// Every word is in the page's language (2026-10-03). Until then each card put a
// hanzi eyebrow over the English mark on English pages, which read as a bug to an
// English reader, and three cards were hand-copied markup that had drifted apart.
// The one exception is a lead that is a name with no Chinese form (KataGo,
// AB-JChess): `name: true` keeps it as written in every language.
//
// The words are English source strings; a zh card looks them up in the article
// dictionary here, so the builder knows the final text and can fit it to the
// card. A missing key leaves English behind, which the index-card coverage gate
// reads as untranslated. A derived (Vietnamese) page draws the English card and
// substitutes its own dictionary, so nothing here is marked translate="no" except
// a name.
import { translateArticleText } from '../article-i18n.js';
import type { Locale } from '../i18n/locale.js';

export const CARD_HANZI_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif";
export const CARD_LATIN_FONT = 'Roboto, system-ui, sans-serif';

export const CARD_WIDTH = 320;
export const CARD_HEIGHT = 200;
/** Widest a line may run: the card less a 16px margin each side. */
export const CARD_TEXT_MAX_WIDTH = CARD_WIDTH - 32;

// One palette per game, so a card sits next to that game's board thumbnails.
const PALETTES = {
  xiangqi: { bg: 'var(--xq-diagram-bg, #d9bd82)', ink: '#b9832f', quiet: '#5a4626' },
  jungle: { bg: '#dfe8cf', ink: '#1f6f5b', quiet: '#2d4a3a' },
} as const;

export type TextCardPalette = keyof typeof PALETTES;

export type TextCardSpec = {
  palette: TextCardPalette;
  /** The game, e.g. 'XIANGQI'. English source; translated on zh pages. */
  eyebrow: string;
  /** The subject. English source, unless `name` keeps it as written everywhere. */
  lead: string | { text: string; name: true };
  tagline: string;
  footer?: string;
  /** Extra SVG drawn under the text (the jieqi disc row); the text moves up and
   *  there is no room for a footer. */
  art?: string;
  /** English source for the card's accessible name. */
  ariaLabel: string;
};

type Role = 'eyebrow' | 'lead' | 'tagline' | 'footer';
type LineStyle = { size: number; spacing: number; weight: number };

// Sizes per script: hanzi sets larger and looser than caps at the same weight.
const STYLES: Record<Role, { latin: LineStyle; han: LineStyle }> = {
  eyebrow: {
    latin: { size: 20, spacing: 5, weight: 700 },
    han: { size: 24, spacing: 8, weight: 700 },
  },
  lead: {
    latin: { size: 40, spacing: 0, weight: 700 },
    han: { size: 46, spacing: 8, weight: 700 },
  },
  tagline: {
    latin: { size: 15, spacing: 1.4, weight: 600 },
    han: { size: 16, spacing: 3, weight: 600 },
  },
  footer: {
    latin: { size: 12, spacing: 2.4, weight: 400 },
    han: { size: 13, spacing: 2, weight: 400 },
  },
};

const HAN = /\p{Script=Han}/u;

/** Rough advance of `text` in em, per character class. Errs wide for caps. */
function advanceEm(text: string): number {
  let em = 0;
  for (const ch of text) {
    if (HAN.test(ch)) em += 1;
    else if (ch === ' ') em += 0.26;
    else if (/[A-Z0-9%]/.test(ch)) em += 0.68;
    else if (/[a-z]/.test(ch)) em += 0.55;
    else em += 0.32;
  }
  return em;
}

/** Estimated rendered width of a line, letter-spacing included. */
export function estimateLineWidth(text: string, style: { size: number; spacing: number }): number {
  const chars = [...text].length;
  return advanceEm(text) * style.size + Math.max(0, chars - 1) * style.spacing;
}

/** Shrink a style until the line fits the card; never grows it. */
function fit(text: string, style: LineStyle): LineStyle {
  const width = estimateLineWidth(text, style);
  if (width <= CARD_TEXT_MAX_WIDTH) return style;
  const scale = CARD_TEXT_MAX_WIDTH / width;
  return {
    ...style,
    size: Math.floor(style.size * scale * 10) / 10,
    spacing: Math.floor(style.spacing * scale * 10) / 10,
  };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type TextCardLine = {
  role: Role;
  text: string;
  y: number;
  style: LineStyle;
  /** Kept as written in every language (translate="no"). */
  name: boolean;
};

/** The lines a card draws for `locale`, already translated and fitted. */
export function textCardLines(spec: TextCardSpec, locale: Locale = 'en'): TextCardLine[] {
  const zh = locale === 'zh-Hans' || locale === 'zh-Hant' ? locale : undefined;
  const say = (english: string): string => translateArticleText(zh, english);
  const lead =
    typeof spec.lead === 'string'
      ? { text: say(spec.lead), name: false }
      : { text: spec.lead.text, name: true };
  // Baselines: the art row pushes everything up; a footer needs the bottom band.
  const ys: Record<Role, number> = spec.art
    ? { eyebrow: 52, lead: 106, tagline: 136, footer: 0 }
    : spec.footer
      ? { eyebrow: 58, lead: 112, tagline: 146, footer: 174 }
      : { eyebrow: 64, lead: 120, tagline: 154, footer: 0 };
  const rows: Array<{ role: Role; text: string; name: boolean }> = [
    { role: 'eyebrow', text: say(spec.eyebrow), name: false },
    { role: 'lead', ...lead },
    { role: 'tagline', text: say(spec.tagline), name: false },
  ];
  if (spec.footer && !spec.art) rows.push({ role: 'footer', text: say(spec.footer), name: false });
  return rows.map((row) => {
    const script = HAN.test(row.text) ? 'han' : 'latin';
    return { ...row, y: ys[row.role], style: fit(row.text, STYLES[row.role][script]) };
  });
}

const OPACITY: Record<Role, number> = { eyebrow: 0.5, lead: 1, tagline: 0.62, footer: 0.72 };

export function textCard(spec: TextCardSpec, locale: Locale = 'en'): string {
  const palette = PALETTES[spec.palette];
  const zh = locale === 'zh-Hans' || locale === 'zh-Hant' ? locale : undefined;
  const lines = textCardLines(spec, locale).map(({ role, text, y, style, name }) => {
    const font = HAN.test(text) ? CARD_HANZI_FONT : CARD_LATIN_FONT;
    const fill = role === 'footer' ? palette.quiet : palette.ink;
    const opacity = OPACITY[role] < 1 ? ` opacity="${OPACITY[role]}"` : '';
    return [
      `<text x="${CARD_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="${font}" `,
      `font-size="${style.size}" font-weight="${style.weight}" letter-spacing="${style.spacing}" `,
      `fill="${fill}"${opacity}${name ? ' translate="no"' : ''}>${escapeXml(text)}</text>`,
    ].join('');
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" `,
    `preserveAspectRatio="xMidYMid slice" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" role="img" `,
    `aria-label="${escapeXml(translateArticleText(zh, spec.ariaLabel))}">`,
    // Fill inline: the .xq-diagram-bg rule is scoped to article figures, which a
    // standalone thumbnail is not inside. The var keeps the card theme-aware.
    `<rect x="0" y="0" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="${palette.bg}"/>`,
    ...lines,
    spec.art ?? '',
    '</svg>',
  ].join('');
}
