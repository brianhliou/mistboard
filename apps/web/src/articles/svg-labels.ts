// Words baked into article diagrams.
//
// A diagram builder renders its labels ("SHUFFLED START", "LEG BLOCKED") into
// <text> nodes of an SVG string, so they never appear as a field a dictionary
// walk can see. The zh pages swap them at render (localizeSvgMarkup in
// articles.ts); derived pages swap them in their thunk (derived-translation.ts).
// Both paths look a label up by its trimmed visible text, which is what this
// module extracts, so the coverage gates check the exact key the render uses.
//
// A node carrying data-i18n-key="…" is looked up by that key instead of its
// text: the visible English word is shared by labels that translate apart (the
// xiangqi mahjong tiles name a red and a black General both "General").
//
// A node carrying translate="no" is deliberate source-language text (an engine name
// on a zh card, a title abbreviation) and is neither swapped nor counted.
// Card thumbnails render per locale, so articleCardLabels reads them separately.

import { hasOwnKey } from '@mistboard/game';

const SVG_TEXT_NODE = /<(text|title|desc)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

function keepsSourceText(attrs: string): boolean {
  return /\btranslate="no"/.test(attrs);
}

const I18N_KEY = /\bdata-i18n-key="([^"]*)"/;

/** The dictionary key a text node is looked up by: its data-i18n-key, else its
 *  trimmed, decoded visible text. */
export function svgLabelKey(attrs: string, inner: string): string {
  const keyed = attrs.match(I18N_KEY);
  return keyed ? decode(keyed[1]) : decode(inner.replace(/<[^>]+>/g, '')).trim();
}

/** Figure fields that hold SVG markup or a render thunk: the figure, and an
 *  animated figure's reduced-motion frames. */
export const SVG_FIELDS: ReadonlySet<string> = new Set(['svg', 'reducedSvg']);

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function encode(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Visible text of every <text>, <title> and <desc> node, trimmed and decoded. */
export function svgTextLabels(markup: string): string[] {
  const out: string[] = [];
  for (const match of markup.matchAll(SVG_TEXT_NODE)) {
    if (keepsSourceText(match[2])) continue;
    const key = svgLabelKey(match[2], match[3]);
    if (key) out.push(key);
  }
  return out;
}

/** Swap each text node whose visible text is a dictionary key. Like setting
 *  textContent in the DOM path, a keyed node loses any <tspan> children. */
export function substituteSvgText(markup: string, dict: Record<string, string>): string {
  return markup.replace(SVG_TEXT_NODE, (whole, tag: string, attrs: string, inner: string) => {
    if (keepsSourceText(attrs)) return whole;
    const key = svgLabelKey(attrs, inner);
    if (!hasOwnKey(dict, key)) return whole;
    return `<${tag}${attrs}>${encode(dict[key])}</${tag}>`;
  });
}

// Labels that read the same in every language: board coordinates ("a"),
// sample sizes ("n=33"), kebab-case identifiers the prose names as values
// ("only-mate", the puzzle gate's reason codes), and the site's own domain.
export function isLanguageNeutralLabel(text: string): boolean {
  return (
    !/\p{Script=Latin}/u.test(text) ||
    /^[a-z]$/i.test(text) ||
    /^n=\d+$/.test(text) ||
    /^[a-z]+(-[a-z]+)+$/.test(text) ||
    text === 'mistboard.com'
  );
}

export type DiagramLabel = { path: string; text: string };

/** Every translatable label in an article's figures, with a dotted path to the
 *  block that renders it. Walks any `svg` field (string or render thunk) and any
 *  string that is itself SVG markup; skips `thumbnail`. */
export function articleDiagramLabels(article: object): DiagramLabel[] {
  const out: DiagramLabel[] = [];
  const seen = new Set<string>();
  const add = (markup: string, path: string): void => {
    for (const text of svgTextLabels(markup)) {
      if (isLanguageNeutralLabel(text) || seen.has(text)) continue;
      seen.add(text);
      out.push({ path, text });
    }
  };
  const walk = (value: unknown, path: string, key?: string): void => {
    if (typeof value === 'string') {
      if (/<svg\b/i.test(value)) add(value, path);
      return;
    }
    if (typeof value === 'function') {
      if (key !== undefined && SVG_FIELDS.has(key)) add((value as () => string)(), path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        walk(item, `${path}[${i}]`);
      });
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        if (k !== 'thumbnail') walk(v, path ? `${path}.${k}` : k, k);
      }
    }
  };
  walk(article, '');
  return out;
}

/** The translatable words on an article's index card as it renders for
 *  `locale`. Empty for a board or image thumbnail. */
export function articleCardLabels(
  article: { thumbnail?: { kind?: string; svg?: unknown } },
  locale: string,
): string[] {
  const thumb = article.thumbnail;
  if (thumb?.kind !== 'svg') return [];
  const raw = typeof thumb.svg === 'function' ? (thumb.svg as (l: string) => string)(locale) : thumb.svg;
  if (typeof raw !== 'string') return [];
  return [...new Set(svgTextLabels(raw))].filter((text) => !isLanguageNeutralLabel(text));
}
