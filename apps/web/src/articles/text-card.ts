// The top two lines of the bilingual text cards (champions, world title, jieqi):
// a faint hanzi eyebrow over one big English word. The English mark is there for
// a chess reader who cannot decode hanzi at 158px; a zh reader is the opposite
// case, so on a zh page the two trade places, as the Pikafish card already did.
// The English word stays as the eyebrow, marked translate="no" so the article
// dictionary leaves it alone and the coverage gate does not ask for a key.
import type { Locale } from '../i18n/locale.js';

export const CARD_HANZI_FONT =
  "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif";
export const CARD_LATIN_FONT = 'Roboto, system-ui, sans-serif';

export type CardMark = {
  eyebrowY: number;
  leadY: number;
  /** The big English word on an English page, the eyebrow on a zh one. */
  latin: string;
  /** The eyebrow on an English page. */
  hanzi: string;
  /** The lead on a zh page, which may say more than the eyebrow did. */
  zhHans: string;
  zhHant: string;
};

export function cardMark(mark: CardMark, locale?: Locale): string {
  const zh = locale === 'zh-Hans' || locale === 'zh-Hant';
  if (!zh) {
    return [
      `<text x="160" y="${mark.eyebrowY}" text-anchor="middle" font-family="${CARD_HANZI_FONT}" `,
      'font-size="26" font-weight="700" letter-spacing="10" fill="#b9832f" ',
      `opacity="0.5">${mark.hanzi}</text>`,
      `<text x="160" y="${mark.leadY}" text-anchor="middle" font-family="${CARD_LATIN_FONT}" `,
      `font-size="40" font-weight="700" fill="#b9832f">${mark.latin}</text>`,
    ].join('');
  }
  const lead = locale === 'zh-Hant' ? mark.zhHant : mark.zhHans;
  return [
    `<text x="160" y="${mark.eyebrowY}" text-anchor="middle" font-family="${CARD_LATIN_FONT}" `,
    'font-size="22" font-weight="700" letter-spacing="6" fill="#b9832f" ',
    `opacity="0.5" translate="no">${mark.latin}</text>`,
    `<text x="160" y="${mark.leadY}" text-anchor="middle" font-family="${CARD_HANZI_FONT}" `,
    `font-size="46" font-weight="700" letter-spacing="8" fill="#b9832f">${lead}</text>`,
  ].join('');
}
