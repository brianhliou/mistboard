// Length floors for a page's <title> and meta description.
//
// Search engines size a snippet by its rendered width, and a CJK character is
// about two Latin characters wide, so a zh string that reads as a full
// translation is roughly half the character count of its English twin. A raw
// `.length` floor either passes thin zh pages or fails full ones; this one
// counts each CJK character (ideographs, kana, hangul, CJK and fullwidth
// punctuation) as two. Twin of apps/web/src/seo-meta-length.ts, which the
// prerendered pages are checked with; keep the two in step.

const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua960-\ua97f\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/u;

/** Display length: a CJK character counts as two, everything else as one. */
export function seoTextLength(text: string): number {
  let n = 0;
  for (const ch of text) n += WIDE.test(ch) || (ch.codePointAt(0) ?? 0) >= 0x20000 ? 2 : 1;
  return n;
}

/** Floor for a full <title>, " | Mistboard" included. */
export const SEO_TITLE_MIN = 25;
/** Floor for a meta description. */
export const SEO_DESCRIPTION_MIN = 100;
/**
 * Second floor for a description written mostly in Chinese, in characters.
 * Bing counts characters, not width: its 2026-10-15 scan flagged zh
 * descriptions of up to 98 characters (196 wide) and English ones only at 74
 * and below. A full translation of a 140-character English summary is about
 * 60 characters, so this is as far as the floor can go without asking for
 * padding.
 */
export const SEO_ZH_DESCRIPTION_MIN_CHARS = 60;

export function seoMetaLengthProblems(
  page: string,
  meta: { title: string; description: string },
): string[] {
  const problems: string[] = [];
  const t = seoTextLength(meta.title);
  const d = seoTextLength(meta.description);
  if (t < SEO_TITLE_MIN) problems.push(`${page}: title ${t} < ${SEO_TITLE_MIN}: ${meta.title}`);
  if (d < SEO_DESCRIPTION_MIN) {
    problems.push(`${page}: description ${d} < ${SEO_DESCRIPTION_MIN}: ${meta.description}`);
  } else {
    const chars = [...meta.description];
    const wide = chars.filter((ch) => WIDE.test(ch)).length;
    if (wide * 2 > chars.length && chars.length < SEO_ZH_DESCRIPTION_MIN_CHARS) {
      problems.push(
        `${page}: zh description ${chars.length} chars < ${SEO_ZH_DESCRIPTION_MIN_CHARS}: ${meta.description}`,
      );
    }
  }
  return problems;
}
