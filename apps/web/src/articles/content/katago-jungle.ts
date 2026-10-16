import {
  applyJungleMove,
  createInitialJungleState,
  engineUciToJungleMove,
  type JungleGameState,
} from '@mistboard/game';
import type { Locale } from '../../i18n/locale.js';
import { evalCompareChartSvg } from '../eval-compare-chart.js';
import {
  type EvalsData,
  type EvaluatedGame,
  type KatagoLine,
  mistyMoveMarks,
  seriesFor,
  settledPly,
  winnerSeries,
} from '../katago-jungle-analysis.js';
import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';
import evalsJson from './katago-jungle-evals.json' with { type: 'json' };
import linesJson from './katago-jungle-lines.json' with { type: 'json' };

// Facts from the KataGo seat (#434, be6fc95e) and the match write-up
// (brianhliou.com, 2026-09-23, merged into this article 2026-10-07; the blog
// post 301s here): 200 games against MistyJungle at 1,000 visits a move (82-0-118, 0.705,
// study 0t8xpyv6), then 50 at the site's 150 visits (19-0-31, 0.690).
//
// Text card (text-card.ts) on the jungle diagrams' green. KataGo has no Chinese
// name, so it stays as written in every language.
const KATAGO_JUNGLE_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'jungle',
      eyebrow: 'JUNGLE CHESS',
      lead: { text: 'KATAGO', name: true },
      tagline: 'THE NEW TOP BOT',
      ariaLabel: 'A card reading KataGo, the top Jungle Chess bot',
    },
    locale,
  );

const KATAGOMO = 'https://github.com/hzyhhzy/KataGomo';

// Both engines' evaluation of every position of the two games below, at the
// match budgets (scripts/variant-lab/jungle-katago-evals.ts, reduced to this
// JSON by jungle-katago-evals-reduce.ts). Charts, marks and the numbers the
// prose quotes all come from it; katago-jungle-evals.test.ts pins the prose.
export const KATAGO_EVALS = evalsJson as EvalsData;
export const SETTLE_LEVEL = 0.8;

export function evaluatedGame(game: number): EvaluatedGame {
  const found = KATAGO_EVALS.games.find((g) => g.game === game);
  if (!found) throw new Error(`katago-jungle: game ${game} is not in the evals data`);
  return found;
}

/** KataGo's score as each engine saw it, and the ply each settled above SETTLE_LEVEL. */
export function katagoScoreSeries(game: EvaluatedGame) {
  const kata = winnerSeries(game, seriesFor(game, 'kata'))!;
  const misty = winnerSeries(game, seriesFor(game, 'misty'))!;
  return {
    kata,
    misty,
    settledKata: settledPly(kata, SETTLE_LEVEL),
    settledMisty: settledPly(misty, SETTLE_LEVEL),
  };
}

// The annotated games: a @mistboard study made from
// scripts/variant-lab/jungle-katago-annotated-study.ts (one chapter a game) by
// study:edit. THESE IDS ARE A LOCAL DEV DATABASE'S (2026-10-02): the prod study
// is created from the same plan on Brian's go, and its ids replace these.
export const KATAGO_STUDY = {
  id: 'h2DLEHEC',
  chapters: { 67: '3ZKOQobN', 94: 'TAPsmuCM' },
} as const;

type ChartNote = { lines: readonly string[]; side: 'left' | 'right'; level: number };

/**
 * One game's chart, told in two notes: on KataGo's line where Misty's ?? move
 * lands, and on Misty's line where Misty finally sees the loss (its settle
 * point). The plies come from the data; the words and placement from the post.
 */
function gameChart(
  game: number,
  heading: string,
  ariaLabel: string,
  labelsAt: number,
  notes: { blunder: ChartNote; sees: ChartNote },
): ArticleBlock {
  const g = evaluatedGame(game);
  const s = katagoScoreSeries(g);
  const blunder = mistyMoveMarks(g)[0]!.ply + 1;
  return {
    kind: 'raw-svg',
    className: 'article-figure-eval-compare',
    // Phone width shrinks the axis text below reading size; a tap opens it full screen.
    zoomable: true,
    svg: evalCompareChartSvg({
      id: `katago-jungle-g${game}`,
      heading,
      ariaLabel,
      nameA: 'KataGo',
      nameB: 'Misty',
      a: s.kata,
      b: s.misty,
      xLabel: 'Move',
      axis: 'move',
      yTicks: [0.5, 1],
      lineLabels: { at: labelsAt, a: 'KataGo thinks', b: 'Misty thinks' },
      callouts: [
        { ply: blunder, on: 'a', ...notes.blunder },
        { ply: s.settledMisty!, on: 'b', ...notes.sees },
      ],
    }),
  };
}

function gameEmbed(game: 67 | 94, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${KATAGO_STUDY.id}/${KATAGO_STUDY.chapters[game]}?ply=${ply}`,
    title,
    // Width-bound at the 702px column, as the rules page's jungle embed.
    aspect: [702, 780],
  };
}

// KataGo's own lines where the games went another way (the study's sidelines,
// which the study embed lets a reader step into),
// from scripts/variant-lab/jungle-katago-lines.ts and the September video work;
// reduced to this JSON by jungle-katago-evals-reduce.ts.
export const KATAGO_LINES = linesJson as KatagoLine[];

/** The position a line starts from: the game replayed to `ply` plies. */
export function lineStart(game: number, ply: number): JungleGameState {
  let state = createInitialJungleState(`katago-line-${game}`);
  for (const uci of evaluatedGame(game).moves.slice(0, ply)) {
    const next = applyJungleMove(state, engineUciToJungleMove(uci)!);
    if (!next) throw new Error(`katago-jungle: game ${game} does not replay at ${uci}`);
    state = next;
  }
  return state;
}

export const katagoJungleArticle: Article = {
  slug: 'katago-jungle',
  kind: 'article',
  publisher: 'mistboard',
  title: 'KataGo, a stronger Jungle Chess bot',
  cardTitle: 'KataGo, a stronger Jungle bot',
  seoTitle: 'KataGo for Jungle Chess: 82 wins, 118 draws and no losses against Misty',
  summary:
    'A Jungle Chess engine that learned by playing itself now sits above Misty. In 200 games against Misty it won 82, lost none and drew 118.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-03',
  updatedAt: '2026-10-07',
  thumbnail: { kind: 'svg', svg: KATAGO_JUNGLE_THUMBNAIL },
  audience: 'People who play Jungle Chess against the bot on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: `[Jungle Chess](/rules/jungle) on Mistboard has a new top bot. It is KataGo-AnimalChess, hzyhhzy's [KataGomo](${KATAGOMO}/tree/AnimalChess2025) built on lightvector's [KataGo](https://github.com/lightvector/KataGo), playing with the b10c384 network from Dandelion 4 by Kouza ([lxsgx23](https://github.com/lxsgx23)). We play it here with [hzyhhzy's permission](${KATAGOMO}/issues/12), under the name KataGo.`,
    },
    {
      kind: 'paragraph',
      text: 'KataGo learned Jungle Chess by playing itself, the way AlphaZero learned chess. A neural network proposes moves and judges positions, and a search checks its ideas. No other engine taught it.',
    },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: 'Play KataGo', href: '/bot/katago', emphasis: 'primary' },
        { label: 'See all bots', href: '/bots', emphasis: 'secondary' },
      ],
    },
  ],
  sections: [
    {
      heading: '82 wins and no losses against Misty',
      blocks: [
        {
          kind: 'paragraph',
          text: "Before putting it on the site, we played it against Misty, our own Jungle Chess bot, in an open challenge of 200 games at 1,000 visits a move. hzyhhzy's engine won 82, lost none and drew 118, a score of 0.705. Every win came from walking into Misty's den, and every draw was a repetition.",
        },
        {
          kind: 'paragraph',
          text: "Mistboard's own rules code refereed every game, and each engine only proposed moves. The budgets were matched on time, about two seconds a move on one machine: Misty at its usual 5 million nodes on one thread, KataGo at 1,000 visits on four threads with the b10c384 network. Both engines stop at a fixed amount of search, so the games played on Modal are the games either would play here. KataGo's own repetition rule was switched off, so the referee's applied to both sides.",
        },
        {
          kind: 'table',
          compact: true,
          keyColumn: true,
          headers: ['KataGo', 'Wins', 'Draws', 'Losses', 'Score'],
          rows: [
            ['As red, 100 games', '44', '56', '0', '0.72'],
            ['As black, 100 games', '38', '62', '0', '0.69'],
            ['Total', '82', '118', '0', '0.705'],
          ],
          highlightRows: [2],
          caption:
            'The median game ran 127 plies. The 95% interval on the score is 0.67 to 0.74, about +125 to +180 Elo; the challenge asked for 0.55.',
        },
        {
          kind: 'paragraph',
          // The records file is the brianhliou.com asset, copied to apps/web/public.
          text: 'All 200 games are in [one study](/study/0t8xpyv6), and the raw records are in [one file](/jungle-games/katago-vs-misty-2026-09-21.jsonl), a line of JSON per game.',
        },
      ],
    },
    {
      heading: 'The tiger now jumps the river sideways',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We found KataGo while searching GitHub for jieqi engines. It lives on the AnimalChess2025 branch of a repository named KataGomo, and nothing in that name says Jungle Chess, so an earlier search for Jungle engines had missed it.',
        },
        {
          kind: 'paragraph',
          text: "Its tiger jumps the river sideways as well as lengthwise, the same leap as the lion. Ours jumped lengthwise only, a reading taken from English Wikipedia's article. Tencent's QQ游戏 rules, Leiden University's Dou Shou Qi page and KataGo's own source all give the tiger the lion's jump, and a match between an engine trained on one rule and an engine playing another would have measured the rule.",
        },
        {
          kind: 'paragraph',
          text: 'Since 21 September the tiger on Mistboard jumps both ways, in the rules engine, the bot, the analysis board, the [rules page](/rules/jungle) and the puzzles. One puzzle the new jump refutes was withdrawn. The change only adds moves, so every earlier game is still legal as played.',
        },
      ],
    },
    {
      heading: 'Two wins, read by both engines',
      blocks: [
        {
          kind: 'paragraph',
          text: "We scored every position of two of those wins again with both engines, at the match settings. Each chart shows one number, KataGo's chance of winning, judged twice: once by KataGo and once by Misty. Where the lines part, the engines disagree about who is winning. A draw counts as half a win, and Misty's centipawns become a chance through the curve our analysis board uses, 1 / (1 + e^(−0.00368 × cp)).",
        },
        { kind: 'sub-heading', text: 'Game 67: a wolf up, and lost' },
        {
          kind: 'paragraph',
          text: "Misty, playing red, won a wolf on move 11 and read itself ahead for most of the game, while KataGo's score stayed at 50% and then climbed.",
        },
        gameChart(
          67,
          "Game 67: KataGo's chances of winning",
          "Game 67, KataGo's chances of winning as KataGo and Misty judged them. KataGo's jumps on move 29, when Misty plays tiger g8-g9; Misty's catches up on move 36.",
          24,
          {
            blunder: {
              side: 'left',
              level: 0.93,
              lines: ['Move 29: Misty plays tiger g8-g9', 'KataGo jumps from 61% to 92%'],
            },
            sees: { side: 'right', level: 0.42, lines: ['Move 36: Misty', 'finally sees it'] },
          },
        ),
        gameEmbed(67, 57, "Jungle Chess, game 67: Misty's moves marked by KataGo"),
        {
          kind: 'paragraph',
          text: "On move 29 Misty moved its cornered tiger from g8 to g9, and KataGo's score for itself went from 61% to 92% while Misty still read +111. KataGo's line for red starts with lion b1-b2 and keeps red at 37%. Misty only saw it on move 36, seven moves later.",
        },
        { kind: 'sub-heading', text: 'Game 94: the slow squeeze' },
        {
          kind: 'paragraph',
          text: "Misty, playing black, won a wolf on move 19 and read itself ahead for most of the next 30 moves, while KataGo's score crept from 50% to 63%.",
        },
        gameChart(
          94,
          "Game 94: KataGo's chances of winning",
          "Game 94, KataGo's chances of winning as KataGo and Misty judged them. KataGo's jumps on move 50, when Misty plays cat c8-c7; Misty's catches up on move 52.",
          40,
          {
            blunder: {
              side: 'left',
              level: 0.93,
              lines: ['Move 50: Misty plays cat c8-c7', 'KataGo jumps from 63% to 98%'],
            },
            sees: { side: 'left', level: 0.14, lines: ['Move 52: Misty', 'finally sees it'] },
          },
        ),
        gameEmbed(94, 100, "Jungle Chess, game 94: Misty's moves marked by KataGo"),
        {
          kind: 'paragraph',
          text: "On move 50 Misty moved its cat from c8 to c7, and KataGo went from 63% to 98%. Misty read +80 and found the forced loss two moves later. KataGo's line for black, elephant d6-d7, keeps black at 38%.",
        },
        {
          kind: 'paragraph',
          text: 'In these two games, KataGo saw the win seven moves and two moves before Misty did.',
        },
      ],
    },
    {
      heading: 'KataGo is the Go program, retrained by self-play',
      blocks: [
        {
          kind: 'paragraph',
          text: 'KataGo-AnimalChess is stock KataGo with the board and rules swapped for Jungle Chess and the self-play loop run as it was: 400 visits a move in self-play, a 10-block, 384-channel network trained by SGD on two GPUs, and rules randomised across the variants the Dandelion app supports, so one network plays all of them. The repository estimates under $50 of compute to reach top strength in a small game. The weights ship inside the app download, with no separate release and no stated licence.',
        },
        {
          kind: 'paragraph',
          text: "Misty's evaluation is three hand-written terms: material, distance to the den and a trap penalty. A learned correction on top of it did not help.",
        },
      ],
    },
    {
      // Folded in from the brianhliou.com post of 2026-08-31 ("Testing a
      // Den-Race Term in a Jungle Engine"), which 301s here. The deficit table
      // there (0, 0, 0, 0, 2, 2, 2, 4 plies over 8 races) has a median of 1, not
      // the "median of two plies" its prose said.
      heading: 'Misty has no idea of a den race',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Misty scores a position by material plus a bonus for each piece’s distance to the enemy den. It never asks whether a runner heading for its own den gets there first; it finds out when the search reaches the den, about 12 plies out. In August we tried three ways to teach it, and all three came back null or negative.',
        },
        {
          kind: 'paragraph',
          text: 'First, how often a race decides a game. Of 172 self-play games at Misty’s usual 5 million nodes, 52.9% ended in a repetition draw, 26.2% in a den entry and 20.9% in a no-progress draw. Only 4.7% were genuine races, won by a side that was level or behind ten plies out. The same test at 200k nodes reported 22%: weaker play inflates races about fivefold.',
        },
        {
          kind: 'paragraph',
          text: 'Deeper search finds little more. Over those 8 races, 60 million nodes saw the loss at most 4 plies sooner than 5 million, and no sooner in 4 of them. A search extension near the dens scored +45 Elo when granted free, at 3.3 times the nodes; held to the same budget, it scored −15 and −12. A den-race term, comparing the two runners once per side, scored −3 and +9 at weights 10 and 25. Each of those matches was 300 colour-swapped pairs.',
        },
        {
          kind: 'paragraph',
          text: 'Misty plays a race well enough when the search reaches it. In one self-play game under the old tiger rule, Red’s tiger took a wolf and stood in the d-file corridor beside Blue’s elephant. It could not jump sideways, so Blue did not hurry to take it. When the elephant stepped from d7 to d6, Red’s lion jumped from c3 to c7, into the square the elephant had left. The elephant took the tiger on d5, and the lion was three moves from a den Blue could not defend. Blue ended 13 points ahead and lost. Misty has no den-race term; depth found the line. Since 21 September the tiger jumps sideways, so the corridor no longer traps it.',
        },
        {
          kind: 'paragraph',
          text: 'What did move Jungle Chess was two constants from the same games: a no-capture draw clock that ended games early, and a draw contempt near zero. Changing them took self-play from a quarter of games decided to about half. The lesson we kept: hold the search budget fixed, or you measure the budget. The 52 games are in [one study](/study/4UhOMlsE).',
        },
      ],
    },
    {
      heading: 'Misty is still where you start',
      blocks: [
        {
          kind: 'paragraph',
          text: 'KataGo is at the top of the Jungle Chess bot list, above Misty. Misty stays the default and the easier opponent; pick KataGo when you want the stronger game. Game review and analysis for Jungle Chess still run on Misty.',
        },
        {
          kind: 'paragraph',
          text: 'On the site KataGo searches 150 visits a move, which takes about 1.5 to 3.5 seconds. At that setting it scored 19 wins, no losses and 31 draws in 50 games against Misty, 0.690, which cannot be told apart from the 1,000-visit result. The strength is in the network.',
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `KataGomo is open source at [github.com/hzyhhzy/KataGomo](${KATAGOMO}). Thank you, hzyhhzy, for the engine and for letting us use it; lightvector, for KataGo; and Kouza, for the Dandelion 4 network.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play KataGo', href: '/bot/katago', emphasis: 'primary' },
            { label: 'Jungle Chess rules', href: '/rules/jungle', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
