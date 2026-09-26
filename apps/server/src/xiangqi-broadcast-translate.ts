// Translation layer for ingested Chinese xiangqi broadcasts (issue #145).
//
// Broadcast sources (dpxq.com, WXF relays) carry event names, round labels,
// and player names in Chinese. Mistboard is English-first, so ingestion caches
// an English form next to the original: tour/round `nameEn` and player-tag
// `nameEn` ride the persisted payloads, and viewers render English primary
// with the Chinese preserved as a secondary line.
//
// Everything here is pure and deterministic: translation is recomputed from
// the current Chinese value at write time, so re-polls are idempotent and a
// glossary improvement self-heals stale caches on the next write (or via the
// backfill CLI). Event/round labels go through a longest-match glossary;
// residual CJK falls back to pinyin so the output is always fully Latin.
// Player names are romanized pinyin-style (surname first, given name joined),
// with an overrides map for the established spellings of famous players.

import { pinyin } from 'pinyin-pro';

const PINYIN_OPTIONS = { toneType: 'none', type: 'array', nonZh: 'removed' } as const;

// Two-character surnames that must not be split as surname + given name.
const COMPOUND_SURNAMES = [
  '欧阳',
  '司马',
  '上官',
  '诸葛',
  '东方',
  '令狐',
  '慕容',
  '尉迟',
  '皇甫',
  '长孙',
  '宇文',
  '司徒',
  '申屠',
  '夏侯',
  '呼延',
  '端木',
];

// Surnames pinyin-pro misreads even in surname mode: 么 is Yao as a surname
// (么毅 came out "Me Yi" on the 2026 broadcasts).
const SURNAME_READINGS = new Map<string, string>([['么', 'yao']]);

// Established English spellings of well-known players win over raw pinyin.
const PLAYER_NAME_OVERRIDES = new Map<string, string>([
  ['吕钦', 'Lu Qin'],
  ['许银川', 'Xu Yinchuan'],
  ['王天一', 'Wang Tianyi'],
  ['郑惟桐', 'Zheng Weitong'],
  ['胡荣华', 'Hu Ronghua'],
  ['赵鑫鑫', 'Zhao Xinxin'],
  ['蒋川', 'Jiang Chuan'],
  ['洪智', 'Hong Zhi'],
  ['谢靖', 'Xie Jing'],
  ['汪洋', 'Wang Yang'],
  ['唐丹', 'Tang Dan'],
  // 蹊 is polyphonic (qi/xi); in 成蹊 it reads xi.
  ['李成蹊', 'Li Chengxi'],
  // The 2025 world champion, entered in Chinese events without a federation
  // as often as with one; Vietnamese, spelled as the site's articles spell him.
  ['赖理兄', 'Lại Lý Huynh'],
]);

// The federation a source's team field names, for the players outside
// mainland China whose own spelling is not pinyin. Keys are matched as
// substrings, so 中国香港 and 香港象棋总会 are both Hong Kong.
type FederationRegion = 'HK' | 'MO' | 'TW' | 'VN' | 'MY' | 'SG' | 'PH' | 'JP' | 'TH' | 'BN' | 'AU';
const FEDERATION_REGIONS: Array<[string, FederationRegion]> = [
  ['香港', 'HK'],
  ['澳门', 'MO'],
  ['台北', 'TW'],
  ['台湾', 'TW'],
  ['越南', 'VN'],
  ['西马', 'MY'],
  ['东马', 'MY'],
  ['马来西亚', 'MY'],
  ['新加坡', 'SG'],
  ['菲律宾', 'PH'],
  ['日本', 'JP'],
  ['泰国', 'TH'],
  ['文莱', 'BN'],
  ['澳大利亚', 'AU'],
  ['澳洲', 'AU'],
];

function federationRegion(federation: string | undefined): FederationRegion | undefined {
  if (!federation) return undefined;
  return FEDERATION_REGIONS.find(([key]) => federation.includes(key))?.[1];
}

// Players from outside mainland China, under the spelling they use
// themselves: Vietnamese with its diacritics (as the site's articles write
// Lại Lý Huynh), Hong Kong and Macau in their Cantonese romanisation, Chinese
// Taipei in its Wade-Giles, Malaysia and Singapore as their federations list
// them. Keyed by federation region, because most of these Chinese names could
// equally be a mainland player's; a mainland team keeps pinyin. Every entry
// is sourced (the event that lists the pair is named); a name with no source
// stays pinyin rather than a guess.
const FEDERATION_PLAYER_NAMES = new Map<string, string>([
  // 2024 20th Asian Xiangqi Individual Championship (Singapore): the AXF's
  // bilingual results sheet, which prints each entrant's Chinese and Latin
  // names side by side (xiangqi.sg, communiqué 43). Where the 2025 WXF world
  // championship results or the 2022 Asian Games (Hangzhou) list the same
  // player, they agree unless noted. Vietnamese keeps its diacritics as the
  // site's articles write it; the sheet prints them bare.
  ['VN:武国达', 'Vũ Quốc Đạt'],
  ['VN:阮明日光', 'Nguyễn Minh Nhật Quang'],
  ['VN:阮黄燕', 'Nguyễn Hoàng Yến'],
  ['HK:黄学谦', 'Wong Hok Him'],
  ['HK:郑彦隆', 'Cheng Yin Lung'],
  ['HK:林嘉欣', 'Lam Ka Yan'],
  ['MO:苏俊豪', 'Sou Chon Hou'],
  ['MO:伍子骏', 'Wu Chi Chon'],
  ['MO:李凯雯', 'Li Kevin'],
  ['TW:葛振衣', 'Ge Jen-yi'],
  ['TW:蔡安爵', 'Tsai An Chueh'],
  ['TW:李思谊', 'Li Sih-yi'],
  ['MY:沈毅豪', 'Sim Yip How'],
  ['MY:唐语萱', 'Thong Yu Xuan'],
  ['MY:叶乃传', 'Yek Nai Tuong'],
  ['MY:许鲁斌', 'Robin Hii Lu Bin'],
  ['MY:周盈萱', 'Chiew Ying Xuan'],
  ['SG:吴宗翰', 'Alvin Woo Tsung Han'],
  ['SG:许正豪', 'Bob Koh Zheng Hao'],
  ['PH:庄宏明', 'Chong Heung Ming'],
  ['BN:林廷安', 'Ling Ting Ang'],
  ['BN:庄力铭', 'Cheng Kah Siong'],
  // The sheet spells him Sintuyosakul; the WXF 2025 results and the Asian
  // Games both spell him Sinthuyodsakun.
  ['TH:单文杰', 'Sura Sinthuyodsakun'],
  ['TH:吴多华', 'Pong Daruganon'],
  ['JP:可儿宏晖', 'Kani Hiroaki'],
  ['JP:所司和晴', 'Shoshi Kazuharu'],
  ['AU:于文彬', 'Winston Yu'],
  // Pinyin would read Jingbin.
  ['AU:胡敬斌', 'Hu Jinbin'],
  // 2025 19th World Xiangqi Championship (Shanghai), WXF results.
  ['AU:阮日光', 'Quang Nhat Nguyen'],
  // The WXF prints "Fung Tony Ga Zen", the Hong Kong Olympic delegation list
  // "FUNG Tong Ga Zen"; ordered here as the AXF sheet orders an English name.
  ['HK:冯家俊', 'Tony Fung Ga Zen'],
  // 2022 Asian Games (Hangzhou): the official Chinese round pages matched by
  // board to the English entry lists of the same rounds.
  ['VN:阮成保', 'Nguyễn Thành Bảo'],
  ['VN:黎氏金鸾', 'Lê Thị Kim Loan'],
  ['SG:吴兰香', 'Ngô Lan Hương'],
  ['SG:刘亿豪', 'Low Yi Hao'],
  ['SG:陈茗芳', 'Fiona Tan Min Fang'],
  ['MY:陈有发', 'Tan Yu Huat'],
  ['MY:余欣如', 'Jee Xin Ru'],
  ['HK:陈振杰', 'Chan Chun Kit'],
  ['MO:甘建希', 'Kam Kin Hei'],
  ['TW:刘国华', 'Liu Kuo-hua'],
  ['TW:彭柔安', 'Peng Jou-an'],
  ['TW:赵奕帆', 'Chao Yi-fan'],
]);

function federationPlayerName(zh: string, federation: string | undefined): string | undefined {
  const region = federationRegion(federation);
  return region ? FEDERATION_PLAYER_NAMES.get(`${region}:${zh}`) : undefined;
}

// Longest match wins; entries are sorted by key length at module init.
const EVENT_GLOSSARY: Array<[string, string]> = [
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

// Team affiliations, which arrive whenever the source is a team competition
// (甲级联赛 is one). Only the structural parts are glossed: the sponsor and the
// place name are proper nouns and fall through to pinyin, which is the right
// outcome for "浙江民泰银行象棋队" -> "Zhejiang Mintai Bank Xiangqi Team".
// Places, so the residual pinyin does not weld a province onto the sponsor
// that follows it ("浙江民泰" would otherwise render "Zhejiangmintai"). Only the
// province/municipality and the cities that actually field xiangqi teams are
// listed; anything else still falls through to pinyin as one token, which is
// the right treatment for a brand name.
const PLACE_GLOSSARY: Array<[string, string]> = [
  ['黑龙江', 'Heilongjiang'],
  ['内蒙古', 'Inner Mongolia'],
  ['哈尔滨', 'Harbin'],
  ['石家庄', 'Shijiazhuang'],
  ['北京', 'Beijing'],
  ['天津', 'Tianjin'],
  ['上海', 'Shanghai'],
  ['重庆', 'Chongqing'],
  ['河北', 'Hebei'],
  ['山西', 'Shanxi'],
  ['辽宁', 'Liaoning'],
  ['吉林', 'Jilin'],
  ['龙江', 'Longjiang'],
  ['江苏', 'Jiangsu'],
  ['浙江', 'Zhejiang'],
  ['安徽', 'Anhui'],
  ['福建', 'Fujian'],
  ['江西', 'Jiangxi'],
  ['山东', 'Shandong'],
  ['河南', 'Henan'],
  ['湖北', 'Hubei'],
  ['湖南', 'Hunan'],
  ['广东', 'Guangdong'],
  ['广西', 'Guangxi'],
  ['海南', 'Hainan'],
  ['四川', 'Sichuan'],
  ['贵州', 'Guizhou'],
  ['云南', 'Yunnan'],
  ['陕西', 'Shaanxi'],
  ['甘肃', 'Gansu'],
  ['青海', 'Qinghai'],
  ['宁夏', 'Ningxia'],
  ['新疆', 'Xinjiang'],
  ['西藏', 'Tibet'],
  ['台湾', 'Taiwan'],
  ['香港', 'Hong Kong'],
  ['澳门', 'Macau'],
  // Federations at the Asian and world events, which the romaniser otherwise
  // spells out in pinyin (越南 came out as "Yuenan", 中国 as "Zhongguo").
  // Hong Kong and Macau enter as themselves, with the 中国 prefix dropped as
  // the Asian and world federations' English results drop it.
  ['中国香港', 'Hong Kong'],
  ['中国澳门', 'Macau'],
  ['中国台北', 'Chinese Taipei'],
  ['中国', 'China'],
  ['中华台北', 'Chinese Taipei'],
  // Malaysia enters the Asian championships as two federations, 西马 and 东马
  // (both coded MAS); the AXF's English member list names them West Malaysia
  // (Malaysia Xiangqi Federation) and East Malaysia (Sabah and Sarawak).
  ['西马', 'West Malaysia'],
  ['东马', 'East Malaysia'],
  ['台北', 'Taipei'],
  ['越南', 'Vietnam'],
  ['新加坡', 'Singapore'],
  ['马来西亚', 'Malaysia'],
  ['菲律宾', 'Philippines'],
  ['泰国', 'Thailand'],
  ['印度尼西亚', 'Indonesia'],
  ['印尼', 'Indonesia'],
  ['文莱', 'Brunei'],
  ['缅甸', 'Myanmar'],
  ['柬埔寨', 'Cambodia'],
  ['日本', 'Japan'],
  ['黎巴嫩', 'Lebanon'],
  ['印度', 'India'],
  ['澳洲', 'Australia'],
  ['韩国', 'South Korea'],
  ['蒙古', 'Mongolia'],
  ['澳大利亚', 'Australia'],
  ['新西兰', 'New Zealand'],
  ['加拿大', 'Canada'],
  ['美国', 'United States'],
  ['英国', 'United Kingdom'],
  ['法国', 'France'],
  ['德国', 'Germany'],
  ['意大利', 'Italy'],
  ['荷兰', 'Netherlands'],
  ['芬兰', 'Finland'],
  ['瑞典', 'Sweden'],
  ['俄罗斯', 'Russia'],
  ['大学', 'University'],
  ['济南', 'Jinan'],
  ['杭州', 'Hangzhou'],
  ['深圳', 'Shenzhen'],
  ['广州', 'Guangzhou'],
  ['成都', 'Chengdu'],
  ['武汉', 'Wuhan'],
  ['南京', 'Nanjing'],
  ['厦门', 'Xiamen'],
  ['青岛', 'Qingdao'],
  ['大连', 'Dalian'],
  ['沈阳', 'Shenyang'],
  ['长春', 'Changchun'],
  ['郑州', 'Zhengzhou'],
  ['西安', "Xi'an"],
  ['苏州', 'Suzhou'],
  ['无锡', 'Wuxi'],
  ['温州', 'Wenzhou'],
  ['宁波', 'Ningbo'],
  ['嘉定', 'Jiading'],
  ['滨海', 'Binhai'],
  // A district of Jinan (山东济南钢城民生实业队), which otherwise welded onto
  // the sponsor after it ("Gangchengminsheng").
  ['钢城', 'Gangcheng'],
];

const TEAM_GLOSSARY: Array<[string, string]> = [
  // 市 and 省 are administrative suffixes English drops: 杭州市 -> Hangzhou,
  // 广东省 -> Guangdong.
  ['市', ''],
  ['省', ''],
  // 2026 甲级联赛 stage one fielded three sponsors that are institutions, not
  // brands, so they gloss rather than romanize: 常熟文旅酒店, 深圳市群众体育促进中心,
  // 杭州环境集团队. Left to pinyin they rendered as one welded token each
  // ("Changshuwenlujiudian").
  ['群众体育促进中心', 'Mass Sports Promotion Centre'],
  // The 2026 national team championship is played by provincial sports
  // bodies, whose names are administrative vocabulary rather than brands. Left
  // to pinyin they welded into one token ("Hebei Tiyujuqipaiyundongzhongxin");
  // glossed, they read as what they are, short where English allows.
  ['社会体育指导与棋牌运动管理中心', 'Sports and Board Games Centre'],
  ['社会体育运动发展中心', 'Sports Development Centre'],
  ['文化体育广电和旅游局', 'Culture, Sports and Tourism Bureau'],
  ['生产建设兵团', 'Production and Construction Corps'],
  ['维吾尔自治区', ''],
  ['棋牌运动管理中心', 'Board Games Centre'],
  ['棋牌运动中心', 'Board Games Centre'],
  ['智力运动管理中心', 'Mind Sports Centre'],
  ['智力运动中心', 'Mind Sports Centre'],
  ['智力运动队', 'Mind Sports Team'],
  ['体育训练中心', 'Sports Training Centre'],
  ['全民健身中心', 'Fitness Centre'],
  ['体育事业发展中心', 'Sports Development Centre'],
  ['体育发展中心', 'Sports Development Centre'],
  ['体育总会', 'Sports Federation'],
  ['体育中心', 'Sports Centre'],
  ['体育局', 'Sports Bureau'],
  ['中国象棋协会', 'Chinese Xiangqi Association'],
  // The institution words on their own, so a body not listed above still
  // reads as words around its proper noun rather than one welded pinyin
  // token ("Xiamen Tiyushiyefazhanzhongxin" was the 2026 case).
  ['运动管理中心', 'Sports Centre'],
  ['运动中心', 'Sports Centre'],
  ['管理中心', 'Centre'],
  ['发展中心', 'Development Centre'],
  ['中心', 'Centre'],
  ['体育', 'Sports'],
  ['棋牌', 'Board Games'],
  ['运动', 'Sports'],
  ['二沙', 'Ersha'],
  ['玻璃', 'Glass'],
  ['文旅酒店', 'Culture and Tourism Hotel'],
  ['环境集团', 'Environment Group'],
  ['象棋俱乐部', 'Xiangqi Club'],
  ['象棋协会', 'Xiangqi Association'],
  ['棋类协会', 'Chess Association'],
  ['象棋总会', 'Xiangqi Federation'],
  ['象棋队', 'Xiangqi Team'],
  ['实业队', 'Industrial Team'],
  ['体彩队', 'Sports Lottery Team'],
  ['棋牌中心', 'Chess and Card Centre'],
  ['棋院', 'Chess Academy'],
  ['俱乐部', 'Club'],
  ['总会', 'Federation'],
  ['协会', 'Association'],
  ['体彩', 'Sports Lottery'],
  ['新区', 'New Area'],
  ['银行', 'Bank'],
  ['磨料', 'Abrasives'],
  ['实业', 'Industrial'],
  ['香港', 'Hong Kong'],
  ['广东', 'Guangdong'],
  ['队', 'Team'],
  ...PLACE_GLOSSARY,
  ...EVENT_GLOSSARY,
];

const ROUND_GLOSSARY: Array<[string, string]> = [
  ['四分之一决赛', 'Quarterfinal'],
  ['四分一决赛', 'Quarterfinal'],
  ['半决赛', 'Semifinal'],
  ['决赛', 'Final'],
  ['预赛', 'Preliminary'],
  ['附加赛', 'Playoff'],
  ['加赛', 'Tiebreak'],
  ['快棋', 'Rapid'],
  ['慢棋', 'Classical'],
  ['八强', 'Quarterfinal'],
  ['8强', 'Quarterfinal'],
  ['四强', 'Semifinal'],
  ...EVENT_GLOSSARY,
];

type NumberedUnit = { unit: string; render: (n: number) => string };

// 第N届 renders as an English ordinal (第21届 -> 21st).
const EVENT_UNITS: NumberedUnit[] = [{ unit: '届', render: ordinalEn }];

const ROUND_UNITS: NumberedUnit[] = [
  ...EVENT_UNITS,
  { unit: '轮', render: (n) => `Round ${n}` },
  { unit: '台', render: (n) => `Board ${n}` },
  { unit: '局', render: (n) => `Game ${n}` },
  { unit: '阶段', render: (n) => `Stage ${n}` },
  { unit: '季', render: (n) => `Season ${n}` },
];

function byKeyLengthDesc(entries: Array<[string, string]>): Array<[string, string]> {
  return [...entries].sort((a, b) => b[0].length - a[0].length);
}

const EVENT_GLOSSARY_SORTED = byKeyLengthDesc(EVENT_GLOSSARY);
const TEAM_GLOSSARY_SORTED = byKeyLengthDesc(TEAM_GLOSSARY);
const ROUND_GLOSSARY_SORTED = byKeyLengthDesc(ROUND_GLOSSARY);

function isFullyAscii(value: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII means the full 0x00-0x7F range.
  return /^[\x00-\x7F]*$/.test(value);
}

function isHanRun(value: string): boolean {
  return /^\p{Script=Han}+$/u.test(value);
}

// Tone marks are already dropped by toneType 'none'; NFD + mark-stripping
// additionally folds the remaining diaeresis so lü -> lu.
function toPlainLatin(syllable: string): string {
  return syllable.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ü', 'u');
}

function titleCase(word: string): string {
  return word.length > 0 ? `${word.slice(0, 1).toUpperCase()}${word.slice(1)}` : word;
}

function pinyinSyllables(text: string, surnameMode = false): string[] {
  const options = surnameMode ? ({ ...PINYIN_OPTIONS, mode: 'surname' } as const) : PINYIN_OPTIONS;
  return pinyin(text, options)
    .map(toPlainLatin)
    .filter((syllable) => syllable.length > 0);
}

// One title-cased Latin word for a CJK run: 广东 -> Guangdong.
function romanizeRunAsWord(run: string): string {
  return titleCase(pinyinSyllables(run).join(''));
}

// Xiangqi player-name convention: surname first, given name joined, each word
// capitalized (徐腾飞 -> Xu Tengfei; 欧阳明 -> Ouyang Ming). Surname mode is
// applied only to the surname slice: surname readings are polyphonic (单 shan,
// 解 xie) but must not leak into given-name characters (繁 fan, not po).
function romanizeChineseName(token: string): string {
  const compound = COMPOUND_SURNAMES.find((surname) => token.startsWith(surname));
  const surname = compound ?? token.slice(0, 1);
  const given = token.slice(surname.length);
  const surnameWord = titleCase(
    SURNAME_READINGS.get(surname) ?? pinyinSyllables(surname, true).join(''),
  );
  if (surnameWord.length === 0) return token;
  const givenWord = titleCase(pinyinSyllables(given).join(''));
  return givenWord ? `${surnameWord} ${givenWord}` : surnameWord;
}

// A token mixing Han and non-Han content: keep the non-Han parts verbatim and
// romanize each Han run as a single word.
function romanizeMixedToken(token: string): string {
  return token
    .split(/(\p{Script=Han}+)/u)
    .map((part) => (isHanRun(part) ? romanizeRunAsWord(part) : part))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A player's name, romanized. `federation` (the source's Chinese team or
 * federation field) scopes the overrides for players from outside mainland
 * China, whose Chinese names are common enough to belong to a mainland player
 * too: 林嘉欣 of Hong Kong is Lam Ka Yan, a 林嘉欣 on a mainland team stays pinyin.
 */
export function romanizeXiangqiPlayerName(zh: string, federation?: string): string | undefined {
  const trimmed = zh.trim();
  if (trimmed.length === 0 || isFullyAscii(trimmed)) return undefined;
  const scoped = federationPlayerName(trimmed, federation);
  if (scoped) return scoped;
  const whole = PLAYER_NAME_OVERRIDES.get(trimmed);
  if (whole) return whole;

  // Space/dot-separated tokens: the last token is the player name, leading
  // tokens are team/region qualifiers (广东 许银川 -> Guangdong Xu Yinchuan).
  const tokens = trimmed.split(/[\s.·]+/u).filter((token) => token.length > 0);
  const words = tokens.map((token, index) => {
    if (isFullyAscii(token)) return token;
    const override = PLAYER_NAME_OVERRIDES.get(token);
    if (override) return override;
    if (!isHanRun(token)) return romanizeMixedToken(token);
    return index === tokens.length - 1 ? romanizeChineseName(token) : romanizeRunAsWord(token);
  });
  const result = words.join(' ').replace(/\s+/g, ' ').trim();
  return result.length > 0 ? result : undefined;
}

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

// Arabic digits or Chinese numerals up to 999 (十一 -> 11, 二十一 -> 21).
function parseNumeral(text: string): number | undefined {
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

function ordinalEn(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = n % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function matchNumberedUnit(
  text: string,
  index: number,
  units: NumberedUnit[],
): { en: string; length: number } | undefined {
  if (text[index] !== '第') return undefined;
  let cursor = index + 1;
  let numeral = '';
  while (cursor < text.length && /[0-9零一二两三四五六七八九十百]/.test(text[cursor]!)) {
    numeral += text[cursor];
    cursor += 1;
  }
  if (numeral.length === 0) return undefined;
  for (const { unit, render } of units) {
    if (!text.startsWith(unit, cursor)) continue;
    const value = parseNumeral(numeral);
    if (value === undefined) return undefined;
    return { en: render(value), length: cursor + unit.length - index };
  }
  return undefined;
}

// A residual CJK run with a 杯 suffix is a cup name: 将军杯 -> Jiangjun Cup.
function romanizeResidual(run: string): string {
  if (run.length > 1 && run.endsWith('杯')) return `${romanizeRunAsWord(run.slice(0, -1))} Cup`;
  return romanizeRunAsWord(run);
}

function translateGlossaryText(
  zh: string,
  glossary: Array<[string, string]>,
  units: NumberedUnit[],
): string | undefined {
  // Detach year markers (2004年 -> 2004) before scanning.
  const trimmed = zh
    .trim()
    .replace(/(\d)年/g, '$1 ')
    .replace(/\s+/g, ' ');
  if (trimmed.length === 0 || isFullyAscii(trimmed)) return undefined;

  const tokens: string[] = [];
  let residual = '';
  const flushResidual = (): void => {
    if (residual.length > 0) {
      tokens.push(romanizeResidual(residual));
      residual = '';
    }
  };

  let i = 0;
  while (i < trimmed.length) {
    const numbered = matchNumberedUnit(trimmed, i, units);
    if (numbered) {
      flushResidual();
      tokens.push(numbered.en);
      i += numbered.length;
      continue;
    }
    const entry = glossary.find(([key]) => trimmed.startsWith(key, i));
    if (entry) {
      flushResidual();
      if (entry[1].length > 0) tokens.push(entry[1]);
      i += entry[0].length;
      continue;
    }
    const char = trimmed[i]!;
    if (isFullyAscii(char)) {
      flushResidual();
      let run = '';
      while (
        i < trimmed.length &&
        isFullyAscii(trimmed[i]!) &&
        !glossary.some(([key]) => trimmed.startsWith(key, i))
      ) {
        run += trimmed[i];
        i += 1;
      }
      const cleaned = run.trim();
      if (cleaned.length > 0) tokens.push(cleaned);
      continue;
    }
    if (char === '（' || char === '）') {
      // A bracketed alias (北京棋院（北京市棋牌运动管理中心）) keeps its brackets.
      flushResidual();
      tokens.push(char === '（' ? '(' : ')');
      i += 1;
      continue;
    }
    if (/[\p{P}\p{S}]/u.test(char)) {
      // CJK punctuation acts as a separator.
      flushResidual();
      i += 1;
      continue;
    }
    residual += char;
    i += 1;
  }
  flushResidual();

  const result = tokens
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')')
    .replace(/\(\)/g, '')
    .trim();
  return result.length > 0 ? result : undefined;
}

export function translateXiangqiEventName(zh: string): string | undefined {
  return translateGlossaryText(zh, EVENT_GLOSSARY_SORTED, EVENT_UNITS);
}

export function translateXiangqiRoundLabel(zh: string): string | undefined {
  // A stage heads what follows it: 第2阶段第09轮 -> "Stage 2, Round 9".
  return translateGlossaryText(zh, ROUND_GLOSSARY_SORTED, ROUND_UNITS)?.replace(
    /\b(Stage \d+) (?=\S)/g,
    '$1, ',
  );
}

export function translateXiangqiTeamName(zh: string): string | undefined {
  return translateGlossaryText(zh, TEAM_GLOSSARY_SORTED, EVENT_UNITS);
}

// Recompute `nameEn` from the current `name`. The existing nameEn (if any) is
// dropped first so stale caches self-heal and repeated writes stay idempotent;
// nameEn is always (re)appended last, keeping the JSON key order stable for
// payload equality checks.
function withRecomputedNameEn<T extends { name: string; nameEn?: string }>(
  value: T,
  translate: (zh: string) => string | undefined,
): T {
  const { nameEn: _stale, ...rest } = value;
  const nameEn = translate(value.name);
  return (nameEn === undefined ? rest : { ...rest, nameEn }) as T;
}

export function translatedXiangqiBroadcastTour<T extends { name: string; nameEn?: string }>(
  tour: T,
): T {
  return withRecomputedNameEn(tour, translateXiangqiEventName);
}

export function translatedXiangqiBroadcastRound<T extends { name: string; nameEn?: string }>(
  round: T,
): T {
  return withRecomputedNameEn(round, translateXiangqiRoundLabel);
}

// Same self-healing contract as nameEn: drop the stale value, recompute from
// the current Chinese, re-append last so the JSON key order stays stable.
function withRecomputedFederationEn<T extends { federation?: string; federationEn?: string }>(
  value: T,
): T {
  const { federationEn: _stale, ...rest } = value;
  const federationEn = value.federation ? translateXiangqiTeamName(value.federation) : undefined;
  return (federationEn === undefined ? rest : { ...rest, federationEn }) as T;
}

export function translatedXiangqiBroadcastPlayerTag<
  T extends { name: string; nameEn?: string; federation?: string; federationEn?: string },
>(player: T): T {
  return withRecomputedFederationEn(
    withRecomputedNameEn(player, (name) => romanizeXiangqiPlayerName(name, player.federation)),
  );
}

/**
 * A team match's English name, side by side ("北京-江苏" -> "Beijing-Jiangsu"),
 * keeping the source's delimiter so a reader splits both forms the same way.
 * Undefined unless every side translates: half-English reads worse than the
 * Chinese. A field with no delimiter is a section the source files games
 * under ("元老组", "第一季红帅组"), which reads as a round label does.
 */
export function translateXiangqiMatchName(zh: string): string | undefined {
  const sides = zh.split('-').map((side) => side.trim());
  if (sides.length === 1) return translateXiangqiRoundLabel(zh);
  if (sides.some((side) => side.length === 0)) return undefined;
  const english = sides.map((side) => translateXiangqiTeamName(side));
  return english.every((side) => side !== undefined) ? english.join('-') : undefined;
}

// Same self-healing contract as nameEn, for the match on a board's details.
function withRecomputedMatchEn<T extends { details?: { match?: string; matchEn?: string } }>(
  board: T,
): T {
  if (!board.details) return board;
  const { matchEn: _stale, ...rest } = board.details;
  const matchEn = rest.match ? translateXiangqiMatchName(rest.match) : undefined;
  return { ...board, details: matchEn === undefined ? rest : { ...rest, matchEn } };
}

export function translatedXiangqiBroadcastBoard<
  T extends {
    red: { name: string; nameEn?: string; federation?: string; federationEn?: string };
    black: { name: string; nameEn?: string; federation?: string; federationEn?: string };
    details?: { match?: string; matchEn?: string };
  },
>(board: T): T {
  return withRecomputedMatchEn({
    ...board,
    red: translatedXiangqiBroadcastPlayerTag(board.red),
    black: translatedXiangqiBroadcastPlayerTag(board.black),
  });
}

export function translateXiangqiBroadcastSnapshot<
  Tour extends { name: string; nameEn?: string },
  Round extends { name: string; nameEn?: string },
  Board extends {
    red: { name: string; nameEn?: string };
    black: { name: string; nameEn?: string };
  },
>(snapshot: {
  tour: Tour;
  rounds: Round[];
  boards: Board[];
}): { tour: Tour; rounds: Round[]; boards: Board[] } {
  return {
    tour: translatedXiangqiBroadcastTour(snapshot.tour),
    rounds: snapshot.rounds.map((round) => translatedXiangqiBroadcastRound(round)),
    boards: snapshot.boards.map((board) => translatedXiangqiBroadcastBoard(board)),
  };
}
