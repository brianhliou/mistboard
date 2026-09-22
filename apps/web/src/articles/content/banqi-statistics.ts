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
  BANQI_STATS_THUMBNAIL,
} from '../banqi-statistics-diagrams.js';

import type { Article, ArticleBlock } from '../types.js';

const PLAY_ENGINE = '/?play=computer&gameSpecId=banqi';
const PLAY_FRIEND = '/?play=friend&gameSpecId=banqi';
const STUDY = '/study/FsA5sowX';

export const banqiStatisticsArticle: Article = {
  slug: 'banqi-statistics',
  kind: 'article',
  publisher: 'mistboard',
  gameSpecId: 'banqi',
  boardFamily: 'xiangqi',
  playableOnMistboard: true,
  title: 'Banqi by the Numbers',
  seoTitle: 'Banqi Statistics: How Big a Lead Is Safe, and When a Game Is Decided',
  summary:
    'MistyBanqi played itself 200 times at ten million nodes a move under the Taiwanese competition rules. On the engine\u2019s own point scale, a lead under ten points is a coin flip at every stage of the game, and the side that loses its general first loses 87% of the time.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-23',
  audience:
    'Banqi players who want numbers behind the questions every table argues about: how big a lead is safe, when a game is decided, what losing the general costs, and whether flipping first is an advantage.',
  thumbnail: { kind: 'svg', svg: BANQI_STATS_THUMBNAIL },
  readNext: ['banqi', 'mistybanqi', 'skill-vs-luck'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi has no game database. Xiangqi has a century of master games and chess has hundreds of millions; banqi is played in parks and on phones, and the games are gone when the tiles go back in the box. So the questions every table argues about have no numbers behind them. Am I winning? When is it over? Does flipping first help?',
    },
    {
      kind: 'paragraph',
      text: 'Here are 200 games of [MistyBanqi](/blog/mistybanqi) against itself, ten million nodes a move, under the [Taiwanese competition rules](/rules/banqi) this site plays. Every game is a fresh deal and both seats are the same engine at the same search, so any edge belongs to the seat, not to a player.',
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
    {
      kind: 'paragraph',
      text: 'Material below is counted in points, on the engine\u2019s own value table: general 30, chariot 14, cannon 12, advisor and elephant 10, horse 8, soldier 4. Those are MistyBanqi\u2019s numbers rather than mine, which is the point, because these are its games. They do not follow the capture ladder either: the chariot is fourth in rank and second in value, and a general is worth more than twice any other piece.',
    },
  ],
  sections: [
    {
      heading: 'Under ten points is a coin flip',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The question mid-game is whether the material you are up means anything yet. It depends on the size, and much less than you would think on how far along the game is.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_LEAD_SAFETY_GRID,
          caption:
            'How often the side ahead on points went on to win, by the size of the lead and the move it was measured at. Rates are of decided games; drawn games are in the counts but not the rate. Games dead level at a checkpoint are in no column.',
        },
        {
          kind: 'paragraph',
          text: 'A soldier or a horse ahead is nothing. Under ten points the leader wins 52% at move 10 and 59% at move 40: a coin flip that never improves, however long it is held. One middling piece, ten to nineteen points, is worth about 70% early and 81% late. It takes forty points, a general or a chariot plus two mid pieces, before the game is actually over: 95% at move 20, and every one of the 56 games that reached move 30 that far ahead. So a two-soldier lead at move 30 is not a lead. You are level with more tiles.',
        },
      ],
    },
    {
      heading: 'Decided in five moves, or not for fifty',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every game has a moment when the material lead changes hands for the last time. Before it the two sides are still trading; after it one of them is ahead and stays ahead. The chart is where that moment fell in each of the 168 decided games.',
        },
        {
          kind: 'raw-svg',
          svg: BANQI_LEAD_SETTLE_CHART,
          caption:
            'The move at which the eventual winner took the lead for the last time, across the 168 decided games. Each bar counts games.',
        },
        {
          kind: 'paragraph',
          text: 'It is not a bell curve around the median of move 16. In 43 games the last change came inside the first five moves: someone won an early exchange and was never caught. In 36 it came after move 46, at the end of a long fight. Little lands in between. A fifth of all 200 games never changed leader at all. The early group is the one to worry about. At move 5 most of the board is still face-down, so those games were settled by the first few flips and what the players made of them. A chess-style review reads that as skill. The [review on finished games](/blog/skill-vs-luck) splits every flip into the decision and the tile for that reason.',
        },
      ],
    },
    {
      heading: 'Losing your general first loses the game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A general fell in 188 of the 200 games, the first at move 24 in the median game. In the 167 decided games where one was taken, the side that lost its general first lost 146: 87%, give or take three points. Thirty points changing hands in a single move is why.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: BANQI_STATS_BEFORE, caption: 'Black has just flipped its own general onto c3.' },
            {
              svg: BANQI_STATS_AFTER,
              caption: 'A red soldier walks in and takes it. Black led by 4; now red leads by 26.',
            },
          ],
          caption:
            'The exhibit game, seed 1183 of the run: 72 moves, and the lead changes hands here for the last time.',
        },
        {
          kind: 'paragraph',
          text: 'No other piece swings the score like that, and the general is the one piece that cannot be defended by rank. The lowest piece on the board takes it.',
        },
      ],
    },
    {
      heading: 'Flipping first is worth nothing',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first player won 89 of the 168 decided games, 53%, give or take four points, and 52.5% counting draws as half. The colour the first flip hands you makes no difference (45 of 80 as red, 44 of 88 as black), and neither does its rank, as far as 200 games can see: split seven ways, each rank keeps a dozen or two games and the error bars swallow the differences. Two hundred games rule out a large first-move advantage and cannot rule out a small one, so the answer to the oldest argument at the table is that if flipping first helps, it helps by less than this.',
        },
        {
          kind: 'paragraph',
          text: 'The usual expectation runs the other way. The first flip hands your opponent a piece to see and answer, fixes your colour before you know anything, and leaves one of your pieces out there undefended. These games do not show that cost. They are also the weakest place to look for it: every face-down tile is a chance node, thirty-two of them at move one, so the engine searches shallowest exactly where the question lives. A person, or a learned evaluation, can reason about the shape of the bag without enumerating it. If flipping first is a handicap, this is the number I would expect a strong opening player to overturn.',
        },
      ],
    },
    {
      heading: 'One game in six is a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Thirty-two games were drawn, 31 of them on the forty-ply no-progress clock and one stopped at 150 moves. No game repeated a position three times. Read the 16% as a fact about MistyBanqi first: seventeen of those draws passed through a forty-point lead, the size the grid above calls decisive, and that is the engine\u2019s [known blind spot](/blog/mistybanqi), since nothing in its evaluation rewards finishing a won game over holding what it has. Draws are the long games, 88 moves against 71. A player who converts what this engine drifts on would draw less often.',
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
                'Bigger than most people play as if it is. In 200 engine games, counting material on the engine\u2019s scale (general 30, chariot 14, cannon 12, advisor and elephant 10, horse 8, soldier 4), a lead under ten points won 59% at move 30, ten to nineteen points won 81%, and forty points or more won every game that got that far ahead by move 30.',
            },
            {
              question: 'When is a banqi game decided?',
              answer:
                'In two ways at once. In 43 of 168 decided engine games the winner took the lead for good by move 5; in 36 the lead was still changing hands after move 46. The median is move 16 of a 71-move game.',
            },
            {
              question: 'How important is the general in banqi?',
              answer:
                'A general was captured in 94% of 200 engine games, and the side that lost its general first lost 87% of the decided games. The engine values it at 30 points against 14 for a chariot, the next piece down, and a soldier, the lowest piece, is one of the few things that can take it.',
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
            { label: 'Browse the 20 games', href: STUDY, emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
