import type { Locale } from '../../i18n/locale.js';
import { evalCompareChartSvg } from '../eval-compare-chart.js';
import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';
import examplesJson from './jqe-examples.json' with { type: 'json' };

// DRAFT. jqe, Devin O'Keefe's jieqi engine and the top jieqi bot since
// 2026-10-22 (with his yes), the way ab-jchess.ts covered AB-JChess: what it is,
// how it gets its strength, two games from the title match, where it sits.
// AB-JChess and our Pikafish bot appear only as context; ab-jchess.ts and
// pikafish-reveal-bug.ts cover them and are linked, not restated.
//
// Elo margins from separate matches do not chain: each table row states its own match.
//
// Sources, refreshed 2026-10-24:
// - mistboard-engine lab/jieqi-match/jqe-vs-abj-0.2d/run1-4s-4thr.jsonl (the
//   match players meet today): 300 games, 150 colour-swapped deals, 4 s, 4 threads,
//   b = jqe. jqe 171-15-114, +67 pentanomial [+31, +104]; jqe won both games of a
//   deal 43 times, AB-JChess 19; 15 repetitions; one game (53) passed 80 plies
//   without a capture, won by jqe. Recomputed from the file and summarize.py.
// - Disagreement counts, the charts and the per-move reads quoted for games 46 and
//   239: each engine's own in-game score on the curves fitted on this match in the
//   lab README (AB-JChess 0.2d K=0.00902, jqe K=0.00247), consecutive moves,
//   threshold 75% for the engine's own side against 60% or less from the other. jqe
//   side: 142 games, 116-7-19; AB-JChess side: 33 games, AB 23-1-9. The two games'
//   moves and scores are copied from the match file into jqe-examples.json.
// - Game 152 (jqe Black, won): the two reads on opposite sides of 50% on moves 22
//   and 23 (AB-JChess's own 4211 and 323 against jqe's 595 and 3844). Game 40 (jqe
//   Black, lost): jqe 294 (67%) on its last move against AB-JChess's 441 and 486.
//   Move 22 rerun on AB-JChess v0.2d fe35d87c, net 20261010, 4 threads, Apple silicon
//   (scratchpad abj_pv.py / abj_warm.py, 2026-10-24): searchmoves g8e8 (chariot takes the
//   e8 soldier) 15 s = mate 11; searchmoves d9e9 15 s = cp 414, pv d9e9 f9e9 h2h9; a free
//   search ends on "lowerbound" scores (9999, 6311). The match's 4211 was most likely such a
//   bound: the harness keeps the score, not the bound flag.
//   A scan of all 300 games for the reads 60/40 apart across 50%: 41 positions.
// - Games 46 and 239 replayed on packages/game's jieqi rules from the study's
//   games.json; the move-6 check in game 239 was checked for every legal reply (8,
//   all interpositions or the soldier taking the cannon; none saves the chariot).
//   Both games' face-down captures are public only as "a face-down piece": the
//   prose never names what a face-down capture took.
// - lab/jieqi-match/abj-0.2d-vs-0.2b/run1-4s-4thr.jsonl: v0.2d 165-16-119 over 150
//   deals, +54 [+16, +93].
// - lab/jieqi-jqe-2026-10-16/README.md + summarize.py over run1-4s-4thr.jsonl and
//   run2-15s-4thr.jsonl (against v0.2b): jqe 71-4-25, +173 [+101, +262];
//   33-4-13, +147 [+58, +261].
// - jqe 0.1.0 @ 331a6e61 (~/projects/tools/jqe-331a6e61): README.md (results vs
//   v0.2b and "Mistboard PikaJieQi", net size), REPORT.md § Chance nodes (72 reveals;
//   old method +0.021, "Exact Star1 windows (Ballard 1983)" +0.009 at 11.5x
//   positions, ChanceMix 6 +0.009 at 1.15x; +137 [+83, +198], then +34 [+11, +56]),
//   docs/DECISIONS.md D091 item 3 (~30x the nodes of v0.2b), CHANGELOG.md (0.1.0,
//   2026-10-13), LICENSE (MIT), THIRD_PARTY.md (the "mistboard" opponent is our
//   fork at 6398d4c1, 2026-09-21, one commit before the reveal fix bcc83f88 in
//   pikafish-jieqi.ref). Net it014.jqn 1,547,356 bytes.
// - AB-JChess v0.2d net abjchess-20261010.nnue 143,667,546 bytes (about 93x
//   jqe's); the billion training positions for its first net: ab-jchess.ts.
// - Our Pikafish bot's averaging, its fix and the 150 Elo cost of fixing it
//   everywhere: pikafish-reveal-bug.ts.
//
// Rating: jqe has no bots-page rating yet (prod /api/bots, 2026-10-23: rating null,
// no EvE games). Add it to "Where it sits" once the EvE job rates it, as ab-jchess.ts
// quotes AB-JChess's.

const JQE_REPO = 'https://github.com/devinokeefe/jieqi';
const AB_REPO = 'https://github.com/lxsgx23/AB-JChess';

// @mistboard's public study of the 300 games against AB-JChess 0.2d at 4 s a move,
// one chapter a game ("jqe vs AB-JChess 0.2d: 300 games at 4 s a move"). The older
// 100-game study against 0.2b (R612nAlt) is unlisted; do not link it.
export const JQE_STUDY = {
  id: '3RQbr51i',
  // Game number -> chapter: game 46 is "Pair 24a", game 152 "Pair 77a", game 239
  // "Pair 120b". Game 46's chapter was re-added with Black at the bottom (jqe's
  // side) on 2026-10-24, so its id is new.
  chapters: { 46: '6rsLTPvR', 152: 'hpGvDJkD', 239: 'rqjN16kI' },
} as const;
const JQE_STUDY_HREF = `/study/${JQE_STUDY.id}`;

type JqeGame = keyof typeof JQE_STUDY.chapters;

// Text card (text-card.ts). The engine's name stays as written in every language.
const JQE_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'JIEQI',
      lead: { text: 'jqe', name: true },
      tagline: 'THE NEW TOP BOT',
      ariaLabel: 'A card reading jqe, the new top jieqi bot',
    },
    locale,
  );

type JqeExampleMove = { by: 'jqe' | 'ab'; move: string; cp: number; mate: boolean };
type JqeExampleGame = {
  game: number;
  jqeColor: 'red' | 'black';
  winner: 'red' | 'black';
  moves: JqeExampleMove[];
};
const JQE_EXAMPLES = examplesJson as { games: JqeExampleGame[] };

// Each engine's score turned into a winning chance on the curve fitted to it on this match.
const SCORE_K = { jqe: 0.00247, ab: 0.00902 } as const;

/** jqe's winning chance as the engine that played `m` saw it. */
function jqeChance(m: JqeExampleMove): number {
  const mover = m.mate ? (m.cp > 0 ? 1 : 0) : 1 / (1 + Math.exp(-SCORE_K[m.by] * m.cp));
  return m.by === 'jqe' ? mover : 1 - mover;
}

/**
 * Both engines' reads of one game at every position (index = plies played, as the
 * study embed's ?ply= counts). An engine scores only on its own move, so its line
 * holds that read through the reply, and before its first move shows its first read.
 */
export function jqeReadSeries(game: JqeGame): { jqe: number[]; ab: number[] } {
  const g = JQE_EXAMPLES.games.find((x) => x.game === game);
  if (!g) throw new Error(`jqe: game ${game} is not in the examples data`);
  const first = (by: 'jqe' | 'ab'): number => jqeChance(g.moves.find((m) => m.by === by)!);
  const last = { jqe: first('jqe'), ab: first('ab') };
  const jqe = [last.jqe];
  const ab = [last.ab];
  for (const m of g.moves) {
    last[m.by] = jqeChance(m);
    jqe.push(last.jqe);
    ab.push(last.ab);
  }
  return { jqe, ab };
}

type Callout = { ply: number; on: 'a' | 'b'; lines: readonly string[]; side: 'left' | 'right'; level: number };

function readChart(game: JqeGame, ariaLabel: string, callouts: readonly Callout[]): ArticleBlock {
  const s = jqeReadSeries(game);
  return {
    kind: 'raw-svg',
    className: 'article-figure-eval-compare',
    zoomable: true,
    svg: evalCompareChartSvg({
      id: `jqe-g${game}`,
      heading: "jqe's winning chance, as each engine saw it",
      ariaLabel,
      nameA: 'jqe',
      nameB: 'AB-JChess',
      a: s.jqe,
      b: s.ab,
      xLabel: 'Move',
      axis: 'move',
      yTicks: [0.5, 1],
      callouts,
    }),
  };
}

function gameEmbed(game: JqeGame, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${JQE_STUDY.id}/${JQE_STUDY.chapters[game]}?ply=${ply}`,
    title,
    // Width-bound at the 702px column, as the AB-JChess post's embeds.
    aspect: [702, 780],
  };
}

export const jqeArticle: Article = {
  slug: 'jqe',
  kind: 'article',
  publisher: 'mistboard',
  title: 'jqe, the new top jieqi bot',
  seoTitle: 'jqe: the open-source jieqi engine that beat AB-JChess 171 to 114',
  summary:
    "jqe, an open-source jieqi engine by Devin O'Keefe, is now the top jieqi bot on Mistboard. It beat AB-JChess 0.2d 171 to 114 over 300 games, with a network about 90 times smaller.",
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-27',
  thumbnail: { kind: 'svg', svg: JQE_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard, and engine authors.',
  readNext: ['ab-jchess', 'pikafish-reveal-bug', 'jieqi-platform'],
  tldr: [
    "jqe, an open-source engine by Devin O'Keefe, is the top jieqi bot on Mistboard as of October 2026. Over 300 games against AB-JChess 0.2d, the release the site runs, it won 171, drew 15 and lost 114, about 67 Elo.",
    "Its biggest gain is a cheap way to score a reveal. It is as accurate on average as Star1, the exact method Bruce Ballard published in 1983, for a tenth of the work, and it was worth about 140 Elo against jqe's earlier version.",
    "Its network is about 90 times smaller than AB-JChess's, so it searches many more positions in the same time.",
    'jqe judged positions better: in 142 games it rated itself well ahead while AB-JChess still had the game close, and it won 116 of them.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: `[Jieqi](/rules/jieqi) on Mistboard has a new top bot. [jqe](${JQE_REPO}) is an open-source engine by Devin O'Keefe, first released on October 13, and we play it here with his permission. Against AB-JChess 0.2d, the top bot until now, it won 171 games, drew 15 and lost 114, about 67 Elo. You can [play it](/bot/jqe) now; [AB-JChess](/blog/ab-jchess) stays on the ladder one level below.`,
    },
    {
      kind: 'paragraph',
      text: `The 300 games were 150 deals, each played twice with colours swapped, at 4 seconds a move on the settings the site uses. jqe won both games of a deal 43 times, and AB-JChess did that 19 times. All 300 are in [a study](${JQE_STUDY_HREF}), one chapter a game.`,
    },
    {
      kind: 'note',
      label: 'As of October 24, 2026',
      text: 'jqe 0.1.0 against AB-JChess 0.2d. Both engines are still being developed, so a later release of either may score differently.',
    },
  ],
  sections: [
    {
      heading: 'jqe scores a reveal as well as the exact method, at a tenth of the cost',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Every reveal is a gamble the engine has to price.** A face-down piece turns over when it moves, so an engine moving one does not know what it is moving. It plays the move once for each piece it could be, scores each outcome, and averages them, weighted by how many of each piece are still unaccounted for. Every jieqi engine we have looked at does this.',
        },
        {
          kind: 'paragraph',
          text: '**The usual shortcut makes reveals look safer than they are.** To save time, a search stops working on a move once it knows the move is worse than the best so far, and hands back a bound, "this much or worse", in place of a real score. That is fine for comparing moves and wrong inside an average: a piece that gets mated can come back as "no better than +7" and count as +7. Our Pikafish bot had this flaw, and so does the AB-JChess release we checked. [The reveal-bug post](/blog/pikafish-reveal-bug) shows the moves it led our bot to.',
        },
        {
          kind: 'paragraph',
          text: '**The exact fix is from 1983, and it is slow.** Bruce Ballard\'s Star1 searches each chance move with bounds that keep every outcome honest, so the average comes out right. jqe\'s report measured both methods, and jqe\'s own, on 72 reveals jqe had played:',
        },
        {
          kind: 'table',
          caption:
            "How far each method overrated 72 of jqe's reveals, in expected score (0.01 is one point in a hundred), and how much searching it took. From jqe's report.",
          headers: ['Method', 'Overrating', 'Positions searched'],
          rows: [
            ['The usual shortcut', '0.021', '1 time'],
            ['Star1, exact (Ballard, 1983)', '0.009', '11.5 times'],
            ["jqe's method", '0.009', '1.15 times'],
          ],
          highlightRows: [2],
          keyColumn: true,
        },
        {
          kind: 'paragraph',
          text: "**jqe gets Star1's accuracy for 15% more work.** It searches every piece the mover could be six half-moves less deep with no cut-off, so each comes back with a real score, and searches the most likely piece at full depth as well.",
        },
        {
          kind: 'note',
          label: 'What the fix was worth',
          text: "Against jqe's own earlier version, this was worth about 140 Elo (somewhere between 80 and 200), jqe's largest single gain. For scale, searching four times as many positions a move was worth about 50. Using it at every reveal deep in the search, with three smaller changes, added about 34 more.",
        },
        {
          kind: 'paragraph',
          text: "We fixed our Pikafish bot only for the move it is choosing, because the exact average at every reveal made it about 150 Elo weaker. jqe's cheaper version gained when used everywhere.",
        },
      ],
    },
    {
      heading: "A network 90 times smaller than AB-JChess's",
      blocks: [
        {
          kind: 'paragraph',
          text: "jqe judges positions with a 1.5 MB neural network, about 90 times smaller than the one AB-JChess 0.2d runs (dated October 10, 2026; a later AB-JChess release may change it). jqe's was trained only on its own games, 82 million positions, where AB-JChess's first network was trained on about a billion. A small network is quick to run: jqe looks at about 30 times as many positions in the same time as AB-JChess 0.2b, the release before 0.2d. Its inputs also count every piece still face down, so it can see what a reveal might turn up.",
        },
      ],
    },
    {
      heading: 'jqe judged positions better than AB-JChess',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Each engine reports a score with every move, which we turned into a winning chance on a curve fitted to that engine. **In 142 games jqe gave itself 75% or more while AB-JChess, a move before or after, gave jqe 60% or less. jqe won 116 of them.** The other way round happened in 33 games, and AB-JChess won 23.',
        },
        {
          kind: 'paragraph',
          text: "In the first two games below, a face-down piece of AB-JChess's came up a chariot where jqe could win it. In the third, the engines disagreed about who was winning.",
        },
        { kind: 'sub-heading', text: 'Game 46: jqe takes the chariot on move 8' },
        {
          kind: 'paragraph',
          text: "jqe has Black. On move 8 AB-JChess's face-down piece takes one of jqe's and comes up a chariot, and a face-down piece of jqe's takes it straight back. AB-JChess keeps the game close until move 18; jqe mates on move 35.",
        },
        readChart(
          46,
          "Game 46: jqe's winning chance by move as each engine saw it. jqe's own read jumps to 79% on move 8 and stays above 70%; AB-JChess's stays between 54% and 62% until move 18, then rises.",
          [
            { ply: 16, on: 'a', lines: ['Chariot taken', 'jqe: 79%'], side: 'left', level: 0.93 },
            { ply: 35, on: 'b', lines: ['AB-JChess agrees', 'move 18'], side: 'right', level: 0.62 },
          ],
        ),
        gameEmbed(46, 16, 'Jieqi, game 46: jqe takes the chariot'),
        { kind: 'sub-heading', text: 'Game 239: a cannon check wins a chariot' },
        {
          kind: 'paragraph',
          text: "jqe has Red. On move 5 AB-JChess pushes a face-down piece forward and it comes up a chariot. jqe's cannon leaves the corner file to check down the middle, which opens the file for the face-down piece behind it, and no answer to the check saves the chariot. AB-JChess first gives jqe 75% on move 16; jqe mates on move 39.",
        },
        readChart(
          239,
          "Game 239: jqe's winning chance by move as each engine saw it. jqe's own read is 76% to 82% from move 5 to move 9 while AB-JChess's is 55% to 62%; both dip near move 12, then jqe's reaches 84% on move 14 and AB-JChess's reaches 75% on move 16.",
          [
            { ply: 11, on: 'a', lines: ['Cannon check', 'jqe: 81%'], side: 'right', level: 0.98 },
            { ply: 32, on: 'b', lines: ['AB-JChess agrees', 'move 16'], side: 'right', level: 0.45 },
          ],
        ),
        gameEmbed(239, 11, 'Jieqi, game 239: the cannon check'),
        { kind: 'sub-heading', text: 'Game 152: AB-JChess misses a mate and loses a chariot' },
        {
          kind: 'paragraph',
          text: "jqe has Black and is losing: from move 19 both engines give AB-JChess 86% or more. On move 22 AB-JChess had a forced mate, starting with its chariot taking a soldier; a longer search by AB-JChess itself finds it. In the game its other chariot took an advisor with check instead, and jqe's general took the chariot. AB-JChess reported that move as winning, but the score was one its search had not finished checking when its 4 seconds ran out. Given 15 seconds on the same move, it scores it at about four pawns for Red, far short of the mate it gave up. Each engine got exactly 4 seconds a move in this match, with no extra time when its search was unsure, and game 152 shows what that can cost.",
        },
        {
          kind: 'paragraph',
          text: 'jqe gave itself 81% as soon as it took the chariot, and 99% a move later. AB-JChess still gave itself 95% after move 23, then dropped to 9% on move 24. jqe mates on move 36.',
        },
        readChart(
          152,
          "Game 152: jqe's winning chance by move as each engine saw it. Both reads fall below 25% by move 16 and stay there until move 22; then jqe's own read jumps to 81% and 99%, while AB-JChess's stays near 0% for one more move and jumps to 91% on move 24.",
          [
            { ply: 44, on: 'a', lines: ['General takes the chariot', 'jqe: 81%'], side: 'left', level: 0.93 },
            { ply: 47, on: 'b', lines: ['AB-JChess agrees', 'move 24'], side: 'right', level: 0.6 },
          ],
        ),
        gameEmbed(152, 43, 'Jieqi, game 152: the chariot sacrifice'),
        {
          kind: 'paragraph',
          text: 'jqe is not always the one who is right. In game 40 jqe gave itself 67% on its last move, while AB-JChess gave it 2% and mated it on the next.',
        },
      ],
    },
    {
      heading: 'Where it sits',
      blocks: [
        {
          kind: 'paragraph',
          text: 'jqe is at the top of the jieqi bot list, one level above AB-JChess, with the Pikafish levels below them. Its lead over AB-JChess 0.2d is smaller than its lead over the older 0.2b was, because the newer release is the stronger one: it beat the older by about 54 Elo.',
        },
        {
          kind: 'table',
          caption:
            "jqe's results: wins, draws, losses. The range is the 95% interval. The last two rows are from jqe's own report, on its author's referee; its Pikafish opponent was our Pikafish bot as of September 21, before the reveal fix.",
          headers: ['Opponent', 'Clock', 'Games', 'Result', 'Elo', 'Range'],
          rows: [
            ['AB-JChess 0.2d', '4 s a move', '300', '171-15-114', '+67', '+31 to +104'],
            ['AB-JChess 0.2b', '4 s a move', '100', '71-4-25', '+173', '+101 to +262'],
            ['AB-JChess 0.2b', '15 s a move', '50', '33-4-13', '+147', '+58 to +261'],
            ['AB-JChess 0.2b', '60 s + 0.6 s', '1,000', '701-24-275', '+158', '+136 to +181'],
            ['Our Pikafish bot', '60 s + 0.6 s', '1,000', '761-20-219', '+211', '+187 to +236'],
          ],
          highlightRows: [0],
          keyColumn: true,
        },
        {
          kind: 'paragraph',
          text: "Each row is its own match, on its own deals and settings, so the margins do not add up. Our matches ran on our own referee, whose rules are not quite jqe's. It draws any threefold repetition and any 60 moves without a capture, where jqe's own rules make a perpetual checker lose and draw after 40 moves without a capture. Of the 300 games against 0.2d, 15 ended in repetition, and one went past 40 moves without a capture before jqe won it. The referee also shows a piece captured face-down to both engines, where on the site only its capturer learns what it was. Both engines saw the same thing, so neither gained from it.",
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `jqe is open source under the MIT licence at [github.com/devinokeefe/jieqi](${JQE_REPO}), with its network, its match records and the tools that recompute every number in its report. Congratulations to Devin O'Keefe, and thank you for letting us play it here. Thanks also to Huorongrong and Laoxu, whose [AB-JChess](${AB_REPO}) set the mark jqe had to beat.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play jqe', href: '/bot/jqe', emphasis: 'primary' },
            { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
