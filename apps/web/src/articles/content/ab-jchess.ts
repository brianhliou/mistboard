import type { Locale } from '../../i18n/locale.js';
import {
  type AbExamplesData,
  type AbMatchGame,
  abSideSeries,
  pikaMoveMarks,
  settledFrom,
} from '../ab-jchess-examples.js';
import { evalCompareChartSvg } from '../eval-compare-chart.js';
import { MARK_GLYPH } from '../katago-jungle-analysis.js';
import { textCard } from '../text-card.js';
import type { Article, ArticleBlock } from '../types.js';
import examplesJson from './ab-jchess-examples.json' with { type: 'json' };

// Text card (text-card.ts). The engine has no Chinese name, so AB-JCHESS stays
// as written in every language.
const AB_JCHESS_THUMBNAIL = (locale: Locale): string =>
  textCard(
    {
      palette: 'xiangqi',
      eyebrow: 'JIEQI',
      lead: { text: 'AB-JCHESS', name: true },
      tagline: 'A STRONGER BOT',
      ariaLabel: 'A card reading AB-JChess, a stronger jieqi bot',
    },
    locale,
  );

const REPO = 'https://github.com/lxsgx23/AB-JChess';

// Two of AB-JChess's wins from the match, every position scored again by both
// engines (AB-JChess at 1 million nodes, the fixed Pikafish at 64 million) and
// Pikafish's moves marked by AB-JChess. Charts, marks and the numbers the prose
// quotes come from this data; ab-jchess-examples.test.ts pins the prose.
export const AB_EXAMPLES = examplesJson as AbExamplesData;
export const AB_SETTLE_LEVEL = 0.8;

export function abExampleGame(game: number): AbMatchGame {
  const found = AB_EXAMPLES.games.find((g) => g.game === game);
  if (!found) throw new Error(`ab-jchess: game ${game} is not in the examples data`);
  return found;
}

/** AB-JChess's score as each engine saw it, and the ply each settled above AB_SETTLE_LEVEL. */
export function abScoreSeries(game: AbMatchGame) {
  const ab = abSideSeries(game, 'ab');
  const pk = abSideSeries(game, 'pk');
  return {
    ab,
    pk,
    settledAb: settledFrom(ab, AB_SETTLE_LEVEL),
    settledPk: settledFrom(pk, AB_SETTLE_LEVEL),
  };
}

// The annotated games: @mistboard's public study Df5rtaMN on mistboard.com,
// made from scripts/variant-lab/ab-jchess-annotated-study.ts (one chapter a
// game) by study:edit on 2026-10-03. Rewrite its trees with that script's
// --update mode, never by hand.
export const AB_JCHESS_STUDY = {
  id: 'Df5rtaMN',
  chapters: { 68: 'Gq3g6Oqx', 6: '3p8LDUEQ' },
} as const;

type ChartNote = { lines: readonly string[]; side: 'left' | 'right'; level: number };

/**
 * One game's chart, the KataGo post's style: moves numbered as on the board
 * below it, each line named on the plot, and two notes: on AB-JChess's line at
 * the position the board opens on, and on Pikafish's line where it comes round
 * (its settle point). The plies come from the data; words and placement from
 * the post.
 */
function gameChart(
  game: number,
  heading: string,
  ariaLabel: string,
  opensAt: number,
  labelsAt: number,
  notes: { opens: ChartNote; agrees: ChartNote },
): ArticleBlock {
  const g = abExampleGame(game);
  const s = abScoreSeries(g);
  return {
    kind: 'raw-svg',
    className: 'article-figure-eval-compare',
    // Phone width shrinks the axis text below reading size; a tap opens it full screen.
    zoomable: true,
    svg: evalCompareChartSvg({
      id: `ab-jchess-g${game}`,
      heading,
      ariaLabel,
      nameA: 'AB-JChess',
      nameB: 'Pikafish',
      a: s.ab,
      b: s.pk,
      xLabel: 'Move',
      axis: 'move',
      yTicks: [0.5, 1],
      lineLabels: { at: labelsAt, a: 'AB-JChess thinks', b: 'Pikafish thinks' },
      callouts: [
        { ply: opensAt, on: 'a', ...notes.opens },
        { ply: s.settledPk!, on: 'b', ...notes.agrees },
      ],
    }),
  };
}

function gameEmbed(game: 68 | 6, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/study/${AB_JCHESS_STUDY.id}/${AB_JCHESS_STUDY.chapters[game]}?ply=${ply}`,
    title,
    // Width-bound at the 702px column, as the KataGo post's embeds.
    aspect: [702, 780],
  };
}

export const abJchessArticle: Article = {
  slug: 'ab-jchess',
  kind: 'article',
  publisher: 'mistboard',
  title: 'AB-JChess, a stronger jieqi bot',
  seoTitle: 'AB-JChess: the open-source jieqi engine that beat Pikafish 248 to 136',
  summary:
    'An open-source jieqi engine with its own neural network now sits above Pikafish Level 8. It beat full-strength Pikafish 248 to 136 in 400 games.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-02',
  thumbnail: { kind: 'svg', svg: AB_JCHESS_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard.',
  intro: [
    {
      kind: 'paragraph',
      text: `[Jieqi](/rules/jieqi) on Mistboard has a new top bot. [AB-JChess](${REPO}) is an open-source jieqi engine by Huorongrong and Laoxu (Kouza), and we play it here with their permission. It sits above Pikafish Level 8, the bot people have been playing since August.`,
    },
    {
      kind: 'paragraph',
      text: "In late September, before putting it on the site, we played it against that bot: 400 games at 4 seconds a move, on the same settings the site uses, with AB-JChess's network of September 11. AB-JChess won 248, lost 136 and drew 16, a 64% score. It won as Red and as Black.",
    },
    {
      kind: 'paragraph',
      text: 'All 400 games are on the site, each with its own review page: [browse the match](/games/search?variant=jieqi&source=engine-match).',
    },
    {
      kind: 'cta',
      layout: 'single-row',
      buttons: [
        { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
        { label: 'See all levels', href: '/bots', emphasis: 'secondary' },
      ],
    },
  ],
  sections: [
    {
      heading: 'Two ways to be strong',
      blocks: [
        {
          kind: 'paragraph',
          text: `[Pikafish](https://github.com/official-pikafish/Pikafish) is built for speed. It looks at more than a million positions a second and judges each one by rules written by hand. AB-JChess is built from Pikafish too, but it judges positions with a neural network trained on about a billion jieqi positions. It looks at about fifty times fewer positions, and understands each one better. Its training code is public in the same repository, under [abjchess-nnue-pytorch](${REPO}/tree/main/abjchess-nnue-pytorch).`,
        },
      ],
    },
    {
      heading: 'Where the edge comes from',
      blocks: [
        // Match-wide counts from run7's in-game numbers (each engine's score with
        // its own move, on the fitted curves): mistboard-engine
        // lab/jieqi-abjchess-2026-09-29/examples/disagree.py.
        {
          kind: 'paragraph',
          text: 'Each engine reported a score with every move it played in the match, and when the two disagreed, AB-JChess was usually the one that was right. In 137 games there came a point where AB-JChess gave itself 75% or more while Pikafish, on the move before or after, gave AB-JChess 60% or less. AB-JChess won 115 of those games, lost 13 and drew 9. The other way round, Pikafish at 75% or more for itself while AB-JChess gave it 60% or less, happened in 202 games, and Pikafish won 101 of them, lost 90 and drew 11. These are the numbers Pikafish reported during the match, with the reveal bug we have since fixed.',
        },
        {
          kind: 'paragraph',
          text: "Here are two of AB-JChess's wins, both as Red, where its score climbed while Pikafish's stayed level. We scored every position again with both engines, AB-JChess searching 1 million positions and the fixed Pikafish 64 million, and turned each engine's numbers into an expected score with a curve fitted on the match. Each chart shows AB-JChess's score as each engine saw it, with moves numbered as on the board below it. On the boards, ?! marks a Pikafish move that cost 5 to 10 points by AB-JChess's count; neither game has a worse one.",
        },
        { kind: 'sub-heading', text: 'Game 68: two advisors and an elephant, for an attack' },
        {
          kind: 'paragraph',
          text: "Pikafish, as Black, took a face-down advisor with its chariot on move 11, then sent the horse that came up on b1 into Red's camp, where it took the second advisor and an elephant. AB-JChess spent those moves bringing a chariot, a horse and a soldier near Black's king. From move 13 to move 21, AB-JChess never had Red below 69%; Pikafish, searching the same positions, had Red between 40% and 58%.",
        },
        gameChart(
          68,
          "Game 68: AB-JChess's score, as each engine saw it",
          "Game 68, AB-JChess's expected score by move as AB-JChess and Pikafish saw it. On move 18 AB-JChess has Red at 85% and Pikafish at 50%; Pikafish agrees from move 23.",
          36,
          26,
          {
            opens: {
              side: 'left',
              level: 0.97,
              lines: ['Move 18: the horse takes the elephant', 'AB-JChess 85%, Pikafish 50%'],
            },
            agrees: { side: 'right', level: 0.42, lines: ['Move 23: Pikafish', 'agrees'] },
          },
        ),
        gameEmbed(68, 36, "Jieqi, game 68: Pikafish's moves marked by AB-JChess"),
        {
          kind: 'paragraph',
          text: "On move 18 the horse took the elephant on c1. AB-JChess had Red at 85%; Pikafish had Red at 50%, and during the game it had reported 47%. Red's elephant took the horse on move 20. Pikafish's own score for Red reached 85% on move 21, when the piece it turned over on b10 came up a soldier.",
        },
        { kind: 'sub-heading', text: 'Game 6: one chariot against a face-down back row' },
        {
          kind: 'paragraph',
          text: "In game 6 AB-JChess took an advisor with its chariot on move 15 and let the chariots come off. After move 16 Red had the only chariot on the board, and the seven pieces Black had not turned over could only be five soldiers and two horses. AB-JChess had Red at 83%; Pikafish had Red at 48%.",
        },
        gameChart(
          6,
          "Game 6: AB-JChess's score, as each engine saw it",
          "Game 6, AB-JChess's expected score by move as AB-JChess and Pikafish saw it. On move 16 AB-JChess has Red at 83% and Pikafish at 48%; Pikafish agrees from move 21.",
          31,
          22,
          {
            opens: {
              side: 'left',
              level: 0.97,
              lines: ['Move 16: the chariots are off', 'AB-JChess 83%, Pikafish 48%'],
            },
            agrees: { side: 'right', level: 0.42, lines: ['Move 21: Pikafish', 'agrees'] },
          },
        ),
        gameEmbed(6, 31, "Jieqi, game 6: Pikafish's moves marked by AB-JChess"),
        {
          kind: 'paragraph',
          text: "Red's chariot reached Black's back row on move 19 and took two horses there. AB-JChess had Red above 80% from move 17, Pikafish from move 21.",
        },
        { kind: 'sub-heading', text: 'What a longer search says' },
        {
          kind: 'paragraph',
          text: "We searched each of the five marked moves again, the game move and AB-JChess's choice each on its own: AB-JChess at 4 million positions, the fixed Pikafish at 256 million. AB-JChess still puts two of them 5 points or more below its choice and the other three within 2 points. Pikafish prefers AB-JChess's choice once and its own game move four times. So the single moves are close calls. The gap is in the scores the two engines give the positions, and in both games Pikafish's own score came round to AB-JChess's later: on move 23 rather than 18 in game 68, and on move 21 rather than 17 in game 6. The study shows both engines' numbers at every marked move.",
        },
      ],
    },
    {
      heading: 'Where it sits',
      blocks: [
        {
          kind: 'paragraph',
          text: 'AB-JChess is at the top of the jieqi bot list, above Level 8. Levels 1 to 8 stay Pikafish, and Level 4 is still where a new player starts. It does not take a level number: the top place holds the strongest jieqi engine we have measured, under its own name. Its rating on the [bots page](/bots), 2354 against Level 8\'s 2226, comes from the same bot-against-bot games that rate the levels. Its authors are training stronger networks; when one is released, we will play it against this one and switch if it wins.',
        },
        {
          kind: 'paragraph',
          text: 'While writing this post we found a bug in how our Pikafish bot scored reveals. It is fixed; [a follow-up post](/blog/pikafish-reveal-bug) covers what it was and what it cost.',
        },
      ],
    },
    {
      heading: 'Thanks',
      blocks: [
        {
          kind: 'paragraph',
          text: `AB-JChess is open source under the GPL-3.0 licence, at [github.com/lxsgx23/AB-JChess](${REPO}). Its authors let us use the engine and its network on Mistboard. The network is downloaded from their own release each time we build the site, never re-hosted. Thank you, Huorongrong and Laoxu.`,
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play AB-JChess', href: '/bot/ab-jchess', emphasis: 'primary' },
            { label: 'Jieqi rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
