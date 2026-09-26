import type { Article, ArticleBlock } from '../types.js';
import { BANQI_LUCK_FLIP_AFTER, BANQI_LUCK_FLIP_BEFORE } from '../banqi-luck-diagrams.js';
import { BANQI_LUCK_CHART_SVG, BANQI_LUCK_THUMBNAIL_SVG } from './banqi-luck-chart.js';
import { BANQI_LUCK_FLIP_POOL, BANQI_LUCK_GAME } from './banqi-luck-game.js';

// The decision-vs-luck methodology essay. Every measured number in the prose
// comes from the offline mining run recorded in docs-private/luck-article/
// (FINDINGS.md holds the per-game data; the chart + exhibit game files beside
// this one are generated from the same run). Exhibit games are real prod games
// on brianhliou's accounts.
const FLIP_POOL_ROWS = BANQI_LUCK_FLIP_POOL.rows.map((row) => [
  `${row.color} ${row.role}`,
  `×${row.count}`,
  `${row.win.toFixed(0)}%`,
]);
const FLIP_POOL_ACTUAL_ROW = BANQI_LUCK_FLIP_POOL.rows.findIndex((row) => row.actual);

export const banqiLuckArticle: Article = {
  slug: 'skill-vs-luck',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Separating Skill from Luck in Flip Games',
  seoTitle: 'Game Review for Banqi, Jieqi and Flip Jungle: Skill vs Luck',
  summary:
    'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Mistboard’s game review splits every flip into the decision and the tile: luck-stripped accuracy, a luck line on the advantage graph, and what 52 human-versus-engine games say about who really earned their wins.',
  status: 'published',
  publishedAt: '2026-08-22',
  audience:
    'Banqi, jieqi, and jungle players who want an honest review of their games, and anyone curious how you grade a move that includes a dice roll.',
  thumbnail: { kind: 'svg', svg: BANQI_LUCK_THUMBNAIL_SVG },
  intro: [
    {
      kind: 'paragraph',
      text:
        'Mistboard’s game review now splits every flip into the decision you made and the tile you got. The first thing I did was run it over my own old games. It found a banqi win of mine against our own bot, from two months back, and handed the credit to the tiles.',
    },
    {
      kind: 'paragraph',
      text:
        'The review scores everything in win chance, its 0-to-100 estimate of your odds of winning the game. My flips came out **76 points better than average**. The bot’s came out 12 points worse. I made the worse decisions, by a wide margin. I won anyway.',
    },
    {
      kind: 'svg-row',
      items: [{ svg: BANQI_LUCK_FLIP_BEFORE }, { svg: BANQI_LUCK_FLIP_AFTER }],
      caption:
        'The flip that decided it, from the real game. One face-down tile on g3, twelve possible pieces. This article is about pricing that moment honestly.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'Most game review tools cannot say any of that.',
    },
  ],
  sections: [
    {
      heading: 'A flip is a decision plus a dice roll',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Half the moves in a banqi game turn over a face-down tile. One move, two parts: choosing which tile to turn, and finding out what it is. Jieqi’s reveals and flip jungle’s flips are the same problem wearing different pieces; banqi is the worked example throughout because its bag is the purest.',
        },
        {
          kind: 'paragraph',
          text:
            'A chess-style review grades the swing of the whole move. Flip the corner tile, find the enemy general, and the review calls it a blunder. It was a bad tile, not a bad decision.',
        },
        {
          kind: 'paragraph',
          text:
            'This is why banqi reviews on Mistboard show no centipawn loss: it cannot be separated from the tiles, so next to numbers that can be, it reads as noise.',
        },
      ],
    },
    {
      heading: 'Backgammon solved this decades ago',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Backgammon software prices every roll against the average roll and reports a luck-adjusted result, so a match report can tell you that you played better and lost. GnuBG and eXtreme Gammon both do it. Poker has the same idea in all-in EV.',
        },
        {
          kind: 'paragraph',
          text:
            'Chess never built any of this because chess has no dice. Banqi is a chess-family game with dice in it, and it inherited chess’s tools, which have no luck column.',
        },
      ],
    },
    {
      heading: 'The average tile in the bag',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Banqi’s chance is countable. Both players can see which tiles are still face down, and the full set of pieces is known, so at any flip you can list every tile that square could be. That makes the honest baseline computable:',
        },
        {
          kind: 'code',
          text:
            'for each tile the square could be:\n    put that tile under the square\n    play the flip\n    evaluate the position\naverage the results, weighted by count',
        },
        {
          kind: 'paragraph',
          text:
            'That average is what your decision was worth **before the dice**. Three numbers per flip:',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['per flip', 'meaning'],
          rows: [
            ['played', 'the average value of the flip you chose'],
            ['best', 'the same average for the best move available'],
            ['realized', 'what your actual tile produced'],
          ],
        },
        {
          kind: 'code',
          text:
            'decision loss = best - played      (skill, always >= 0)\nluck          = realized - played  (the dice, signed)',
        },
        {
          kind: 'paragraph',
          text:
            'Zero luck is exactly the average tile in the bag, by construction, not by an engine’s opinion.',
        },
        { kind: 'sub-heading', text: 'The flip from the intro, enumerated' },
        {
          kind: 'paragraph',
          text:
            'Ply 6 of the game this article opens with: I turn the tile on g3. Twenty-seven tiles are still face down, twelve kinds, and each one leads to a different game.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['what the g3 tile could be', 'count', 'win% for Black'],
          rows: FLIP_POOL_ROWS,
          highlightRows: [FLIP_POOL_ACTUAL_ROW],
        },
        {
          kind: 'paragraph',
          text:
            'The same flip is worth anywhere from 13% (my own general, deep in contested ground) to 82% (my own soldier, safe and useful there). The weighted average is 45%. **That number is the decision**, and it is what accuracy grades.',
        },
        {
          kind: 'paragraph',
          text:
            'The highlighted row is what the bag actually handed me. Realized 82, played 45, luck plus 37, and none of it to my credit.',
        },
        { kind: 'sub-heading', text: 'Engines are biased about their own dice' },
        {
          kind: 'paragraph',
          text:
            'The obvious shortcut is to ask the engine what a flip move is worth and call the difference luck. Our jieqi engine showed why not: it over-values its reveals and plays greedy, gambling lines. Averaging fixed positions, each with the tile already decided, keeps the chance node out of the search entirely, so the bias has nowhere to live.',
        },
        { kind: 'sub-heading', text: 'The flip that deals you your color' },
        {
          kind: 'paragraph',
          text:
            'The first flip of the game decides which color you play: whatever ink comes up, that side is yours. The counterfactuals for that flip vary your own army, so the decomposition prices "which side did I get" as luck. That sounds wrong for about ten seconds, and then it sounds exactly right.',
        },
      ],
    },
    {
      heading: 'What the review draws',
      blocks: [
        {
          kind: 'raw-svg',
          svg: BANQI_LUCK_CHART_SVG,
          caption:
            'The game from the intro. Solid: the game as played, from Red’s side. Dashed: the same game with every flip at its average. The gap is the luck.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'The advantage graph gets a second line. Solid is the game as it happened. Dashed is the same game with every flip scored at its average tile. Between flips the two lines move together, because ordinary moves affect both versions equally. At each flip the gap changes by exactly that flip’s luck, so by the end the gap is the whole game’s luck added up.',
        },
        {
          kind: 'paragraph',
          text:
            'That is why the dashed line here runs one way while the solid line swings. My luck kept landing in the same direction, flip after flip, so the gap only grew. Scored on decisions alone the bot was winning nearly throughout, and once the dashed line says the game should be completely won it pins at the top.',
        },
        {
          kind: 'paragraph',
          text:
            'The move list carries the split per move. Every flip gets a dice badge with its luck, next to the eval, and decisions are graded separately: move 3 below is the +37% flip, marked dubious as a choice even though it won me the game.',
        },
        // Real product UI, captured from this exhibit game's review page (the
        // local render of the same cached analysis prod serves).
        {
          kind: 'image-figure',
          src: '/article-thumbs/skill-vs-luck-movelist.png',
          alt: 'The review move list: each flip carries a dice badge with its luck percentage beside the eval, and move 3, the +37% flip, is graded ?! as a decision.',
          caption: 'The exhibit game’s move list. Move 3 is the +37% flip, dubious as a decision.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'And accuracy is graded on the decision numbers only, so a lucky flip does not improve it and an unlucky one does not hurt it. The summary for this game reads exactly the way the story went: the bot played clean, I did not, and the result said otherwise.',
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/skill-vs-luck-summary.png',
          alt: 'The luck-stripped accuracy summary for the exhibit game: MistyBanqi 95% accuracy with no mistakes, dev-testing 89% with nine inaccuracies, two mistakes, and two blunders.',
          caption: 'The same game’s luck-stripped summary. dev-testing is me, on my test account.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The receipts',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The win I opened with: 156 plies against the bot, and the graph tells on me. At ply 6 the 45% flip came up worth 82%. No decision in the game moved the needle that far.',
        },
        {
          kind: 'paragraph',
          text:
            'In total: my flips **plus 76**, the bot’s minus 12, and my flip decisions gave away 74 points against the bot’s zero. The dashed line has me losing most of the game. The solid line has me winning. The bag overruled the play. The whole game is [open on Mistboard](/banqi/game/bq_7e8ce2e7-8e64-4453-b9fd-9dcc4bd52fa9), replay below.',
        },
        {
          kind: 'banqi-replay',
          spec: {
            red: 'MistyBanqi',
            black: 'brianhliou',
            event: 'The game from the intro, live on Mistboard',
            outcome: 'Black wins · 156 plies · net luck +88 to Black',
            resultText:
              'Black wins when Red runs out of moves. The decision numbers say Red earned the better game; the tiles said otherwise, starting with the flip at ply 6.',
            deal: BANQI_LUCK_GAME.deal,
            moves: BANQI_LUCK_GAME.moves,
          },
          caption: 'Step to ply 6: the flip worth 45% on average that came up worth 82%.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'It cuts the other way too. In [another game](/banqi/game/bq_123a6232-6f9f-4677-90ae-a75d5700a446) I lost, one flip at ply 19 cost 34 points of win chance on its own. My decisions that game were ordinary. The old review would have marked that flip as the losing blunder. The new one marks it as the moment the game was decided by something that was not a choice.',
        },
      ],
    },
    {
      heading: 'Fifty-two games of evidence',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'We ran the decomposition over 52 recent human-versus-Misty banqi games from the site.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['across 52 human vs Misty games', 'value'],
          rows: [
            ['human record', '14 wins, 33 losses, 5 draws'],
            ['net luck toward the human, in the wins', '+28 points on average'],
            ['net luck toward the human, in the losses', '−9 points on average'],
          ],
          highlightRows: [1],
        },
        {
          kind: 'paragraph',
          text:
            'The bot is stronger, and beating it has usually taken help from the bag. If you have beaten it, the review will now tell you how much help you got.',
        },
      ],
    },
    {
      heading: 'Jieqi rolls different dice',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Jieqi gets the same treatment with a different pool. A jieqi reveal draws from your own remaining dark pieces, so you know the color and not the piece. A banqi tile is dark to both players, color included. Different bags, same arithmetic, and jungle’s flip variant makes a third. Every one of them gets the dashed line.',
        },
      ],
    },
    {
      heading: 'For the builders',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Three choices keep the numbers honest. First, **a counterfactual must not change what is in the bag**. Relabel the flipped square from a soldier to a cannon and you have quietly added a cannon to the game and removed a soldier, which rebalances the position by two pieces and inflates the average. So the implementation swaps: the counterfactual tile trades places with a face-down square that really holds one, and the hidden set stays exactly the game’s.',
        },
        {
          kind: 'paragraph',
          text:
            'Second, **one bounded scale**. Everything is win chance from the flipping player’s side: it adds up across a game, a flip that ends the game scores exactly 100, 50, or 0, and a flip that walks into mate has no centipawn value anyway. Search budgets are node counts rather than time, so the same game grades identically on any machine.',
        },
        {
          kind: 'paragraph',
          text:
            'Third, **under-count on purpose**. The decision ceiling considers only the engine’s top move, so a better move the engine ranked second is missed and decision loss is only ever understated. The review can fail to flag a mistake. It cannot invent one.',
        },
      ],
    },
    {
      heading: 'Where the numbers stop',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'The win percentages come from our banqi engine at a fixed search budget, and that engine is also the opponent in these games, so its own flips grade as near-perfect partly because it agrees with itself. Read "the bot lost zero points" with that in mind. The human numbers have no such problem.',
        },
        {
          kind: 'paragraph',
          text:
            'One more honest limit: subtracting luck point-by-point treats win chance as linear, which it is not. The directions are trustworthy. The second decimal is not.',
        },
      ],
    },
    {
      heading: 'Try it on your own games',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Open any finished banqi, jieqi, or jungle flip game on Mistboard, yours or anyone’s from the [watch page](/watch), and request computer analysis. The luck numbers appear per flip in the move list, and the dashed line shows the game the bag would have given you.',
        },
        {
          kind: 'paragraph',
          text:
            'Sometimes it agrees you were robbed. Sometimes it takes your win away. It did both to me in a single pass over my old games.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play Banqi', href: '/?play=computer&gameSpecId=banqi', emphasis: 'primary' },
            { label: 'Play Jieqi', href: '/?play=computer&gameSpecId=jieqi', emphasis: 'secondary' },
            {
              label: 'Play Jungle Flip',
              href: '/?play=computer&gameSpecId=jungle-flip',
              emphasis: 'secondary',
            },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
