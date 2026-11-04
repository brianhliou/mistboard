import type { JieqiDeal } from '@mistboard/game';
import type { Locale } from '../../i18n/locale.js';
import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';
import matchJson from './ab-jchess-vs-jqe-match.json' with { type: 'json' };

// DRAFT for Brian's read. AB-JChess-20261031 took the jieqi title back from jqe
// (2026-10-31). A player post (Brian, 2026-10-31: it goes on the homepage), so the
// result and the games lead and the review change is a short plain section near the end.
// The game set (2026-11-03, Brian: "Okay"): run2:115 leads, then run2:22, run1:8,
// run2:104 (jqe's win), run1:157 (the draw), and run1:54 for the chase rules.
//
// Every number in the prose is read from ab-jchess-vs-jqe-match.json, and
// ab-jchess-vs-jqe.test.ts recomputes the record and replays the six games.
//
// Sources:
// - mistboard-engine lab/jieqi-match/jqe-vs-abj-20261031/run{1,2}-4s-4thr.jsonl:
//   600 games, 300 colour-swapped deals (seeds 50000-50149 and 51000-51149), 4 s a
//   move, 4 threads, A = AB-JChess-20261031 (efc83867, net 20261030), B = jqe
//   331a6e61 (net it014). Totals, Elo (trinomial and pentanomial, as summarize.py),
//   the colour split, the deal sweeps and the games were recomputed from the
//   files (scratchpad abj_match.py, 2026-10-31); every deal rebuilt from its seed
//   matched the game's final position in 600 of 600 games. The match sent each
//   engine `position fen` alone (mistboard-engine src/fow_chess/jieqi/pikajieqi.py),
//   so neither engine knew the moves that led to a position.
// - The games' deals are their PUBLIC deals (jieqiPublicDeal): a piece captured
//   face-down stays unknown, and the prose never names what one was.
// - Where they disagree (scratchpad aws662, 2026-10-31, AWS): cross_eval.py had each
//   engine name its move for every position of the 600 games at 500 ms on 2 threads;
//   disagree.py kept the moves the other engine scored at least 100 cp below its own
//   choice, in a game that engine still called within 300 cp, where the played move
//   did not turn a piece over (173); why4.py searched the played move and the critic's
//   choice with both engines for 4 s on 4 threads. Calibration and first moves are from
//   the match records. All of it is in the data file under disagree, calibration and
//   openings.
// - Both engines on every position (mistboard-engine lab/jieqi-match/modal_align.py,
//   align/run{1,2}.jsonl): for every position of the 600 games, the mover's own score
//   from the match log and the other engine's search of the same redacted FEN at the
//   match's 4 s on 4 threads, no move history. article-analysis/deep/to_match_v2.py
//   wrote each game's series, both engines' choices and the marked moment (the loser's
//   move, the winner engine's pick, and how many of the loser's moves its number took
//   to come within 10 points) into the data file under `aligned`.
// - Game 1's check (`check`, followup/chase_g2.py): AB-JChess with ChaseRule none on
//   the position before the marked move, the push and the pick each at 22M, 88M and
//   352M nodes.
// - Each engine's line at the marked move (`aligned.moment.lines`, scratchpad
//   pv_moments.py, 2026-11-03): both engines on the position alone, the move played
//   and the pick each searched with searchmoves at 14M nodes on 4 threads (at most
//   7.5 s). The prose's reading of why the engines disagreed comes from these lines.
// - The chase rules (`chase`, followup/toggle.py): each engine on the position alone at
//   2.5 s on 4 threads, its chase rule set per row; run2:96's numbers ride along under
//   `chase.also` (AB-JChess had Red there; that game is no longer embedded). Mistboard's
//   own rule: packages/game jieqiPerpetualCheckLoser (a side that checked on every move
//   of the repetition loses; a chase is not penalised).
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
//   = 75%; v0.2d keeps 0.00985, +112 cp = 75%).

type Engine = 'abj' | 'jqe';

/** The loser's move the post marks, as the lead engine's side's chance (0-1) by both
 *  engines before and after it, and how many of the loser's moves it took the other
 *  engine's number to come within `catch` of the lead's (null: never). */
type Moment = {
  /** Plies played before the move: the position the board opens on. */
  ply: number;
  move: number;
  by: Engine;
  played: string;
  pick: string;
  before: Record<Engine, number>;
  after: Record<Engine, number>;
  caughtPly: number | null;
  lagMoves: number | null;
  /** Each engine's line for the move played and for the pick, from a search of that
   *  position alone (14M nodes, 4 threads, a few seconds; scratchpad pv_moments.py,
   *  2026-11-03): cp for the side to move, and the first 14 plies of its line. The
   *  prose reads the engines' reasons from these; past a face-down piece a line is a
   *  guess at what turns up. */
  lines: Record<Engine, Record<'played' | 'pick', { cp: number; secs: number; pv: string[] }>>;
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
  reason: string;
  moves: string;
  deal: JieqiDeal;
  /** Both engines on every position at match settings, as the lead's side's chance.
   *  lead: the winner's engine, or in a draw the engine the board follows. */
  aligned: {
    movetimeMs: number;
    threads: number;
    lead: Engine;
    side: 'red' | 'black';
    catch: number;
    /** index p = after p plies; the last is the result (1, 0 or 0.5). */
    series: Record<Engine, number[]>;
    /** Each engine's choice at every position; the mover's is the move played. */
    best: Record<Engine, (string | null)[]>;
    moment: Moment;
  };
  /** Game 1: AB-JChess with its chase rule off, the marked move and its pick at three
   *  node budgets, in cp for Red (the side to move). */
  check?: { ply: number; chaseRule: string; nodes: number[]; playedCp: number[]; pickCp: number[] };
  /** Game 1: jqe on the same position at three node budgets: its best move, the push and its pick. */
  jqeCheck?: { ply: number; nodes: number[]; bestUci: string[]; playedCp: number[]; pickCp: number[] };
  /** The chase game: each engine's score (cp, Red to move) with its chase rule set per row. */
  chase?: {
    fromPly: number;
    toPly: number;
    toggleSecs: number;
    toggle: { ply: number; jqe: { on: number; off: number }; abj: { skyrule: number; default: number; none: number } }[];
    also: {
      key: string;
      ply: number;
      stm: 'red' | 'black';
      jqe: { on: number; off: number };
      abj: { skyrule: number; default: number; none: number };
    };
  };
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
  /** Deals in which the same colour won both games, whichever engine played it. */
  dealSides: { sameColourWonBoth: number; red: number; black: number };
  /** The match rescored by Mistboard's rule: a side that checked on every move of a threefold
   *  repetition loses it. Counts of the drawn games, from ab-jchess-vs-jqe-draws.json. */
  mistboardRules: RunStats & {
    pairPoints: Record<string, number>;
    perpetualCheck: number;
    checkerAgreedLost: number;
    stillDrawn: number;
    stillDrawnAgreedWon: number;
    stillDrawnAgreedWonAbj: number;
  };
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

/** The six games as one study (scripts/variant-lab/ab-jchess-vs-jqe-study.ts): a
 *  chapter per game in AB_JQE_GAMES order, then the chase chapter. */
export const AB_JQE_STUDY = {
  // Prod study, created 2026-11-04 from article-analysis/deep/plan-v2-prod.json, with
  // each chapter's reveal luck imported from its luck-v2-<local chapter id>.json.
  id: 'SwSUugEY',
  chapters: {
    'run2:115': 'tLgSA545',
    'run2:22': 'uHz3p8mh',
    'run1:8': 'kdpOJE1N',
    'run2:104': 'SDQPHsxM',
    'run1:157': '0uVJBdm6',
    'run1:54': 'DzKM9Vw8',
  } as Record<string, string>,
} as const;

/** Each engine's arrow colour in the study (the graph's teal and orange are separate tokens). */
export const ENGINE_BRUSH: Record<Engine, string> = { abj: 'blue', jqe: 'orange' };
export type StudyArrow = { kind: 'arrow'; brush: string; orig: string; dest: string };
const FROM_TO = /^([a-i](?:10|[1-9]))([a-i](?:10|[1-9]))$/;

/** The study's arrows for one game, keyed by the position they sit on (plies played
 *  before the move): wherever the two engines would play different moves, both, blue
 *  for AB-JChess's choice and orange for jqe's; where they agree, none. One of the two
 *  is always the move played, since the mover's choice is its own move. */
export function disagreementArrows(best: Record<Engine, readonly (string | null)[]>): Record<number, StudyArrow[]> {
  const out: Record<number, StudyArrow[]> = {};
  best.abj.forEach((abj, i) => {
    const jqe = best.jqe[i];
    if (!abj || !jqe || abj === jqe) return;
    out[i] = (['abj', 'jqe'] as const).map((e) => {
      const m = FROM_TO.exec(e === 'abj' ? abj : jqe);
      if (!m) throw new Error(`ab-jchess-vs-jqe: not a move at ${i}: ${e === 'abj' ? abj : jqe}`);
      return { kind: 'arrow', brush: ENGINE_BRUSH[e], orig: m[1]!, dest: m[2]! };
    });
  });
  return out;
}

/** The position a game's board opens on: the one before its marked move. */
export const openPlyOf = (g: MatchGame): number => g.aligned.moment.ply;

/** A game's study chapter, opened on the position before the marked move. The study
 *  draws both engines' moves wherever they disagree (disagreementArrows), and the
 *  pick as a side line at the marked move unless it turns a piece over. */
function replay(key: string, caption: string): ArticleBlock {
  const g = game(key);
  const ply = openPlyOf(g);
  const chapter = AB_JQE_STUDY.chapters[key];
  if (!chapter) throw new Error(`ab-jchess-vs-jqe: no study chapter for ${key}`);
  return {
    kind: 'embed',
    path: `/embed/study/${AB_JQE_STUDY.id}/${chapter}?ply=${ply}`,
    title: `${NAME(g.red)} vs ${NAME(g.black)}, move ${Math.floor(ply / 2) + 1}`,
    caption,
    // A placeholder until the card reports its height: the 702px column's card
    // plus the 140px win-chance graph under it (study_chapters.score_series).
    aspect: [702, 926],
  };
}

// The five games, in the order the post shows them, then the chase game. The test
// checks each caption against the moves and the scores.
export type DarkResult = 'won' | 'drawn' | 'lost';
export const AB_JQE_GAMES = ['run2:115', 'run2:22', 'run1:8', 'run2:104', 'run1:157'] as const;
export const AB_JQE_CHASE = 'run1:54';
const [G1, G2, G3, G4, G5] = AB_JQE_GAMES.map(game) as [MatchGame, MatchGame, MatchGame, MatchGame, MatchGame];
const GC = game(AB_JQE_CHASE);
const P = (x: number): number => Math.round(100 * x);
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const word = (n: number): string => WORDS[n] ?? String(n);
const later = (n: number): string => `${word(n)} move${n === 1 ? '' : 's'} later`;
/** The move number of the position after `ply` plies. */
const moveAt = (ply: number): number => Math.floor(ply / 2) + 1;
/** "f9 to f6" from "f9f6". */
const fromTo = (move: string): string => move.replace(/^([a-i]\d+)([a-i]\d+)$/, 'from $1 to $2');
/** The range of an engine's number over positions [a, b). */
function range(g: MatchGame, e: Engine, a: number, b: number): [number, number] {
  const xs = g.aligned.series[e].slice(a, b).map(P);
  return [Math.min(...xs), Math.max(...xs)];
}
/** A centipawn score as the review shows it, "-2.9". */
const score = (cp: number): string => (cp === 0 ? '0' : `${cp > 0 ? '+' : '-'}${(Math.abs(cp) / 100).toFixed(1)}`);
const CHECK = (() => {
  if (!G1.check) throw new Error('ab-jchess-vs-jqe: game 1 has no chase-off check');
  return G1.check;
})();
const JQE_CHECK = (() => {
  if (!G1.jqeCheck) throw new Error('ab-jchess-vs-jqe: game 1 has no jqe deep check');
  return G1.jqeCheck;
})();
const M1 = G1.aligned.moment;
const M2 = G2.aligned.moment;
const M3 = G3.aligned.moment;
const M4 = G4.aligned.moment;
const M5 = G5.aligned.moment;
const MC = GC.aligned.moment;
/** Game 2: the reveal on move 35 and the face-down capture on move 36. */
const G2_FLIP = 68;
const G2_TAKE = 70;
/** Game 4: Red's two reveals that settled it. */
const G4_FLIPS = [36, 38] as const;
/** Game 3: Red's cannon takes a face-down piece on move 14. */
const G3_TAKE = 26;
/** Game 5: Red's reveal, then the repetition. */
const G5_FLIP = 98;
const CAL = M.calibration;
const DARK = M.darkCaptures;
const LATE = M.seenLate;
const TWICE = M.doubleTime;
const SIDES = M.dealSides;
const RULES = M.mistboardRules;
const millions = (n: number): number => Math.round(n / 1e6);
/** Face-down captures a game, to one decimal, in the games that ended this way for the capturer. */
export function darkPerGame(engine: Engine, result: DarkResult): string {
  const r = DARK[engine].byResult[result];
  return (r.captures / r.games).toFixed(1);
}
const pct = (r: Wdl): string =>
  `${Math.round((100 * (r.wins + r.draws / 2)) / (r.wins + r.draws + r.losses))}%`;
const wdlRow = (label: string, r: Wdl): string[] => [label, `${r.wins}-${r.draws}-${r.losses}`, pct(r)];
const LAGS = AB_JQE_GAMES.map((k) => game(k).aligned.moment.lagMoves!);
/** The two points of a single move token, e.g. a10f10 -> [a10, f10]. */
const ends = (mv: string): [string, string] => {
  const m = /^([a-i]\d+)([a-i]\d+)$/.exec(mv)!;
  return [m[1]!, m[2]!];
};

export const abJchessVsJqeArticle: Article = {
  slug: 'ab-jchess-vs-jqe',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess takes the jieqi title back from jqe',
  cardTitle: 'AB-JChess retakes the jieqi title',
  summary: `A new release of AB-JChess, built on jqe's open-source code, beat jqe over ${T.games} games and is the top jieqi bot on Mistboard again. Five games read move by move by both engines, the two engines' chase rules, and how their play differs.`,
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-04',
  thumbnail: {
    kind: 'svg',
    svg: (locale: Locale): string =>
      textCard(
        {
          palette: 'xiangqi',
          eyebrow: 'JIEQI',
          lead: { text: 'AB-JCHESS', name: true },
          tagline: 'TOP BOT AGAIN',
          ariaLabel: 'A card reading AB-JChess, the top jieqi bot again',
        },
        locale,
      ),
  },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bots on Mistboard, and engine authors.',
  readNext: ['jqe', 'ab-jchess', 'jieqi-platform'],
  tldr: [
    `AB-JChess is the top jieqi bot on Mistboard again. Its new release, AB-JChess-20261031, beat jqe over ${T.games} games: it won ${T.wins}, drew ${T.draws} and lost ${T.losses}, about ${T.pentaElo} Elo. Most of the edge came with Red.`,
    `The new release is built on jqe's open-source code, with a network of ${mb(M.engine.netBytes)} MB where the last one's was ${M.engine.oldNetMb} MB. It searches about ${M.engine.speedup} times as many positions a second as before.`,
    `In a level endgame with every piece face up, AB-JChess saw a soldier push lose ${word(M1.lagMoves!)} moves before jqe did, and it still saw it with its chase rule switched off and ${CHECK.nodes.at(-1)! / CHECK.nodes[0]!} times the search.`,
    `The match drew every threefold repetition. On Mistboard a side that gives check on every move of one loses, and ${RULES.perpetualCheck} of the ${T.draws} draws ended that way; scored by Mistboard's rules, AB-JChess's edge is about ${RULES.pentaElo} Elo.`,
  ],
  intro: [
    {
      kind: 'paragraph',
      text: `AB-JChess is the top [jieqi](/rules/jieqi) bot on Mistboard again. Its new release by Huorongrong and Laoxu (Kouza), AB-JChess-20261031, beat jqe, which took the title from it in October, over ${T.games} games. jqe stays on the ladder one level below.`,
    },
    {
      kind: 'note',
      label: 'As of November 3, 2026',
      text: 'AB-JChess-20261031 against jqe 0.1.0. Both engines are still being developed, so a later release of either may score differently.',
    },
  ],
  sections: [
    {
      heading: 'The result',
      blocks: [
        {
          kind: 'paragraph',
          text: `The ${T.games} games were ${T.pairs} deals, each played twice with colours swapped, at ${M.movetimeMs / 1000} seconds a move on ${M.threads} threads. As in jqe's match against the last AB-JChess, our referee drew any threefold repetition and any 60 moves by each side without a capture. When a face-down piece was taken, it told both engines what it was; on Mistboard only the player who took it finds out.`,
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
          text: `Almost all of AB-JChess's edge came with Red. Over the match it comes to about ${signed(T.pentaElo)} Elo, with a 95% range of ${signed(T.pentaLow)} to ${signed(T.pentaHigh)}. Scored by Mistboard's own repetition rule it would be about ${signed(RULES.pentaElo)}, as explained below.`,
        },
      ],
    },
    {
      heading: 'Five games, read by both engines',
      blocks: [
        { kind: 'sub-heading', text: 'How to read these games' },
        {
          kind: 'paragraph',
          text: `Each board opens on a move where the engines disagreed, played by the side that went on to lose or draw. Wherever the two would have played different moves, a blue arrow shows AB-JChess's choice and an orange one jqe's. The graph under the board is the winning side's chance by each engine at match settings, AB-JChess in teal and jqe in orange, and the comments in the move list say where the game turned and what each engine expected. A die beside a reveal grades its luck from what both players could see; [the study](/study/${AB_JQE_STUDY.id}) has all six games.`,
        },
        { kind: 'sub-heading', text: 'AB-JChess wins game 1: one soldier push loses the endgame' },
        replay(
          G1.key,
          `Move ${M1.move}. jqe (Red) pushes a soldier ${fromTo(M1.played)}. AB-JChess would move the horse ${fromTo(M1.pick)}.`,
        ),
        {
          kind: 'paragraph',
          text: `Every piece is face up and the game is level. jqe (Red) pushes a soldier, where AB-JChess would give its horse for Black's advisor. AB-JChess sees at once that the push lets Black's cannon swing over and attack Red's general; jqe sees it only ${later(M1.lagMoves!)}. Black wins on move ${G1.moveCount}, when Red has no legal move. Why did jqe push? Not for lack of time: with ${JQE_CHECK.nodes.at(-1)! / JQE_CHECK.nodes[0]!} times the search it still picks the push and still calls the game a dead draw. It misjudged the position rather than missing a move. AB-JChess, with its chase rule off and the same extra search, still sees the push lose.`,
        },
        { kind: 'sub-heading', text: 'AB-JChess wins game 2: a reveal decides it' },
        replay(
          G2.key,
          `Move ${M2.move}. jqe (Black) brings its chariot home ${fromTo(M2.played)}. AB-JChess would keep it on Red's back rank, at ${ends(M2.pick)[1]}.`,
        ),
        {
          kind: 'paragraph',
          text: `Black's chariot has raided Red's back rank. jqe brings it home; AB-JChess would leave it there. Two later moves decide it: on move ${moveAt(G2_FLIP)} Red turns over a soldier and both engines call the game even, and on move ${moveAt(G2_TAKE)} Red takes a hidden piece and both have Red winning. Red wins on move ${G2.moveCount}. Both engines saw those two moves the same way, so this game does not tell us which was right about the chariot.`,
        },
        { kind: 'sub-heading', text: "AB-JChess wins game 3: jqe's cannon starts a losing run of trades" },
        replay(
          G3.key,
          `Move ${M3.move}. jqe (Black) moves its cannon ${fromTo(M3.played)}. AB-JChess would move the horse ${fromTo(M3.pick)}.`,
        ),
        {
          kind: 'paragraph',
          text: `Red is ahead after its cannon took a hidden piece on move ${moveAt(G3_TAKE)}. jqe's cannon move starts a run of trades: Black gives a soldier and its horse for an elephant and an advisor. AB-JChess thinks the trades are bad for Black; jqe thinks they are fine and only agrees ${later(M3.lagMoves!)}. Red wins on move ${G3.moveCount}. Three hidden pieces turned over in a row helped change jqe's mind, so this example is weaker than game 1.`,
        },
        { kind: 'sub-heading', text: 'jqe wins game 4: two reveals go wrong for AB-JChess' },
        replay(
          G4.key,
          `Move ${M4.move}. AB-JChess (Red) moves its cannon ${fromTo(M4.played)}. jqe would turn over the piece on ${ends(M4.pick)[0]} by moving it to ${ends(M4.pick)[1]}.`,
        ),
        {
          kind: 'paragraph',
          text: `Many pieces are still hidden, and jqe already thinks Black is better. AB-JChess makes a quiet cannon move where jqe would turn over a hidden piece, and neither engine can see past a reveal, so we can't say who was right. Luck decides it: AB-JChess turns over a soldier on move ${moveAt(G4_FLIPS[0])}, then a chariot that Black's cannon takes at once. Black wins on move ${G4.moveCount}.`,
        },
        { kind: 'sub-heading', text: 'Game 5 is drawn: AB-JChess has it won and repeats' },
        replay(
          G5.key,
          `Move ${M5.move}. jqe (Red) moves a chariot ${fromTo(M5.played)}. AB-JChess would move the other chariot ${fromTo(M5.pick)}.`,
        ),
        {
          kind: 'paragraph',
          text: `Red is far ahead for most of the game, but Black slowly comes back. After Red turns over a soldier on move ${moveAt(G5_FLIP)}, AB-JChess thinks Black is winning. Then Red's chariot and Black's elephant move back and forth until the same position comes up three times, and the game is drawn. AB-JChess did not see the repetition coming, because in the match each engine was given only the current position, not the moves before it.`,
        },
        {
          kind: 'paragraph',
          text: `Game one's ${word(Math.max(...LAGS))} moves is the long end; in the other four the lag was ${word(Math.min(...LAGS))} or ${word([...LAGS].sort((x, y) => x - y).at(-2)!)}. Across the match, counting from the move where each engine's own scores gave the winner 70% for good, the two were within a move of each other in ${LATE.abWon.withinOne} of AB-JChess's ${LATE.abWon.games} wins, and where one was later it was jqe in ${LATE.abWon.jqeLater} and AB-JChess in ${LATE.abWon.abjLater}. In jqe's ${LATE.jqeWon.games} wins each was later about as often, AB-JChess in ${LATE.jqeWon.abjLater} and jqe in ${LATE.jqeWon.jqeLater}.`,
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
      heading: 'What the match tells us',
      blocks: [
        { kind: 'sub-heading', text: 'Half the deals decided themselves' },
        {
          kind: 'paragraph',
          text: `Each deal was played twice with the colours swapped. In ${SIDES.sameColourWonBoth} of the ${T.pairs} deals the same colour won both games, Red in ${SIDES.red} and Black in ${SIDES.black}, so whichever engine had that side, the deal decided it. AB-JChess's edge comes from the rest: it won both games of a deal ${T.pairPoints['2']} times, and jqe did ${T.pairPoints['0']} times.`,
        },
        { kind: 'sub-heading', text: "AB-JChess's edge is judgement, not depth" },
        {
          kind: 'paragraph',
          text: `jqe was the later of the two to see the result in AB-JChess's wins, while in jqe's wins neither engine was. In game 1 jqe still called a lost endgame a dead draw with ${JQE_CHECK.nodes.at(-1)! / JQE_CHECK.nodes[0]!} times the search, and when it scored itself a small edge it went on to score less than AB-JChess did from the same score. Both point the same way: jqe's mistakes are in how it values quiet positions and trades, not in how far it looks. Neither engine searches past a reveal, so turning a piece over stays a guess for both, as in game 4.`,
        },
        { kind: 'sub-heading', text: "Most draws were not draws by Mistboard's rules" },
        {
          kind: 'paragraph',
          text: `Our referee drew every threefold repetition. Mistboard does not: a side that gives check on every move of the repetition loses. In ${RULES.perpetualCheck} of the ${T.draws} draws one side did that, and in ${RULES.checkerAgreedLost} of them both engines already scored the other side as winning, so checking forever was the losing side's way out. Scored by Mistboard's rules, AB-JChess won ${RULES.wins}, drew ${RULES.draws} and lost ${RULES.losses}, about ${signed(RULES.pentaElo)} Elo with a 95% range of ${signed(RULES.pentaLow)} to ${signed(RULES.pentaHigh)}. The ${signed(T.pentaElo)} above keeps the referee's rules, the same ones as jqe's match against the last AB-JChess, so the two matches can be compared.`,
        },
        {
          kind: 'paragraph',
          text: `Of the ${RULES.stillDrawn} games that stay drawn, ${RULES.stillDrawnAgreedWon} were won for one side by both engines' scores and repeated anyway, ${RULES.stillDrawnAgreedWonAbj} of them for AB-JChess. That is the blindness game 5 showed: in the match each engine saw only the current position, so it could not see a repetition coming. On Mistboard the bots are sent the moves since the last capture or reveal, so they do see it.`,
        },
        {
          kind: 'paragraph',
          text: `The engines also bring their own rule for a chase, a repetition in which one side keeps attacking the same piece, and neither matches Mistboard's. jqe calls a side lost when every one of its moves in the repetition chases the same piece. AB-JChess calls a side lost when it chased on any move and the other side never did.`,
        },
        replay(
          GC.key,
          `Move ${MC.move}. AB-JChess (Red) moves its chariot ${fromTo(MC.played)}, attacking Black's horse on a3. jqe would move it to ${ends(MC.pick)[1]}.`,
        ),
        {
          kind: 'paragraph',
          text: `Red's chariot then attacks the horse after every move it makes. By jqe's rule Red loses, and jqe gave Black ${range(GC, 'jqe', MC.ply + 1, GC.plies)[0]}% or more to the end; by AB-JChess's rule the horse chases back, so it scored a draw. Mistboard draws a chase, so jqe was counting on a rule the game is not played under. Step through the board for both engines' rules searched on and off.`,
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
          text: `The score in a review is the engine's own number, and each network counts on its own scale. The old network's scale was steep: +${(M.review.oldCpAt75 / 100).toFixed(1)} already meant a 75% chance. The new one counts on about the same scale as jqe, where 75% is +${(M.review.cpAt75 / 100).toFixed(1)}. So the same position now shows a bigger number, and we fitted the new network's winning chances on ${commas(M.review.kPositions)} positions from this match. Old reviews keep the old numbers, so compare an old review with a new one by winning chance, not by the score.`,
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `AB-JChess is open source under the GPL-3.0 licence at [github.com/lxsgx23/AB-JChess](${AB_REPO}). The network is downloaded from the authors' own release each time we build the site, never re-hosted. Thank you, Huorongrong and Laoxu (Kouza). Laoxu trains AB-JChess's networks and, for this release, tested four ways of searching a reveal and kept the best; he and Huorongrong worked out together the small, fast network it plays with. And thank you, Devin O'Keefe, for the code the new release stands on.`,
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
