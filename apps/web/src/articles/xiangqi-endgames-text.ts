// Every word on the 象棋残局 page, in all three scripts, in one place.
//
// The page is built from packages/game's hub rows (which positions, which
// grade) and this module (what to say about them). The English strings ARE the
// article; the zh dictionaries that article-i18n.ts spreads in are generated
// from the same triples below, so a row's three scripts cannot drift apart and a
// row added to the hub without its text fails here (rowText throws) instead of
// rendering half in English.
//
// The tablebase tail of each paragraph is computed from the committed checks
// file, never typed: "Red mates in 12" is the database's number for that exact
// position. The two rows whose database distance is not the length of the line
// it returns (chessdb answers those from a different table) say only that Red
// wins, rather than print a number we cannot replay.
//
// zh is machine translation (2026-10-07), not native-reviewed. Terms follow the
// basic-endgame study (apps/server/src/xiangqi-endgame-study-i18n.ts): 例胜 /
// 巧胜 / 例和, 高兵, 士象全, 炮架; zh-Hant writes 砲 for the cannon there too.

import {
  type EndgameGrade,
  type EndgameHubGroup,
  XIANGQI_ENDGAME_HUB,
  XIANGQI_ENDGAME_HUB_CHECKS,
} from '@mistboard/game';

export type EndgameText = { en: string; 'zh-Hans': string; 'zh-Hant': string };

type Lang = keyof EndgameText;

function tri(en: string, hans: string, hant: string): EndgameText {
  return { en, 'zh-Hans': hans, 'zh-Hant': hant };
}

export const ENDGAME_GRADE_LABEL: Record<EndgameGrade, EndgameText> = {
  'standard-win': tri('Standard win', '例胜', '例勝'),
  'tricky-win': tri('Tricky win', '巧胜', '巧勝'),
  'standard-draw': tri('Standard draw', '例和', '例和'),
};

export const ENDGAME_GROUP_HEADING: Record<EndgameHubGroup, EndgameText> = {
  soldier: tri('Soldier endgames', '兵类残局', '兵類殘局'),
  horse: tri('Horse endgames', '马类残局', '馬類殘局'),
  cannon: tri('Cannon endgames', '炮类残局', '砲類殘局'),
  chariot: tri('Chariot endgames', '车类残局', '車類殘局'),
};

/** Per hub row: the manual-style name (the sub-heading) and the teaching line. */
const ROW_TEXT: Record<string, { name: EndgameText; line: EndgameText }> = {
  'high-soldier-vs-bare-general': {
    name: tri('High soldier beats a bare general', '高兵胜单将', '高兵勝單將'),
    line: tri(
      'A soldier short of the last rank beats a bare general. The red general does half the work by holding a file the black general cannot cross.',
      '兵只要未到底线即可胜光将，红帅控制一路，黑将不能越过，这是取胜的一半。',
      '兵只要未到底線即可勝光將，紅帥控制一路，黑將不能越過，這是取勝的一半。',
    ),
  },
  'bottom-soldier-vs-bare-general': {
    name: tri('Bottom soldier draws a bare general', '底兵和单将', '底兵和單將'),
    line: tri(
      'On the last rank a soldier can only move sideways, and on its own it cannot force mate.',
      '兵到了底线只能横走，单凭它无法将死对方。',
      '兵到了底線只能橫走，單憑它無法將死對方。',
    ),
  },
  'high-soldier-vs-advisor': {
    name: tri('High soldier draws one advisor', '高兵和单士', '高兵和單士'),
    line: tri(
      'One advisor is enough to hold a single high soldier. The next row is the exception.',
      '一个士足以守和单个高兵。下一局就是例外。',
      '一個士足以守和單個高兵。下一局就是例外。',
    ),
  },
  'high-soldier-vs-advisor-tricky': {
    name: tri('High soldier tricky win against one advisor', '高兵巧胜单士', '高兵巧勝單士'),
    line: tri(
      'The same material wins when the soldier already stands in the palace and Red is to move.',
      '同样的子力，兵已进九宫且红方先走时可以取胜。',
      '同樣的子力，兵已進九宮且紅方先走時可以取勝。',
    ),
  },
  'high-low-soldiers-vs-two-advisors': {
    name: tri('High and low soldier beat two advisors', '高低兵胜双士', '高低兵勝雙士'),
    line: tri(
      'A high and a low soldier together beat two advisors.',
      '高低兵配合可胜双士。',
      '高低兵配合可勝雙士。',
    ),
  },
  'two-high-soldiers-vs-cannon': {
    name: tri('Two high soldiers beat a cannon', '双高兵胜单炮', '雙高兵勝單砲'),
    line: tri(
      'A cannon with nothing to jump over cannot hold off two high soldiers.',
      '没有炮架可借的炮，挡不住两个高兵。',
      '沒有砲架可借的砲，擋不住兩個高兵。',
    ),
  },
  'three-soldiers-vs-full-defence': {
    name: tri('Three high soldiers beat the full defence', '三高兵胜士象全', '三高兵勝士象全'),
    line: tri(
      'Three high soldiers break the full defence, which a lone chariot cannot.',
      '三个高兵能攻破士象全，而单车却不能。',
      '三個高兵能攻破士象全，而單車卻不能。',
    ),
  },
  'horse-vs-advisor': {
    name: tri('Horse beats one advisor', '单马胜单士', '單馬勝單士'),
    line: tri('A horse beats a lone advisor.', '单马可胜单士。', '單馬可勝單士。'),
  },
  'horse-vs-elephant': {
    name: tri('Horse draws one elephant', '单马和单象', '單馬和單象'),
    line: tri(
      'A lone elephant holds against a horse: it can switch flanks faster than the horse can cut it off.',
      '单象可守和单马：它换翼的速度比马封锁它的速度更快。',
      '單象可守和單馬：它換翼的速度比馬封鎖它的速度更快。',
    ),
  },
  'horse-vs-elephant-zugzwang': {
    name: tri('Horse tricky win against one elephant', '单马巧胜单象', '單馬巧勝單象'),
    line: tri(
      'With the elephant caught on one flank and Red to move, the horse cuts it off from the other side and wins.',
      '象被逼在一侧且红方先走时，马能切断它回到另一侧的路线而取胜。',
      '象被逼在一側且紅方先走時，馬能切斷它回到另一側的路線而取勝。',
    ),
  },
  'horse-vs-crossed-soldier': {
    name: tri('Horse draws a crossed soldier', '单马和过河卒', '單馬和過河卒'),
    line: tri(
      'A black soldier across the river is enough to hold off a lone horse.',
      '黑方一个过河卒就足以守和单马。',
      '黑方一個過河卒就足以守和單馬。',
    ),
  },
  'horse-and-soldier-vs-three-defence': {
    name: tri(
      'Horse and soldier beat a defence missing one elephant',
      '马兵胜单缺象',
      '馬兵勝單缺象',
    ),
    line: tri(
      'Horse and soldier beat a defence that is missing one elephant.',
      '马兵可胜单缺象。',
      '馬兵可勝單缺象。',
    ),
  },
  'horse-and-soldier-vs-full-defence': {
    name: tri('Horse and soldier draw the full defence', '马兵和士象全', '馬兵和士象全'),
    line: tri(
      'Against the full defence the same horse and soldier only draw. The fourth defensive piece is the whole difference.',
      '面对士象全，同样的马兵只能成和。多出的第四个防守子就是全部差别。',
      '面對士象全，同樣的馬兵只能成和。多出的第四個防守子就是全部差別。',
    ),
  },
  'two-horses-vs-full-defence': {
    name: tri('Two horses beat the full defence', '双马胜士象全', '雙馬勝士象全'),
    line: tri(
      'Two horses beat the full defence; a chariot, worth more than both, does not.',
      '双马可胜士象全，而价值更高的单车却不能。',
      '雙馬可勝士象全，而價值更高的單車卻不能。',
    ),
  },
  'cannon-vs-bare-general': {
    name: tri('Cannon draws a bare general', '单炮和单将', '單砲和單將'),
    line: tri(
      'A cannon needs a piece to jump over before it can capture, so with nothing on the board to use it cannot mate.',
      '炮必须隔子才能吃子，棋盘上没有炮架，就无法将死对方。',
      '砲必須隔子才能吃子，棋盤上沒有砲架，就無法將死對方。',
    ),
  },
  'cannon-and-advisor-vs-two-advisors': {
    name: tri('Cannon and advisor beat two advisors', '炮仕胜双士', '砲仕勝雙士'),
    line: tri(
      'With its own advisor as a screen, the cannon beats two advisors.',
      '有自己的仕作炮架，炮可胜双士。',
      '有自己的仕作砲架，砲可勝雙士。',
    ),
  },
  'two-cannons-vs-two-elephants': {
    name: tri('Two cannons draw two elephants', '双炮和双象', '雙砲和雙象'),
    line: tri(
      'Two cannons alone cannot break two elephants.',
      '仅凭双炮攻不破双象。',
      '僅憑雙砲攻不破雙象。',
    ),
  },
  'two-cannons-advisor-vs-full-defence': {
    name: tri(
      'Two cannons with an advisor beat the full defence',
      '双炮仕胜士象全',
      '雙砲仕勝士象全',
    ),
    line: tri(
      'Add one advisor and the two cannons beat the full defence.',
      '加上一个仕，双炮就能胜士象全。',
      '加上一個仕，雙砲就能勝士象全。',
    ),
  },
  'chariot-vs-three-defence': {
    name: tri('Chariot beats a defence missing one elephant', '单车胜单缺象', '單車勝單缺象'),
    line: tri(
      'A chariot beats the defence once one elephant is missing.',
      '防守方缺一象，单车即可取胜。',
      '防守方缺一象，單車即可取勝。',
    ),
  },
  'chariot-vs-full-defence': {
    name: tri('Chariot draws the full defence', '单车和士象全', '單車和士象全'),
    line: tri(
      'The strongest piece on the board cannot break the full defence on its own.',
      '棋盘上最强的子，单独也攻不破士象全。',
      '棋盤上最強的子，單獨也攻不破士象全。',
    ),
  },
  'chariot-vs-full-defence-tricky': {
    name: tri('Chariot tricky win against the full defence', '单车巧胜士象全', '單車巧勝士象全'),
    line: tri(
      'The full defence draws only from a sound setup. With both elephants stranded on the edge, the chariot wins.',
      '士象全要摆好阵形才能守和。双象都被困在边上时，单车可以取胜。',
      '士象全要擺好陣形才能守和。雙象都被困在邊上時，單車可以取勝。',
    ),
  },
  'chariot-vs-horse-two-advisors': {
    name: tri('Chariot beats horse and two advisors', '单车胜马双士', '單車勝馬雙士'),
    line: tri('A chariot beats horse and two advisors.', '单车可胜马双士。', '單車可勝馬雙士。'),
  },
  'chariot-vs-horse-two-elephants-fortress': {
    name: tri('Chariot draws horse and two elephants', '单车和马双象', '單車和馬雙象'),
    line: tri(
      'The fortress: the horse on the elephant point in front of the general and the two elephants protecting each other. Held exactly like this, the chariot cannot get through.',
      '要诀是马守在将前的象位，两象互相保护。阵形摆对，单车就攻不进去。',
      '要訣是馬守在將前的象位，兩象互相保護。陣形擺對，單車就攻不進去。',
    ),
  },
  'chariot-vs-cannon-two-advisors': {
    name: tri('Chariot draws cannon and two advisors', '单车和炮双士', '單車和砲雙士'),
    line: tri(
      'A cannon and two advisors hold against a lone chariot.',
      '炮双士可守和单车。',
      '砲雙士可守和單車。',
    ),
  },
  'chariot-vs-cannon-two-advisors-tricky': {
    name: tri(
      'Chariot tricky win against cannon and two advisors',
      '单车巧胜炮双士',
      '單車巧勝砲雙士',
    ),
    line: tri(
      'With both advisors on the back rank and the cannon in front of the general, the chariot wins.',
      '双士都在底线、炮在将前时，单车可以取胜。',
      '雙士都在底線、砲在將前時，單車可以取勝。',
    ),
  },
  'chariot-cannon-vs-chariot-center': {
    name: tri('Chariot and cannon beat a chariot', '车炮胜单车', '車砲勝單車'),
    line: tri(
      'Chariot and cannon beat a lone chariot when the red chariot holds the middle file.',
      '红车占住中路时，车炮可胜单车。',
      '紅車佔住中路時，車砲可勝單車。',
    ),
  },
};

/** Per contrast position: one line saying what moved and what it changed. */
const CONTRAST_TEXT: Record<string, EndgameText> = {
  'three-soldiers-pulled-back-vs-full-defence': tri(
    'Pull the same three soldiers back one rank and the win is gone.',
    '同样三个兵各退一路，胜势就没了。',
    '同樣三個兵各退一路，勝勢就沒了。',
  ),
  'chariot-vs-horse-two-elephants-broken': tri(
    'Move one elephant from g6 back to g10 and the chariot wins.',
    '把一象从g6退到g10，单车就能取胜。',
    '把一象從g6退到g10，單車就能取勝。',
  ),
  'chariot-cannon-vs-chariot': tri(
    'If Black’s chariot takes the middle file first, the same material draws.',
    '若黑车先占中路，同样的子力只能成和。',
    '若黑車先佔中路，同樣的子力只能成和。',
  ),
};

const CONTRAST_LABEL = tri('One step away', '一步之差', '一步之差');

export function endgameRowText(id: string): { name: EndgameText; line: EndgameText } {
  const text = ROW_TEXT[id];
  if (!text) throw new Error(`xiangqi endgames page: no text for row ${id}`);
  return text;
}

export function endgameContrastText(id: string): EndgameText {
  const text = CONTRAST_TEXT[id];
  if (!text) throw new Error(`xiangqi endgames page: no text for contrast ${id}`);
  return text;
}

/**
 * Moves to mate the page may print for a position, or null when it should say
 * only "Red wins" (a draw, or a database distance that is not the length of the
 * line it returned). Plies to moves: Red moves first, so N plies is ceil(N/2).
 */
export function endgameMateMoves(id: string): number | null {
  const check = XIANGQI_ENDGAME_HUB_CHECKS.find((row) => row.id === id);
  if (!check) throw new Error(`xiangqi endgames page: no tablebase check for ${id}`);
  if (check.result !== 'win' || check.distance === null) return null;
  if (check.distance !== check.pv.length) return null;
  return Math.ceil(check.distance / 2);
}

function tablebaseTail(id: string): EndgameText {
  const check = XIANGQI_ENDGAME_HUB_CHECKS.find((row) => row.id === id);
  if (!check) throw new Error(`xiangqi endgames page: no tablebase check for ${id}`);
  // Each result names and links its source, chessdb.cn (Brian, 2026-10-07).
  const en = 'Checked on [chessdb.cn](https://www.chessdb.cn/):';
  const hans = '[云库 chessdb.cn](https://www.chessdb.cn/)核对：';
  const hant = '[雲庫 chessdb.cn](https://www.chessdb.cn/)核對：';
  if (check.result === 'draw') return tri(`${en} draw.`, `${hans}和棋。`, `${hant}和棋。`);
  const moves = endgameMateMoves(id);
  if (moves === null) return tri(`${en} Red wins.`, `${hans}红方胜。`, `${hant}紅方勝。`);
  return tri(
    `${en} Red mates in ${moves}.`,
    `${hans}红方${moves}步杀。`,
    `${hant}紅方${moves}步殺。`,
  );
}

function paragraph(label: EndgameText, line: EndgameText, tail: EndgameText): EndgameText {
  const zh = (lang: Lang) => `**${label[lang]}。**${line[lang]}${tail[lang]}`;
  return {
    en: `**${label.en}.** ${line.en} ${tail.en}`,
    'zh-Hans': zh('zh-Hans'),
    'zh-Hant': zh('zh-Hant'),
  };
}

/** The row's paragraph: grade in bold, the teaching line, the tablebase result. */
export function endgameRowParagraph(id: string, grade: EndgameGrade): EndgameText {
  return paragraph(ENDGAME_GRADE_LABEL[grade], endgameRowText(id).line, tablebaseTail(id));
}

/** A contrast's paragraph: what moved, then the tablebase result. */
export function endgameContrastParagraph(id: string): EndgameText {
  const zhLabel = (lang: Lang) => `**${CONTRAST_LABEL[lang]}：**`;
  const line = endgameContrastText(id);
  const tail = tablebaseTail(id);
  return {
    en: `**${CONTRAST_LABEL.en}.** ${line.en} ${tail.en}`,
    'zh-Hans': `${zhLabel('zh-Hans')}${line['zh-Hans']}${tail['zh-Hans']}`,
    'zh-Hant': `${zhLabel('zh-Hant')}${line['zh-Hant']}${tail['zh-Hant']}`,
  };
}

/** Fixed page strings (title, intro, buttons, FAQ). */
export const ENDGAME_PAGE_TEXT = {
  title: tri(
    'Xiangqi Endgames: Standard Wins and Draws',
    '象棋残局：实用残局胜和定式',
    '象棋殘局：實用殘局勝和定式',
  ),
  seoTitle: tri(
    'Xiangqi Endgames: 26 Standard Wins and Draws to Play Out',
    '象棋残局大全：26个实用残局胜和定式，在线和电脑下',
    '象棋殘局大全：26個實用殘局勝和定式，線上和電腦下',
  ),
  cardTitle: tri('Xiangqi Endgames', '象棋残局', '象棋殘局'),
  summary: tri(
    'Which xiangqi endgames are a win and which are a draw: 26 standard wins, tricky wins and standard draws, each checked against the chessdb.cn tablebase and playable against the computer.',
    '哪些象棋残局能赢，哪些只能和：26个例胜、巧胜和例和局面，每一个都经象棋云库 chessdb.cn 核对，并可直接和电脑下。',
    '哪些象棋殘局能贏，哪些只能和：26個例勝、巧勝和例和局面，每一個都經象棋雲庫 chessdb.cn 核對，並可直接和電腦下。',
  ),
  introGrades: tri(
    'Chinese endgame manuals sort the common endings into grades. This page uses three. A **standard win** (例胜) is won with correct technique whatever the defender does. A **tricky win** (巧胜) is material that is normally a draw, in a position where the attacker can still force the win. A **standard draw** (例和) holds when the defender sets up correctly.',
    '象棋残局书把常见残局分成几个等级，本页用其中三个。**例胜**：只要技术正确，不论对方怎样防守都能取胜。**巧胜**：这类子力通常是和棋，但在特定局面下进攻方仍能强行取胜。**例和**：防守方摆好阵形即可守和。',
    '象棋殘局書把常見殘局分成幾個等級，本頁用其中三個。**例勝**：只要技術正確，不論對方怎樣防守都能取勝。**巧勝**：這類子力通常是和棋，但在特定局面下進攻方仍能強行取勝。**例和**：防守方擺好陣形即可守和。',
  ),
  introSource: tri(
    'The grades follow the Chinese Wikipedia list of standard results (象棋勝和定式), which cites 金启昌 and 杨典, 象棋残局胜和定式 (2008). The horse-and-soldier and two-horse rows follow English Wikipedia. The positions are ours. Every verdict on this page was checked against the exact results of [chessdb.cn](https://www.chessdb.cn/), the Chinese chess cloud database, for that exact position.',
    '等级依据中文维基百科的“象棋勝和定式”条目，该条目引用金启昌、杨典《象棋残局胜和定式》（2008）。马兵和双马两局依据英文维基百科。局面由我们摆出。本页每一个结论都经[象棋云库 chessdb.cn](https://www.chessdb.cn/)对该局面的确切结果核对。',
    '等級依據中文維基百科的「象棋勝和定式」條目，該條目引用金啟昌、楊典《象棋殘局勝和定式》（2008）。馬兵和雙馬兩局依據英文維基百科。局面由我們擺出。本頁每一個結論都經[象棋雲庫 chessdb.cn](https://www.chessdb.cn/)對該局面的確切結果核對。',
  ),
  introPractice: tri(
    'Every position opens in practice against the computer. In a win you play Red and must give mate; in a draw you play Black and must hold for 15 moves. Analyse opens the same position on the analysis board.',
    '每个局面都可以直接和电脑练习。胜局你执红，必须将死对方；和局你执黑，必须守住15回合。点“分析”可在分析棋盘上打开同一局面。',
    '每個局面都可以直接和電腦練習。勝局你執紅，必須將死對方；和局你執黑，必須守住15回合。點「分析」可在分析棋盤上打開同一局面。',
  ),
  glanceHeading: tri('At a glance', '一览', '一覽'),
  glanceEnding: tri('Endgame', '残局', '殘局'),
  glanceGrade: tri('Grade', '等级', '等級'),
  play: tri('Play it out', '和电脑下', '和電腦下'),
  analyse: tri('Analyse', '分析', '分析'),
  ownHeading: tri('Set up your own endgame', '自己摆残局', '自己擺殘局'),
  ownText: tri(
    'Any position can be practised the same way. Set it up in the [board editor](/editor/xiangqi), choose whether you are playing to mate or to hold the draw and which side you take, and press Play it out.',
    '任何局面都可以这样练习。在[棋盘编辑器](/editor/xiangqi)里摆好局面，选择是要将死对方还是守和、执哪一方，然后点“和电脑下”。',
    '任何局面都可以這樣練習。在[棋盤編輯器](/editor/xiangqi)裡擺好局面，選擇是要將死對方還是守和、執哪一方，然後點「和電腦下」。',
  ),
  ownButton: tri('Open the board editor', '打开棋盘编辑器', '打開棋盤編輯器'),
  faqHeading: tri('Questions', '常见问题', '常見問題'),
  faqDrawQ: tri('What does 例和 mean?', '例和是什么意思？', '例和是什麼意思？'),
  faqDrawA: tri(
    '例和 is a standard draw: with correct defence the weaker side holds, so the stronger side cannot force a win. Its opposite is 例胜, a standard win, where correct technique wins whatever the defence does.',
    '例和就是按定式应为和棋：防守正确，弱方即可守住，强方无法强行取胜。与之相对的是例胜：技术正确，不论对方怎样防守都能取胜。',
    '例和就是按定式應為和棋：防守正確，弱方即可守住，強方無法強行取勝。與之相對的是例勝：技術正確，不論對方怎樣防守都能取勝。',
  ),
  faqTrickyQ: tri('What is a 巧胜?', '什么是巧胜？', '什麼是巧勝？'),
  faqTrickyA: tri(
    'A tricky win: the material is normally a draw, but the position in front of you wins, usually because the defending pieces stand badly or the attacker has the move.',
    '巧胜指这类子力通常是和棋，但眼前这个局面能赢，一般是因为防守子位置不好，或者轮到进攻方走棋。',
    '巧勝指這類子力通常是和棋，但眼前這個局面能贏，一般是因為防守子位置不好，或者輪到進攻方走棋。',
  ),
  faqChariotQ: tri(
    'Why can a chariot not beat the full defence?',
    '为什么单车胜不了士象全？',
    '為什麼單車勝不了士象全？',
  ),
  faqChariotA: tri(
    'Two advisors and two elephants protect each other and the general, and a lone chariot cannot win any of them by force. Take one elephant away and the chariot wins, and three high soldiers or two horses break the full defence where the chariot cannot.',
    '双士双象互相保护，也保护将，单车无法强行吃掉其中任何一个。少一个象，单车就能取胜；而三个高兵或双马能攻破士象全，单车却不能。',
    '雙士雙象互相保護，也保護將，單車無法強行吃掉其中任何一個。少一個象，單車就能取勝；而三個高兵或雙馬能攻破士象全，單車卻不能。',
  ),
  faqCheckQ: tri(
    'How were these results checked?',
    '这些结果是怎样核对的？',
    '這些結果是怎樣核對的？',
  ),
  faqCheckA: tri(
    'Each position was looked up in the chessdb.cn tablebase, which holds exact results for endgames with few pieces. A test on the site fails if a row’s grade and its tablebase result disagree, so a position appears here only when the database confirms it.',
    '每个局面都在象棋云库 chessdb.cn 中查过，云库收录了少子残局的确切结果。若某局的等级与云库结果不符，网站的测试就会失败，因此只有经云库确认的局面才会出现在这里。',
    '每個局面都在象棋雲庫 chessdb.cn 中查過，雲庫收錄了少子殘局的確切結果。若某局的等級與雲庫結果不符，網站的測試就會失敗，因此只有經雲庫確認的局面才會出現在這裡。',
  ),
} satisfies Record<string, EndgameText>;

/**
 * Every string the page shows, as triples, in no particular order. The article
 * module renders the `en` side; article-i18n.ts spreads the zh sides in through
 * `endgamePageDictionary`. Enumerated from the hub, so a hub row is covered the
 * moment it exists.
 */
export function endgamePageTexts(): EndgameText[] {
  const out: EndgameText[] = [
    ...Object.values(ENDGAME_PAGE_TEXT),
    ...Object.values(ENDGAME_GRADE_LABEL),
    ...Object.values(ENDGAME_GROUP_HEADING),
  ];
  for (const row of XIANGQI_ENDGAME_HUB) {
    out.push(endgameRowText(row.id).name, endgameRowParagraph(row.id, row.grade));
    for (const contrast of row.contrasts ?? []) out.push(endgameContrastParagraph(contrast));
  }
  return out;
}

export function endgamePageDictionary(lang: 'zh-Hans' | 'zh-Hant'): Record<string, string> {
  return Object.fromEntries(endgamePageTexts().map((text) => [text.en, text[lang]]));
}
