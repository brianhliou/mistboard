// Every word on the 象棋残局 page, in all three scripts, in one place, and the
// links its table cells carry.
//
// The page is a reference: a win-or-draw table of 35 common endings by
// attacking piece, graded in the manuals' words (例胜 / 巧胜 / 难胜 / 例和, with a
// glossary of all six), one exercise drawn from the kernel with a link to play
// it, the fortress pair, how to set up and look up any other ending, and how
// far the tablebase reaches. The 26 graded rows and their teaching lines live
// in packages/game (xiangqi-endgame-hub.ts, xiangqi-endgame-practice.ts); the
// nine extra rows below are shelf positions the article also shows, with their
// own chessdb checks recorded here. Two of them (单车对马炮, 车炮对单车 with
// Black on the middle file) and the vocabulary came from the brianhliou.com
// post "Xiangqi Basic Endgames" (2026-08-14), which now redirects here. The English strings ARE the article; the zh
// dictionaries that article-i18n.ts spreads in are generated from the same
// triples, so the three scripts cannot drift apart.
//
// zh is machine translation (2026-10-07), not native-reviewed. Terms follow the
// basic-endgame study (apps/server/src/xiangqi-endgame-study-i18n.ts): 巧胜,
// 高兵, 低兵, 底兵, 士象全; zh-Hant writes 砲 for the cannon there too. The
// analysis terms are the site's own (分析棋盘, 开局库, 残局库).

import {
  type EndgamePracticeSetSlug,
  type EndgameText,
  endgameRowText,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_PRACTICE_SET_IDS,
} from '@mistboard/game';

export type { EndgameText };

function tri(en: string, hans: string, hant: string): EndgameText {
  return { en, 'zh-Hans': hans, 'zh-Hant': hant };
}

/** Fixed page strings. */
export const ENDGAME_PAGE_TEXT = {
  title: tri(
    'Xiangqi Basic Endgames: Which Material Wins and Which Draws',
    '象棋残局：哪些子力能赢，哪些只能和',
    '象棋殘局：哪些子力能贏，哪些只能和',
  ),
  seoTitle: tri(
    'Xiangqi Basic Endgames: Win or Draw Table for 35 Common Endings',
    '象棋残局胜和表：35种常见残局，附电脑练习',
    '象棋殘局勝和表：35種常見殘局，附電腦練習',
  ),
  cardTitle: tri('Xiangqi Basic Endgames', '象棋残局', '象棋殘局'),
  summary: tri(
    'Xiangqi basic endgames, which win and which draw: a table of 35 common endings with the result and the key idea for each, every result checked against the chessdb.cn tablebase, and every position ready to practice against the computer.',
    '哪些象棋残局能赢，哪些只能和：35种常见残局的胜和表，每一种都附结果和要点，结果全部经象棋云库 chessdb.cn 核对，每个局面都可以直接和电脑练习。',
    '哪些象棋殘局能贏，哪些只能和：35種常見殘局的勝和表，每一種都附結果和要點，結果全部經象棋雲庫 chessdb.cn 核對，每個局面都可以直接和電腦練習。',
  ),
  introDecides: tri(
    'Two counts decide most xiangqi endgames before a move is played: what the attacker has left, and how much of the defence is still standing. Advisors and elephants never cross the river, but around their own general they are worth more than their size. A lone chariot, the strongest piece on the board, beats a general missing one elephant and only draws against the full defence of two advisors and two elephants (士象全). Three high soldiers or two horses break that same defence.',
    '大多数象棋残局，在走第一步之前就由两件事决定了：进攻方还剩什么子力，防守方的士象还剩多少。士象不能过河，但守在自己的将旁边，作用远大于本身的价值。盘上最强的单车能胜单缺象，却只能和士象全；而三个高兵或双马却能攻破士象全。',
    '大多數象棋殘局，在走第一步之前就由兩件事決定了：進攻方還剩什麼子力，防守方的士象還剩多少。士象不能過河，但守在自己的將旁邊，作用遠大於本身的價值。盤上最強的單車能勝單缺象，卻只能和士象全；而三個高兵或雙馬卻能攻破士象全。',
  ),
  introPractice: tri(
    'All 35 positions in the table below are on the Practice page against the computer, in the set for their piece. In the wins you play Red and give mate; in the draws you play Black and hold for 15 moves.',
    '下表全部35个局面都在练习页，按子力分在各自的练习集里，和电脑对下。胜局你执红将死对方；和局你执黑守住15回合。',
    '下表全部35個局面都在練習頁，按子力分在各自的練習集裡，和電腦對下。勝局你執紅將死對方；和局你執黑守住15回合。',
  ),
  practiceButton: tri('Practice these endgames', '练习这些残局', '練習這些殘局'),
  tableHeading: tri(
    'Which endgames win and which draw',
    '哪些残局能赢，哪些是和棋',
    '哪些殘局能贏，哪些是和棋',
  ),
  tableIntro: tri(
    'Each result is the grade Chinese endgame manuals give that kind of ending (the scale is below), shown on one position of that kind. In a **tricky win** (巧胜) the material normally draws and this position wins; in a **hard win** (难胜) the board shows the setup that holds. The **full defence** (士象全) is two advisors and two elephants. Soldiers are named by how far they have come: a **bottom soldier** (底兵) stands on the last rank, a **low soldier** (低兵) one rank short of it, and a **high soldier** (高兵) further back, where it can still come down on the palace. Each name in the table opens that position in the practice sets.',
    '结果一栏是中文残局书对这类残局的等级（见下面的等级表），旁边是这类残局的一个局面。**巧胜**：这类子力通常是和棋，但该局面能赢；**难胜**：棋盘上摆的是守和的阵形。**士象全**指双士双象。兵按走到的位置区分：**底兵**已到底线，**低兵**差一线到底，**高兵**还在更后面，仍能下压九宫。点表中的名称，即可在练习集里打开该局面。',
    '結果一欄是中文殘局書對這類殘局的等級（見下面的等級表），旁邊是這類殘局的一個局面。**巧勝**：這類子力通常是和棋，但該局面能贏；**難勝**：棋盤上擺的是守和的陣形。**士象全**指雙士雙象。兵按走到的位置區分：**底兵**已到底線，**低兵**差一線到底，**高兵**還在更後面，仍能下壓九宮。點表中的名稱，即可在練習集裡打開該局面。',
  ),
  gradesIntro: tri(
    'The manuals grade an ending on a six-step scale. The table uses four of the steps: a 必胜 or 必和 ending shows as 例胜 or 例和, which understates the result and never misstates it.',
    '残局书把残局的胜和分为六个等级。表中用其中四级：必胜、必和的残局记作例胜、例和，这样只会说轻，不会说错。',
    '殘局書把殘局的勝和分為六個等級。表中用其中四級：必勝、必和的殘局記作例勝、例和，這樣只會說輕，不會說錯。',
  ),
  headerGrade: tri('Grade', '等级', '等級'),
  headerClaim: tri('What it claims', '含义', '含義'),
  headerMaterial: tri('Material', '子力', '子力'),
  headerResult: tri('Result', '结果', '結果'),
  headerIdea: tri('Key idea', '要点', '要點'),
  // The result cells carry the manuals' word in English too: plain 'Win' and
  // 'Draw' are keys other articles translate as 胜 and 和, and the shared
  // dictionary lets the later entry win.
  resultWin: tri('Win (例胜)', '例胜', '例勝'),
  resultDraw: tri('Draw (例和)', '例和', '例和'),
  resultTrickyWin: tri('Tricky win (巧胜)', '巧胜', '巧勝'),
  resultHardWin: tri('Hard to win (难胜)', '难胜', '難勝'),
  groupSoldier: tri('Soldier endgames', '兵类残局', '兵類殘局'),
  groupHorse: tri('Horse endgames', '马类残局', '馬類殘局'),
  groupCannon: tri('Cannon endgames', '炮类残局', '砲類殘局'),
  groupChariot: tri('Chariot endgames', '车类残局', '車類殘局'),
  groupMixed: tri('Horse and soldier, chariot and cannon', '马兵与车炮残局', '馬兵與車砲殘局'),
  introSource: tri(
    'The results follow the Chinese Wikipedia list of standard results (象棋勝和定式), which cites 金启昌 and 杨典, 象棋残局胜和定式 (2008). Rows it does not grade follow English Wikipedia. The positions are ours, and every result was checked against the exact results of [chessdb.cn](https://www.chessdb.cn/), the Chinese chess cloud database, for that exact position.',
    '结果依据中文维基百科的“象棋勝和定式”条目，该条目引用金启昌、杨典《象棋残局胜和定式》（2008）。该条目没有给出等级的几行依据英文维基百科。局面由我们摆出，每一个结果都经[象棋云库 chessdb.cn](https://www.chessdb.cn/)对该局面的确切结果核对。',
    '結果依據中文維基百科的「象棋勝和定式」條目，該條目引用金啟昌、楊典《象棋殘局勝和定式》（2008）。該條目沒有給出等級的幾行依據英文維基百科。局面由我們擺出，每一個結果都經[象棋雲庫 chessdb.cn](https://www.chessdb.cn/)對該局面的確切結果核對。',
  ),
  exerciseHeading: tri(
    'Try one: horse against a lone elephant',
    '试一局：单马对单象',
    '試一局：單馬對單象',
  ),
  exerciseText: tri(
    'A horse against a lone elephant is a draw as a rule: the elephant switches flanks faster than the horse can cut it off. In this position the elephant is stuck on one side and Red moves first, and that is enough. The tablebase gives Red mate in five moves. The first move decides it: find the point that keeps the elephant from getting back across.',
    '单马对单象通常是和棋：象换翼的速度比马切断它的速度更快。这个局面里象被困在一侧，又轮到红方先走，这就够了。残局库给出红方五步杀。关键在第一步：找到那个让象回不到另一侧的位置。',
    '單馬對單象通常是和棋：象換翼的速度比馬切斷它的速度更快。這個局面裡象被困在一側，又輪到紅方先走，這就夠了。殘局庫給出紅方五步殺。關鍵在第一步：找到那個讓象回不到另一側的位置。',
  ),
  exerciseCaption: tri('Red to move and mate in five.', '红先，五步杀。', '紅先，五步殺。'),
  exerciseButton: tri('Play it out', '和电脑下', '和電腦下'),
  fortressHeading: tri(
    'One point can turn a draw into a win',
    '差一个位置，和棋就变成胜局',
    '差一個位置，和棋就變成勝局',
  ),
  captionFortress: tri(
    'Draw: horse and two elephants in their fortress.',
    '和：马双象摆成守和阵形。',
    '和：馬雙象擺成守和陣形。',
  ),
  captionBroken: tri(
    'Win: the same pieces, one elephant on g10.',
    '胜：同样的子力，一个象在g10。',
    '勝：同樣的子力，一個象在g10。',
  ),
  oneStep: tri(
    'In the first diagram the horse stands on the elephant point in front of the general and the two elephants protect each other, and the chariot cannot get through. In the second, the elephant from g6 stands on g10, and the chariot wins. It works the other way too: pull the three high soldiers back one rank and their win over the full defence is gone, because two of them now stand on points a black elephant can reach.',
    '第一幅图中，马守在将前的象位上，双象互相保护，单车攻不进去。第二幅图只是把g6的象换到g10，单车就能取胜。反过来也一样：把三个高兵各退一路，它们对士象全的胜势就没了，因为其中两个兵站到了黑象能走到的象位上。',
    '第一幅圖中，馬守在將前的象位上，雙象互相保護，單車攻不進去。第二幅圖只是把g6的象換到g10，單車就能取勝。反過來也一樣：把三個高兵各退一路，它們對士象全的勝勢就沒了，因為其中兩個兵站到了黑象能走到的象位上。',
  ),
  ownHeading: tri('Set up your own endgame', '自己摆残局', '自己擺殘局'),
  ownText: tri(
    'Any position can be practised the same way. Set it up in the [board editor](/editor/xiangqi), choose whether you are playing to mate or to hold the draw and which side you take, and press Play it out.',
    '任何局面都可以这样练习。在[棋盘编辑器](/editor/xiangqi)里摆好局面，选择是要将死对方还是守和、执哪一方，然后点“和电脑下”。',
    '任何局面都可以這樣練習。在[棋盤編輯器](/editor/xiangqi)裡擺好局面，選擇是要將死對方還是守和、執哪一方，然後點「和電腦下」。',
  ),
  ownButton: tri('Open the board editor', '打开棋盘编辑器', '打開棋盤編輯器'),
  tablebaseHeading: tri('Look it up in the tablebase', '查残局库', '查殘局庫'),
  tablebaseText: tri(
    'For the exact result of a position, press Analysis board in the editor and open the Opening explorer under the board. Once few enough pieces are left, it shows the Tablebase: every legal move with its exact result from chessdb.cn, and how many moves to mate.',
    '想知道某个局面的确切结果，在编辑器里点“分析棋盘”，再打开棋盘下方的“开局库”。子力少到一定程度时，那里会显示“残局库”：每一步合法着法的确切结果（来自象棋云库 chessdb.cn），以及几步杀。',
    '想知道某個局面的確切結果，在編輯器裡點「分析棋盤」，再打開棋盤下方的「開局庫」。子力少到一定程度時，那裡會顯示「殘局庫」：每一步合法著法的確切結果（來自象棋雲庫 chessdb.cn），以及幾步殺。',
  ),
  tablebaseReach: tri(
    'How far the tablebase reaches: chessdb.cn lists 8,705 xiangqi endgame tables, about 102 trillion positions in all ([its table list](https://www.chessdb.cn/egtb_info.html), read 2026-10-07). Most have eight or nine pieces. Forty have twelve, and one has thirteen: three soldiers with a full defence against a full defence. Horse and cannon against a horse, both sides with a full defence, is also thirteen pieces and is in no table, which is why it is missing from the table above: the manuals grade it 例胜, and neither the database nor an engine search has confirmed it.',
    '残局库能覆盖多大范围：象棋云库 chessdb.cn 列出8,705张象棋残局表，共约102万亿个局面（[残局表清单](https://www.chessdb.cn/egtb_info.html)，2026-10-07查阅）。大多数是八子或九子残局。十二子的有40张，十三子的只有一张：三兵仕相全对士象全。马炮仕相全对马士象全同样是十三子，却不在任何一张表里，所以上表没有列入：棋谱判它例胜，但残局库和引擎搜索都还没能证实。',
    '殘局庫能涵蓋多大範圍：象棋雲庫 chessdb.cn 列出8,705張象棋殘局表，共約102兆個局面（[殘局表清單](https://www.chessdb.cn/egtb_info.html)，2026-10-07查閱）。大多數是八子或九子殘局。十二子的有40張，十三子的只有一張：三兵仕相全對士象全。馬砲仕相全對馬士象全同樣是十三子，卻不在任何一張表裡，所以上表沒有列入：棋譜判它例勝，但殘局庫和引擎搜尋都還沒能證實。',
  ),
} satisfies Record<string, EndgameText>;

// ── The six grades ──

/**
 * The manuals' scale, strongest win to firmest draw (the wording follows the
 * brianhliou.com post's table, 2026-08-14). The page's results use 例胜, 巧胜,
 * 难胜 and 例和.
 */
export const ENDGAME_GRADE_GLOSSARY: readonly { grade: EndgameText; claim: EndgameText }[] = [
  {
    grade: tri('必胜 (bì shèng)', '必胜', '必勝'),
    claim: tri('Wins from any position with this material', '此种子力从任何局面都能取胜', '這組子力從任何局面都能取勝'),
  },
  {
    grade: tri('例胜 (lì shèng)', '例胜', '例勝'),
    claim: tri('Wins with standard technique', '按标准技术取胜', '以標準技術取勝'),
  },
  {
    grade: tri('巧胜 (qiǎo shèng)', '巧胜', '巧勝'),
    claim: tri(
      'Normally a draw; wins only from particular positions',
      '通常是和棋，只在特定局面下才能取胜',
      '通常是和棋，只能從特定局面取勝',
    ),
  },
  {
    grade: tri('难胜 (nán shèng)', '难胜', '難勝'),
    claim: tri(
      'Hard to win, which is not the same as a draw',
      '难以取胜，这与和棋并不相同',
      '難以取勝，與和棋並不相同',
    ),
  },
  {
    grade: tri('例和 (lì hé)', '例和', '例和'),
    claim: tri('Draws with standard defensive technique', '按标准技术守和', '以標準技術和棋'),
  },
  {
    grade: tri('必和 (bì hé)', '必和', '必和'),
    claim: tri('Draws from any position', '从任何局面都能守和', '從任何局面都能和棋'),
  },
];

// ── The table ──

export type EndgameTableGroup = 'soldier' | 'horse' | 'cannon' | 'chariot' | 'mixed';
export type EndgameTableResult = 'win' | 'draw' | 'tricky-win' | 'hard-win';

export const ENDGAME_TABLE_GROUPS: readonly EndgameTableGroup[] = [
  'soldier',
  'horse',
  'cannon',
  'chariot',
  'mixed',
];

export const ENDGAME_TABLE_GROUP_HEADING: Record<EndgameTableGroup, EndgameText> = {
  soldier: ENDGAME_PAGE_TEXT.groupSoldier,
  horse: ENDGAME_PAGE_TEXT.groupHorse,
  cannon: ENDGAME_PAGE_TEXT.groupCannon,
  chariot: ENDGAME_PAGE_TEXT.groupChariot,
  mixed: ENDGAME_PAGE_TEXT.groupMixed,
};

export type EndgameTableRow = {
  /** Corpus id of the position the row links to. */
  id: string;
  group: EndgameTableGroup;
  /** The matchup, attacker first. */
  material: EndgameText;
  /** Set where the hub's teaching line does not fit a table cell, or the row is not a hub row. */
  idea?: EndgameText;
  /**
   * 难胜: the class grade, which is not this position's result. The board shows
   * the holding setup (a database draw) and the idea names what breaks it.
   */
  grade?: 'hard-win';
};

/**
 * Seven shelf positions the table shows beyond the 26 hub rows, with their
 * chessdb.cn `queryall` results for the exact position (Red to move), read
 * 2026-10-07. `distance` is plies to mate for a win.
 */
export type EndgameExtraCheck = {
  id: string;
  source: 'chessdb';
  result: 'win' | 'draw';
  distance: number | null;
  checkedAt: string;
  /** The corpus position one step away that the row's idea cites, with its own check. */
  contrast?: { id: string; result: 'win'; distance: number };
};

export const ENDGAME_TABLE_EXTRA_CHECKS: readonly EndgameExtraCheck[] = [
  { id: 'two-soldiers-vs-two-advisors', source: 'chessdb', result: 'win', distance: 23, checkedAt: '2026-10-07' },
  { id: 'two-soldiers-vs-two-elephants', source: 'chessdb', result: 'win', distance: 13, checkedAt: '2026-10-07' },
  {
    id: 'two-soldiers-vs-advisor-and-elephant',
    source: 'chessdb',
    result: 'draw',
    distance: null,
    checkedAt: '2026-10-07',
  },
  {
    id: 'three-soldiers-vs-horse-and-two-advisors',
    source: 'chessdb',
    result: 'win',
    distance: 13,
    checkedAt: '2026-10-07',
  },
  {
    id: 'three-soldiers-vs-cannon-and-two-elephants',
    source: 'chessdb',
    result: 'win',
    distance: 23,
    checkedAt: '2026-10-07',
  },
  {
    id: 'cannon-and-full-defence-vs-full-defence',
    source: 'chessdb',
    result: 'draw',
    distance: null,
    checkedAt: '2026-10-07',
  },
  {
    id: 'two-chariots-vs-chariot-full-defence',
    source: 'chessdb',
    result: 'draw',
    distance: null,
    checkedAt: '2026-10-07',
  },
  {
    id: 'chariot-vs-two-minor-pieces',
    source: 'chessdb',
    result: 'draw',
    distance: null,
    checkedAt: '2026-10-07',
    // The cannon one point sideways, on e10: mate in 12 (23 plies).
    contrast: { id: 'chariot-vs-two-minor-pieces-cannon-off', result: 'win', distance: 23 },
  },
  {
    id: 'chariot-cannon-vs-chariot',
    source: 'chessdb',
    result: 'draw',
    distance: null,
    checkedAt: '2026-10-07',
    // The defending chariot one rank higher, on e6: mate in 17 (34 plies).
    contrast: { id: 'chariot-cannon-vs-chariot-too-high', result: 'win', distance: 34 },
  },
];

export const ENDGAME_TABLE: readonly EndgameTableRow[] = [
  // ── 兵 ──
  {
    id: 'high-soldier-vs-bare-general',
    group: 'soldier',
    material: tri('High soldier vs bare general', '高兵对单将', '高兵對單將'),
  },
  {
    id: 'bottom-soldier-vs-bare-general',
    group: 'soldier',
    material: tri('Bottom soldier vs bare general', '底兵对单将', '底兵對單將'),
  },
  {
    id: 'high-soldier-vs-advisor',
    group: 'soldier',
    material: tri('High soldier vs one advisor', '高兵对单士', '高兵對單士'),
  },
  {
    id: 'high-soldier-vs-advisor-tricky',
    group: 'soldier',
    material: tri(
      'High soldier vs one advisor, soldier in the palace',
      '高兵对单士（兵已入九宫）',
      '高兵對單士（兵已入九宮）',
    ),
  },
  {
    id: 'high-low-soldiers-vs-two-advisors',
    group: 'soldier',
    material: tri('High and low soldier vs two advisors', '高低兵对双士', '高低兵對雙士'),
  },
  {
    id: 'two-soldiers-vs-two-advisors',
    group: 'soldier',
    material: tri('Two high soldiers vs two advisors', '双高兵对双士', '雙高兵對雙士'),
    idea: tri('Two advisors alone cannot hold two high soldiers.', '双士挡不住两个高兵。', '雙士擋不住兩個高兵。'),
  },
  {
    id: 'two-soldiers-vs-two-elephants',
    group: 'soldier',
    material: tri('Two high soldiers vs two elephants', '双高兵对双象', '雙高兵對雙象'),
    idea: tri(
      'Two elephants alone cannot hold two high soldiers either.',
      '双象同样挡不住两个高兵。',
      '雙象同樣擋不住兩個高兵。',
    ),
  },
  {
    id: 'two-soldiers-vs-advisor-and-elephant',
    group: 'soldier',
    material: tri('Two high soldiers vs advisor and elephant', '双高兵对单士象', '雙高兵對單士象'),
    idea: tri(
      'The mixed pair holds where two advisors or two elephants lose: the advisor covers the palace, the elephant the approach.',
      '双士或双象守不住，士象各一却能守和：士守九宫，象守外围。',
      '雙士或雙象守不住，士象各一卻能守和：士守九宮，象守外圍。',
    ),
  },
  {
    id: 'two-high-soldiers-vs-cannon',
    group: 'soldier',
    material: tri('Two high soldiers vs cannon', '双高兵对单炮', '雙高兵對單砲'),
  },
  {
    id: 'three-soldiers-vs-horse-and-two-advisors',
    group: 'soldier',
    material: tri('Three high soldiers vs horse and two advisors', '三高兵对马双士', '三高兵對馬雙士'),
    idea: tri(
      'Three high soldiers also beat a horse with two advisors.',
      '三个高兵也能胜马双士。',
      '三個高兵也能勝馬雙士。',
    ),
  },
  {
    id: 'three-soldiers-vs-cannon-and-two-elephants',
    group: 'soldier',
    material: tri('Three high soldiers vs cannon and two elephants', '三高兵对炮双象', '三高兵對砲雙象'),
    idea: tri(
      'Three high soldiers also beat a cannon with two elephants.',
      '三个高兵也能胜炮双象。',
      '三個高兵也能勝砲雙象。',
    ),
  },
  {
    id: 'three-soldiers-vs-full-defence',
    group: 'soldier',
    material: tri('Three high soldiers vs full defence', '三高兵对士象全', '三高兵對士象全'),
  },
  // ── 马 ──
  {
    id: 'horse-vs-advisor',
    group: 'horse',
    material: tri('Horse vs one advisor', '单马对单士', '單馬對單士'),
    idea: tri(
      'Against one elephant instead, the same horse only draws.',
      '换成单象，同样的单马只能和。',
      '換成單象，同樣的單馬只能和。',
    ),
  },
  {
    id: 'horse-vs-elephant',
    group: 'horse',
    material: tri('Horse vs one elephant', '单马对单象', '單馬對單象'),
  },
  {
    id: 'horse-vs-elephant-zugzwang',
    group: 'horse',
    material: tri(
      'Horse vs one elephant, elephant caught on one flank',
      '单马对单象（象困一侧）',
      '單馬對單象（象困一側）',
    ),
  },
  {
    id: 'horse-vs-crossed-soldier',
    group: 'horse',
    material: tri('Horse vs crossed soldier', '单马对过河卒', '單馬對過河卒'),
  },
  {
    id: 'two-horses-vs-full-defence',
    group: 'horse',
    material: tri('Two horses vs full defence', '双马对士象全', '雙馬對士象全'),
  },
  // ── 炮 ──
  {
    id: 'cannon-vs-bare-general',
    group: 'cannon',
    material: tri('Cannon vs bare general', '单炮对单将', '單砲對單將'),
  },
  {
    id: 'cannon-and-advisor-vs-two-advisors',
    group: 'cannon',
    material: tri('Cannon and advisor vs two advisors', '炮仕对双士', '砲仕對雙士'),
  },
  {
    id: 'two-cannons-vs-two-elephants',
    group: 'cannon',
    material: tri('Two cannons vs two elephants', '双炮对双象', '雙砲對雙象'),
  },
  {
    id: 'two-cannons-advisor-vs-full-defence',
    group: 'cannon',
    material: tri('Two cannons and advisor vs full defence', '双炮仕对士象全', '雙砲仕對士象全'),
  },
  {
    id: 'cannon-and-full-defence-vs-full-defence',
    group: 'cannon',
    material: tri('Cannon and full defence vs full defence', '炮仕相全对士象全', '砲仕相全對士象全'),
    idea: tri(
      'A cannon backed by its own full defence still cannot break the full defence.',
      '炮有仕相全保护，仍攻不破对方的士象全。',
      '砲有仕相全保護，仍攻不破對方的士象全。',
    ),
  },
  // ── 车 ──
  {
    id: 'chariot-vs-three-defence',
    group: 'chariot',
    material: tri('Chariot vs defence missing one elephant', '单车对单缺象', '單車對單缺象'),
  },
  {
    id: 'chariot-vs-full-defence',
    group: 'chariot',
    material: tri('Chariot vs full defence', '单车对士象全', '單車對士象全'),
  },
  {
    id: 'chariot-vs-full-defence-tricky',
    group: 'chariot',
    material: tri(
      'Chariot vs full defence, elephants on the edge',
      '单车对士象全（双象在边）',
      '單車對士象全（雙象在邊）',
    ),
  },
  {
    id: 'chariot-vs-horse-two-advisors',
    group: 'chariot',
    material: tri('Chariot vs horse and two advisors', '单车对马双士', '單車對馬雙士'),
    idea: tri(
      'With two elephants in place of the advisors, the horse can build a drawing fortress.',
      '若把双士换成双象，马双象可以摆出守和的阵形。',
      '若把雙士換成雙象，馬雙象可以擺出守和的陣形。',
    ),
  },
  {
    id: 'chariot-vs-horse-two-elephants-fortress',
    group: 'chariot',
    material: tri('Chariot vs horse and two elephants', '单车对马双象', '單車對馬雙象'),
  },
  {
    id: 'chariot-vs-cannon-two-advisors',
    group: 'chariot',
    material: tri('Chariot vs cannon and two advisors', '单车对炮双士', '單車對砲雙士'),
  },
  {
    id: 'chariot-vs-cannon-two-advisors-tricky',
    group: 'chariot',
    material: tri(
      'Chariot vs cannon and two advisors, advisors at home',
      '单车对炮双士（双士在原位）',
      '單車對砲雙士（雙士在原位）',
    ),
  },
  {
    id: 'two-chariots-vs-chariot-full-defence',
    group: 'chariot',
    material: tri('Two chariots vs chariot and full defence', '双车对车士象全', '雙車對車士象全'),
    idea: tri(
      'A chariot behind the full defence holds off two chariots.',
      '有士象全保护的单车可以守和双车。',
      '有士象全保護的單車可以守和雙車。',
    ),
  },
  {
    id: 'chariot-vs-two-minor-pieces',
    group: 'chariot',
    material: tri('Chariot vs horse and cannon', '单车对马炮', '單車對馬砲'),
    grade: 'hard-win',
    idea: tri(
      'Black holds with the cannon directly behind its own general and the horse off every point one chariot move attacks. Move the cannon one point sideways and Red mates in 12.',
      '黑方的守法：炮摆在自己将的正后方，马避开红车一步能捉到的位置。把炮平开一路，红方十二步杀。',
      '黑方的守法：砲擺在自己將的正後方，馬避開紅車一步能捉到的位置。把砲平開一路，紅方十二步殺。',
    ),
  },
  // ── 马兵、车炮 ──
  {
    id: 'horse-and-soldier-vs-three-defence',
    group: 'mixed',
    material: tri('Horse and soldier vs defence missing one elephant', '马兵对单缺象', '馬兵對單缺象'),
  },
  {
    id: 'horse-and-soldier-vs-full-defence',
    group: 'mixed',
    material: tri('Horse and soldier vs full defence', '马兵对士象全', '馬兵對士象全'),
  },
  {
    id: 'chariot-cannon-vs-chariot-center',
    group: 'mixed',
    material: tri(
      'Chariot and cannon vs chariot, Red chariot on the middle file',
      '车炮对单车（红车占中路）',
      '車砲對單車（紅車占中路）',
    ),
  },
  {
    id: 'chariot-cannon-vs-chariot',
    group: 'mixed',
    material: tri(
      'Chariot and cannon vs chariot, Black chariot on the middle file',
      '车炮对单车（黑车占中路）',
      '車砲對單車（黑車占中路）',
    ),
    idea: tri(
      'The black chariot holds the middle file level with the red chariot and cannon, low enough to guard the foot of the file, where the mate 海底捞月 is played. One rank higher and Red mates in 17.',
      '黑车占住中路，与红方车炮同在一条横线上，守住中路底端，海底捞月就做不成。黑车高一路，红方十七步杀。',
      '黑車占住中路，與紅方車砲同在一條橫線上，守住中路底端，海底撈月就做不成。黑車高一路，紅方十七步殺。',
    ),
  },
];

/** The glossary as table rows, in English (the dictionaries carry zh). */
export function endgameGradeGlossaryRows(): string[][] {
  return ENDGAME_GRADE_GLOSSARY.map((entry) => [entry.grade.en, entry.claim.en]);
}

/** The 26 graded rows by id. */
const HUB_ROWS = new Map(XIANGQI_ENDGAME_HUB.map((row) => [row.id, row]));

/** What the table says for a row: the hub grade, a 难胜 row's grade, or the extra row's check. */
export function endgameTableResult(id: string): EndgameTableResult {
  if (ENDGAME_TABLE.find((row) => row.id === id)?.grade === 'hard-win') return 'hard-win';
  const hub = HUB_ROWS.get(id);
  if (hub) {
    if (hub.grade === 'standard-draw') return 'draw';
    return hub.grade === 'tricky-win' ? 'tricky-win' : 'win';
  }
  const extra = ENDGAME_TABLE_EXTRA_CHECKS.find((check) => check.id === id);
  if (!extra) throw new Error(`xiangqi endgames table: ${id} has neither a hub grade nor a check`);
  return extra.result;
}

/** The result of the position on the row's board (a 巧胜 position wins, a 难胜 board holds). */
export function endgamePositionResult(id: string): 'win' | 'draw' {
  const result = endgameTableResult(id);
  if (result === 'hard-win') return 'draw';
  return result === 'draw' ? 'draw' : 'win';
}

const RESULT_TEXT: Record<EndgameTableResult, EndgameText> = {
  win: ENDGAME_PAGE_TEXT.resultWin,
  draw: ENDGAME_PAGE_TEXT.resultDraw,
  'tricky-win': ENDGAME_PAGE_TEXT.resultTrickyWin,
  'hard-win': ENDGAME_PAGE_TEXT.resultHardWin,
};

export function endgameTableIdea(row: EndgameTableRow): EndgameText {
  return row.idea ?? endgameRowText(row.id).line;
}

// ── Links ──

/** The prod study id of each practice set (GET /api/studies, read 2026-10-07). */
export const ENDGAME_SET_STUDY_IDS: Record<EndgamePracticeSetSlug, string> = {
  'endgames-soldier': 'DstCTARw',
  'endgames-chariot': 'hc6LmrOG',
  'endgames-horse': 'PNqQaTM6',
  'endgames-cannon': 'rj3D8rMs',
  'endgames-insufficient': 'feCqSlEw',
};

/**
 * Positions that are already a chapter on prod, with that chapter's root FEN as
 * read 2026-10-07. The seeder matches chapters by name and keeps their ids, so
 * these deep links survive the reseed; the test holds each FEN to the corpus
 * position. Table rows not listed are chapters the next seed adds, and link to
 * their set.
 */
export const ENDGAME_PROD_CHAPTERS: Record<
  string,
  { study: string; chapter: string; rootFen: string }
> = {
  'three-soldiers-vs-full-defence': {
    study: 'DstCTARw',
    chapter: 'aRL5w6iC',
    rootFen: '2b1ka3/4a4/4b4/2P1P1P2/9/9/9/9/9/4K4 r - - 0 1',
  },
  'two-soldiers-vs-two-advisors': {
    study: 'DstCTARw',
    chapter: 'hjxe7Knl',
    rootFen: '3aka3/9/9/9/3P1P3/9/9/9/9/3K5 r - - 0 1',
  },
  'two-soldiers-vs-two-elephants': {
    study: 'DstCTARw',
    chapter: 'NraxgqiY',
    rootFen: '2b1k1b2/9/9/9/3P1P3/9/9/9/9/3K5 r - - 0 1',
  },
  'two-soldiers-vs-advisor-and-elephant': {
    study: 'DstCTARw',
    chapter: 'CHi4AJpE',
    rootFen: '2b1k4/4a4/9/9/3P1P3/9/9/9/9/4K4 r - - 0 1',
  },
  'three-soldiers-vs-horse-and-two-advisors': {
    study: 'DstCTARw',
    chapter: 'fjcDdHLP',
    rootFen: '3aka3/9/4n4/2P1P1P2/9/9/9/9/9/4K4 r - - 0 1',
  },
  'three-soldiers-vs-cannon-and-two-elephants': {
    study: 'DstCTARw',
    chapter: 'bEx7oNV5',
    rootFen: '2b1k1b2/9/9/2P1P1P2/9/4c4/9/9/9/4K4 r - - 0 1',
  },
  'horse-vs-advisor': {
    study: 'PNqQaTM6',
    chapter: 'uJQcVSvn',
    rootFen: '3ak4/9/9/9/9/4N4/9/9/9/4K4 r - - 0 1',
  },
  'horse-vs-elephant': {
    study: 'PNqQaTM6',
    chapter: 'M5LYB24C',
    rootFen: '2b1k4/9/9/9/9/4N4/9/9/9/4K4 r - - 0 1',
  },
  'horse-vs-elephant-zugzwang': {
    study: 'PNqQaTM6',
    chapter: 'jeCJgZEG',
    rootFen: '3k5/9/5N3/9/2b6/9/9/9/4K4/9 r - - 0 1',
  },
  'horse-and-soldier-vs-three-defence': {
    study: 'PNqQaTM6',
    chapter: 'mmiG3IsB',
    rootFen: '4ka3/4a4/4b4/9/4P4/4N4/9/9/9/4K4 r - - 0 1',
  },
  'horse-and-soldier-vs-full-defence': {
    study: 'PNqQaTM6',
    chapter: 'HUojqblI',
    rootFen: '2b1ka3/4a4/4b4/9/4P4/4N4/9/9/9/4K4 r - - 0 1',
  },
  'two-horses-vs-full-defence': {
    study: 'PNqQaTM6',
    chapter: 'E8vYqhoQ',
    rootFen: '2b1ka3/4a4/4b4/9/9/3N1N3/9/9/9/4K4 r - - 0 1',
  },
  'cannon-and-advisor-vs-two-advisors': {
    study: 'rj3D8rMs',
    chapter: '8AI7kOXl',
    rootFen: '3k5/4a4/3a5/9/9/9/9/3A1K3/9/3C5 r - - 0 1',
  },
  'cannon-and-full-defence-vs-full-defence': {
    study: 'rj3D8rMs',
    chapter: 'hDZE0K9k',
    rootFen: '2b1ka3/4a4/4b4/9/9/4C4/9/4B4/4A4/2BAK4 r - - 0 1',
  },
  'cannon-vs-bare-general': {
    study: 'feCqSlEw',
    chapter: '3VUGq3dJ',
    rootFen: '4k4/9/9/9/9/4C4/9/9/9/4K4 r - - 0 1',
  },
  'chariot-vs-full-defence': {
    study: 'hc6LmrOG',
    chapter: 'MyIZ3XSd',
    rootFen: '2b1ka3/4a4/4b4/9/9/4R4/9/9/9/4K4 r - - 0 1',
  },
  'chariot-vs-three-defence': {
    study: 'hc6LmrOG',
    chapter: 'aAF1ooTw',
    rootFen: '4ka3/4a4/4b4/9/9/4R4/9/9/9/4K4 r - - 0 1',
  },
  'chariot-vs-horse-two-elephants-fortress': {
    study: 'hc6LmrOG',
    chapter: 'zsSsZLbq',
    rootFen: '4k4/9/4n3b/4R4/6b2/9/9/9/4K4/9 r - - 0 1',
  },
  'chariot-vs-horse-two-elephants-broken': {
    study: 'hc6LmrOG',
    chapter: 'N0sRR1n9',
    rootFen: '4k1b2/9/4n3b/4R4/9/9/9/9/4K4/9 r - - 0 1',
  },
  'two-chariots-vs-chariot-full-defence': {
    study: 'hc6LmrOG',
    chapter: 'HJWlVc5G',
    rootFen: '2b1ka3/4a4/r3b4/9/9/3R1R3/9/9/9/4K4 r - - 0 1',
  },
  'chariot-vs-two-minor-pieces': {
    study: 'hc6LmrOG',
    chapter: 'hIZwpqop',
    rootFen: '5c3/5k3/9/3n5/9/R8/9/9/9/4K4 r - - 0 1',
  },
  'chariot-cannon-vs-chariot': {
    study: 'hc6LmrOG',
    chapter: 'GoeeVBgU',
    rootFen: '5k3/9/9/9/9/R1C1r4/9/9/9/3K5 r - - 0 1',
  },
};

/** The practice set a corpus position sits in. */
export function endgamePracticeSetOf(id: string): EndgamePracticeSetSlug {
  for (const [slug, ids] of Object.entries(XIANGQI_ENDGAME_PRACTICE_SET_IDS)) {
    if (ids.includes(id)) return slug as EndgamePracticeSetSlug;
  }
  throw new Error(`xiangqi endgames: ${id} is in no practice set`);
}

/** Where a position links: its prod chapter, else its practice set. */
export function endgameStudyHref(id: string): string {
  const chapter = ENDGAME_PROD_CHAPTERS[id];
  if (chapter) return `/study/${chapter.study}/${chapter.chapter}`;
  return `/study/${ENDGAME_SET_STUDY_IDS[endgamePracticeSetOf(id)]}`;
}

function materialCell(row: EndgameTableRow, lang: keyof EndgameText): string {
  return `[${row.material[lang]}](${endgameStudyHref(row.id)})`;
}

/** One group's table rows in English (the dictionaries carry zh): linked material, result, key idea. */
export function endgameTableRows(group: EndgameTableGroup): string[][] {
  return endgameTableGroupRows(group).map((row) => [
    materialCell(row, 'en'),
    RESULT_TEXT[endgameTableResult(row.id)].en,
    endgameTableIdea(row).en,
  ]);
}

/** A row's board diagram's accessible name: the material and its result. */
export function endgameDiagramLabel(row: EndgameTableRow): EndgameText {
  const result = RESULT_TEXT[endgameTableResult(row.id)];
  return tri(
    `${row.material.en}: ${result.en}`,
    `${row.material['zh-Hans']}：${result['zh-Hans']}`,
    `${row.material['zh-Hant']}：${result['zh-Hant']}`,
  );
}

/** One group's rows, in table order (the diagrams pair with endgameTableRows by index). */
export function endgameTableGroupRows(group: EndgameTableGroup): EndgameTableRow[] {
  return ENDGAME_TABLE.filter((row) => row.group === group);
}

/** Every string the page shows, as triples. */
export function endgamePageTexts(): EndgameText[] {
  const glossary = ENDGAME_GRADE_GLOSSARY.flatMap((entry) => [entry.grade, entry.claim]);
  const cells = ENDGAME_TABLE.flatMap((row) => [
    tri(materialCell(row, 'en'), materialCell(row, 'zh-Hans'), materialCell(row, 'zh-Hant')),
    endgameTableIdea(row),
    endgameDiagramLabel(row),
  ]);
  return [...Object.values(ENDGAME_PAGE_TEXT), ...glossary, ...cells];
}

export function endgamePageDictionary(lang: 'zh-Hans' | 'zh-Hant'): Record<string, string> {
  return Object.fromEntries(endgamePageTexts().map((text) => [text.en, text[lang]]));
}
