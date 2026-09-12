// Prose extraction shared by the translation-coverage test and the
// i18n:coverage reporter. Only strings a reader sees as natural-language copy
// are treated as translatable. Board labels baked into specs and generated SVG,
// and code-block payloads, are deliberately excluded as a separate, known
// localization gap.
import type { Article, ArticleBlock, ArticleSection } from './articles-data.js';

export type Prose = { path: string; text: string };

function decodeSvgText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

// Every English source string that the article translator can consume. This
// is broader than prose coverage: raw SVG renderers localize their text/title/
// desc nodes separately, so those generated labels are live dictionary keys
// even though they are intentionally excluded from prose-completeness counts.
export function articleTranslationSourceStrings(sourceArticles: readonly Article[]): Set<string> {
  const strings = new Set<string>();
  const collect = (value: unknown, key?: string): void => {
    if (typeof value === 'string') {
      strings.add(value);
      for (const match of value.matchAll(/<(text|title|desc)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        const visible = decodeSvgText(match[2].replace(/<[^>]+>/g, '')).trim();
        if (visible) strings.add(visible);
      }
      return;
    }
    if (typeof value === 'function') {
      if (key === 'svg') collect((value as () => string)(), key);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) collect(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, item] of Object.entries(value)) collect(item, childKey);
    }
  };
  for (const article of sourceArticles) collect(article);
  return strings;
}

function caption(block: { caption?: string }): string[] {
  return block.caption ? [block.caption] : [];
}

// Stepper step narratives that are pure move notation ("1. c1→b2", "R@c3",
// "d3→d1+") are language-neutral and excluded from translation coverage, the
// same way board labels baked into specs are. Real narrative ("Starting
// position", explanatory text) never contains a move arrow or drop marker.
function isMoveNotation(text: string): boolean {
  return /[→@]/.test(text);
}

// A game result written as score notation ("1-0", "0-1", "1/2-1/2") is
// language-neutral, the same way a move arrow is.
function isScoreNotation(text: string): boolean {
  return /^\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/.test(text);
}

// A replay block's narrative: its caption plus the header and result line the
// widget renders around the board. Only `caption` used to count, so a stepper
// could ship a translated caption under an English header and the coverage test
// would call the article fully covered. The puzzle-mining article shipped
// exactly that on 2026-09-02: "拒絕：太短 · Mate in one, thrown away".
//
// `red` and `black` stay out. They are player and engine names (Fairy-Stockfish,
// PikaJieQi, a person), and a name is not translatable prose. Articles that DO
// want a localized name, like the champion pages, still get one by adding the
// key; they just are not forced to.
function replay(block: {
  caption?: string;
  spec?: { title?: string; event?: string; resultText?: string; outcome?: string };
}): string[] {
  const spec = block.spec ?? {};
  return [
    ...caption(block),
    // `outcome` was missing here until 2026-09-03, and it is the line directly
    // under the replay header: the jieqi platform page rendered "Black wins by
    // checkmate · 73 moves" in English on both zh pages while this gate read
    // green. deriveTranslation's own READABLE set already covered it, so the
    // Vietnamese page had it translated and the Chinese ones did not.
    ...[spec.title, spec.event, spec.resultText, spec.outcome].filter(
      (t): t is string => typeof t === 'string' && t.trim().length > 0 && !isScoreNotation(t),
    ),
  ];
}

// Each block kind declares the prose it contributes. The mapped type is
// exhaustive over ArticleBlock['kind'], so adding a new block kind is a compile
// error here until someone decides what prose (if any) it carries.
const BLOCK_PROSE: {
  [K in ArticleBlock['kind']]: (block: Extract<ArticleBlock, { kind: K }>) => string[];
} = {
  paragraph: (b) => [b.text],
  'sub-heading': (b) => [b.text],
  cta: (b) => b.buttons.map((button) => button.label),
  'static-boards': caption,
  interactive: caption,
  'live-boards': caption,
  'image-figure': (b) => [...caption(b), b.alt],
  'raw-svg': caption,
  'svg-row': (b) => [...caption(b), ...b.items.flatMap(caption)],
  'raw-svg-stepper': (b) => [
    ...caption(b),
    ...b.steps.flatMap((step) => {
      const n = step.narrative;
      return n && !isMoveNotation(n) ? [n] : [];
    }),
  ],
  'xq-replay': replay,
  'mxq-replay': replay,
  'drop-mini-xiangqi-replay': replay,
  'fortress-xiangqi-replay': replay,
  'duck-xiangqi-replay': replay,
  'chess-replay': replay,
  'jieqi-replay': replay,
  'banqi-replay': replay,
  'jungle-replay': replay,
  'jungle-flip-replay': replay,
  code: caption,
  embed: (b) => [...caption(b), b.title],
  // Headers, caption, and any cell carrying Latin script. Cells were once treated as
  // data because most of them are numbers, and the match-fixing article then
  // shipped three tables of English prose that the gate read as fully covered:
  // a coverage check that skips a surface reports 100% on it.
  table: (block) => {
    const b = block as { headers?: string[]; rows?: string[][] };
    return [
      // A blank header is the corner cell of a comparison table, not copy. It
      // reached the coverage gate as a string with no translation, which no
      // dictionary can satisfy, and would have blocked the first locked article
      // whose table has one.
      ...(b.headers ?? []).filter((header) => header.trim().length > 0),
      ...(b.rows ?? []).flat().filter((cell) => /\p{Script=Latin}/u.test(cell)),
      ...caption(block),
    ];
  },
  // Both halves of every pair: an FAQ is translatable copy, and an answer that
  // ships untranslated beside a translated question is worse than either.
  faq: (block) =>
    ((block as { items?: { question: string; answer: string }[] }).items ?? []).flatMap((item) => [
      item.question,
      item.answer,
    ]),
};

function blockProse(block: ArticleBlock, path: string): Prose[] {
  const extract = BLOCK_PROSE[block.kind] as (b: ArticleBlock) => string[];
  return extract(block).map((text, i) => ({ path: `${path}.${block.kind}[${i}]`, text }));
}

function sectionProse(section: ArticleSection, path: string): Prose[] {
  const out: Prose[] = [{ path: `${path}.heading`, text: section.heading }];
  (section.paragraphs ?? []).forEach((p, i) => {
    out.push({ path: `${path}.paragraphs[${i}]`, text: p });
  });
  (section.blocks ?? []).forEach((b, i) => {
    out.push(...blockProse(b, `${path}.blocks[${i}]`));
  });
  return out;
}

// Every natural-language string an article contributes, each with a dotted path
// for diagnostics. Order is stable: title, summary, tldr, intro, then sections.
export function articleProse(article: Article): Prose[] {
  const out: Prose[] = [
    { path: 'title', text: article.title },
    { path: 'summary', text: article.summary },
  ];
  (article.tldr ?? []).forEach((t, i) => {
    out.push({ path: `tldr[${i}]`, text: t });
  });
  (article.intro ?? []).forEach((b, i) => {
    out.push(...blockProse(b, `intro[${i}]`));
  });
  article.sections.forEach((s, i) => {
    out.push(...sectionProse(s, `sections[${i}]`));
  });
  return out;
}
