import assert from 'node:assert/strict';
import test from 'node:test';
import type { XiangqiBroadcastPlayerTag } from '@mistboard/game';
import {
  romanizeXiangqiPlayerName,
  translatedXiangqiBroadcastPlayerTag,
  translatedXiangqiBroadcastRound,
  translatedXiangqiBroadcastTour,
  translateXiangqiBroadcastSnapshot,
  translateXiangqiEventName,
  translateXiangqiMatchName,
  translateXiangqiRoundLabel,
  translateXiangqiTeamName,
} from './xiangqi-broadcast-translate.js';

// Every player name ingested with the 2026 national team championship tour.
const TOUR_PLAYERS = [
  '徐腾飞',
  '周开薪',
  '崔革',
  '孟繁睿',
  '曹岩磊',
  '李小龙',
  '李成蹊',
  '储般若',
  '蔡佑广',
  '高飞',
  '赵玮',
  '吴魏',
  '申嘉伟',
  '杨应东',
  '彭国庆',
  '孟辰',
  '李彦阳',
  '唐丹',
  '董毓男',
  '张婷',
  '沈思凡',
  '刘钰',
  '周博靓',
  '周雨霏',
  '傅安欣',
];

const LATIN_NAME = /^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/;

// Minimal shapes for the translation helpers (the real types add more fields).
type Named = { name: string; nameEn?: string };
type PlayerPair = { red: Named; black: Named };

test('translateXiangqiEventName translates the real 2026 team championship name', () => {
  assert.equal(
    translateXiangqiEventName('2026全国象棋团体赛'),
    '2026 National Xiangqi Team Championship',
  );
});

test('translateXiangqiEventName handles ordinals, cups, groups, and year markers', () => {
  assert.equal(
    translateXiangqiEventName('第21届五羊杯全国象棋冠军赛'),
    '21st Five Rams Cup National Xiangqi Champions Tournament',
  );
  assert.equal(
    translateXiangqiEventName('2004年将军杯全国象棋甲级联赛'),
    '2004 Jiangjun Cup National Xiangqi Division A League',
  );
  assert.equal(
    translateXiangqiEventName('2026全国象棋团体赛女子组'),
    '2026 National Xiangqi Team Championship Women',
  );
  assert.equal(translateXiangqiEventName('世界象棋锦标赛'), 'World Xiangqi Championship');
});

test('translateXiangqiEventName names the 2026 spring invitationals', () => {
  assert.equal(
    translateXiangqiEventName('2026年“春丘大叶杯”象棋大师十番棋战'),
    '2026 Chunqiu Dayie Cup Xiangqi Masters Ten-Game Match',
  );
  assert.equal(
    translateXiangqiEventName('2026年“春丘大叶杯”象棋大师擂台赛'),
    '2026 Chunqiu Dayie Cup Xiangqi Masters Challenge',
  );
});

test('translateXiangqiEventName names the 2026 exhibitions and opens', () => {
  assert.equal(
    translateXiangqiEventName('2026年广东十虎VS年轻大师联队对抗赛'),
    '2026 Guangdong Ten Tigers VS Young Masters Team Match',
  );
  assert.equal(
    translateXiangqiEventName('2026年首届“天长杯”全国象棋公开赛'),
    '2026 1st Tianchang Cup National Xiangqi Open',
  );
});

test('translateXiangqiEventName always yields fully Latin output for CJK input', () => {
  for (const name of ['象棋直播室', '测试联赛', '赛事测试杯']) {
    const translated = translateXiangqiEventName(name);
    assert.ok(translated, `expected a translation for ${name}`);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII means the full 0x00-0x7F range.
    assert.match(translated, /^[\x00-\x7F]+$/, `expected Latin-only output for ${name}`);
  }
});

test('translateXiangqiEventName returns undefined for ASCII input', () => {
  assert.equal(translateXiangqiEventName('WXF Xiangqi Broadcast'), undefined);
  assert.equal(translateXiangqiEventName('2026 Test Cup'), undefined);
  assert.equal(translateXiangqiEventName(''), undefined);
});

test('translateXiangqiRoundLabel maps numbered rounds with Arabic and Chinese numerals', () => {
  for (let n = 3; n <= 9; n += 1) {
    assert.equal(translateXiangqiRoundLabel(`第${n}轮`), `Round ${n}`);
  }
  assert.equal(translateXiangqiRoundLabel('第03轮'), 'Round 3');
  assert.equal(translateXiangqiRoundLabel('第十一轮'), 'Round 11');
  assert.equal(translateXiangqiRoundLabel('第二十一轮'), 'Round 21');
  assert.equal(translateXiangqiRoundLabel('第2台'), 'Board 2');
});

test('translateXiangqiRoundLabel maps stage labels and combinations', () => {
  assert.equal(translateXiangqiRoundLabel('决赛'), 'Final');
  assert.equal(translateXiangqiRoundLabel('半决赛'), 'Semifinal');
  assert.equal(translateXiangqiRoundLabel('四分之一决赛'), 'Quarterfinal');
  assert.equal(translateXiangqiRoundLabel('8强'), 'Quarterfinal');
  assert.equal(translateXiangqiRoundLabel('预赛'), 'Preliminary');
  assert.equal(translateXiangqiRoundLabel('附加赛'), 'Playoff');
  assert.equal(translateXiangqiRoundLabel('加赛'), 'Tiebreak');
  assert.equal(translateXiangqiRoundLabel('快棋'), 'Rapid');
  assert.equal(translateXiangqiRoundLabel('慢棋'), 'Classical');
  assert.equal(translateXiangqiRoundLabel('半决赛第2局'), 'Semifinal Game 2');
});

test('translateXiangqiRoundLabel maps a staged round, dropping leading zeros', () => {
  // 2026 Chunqiu Dayie Cup (春秋大业杯) labels its rounds by stage.
  assert.equal(translateXiangqiRoundLabel('第2阶段第09轮'), 'Stage 2, Round 9');
  assert.equal(translateXiangqiRoundLabel('第1阶段第1轮'), 'Stage 1, Round 1');
  assert.equal(translateXiangqiRoundLabel('第二阶段第十轮'), 'Stage 2, Round 10');
  assert.equal(translateXiangqiRoundLabel('第2阶段'), 'Stage 2');
});

test('translateXiangqiRoundLabel returns undefined for ASCII input', () => {
  assert.equal(translateXiangqiRoundLabel('Round 1'), undefined);
  assert.equal(translateXiangqiRoundLabel('WXF Round'), undefined);
});

test('romanizeXiangqiPlayerName romanizes every 2026 team championship player', () => {
  for (const name of TOUR_PLAYERS) {
    const romanized = romanizeXiangqiPlayerName(name);
    assert.ok(romanized, `expected a romanization for ${name}`);
    assert.match(romanized, LATIN_NAME, `expected Surname Given shape for ${name}: ${romanized}`);
  }
});

test('romanizeXiangqiPlayerName produces the expected exact spellings', () => {
  assert.equal(romanizeXiangqiPlayerName('徐腾飞'), 'Xu Tengfei');
  assert.equal(romanizeXiangqiPlayerName('唐丹'), 'Tang Dan');
  assert.equal(romanizeXiangqiPlayerName('高飞'), 'Gao Fei');
  assert.equal(romanizeXiangqiPlayerName('孟繁睿'), 'Meng Fanrui');
});

test('romanizeXiangqiPlayerName prefers established spellings for famous players', () => {
  assert.equal(romanizeXiangqiPlayerName('王天一'), 'Wang Tianyi');
  assert.equal(romanizeXiangqiPlayerName('郑惟桐'), 'Zheng Weitong');
  assert.equal(romanizeXiangqiPlayerName('吕钦'), 'Lu Qin');
  assert.equal(romanizeXiangqiPlayerName('许银川'), 'Xu Yinchuan');
});

test('romanizeXiangqiPlayerName handles compound surnames and surname polyphones', () => {
  assert.equal(romanizeXiangqiPlayerName('欧阳明'), 'Ouyang Ming');
  assert.equal(romanizeXiangqiPlayerName('司马懿'), 'Sima Yi');
  // 单 reads shan as a surname, 解 reads xie.
  assert.equal(romanizeXiangqiPlayerName('单霞丽'), 'Shan Xiali');
  assert.equal(romanizeXiangqiPlayerName('解小明'), 'Xie Xiaoming');
});

test('romanizeXiangqiPlayerName keeps team qualifiers as separate words', () => {
  assert.equal(romanizeXiangqiPlayerName('广东 许银川'), 'Guangdong Xu Yinchuan');
  assert.equal(romanizeXiangqiPlayerName('河北 高飞'), 'Hebei Gao Fei');
});

test('romanizeXiangqiPlayerName returns undefined for ASCII input', () => {
  assert.equal(romanizeXiangqiPlayerName('A Player'), undefined);
  assert.equal(romanizeXiangqiPlayerName('Mistboard Engine'), undefined);
  assert.equal(romanizeXiangqiPlayerName(''), undefined);
});

test('translated tour/round helpers recompute nameEn and drop stale caches', () => {
  const tour = translatedXiangqiBroadcastTour({
    name: '2026全国象棋团体赛',
    nameEn: 'Stale Cached Value',
  });
  assert.equal(tour.nameEn, '2026 National Xiangqi Team Championship');

  const round = translatedXiangqiBroadcastRound<Named>({ name: '第3轮' });
  assert.equal(round.nameEn, 'Round 3');

  // ASCII names get no nameEn, and any stale cache is removed.
  const ascii = translatedXiangqiBroadcastTour({ name: 'Test Cup', nameEn: 'Stale' });
  assert.equal('nameEn' in ascii, false);
});

test('translateXiangqiBroadcastSnapshot translates tour, rounds, and both players', () => {
  const snapshot = translateXiangqiBroadcastSnapshot<Named, Named, PlayerPair>({
    tour: { name: '2026全国象棋团体赛' },
    rounds: [{ name: '第3轮' }, { name: '第4轮' }],
    boards: [{ red: { name: '徐腾飞' }, black: { name: '唐丹' } }],
  });
  assert.equal(snapshot.tour.nameEn, '2026 National Xiangqi Team Championship');
  assert.deepEqual(
    snapshot.rounds.map((round) => round.nameEn),
    ['Round 3', 'Round 4'],
  );
  assert.equal(snapshot.boards[0]!.red.nameEn, 'Xu Tengfei');
  assert.equal(snapshot.boards[0]!.black.nameEn, 'Tang Dan');
});

test('translation is idempotent: retranslating a translated value is a no-op', () => {
  const first = translateXiangqiBroadcastSnapshot<Named, Named, PlayerPair>({
    tour: { name: '2026全国象棋团体赛' },
    rounds: [{ name: '第3轮' }],
    boards: [{ red: { name: '徐腾飞' }, black: { name: '唐丹' } }],
  });
  const second = translateXiangqiBroadcastSnapshot(first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test('team affiliations translate structure and romanize the proper nouns', () => {
  // Real teams from the 2026 甲级联赛 qualifier. The place and the structural
  // suffix are glossed; the sponsor stays a single pinyin token, which is the
  // right treatment for a brand.
  assert.equal(translateXiangqiTeamName('浙江民泰银行象棋队'), 'Zhejiang Mintai Bank Xiangqi Team');
  assert.equal(translateXiangqiTeamName('杭州市棋类协会'), 'Hangzhou Chess Association');
  assert.equal(
    translateXiangqiTeamName('天津市滨海新区象棋协会'),
    'Tianjin Binhai New Area Xiangqi Association',
  );
  assert.equal(translateXiangqiTeamName('香港象棋总会'), 'Hong Kong Xiangqi Federation');
  assert.equal(translateXiangqiTeamName('龙江体彩队'), 'Longjiang Sports Lottery Team');
});

test('institutional sponsors from the 2026 league gloss instead of welding into pinyin', () => {
  // Stage one, 2026-09-18: these three came out as "Changshuwenlujiudian",
  // "Shenzhen Qunzhongtiyucujinzhongxin" and "Hangzhou Huanjingjituan Team",
  // and 广东省 kept its 省.
  assert.equal(translateXiangqiTeamName('常熟文旅酒店'), 'Changshu Culture and Tourism Hotel');
  assert.equal(
    translateXiangqiTeamName('深圳市群众体育促进中心'),
    'Shenzhen Mass Sports Promotion Centre',
  );
  assert.equal(translateXiangqiTeamName('杭州环境集团队'), 'Hangzhou Environment Group Team');
  assert.equal(translateXiangqiTeamName('广东省象棋协会'), 'Guangdong Xiangqi Association');
  // Brands still romanize as one token.
  assert.equal(translateXiangqiTeamName('上海金外滩象棋队'), 'Shanghai Jinwaitan Xiangqi Team');
});

test('a player tag caches the English team beside the English name', () => {
  const tag: XiangqiBroadcastPlayerTag = { name: '王家瑞', federation: '浙江民泰银行象棋队' };
  const translated = translatedXiangqiBroadcastPlayerTag(tag);
  assert.equal(translated.nameEn, 'Wang Jiarui');
  assert.equal(translated.federationEn, 'Zhejiang Mintai Bank Xiangqi Team');
  // Idempotent, and a stale cache self-heals rather than sticking.
  const again = translatedXiangqiBroadcastPlayerTag({
    ...translated,
    federationEn: 'Stale Team',
  } satisfies XiangqiBroadcastPlayerTag);
  assert.equal(again.federationEn, 'Zhejiang Mintai Bank Xiangqi Team');
});

test('a player with no team gets no federationEn key at all', () => {
  const tag: XiangqiBroadcastPlayerTag = { name: '王天一' };
  assert.equal('federationEn' in translatedXiangqiBroadcastPlayerTag(tag), false);
});

test('translateXiangqiTeamName glosses the national team championship sports bodies', () => {
  // The 2026 national team championship's teams are provincial sports bodies;
  // left to pinyin they welded into one token each.
  const cases: Array<[string, string]> = [
    ['河北省体育局棋牌运动中心', 'Hebei Sports Bureau Board Games Centre'],
    ['浙江省智力运动管理中心', 'Zhejiang Mind Sports Centre'],
    ['广东省二沙体育训练中心', 'Guangdong Ersha Sports Training Centre'],
    ['黑龙江省社会体育指导与棋牌运动管理中心', 'Heilongjiang Sports and Board Games Centre'],
    ['新疆维吾尔自治区体育局', 'Xinjiang Sports Bureau'],
    // A bracketed alias keeps its brackets.
    ['北京棋院（北京市棋牌运动管理中心）', 'Beijing Chess Academy (Beijing Board Games Centre)'],
  ];
  for (const [zh, en] of cases) assert.equal(translateXiangqiTeamName(zh), en, zh);
});

test('federations at the Asian and world events read as countries, not pinyin', () => {
  assert.equal(translateXiangqiTeamName('越南'), 'Vietnam');
  assert.equal(translateXiangqiTeamName('台北'), 'Taipei');
  assert.equal(translateXiangqiTeamName('中华台北'), 'Chinese Taipei');
  assert.equal(translateXiangqiTeamName('马来西亚'), 'Malaysia');
  assert.equal(translateXiangqiTeamName('武汉大学棋类协会'), 'Wuhan University Chess Association');
});

test('the prod translation pass (2026-09-25) fixes what came out as pinyin or literal', () => {
  assert.equal(
    translateXiangqiTeamName('中国香港象棋总会'),
    'Hong Kong Xiangqi Federation',
    'was "Zhongguo Hong Kong Xiangqi Federation"',
  );
  assert.equal(
    translateXiangqiTeamName('厦门市体育事业发展中心'),
    'Xiamen Sports Development Centre',
    'was "Xiamen Tiyushiyefazhanzhongxin"',
  );
  assert.equal(
    translateXiangqiTeamName('山东济南钢城民生实业队'),
    'Shandong Jinan Gangcheng Minsheng Industrial Team',
  );
  assert.equal(
    translateXiangqiEventName('2026年全国象棋男子甲级联赛'),
    "2026 National Xiangqi Men's Division A League",
  );
  // 么 is Yao as a surname; pinyin-pro reads it me even in surname mode.
  assert.equal(romanizeXiangqiPlayerName('么毅'), 'Yao Yi');
});

test('a section label in the match field translates like a round label', () => {
  assert.equal(translateXiangqiMatchName('元老组'), 'Veterans');
  assert.equal(
    translateXiangqiMatchName('预赛港澳台组'),
    'Preliminary Hong Kong, Macau and Taiwan',
  );
  assert.equal(translateXiangqiMatchName('第一季红帅组'), 'Season 1 Team Red');
  assert.equal(translateXiangqiMatchName('北京-江苏'), 'Beijing-Jiangsu');
});

test('Asian championship federations read as their English names', () => {
  const cases: Array<[string, string]> = [
    ['中国', 'China'],
    ['中国香港', 'Hong Kong'],
    ['中国澳门', 'Macau'],
    ['中华台北', 'Chinese Taipei'],
    ['西马', 'West Malaysia'],
    ['东马', 'East Malaysia'],
    ['黎巴嫩', 'Lebanon'],
    ['印度', 'India'],
    ['印度尼西亚', 'Indonesia'],
    ['菲律宾', 'Philippines'],
    ['文莱', 'Brunei'],
    ['澳大利亚', 'Australia'],
  ];
  for (const [zh, en] of cases) assert.equal(translateXiangqiTeamName(zh), en, zh);
});

test('players from outside mainland China take their own spelling, scoped by federation', () => {
  const tag = (name: string, federation?: string) =>
    translatedXiangqiBroadcastPlayerTag<XiangqiBroadcastPlayerTag>({
      name,
      ...(federation ? { federation } : {}),
    }).nameEn;
  assert.equal(tag('阮黄燕', '越南'), 'Nguyễn Hoàng Yến');
  assert.equal(tag('阮明日光', '越南'), 'Nguyễn Minh Nhật Quang');
  assert.equal(tag('黄学谦', '中国香港'), 'Wong Hok Him');
  assert.equal(tag('黄学谦', '香港象棋总会'), 'Wong Hok Him');
  assert.equal(tag('吴兰香', '新加坡'), 'Ngô Lan Hương');
  // The 2024 Asian championship entrants, as the AXF results sheet spells them.
  assert.equal(tag('武国达', '越南'), 'Vũ Quốc Đạt');
  assert.equal(tag('沈毅豪', '西马'), 'Sim Yip How');
  assert.equal(tag('许鲁斌', '东马'), 'Robin Hii Lu Bin');
  assert.equal(tag('葛振衣', '中华台北'), 'Ge Jen-yi');
  assert.equal(tag('葛振衣', '台北'), 'Ge Jen-yi');
  assert.equal(tag('苏俊豪', '中国澳门'), 'Sou Chon Hou');
  assert.equal(tag('可儿宏晖', '日本'), 'Kani Hiroaki');
  assert.equal(tag('所司和晴', '日本'), 'Shoshi Kazuharu');
  assert.equal(tag('单文杰', '泰国'), 'Sura Sinthuyodsakun');
  // The world champion is famous enough to need no federation.
  assert.equal(tag('赖理兄'), 'Lại Lý Huynh');
  // A common name on a mainland team keeps pinyin.
  assert.equal(tag('林嘉欣', '中国香港'), 'Lam Ka Yan');
  assert.equal(tag('林嘉欣', '广东'), 'Lin Jiaxin');
  assert.equal(tag('林嘉欣'), 'Lin Jiaxin');
});
