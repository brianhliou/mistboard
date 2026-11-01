import type { JieqiDeal } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';
import matchJson from './ab-jchess-vs-jqe-match.json' with { type: 'json' };

// DRAFT for Brian's read. AB-JChess-20261031 took the jieqi title back from jqe
// (2026-10-31); this post goes live with the 11-02 release that makes it the top
// bot. A player post (Brian, 2026-10-31: it goes on the homepage), so the result
// and the games lead and the review change is a short plain section near the end.
//
// Every number in the prose is read from ab-jchess-vs-jqe-match.json, and
// ab-jchess-vs-jqe.test.ts recomputes the record and replays the four games.
//
// Sources:
// - mistboard-engine lab/jieqi-match/jqe-vs-abj-20261031/run{1,2}-4s-4thr.jsonl:
//   600 games, 300 colour-swapped deals (seeds 50000-50149 and 51000-51149), 4 s a
//   move, 4 threads, A = AB-JChess-20261031 (efc83867, net 20261030), B = jqe
//   331a6e61 (net it014). Totals, Elo (trinomial and pentanomial, as summarize.py),
//   the colour split, the deal sweeps and the four games were recomputed from the
//   files (scratchpad abj_match.py, 2026-10-31); every deal rebuilt from its seed
//   matched the game's final position in 600 of 600 games.
// - The four games' deals are their PUBLIC deals (jieqiPublicDeal): a piece captured
//   face-down stays unknown, and the prose never names what one was.
// - Where they disagree (scratchpad aws662, 2026-10-31, AWS): cross_eval.py had each
//   engine name its move for every position of the 600 games at 500 ms on 2 threads;
//   disagree.py kept the moves the other engine scored at least 100 cp below its own
//   choice, in a game that engine still called within 300 cp, where the played move
//   did not turn a piece over (173); why4.py searched the played move and the critic's
//   choice with both engines for 4 s on 4 threads. Calibration and first moves are from
//   the match records. All of it is in the data file under disagree, calibration and
//   openings, and each game's dispute.
// - Engine facts: lab/jieqi-match/README.md § AB-JChess-20261031 (rebuilt on jqe's
//   MIT code, net 580,156 bytes against 144 MB for v0.2d, smoke 5.79M nps against
//   jqe's 5.27M and v0.2d's 89.6k, "about 65x faster per node"). jqe's net size
//   (1,547,356 bytes): jqe.ts.
// - The reveal schemes and the larger net: Laoxu (Kouza) on lxsgx23/AB-JChess
//   issue #1 (in Chinese): four schemes at -20, -10, 0 (kept: pure chance mix) and
//   -90 Elo; a large 2048-wide net weaker than the small one, planned as a teacher.
//   The small net's width is stated differently there (512) and in the README (FT
//   256), so the post states no width.
// - Review: apps/server/src/jieqi-analysis.ts AB-JChess budgets and commits
//   9f3ed0e64 (no MultiPV: rank legal moves), 3a7715555, a793b529d (rank at 50k,
//   then the top three and the played move at 200k; at most 17.75M nodes, ~12.7 s
//   for an opening reveal) and 667fc31be (K 0.00269 over 9,776 positions, +409 cp
//   = 75%; v0.2d keeps 0.00985, +112 cp = 75%), all parked on
//   agent/abj-20261031-champion for the same 11-02 release.

type MatchGame = {
  key: string;
  red: string;
  black: string;
  winner: 'red' | 'black';
  abWon: boolean;
  moveCount: number;
  moves: string;
  deal: JieqiDeal;
  // The move the post opens the game on: both engines' 4 s scores (mover's view, cp)
  // for the move played and the other engine's choice, and the critic's 500 ms glance.
  dispute: {
    ply: number;
    move: number;
    mover: string;
    played: string;
    alt: string;
    abj: { played: number; alt: number };
    jqe: { played: number; alt: number };
    glance: { played: number; alt: number };
    criticOwn: number[];
    pv: Record<'abj_played' | 'abj_alt' | 'jqe_played' | 'jqe_alt', string>;
  };
  // Both engines' own 4 s scores in the game, as AB-JChess's chance (0-1) at every
  // position 0..plies: the engine that just moved and the one to move each read it.
  series: { abj: number[]; jqe: number[] };
};
type DisagreeSide = {
  disputed: number;
  criticCameRound: number;
  bothKept: number;
  bothKeptWon: number;
  bothKeptDrawn: number;
  bothKeptLost: number;
  disputedWon: number;
  disputedLost: number;
  /** Still preferred by the critic, but the mover's own 4 s search switched to it. */
  moverSwitched: number;
  /** The games the still-disputed moves came in, and the mover's result in each. */
  bothKeptGames: number;
  bothKeptGamesWon: number;
  bothKeptGamesDrawn: number;
  bothKeptGamesLost: number;
};
type Wdl = { wins: number; draws: number; losses: number };
type RunStats = Wdl & { games: number; pairs: number; pentaElo: number; pentaLow: number; pentaHigh: number };

export const AB_JQE_MATCH = matchJson as unknown as {
  movetimeMs: number;
  threads: number;
  total: RunStats & { pairPoints: Record<string, number> };
  runs: { run1: RunStats; run2: RunStats };
  asRed: Wdl;
  asBlack: Wdl;
  reasons: Record<string, number>;
  engine: { netBytes: number; oldNetMb: number; jqeNetBytes: number; speedup: number };
  review: {
    k: number;
    kPositions: number;
    cpAt75: number;
    oldCpAt75: number;
    baselined: number;
    openingBudgetSecs: number;
  };
  games: MatchGame[];
  disagree: {
    contestedCp: number;
    costCp: number;
    glanceMs: number;
    searchMs: number;
    searchThreads: number;
    agreeOnAbj: number;
    agreeOnJqe: number;
    movesSearched: number;
    abj: DisagreeSide;
    jqe: DisagreeSide;
  };
  calibration: { lo: number; hi: number; fromMove: number; toMove: number; abj: { n: number; scorePct: number }; jqe: { n: number; scorePct: number } };
  openings: Record<'abj' | 'jqe', { move: string; count: number; of: number }>;
  /** Who saw each decisive game's result first: the move from which each engine's own scores
   *  give the eventual winner at least 70% to the end (seenFrom), compared per game. */
  seenLate: Record<
    'abWon' | 'jqeWon',
    { games: number; jqeLater: number; same: number; abjLater: number; withinOne: number }
  >;
  darkCaptures: Record<
    'abj' | 'jqe',
    {
      captures: number;
      contested: number;
      meanPts: number;
      se: number;
      /** By how the game ended for the capturer. */
      byResult: Record<DarkResult, { games: number; captures: number }>;
    }
  > & {
    gapPts: number;
    gapSe: number;
    gapZ: number;
  };
};

const M = AB_JQE_MATCH;
const T = M.total;
const AB_REPO = 'https://github.com/lxsgx23/AB-JChess';
const AB_ISSUE = 'https://github.com/lxsgx23/AB-JChess/issues/1';
const JQE_REPO = 'https://github.com/devinokeefe/jieqi';

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);
const commas = (n: number): string => n.toLocaleString('en-US');
const mb = (bytes: number): string => (bytes / 1e6).toFixed(1);
/** A score in centipawns, as a winning chance on the review's curve for this release. */
export const chance = (cp: number): number => Math.round(100 / (1 + Math.exp(-M.review.k * cp)));

function game(key: string): MatchGame {
  const g = M.games.find((x) => x.key === key);
  if (!g) throw new Error(`ab-jchess-vs-jqe: ${key} is not in the match data`);
  return g;
}

const NAME = (engine: string): string => (engine === 'jqe' ? 'jqe' : 'AB-JChess');

/** "f9 to f6" from "f9f6". */
const to = (move: string): string => move.replace(/^([a-i]\d+)([a-i]\d+)$/, '$1 to $2');
/** Both engines' 4 s chances for the side to move, for the played move and the other. */
function chances(g: MatchGame) {
  const d = g.dispute;
  return {
    abj: chance(d.abj.played),
    jqe: chance(d.jqe.played),
    abjAlt: chance(d.abj.alt),
    jqeAlt: chance(d.jqe.alt),
  };
}

/** The four games as one study (scripts/variant-lab/ab-jchess-vs-jqe-study.ts),
 *  a chapter per game in AB_JQE_GAMES order. */
export const AB_JQE_STUDY = {
  id: 'Ihhq4c7y',
  chapters: {
    'run2:30': 'RnAHpfED',
    'run2:198': 'eA2ecIDI',
    'run2:115': 'FbcXtVHI',
    'run1:293': 'roZ5su2m',
  } as Record<string, string>,
} as const;

/** A game's study chapter, opened on the position before its disputed move,
 *  where the study draws both engines' picks as arrows. */
function replay(key: string, caption: string): ArticleBlock {
  const g = game(key);
  const chapter = AB_JQE_STUDY.chapters[key];
  if (!chapter) throw new Error(`ab-jchess-vs-jqe: no study chapter for ${key}`);
  return {
    kind: 'embed',
    path: `/embed/study/${AB_JQE_STUDY.id}/${chapter}?ply=${g.dispute.ply - 1}`,
    title: `${NAME(g.red)} vs ${NAME(g.black)}, move ${g.dispute.move}`,
    caption,
    // A placeholder until the card reports its height: the 702px column's card
    // plus the ~98px win-chance graph under it (study_chapters.score_series).
    aspect: [702, 878],
  };
}

// The four games, in the order the post shows them. Each opens on a move the two
// engines disagree about; the test checks each caption against the moves and scores.
export type DarkResult = 'won' | 'drawn' | 'lost';
export const AB_JQE_GAMES = ['run2:30', 'run2:198', 'run2:115', 'run1:293'] as const;
const [G1, G2, G3, G4] = AB_JQE_GAMES.map(game);
const [C1, C2, C3, C4] = [G1, G2, G3, G4].map(chances);
const D = M.disagree;
const CAL = M.calibration;
const OPEN = M.openings;
const DARK = M.darkCaptures;
const LATE = M.seenLate;
/** Face-down captures a game, to one decimal, in the games that ended this way for the capturer. */
export function darkPerGame(engine: 'abj' | 'jqe', result: DarkResult): string {
  const r = DARK[engine].byResult[result];
  return (r.captures / r.games).toFixed(1);
}
/**
 * The move from which an engine's chance for the eventual winner stays at 70% or
 * more to the end. Position p is scored before ply p + 1, which is move floor(p / 2) + 1.
 */
export function seenFrom(g: MatchGame, s: readonly number[]): number {
  const w = (x: number) => (g.abWon ? x : 1 - x);
  let p = s.length - 1;
  while (p > 0 && w(s[p - 1]!) >= 0.7) p--;
  return Math.floor(p / 2) + 1;
}
const SEEN3 = { abj: seenFrom(G3, G3.series.abj), jqe: seenFrom(G3, G3.series.jqe) };
/** The critic's own chance (its next move's score in the game), as its own side. */
const own = (g: MatchGame, i: number): number => chance(g.dispute.criticOwn[i]!);
/**
 * The judge (AB-JChess at 15 s after the match, scripts/variant-lab/ab-jchess-vs-jqe-judge.jsonl,
 * whose squares count ranks from 0): in game 1 its pick before the disputed move, and in
 * game 3 the soldier push that turned the game, with Red's score before and after it.
 */
export const AB_JQE_JUDGE = {
  game1Best: 'f9c9',
  game3Turn: { ply: 163, move: 82, played: 'd5d6', redBefore: 0, redAfter: -463 },
} as const;
const TURN3 = AB_JQE_JUDGE.game3Turn;

const pct = (r: Wdl): string =>
  `${Math.round((100 * (r.wins + r.draws / 2)) / (r.wins + r.draws + r.losses))}%`;
const wdlRow = (label: string, r: Wdl): string[] => [label, `${r.wins}-${r.draws}-${r.losses}`, pct(r)];

export const abJchessVsJqeArticle: Article = {
  slug: 'ab-jchess-vs-jqe',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess is the top jieqi bot again',
  summary: `A new release of AB-JChess, built on jqe's open-source code, beat jqe over ${T.games} games and is the top jieqi bot on Mistboard again. Where the two engines disagree about a move, who turned out right, and four games that show it.`,
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-02',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/ab-jchess-vs-jqe/thumbnail.png',
    alt: 'A card reading AB-JChess, the top jieqi bot again',
  },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bots on Mistboard, and engine authors.',
  readNext: ['jqe', 'ab-jchess', 'jieqi-platform'],
  tldr: [
    `AB-JChess is the top jieqi bot on Mistboard again. Its new release, AB-JChess-20261031, beat jqe over ${T.games} games: it won ${T.wins}, drew ${T.draws} and lost ${T.losses}, about ${T.pentaElo} Elo.`,
    `The new release is built on jqe's open-source code, with a network of ${mb(M.engine.netBytes)} MB where the last one's was ${M.engine.oldNetMb} MB. It searches about ${M.engine.speedup} times as many positions a second as before.`,
    `Most of its edge came with Red: it won ${M.asRed.wins} and lost ${M.asRed.losses} as Red, and won ${M.asBlack.wins} and lost ${M.asBlack.losses} as Black.`,
  ],
  intro: [
    {
      kind: 'paragraph',
      text: `[AB-JChess](/blog/ab-jchess) is the top [jieqi](/rules/jieqi) bot on Mistboard again. A new release by Huorongrong and Laoxu (Kouza), AB-JChess-20261031, beat [jqe](/blog/jqe), the bot that took the title from it in October, over ${T.games} games: it won ${T.wins}, drew ${T.draws} and lost ${T.losses}, about ${T.pentaElo} Elo. You can [play it](/bot/ab-jchess) now; jqe stays on the ladder one level below.`,
    },
    {
      kind: 'note',
      label: 'As of November 2, 2026',
      text: 'AB-JChess-20261031 against jqe 0.1.0. Both engines are still being developed, so a later release of either may score differently.',
    },
  ],
  sections: [
    {
      heading: 'The result',
      blocks: [
        {
          kind: 'paragraph',
          text: `The ${T.games} games were ${T.pairs} deals, each played twice with colours swapped. AB-JChess won both games of a deal ${T.pairPoints['2']} times, and jqe did that ${T.pairPoints['0']} times. Every draw was a repetition.`,
        },
        {
          kind: 'table',
          caption:
            "AB-JChess-20261031 against jqe 0.1.0, counted from AB-JChess's side. The score counts a draw as half a win.",
          headers: ['AB-JChess', 'Won-drawn-lost', 'Score'],
          rows: [
            wdlRow(`All ${T.games} games`, T),
            wdlRow('With Red', M.asRed),
            wdlRow('With Black', M.asBlack),
          ],
          highlightRows: [0],
          keyColumn: true,
          wrap: true,
        },
        {
          kind: 'paragraph',
          text: `With Black, AB-JChess and jqe were close to even. With Red, AB-JChess won ${M.asRed.wins} and lost ${M.asRed.losses}, and that is where the match was decided. Over all ${T.games} games that is about ${signed(T.pentaElo)} Elo, and the 95% range is ${signed(T.pentaLow)} to ${signed(T.pentaHigh)}, counted over pairs of games on the same deal. The first ${M.runs.run1.pairs} deals gave ${signed(M.runs.run1.pentaElo)} and the second ${M.runs.run2.pairs} gave ${signed(M.runs.run2.pentaElo)}.`,
        },
      ],
    },
    {
      heading: 'Where the two engines disagree',
      blocks: [
        {
          kind: 'paragraph',
          text: "The two engines often want different moves. Where they still disagreed after a longer look, AB-JChess's choices held up better than jqe's.",
        },
        {
          kind: 'paragraph',
          text: `We had both engines look at every position from the ${T.games} games for half a second and name the move they would play, ${commas(D.movesSearched)} moves in all. jqe picked AB-JChess's move ${D.agreeOnAbj}% of the time, and AB-JChess picked jqe's move ${D.agreeOnJqe}% of the time.`,
        },
        {
          kind: 'paragraph',
          text: `Then we kept the moves where the other engine thought the move played was a mistake: at least ${D.costCp} centipawns worse than its own choice, in a game it still called close, and not a move that turned a piece over, so the choice did not hang on what a piece would turn out to be. That left ${D.abj.disputed} of AB-JChess's moves and ${D.jqe.disputed} of jqe's. We gave both engines ${D.searchMs / 1000} seconds on each of them.`,
        },
        {
          kind: 'table',
          caption: `Moves the other engine called a mistake at a glance, after both engines searched each one for ${D.searchMs / 1000} seconds.`,
          headers: ['', "AB-JChess's moves", "jqe's moves"],
          rows: [
            ['Called a mistake at a glance', String(D.abj.disputed), String(D.jqe.disputed)],
            ['The critic came round', String(D.abj.criticCameRound), String(D.jqe.criticCameRound)],
            ['The engine that played it changed its mind', String(D.abj.moverSwitched), String(D.jqe.moverSwitched)],
            ['Still disputed', String(D.abj.bothKept), String(D.jqe.bothKept)],
          ],
          highlightRows: [3],
          wrap: true,
        },
        {
          kind: 'paragraph',
          text: `Given time, jqe came round on half the AB-JChess moves it had called mistakes, and AB-JChess on fewer than half of jqe's. AB-JChess's ${D.abj.bothKept} still-disputed moves came in ${D.abj.bothKeptGames} games, and AB-JChess won ${D.abj.bothKeptGamesWon} of those games and lost ${D.abj.bothKeptGamesLost}. jqe's ${D.jqe.bothKept} came in ${D.jqe.bothKeptGames} games, and jqe won ${D.jqe.bothKeptGamesWon} and lost ${D.jqe.bothKeptGamesLost}. The numbers are small, but they lean the same way as the match.`,
        },
        {
          kind: 'paragraph',
          text: "Each game below opens just before one of the disputed moves. The blue arrow is AB-JChess's pick and the orange arrow is jqe's. Step on to the move to see the other engine's line beside it, with both engines' chances. The graph under each board is AB-JChess's chance to win, move by move, as each engine scored it during the game; tap it to jump to that move.",
        },
        {
          kind: 'paragraph',
          text: 'The marks on moves come from the stronger engine: after the match, AB-JChess searched every position for 15 seconds, and the green line beside a marked move is the move it preferred. A move is marked only when it costs the mover 5 points or more of its chance to win, so most moves carry none. A face-down piece taken before it turned over stays face-down here, as it would for anyone watching on Mistboard; in the match, both engines were told what it was.',
        },
        { kind: 'sub-heading', text: 'AB-JChess sees a chariot check coming' },
        replay(
          G1.key,
          `AB-JChess has Red and plays its chariot from ${to(G1.dispute.played)} on move ${G1.dispute.move}. jqe wanted ${to(G1.dispute.alt)}. In both engines' lines after ${G1.dispute.alt.slice(2)}, Black's chariot checks from i2, drives Red's general to f1 and takes the soldier on e3, and AB-JChess drops Red from ${C1.abj}% to ${C1.abjAlt}%. After ${G1.dispute.played.slice(2)}, Black's chariot goes to d1 instead, in the game and in both lines. Given ${D.searchMs / 1000} seconds, jqe scores the two moves the same, ${C1.jqe}%. Searching for 15 seconds after the match, AB-JChess itself prefers a third move, the chariot to ${AB_JQE_JUDGE.game1Best.slice(2)}. AB-JChess mates on move ${G1.moveCount}.`,
        ),
        { kind: 'sub-heading', text: `AB-JChess gives Red ${C2.abj}%, jqe gives it ${C2.jqe}%` },
        replay(
          G2.key,
          `AB-JChess has Red. On move ${G2.dispute.move} it plays its elephant from ${to(G2.dispute.played)}, where jqe wanted the advisor from ${to(G2.dispute.alt)}. The bigger difference is how each engine reads the position: after the elephant move AB-JChess gives Red ${C2.abj}% and jqe gives it ${C2.jqe}%. Red wins: AB-JChess mates on move ${G2.moveCount}.`,
        ),
        { kind: 'sub-heading', text: `jqe comes round, then loses on move ${TURN3.move}` },
        replay(
          G3.key,
          `jqe has Red. On move ${G3.dispute.move} AB-JChess pushes a soldier, ${to(G3.dispute.played)}. At a glance jqe wanted the chariot ${to(G3.dispute.alt)} instead. Given ${D.searchMs / 1000} seconds it agrees with AB-JChess's move and still gives Red ${chance(-G3.dispute.jqe.played)}%. The game stays close for another ${TURN3.move - G3.dispute.move} moves. On move ${TURN3.move} jqe pushes a soldier, ${to(TURN3.played)}, marked ??: searching afterwards, AB-JChess gives Red ${chance(TURN3.redBefore)}% before it and ${chance(TURN3.redAfter)}% after. AB-JChess's own chance for Black passes 70% on that move and stays there; jqe's does on move ${SEEN3.jqe}. AB-JChess mates on move ${G3.moveCount}.`,
        ),
        { kind: 'sub-heading', text: 'A dispute AB-JChess lost' },
        replay(
          G4.key,
          `jqe has Red and plays its cannon from ${to(G4.dispute.played)} on move ${G4.dispute.move}. AB-JChess wanted the chariot from ${to(G4.dispute.alt)}, and still did with ${D.searchMs / 1000} seconds: ${C4.abjAlt}% for Red against ${C4.abj}%. jqe scored its own move ${C4.jqe}%. AB-JChess's general steps to f10 at once, its own score slips from ${own(G4, 0)}% to ${own(G4, 1)}% over its next two moves, and jqe mates on move ${G4.moveCount}.`,
        ),
      ],
    },
    {
      heading: 'How their play differs',
      blocks: [
        {
          kind: 'paragraph',
          text: `Both engines open the same way. With Red, both nearly always start by moving the face-down piece on ${OPEN.abj.move.slice(0, 2)} forward: AB-JChess in ${OPEN.abj.count} of its ${OPEN.abj.of} Red games, jqe in ${OPEN.jqe.count} of ${OPEN.jqe.of}.`,
        },
        { kind: 'sub-heading', text: 'jqe overrates a small edge' },
        {
          kind: 'paragraph',
          text: `jqe thinks it is doing better than it is. On moves ${CAL.fromMove} to ${CAL.toMove}, when jqe scored its own position between ${signed(CAL.lo)} and ${signed(CAL.hi)} centipawns, a small edge, it went on to score ${CAL.jqe.scorePct}% in those games. AB-JChess, at the same scores, went on to score ${CAL.abj.scorePct}%.`,
        },
        {
          kind: 'paragraph',
          text: `It is also slow to see a loss coming, though not by much. Take the move from which an engine's own scores keep the eventual winner above 70% for the rest of the game. In ${LATE.abWon.games} of AB-JChess's wins, jqe got there later than AB-JChess in ${LATE.abWon.jqeLater} games and earlier in ${LATE.abWon.abjLater}. In jqe's ${LATE.jqeWon.games} wins, AB-JChess got there later in ${LATE.jqeWon.abjLater} and earlier in ${LATE.jqeWon.jqeLater}, about even. In ${Math.round((100 * LATE.abWon.withinOne) / LATE.abWon.games)}% of AB-JChess's wins the two were within a move of each other; the ${SEEN3.jqe - SEEN3.abj} moves in the game jqe lost on move ${TURN3.move} are the far end.`,
        },
        { kind: 'sub-heading', text: 'jqe takes more face-down pieces, win or lose' },
        {
          kind: 'paragraph',
          text: `jqe took ${DARK.jqe.captures.toLocaleString('en-US')} face-down pieces to AB-JChess's ${DARK.abj.captures}. Both engines take more in the games they win, so we split the count by result. In the games each engine won, jqe took ${darkPerGame('jqe', 'won')} a game and AB-JChess ${darkPerGame('abj', 'won')}; in draws, ${darkPerGame('jqe', 'drawn')} and ${darkPerGame('abj', 'drawn')}; in the games each lost, ${darkPerGame('jqe', 'lost')} and ${darkPerGame('abj', 'lost')}.`,
        },
        {
          kind: 'paragraph',
          text: `jqe does not seem to misjudge them. In close positions, its own winning chance one move after taking one fell by ${Math.abs(DARK.jqe.meanPts)} points on average, and AB-JChess's by ${Math.abs(DARK.abj.meanPts)}, a gap too small to tell apart from chance.`,
        },
      ],
    },
    {
      heading: 'How the match was played',
      blocks: [
        {
          kind: 'paragraph',
          text: `Each engine had ${M.movetimeMs / 1000} seconds a move on ${M.threads} threads. Our referee draws any threefold repetition and any 60 moves without a capture, the same rules as in [jqe's match against the last AB-JChess](/blog/jqe). When a face-down piece was taken, the referee told both engines what it was. On Mistboard only the player who took it finds out.`,
        },
      ],
    },
    {
      heading: 'What changed in AB-JChess',
      blocks: [
        {
          kind: 'paragraph',
          text: `The new release is rebuilt on [jqe's code](${JQE_REPO}), which Devin O'Keefe published under the MIT licence, with a network of its own. That network is ${mb(M.engine.netBytes)} MB. The last release's was ${M.engine.oldNetMb} MB, and jqe's is ${mb(M.engine.jqeNetBytes)} MB. A small network is quick to run, so the new release looks at about ${M.engine.speedup} times as many positions a second as the last one, a little more than jqe.`,
        },
        {
          kind: 'paragraph',
          text: `On [the AB-JChess issue tracker](${AB_ISSUE}), Laoxu (Kouza) wrote that they tried four ways of searching a reveal and kept a plain weighted average over what the piece could be; the other three came out 10 to 90 Elo weaker. They also trained a much larger network, which played weaker than the small one, and plan to use it to teach the small one.`,
        },
      ],
    },
    {
      heading: 'Game review',
      blocks: [
        {
          kind: 'paragraph',
          text: `Game review for jieqi runs on AB-JChess, so it moves to the new release too. The new release names only its best move, where the old one listed several, so review now scores every legal move itself, then checks the best ${M.review.baselined} and the move you played more carefully. Grading a reveal near the start of a game takes up to about ${Math.round(M.review.openingBudgetSecs)} seconds.`,
        },
        {
          kind: 'paragraph',
          text: `Its scores also mean something different. On the new release, ${signed(M.review.cpAt75)} is a 75% chance to win, where the old one reached 75% at ${signed(M.review.oldCpAt75)}, so review turns scores into winning chances on a new curve, fitted on ${commas(M.review.kPositions)} positions from this match. Reviews made with the old release keep the old curve.`,
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `AB-JChess is open source under the GPL-3.0 licence at [github.com/lxsgx23/AB-JChess](${AB_REPO}). The network is downloaded from the authors' own release each time we build the site, never re-hosted. Thank you, Huorongrong and Laoxu, and thank you, Devin O'Keefe, for the code the new release stands on.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
            { label: 'Play jqe', href: '/bot/jqe', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
