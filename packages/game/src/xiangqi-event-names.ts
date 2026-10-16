// Xiangqi event names in English, shared by the broadcast ingest (server,
// which caches an English name next to the Chinese one) and every page that
// renders a stored Chinese event at read time (a study chapter's Event tag).
//
// One glossary, so a term fixed for the broadcasts is fixed on the studies too.
// The two callers differ only in what happens to a part the glossary does not
// know: the server romanizes it (pinyin needs a dictionary the browser should
// not download), and `translateXiangqiEventNameStrict` refuses, so the reader
// sees the original rather than an English name with a hole in it.

// Whole event names whose English the organiser fixes, where the glossary
// would read differently: the host calls this one the North American Xiangqi
// Championship, without the edition number dpxq's name carries.
export const XIANGQI_EVENT_NAME_OVERRIDES: ReadonlyMap<string, string> = new Map([
  ['2026年第十届北美杯象棋锦标赛', '2026 North American Xiangqi Championship'],
]);

// Longest match wins; entries are sorted by key length at module init.
export const XIANGQI_EVENT_GLOSSARY: ReadonlyArray<readonly [string, string]> = [
  // The North American Championship, as dpxq (北美杯) and its host (北美洲)
  // name it.
  ['北美杯', 'North American Cup'],
  ['北美洲', 'North American'],
  ['全国象棋团体赛', 'National Xiangqi Team Championship'],
  ['全国象棋个人赛', 'National Xiangqi Individual Championship'],
  ['象棋甲级联赛', 'Xiangqi Division A League'],
  ['世界象棋锦标赛', 'World Xiangqi Championship'],
  ['亚洲象棋锦标赛', 'Asian Xiangqi Championship'],
  ['五羊杯', 'Five Rams Cup'],
  // Found untranslated on the broadcast calendar (2026-09-23): the parts fell
  // through to pinyin ("Geren", "Kuaiqi", "Dashi", "Haixuansai").
  ['腾讯天天象棋', 'Tencent Tiantian Xiangqi'],
  ['个人锦标赛', 'Individual Championship'],
  ['大师公开赛', 'Masters Open'],
  // The 2026 exhibitions and opens, found as pinyin on the second backfill
  // (2026-09-24: "Guangdongshihu", "Shoujie", "Duikangsai").
  ['广东十虎', 'Guangdong Ten Tigers'],
  ['北京十杰', 'Beijing Top Ten'],
  ['山东十好汉', 'Shandong Ten Heroes'],
  ['重庆十强', 'Chongqing Top Ten'],
  ['年轻大师联队', 'Young Masters Team'],
  ['团体对抗赛', 'Team Match'],
  ['对抗赛', 'Match'],
  ['高新高港杯', 'Gaoxin Gaogang Cup'],
  ['首届', '1st'],
  // The 2026 spring invitationals, found as pinyin on the backfill
  // (2026-09-24: "Dashishifanqizhan", "Dashileitaisai").
  ['春丘大叶杯', 'Chunqiu Dayie Cup'],
  ['大师十番棋战', 'Masters Ten-Game Match'],
  ['十番棋战', 'Ten-Game Match'],
  ['十番棋', 'Ten-Game Match'],
  ['大师擂台赛', 'Masters Challenge'],
  ['擂台赛', 'Challenge'],
  ['快棋锦标赛', 'Rapid Championship'],
  // The leagues read "Men Division A League" when 男子 glossed on its own.
  ['男子甲级联赛', "Men's Division A League"],
  ['女子甲级联赛', "Women's Division A League"],
  // Sections a source files games under (the board's match field): the
  // 五羊杯 veterans and its Hong Kong, Macau and Taiwan qualifier, and the two
  // camps of the 春丘大叶杯 challenge, red general against black general.
  ['港澳台组', 'Hong Kong, Macau and Taiwan'],
  ['元老组', 'Veterans'],
  ['红帅组', 'Team Red'],
  ['黑将组', 'Team Black'],
  ['海选赛', 'Qualifier'],
  ['双人赛', 'Pairs'],
  ['快棋', 'Rapid'],
  ['女子组', 'Women'],
  ['男子组', 'Men'],
  ['公开组', 'Open'],
  ['女子', 'Women'],
  ['男子', 'Men'],
  ['个人赛', 'Individual Championship'],
  ['团体赛', 'Team Championship'],
  ['锦标赛', 'Championship'],
  ['冠军赛', 'Champions Tournament'],
  ['邀请赛', 'Invitational'],
  ['大师赛', 'Masters'],
  ['预选赛', 'Qualifier'],
  ['挑战赛', 'Challenge'],
  ['公开赛', 'Open'],
  ['联赛', 'League'],
  ['中国象棋', 'Xiangqi'],
  ['象棋', 'Xiangqi'],
  ['全国', 'National'],
  ['世界', 'World'],
  ['亚洲', 'Asian'],
  ['甲级', 'Division A'],
  ['乙级', 'Division B'],
];

// Terms only the study page reads (2026-10-08, the dpxq import of one player's
// games): sponsors and stages the broadcast set never carried. They stay out of
// XIANGQI_EVENT_GLOSSARY, which the broadcast ingest reads, so no broadcast's
// cached English name (and nothing built from it) changes. A sponsor's cup
// keeps the reading the broadcast ingest already gives it (农行杯 is romanized
// there as Nonghang Cup), so one event reads the same on both pages.
export const XIANGQI_STUDY_EVENT_TERMS: ReadonlyArray<readonly [string, string]> = [
  ['农行杯', 'Nonghang Cup'],
  ['华体龙江杯', 'Huatilongjiang Cup'],
  ['上海杯', 'Shanghai Cup'],
  ['全运会', 'National Games'],
  ['群众比赛', 'Amateur'],
  ['等级赛', 'Rating Tournament'],
  ['选拔赛', 'Qualifier'],
  ['决赛', 'Final'],
  ['中国', 'China'],
  ['亚运会', 'Asian Games'],
  ['亚洲杯', 'Asian Cup'],
];

const CN_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** Arabic digits or Chinese numerals up to 999 (十一 -> 11, 二十一 -> 21). */
export function parseChineseNumeral(text: string): number | undefined {
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10);
  if (text.length === 0) return undefined;
  let total = 0;
  let rest = text;
  const hundred = rest.indexOf('百');
  if (hundred >= 0) {
    const head = rest.slice(0, hundred);
    const value = head.length > 0 ? CN_DIGITS[head] : 1;
    if (value === undefined) return undefined;
    total += value * 100;
    rest = rest.slice(hundred + 1);
    if (rest.startsWith('零')) rest = rest.slice(1);
  }
  const ten = rest.indexOf('十');
  if (ten >= 0) {
    const head = rest.slice(0, ten);
    const value = head.length > 0 ? CN_DIGITS[head] : 1;
    if (value === undefined) return undefined;
    total += value * 10;
    rest = rest.slice(ten + 1);
  }
  if (rest.length > 0) {
    const value = CN_DIGITS[rest];
    if (value === undefined) return undefined;
    total += value;
  }
  return total > 0 || text === '零' ? total : undefined;
}

export function ordinalEn(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

const GLOSSARY_BY_LENGTH = [...XIANGQI_EVENT_GLOSSARY, ...XIANGQI_STUDY_EVENT_TERMS].sort(
  (a, b) => b[0].length - a[0].length,
);

const HAN = /\p{Script=Han}/u;

/**
 * An event name in English, or undefined when any part of it is not in the
 * glossary (or it holds no Chinese at all, so there is nothing to translate).
 *
 * Every character has to be accounted for: a year (2022年), an edition
 * (第17届 / 第十五届), a glossary term, Latin text, a space, or punctuation (the
 * quotes around a sponsor's cup are dropped, as the broadcast names drop them).
 * One unknown Han character returns undefined, and the caller shows the
 * original: "2025 Nonghang Cup" from a guess is worse than the Chinese.
 */
export function translateXiangqiEventNameStrict(zh: string): string | undefined {
  const trimmed = zh.trim();
  if (!HAN.test(trimmed)) return undefined;
  const override = XIANGQI_EVENT_NAME_OVERRIDES.get(trimmed);
  if (override) return override;
  const text = trimmed.replace(/(\d{4})\s*年/g, '$1 ');
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const edition = /^第([0-9零一二两三四五六七八九十百]+)届/.exec(text.slice(i));
    if (edition) {
      const n = parseChineseNumeral(edition[1]!);
      if (n === undefined) return undefined;
      tokens.push(ordinalEn(n));
      i += edition[0].length;
      continue;
    }
    const entry = GLOSSARY_BY_LENGTH.find(([key]) => text.startsWith(key, i));
    if (entry) {
      tokens.push(entry[1]);
      i += entry[0].length;
      continue;
    }
    const char = text[i]!;
    if (char === '（' || char === '(') {
      tokens.push('(');
      i += 1;
      continue;
    }
    if (char === '）' || char === ')') {
      tokens.push(')');
      i += 1;
      continue;
    }
    if (HAN.test(char)) return undefined;
    if (/[A-Za-z0-9]/.test(char)) {
      let run = '';
      while (i < text.length && /[A-Za-z0-9.'&-]/.test(text[i]!)) {
        run += text[i];
        i += 1;
      }
      tokens.push(run);
      continue;
    }
    // Whitespace and punctuation (“”「」《》·, full-width or not) separate.
    if (/[\s\p{P}\p{S}]/u.test(char)) {
      i += 1;
      continue;
    }
    return undefined;
  }
  const result = tokens
    .join(' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/\(\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return result.length > 0 ? result : undefined;
}
