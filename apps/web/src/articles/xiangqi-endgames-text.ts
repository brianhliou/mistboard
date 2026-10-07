// Every word on the 象棋残局 page, in all three scripts, in one place, and the
// links its table cells carry.
//
// The page is a reference: a win-or-draw table of 33 common endings by
// attacking piece, one exercise drawn from the kernel with a link to play it,
// the fortress pair, and how to set up and look up any other ending. The 26
// graded rows and their teaching lines live in packages/game
// (xiangqi-endgame-hub.ts, xiangqi-endgame-practice.ts); the seven extra rows
// below are shelf positions the article also shows, with their own chessdb
// checks recorded here. The English strings ARE the article; the zh
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
    'Xiangqi Endgames: Which Material Wins and Which Draws',
    '象棋残局：哪些子力能赢，哪些只能和',
    '象棋殘局：哪些子力能贏，哪些只能和',
  ),
  seoTitle: tri(
    'Xiangqi Endgames: Win or Draw Table for 33 Common Endings',
    '象棋残局胜和表：33种常见残局，附电脑练习',
    '象棋殘局勝和表：33種常見殘局，附電腦練習',
  ),
  cardTitle: tri('Xiangqi Endgames', '象棋残局', '象棋殘局'),
  summary: tri(
    'Which xiangqi endgames win and which draw: a table of 33 common endings with the result and the key idea for each, every result checked against the chessdb.cn tablebase, and every position ready to practice against the computer.',
    '哪些象棋残局能赢，哪些只能和：33种常见残局的胜和表，每一种都附结果和要点，结果全部经象棋云库 chessdb.cn 核对，每个局面都可以直接和电脑练习。',
    '哪些象棋殘局能贏，哪些只能和：33種常見殘局的勝和表，每一種都附結果和要點，結果全部經象棋雲庫 chessdb.cn 核對，每個局面都可以直接和電腦練習。',
  ),
  introDecides: tri(
    'Two counts decide most xiangqi endgames before a move is played: what the attacker has left, and how much of the defence is still standing. Advisors and elephants never cross the river, but around their own general they are worth more than their size. A lone chariot, the strongest piece on the board, beats a general missing one elephant and only draws against the full defence of two advisors and two elephants (士象全). Three high soldiers or two horses break that same defence.',
    '大多数象棋残局，在走第一步之前就由两件事决定了：进攻方还剩什么子力，防守方的士象还剩多少。士象不能过河，但守在自己的将旁边，作用远大于本身的价值。盘上最强的单车能胜单缺象，却只能和士象全；而三个高兵或双马却能攻破士象全。',
    '大多數象棋殘局，在走第一步之前就由兩件事決定了：進攻方還剩什麼子力，防守方的士象還剩多少。士象不能過河，但守在自己的將旁邊，作用遠大於本身的價值。盤上最強的單車能勝單缺象，卻只能和士象全；而三個高兵或雙馬卻能攻破士象全。',
  ),
  introPractice: tri(
    'All 33 positions in the table below are on the Practice page against the computer, in the set for their piece. In the wins you play Red and give mate; in the draws you play Black and hold for 15 moves.',
    '下表全部33个局面都在练习页，按子力分在各自的练习集里，和电脑对下。胜局你执红将死对方；和局你执黑守住15回合。',
    '下表全部33個局面都在練習頁，按子力分在各自的練習集裡，和電腦對下。勝局你執紅將死對方；和局你執黑守住15回合。',
  ),
  practiceButton: tri('Practice these endgames', '练习这些残局', '練習這些殘局'),
  tableHeading: tri(
    'Which endgames win and which draw',
    '哪些残局能赢，哪些是和棋',
    '哪些殘局能贏，哪些是和棋',
  ),
  tableIntro: tri(
    '**Win** means the attacker forces mate with correct play, whatever the defender does. **Draw** means the defender holds from the right setup. **Tricky win** (巧胜) marks material that is normally a draw, in a position where the attacker can still force mate. The **full defence** (士象全) is two advisors and two elephants. Soldiers are named by how far they have come: a **bottom soldier** (底兵) stands on the last rank, a **low soldier** (低兵) one rank short of it, and a **high soldier** (高兵) further back, where it can still come down on the palace. Each name in the table opens that position in the practice sets.',
    '**胜**：只要技术正确，不论对方怎样防守，进攻方都能将死对方。**和**：防守方摆好阵形即可守和。**巧胜**：这类子力通常是和棋，但在该局面下进攻方仍能强行将死。**士象全**指双士双象。兵按走到的位置区分：**底兵**已到底线，**低兵**差一线到底，**高兵**还在更后面，仍能下压九宫。点表中的名称，即可在练习集里打开该局面。',
    '**勝**：只要技術正確，不論對方怎樣防守，進攻方都能將死對方。**和**：防守方擺好陣形即可守和。**巧勝**：這類子力通常是和棋，但在該局面下進攻方仍能強行將死。**士象全**指雙士雙象。兵按走到的位置區分：**底兵**已到底線，**低兵**差一線到底，**高兵**還在更後面，仍能下壓九宮。點表中的名稱，即可在練習集裡打開該局面。',
  ),
  headerMaterial: tri('Material', '子力', '子力'),
  headerResult: tri('Result', '结果', '結果'),
  headerIdea: tri('Key idea', '要点', '要點'),
  resultWin: tri('Win', '胜', '勝'),
  resultDraw: tri('Draw', '和', '和'),
  resultTrickyWin: tri('Tricky win', '巧胜', '巧勝'),
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
    'A horse against a lone elephant is a draw as a rule: the elephant switches flanks faster than the horse can cut it off. In this position the elephant is stuck on one side and Red moves first, and that is enough. The tablebase gives Red mate in five moves. The first move decides it: find the square that keeps the elephant from getting back across.',
    '单马对单象通常是和棋：象换翼的速度比马切断它的速度更快。这个局面里象被困在一侧，又轮到红方先走，这就够了。残局库给出红方五步杀。关键在第一步：找到那个让象回不到另一侧的位置。',
    '單馬對單象通常是和棋：象換翼的速度比馬切斷它的速度更快。這個局面裡象被困在一側，又輪到紅方先走，這就夠了。殘局庫給出紅方五步殺。關鍵在第一步：找到那個讓象回不到另一側的位置。',
  ),
  exerciseCaption: tri('Red to move and mate in five.', '红先，五步杀。', '紅先，五步殺。'),
  exerciseButton: tri('Play it out', '和电脑下', '和電腦下'),
  fortressHeading: tri(
    'One square can turn a draw into a win',
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
    'In the first diagram the horse stands on the elephant point in front of the general and the two elephants protect each other, and the chariot cannot get through. In the second, the elephant from g6 stands on g10, and the chariot wins. It works the other way too: pull the three high soldiers back one rank and their win over the full defence is gone.',
    '第一幅图中，马守在将前的象位上，双象互相保护，单车攻不进去。第二幅图只是把g6的象换到g10，单车就能取胜。反过来也一样：把三个高兵各退一路，它们对士象全的胜势就没了。',
    '第一幅圖中，馬守在將前的象位上，雙象互相保護，單車攻不進去。第二幅圖只是把g6的象換到g10，單車就能取勝。反過來也一樣：把三個高兵各退一路，它們對士象全的勝勢就沒了。',
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
} satisfies Record<string, EndgameText>;

// ── The table ──

export type EndgameTableGroup = 'soldier' | 'horse' | 'cannon' | 'chariot' | 'mixed';
export type EndgameTableResult = 'win' | 'draw' | 'tricky-win';

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
];

/** The 26 graded rows by id. */
const HUB_ROWS = new Map(XIANGQI_ENDGAME_HUB.map((row) => [row.id, row]));

/** What the table says for a row: the hub grade, or the extra row's check. */
export function endgameTableResult(id: string): EndgameTableResult {
  const hub = HUB_ROWS.get(id);
  if (hub) {
    if (hub.grade === 'standard-draw') return 'draw';
    return hub.grade === 'tricky-win' ? 'tricky-win' : 'win';
  }
  const extra = ENDGAME_TABLE_EXTRA_CHECKS.find((check) => check.id === id);
  if (!extra) throw new Error(`xiangqi endgames table: ${id} has neither a hub grade nor a check`);
  return extra.result;
}

const RESULT_TEXT: Record<EndgameTableResult, EndgameText> = {
  win: ENDGAME_PAGE_TEXT.resultWin,
  draw: ENDGAME_PAGE_TEXT.resultDraw,
  'tricky-win': ENDGAME_PAGE_TEXT.resultTrickyWin,
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
  const cells = ENDGAME_TABLE.flatMap((row) => [
    tri(materialCell(row, 'en'), materialCell(row, 'zh-Hans'), materialCell(row, 'zh-Hant')),
    endgameTableIdea(row),
    endgameDiagramLabel(row),
  ]);
  return [...Object.values(ENDGAME_PAGE_TEXT), ...cells];
}

export function endgamePageDictionary(lang: 'zh-Hans' | 'zh-Hant'): Record<string, string> {
  return Object.fromEntries(endgamePageTexts().map((text) => [text.en, text[lang]]));
}
