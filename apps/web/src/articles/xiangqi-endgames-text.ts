// Every word on the 象棋残局 page, in all three scripts, in one place.
//
// The page is short on purpose: what decides an endgame, the three grades with
// one diagram each, and one button to /practice. The 26 positions and their
// teaching lines live with the practice sets in packages/game
// (xiangqi-endgame-practice.ts), because the practice studies are where a
// reader meets them. The English strings ARE the article; the zh dictionaries that
// article-i18n.ts spreads in are generated from the same triples below, so the
// three scripts cannot drift apart.
//
// zh is machine translation (2026-10-07), not native-reviewed. Terms follow the
// basic-endgame study (apps/server/src/xiangqi-endgame-study-i18n.ts): 例胜 /
// 巧胜 / 例和, 高兵, 士象全; zh-Hant writes 砲 for the cannon there too.

import type { EndgameText } from '@mistboard/game';

export type { EndgameText };

function tri(en: string, hans: string, hant: string): EndgameText {
  return { en, 'zh-Hans': hans, 'zh-Hant': hant };
}

/** Fixed page strings. */
export const ENDGAME_PAGE_TEXT = {
  title: tri(
    'Xiangqi Endgames: Standard Wins and Draws',
    '象棋残局：实用残局胜和定式',
    '象棋殘局：實用殘局勝和定式',
  ),
  seoTitle: tri(
    'Xiangqi Endgames: 26 Standard Wins and Draws to Practice',
    '象棋残局大全：26个实用残局胜和定式，在线练习',
    '象棋殘局大全：26個實用殘局勝和定式，線上練習',
  ),
  cardTitle: tri('Xiangqi Endgames', '象棋残局', '象棋殘局'),
  summary: tri(
    'Which xiangqi endgames are a win and which are a draw, and why: 26 standard positions, each checked against the chessdb.cn tablebase, to practice against the computer.',
    '哪些象棋残局能赢，哪些只能和，以及原因：26个实用残局局面，每一个都经象棋云库 chessdb.cn 核对，可直接和电脑练习。',
    '哪些象棋殘局能贏，哪些只能和，以及原因：26個實用殘局局面，每一個都經象棋雲庫 chessdb.cn 核對，可直接和電腦練習。',
  ),
  introDecides: tri(
    'Two counts decide most xiangqi endgames before a move is played: what the attacker has left, and how much of the defence is still standing. Advisors and elephants never cross the river, but around their own general they are worth more than their size. A lone chariot, the strongest piece on the board, beats a general missing one elephant and only draws against the full defence of two advisors and two elephants (士象全). Three high soldiers or two horses break that same defence.',
    '大多数象棋残局，在走第一步之前就由两件事决定了：进攻方还剩什么子力，防守方的士象还剩多少。士象不能过河，但守在自己的将旁边，作用远大于本身的价值。盘上最强的单车能胜单缺象，却只能和士象全；而三个高兵或双马却能攻破士象全。',
    '大多數象棋殘局，在走第一步之前就由兩件事決定了：進攻方還剩什麼子力，防守方的士象還剩多少。士象不能過河，但守在自己的將旁邊，作用遠大於本身的價值。盤上最強的單車能勝單缺象，卻只能和士象全；而三個高兵或雙馬卻能攻破士象全。',
  ),
  introPractice: tri(
    'All 26 are on the Practice page against the computer, in the set for their piece. In the wins you play Red and give mate, easiest first; in the draws you play Black and hold for 15 moves.',
    '全部26局都在练习页，按子力分在各自的练习集里，和电脑对下。胜局由易到难，你执红将死对方；和局你执黑守住15回合。',
    '全部26局都在練習頁，按子力分在各自的練習集裡，和電腦對下。勝局由易到難，你執紅將死對方；和局你執黑守住15回合。',
  ),
  practiceButton: tri('Practice these endgames', '练习这些残局', '練習這些殘局'),
  gradesHeading: tri('Three grades', '三个等级', '三個等級'),
  introGrades: tri(
    'Chinese endgame manuals sort the common endings into grades. This page uses three. A **standard win** (例胜) is won with correct technique whatever the defender does. A **tricky win** (巧胜) is material that is normally a draw, in a position where the attacker can still force the win. A **standard draw** (例和) holds when the defender sets up correctly.',
    '象棋残局书把常见残局分成几个等级，本页用其中三个。**例胜**：只要技术正确，不论对方怎样防守都能取胜。**巧胜**：这类子力通常是和棋，但在特定局面下进攻方仍能强行取胜。**例和**：防守方摆好阵形即可守和。',
    '象棋殘局書把常見殘局分成幾個等級，本頁用其中三個。**例勝**：只要技術正確，不論對方怎樣防守都能取勝。**巧勝**：這類子力通常是和棋，但在特定局面下進攻方仍能強行取勝。**例和**：防守方擺好陣形即可守和。',
  ),
  captionStandardWin: tri(
    'Standard win: three high soldiers beat the full defence.',
    '例胜：三高兵胜士象全。',
    '例勝：三高兵勝士象全。',
  ),
  captionTrickyWin: tri(
    'Tricky win: the horse beats a lone elephant caught on one flank, Red to move.',
    '巧胜：象被逼在一侧，红方先走，单马巧胜单象。',
    '巧勝：象被逼在一側，紅方先走，單馬巧勝單象。',
  ),
  captionStandardDraw: tri(
    'Standard draw: horse and two elephants hold off a chariot.',
    '例和：马双象守和单车。',
    '例和：馬雙象守和單車。',
  ),
  oneStep: tri(
    'One step can decide it. Move the elephant on g6 back to g10 and the chariot wins; pull the three soldiers back one rank and the win is gone.',
    '一步之差就能定胜负。把g6的象退到g10，单车就能取胜；三个兵各退一路，胜势就没了。',
    '一步之差就能定勝負。把g6的象退到g10，單車就能取勝；三個兵各退一路，勝勢就沒了。',
  ),
  introSource: tri(
    'The grades follow the Chinese Wikipedia list of standard results (象棋勝和定式), which cites 金启昌 and 杨典, 象棋残局胜和定式 (2008). The horse-and-soldier and two-horse grades follow English Wikipedia. The positions are ours, and every verdict was checked against the exact results of [chessdb.cn](https://www.chessdb.cn/), the Chinese chess cloud database, for that exact position.',
    '等级依据中文维基百科的“象棋勝和定式”条目，该条目引用金启昌、杨典《象棋残局胜和定式》（2008）。马兵和双马两局依据英文维基百科。局面由我们摆出，每一个结论都经[象棋云库 chessdb.cn](https://www.chessdb.cn/)对该局面的确切结果核对。',
    '等級依據中文維基百科的「象棋勝和定式」條目，該條目引用金啟昌、楊典《象棋殘局勝和定式》（2008）。馬兵和雙馬兩局依據英文維基百科。局面由我們擺出，每一個結論都經[象棋雲庫 chessdb.cn](https://www.chessdb.cn/)對該局面的確切結果核對。',
  ),
  ownHeading: tri('Set up your own endgame', '自己摆残局', '自己擺殘局'),
  ownText: tri(
    'Any position can be practised the same way. Set it up in the [board editor](/editor/xiangqi), choose whether you are playing to mate or to hold the draw and which side you take, and press Play it out.',
    '任何局面都可以这样练习。在[棋盘编辑器](/editor/xiangqi)里摆好局面，选择是要将死对方还是守和、执哪一方，然后点“和电脑下”。',
    '任何局面都可以這樣練習。在[棋盤編輯器](/editor/xiangqi)裡擺好局面，選擇是要將死對方還是守和、執哪一方，然後點「和電腦下」。',
  ),
  ownButton: tri('Open the board editor', '打开棋盘编辑器', '打開棋盤編輯器'),
} satisfies Record<string, EndgameText>;

/** Every string the page shows, as triples. */
export function endgamePageTexts(): EndgameText[] {
  return Object.values(ENDGAME_PAGE_TEXT);
}

export function endgamePageDictionary(lang: 'zh-Hans' | 'zh-Hant'): Record<string, string> {
  return Object.fromEntries(endgamePageTexts().map((text) => [text.en, text[lang]]));
}
