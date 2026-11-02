import type { JieqiDeal } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';
import matchJson from './ab-jchess-vs-jqe-match.json' with { type: 'json' };

// DRAFT for Brian's read. AB-JChess-20261031 took the jieqi title back from jqe
// (2026-10-31); this post goes live with the 11-02 release that makes it the top
// bot. A player post (Brian, 2026-10-31: it goes on the homepage), so the result
// and the games lead and the review change is a short plain section near the end.
//
// Every number in the prose is read from ab-jchess-vs-jqe-match.json, and
// ab-jchess-vs-jqe.test.ts recomputes the record and replays the five games.
//
// Sources:
// - mistboard-engine lab/jieqi-match/jqe-vs-abj-20261031/run{1,2}-4s-4thr.jsonl:
//   600 games, 300 colour-swapped deals (seeds 50000-50149 and 51000-51149), 4 s a
//   move, 4 threads, A = AB-JChess-20261031 (efc83867, net 20261030), B = jqe
//   331a6e61 (net it014). Totals, Elo (trinomial and pentanomial, as summarize.py),
//   the colour split, the deal sweeps and the games were recomputed from the
//   files (scratchpad abj_match.py, 2026-10-31); every deal rebuilt from its seed
//   matched the game's final position in 600 of 600 games.
// - The five games' deals are their PUBLIC deals (jieqiPublicDeal): a piece captured
//   face-down stays unknown, and the prose never names what one was.
// - Where they disagree (scratchpad aws662, 2026-10-31, AWS): cross_eval.py had each
//   engine name its move for every position of the 600 games at 500 ms on 2 threads;
//   disagree.py kept the moves the other engine scored at least 100 cp below its own
//   choice, in a game that engine still called within 300 cp, where the played move
//   did not turn a piece over (173); why4.py searched the played move and the critic's
//   choice with both engines for 4 s on 4 threads. Calibration and first moves are from
//   the match records. All of it is in the data file under disagree, calibration and
//   openings.
// - The five games read by both engines (scratchpad deep/, 2026-11-02): every position
//   of each game searched by both engines for 22 million nodes on 2 threads (about a
//   match move's nodes; deep_pos.py, on one AWS c7i.16xlarge spot box and the local
//   Mac), each position on its own with no move history. moments.py found the loser's
//   moves the winner's engine scored at least 5 points of chance worse than its own
//   pick, with neither move turning a piece over; to_match.py wrote each game's series
//   and its marked moment into the data file under deep. The draw's in-game score
//   (abjTopScoreFromPly) is from the match log: AB-JChess reported +20000, its top
//   score, on every move from that ply to the end.
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

/** The loser's move the post marks: the winner engine's pick instead, and the loser's
 *  chance (0-1) after each by both engines; how many of its own moves it took the loser's
 *  number to come within 5 points of the winner's, and the position it did (null: never). */
type Moment = {
  /** Plies played before the move: the position the board opens on. */
  ply: number;
  move: number;
  played: string;
  pick: string;
  winner: { played: number; pick: number };
  loser: { played: number; pick: number };
  caughtPly: number | null;
  lagMoves: number | null;
  revealsBeforeCaught: number[];
  revealSwings: unknown[];
  pickTurnsOver: boolean;
  playedTurnsOver: boolean;
};
type Gap = {
  fromPly: number;
  toPly: number;
  fromMove: number;
  toMove: number;
  /** Moves in the window, both sides; those the other engine would also have picked. */
  moves: number;
  agree: number;
  /** The most a differing move cost, by the other engine's count (0-1). */
  maxCost: number;
  range: Record<'abj' | 'jqe', [number, number]>;
  /** The first position after the window where the loser's own number comes within
   *  5 points of the winner's, the move that led to it, and the loser's number either side. */
  snapPly: number;
  snapMove: number;
  snapBy: 'abj' | 'jqe';
  snapPlayed: string;
  snapFrom: number;
  snapTo: number;
  revealsInWindow: number[];
};
type MatchGame = {
  key: string;
  seed: number;
  red: string;
  black: string;
  winner: 'red' | 'black' | 'draw';
  abWon: boolean;
  plies: number;
  moveCount: number;
  moves: string;
  deal: JieqiDeal;
  /** Both engines' 22M-node reads of every position, as the loser's chance (the drawn
   *  game: the side that got into trouble), index p = after p plies; the last is the result. */
  deep: {
    nodes: number;
    loser: 'abj' | 'jqe';
    side: 'red' | 'black';
    series: Record<'abj' | 'jqe', number[]>;
    moments: Moment[];
    /** An evaluation gap (game 1 only): a stretch of moves where the two engines mostly
     *  pick the same moves but score the loser's chances far apart. */
    gap?: Gap;
  };
  /** The drawn game only: the ply from which AB-JChess's own in-game score was its top score. */
  abjTopScoreFromPly?: number;
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
    prodNps: number;
    oldProdNps: number;
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
  /** Red's first move and Black's reply, counted by which engine had Red (top five, then the rest). */
  openingLines: {
    lines: { red: string; black: string; abj: number; jqe: number }[];
    other: { abj: number; jqe: number };
    of: { abj: number; jqe: number };
  };
  /** In the games that opened a4-a5: what Red turned up, Black's replies and Red's score; then,
   *  after a4-a5 i7-i6, what Black turned up; and each engine's replies, as Black, to a chariot. */
  firstFlip: {
    of: number;
    red: { piece: string; games: number; redScorePct: number; replies: { move: string; games: number }[] }[];
    afterI7I6: { of: number; black: { piece: string; games: number; redScorePct: number }[] };
    chariotReplies: Record<'abj' | 'jqe', { move: string; games: number }[]>;
  };
  /** Each engine re-searching its own match moves (10 deals, 20 games, ply 10 on) with twice a
   *  match move's nodes: how often it would change the move and what the change is worth. */
  doubleTime: {
    source: string;
    games: number;
    nodesPerMatchMove: Record<'abj' | 'jqe', number>;
  } & Record<'abj' | 'jqe', { moves: number; changedPct: number; meanGainPts: number; gain5Plus: number; medianDepth: number }>;
  /** Who saw each decisive game's result first: the move from which each engine's own scores
   *  give the eventual winner at least 70% to the end, compared per game. */
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
/** The five games as one study (scripts/variant-lab/ab-jchess-vs-jqe-study.ts),
 *  a chapter per game in AB_JQE_GAMES order. */
export const AB_JQE_STUDY = {
  id: 'Ihhq4c7y',
  chapters: {
    'run2:198': 'eA2ecIDI',
    'run2:115': 'FbcXtVHI',
    'run1:293': 'roZ5su2m',
    // PLACEHOLDER: the local id; prod assigns its own when the study plan is applied.
    'run2:96': 'Evbbw71z',
    'run1:194': 'RnAHpfED',
  } as Record<string, string>,
} as const;

/** The game's marked moment (each game shows one). */
export const momentOf = (g: MatchGame): Moment => g.deep.moments[0]!;

/** A game's study chapter, opened on the position before the marked move, where the
 *  study draws the move played and the winner engine's pick as arrows. */
function replay(key: string, caption: string): ArticleBlock {
  const g = game(key);
  const m = momentOf(g);
  const chapter = AB_JQE_STUDY.chapters[key];
  if (!chapter) throw new Error(`ab-jchess-vs-jqe: no study chapter for ${key}`);
  return {
    kind: 'embed',
    path: `/embed/study/${AB_JQE_STUDY.id}/${chapter}?ply=${m.ply}`,
    title: `${NAME(g.red)} vs ${NAME(g.black)}, move ${m.move}`,
    caption,
    // A placeholder until the card reports its height: the 702px column's card
    // plus the 140px win-chance graph under it (study_chapters.score_series).
    aspect: [702, 926],
  };
}

// The five games, in the order the post shows them: AB-JChess's wins, jqe's win, the
// draw, and a game where jqe caught up at once. The test checks each caption against the
// moves and the scores.
export type DarkResult = 'won' | 'drawn' | 'lost';
export const AB_JQE_GAMES = ['run2:198', 'run2:115', 'run1:293', 'run2:96', 'run1:194'] as const;
const [G1, G2, G3, G4, G5] = AB_JQE_GAMES.map(game) as [MatchGame, MatchGame, MatchGame, MatchGame, MatchGame];
const P = (x: number): number => Math.round(100 * x);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const later = (n: number): string => `${WORDS[n] ?? n} move${n === 1 ? '' : 's'} later`;
/** Both engines' chances for the loser at the marked moment, the winner's engine first. */
function numbers(g: MatchGame): string {
  const m = momentOf(g);
  const side = cap(g.deep.side);
  const winner = NAME(g.deep.loser === 'jqe' ? 'abj' : 'jqe');
  return `By ${winner}, the pick leaves ${side} ${P(m.winner.pick)}% and the move played ${P(m.winner.played)}%. By ${NAME(g.deep.loser)} itself, ${P(m.loser.pick)}% and ${P(m.loser.played)}%.`;
}
/** When the loser's own number came down to the winner's. */
function caught(g: MatchGame): string {
  const m = momentOf(g);
  const winner = NAME(g.deep.loser === 'jqe' ? 'abj' : 'jqe');
  if (m.caughtPly === null || m.lagMoves === null) throw new Error(`ab-jchess-vs-jqe: ${g.key} never caught up`);
  return `${NAME(g.deep.loser)}'s own number comes down to ${winner}'s ${later(m.lagMoves)}, on move ${Math.floor(m.caughtPly / 2) + 1}.`;
}
/** The drawn game's range of each engine's number for the side in trouble, after the moment. */
const after = (g: MatchGame, e: 'abj' | 'jqe') => g.deep.series[e].slice(momentOf(g).ply, -1);
const M1 = [G1, G2, G3, G4, G5].map(momentOf) as [Moment, Moment, Moment, Moment, Moment];
const GAP = (() => {
  const g = G1.deep.gap;
  if (!g) throw new Error(`ab-jchess-vs-jqe: ${G1.key} has no evaluation gap`);
  return g;
})();
const CAL = M.calibration;
const OPEN = M.openings;
const DARK = M.darkCaptures;
const LATE = M.seenLate;
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const TWICE = M.doubleTime;
const millions = (n: number): number => Math.round(n / 1e6);
/** Face-down captures a game, to one decimal, in the games that ended this way for the capturer. */
export function darkPerGame(engine: 'abj' | 'jqe', result: DarkResult): string {
  const r = DARK[engine].byResult[result];
  return (r.captures / r.games).toFixed(1);
}
const pct = (r: Wdl): string =>
  `${Math.round((100 * (r.wins + r.draws / 2)) / (r.wins + r.draws + r.losses))}%`;
const wdlRow = (label: string, r: Wdl): string[] => [label, `${r.wins}-${r.draws}-${r.losses}`, pct(r)];

export const abJchessVsJqeArticle: Article = {
  slug: 'ab-jchess-vs-jqe',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess takes the jieqi title back from jqe',
  cardTitle: 'AB-JChess retakes the jieqi title',
  summary: `A new release of AB-JChess, built on jqe's open-source code, beat jqe over ${T.games} games and is the top jieqi bot on Mistboard again. Five games read by both engines, and how their play differs.`,
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
      text: `AB-JChess is the top [jieqi](/rules/jieqi) bot on Mistboard again. Its new release by Huorongrong and Laoxu (Kouza), AB-JChess-20261031, beat jqe, which took the title from it in October, over ${T.games} games. jqe stays on the ladder one level below.`,
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
          text: `The ${T.games} games were ${T.pairs} deals, each played twice with colours swapped, at ${M.movetimeMs / 1000} seconds a move on ${M.threads} threads. As in jqe's match against the last AB-JChess, our referee drew any threefold repetition and any 60 moves without a capture. When a face-down piece was taken, it told both engines what it was; on Mistboard only the player who took it finds out.`,
        },
        {
          kind: 'table',
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
          text: `Almost all of AB-JChess's edge came with Red. Over the match it comes to about ${signed(T.pentaElo)} Elo, with a 95% range of ${signed(T.pentaLow)} to ${signed(T.pentaHigh)}.`,
        },
      ],
    },
    {
      heading: 'Five games, read by both engines',
      blocks: [
        { kind: 'sub-heading', text: 'How to read these games' },
        {
          kind: 'paragraph',
          text: `After the match, both engines searched every position of five games again, ${millions(G1.deep.nodes)} million positions each, about what a move got in the match. Each game is told from the side that lost it, and the draw from the side that got into trouble. The graph under the board is that side's chance by each engine, AB-JChess in teal and jqe in orange. Tap it to jump to a move.`,
        },
        {
          kind: 'paragraph',
          text: `Each board opens on a move where the winner's engine wanted something else. Both moves are drawn, blue for AB-JChess and orange for jqe, and the one not played is a side line. Then count the moves until the loser's own number comes down to where the winner had it. We picked moves where neither choice turned a piece over, so the gap is judgement, not the luck of a reveal. A piece taken face-down stays face-down, as it does for anyone watching on Mistboard. [The study](/study/${AB_JQE_STUDY.id}) has all five games to step through.`,
        },
        { kind: 'sub-heading', text: 'The engines agree on the moves and not on the score' },
        replay(
          G1.key,
          `AB-JChess has Red. From move ${GAP.fromMove} to move ${GAP.toMove}, the two engines would have picked the same move ${GAP.agree} times out of ${GAP.moves}, and no other choice cost more than ${P(GAP.maxCost)} points by the other engine's count. Nothing is turned over. They disagree on the score: AB-JChess gives Black ${P(GAP.range.abj[0])}% to ${P(GAP.range.abj[1])}%, jqe gives itself ${P(GAP.range.jqe[0])}% to ${P(GAP.range.jqe[1])}%. The board opens on move ${M1[0].move}, the widest of those choices: jqe moves its chariot ${to(M1[0].played)}, where AB-JChess would have moved the advisor ${to(M1[0].pick)}. When AB-JChess answers ${to(GAP.snapPlayed)} on move ${GAP.snapMove}, jqe's own number falls from ${P(GAP.snapFrom)}% to ${P(GAP.snapTo)}%. AB-JChess mates on move ${G1.moveCount}.`,
        ),
        {
          kind: 'paragraph',
          text: `A gap that wide does not cost a move while the engines agree on what to play. It decides the first position where they don't, because each picks by its own number.`,
        },
        { kind: 'sub-heading', text: `jqe pushes a soldier and sees the cost ${later(M1[1].lagMoves!)}` },
        replay(
          G2.key,
          `jqe has Red. On move ${M1[1].move} jqe pushes its soldier ${to(M1[1].played)}; AB-JChess would have moved the horse ${to(M1[1].pick)} and kept the game level. ${numbers(G2)} ${caught(G2)} AB-JChess mates on move ${G2.moveCount}.`,
        ),
        { kind: 'sub-heading', text: `AB-JChess turns down a soldier and sees the cost ${later(M1[2].lagMoves!)}` },
        replay(
          G3.key,
          `jqe has Red and wins this one. On move ${M1[2].move} AB-JChess steps its general ${to(M1[2].played)}; jqe would have taken the soldier on ${M1[2].pick.slice(2)} with the chariot from ${M1[2].pick.slice(0, 2)}. ${numbers(G3)} ${caught(G3)} jqe mates on move ${G3.moveCount}.`,
        ),
        { kind: 'sub-heading', text: 'AB-JChess scores the game as won and draws it by repetition' },
        replay(
          G4.key,
          `AB-JChess has Red. On move ${M1[3].move} jqe steps its general ${to(M1[3].played)}; AB-JChess would have pushed the soldier ${to(M1[3].pick)}. ${numbers(G4)} After that, jqe's own number stays between ${P(Math.min(...after(G4, 'jqe')))}% and ${P(Math.max(...after(G4, 'jqe')))}% to the end, while AB-JChess's falls to ${P(Math.min(...after(G4, 'abj')))}%. From move ${Math.floor(G4.abjTopScoreFromPly! / 2) + 1} AB-JChess scores the game as won for Red, yet its soldier goes back and forth between e8 and f8, jqe's cannon answers between d4 and e4, and the position comes up a third time on move ${G4.moveCount}.`,
        ),
        {
          kind: 'note',
          label: 'Repetition not counted',
          text: `The graphs come from searching each position on its own, without the moves that led to it, so neither engine's number can see a repetition coming. In this game the repetition decided the result.`,
        },
        { kind: 'sub-heading', text: `jqe moves its chariot and sees the cost ${later(M1[4].lagMoves!)}` },
        replay(
          G5.key,
          `AB-JChess has Red. On move ${M1[4].move} jqe moves its chariot ${to(M1[4].played)}; AB-JChess would have moved the advisor ${to(M1[4].pick)}, beside jqe's general. ${numbers(G5)} ${caught(G5)} AB-JChess mates on move ${G5.moveCount}.`,
        ),
        {
          kind: 'paragraph',
          text: `Lags of five to seven moves, as in four of these five games, are the long end. Across the match, counting the move from which each engine's own scores in the game gave the winner 70% for good, the two were within a move of each other in ${LATE.abWon.withinOne} of AB-JChess's ${LATE.abWon.games} wins. Where one was later, it was jqe in ${LATE.abWon.jqeLater} and AB-JChess in ${LATE.abWon.abjLater}. In jqe's ${LATE.jqeWon.games} wins each was later about as often, AB-JChess in ${LATE.jqeWon.abjLater} and jqe in ${LATE.jqeWon.jqeLater}.`,
        },
      ],
    },
    {
      heading: 'How their play differs',
      blocks: [
        { kind: 'sub-heading', text: 'jqe overrates a small edge' },
        {
          kind: 'paragraph',
          text: `When jqe scored its own position as a small edge, it won less often from there than AB-JChess did from the same score.`,
        },
        {
          kind: 'table',
          headers: [`Small edge (${signed(CAL.lo)} to ${signed(CAL.hi)}), moves ${CAL.fromMove} to ${CAL.toMove}`, 'jqe', 'AB-JChess'],
          rows: [
            ['Went on to score', `${CAL.jqe.scorePct}%`, `${CAL.abj.scorePct}%`],
            ['Positions', String(CAL.jqe.n), String(CAL.abj.n)],
          ],
          keyColumn: true,
        },
        { kind: 'sub-heading', text: 'jqe takes more face-down pieces, win or lose' },
        {
          kind: 'paragraph',
          text: 'Both take more in the games they win, so the table splits by result.',
        },
        {
          kind: 'table',
          headers: ['Face-down pieces taken a game', 'jqe', 'AB-JChess'],
          rows: (['won', 'drawn', 'lost'] as const).map((r) => [
            `In games it ${r === 'won' ? 'won' : r === 'drawn' ? 'drew' : 'lost'}`,
            darkPerGame('jqe', r),
            darkPerGame('abj', r),
          ]),
          keyColumn: true,
        },
        {
          kind: 'paragraph',
          text: `It costs jqe nothing we can measure. In close positions, its winning chance one move after a face-down capture fell ${Math.abs(DARK.jqe.meanPts)} points on average and AB-JChess's ${Math.abs(DARK.abj.meanPts)}, a gap smaller than the noise in the sample.`,
        },
      ],
    },
    {
      heading: 'A smaller network, a faster search',
      blocks: [
        {
          kind: 'paragraph',
          text: `The new release is rebuilt on [jqe's code](${JQE_REPO}), which Devin O'Keefe published under the MIT licence, with a network of its own. That network is ${mb(M.engine.netBytes)} MB, where the last release's was ${M.engine.oldNetMb} MB and jqe's is ${mb(M.engine.jqeNetBytes)} MB. A small network is quick to run, so the new release looks at about ${M.engine.speedup} times as many positions a second as the last one, a little more than jqe.`,
        },
        {
          kind: 'paragraph',
          text: `In 4 seconds each engine searches about ${millions(TWICE.nodesPerMatchMove.abj)} million positions. To see whether either was short of time, each one searched its own moves from ${TWICE.games} of the games again with twice that. AB-JChess would have changed its move ${TWICE.abj.changedPct}% of the time and jqe ${TWICE.jqe.changedPct}%, and the change was worth ${TWICE.abj.meanGainPts} points of winning chance a move to each. A change worth 5 points or more came up ${TWICE.abj.gain5Plus === 1 ? 'once' : `${TWICE.abj.gain5Plus} times`} in ${TWICE.abj.moves} moves for AB-JChess and ${TWICE.jqe.gain5Plus === 1 ? 'once' : `${TWICE.jqe.gain5Plus} times`} in ${TWICE.jqe.moves} for jqe. More time would help both a little and neither more than the other.`,
        },
      ],
    },
    {
      heading: 'Game review',
      blocks: [
        {
          kind: 'paragraph',
          text: `Game review for jieqi runs on AB-JChess, so new reviews use the new release. On our server it searches about ${Math.round(M.review.prodNps / M.review.oldProdNps)} times as many positions a second as the old one, so a review looks further in the same time.`,
        },
        {
          kind: 'paragraph',
          text: `Its numbers read differently too. The winning chances are fitted on ${commas(M.review.kPositions)} positions from this match, and a 75% chance now shows as +${(M.review.cpAt75 / 100).toFixed(1)}, where the old release showed +${(M.review.oldCpAt75 / 100).toFixed(1)} for the same chance. Reviews made before keep the old release's numbers, so compare an old review with a new one by winning chance, not by the number.`,
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
