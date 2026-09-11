/**
 * Hong Kong Old Style faan table.
 *
 * Reference: docs-private/mahjong/hk-old-style.md (LOCKED 2026-09-09).
 *
 * Three things this file is deliberately shaped around, each of which is a way
 * to get the arithmetic wrong:
 *
 * 1. VALUES ARE ATOMIC. The published HK tables print some patterns inclusive
 *    of components they necessarily contain - 大三元 is printed as 8, which is
 *    its own 5 plus three mandatory dragon pungs. Storing 8 and also detecting
 *    the dragon pungs double-counts; storing 8 and not detecting them makes the
 *    number unexplainable. So each pattern carries its own faan and an
 *    `implies` list, and the total is derived. English Wikipedia prints 花幺九
 *    as 1, which is the atomic value without its mandatory 對對糊, and copying
 *    that number underscores the hand by three.
 *
 * 2. 例牌 IS A FLAG, NOT THIRTEEN. A limit hand pays whatever the table's limit
 *    is - 8, 10 or 13. Encoding 十三幺 as "13 faan" silently overpays on an
 *    8-faan table and underpays on an unlimited one.
 *
 * 3. THE ORTHODOX SET IS NOT ALL OF THEM. zh.wikipedia separates 正統牌型 from
 *    自訂牌型, and that line is what keeps this ruleset HK rather than drifting
 *    into 新章. Seven pairs is on the wrong side of it: "香港牌則一般完全沒有
 *    七對子". Thirteen orphans is on the right side.
 *
 * Where sources disagree the Cantonese value is used and the disagreement is
 * recorded in `note` rather than averaged away.
 */

export type HkPatternId =
  // Orthodox, additive
  | 'chicken'
  | 'all-chows'
  | 'no-flowers'
  | 'seat-flower'
  | 'self-draw'
  | 'concealed'
  | 'dragon-pung'
  | 'seat-wind'
  | 'round-wind'
  | 'robbing-kong'
  | 'last-tile'
  | 'kong-replacement'
  | 'full-flower-set'
  | 'flower-win'
  | 'all-pungs'
  | 'half-flush'
  | 'all-terminals-and-honours'
  | 'little-three-dragons'
  | 'little-four-winds'
  | 'full-flush'
  | 'big-three-dragons'
  | 'kong-on-kong'
  | 'eight-flowers'
  | 'four-concealed-pungs'
  // Orthodox, 例牌
  | 'all-honours'
  | 'all-terminals'
  | 'nine-gates'
  | 'heavenly-hand'
  | 'earthly-hand'
  | 'human-hand'
  | 'big-four-winds'
  | 'thirteen-orphans'
  | 'four-kongs'
  // 自訂牌型, off unless the table opts in
  | 'seven-pairs'
  | 'pure-double-chow'
  | 'one-voided-suit'
  | 'pure-straight'
  | 'three-kongs'
  | 'big-three-winds';

export interface ScoredPattern {
  readonly id: HkPatternId;
  /** Dragon pungs and seat flowers score once each; most patterns score once. */
  readonly count: number;
}

export interface HkPattern {
  readonly id: HkPatternId;
  readonly chinese: string;
  readonly jyutping: string;
  readonly english: string;
  /** Faan for this pattern ALONE, excluding everything in `implies`. */
  readonly faan: number;
  /** Components this pattern necessarily contains, added on top of `faan`. */
  readonly implies: readonly ScoredPattern[];
  /** Patterns that must not be counted alongside this one. */
  readonly excludes: readonly HkPatternId[];
  /** 例牌: pays the table limit rather than `faan`. */
  readonly limitHand: boolean;
  /** 正統牌型. False means 自訂 - house rule, scores zero under orthodox play. */
  readonly orthodox: boolean;
  /** Most patterns can only occur once. */
  readonly maxCount: number;
  readonly note?: string;
}

const pattern = (
  id: HkPatternId,
  chinese: string,
  jyutping: string,
  english: string,
  faan: number,
  extra: Partial<Omit<HkPattern, 'id' | 'chinese' | 'jyutping' | 'english' | 'faan'>> = {},
): HkPattern => ({
  id,
  chinese,
  jyutping,
  english,
  faan,
  implies: extra.implies ?? [],
  excludes: extra.excludes ?? [],
  limitHand: extra.limitHand ?? false,
  orthodox: extra.orthodox ?? true,
  maxCount: extra.maxCount ?? 1,
  ...(extra.note ? { note: extra.note } : {}),
});

const ALL: readonly HkPattern[] = [
  pattern('chicken', '雞糊', 'gai1 wu4', 'Chicken hand', 0, {
    note: 'A valid parse with no pattern. Cannot win under any minimum above zero.',
  }),
  pattern('all-chows', '平糊', 'ping4 wu4', 'All Chows', 1, {
    note: 'Guangdong forbids an honour pair and Taiwan forbids a closed wait; the HK text imposes neither.',
  }),
  pattern('no-flowers', '無花', 'mou4 faa1', 'No Flowers', 1),
  pattern('seat-flower', '正花', 'zing3 faa1', 'Seat Flower or Season', 1, {
    maxCount: 2,
    note: 'One for your flower and one for your season. Off-seat flowers score nothing but still force a replacement draw.',
  }),
  pattern('self-draw', '自摸', 'zi6 mo1', 'Self-drawn', 1),
  pattern('concealed', '門前清', 'mun4 cin4 cing1', 'Fully Concealed', 1, {
    note: 'Broken by any claim including a concealed kong; not broken by flowers. Valid on a discard win. HK has no separate 不求人.',
  }),
  pattern('dragon-pung', '三元牌', 'saam1 jyun4 paai2', 'Dragon Pung', 1, { maxCount: 3 }),
  pattern('seat-wind', '門風', 'mun4 fung1', 'Seat Wind Pung', 1),
  pattern('round-wind', '圈風', 'hyun1 fung1', 'Round Wind Pung', 1, {
    note: 'Seat and round wind score separately, so the same wind when they coincide is 2 faan (雙番東).',
  }),
  pattern('robbing-kong', '搶槓', 'coeng2 gong3', 'Robbing the Kong', 1, {
    note: 'Added kong only. A concealed kong is robbable only by 十三幺.',
  }),
  pattern('last-tile', '海底撈月', 'hoi2 dai2 lou4 jyut6', 'Win on the Last Tile', 1),
  pattern('kong-replacement', '槓上開花', 'gong3 soeng6 hoi1 faa1', 'Win on Kong Replacement', 1, {
    implies: [{ id: 'self-draw', count: 1 }],
    excludes: ['last-tile'],
    note: 'Published as 2 faan, which is this 1 plus the mandatory self-draw. Does not stack with 海底.',
  }),
  pattern('full-flower-set', '一台花', 'jat1 toi4 faa1', 'Complete Flower Set', 2, {
    excludes: ['seat-flower'],
    note: 'All four flowers or all four seasons; absorbs the 正花 of that series. New Territories tables score 3.',
  }),
  pattern('flower-win', '花糊', 'faa1 wu4', 'Seven Flowers', 2, {
    implies: [{ id: 'self-draw', count: 1 }],
    note: 'Instant win, hand shape irrelevant. Published as 3, being this 2 plus the self-draw.',
  }),
  pattern('all-pungs', '對對糊', 'deoi3 deoi3 wu4', 'All Pungs', 3),
  pattern('half-flush', '混一色', 'wan6 jat1 sik1', 'Half Flush', 3, {
    note: 'One suit plus honours. Honour pungs still score separately.',
  }),
  pattern('all-terminals-and-honours', '花幺九', 'faa1 jiu1 gau2', 'All Terminals and Honours', 1, {
    implies: [{ id: 'all-pungs', count: 1 }],
    note: 'Published as 4. English Wikipedia prints 1, which is this atomic value without the mandatory 對對糊. Sources range 3-6.',
  }),
  pattern('little-three-dragons', '小三元', 'siu2 saam1 jyun4', 'Little Three Dragons', 3, {
    implies: [{ id: 'dragon-pung', count: 2 }],
    note: 'Published as 5. Sources range 3-6; under the historical 三三制 it was 3.',
  }),
  pattern('little-four-winds', '小四喜', 'siu2 sei3 hei2', 'Little Four Winds', 6, {
    excludes: ['half-flush'],
    note: 'Necessarily a half flush, and the source explicitly forbids adding it. wikidot says 10, mahjonggame.hk says 8.',
  }),
  pattern('full-flush', '清一色', 'cing1 jat1 sik1', 'Full Flush', 7, {
    note: 'May combine with 平糊 or 對對糊.',
  }),
  pattern('big-three-dragons', '大三元', 'daai6 saam1 jyun4', 'Big Three Dragons', 5, {
    implies: [{ id: 'dragon-pung', count: 3 }],
    note: 'Published as 8. Sources range 5-8 or treat it as a limit hand.',
  }),
  pattern('kong-on-kong', '連槓開花', 'lin4 gong3 hoi1 faa1', 'Kong on Kong', 8, {
    implies: [{ id: 'self-draw', count: 1 }],
    note: 'Sources range 2-8. Four kongs becomes 十八羅漢 instead.',
  }),
  pattern('eight-flowers', '八仙過海', 'baat3 sin1 gwo3 hoi2', 'Eight Flowers', 8, {
    note: 'Instant win. Sources range 4-8 or treat it as a limit hand.',
  }),
  pattern('four-concealed-pungs', '坎坎糊', 'kaan2 kaan2 wu4', 'Four Concealed Pungs', 8, {
    excludes: ['all-pungs', 'concealed', 'self-draw'],
    note: 'All pungs with nothing claimed. Does not additionally score 對對糊 or 門前清. Sources range 5-8; en.wikipedia says 10.',
  }),

  // 例牌 - these pay the table limit, and the faan below is only used when the
  // table plays unlimited.
  pattern('all-honours', '字一色', 'zi6 jat1 sik1', 'All Honours', 10, {
    limitHand: true,
    excludes: ['all-pungs', 'half-flush'],
  }),
  pattern('all-terminals', '清幺九', 'cing1 jiu1 gau2', 'All Terminals', 10, {
    limitHand: true,
    excludes: ['all-pungs'],
  }),
  pattern('nine-gates', '九蓮寶燈', 'gau2 lin4 bou2 dang1', 'Nine Gates', 10, {
    limitHand: true,
    excludes: ['self-draw', 'concealed', 'full-flush'],
    note: 'Must be concealed on the nine-way wait. wikidot says 15.',
  }),
  pattern('heavenly-hand', '天糊', 'tin1 wu4', 'Heavenly Hand', 13, {
    limitHand: true,
    excludes: ['self-draw', 'concealed'],
    note: 'Dealer completes on the initial hand, after flower replacement.',
  }),
  pattern('earthly-hand', '地糊', 'dei6 wu4', 'Earthly Hand', 13, {
    limitHand: true,
    excludes: ['self-draw', 'concealed'],
  }),
  pattern('human-hand', '人糊', 'jan4 wu4', 'Human Hand', 13, {
    limitHand: true,
    excludes: ['self-draw', 'concealed'],
    note: 'Some tables score 3 rather than treating it as a limit hand.',
  }),
  pattern('big-four-winds', '大四喜', 'daai6 sei3 hei2', 'Big Four Winds', 13, {
    limitHand: true,
    excludes: ['all-pungs', 'seat-wind', 'round-wind'],
    note: 'wikidot says 15, mahjonggame.hk says 10.',
  }),
  pattern('thirteen-orphans', '十三幺', 'sap6 saam1 jiu1', 'Thirteen Orphans', 13, {
    limitHand: true,
    excludes: ['self-draw', 'concealed'],
    note: 'Orthodox HK. May rob a concealed kong and cannot be out-prioritised by another hand.',
  }),
  pattern('four-kongs', '十八羅漢', 'sap6 baat3 lo4 hon3', 'Four Kongs', 13, {
    limitHand: true,
    excludes: ['all-pungs'],
    note: 'Sources range 10-18.',
  }),

  // 自訂牌型 - scored only when the table opts in.
  pattern('seven-pairs', '七對子', 'cat1 deoi3 zi2', 'Seven Pairs', 3, {
    orthodox: false,
    excludes: ['all-chows'],
    note: 'NOT Hong Kong. "香港牌則一般完全沒有七對子." Imported from Japanese and Guangdong play.',
  }),
  pattern('pure-double-chow', '一般高', 'jat1 bun1 gou1', 'Pure Double Chow', 1, {
    orthodox: false,
  }),
  pattern('one-voided-suit', '缺一門', 'kyut3 jat1 mun4', 'One Voided Suit', 1, {
    orthodox: false,
    note: 'mahjonggame.hk lists this as standard and worth 2.',
  }),
  pattern('pure-straight', '一條龍', 'jat1 tiu4 lung4', 'Pure Straight', 3, {
    orthodox: false,
  }),
  pattern('three-kongs', '三槓子', 'saam1 gong3 zi2', 'Three Kongs', 3, { orthodox: false }),
  pattern('big-three-winds', '三喜臨門', 'saam1 hei2 lam4 mun4', 'Big Three Winds', 3, {
    orthodox: false,
  }),
];

export const HK_PATTERNS: Readonly<Record<HkPatternId, HkPattern>> = Object.freeze(
  Object.fromEntries(ALL.map((entry) => [entry.id, entry])) as Record<HkPatternId, HkPattern>,
);

export const ORTHODOX_PATTERN_IDS: readonly HkPatternId[] = ALL.filter(
  (entry) => entry.orthodox,
).map((entry) => entry.id);
