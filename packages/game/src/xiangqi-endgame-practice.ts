// The /practice endgame shelf: five studies, one per attacking piece, each in
// teaching order, with the words every chapter opens on.
//
// The shelf began as the basic-endgame corpus cut by `category` (32 positions,
// seeded 2026-09). The 象棋残局 article then graded 26 positions of its own; 12
// are the same boards as shelf chapters and the other 14 fold into the set of
// their attacking piece here, so there is one shelf rather than a survey set
// beside five deeper ones (Brian, 2026-10-07: "organize by piece").
//
// The server seeder (apps/server/src/seed-xiangqi-endgame-practice.ts) writes
// exactly what `xiangqiEndgamePracticeSets` returns into the existing studies,
// in place, and the /practice catalogue points at each by its slug.
//
// Order inside a set: the wins, easiest first by the database's distance to mate
// for that exact position, then the draws you hold as Black, in the order listed.
//
// zh is machine translation (2026-10-07), not native-reviewed. Terms follow the
// basic-endgame study (apps/server/src/xiangqi-endgame-study-i18n.ts): 例胜 /
// 巧胜 / 例和, 高兵, 士象全, 炮架; zh-Hant writes 砲 for the cannon there too.

import {
  type EndgameEntry,
  endgameEntryFen,
  XIANGQI_ENDGAME_CORPUS,
} from './xiangqi-endgame-corpus.js';
import { XIANGQI_ENDGAME_HUB } from './xiangqi-endgame-hub.js';
import { XIANGQI_ENDGAME_HUB_CHECKS } from './xiangqi-endgame-hub-checks.js';

export type EndgameText = { en: string; 'zh-Hans': string; 'zh-Hant': string };

function tri(en: string, hans: string, hant: string): EndgameText {
  return { en, 'zh-Hans': hans, 'zh-Hant': hant };
}

/** A draw chapter is held for this many of the learner's moves. */
export const XIANGQI_ENDGAME_PRACTICE_DRAW_MOVES = 15;

/** Per hub row: the manual-style name (the chapter name) and the teaching line. */
export const XIANGQI_ENDGAME_ROW_TEXT: Record<string, { name: EndgameText; line: EndgameText }> = {
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
      'One advisor is enough to hold a single high soldier.',
      '一个士足以守和单个高兵。',
      '一個士足以守和單個高兵。',
    ),
  },
  'high-soldier-vs-advisor-tricky': {
    name: tri('High soldier tricky win against one advisor', '高兵巧胜单士', '高兵巧勝單士'),
    line: tri(
      'A high soldier against one advisor is normally a draw, but it wins when the soldier already stands in the palace and Red is to move.',
      '高兵对单士通常是和棋，但兵已进九宫且红方先走时可以取胜。',
      '高兵對單士通常是和棋，但兵已進九宮且紅方先走時可以取勝。',
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

export function endgameRowText(id: string): { name: EndgameText; line: EndgameText } {
  const text = XIANGQI_ENDGAME_ROW_TEXT[id];
  if (!text) throw new Error(`xiangqi endgame practice: no text for row ${id}`);
  return text;
}

/** The `studies.slug` of each set; the /practice catalogue names them. */
export type EndgamePracticeSetSlug =
  | 'endgames-soldier'
  | 'endgames-chariot'
  | 'endgames-horse'
  | 'endgames-cannon'
  | 'endgames-insufficient';

/**
 * Which corpus positions each set holds. Listed here, not derived from the
 * corpus `category`, because the corpus also carries positions that are not
 * exercises (the three one-point counterexamples beside the chariot and soldier
 * rows). A position goes to the set of its attacking piece; a mixed attack goes
 * to its strongest piece (chariot and cannon is a chariot ending), and the
 * horse-and-cannon pairings stay with the cannon, where they were seeded.
 *
 * The wins are reordered by mate distance; the draws keep the order given here.
 */
export const XIANGQI_ENDGAME_PRACTICE_SET_IDS: Record<EndgamePracticeSetSlug, readonly string[]> = {
  'endgames-soldier': [
    'soldier-vs-bare-general',
    'high-soldier-vs-bare-general',
    'high-soldier-vs-advisor-tricky',
    'soldier-vs-advisor',
    'high-low-soldiers-vs-two-advisors',
    'two-soldiers-vs-two-advisors',
    'two-soldiers-vs-two-elephants',
    'two-soldiers-vs-bare-cannon',
    'two-high-soldiers-vs-cannon',
    'three-soldiers-vs-full-defence',
    'three-soldiers-vs-horse-and-two-advisors',
    'three-soldiers-vs-cannon-and-two-elephants',
    'general-and-soldier-zugzwang',
    'reciprocal-zugzwang',
    'high-soldier-vs-advisor',
    'two-soldiers-vs-advisor-and-elephant',
  ],
  'endgames-chariot': [
    'chariot-cannon-vs-chariot-center',
    'chariot-vs-three-defence',
    'chariot-vs-cannon-two-advisors-tricky',
    'chariot-vs-full-defence-tricky',
    'chariot-vs-horse-two-elephants-broken',
    'chariot-vs-horse-two-advisors',
    'two-chariots-vs-two-horses-full-defence',
    'chariot-vs-full-defence',
    'chariot-vs-horse-two-elephants-fortress',
    'chariot-vs-cannon-two-advisors',
    'chariot-vs-two-minor-pieces',
    'chariot-cannon-vs-chariot',
    'chariot-cannon-full-vs-chariot-full',
    'two-chariots-vs-chariot-full-defence',
  ],
  'endgames-horse': [
    'horse-vs-elephant-zugzwang',
    'horse-and-soldier-vs-three-defence',
    'horse-vs-advisor',
    'two-horses-vs-full-defence',
    'horse-vs-elephant',
    'horse-vs-crossed-soldier',
    'horse-and-soldier-vs-full-defence',
  ],
  'endgames-cannon': [
    'cannon-and-advisor-vs-two-advisors',
    'two-cannons-advisor-vs-full-defence',
    'horse-cannon-vs-horse',
    'two-cannons-vs-two-elephants',
    'cannon-and-full-defence-vs-full-defence',
    'horse-cannon-vs-cannon',
  ],
  'endgames-insufficient': [
    'bottom-soldier-vs-bare-general',
    'soldiers-five-on-last-rank',
    'cannon-vs-bare-general',
  ],
};

/** Shelf order, the catalogue's too. */
export const XIANGQI_ENDGAME_PRACTICE_SLUGS = Object.keys(
  XIANGQI_ENDGAME_PRACTICE_SET_IDS,
) as EndgamePracticeSetSlug[];

/**
 * Plies to mate for shelf wins that are not article rows (whose distances are
 * in xiangqi-endgame-hub-checks.ts), from the side to move: chessdb.cn
 * `queryall`, read 2026-10-07. Two wins are beyond the database
 * (two-chariots-vs-two-horses-full-defence, horse-cannon-vs-horse) and sort
 * after every win with a distance.
 */
const SHELF_MATE_PLIES: Record<string, number> = {
  'soldier-vs-bare-general': 7,
  'soldier-vs-advisor': 19,
  'two-soldiers-vs-two-advisors': 23,
  'two-soldiers-vs-two-elephants': 13,
  'two-soldiers-vs-bare-cannon': 17,
  'three-soldiers-vs-horse-and-two-advisors': 13,
  'three-soldiers-vs-cannon-and-two-elephants': 23,
  'general-and-soldier-zugzwang': 13,
  'reciprocal-zugzwang': 8,
};

/** Plies to mate for a win, or Infinity when no source gives one. */
export function endgamePracticeMateDistance(id: string): number {
  const check = XIANGQI_ENDGAME_HUB_CHECKS.find((row) => row.id === id);
  if (check?.result === 'win' && check.distance !== null) return check.distance;
  return SHELF_MATE_PLIES[id] ?? Number.POSITIVE_INFINITY;
}

/**
 * Shelf chapters that are article rows but keep the corpus note as their brief,
 * because it says more than the article's one line. Every other article row
 * opens on the article's line: either the corpus had no note (the chapter
 * opened on its own name), or the note gave the winning move away or pointed at
 * a chapter "above" that the new order moves.
 */
const KEEPS_CORPUS_NOTE: ReadonlySet<string> = new Set([
  'three-soldiers-vs-full-defence',
  'two-horses-vs-full-defence',
  'horse-vs-elephant',
  'cannon-vs-bare-general',
  'chariot-vs-full-defence',
]);

/** Briefs written for the shelf, where the corpus note no longer fits. */
const SHELF_BRIEFS: Record<string, EndgameText> = {
  // The note began "The fortress above", and the fortress, a draw, now comes
  // after this win.
  'chariot-vs-horse-two-elephants-broken': tri(
    'The drawing fortress for this material, with one elephant moved to the back rank. That one point is the whole difference: here the chariot wins.',
    '这是该子力的守和阵形，只是一个象退到了底线。仅这一点之差，单车便能取胜。',
    '這是該子力的守和陣形，只是一個象退到了底線。僅這一點之差，單車便能取勝。',
  ),
};

export type EndgamePracticeChapter = {
  /** Corpus id of the position. */
  id: string;
  entry: EndgameEntry;
  /** Root position, either side to move. */
  fen: string;
  /** In the grammar `parsePracticeGoal` accepts. */
  goal: string;
  /** The side the learner plays: Red converts a win, Black holds a draw. */
  orientation: 'red' | 'black';
  /**
   * The words the chapter opens on, in all three scripts; null means the corpus
   * note (or, with none, the matchup), which the server's dictionaries
   * translate.
   */
  brief: EndgameText | null;
  /** Plies to mate for a win, Infinity for a draw or an unknown distance. */
  distance: number;
};

export type EndgamePracticeSet = {
  slug: EndgamePracticeSetSlug;
  chapters: EndgamePracticeChapter[];
};

function corpusEntry(id: string): EndgameEntry {
  const entry = XIANGQI_ENDGAME_CORPUS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`xiangqi endgame practice: no corpus entry ${id}`);
  return entry;
}

const HUB_IDS: ReadonlySet<string> = new Set(XIANGQI_ENDGAME_HUB.map((row) => row.id));

function briefFor(id: string): EndgameText | null {
  const written = SHELF_BRIEFS[id];
  if (written) return written;
  if (HUB_IDS.has(id) && !KEEPS_CORPUS_NOTE.has(id)) return endgameRowText(id).line;
  return null;
}

function practiceChapter(id: string): EndgamePracticeChapter {
  const entry = corpusEntry(id);
  const win = entry.verdict === 'win';
  return {
    id,
    entry,
    fen: endgameEntryFen(entry),
    goal: win ? 'mate' : `draw in ${XIANGQI_ENDGAME_PRACTICE_DRAW_MOVES}`,
    orientation: win ? 'red' : 'black',
    brief: briefFor(id),
    distance: win ? endgamePracticeMateDistance(id) : Number.POSITIVE_INFINITY,
  };
}

/** The five sets, each in the order its study holds the chapters. */
export function xiangqiEndgamePracticeSets(): EndgamePracticeSet[] {
  return XIANGQI_ENDGAME_PRACTICE_SLUGS.map((slug) => {
    const chapters = XIANGQI_ENDGAME_PRACTICE_SET_IDS[slug].map(practiceChapter);
    // Array.prototype.sort is stable: equal and unknown distances keep the
    // listed order, and the draws keep it outright.
    const wins = chapters
      .filter((chapter) => chapter.goal === 'mate')
      .sort((a, b) => (a.distance === b.distance ? 0 : a.distance - b.distance));
    const draws = chapters.filter((chapter) => chapter.goal !== 'mate');
    return { slug, chapters: [...wins, ...draws] };
  });
}
