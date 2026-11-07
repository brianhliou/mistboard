/**
 * Seed the champions study: one chapter per national or world champion, each a
 * verified game with our own engine annotations attached to the moves.
 *
 * Every chapter is built the same way and nothing in it is hand-written except
 * the blurb: the mainline comes from a record that was replayed through our
 * rules kernel before it was kept, and the glyphs, evals and variations come
 * from scripts/annotate-game.mjs running the production analysis path. A judged
 * move carries its NAG and a comment; the line the engine preferred is attached
 * as a sibling branch off the same parent, so it is clickable rather than prose.
 *
 * Usage (local dev pair on 3010/3011):
 *   npx tsx apps/server/src/seed-xiangqi-champions-study.ts \
 *     --games <dir of harvested game json> --anno <dir of annotate-game json> \
 *     [--praise <xq-positive-glyphs-scan --out json>] \
 *     --email you@example.com --base http://127.0.0.1:3011 \
 *     [--visibility public|unlisted|private] [--emit out.json]
 *
 * Against a real server, supply a browser session instead of --email:
 *   MISTBOARD_SESSION_COOKIE='mistboard_session=...' npx tsx ... --base https://mistboard.com
 * The cookie is a live credential: read from the environment, never logged.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyMove,
  createInitialXiangqiState,
  judgmentComment,
  type XiangqiGameState,
  type XiangqiJudgment,
  type XiangqiMove,
  type XiangqiSquare,
} from '@mistboard/game';
import { judgmentCommentI18n, praiseCommentZh } from './xiangqi-judgment-comment-i18n.js';

type Localized = { 'zh-Hans': string; 'zh-Hant': string };

type SerializedNode = {
  uci?: string;
  annotations?: {
    comments?: { text: string; i18n?: Record<string, string> }[];
    glyphs?: number[];
  };
  children: SerializedNode[];
};

/**
 * The chapter blurbs below are real sentences, not templates, and carry the risk
 * noted at the top of this file: nobody on this side reads Chinese well enough to
 * check them. They ship because the audience that can check them is the audience
 * the study is for, and a wrong character is a correctable embarrassment where an
 * English-only xiangqi study is a permanent one. The per-move comments are the
 * safe case and live in xiangqi-judgment-comment-i18n.ts, shared with the
 * world-title study so the two cannot drift.
 */
type HarvestedGame = {
  key: string;
  title: string;
  event: string;
  date: string;
  red: string;
  black: string;
  result: string;
  moves: XiangqiMove[];
  sourceUrl?: string;
};

type AnnotationRow = {
  ply: number;
  moveNumber: number;
  side: 'red' | 'black';
  judgment: 'blunder' | 'mistake' | 'inaccuracy' | null;
  cp: number | null;
  mate: number | null;
  lost: number;
  pv: string[];
};

type AnnotationFile = { accuracy: { first: number; second: number }; rows: AnnotationRow[] };

/** The curated list. Order is chronological; the blurb is the only prose. */
/**
 * Chapter names describe the OCCASION, never the result. "1960 - Hu Ronghua
 * beats Yang Guanlin" spoils the game before a move is played; who had which
 * side and how it ended now ride in the chapter tags, where the board can show
 * them and a flip keeps them straight.
 */
const CHAPTERS: { key: string; name: string; blurb: string; orientation: 'red' | 'black' }[] = [
  {
    key: 'm_17036',
    name: '1956 · The first national championship',
    orientation: 'red',
    blurb:
      'The first national championship ever played, and the first great upset in it. Li Yiting, the teenager from Hubei they called 小神童, the little prodigy, beats the man who goes on to win the tournament. He takes the title himself two years later, at twenty.',
  },
  {
    key: 'u_345428',
    name: '1960 · Hu Ronghua, aged fifteen',
    orientation: 'black',
    blurb:
      'Shanghai against Guangdong, and the handover between them. Round three: Hu is fifteen, in his first national tournament, with Black against the reigning champion, the man the sport called 第一国手, the first hand of the nation. He is a horse and an elephant ahead by move 43, Yang wins almost all of it back through the endgame, and Hu converts anyway. Hu went on to win ten national championships in a row between 1960 and 1979, and fourteen in all.',
  },
  {
    key: 'm_17225',
    name: '1965 · The champion Hu could not shake',
    orientation: 'red',
    blurb:
      'Guangdong answers. Five years after the handover the old champion is still beating the new one, and Hu will not have the country to himself for another decade. 183 plies, and the longest game of the pair.',
  },
  {
    key: 'm_44977',
    name: '1980 · Liu Dahua opens the summer',
    orientation: 'black',
    blurb:
      'The championship that ended Hu Ronghua’s run, and Liu Dahua’s first scalp in it: Li Laiqun, who would take the title off him two years later.',
  },
  {
    key: 'm_17496',
    name: '1980 · And then Yang Guanlin',
    orientation: 'black',
    blurb:
      'Five days later in the same championship, Liu Dahua takes apart the man who won the very first one, in seventy plies.',
  },
  {
    key: 'm_23400',
    name: '1982 · Li Laiqun takes the title',
    orientation: 'red',
    blurb:
      'Li Laiqun’s title year, and he takes it through Hu Ronghua directly. Our engine grades Li at 98.4 with a single inaccuracy.',
  },
  {
    key: 'm_18198',
    name: '1986 · Lü Qin arrives',
    orientation: 'red',
    blurb:
      'Guangdong\u2019s third great player, in the year he won his first national title, against Yu Youhua, who would win one himself. Lü Qin went on to five national titles and five world titles, more of the latter than anyone before or since. Our engine grades him at 95.7 here.',
  },
  {
    key: 'm_18360',
    name: '1989 · Zhao Guorong before the titles',
    orientation: 'red',
    blurb:
      'Heilongjiang against Shanghai: Zhao Guorong beats Hu Ronghua the year before the first of his four national titles. Zhao grades 97.7 across 73 plies, one of the cleanest games here and among the shortest.',
  },
  {
    key: 'm_2071',
    name: '1990 · Xu Yinchuan, also aged fifteen',
    orientation: 'red',
    blurb:
      'The defending national champion against a fifteen-year-old Xu Yinchuan. It is 1960 in reverse: the same age, the same stage, the opposite result. Xu Yinchuan won his own first title three years later.',
  },
  {
    key: 'm_137202',
    name: '1994 · Fourteen years later',
    orientation: 'red',
    blurb:
      'Hu is forty-nine, and this is the man who ended his run fourteen years earlier. Six years after this he won the national title again, at fifty-five.',
  },
  {
    key: 'm_129045',
    name: '1995 · Guangdong\u2019s next champion',
    orientation: 'red',
    blurb:
      'The third of Guangdong’s champions, against the man who ended Hu’s run. Xu Yinchuan grades 97.7 here with no blunder and no mistake, and won six national titles between 1993 and 2009.',
  },
  {
    key: 'm_19406',
    name: '1996 · Tao Hanming over Liu Dahua',
    orientation: 'red',
    blurb:
      'Tao Hanming won a single national title, in 1994, in an era owned by four or five other men. Two years later he takes down Liu Dahua, a two-time champion, which is the better evidence of what he could do.',
  },
  {
    key: 'm_8975',
    name: '2002 · Yu Youhua, once',
    orientation: 'black',
    blurb:
      'Yu Youhua won the national championship in 2002 and never again, in the middle of an era owned by Hu Ronghua, Lü Qin and Xu Yinchuan. This is from the championship he won, against Xu Tianhong.',
  },
  {
    key: 'm_37503',
    name: '2010 · Sun Yongzheng, the year before',
    orientation: 'black',
    blurb:
      'Sun Yongzheng took the title in 2011. A year earlier he beats Xu Tianhong in sixty plies and grades 97.1 doing it, one of the cleanest games here.',
  },
  {
    key: 'm_135530',
    name: '2025 · Shanghai, and the title leaves China',
    orientation: 'red',
    blurb:
      'From the championship in Shanghai that Lại Lý Huynh won, the first man from outside China to take the standard world title in the thirty-five years the event has existed.',
  },
  {
    key: 'm_138948',
    name: '2025 · Wang Yubo, and an empty top',
    orientation: 'red',
    blurb:
      'The most recent national champion, from the championship he won. He faces nobody else in this study, and that is the point rather than an omission: the generation that would have been across the board from him is serving competition bans.',
  },
];

/**
 * Chapter name and blurb in both Chinese scripts. Keyed by game so a reordering
 * cannot silently pair a chapter with someone else's translation.
 *
 * Proper nouns go back to the Chinese they came from rather than being
 * transliterated back: we hold dpxq's originals, so 杨官璘 is restored exactly
 * rather than round-tripped through "Yang Guanlin" and guessed at.
 */
const CHAPTER_ZH: Record<string, { name: Localized; blurb: Localized }> = {
  m_17036: {
    name: { 'zh-Hans': '1956 · 首届全国个人赛', 'zh-Hant': '1956 · 首屆全國個人賽' },
    blurb: {
      'zh-Hans':
        '有史以来第一届全国象棋个人赛，也是赛中第一场大冷门。人称“小神童”的湖北少年李义庭击败了最终夺冠的杨官璘，两年后自己也拿下了全国冠军，时年二十岁。',
      'zh-Hant':
        '有史以來第一屆全國象棋個人賽，也是賽中第一場大冷門。人稱「小神童」的湖北少年李義庭擊敗了最終奪冠的楊官璘，兩年後自己也拿下了全國冠軍，時年二十歲。',
    },
  },
  u_345428: {
    name: { 'zh-Hans': '1960 · 十五岁的胡荣华', 'zh-Hant': '1960 · 十五歲的胡榮華' },
    blurb: {
      'zh-Hans':
        '上海对广东，也是两代人的交接。第三轮：十五岁的胡荣华第一次参加全国个人赛，执黑迎战卫冕冠军、被誉为“第一国手”的杨官璘。第43回合他多一马一象，杨官璘在残局几乎全部追回，胡荣华仍然赢了下来。此后他在1960至1979年间十连霸，全国冠军共十四次。',
      'zh-Hant':
        '上海對廣東，也是兩代人的交接。第三輪：十五歲的胡榮華第一次參加全國個人賽，執黑迎戰衛冕冠軍、被譽為「第一國手」的楊官璘。第43回合他多一馬一象，楊官璘在殘局幾乎全部追回，胡榮華仍然贏了下來。此後他在1960至1979年間十連霸，全國冠軍共十四次。',
    },
  },
  m_17225: {
    name: { 'zh-Hans': '1965 · 胡荣华甩不掉的对手', 'zh-Hant': '1965 · 胡榮華甩不掉的對手' },
    blurb: {
      'zh-Hans':
        '广东的回应。交接过去五年，老冠军依旧能赢新冠军，胡荣华还要再等十年才真正独霸棋坛。全局183个半回合，也是这两局中最长的一局。',
      'zh-Hant':
        '廣東的回應。交接過去五年，老冠軍依舊能贏新冠軍，胡榮華還要再等十年才真正獨霸棋壇。全局183個半回合，也是這兩局中最長的一局。',
    },
  },
  m_44977: {
    name: { 'zh-Hans': '1980 · 柳大华揭幕', 'zh-Hant': '1980 · 柳大華揭幕' },
    blurb: {
      'zh-Hans':
        '终结胡荣华连霸的那届比赛，柳大华在其中的第一个战果：李来群，两年后从他手里拿走冠军的人。',
      'zh-Hant':
        '終結胡榮華連霸的那屆比賽，柳大華在其中的第一個戰果：李來群，兩年後從他手裡拿走冠軍的人。',
    },
  },
  m_17496: {
    name: { 'zh-Hans': '1980 · 接着是杨官璘', 'zh-Hant': '1980 · 接著是楊官璘' },
    blurb: {
      'zh-Hans': '同一届比赛，五天之后，柳大华击败了第一届冠军杨官璘，全局七十个半回合。',
      'zh-Hant': '同一屆比賽，五天之後，柳大華擊敗了第一屆冠軍楊官璘，全局七十個半回合。',
    },
  },
  m_23400: {
    name: { 'zh-Hans': '1982 · 李来群夺冠', 'zh-Hant': '1982 · 李來群奪冠' },
    blurb: {
      'zh-Hans': '李来群夺冠之年，而且直接赢了胡荣华。本局引擎给他98.4分，仅有一处不精确。',
      'zh-Hant': '李來群奪冠之年，而且直接贏了胡榮華。本局引擎給他98.4分，僅有一處不精確。',
    },
  },
  m_18198: {
    name: { 'zh-Hans': '1986 · 吕钦登场', 'zh-Hant': '1986 · 呂欽登場' },
    blurb: {
      'zh-Hans':
        '广东的第三位高手，在他首夺全国冠军的那一年，对手于幼华日后也会拿到一次。吕钦此后共获五次全国冠军和五次世界冠军，世界冠军数至今无人超越。本局引擎给他95.7分。',
      'zh-Hant':
        '廣東的第三位高手，在他首奪全國冠軍的那一年，對手于幼華日後也會拿到一次。呂欽此後共獲五次全國冠軍和五次世界冠軍，世界冠軍數至今無人超越。本局引擎給他95.7分。',
    },
  },
  m_18360: {
    name: { 'zh-Hans': '1989 · 夺冠之前的赵国荣', 'zh-Hant': '1989 · 奪冠之前的趙國榮' },
    blurb: {
      'zh-Hans':
        '黑龙江对上海：赵国荣在四次全国冠军中的第一次到来的前一年，击败胡荣华。73个半回合，引擎给他97.7分，是本研习中最干净、也最短的对局之一。',
      'zh-Hant':
        '黑龍江對上海：趙國榮在四次全國冠軍中的第一次到來的前一年，擊敗胡榮華。73個半回合，引擎給他97.7分，是本研習中最乾淨、也最短的對局之一。',
    },
  },
  m_2071: {
    name: { 'zh-Hans': '1990 · 同样十五岁的许银川', 'zh-Hant': '1990 · 同樣十五歲的許銀川' },
    blurb: {
      'zh-Hans':
        '卫冕全国冠军对阵十五岁的许银川。这是1960年的镜像：同样的年纪，同样的舞台，结果相反。许银川三年后拿下自己的第一个全国冠军。',
      'zh-Hant':
        '衛冕全國冠軍對陣十五歲的許銀川。這是1960年的鏡像：同樣的年紀，同樣的舞台，結果相反。許銀川三年後拿下自己的第一個全國冠軍。',
    },
  },
  m_137202: {
    name: { 'zh-Hans': '1994 · 十四年之后', 'zh-Hant': '1994 · 十四年之後' },
    blurb: {
      'zh-Hans':
        '胡荣华四十九岁，对手正是十四年前终结他连霸的人。再过六年，五十五岁的他又一次夺得全国冠军。',
      'zh-Hant':
        '胡榮華四十九歲，對手正是十四年前終結他連霸的人。再過六年，五十五歲的他又一次奪得全國冠軍。',
    },
  },
  m_129045: {
    name: { 'zh-Hans': '1995 · 广东的下一位冠军', 'zh-Hant': '1995 · 廣東的下一位冠軍' },
    blurb: {
      'zh-Hans':
        '广东的第三位冠军，对手是终结胡荣华连霸的人。许银川本局97.7分，无漏着也无错着，并在1993至2009年间六夺全国冠军。',
      'zh-Hant':
        '廣東的第三位冠軍，對手是終結胡榮華連霸的人。許銀川本局97.7分，無漏著也無錯著，並在1993至2009年間六奪全國冠軍。',
    },
  },
  m_19406: {
    name: { 'zh-Hans': '1996 · 陶汉明胜柳大华', 'zh-Hant': '1996 · 陶漢明勝柳大華' },
    blurb: {
      'zh-Hans':
        '陶汉明只在1994年拿过一次全国冠军，那个年代属于另外四五个人。两年后他击败两届冠军柳大华，这比冠军头衔更能说明他的实力。',
      'zh-Hant':
        '陶漢明只在1994年拿過一次全國冠軍，那個年代屬於另外四五個人。兩年後他擊敗兩屆冠軍柳大華，這比冠軍頭銜更能說明他的實力。',
    },
  },
  m_8975: {
    name: { 'zh-Hans': '2002 · 于幼华，仅此一次', 'zh-Hant': '2002 · 于幼華，僅此一次' },
    blurb: {
      'zh-Hans':
        '于幼华在2002年夺得全国冠军，此后再未染指，那个年代属于胡荣华、吕钦和许银川。本局出自他夺冠的那届比赛，对手是徐天红。',
      'zh-Hant':
        '于幼華在2002年奪得全國冠軍，此後再未染指，那個年代屬於胡榮華、呂欽和許銀川。本局出自他奪冠的那屆比賽，對手是徐天紅。',
    },
  },
  m_37503: {
    name: { 'zh-Hans': '2010 · 孙勇征，夺冠前一年', 'zh-Hant': '2010 · 孫勇征，奪冠前一年' },
    blurb: {
      'zh-Hans':
        '孙勇征2011年夺得全国冠军。前一年，他六十个半回合击败徐天红，引擎给他97.1分，是本研习中最干净的对局之一。',
      'zh-Hant':
        '孫勇征2011年奪得全國冠軍。前一年，他六十個半回合擊敗徐天紅，引擎給他97.1分，是本研習中最乾淨的對局之一。',
    },
  },
  m_135530: {
    name: { 'zh-Hans': '2025 · 上海，冠军离开中国', 'zh-Hant': '2025 · 上海，冠軍離開中國' },
    blurb: {
      'zh-Hans':
        '出自赖理兄夺冠的那届上海世界象棋锦标赛。在该项赛事三十五年的历史上，他是第一位夺得标准项目世界冠军的非中国棋手。',
      'zh-Hant':
        '出自賴理兄奪冠的那屆上海世界象棋錦標賽。在該項賽事三十五年的歷史上，他是第一位奪得標準項目世界冠軍的非中國棋手。',
    },
  },
  m_138948: {
    name: { 'zh-Hans': '2025 · 王禹博，与空缺的顶端', 'zh-Hant': '2025 · 王禹博，與空缺的頂端' },
    blurb: {
      'zh-Hans':
        '最新一位全国冠军，本局出自他夺冠的那届比赛。他在本研习中没有与任何其他章节的棋手交手，这不是遗漏而正是要点：本该坐在他对面的那一代棋手，正在禁赛之中。',
      'zh-Hant':
        '最新一位全國冠軍，本局出自他奪冠的那屆比賽。他在本研習中沒有與任何其他章節的棋手交手，這不是遺漏而正是要點：本該坐在他對面的那一代棋手，正在禁賽之中。',
    },
  },
};

/** NAG codes the review tree renders: 4 = ??, 2 = ?, 6 = ?!, 3 = !!, 1 = !. */
const NAG: Record<string, number> = { blunder: 4, mistake: 2, inaccuracy: 6 };
const POSITIVE_NAG: Record<string, number> = { '!!': 3, '!': 1 };

/**
 * Positive glyphs from scripts/xq-positive-glyphs-scan.mjs. They are not in the
 * persisted analysis because the classifier needs the second-best move and a
 * capture line, neither of which a whole-game sweep stores, so the scan is the
 * only place they exist and this reads its output rather than running an engine.
 */
type PositiveHit = {
  ply: number;
  glyph: '!!' | '!';
  sacrifice: number;
  evidence: string;
  offeredPiece?: { role?: string; square?: string } | null;
  second?: { win?: number } | null;
};

function parseArgs(): Record<string, string> {
  const out: Record<string, string> = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg?.startsWith('--')) continue;
    const next = args[i + 1];
    if (next && !next.startsWith('--')) {
      out[arg.slice(2)] = next;
      i += 1;
    } else out[arg.slice(2)] = 'true';
  }
  return out;
}

const uciOf = (m: XiangqiMove) => `${m.from}${m.to}`;

/**
 * dpxq stores "province name" in Chinese. The site reads English first, so the
 * seat label does too: every player across these thirteen chapters is mapped
 * explicitly rather than transliterated on the fly, because a wrong romanisation
 * on a public page is worse than a missing one -- an unmapped name falls back to
 * the Chinese it came with rather than to a guess.
 *
 * Chinese seat labels come back when the English is frozen and the whole study
 * is translated, through the same i18n mechanism chapter names use. Doing it
 * now would mean translating text that is still moving.
 */
const PLAYER_NAMES: Record<string, string> = {
  胡荣华: 'Hu Ronghua',
  杨官璘: 'Yang Guanlin',
  李义庭: 'Li Yiting',
  柳大华: 'Liu Dahua',
  李来群: 'Li Laiqun',
  吕钦: 'Lü Qin',
  赵国荣: 'Zhao Guorong',
  徐天红: 'Xu Tianhong',
  陶汉明: 'Tao Hanming',
  许银川: 'Xu Yinchuan',
  李雪松: 'Li Xuesong',
  于幼华: 'Yu Youhua',
  孙勇征: 'Sun Yongzheng',
  王禹博: 'Wang Yubo',
  苏奕霖: 'Su Yilin',
  刘伯良: 'Liu Boliang',
  吴贵临: 'Wu Guilin',
  冯家俊: 'Fung Ka-chun',
  赖理兄: 'Lại Lý Huynh',
};

/**
 * dpxq event strings are Chinese and carry a year, an occasional sponsor cup,
 * and an edition number. The site reads English first, so these are mapped
 * explicitly for the same reason the names are: an unmapped event falls back to
 * the Chinese it came with rather than to a machine rendering of it.
 */
const EVENT_NAMES: [RegExp, string][] = [
  [/第(\d+)届世界象棋锦标赛/, 'World Xiangqi Championship'],
  [/世界象棋锦标赛/, 'World Xiangqi Championship'],
  [/全国象棋个人赛|全国象棋个人锦标赛/, 'National Individual Championship'],
];

/** The event name in Taiwan/Hong Kong characters. Targeted replacements in the
 *  same style as the provenance line above, rather than a general converter: the
 *  vocabulary is four words and a general conversion would also reach the player
 *  names sitting beside them. */
export function traditionalEvent(raw: string): string {
  return (
    raw
      .replaceAll('锦标赛', '錦標賽')
      .replaceAll('个人', '個人')
      .replaceAll('国', '國')
      .replaceAll('届', '屆')
      .replaceAll('赛', '賽')
      .replaceAll('团体', '團體')
      // Sponsor and place names in the event title: 华能杯, 农行杯, 民生实业杯,
      // 吴县市杯. These are companies and places, not people, so they DO convert
      // for a Traditional reader; the name rule is about persons.
      //
      // 华 is the character that makes this only safe here: it is also in 胡荣华,
      // 柳大华 and 于幼华, three champions whose names must not convert. This
      // function is called on an event field and nothing else, which is what
      // keeps those apart.
      .replaceAll('华', '華')
      .replaceAll('农', '農')
      .replaceAll('实', '實')
      .replaceAll('业', '業')
      .replaceAll('吴', '吳')
      .replaceAll('县', '縣')
  );
}

function englishEvent(raw: string): string {
  const year = raw.match(/^(\d{4})年/)?.[1];
  for (const [pattern, name] of EVENT_NAMES) {
    const hit = raw.match(pattern);
    if (!hit) continue;
    const edition = hit[1] ? `${ordinal(Number(hit[1]))} ` : '';
    return `${year ? `${year} ` : ''}${edition}${name}`;
  }
  return raw;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** Team/federation prefix dpxq puts before the name; not part of the player. */
const cleanPlayer = (value: string): string => {
  const bare = value.trim().split(/\s+/).slice(-1)[0] ?? value;
  return PLAYER_NAMES[bare] ?? bare;
};

/** Pikafish UCI is rank-shifted by one against our squares. */
function fromPikafish(uci: string): XiangqiMove | null {
  const sq = (s: string): XiangqiSquare | null => {
    const file = s[0];
    const rank = Number(s.slice(1)) + 1;
    return file && rank >= 1 && rank <= 10 ? (`${file}${rank}` as XiangqiSquare) : null;
  };
  const from = sq(uci.slice(0, 2));
  const to = sq(uci.slice(2, 4));
  return from && to ? { from, to } : null;
}

/**
 * A variation is only worth attaching if it actually plays. Replay it from the
 * position the judged move was made in and truncate at the first rejection,
 * rather than shipping a branch the board would refuse.
 */
function legalLine(state: XiangqiGameState, pv: readonly string[]): XiangqiMove[] {
  const out: XiangqiMove[] = [];
  let cursor = state;
  for (const raw of pv) {
    const move = fromPikafish(raw);
    if (!move) break;
    const next = applyMove(cursor, move);
    if (next === cursor) break;
    out.push(move);
    cursor = next;
  }
  return out;
}

function chainOf(moves: readonly XiangqiMove[]): SerializedNode | null {
  let child: SerializedNode | null = null;
  for (const move of [...moves].reverse()) {
    child = { uci: uciOf(move), children: child ? [child] : [] };
  }
  return child;
}

function evalText(row: AnnotationRow): string {
  if (row.mate != null) return `mate in ${Math.abs(row.mate)}`;
  if (row.cp == null) return '';
  return `${row.cp >= 0 ? '+' : ''}${(row.cp / 100).toFixed(2)}`;
}

/** This seeder's row shape, as the shared comment builder wants it. Takes a row
 *  already known to carry a judgment; an unjudged move has no comment at all. */
function judgmentOf(
  row: AnnotationRow & { judgment: NonNullable<AnnotationRow['judgment']> },
  hasLine: boolean,
): XiangqiJudgment {
  return { judgment: row.judgment, lost: row.lost, evalText: evalText(row), hasLine };
}

function praiseComment(hit: PositiveHit): string {
  if (hit.glyph === '!!') {
    const piece = hit.offeredPiece?.role ? ` (${hit.offeredPiece.role})` : '';
    return `Brilliant: a piece${piece} offered and not recovered, worth ${hit.sacrifice}, confirmed along the engine's own line.`;
  }
  return 'Great: the only move that punishes the error before it, and every alternative is at least a mistake worse.';
}

function chapterFor(
  game: HarvestedGame,
  anno: AnnotationFile,
  meta: (typeof CHAPTERS)[number],
  praise: readonly PositiveHit[] = [],
) {
  // The provenance line is BUILT in English rather than passing dpxq's own
  // title through: its title is Chinese and encodes the result in 胜/负, which
  // reads as untranslated noise on an English page.
  const red = cleanPlayer(game.red);
  const black = cleanPlayer(game.black);
  const outcome =
    game.result === '1-0' ? `${red} won` : game.result === '0-1' ? `${black} won` : 'Drawn';
  const zh = CHAPTER_ZH[meta.key];
  // Proper nouns go back to the Chinese they came from: dpxq's own strings,
  // minus the team prefix, rather than a transliteration of our transliteration.
  const redZh = game.red.trim().split(/\s+/).slice(-1)[0] ?? red;
  const blackZh = game.black.trim().split(/\s+/).slice(-1)[0] ?? black;
  const provenanceZh = (locale: keyof Localized): string => {
    const won =
      game.result === '1-0' ? `${redZh}胜` : game.result === '0-1' ? `${blackZh}胜` : '和棋';
    // The EVENT is converted before it goes into the line, not by the
    // replacements below. Those run over the whole sentence, and the sentence
    // contains the players' names: adding 国 -> 國 to that chain to fix
    // "全国象棋个人赛" would also rewrite 赵国荣, whose name is not supposed to
    // convert. Narrowing the conversion to the one field that needs it is the
    // only version that does not corrupt a name.
    const event = locale === 'zh-Hans' ? game.event : traditionalEvent(game.event);
    const line = `${redZh}（红）对${blackZh}（黑）· ${event} · ${game.date.slice(0, 10)} · ${won}。引擎注解为 Pikafish，每步一百万节点，与复盘页所用相同。准确率：红 ${anno.accuracy.first.toFixed(1)}，黑 ${anno.accuracy.second.toFixed(1)}。`;
    return locale === 'zh-Hans'
      ? line
      : line
          .replaceAll('胜', '勝')
          .replaceAll('红', '紅')
          .replaceAll('对', '對')
          .replaceAll('复盘页所用相同', '覆盤頁所用相同')
          .replaceAll('节点', '節點')
          .replaceAll('准确率', '準確率')
          .replaceAll('注解', '註解')
          .replaceAll('引擎註解为', '引擎註解為')
          .replaceAll('每步一百万節點', '每步一百萬節點')
          .replaceAll('，与覆盤頁', '，與覆盤頁');
  };
  const root: SerializedNode = {
    annotations: {
      comments: [
        {
          text: `${meta.blurb}\n\n${red} (Red) vs ${black} (Black) · ${englishEvent(game.event)} · ${game.date.slice(0, 10)} · ${outcome}. Engine notes are Pikafish at 1,000,000 nodes a position, the same path the review page uses. Accuracy: Red ${anno.accuracy.first.toFixed(1)}, Black ${anno.accuracy.second.toFixed(1)}.`,
          ...(zh
            ? {
                i18n: {
                  'zh-Hans': `${zh.blurb['zh-Hans']}\n\n${provenanceZh('zh-Hans')}`,
                  'zh-Hant': `${zh.blurb['zh-Hant']}\n\n${provenanceZh('zh-Hant')}`,
                },
              }
            : {}),
        },
      ],
    },
    children: [],
  };

  const byPly = new Map(anno.rows.map((r) => [r.ply, r]));
  const praiseByPly = new Map(praise.map((hit) => [hit.ply, hit]));
  let state = createInitialXiangqiState(`champions-${game.key}`);
  let parent = root;

  game.moves.forEach((move, index) => {
    const ply = index + 1;
    const row = byPly.get(ply);
    const node: SerializedNode = { uci: uciOf(move), children: [] };

    const good = praiseByPly.get(ply);
    if (good) {
      // A move is praised or faulted, never both: the classifier only considers
      // plies the judgment path left unmarked.
      node.annotations = {
        glyphs: [POSITIVE_NAG[good.glyph] ?? 1],
        comments: [
          {
            text: praiseComment(good),
            i18n: {
              'zh-Hans': praiseCommentZh(good.glyph, good.sacrifice, 'zh-Hans'),
              'zh-Hant': praiseCommentZh(good.glyph, good.sacrifice, 'zh-Hant'),
            },
          },
        ],
      };
      parent.children.push(node);
    } else if (row?.judgment) {
      const line = legalLine(state, row.pv ?? []);
      const judged = judgmentOf({ ...row, judgment: row.judgment }, line.length > 0);
      node.annotations = {
        glyphs: [NAG[row.judgment] ?? 6],
        comments: [
          {
            text: judgmentComment(judged),
            i18n: judgmentCommentI18n(judged),
          },
        ],
      };
      parent.children.push(node);
      // The refutation branches from the SAME position, so it is a sibling of
      // the played move, not a child of it.
      const branch = chainOf(line);
      if (branch) parent.children.push(branch);
    } else {
      parent.children.push(node);
    }

    state = applyMove(state, move);
    parent = node;
  });

  // Tag translations ride alongside the chapter name. Without them a localized
  // study page translated its title, its description and its chapter list and
  // then labelled the two seats in English; the study seeded before chapter
  // i18n could carry tags at all, and scripts/study-tag-i18n.mjs backfilled the
  // live one. This keeps a re-seed from putting it back.
  //
  // The players are NOT converted for the Traditional reader (redZh/blackZh go
  // in verbatim) for the same reason the provenance line does not convert them:
  // a person's name is written in the script that person uses, and these are
  // mainland players.
  const tagsI18n = {
    'zh-Hans': { red: redZh, black: blackZh, event: game.event },
    'zh-Hant': { red: redZh, black: blackZh, event: traditionalEvent(game.event) },
  };
  return {
    name: meta.name,
    i18n: {
      'zh-Hans': { ...(zh ? { name: zh.name['zh-Hans'] } : {}), tags: tagsI18n['zh-Hans'] },
      'zh-Hant': { ...(zh ? { name: zh.name['zh-Hant'] } : {}), tags: tagsI18n['zh-Hant'] },
    },
    variant: 'xiangqi' as const,
    orientation: meta.orientation,
    root: { version: 1 as const, root },
    // Identity and outcome as PGN-style tags, so the board can label the seats
    // and a flip keeps them attached to the right side.
    tags: {
      red,
      black,
      result: game.result,
      event: englishEvent(game.event),
      date: game.date.slice(0, 10),
      ...(game.sourceUrl ? { site: game.sourceUrl } : {}),
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const base = args.base ?? 'http://127.0.0.1:3011';
  const gamesDir = args.games;
  const annoDir = args.anno;
  if (!gamesDir || !annoDir) {
    console.error('--games <dir> and --anno <dir> are required');
    process.exitCode = 1;
    return;
  }

  const praiseAll: Record<string, PositiveHit[]> = args.praise
    ? ((JSON.parse(readFileSync(args.praise, 'utf8')) as { byKey?: Record<string, PositiveHit[]> })
        .byKey ?? {})
    : {};

  const chapters = CHAPTERS.map((meta) => {
    const game = JSON.parse(
      readFileSync(join(gamesDir, `${meta.key}.json`), 'utf8'),
    ) as HarvestedGame;
    const anno = JSON.parse(
      readFileSync(join(annoDir, `${meta.key}.json`), 'utf8'),
    ) as AnnotationFile;
    return chapterFor(game, anno, meta, praiseAll[meta.key] ?? []);
  });

  if (args.emit) {
    writeFileSync(args.emit, JSON.stringify(chapters, null, 2));
    console.log(`wrote ${chapters.length} chapter payloads to ${args.emit}`);
    return;
  }

  const suppliedCookie = process.env.MISTBOARD_SESSION_COOKIE?.trim();
  const email = args.email;
  if (!suppliedCookie && !email) {
    console.error('--email required (dev server), or set MISTBOARD_SESSION_COOKIE');
    process.exitCode = 1;
    return;
  }

  let cookie = suppliedCookie ?? '';
  const post = async (path: string, body: unknown): Promise<Response> => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0] ?? cookie;
    return response;
  };

  if (!suppliedCookie) {
    const start = await post('/api/auth/email/start', { email });
    if (!start.ok) throw new Error(`auth start failed: ${start.status}`);
    const started = (await start.json()) as { loginId?: string; devCode?: string };
    if (!started.loginId || !started.devCode) {
      throw new Error('no dev code returned; use MISTBOARD_SESSION_COOKIE against a real server');
    }
    const confirm = await post('/api/auth/email/confirm', {
      loginId: started.loginId,
      code: started.devCode,
    });
    if (!confirm.ok) throw new Error(`auth confirm failed: ${confirm.status}`);
    console.log(`signed in as ${email} at ${base}`);
  }

  const [first, ...rest] = chapters;
  const createResponse = await post('/api/studies', {
    name: 'Every Xiangqi Champion',
    i18n: {
      'zh-Hans': {
        name: '象棋全国冠军谱',
        description:
          '每一位全国冠军各一局，从1956年首届全国个人赛到2025年的上海，由我们自己的引擎注解。\n\n按顺序读下来是一个论点：这七十年里的大部分时间，世上最强的象棋手不是来自上海，就是来自广东，两地轮流坐庄。广东出了杨官璘，然后是吕钦，然后是许银川；上海出了胡荣华，他一个人挡住了全国二十年。这里几乎每一章都是他们中的一位对另一位，这正是要点：这些人没有一个是在空房间里称王的。\n\n配套文章：/blog/xiangqi-champions。',
      },
      'zh-Hant': {
        name: '象棋全國冠軍譜',
        description:
          '每一位全國冠軍各一局，從1956年首屆全國個人賽到2025年的上海，由我們自己的引擎註解。\n\n按順序讀下來是一個論點：這七十年裡的大部分時間，世上最強的象棋手不是來自上海，就是來自廣東，兩地輪流坐莊。廣東出了楊官璘，然後是呂欽，然後是許銀川；上海出了胡榮華，他一個人擋住了全國二十年。這裡幾乎每一章都是他們中的一位對另一位，這正是要點：這些人沒有一個是在空房間裡稱王的。\n\n配套文章：/blog/xiangqi-champions。',
      },
    },
    description:
      'One game for each national champion, from the first championship in 1956 to Shanghai in 2025, annotated by our own engine.\n\n' +
      'Read in order it is one argument: for most of these seventy years the best xiangqi player alive came from Shanghai or from Guangdong, and the two cities took turns. Guangdong produced Yang Guanlin, then Lü Qin, then Xu Yinchuan. Shanghai produced Hu Ronghua, who held the rest of the country off by himself for twenty years. Almost every chapter here is one of them against another, which is the point: none of these men were champions of an empty room.\n\n' +
      'Companion to /blog/xiangqi-champions.',
    visibility: args.visibility ?? 'unlisted',
    chapter: first,
  });
  if (!createResponse.ok) {
    throw new Error(`create study failed: ${createResponse.status} ${await createResponse.text()}`);
  }
  const created = (await createResponse.json()) as { study: { id: string } };
  console.log(`created study ${created.study.id}`);

  for (const [index, chapter] of rest.entries()) {
    const response = await post(`/api/studies/${created.study.id}/chapters`, chapter);
    if (!response.ok) {
      throw new Error(
        `chapter ${index + 2} (${chapter.name}) failed: ${response.status} ${await response.text()}`,
      );
    }
  }
  console.log(
    `done: ${chapters.length} chapters at ${base.replace(':3011', ':3010')}/study/${created.study.id}`,
  );
}

// Guarded like every other script module here. Unguarded, merely IMPORTING this
// file ran the seeder: a test that wanted one exported helper got an argument
// check, a usage message on stderr, and process.exitCode = 1, which failed the
// whole test file while every test in it passed.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
