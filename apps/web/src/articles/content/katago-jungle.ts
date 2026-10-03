import type { Locale } from '../../i18n/locale.js';
import { evalCompareChartSvg } from '../eval-compare-chart.js';
import {
  type EvalsData,
  type EvaluatedGame,
  MARK_GLYPH,
  mistyMoveMarks,
  seriesFor,
  settledPly,
  winnerSeries,
} from '../katago-jungle-analysis.js';
import type { Article, ArticleBlock } from '../types.js';
import evalsJson from './katago-jungle-evals.json' with { type: 'json' };

// Facts from the KataGo seat (#434, be6fc95e) and the match write-up linked
// below: 200 games against MistyJungle at 1,000 visits a move (82-0-118, 0.705,
// study 0t8xpyv6), then 50 at the site's 150 visits (19-0-31, 0.690).
//
// Text card in the Pikafish card's family, set in the page's language: the
// reader's script leads and the other name sits above it, small. The palette is
// the jungle diagrams' green.
const KATAGO_JUNGLE_THUMBNAIL = (locale: Locale): string => {
  const zh = locale === 'zh-Hans' || locale === 'zh-Hant';
  const hanzi = locale === 'zh-Hant' ? '鬥獸棋' : '斗兽棋';
  const above = zh ? 'KATAGO' : hanzi;
  const lead = zh ? hanzi : 'KATAGO';
  const tagline = zh
    ? locale === 'zh-Hant'
      ? '新的最強電腦'
      : '新的最强电脑'
    : 'THE TOP JUNGLE CHESS BOT';
  const hanziFont =
    "'Noto Sans SC', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif";
  const latinFont = 'Roboto, system-ui, sans-serif';
  const ink = '#1f6f5b';
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" ',
    'preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" ',
    `aria-label="A card reading ${zh ? hanzi : 'KataGo'}, the top Jungle Chess bot">`,
    '<rect x="0" y="0" width="320" height="200" fill="#dfe8cf"/>',
    `<text x="160" y="62" text-anchor="middle" font-family="${zh ? latinFont : hanziFont}" `,
    `font-size="${zh ? 22 : 26}" font-weight="700" letter-spacing="${zh ? 6 : 10}" fill="${ink}" `,
    `opacity="0.5"${zh ? ' translate="no"' : ''}>${above}</text>`,
    `<text x="160" y="118" text-anchor="middle" font-family="${zh ? hanziFont : latinFont}" `,
    `font-size="${zh ? 46 : 40}" font-weight="700" letter-spacing="${zh ? 8 : 0}" fill="${ink}"`,
    `${zh ? '' : ' translate="no"'}>`,
    `${lead}</text>`,
    `<text x="160" y="150" text-anchor="middle" font-family="${zh ? hanziFont : latinFont}" `,
    `font-size="${zh ? 16 : 15}" font-weight="600" letter-spacing="${zh ? 3 : 1.4}" `,
    `fill="${ink}" opacity="0.62">`,
    `${tagline}</text>`,
    '</svg>',
  ].join('');
};

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
  id: '11Jru0He',
  chapters: { 67: '1AurXLdB', 94: '0SKU4EJs' },
} as const;

function gameChart(game: number, heading: string, ariaLabel: string): ArticleBlock {
  const g = evaluatedGame(game);
  const s = katagoScoreSeries(g);
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
      threshold: { level: SETTLE_LEVEL, settledA: s.settledKata, settledB: s.settledMisty },
      marks: mistyMoveMarks(g).map((m) => ({ ply: m.ply + 1, glyph: MARK_GLYPH[m.mark] })),
      xLabel: 'Ply',
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

export const katagoJungleArticle: Article = {
  slug: 'katago-jungle',
  kind: 'article',
  publisher: 'mistboard',
  title: 'KataGo, a stronger Jungle Chess bot',
  seoTitle: 'KataGo for Jungle Chess: 82 wins, 118 draws and no losses against Misty',
  summary:
    'A Jungle Chess engine that learned by playing itself now sits above Misty. In 200 games against Misty it won 82, lost none and drew 118.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-03',
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
          text: 'All 200 games are in [one study](/study/0t8xpyv6), and the [match write-up](https://brianhliou.com/posts/katago-beats-misty-jungle/) has the details.',
        },
      ],
    },
    {
      heading: 'Two wins, read by both engines',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Here are two of those wins, with every position scored again by both engines at the match settings. Each chart shows both engines\' estimate of KataGo\'s score, where a win is 100% and a draw 50%. KataGo\'s own number counts a draw as half a point; Misty\'s centipawns become a score through the curve our analysis board uses, 1 / (1 + e^(−0.00368 × cp)). The dashed line is 80%, and each dotted line marks the ply from which that engine stayed above it to the end. A ply is one side\'s move.',
        },
        { kind: 'sub-heading', text: 'Game 67: a wolf up, and lost' },
        {
          kind: 'paragraph',
          text: "Misty played red. On ply 21 its tiger took KataGo's wolf, and Misty scored itself 113 centipawns ahead. KataGo's number stayed at 50%. On ply 57 Misty moved its cornered tiger from g8 to g9, and KataGo's score for itself went from 61% to 92%. KataGo marks the move ?? and would have played lion b1-b2 instead. Misty still read itself a wolf up, at +111. KataGo stayed above 80% from there to the den on ply 90; Misty got there on ply 72, 15 plies later.",
        },
        gameChart(
          67,
          "Game 67: KataGo's score, as each engine saw it",
          "Game 67, KataGo's expected score by ply as KataGo and Misty saw it. KataGo stays above 80% from ply 57, Misty from ply 72.",
        ),
        gameEmbed(67, 57, "Jungle Chess, game 67: Misty's moves marked by KataGo"),
        { kind: 'sub-heading', text: 'Game 94: the slow squeeze' },
        {
          kind: 'paragraph',
          text: "KataGo played red. On ply 38 Misty's tiger took KataGo's wolf, and Misty scored itself ahead for most of the next 60 plies. KataGo saw the game tipping its way instead, slowly, from 50% to 63% by ply 90. On ply 100 Misty moved its cat from c8 to c7, and KataGo's score went from 63% to 98%. KataGo marks it ?? and would have played elephant d6-d7. Misty still had itself ahead, at +80, and found the forced loss four plies later. KataGo's lion reached the den on ply 117.",
        },
        gameChart(
          94,
          "Game 94: KataGo's score, as each engine saw it",
          "Game 94, KataGo's expected score by ply as KataGo and Misty saw it. KataGo stays above 80% from ply 100, Misty from ply 104.",
        ),
        gameEmbed(94, 100, "Jungle Chess, game 94: Misty's moves marked by KataGo"),
        {
          kind: 'paragraph',
          text: 'In both games Misty was a piece up and still read itself ahead after the move that lost. In these two games, KataGo settled on the result 15 and 4 plies before Misty did. Each marked move in the study has KataGo\'s choice beside it.',
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
