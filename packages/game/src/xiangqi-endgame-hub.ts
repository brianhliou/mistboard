// The 象棋残局 page: which corpus positions it shows, in what order, under which
// book grade.
//
// Chinese endgame manuals grade a material class with one of six words
// (必胜 / 例胜 / 巧胜 / 难胜 / 例和 / 必和). The page uses three:
//
//   'standard-win'  例胜  the class wins with correct technique
//   'tricky-win'    巧胜  the class is a draw, but THIS kind of position wins
//   'standard-draw' 例和  the class holds from a sound defensive setup
//
// 难胜 rows are left off the page rather than squeezed into a neighbour, and the
// 必和 rows show as 例和: that understates a result but never misstates one.
//
// The grade is the book's claim about the class (zh-Wikipedia 象棋勝和定式, citing
// 金启昌 / 杨典《象棋残局胜和定式》, 2008; en-Wikipedia for the rows only it states).
// The position is ours, and its own result is settled separately: every
// position below has a row in xiangqi-endgame-hub-checks.ts (a chessdb.cn exact
// result), and xiangqi-endgame-hub.test.ts fails if a grade and its check
// disagree. 难胜 rows (单车 vs 马炮, 单车 vs 双马) are not on the page, and neither
// are the two horse-and-cannon rows: the database does not hold them and
// Pikafish at depth 30 neither mated the win (+284) nor read the draw as level
// (+115), so their verdicts could not be confirmed.

import type { EndgameEntry, EndgameSource, EndgameVerdict } from './xiangqi-endgame-corpus.js';
import { XIANGQI_ENDGAME_CORPUS } from './xiangqi-endgame-corpus.js';

export type EndgameGrade = 'standard-win' | 'tricky-win' | 'standard-draw';

export type EndgameHubGroup = 'soldier' | 'horse' | 'cannon' | 'chariot';

export type EndgameHubRow = {
  /** Corpus id of the position the row is played from. */
  id: string;
  group: EndgameHubGroup;
  grade: EndgameGrade;
  /** The manual-style name in English; the zh names live in the page's dictionary. */
  name: string;
  source: EndgameSource;
  /**
   * Positions one step away with the opposite result: the same material with
   * one piece moved. Shown under the row with their tablebase result, not a
   * grade, because a grade is a claim about a class and these are single points.
   */
  contrasts?: readonly string[];
};

export const XIANGQI_ENDGAME_HUB_GROUPS: readonly EndgameHubGroup[] = [
  'soldier',
  'horse',
  'cannon',
  'chariot',
];

export const XIANGQI_ENDGAME_HUB: readonly EndgameHubRow[] = [
  // ── 兵 ──
  {
    id: 'high-soldier-vs-bare-general',
    group: 'soldier',
    grade: 'standard-win',
    name: 'High soldier beats a bare general',
    source: 'zh-wikipedia',
  },
  {
    id: 'bottom-soldier-vs-bare-general',
    group: 'soldier',
    grade: 'standard-draw',
    name: 'Bottom soldier draws a bare general',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-soldier-vs-advisor',
    group: 'soldier',
    grade: 'standard-draw',
    name: 'High soldier draws one advisor',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-soldier-vs-advisor-tricky',
    group: 'soldier',
    grade: 'tricky-win',
    name: 'High soldier tricky win against one advisor',
    source: 'zh-wikipedia',
  },
  {
    id: 'high-low-soldiers-vs-two-advisors',
    group: 'soldier',
    grade: 'standard-win',
    name: 'High and low soldier beat two advisors',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-high-soldiers-vs-cannon',
    group: 'soldier',
    grade: 'standard-win',
    name: 'Two high soldiers beat a cannon',
    source: 'zh-wikipedia',
  },
  {
    id: 'three-soldiers-vs-full-defence',
    group: 'soldier',
    grade: 'standard-win',
    name: 'Three high soldiers beat the full defence',
    source: 'zh-wikipedia',
    contrasts: ['three-soldiers-pulled-back-vs-full-defence'],
  },
  // ── 马 ──
  {
    id: 'horse-vs-advisor',
    group: 'horse',
    grade: 'standard-win',
    name: 'Horse beats one advisor',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-vs-elephant',
    group: 'horse',
    grade: 'standard-draw',
    name: 'Horse draws one elephant',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-vs-elephant-zugzwang',
    group: 'horse',
    grade: 'tricky-win',
    name: 'Horse tricky win against one elephant',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-vs-crossed-soldier',
    group: 'horse',
    grade: 'standard-draw',
    name: 'Horse draws a crossed soldier',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-and-soldier-vs-three-defence',
    group: 'horse',
    grade: 'standard-win',
    name: 'Horse and soldier beat a defence missing one elephant',
    source: 'zh-wikipedia',
  },
  {
    id: 'horse-and-soldier-vs-full-defence',
    group: 'horse',
    grade: 'standard-draw',
    name: 'Horse and soldier draw the full defence',
    source: 'en-wikipedia',
  },
  {
    id: 'two-horses-vs-full-defence',
    group: 'horse',
    grade: 'standard-win',
    name: 'Two horses beat the full defence',
    source: 'en-wikipedia',
  },
  // ── 炮 ──
  {
    id: 'cannon-vs-bare-general',
    group: 'cannon',
    grade: 'standard-draw',
    name: 'Cannon draws a bare general',
    source: 'zh-wikipedia',
  },
  {
    id: 'cannon-and-advisor-vs-two-advisors',
    group: 'cannon',
    grade: 'standard-win',
    name: 'Cannon and advisor beat two advisors',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-cannons-vs-two-elephants',
    group: 'cannon',
    grade: 'standard-draw',
    name: 'Two cannons draw two elephants',
    source: 'zh-wikipedia',
  },
  {
    id: 'two-cannons-advisor-vs-full-defence',
    group: 'cannon',
    grade: 'standard-win',
    name: 'Two cannons with an advisor beat the full defence',
    source: 'zh-wikipedia',
  },
  // ── 车 ──
  {
    id: 'chariot-vs-three-defence',
    group: 'chariot',
    grade: 'standard-win',
    name: 'Chariot beats a defence missing one elephant',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-full-defence',
    group: 'chariot',
    grade: 'standard-draw',
    name: 'Chariot draws the full defence',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-full-defence-tricky',
    group: 'chariot',
    grade: 'tricky-win',
    name: 'Chariot tricky win against the full defence',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-horse-two-advisors',
    group: 'chariot',
    grade: 'standard-win',
    name: 'Chariot beats horse and two advisors',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-horse-two-elephants-fortress',
    group: 'chariot',
    grade: 'standard-draw',
    name: 'Chariot draws horse and two elephants',
    source: 'zh-wikipedia',
    contrasts: ['chariot-vs-horse-two-elephants-broken'],
  },
  {
    id: 'chariot-vs-cannon-two-advisors',
    group: 'chariot',
    grade: 'standard-draw',
    name: 'Chariot draws cannon and two advisors',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-vs-cannon-two-advisors-tricky',
    group: 'chariot',
    grade: 'tricky-win',
    name: 'Chariot tricky win against cannon and two advisors',
    source: 'zh-wikipedia',
  },
  {
    id: 'chariot-cannon-vs-chariot-center',
    group: 'chariot',
    grade: 'standard-win',
    name: 'Chariot and cannon beat a chariot',
    source: 'zh-wikipedia',
    contrasts: ['chariot-cannon-vs-chariot'],
  },
];

/** The result a grade claims for its own position: a 巧胜 position is a win. */
export function endgameGradeVerdict(grade: EndgameGrade): EndgameVerdict {
  return grade === 'standard-draw' ? 'draw' : 'win';
}

export function endgameHubEntry(id: string): EndgameEntry {
  const entry = XIANGQI_ENDGAME_CORPUS.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`endgame hub: no corpus entry ${id}`);
  return entry;
}

/** Every position the page shows (rows and their contrasts), in page order. */
export function endgameHubPositionIds(): string[] {
  return XIANGQI_ENDGAME_HUB.flatMap((row) => [row.id, ...(row.contrasts ?? [])]);
}

/**
 * The practice exercise for a position: a win is played as Red to mate, a draw
 * as Black holding for fifteen moves (the same split the practice studies use).
 */
export function endgamePracticeSetup(entry: EndgameEntry): {
  side: 'red' | 'black';
  goal: 'mate' | 'draw';
} {
  return entry.verdict === 'win' ? { side: 'red', goal: 'mate' } : { side: 'black', goal: 'draw' };
}
