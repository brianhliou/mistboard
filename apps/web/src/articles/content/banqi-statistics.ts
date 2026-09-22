// The banqi result post (growth plan lane 0, #422). Brian, 2026-09-21: "a
// blog post on banqi, covering stuff the banqi rules page doesn't"; the play
// post drafted first was pulled the evening it shipped ("how is this
// different than the rules?"), and this replaced it: 200 MistyBanqi self-play
// games at ten million nodes, run on Modal, reduced by
// scripts/banqi-games-stats.ts. Every rate carries its count so a reader can
// redo the arithmetic. Primary reader is Taiwanese, in zh-Hant; the English
// is the dictionary key.
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
  seoTitle: 'Banqi Statistics: First-Player Advantage, Draws and Game Length in 200 Engine Games',
  summary:
    'MistyBanqi played itself 200 times at ten million nodes a move under the Taiwanese competition rules. The first player won 53% of the decided games, one game in six was a draw, a general fell in 94 games of 100, and the side that lost its general first lost 87% of the time.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-23',
  audience:
    'Banqi players who want numbers behind the questions every table argues about: whether flipping first is an advantage, how long a game runs, how often it is a draw, and what losing the general costs.',
  thumbnail: { kind: 'svg', svg: BANQI_ONLINE_THUMBNAIL },
  readNext: ['banqi', 'mistybanqi', 'skill-vs-luck'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi has no game database. Xiangqi has a century of recorded master games and chess has hundreds of millions; banqi is played in parks and on phones, and the games are gone when the tiles go back in the box. So the questions every table argues about have no numbers behind them. Does flipping first help? How long is a game? How often is it a draw? What does losing the general cost?',
    },
    {
      kind: 'paragraph',
      text: 'These are the numbers from 200 games of [MistyBanqi](/blog/mistybanqi) against itself, ten million nodes a move, under the [Taiwanese competition rules](/rules/banqi) this site plays: one flip or one move a turn, the cannon jumping one screen to capture, forty plies without a flip or a capture a draw, a position repeated three times a draw. Every game is a fresh random deal. The first player flips a tile and takes its colour, so red and black are decided by that flip. Both seats are the same engine at the same search, which means any edge in the results belongs to the seat, not to a player. Engine games are not park games, and the last section says what that changes. But 200 of them put an error bar on each answer, which is more than banqi has had.',
    },
    {
      kind: 'embed',
      path: '/embed/study/FsA5sowX/F8fezAhm',
      title: 'Banqi: an engine game under the competition rules',
      aspect: [702, 440],
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'One of [twenty games](/study/FsA5sowX) from the same engine at the same settings, kept as a study. Step through with the arrows; a tile nobody has flipped stays face-down.',
    },
  ],
  sections: [
    {
      heading: 'The first player wins 53% of decided games',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Of the 168 games that ended in a win, the first player took 89: 53%, give or take four points. Counting draws as half a point each, the first seat scored 52.5% over all 200. So flipping first is somewhere between a coin flip and a modest edge. Two hundred games rule out a large first-move advantage; they cannot rule out a small one.',
        },
        {
          kind: 'paragraph',
          text: 'The colour the first flip hands you makes no difference either. The deal gave the first player red in exactly 100 games and black in 100, and the first seat won 45 of 80 decided games as red and 44 of 88 as black.',
        },
        {
          kind: 'paragraph',
          text: 'Nor does the rank of that first tile, as far as this sample can see. Cut 200 games seven ways and each rank is left with a dozen or two, and the error bars swallow every difference.',
        },
        {
          kind: 'table',
          headers: ['first tile flipped', 'games', 'first player won (decided games)', 'rate'],
          rows: [
            ['general', '12', '8 of 12', '67% ±14'],
            ['advisor', '24', '11 of 23', '48% ±10'],
            ['elephant', '30', '15 of 24', '63% ±10'],
            ['chariot', '30', '16 of 28', '57% ±9'],
            ['horse', '16', '1 of 10', '10% ±10'],
            ['cannon', '34', '16 of 28', '57% ±9'],
            ['soldier', '54', '22 of 43', '51% ±8'],
          ],
          caption:
            'First seat win rate in decided games by the rank of the first tile flipped, 200 games. The ± is one standard error.',
        },
        {
          kind: 'paragraph',
          text: 'A general first won eight of twelve and a horse first won one of ten. Both are what a small sample does when you slice it: a dozen games with a ten-point error bar. The reading that survives is that no rank moved the win rate by more than the noise. The first flip decides your colour, and the colour does not matter.',
        },
      ],
    },
    {
      heading: 'A general falls in 94 games of 100',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A general was captured in 188 of the 200 games, and both generals in 46. The first one fell at move 24 in the median game; a quarter of the time by move 12, a quarter of the time after move 46. Only twelve games ended with both generals still standing, and eleven of those were draws.',
        },
        {
          kind: 'paragraph',
          text: 'Losing yours first is close to losing the game. In the 167 decided games where a general was taken, the side that lost its general first lost 146 of them: 87%, give or take three points. The general tops the ladder, and only a soldier, the other general or a cannon\u2019s jump can take it, so the side that keeps its general keeps the one piece the other side can hardly answer. In these games the engine almost never recovered from giving that up.',
        },
      ],
    },
    {
      heading: 'One game in six is a draw, and every draw is on the clock',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Thirty-two of the 200 games were drawn, 16%. Thirty-one of them ran forty plies without a flip or a capture and the clock ended them. The last was still going at 150 moves and was stopped. Not one game repeated a position three times, so the repetition rule never fired at this search depth.',
        },
        {
          kind: 'paragraph',
          text: 'Draws are the long games: 88 moves in the median draw against 71 in the median win. And fourteen of the 32 passed through a position where one side was up twenty points or more, a general and a chariot of material. That is the [blind spot](/blog/mistybanqi) MistyBanqi is known for. Nothing in its evaluation rewards finishing a won game over holding what it has, so a winning position can shuffle until the forty-ply clock runs out. Read 16% as this engine’s draw rate under these rules, and as a ceiling for the game itself: a player who converts what this engine drifts on would draw less.',
        },
      ],
    },
    {
      heading: 'The lead is taken by move 13 and kept',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Material changed hands early and often. The first capture came at move 3 in the median game and never later than move 9. All 32 tiles were turned in 198 of the 200 games, and the median game saw 27 captures, which is 27 of the 32 pieces gone. Counting captured material on a fixed scale (general 12, advisor 7, elephant and cannon 6, chariot 5, horse 4, soldier 2), the lead changed hands twice in the median game and never in fifty of them. One draw swung twelve times.',
        },
        {
          kind: 'paragraph',
          text: 'In the games that were won, the winner took the material lead for the last time at move 13 of a median 71, and in 46% of them by move 10. From there the lead was held to the end in every one of the 168. Most of a banqi game, counted in moves, is the leader converting a lead it already holds, and the swing that decides it happens in the first fifth. That is also where the flips are, which is why a chess-style review would credit the winner for what was often a good draw. The [review on finished games](/blog/skill-vs-luck) splits each flip into the decision and the tile for exactly this reason.',
        },
      ],
    },
    {
      heading: 'What engine games leave out',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two hundred games of one engine against itself measure that engine under these rules, not banqi in a park. The first-player and first-tile numbers should carry over, because they come from the deal and the rules rather than from anyone’s style. The general and the draw numbers carry over less. People lose generals to traps an engine at ten million nodes does not walk into, and people convert won games that this engine shuffles into draws, so a human table probably sees more decisive games and earlier generals than these. The same engine has played [fifty-two games against people](/blog/skill-vs-luck) on this site, and that post has the human side of the picture.',
        },
        {
          kind: 'paragraph',
          text: 'The rules matter too. Chain captures, the straight-charging chariot and the cannon that jumps to empty squares are park rules, and each would change the capture counts and the draw rate. These 200 games follow the competition ladder on the [rules page](/rules/banqi) and nothing else.',
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
              question: 'Does the first player have an advantage in banqi?',
              answer:
                'A small one at most. In 200 engine games under the Taiwanese competition rules, the first player won 53% of the decided games, within four points of a coin flip, and the colour handed over by the first flip made no difference.',
            },
            {
              question: 'How long is a game of banqi?',
              answer:
                'About 75 moves per side in the median engine game, with half of all games between 60 and 87 moves. The shortest of 200 was 36 moves. Draws run longer than wins, 88 moves against 71.',
            },
            {
              question: 'How often does banqi end in a draw?',
              answer:
                'One game in six between two copies of the same engine, and every draw came from the forty-ply no-progress rule rather than repetition. Human games, where won positions get converted and generals get trapped, are likely to draw less often.',
            },
            {
              question: 'How important is the general in banqi?',
              answer:
                'A general was captured in 94% of 200 engine games, and the side that lost its general first lost 87% of the decided games. Only a soldier, the other general or a cannon can capture a general, so keeping yours while taking theirs is most of the game.',
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
