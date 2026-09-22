// The banqi result post (growth plan lane 0, #422): 200 MistyBanqi self-play
// games at ten million nodes, run on Modal, reduced by
// scripts/banqi-games-stats.ts. Every rate carries its count so a reader can
// redo the arithmetic.
//
// Two rewrites so far. 2026-09-22 morning, on Brian's "restructure": the draft
// led with the first-player rate, which is a null result, and buried the
// finding that clears its own error bar. 2026-09-22 evening, on "quite wordy
// without diagrams, hard to digest" and "is there any more value": the prose is
// cut by a third, each section carries a figure from
// ../banqi-statistics-diagrams.js, and the lead-safety grid is new work (the
// stats script now snapshots material at fixed moves) because "how big a lead
// is safe" is the question a player actually has. Primary reader is Taiwanese,
// in zh-Hant; the English is the dictionary key.
import {
  BANQI_LEAD_SAFETY_GRID,
  BANQI_LEAD_SETTLE_CHART,
  BANQI_STATS_AFTER,
  BANQI_STATS_BEFORE,
} from '../banqi-statistics-diagrams.js';
import { BANQI_ONLINE_THUMBNAIL } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

const PLAY_ENGINE = '/?play=computer&gameSpecId=banqi';
const PLAY_FRIEND = '/?play=friend&gameSpecId=banqi';

export const banqiStatisticsArticle: Article = {
  slug: 'banqi-statistics',
  kind: 'article',
  publisher: 'mistboard',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  playableOnMistboard: true,
  title: 'Banqi by the Numbers',
  seoTitle: 'Banqi Statistics: How Big a Lead Is Safe, and When',
  summary:
    'MistyBanqi played itself 200 times at ten million nodes a move under the Taiwanese competition rules. A lead of one or two small pieces is a coin flip at move 30; eleven points is 98%. The side that loses its general first loses 87% of the time.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-23',
  audience:
    'Banqi players who want numbers behind the questions every table argues about: how big a lead is safe, when a game is decided, what losing the general costs, and whether flipping first is an advantage.',
  thumbnail: { kind: 'svg', svg: BANQI_ONLINE_THUMBNAIL },
  readNext: ['banqi', 'mistybanqi', 'skill-vs-luck'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi has no game database. Xiangqi has a century of master games and chess has hundreds of millions; banqi is played in parks and on phones, and the games are gone when the tiles go back in the box. So the questions every table argues about have no numbers behind them. Am I winning? When is it over? Does flipping first help?',
    },
    {
      kind: 'paragraph',
      text: 'Here are 200 games of [MistyBanqi](/blog/mistybanqi) against itself, ten million nodes a move, under the [Taiwanese competition rules](/rules/banqi) this site plays. Every game is a fresh deal, both seats are the same engine at the same search, and material is counted on one fixed scale throughout: general 12, advisor 7, elephant and cannon 6, chariot 5, horse 4, soldier 2.',
    },
    {
      kind: 'table',
      headers: ['200 games, MistyBanqi against itself at 10M nodes', 'value'],
      rows: [
        ['decided', '168 (84%)'],
        ['drawn', '32 (16%)'],
        ['median length', '75 moves a side'],
        ['median captures', '27 of 32 pieces'],
        ['a general captured', '188 games (94%)'],
        ['first player won, of decided games', '89 of 168 (53%)'],
      ],
    },
  ],
  sections: [
    {
      heading: 'A lead under a cannon is not a lead',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The question a player has mid-game is whether the material on the table means anything yet. It depends on the size, and less than you would think on the clock.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_LEAD_SAFETY_GRID,
          caption:
            'How often the side ahead on material went on to win, by the size of the lead and the move it was measured at. Percentages are of decided games; drawn games sit in the counts but not the rate.',
        },
        {
          kind: 'paragraph',
          text: 'One or two small pieces is worth nothing. A one to five point lead at move 30 wins 53% of the time, a coin flip, and it is still 51% at move 40. Six points, a cannon or an elephant, is the first lead that holds: 89% by move 30. Eleven points, roughly a chariot and a horse, is 98% and the game is effectively over. So the honest read of a two-soldier advantage at move 30 is that you are not ahead, you are level with extra tiles.',
        },
      ],
    },
    {
      heading: 'Half the games settle by move 5, a fifth stay live past move 46',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The median game changes leader twice, and after move 13 it never changes again. That median hides the shape.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_LEAD_SETTLE_CHART,
          caption:
            'The move at which the eventual winner took the material lead for the last time, across the 168 decided games.',
        },
        {
          kind: 'paragraph',
          text: 'Banqi is two games. In 52 of the 168 the winner was ahead by move 5 and simply stayed there; in 34 the lead was still changing hands after move 46. A quarter of all 200 games never changed leader at all: whoever drew blood first held it to the end. The first capture lands at move 3 in the median game, so the half that settles early settles while most of the board is still face-down, which is exactly where the flips are. That is why a chess-style review credits the winner for what was often a good bag, and why the [review on finished games](/blog/skill-vs-luck) splits every flip into the decision and the tile.',
        },
      ],
    },
    {
      heading: 'Losing the general first loses the game 87% of the time',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A general fell in 188 of the 200 games, the first one at move 24 in the median game. In the 167 decided games where one was taken, the side that lost its general first lost 146: 87%, give or take three points. Here is what that looks like in one ply.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: BANQI_STATS_BEFORE, caption: 'Black has just flipped its own general onto c3.' },
            { svg: BANQI_STATS_AFTER, caption: 'A red soldier walks in and takes it. Black led by 6; now red does.' },
          ],
          caption:
            'The exhibit game, seed 1183 of the run: 72 moves, and the lead changes hands here for the last time.',
        },
        {
          kind: 'paragraph',
          text: 'The general is twelve points against seven for the next piece down, so losing it usually is the lead. It is also the one piece that cannot be defended by rank: a soldier, the lowest piece on the board, takes it.',
        },
      ],
    },
    {
      heading: 'Flipping first is worth nothing this sample can measure',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first player won 89 of the 168 decided games, 53%, give or take four points, and 52.5% counting draws as half. The colour the first flip hands you makes no difference (45 of 80 as red, 44 of 88 as black), and neither does its rank, as far as 200 games can see: split seven ways, each rank keeps a dozen or two games and the error bars swallow the differences. Two hundred games rule out a large first-move advantage and cannot rule out a small one, so the answer to the oldest argument at the table is that if flipping first helps, it helps by less than this.',
        },
      ],
    },
    {
      heading: 'One game in six is a draw, and the engine causes most of them',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Thirty-two games were drawn, 31 of them on the forty-ply no-progress clock and one stopped at 150 moves. No game repeated a position three times. Read the 16% as a fact about MistyBanqi first: fourteen of those draws passed through a twenty-point lead, which is the engine’s [known blind spot](/blog/mistybanqi), since nothing in its evaluation rewards finishing a won game over holding what it has. Draws are the long games, 88 moves against 71. A player who converts what this engine drifts on would draw less often.',
        },
      ],
    },
    {
      heading: 'What engine games leave out',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two hundred games of one engine against itself measure that engine, not banqi in a park. The first-player and first-tile numbers come from the deal and the rules, so they should carry over; the rest carries less. People lose generals to traps a ten-million-node search does not walk into, people convert won games this engine shuffles away, and two players of unequal strength settle games earlier than two copies of one program. The same engine has played [fifty-two games against people](/blog/skill-vs-luck) here, where the humans won 14, lost 33 and drew 5. The park rules change it too: chain captures, the straight-charging chariot and the cannon that jumps to empty squares would each move these numbers, and none of them are played here.',
        },
        {
          kind: 'embed',
          path: '/embed/study/FsA5sowX/F8fezAhm',
          title: 'Banqi: an engine game under the competition rules',
          aspect: [702, 440],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'One of [twenty games](/study/FsA5sowX) from the same run, kept as a study. Step through it with the arrows; a tile nobody has flipped stays face-down.',
        },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'How big a lead is safe in banqi?',
              answer:
                'Bigger than most people play as if it is. In 200 engine games, a one to five point lead at move 30 won 53% of the time, a six to ten point lead 89%, and eleven points or more 98%. Counting on the usual scale: general 12, advisor 7, elephant and cannon 6, chariot 5, horse 4, soldier 2.',
            },
            {
              question: 'When is a banqi game decided?',
              answer:
                'Half the time, almost immediately. In 52 of 168 decided engine games the winner took the lead for good by move 5, and in 34 of them the lead was still changing hands after move 46. The median is move 13 of a 71-move game.',
            },
            {
              question: 'How important is the general in banqi?',
              answer:
                'A general was captured in 94% of 200 engine games, and the side that lost its general first lost 87% of the decided games. It is worth twelve points against seven for the next piece down, and a soldier, the lowest piece, is one of the few things that can take it.',
            },
            {
              question: 'Does the first player have an advantage in banqi?',
              answer:
                'No advantage large enough for 200 engine games to detect. The first player won 53% of the decided games, within four points of a coin flip, and the colour handed over by the first flip made no difference.',
            },
            {
              question: 'How often does banqi end in a draw?',
              answer:
                'One game in six when this engine plays itself, all of them on the forty-ply no-progress rule rather than repetition. That rate says as much about the engine, which struggles to convert won positions, as about the game; human games are likely to draw less often.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Play banqi',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The engine in these games takes the other seat the moment you open the board, and every finished game gets the review that separates your decisions from your tiles.',
        },
        {
          kind: 'cta',
          buttons: [
            { label: 'Play the engine', href: PLAY_ENGINE, emphasis: 'primary' },
            { label: 'Play a friend', href: PLAY_FRIEND, emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
