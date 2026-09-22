// The banqi result post (growth plan lane 0, #422). Brian, 2026-09-21: "a
// blog post on banqi, covering stuff the banqi rules page doesn't"; the play
// post drafted first was pulled the evening it shipped ("how is this
// different than the rules?"), and this replaced it: 200 MistyBanqi self-play
// games at ten million nodes, run on Modal, reduced by
// scripts/banqi-games-stats.ts. Every rate carries its count so a reader can
// redo the arithmetic.
//
// Restructured 2026-09-22 on Brian's "restructure": the draft led with the
// first-player rate, which is a null result (53% ±4), and buried the finding
// that survives its error bar (the material leader stops changing at move 13
// of a median 71). Leader first, null third, and the first-flip-rank table is
// one sentence because its cells were noise. Primary reader is Taiwanese, in
// zh-Hant; the English is the dictionary key.
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
  seoTitle: 'Banqi Statistics: 200 Engine Games on Leads, Generals, Draws and Length',
  summary:
    'MistyBanqi played itself 200 times at ten million nodes a move under the Taiwanese competition rules. The material leader stopped changing at move 13 of a median 71, the side that lost its general first lost 87% of the time, and flipping first was worth nothing this sample could measure.',
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-23',
  audience:
    'Banqi players who want numbers behind the questions every table argues about: when a game is actually decided, what losing the general costs, whether flipping first is an advantage, and how often it ends in a draw.',
  thumbnail: { kind: 'svg', svg: BANQI_ONLINE_THUMBNAIL },
  readNext: ['banqi', 'mistybanqi', 'skill-vs-luck'],
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi has no game database. Xiangqi has a century of recorded master games and chess has hundreds of millions; banqi is played in parks and on phones, and the games are gone when the tiles go back in the box. So the questions every table argues about have no numbers behind them. When is a game actually decided? What does losing the general cost? Does flipping first help? How often is it a draw?',
    },
    {
      kind: 'paragraph',
      text: 'These are the numbers from 200 games of [MistyBanqi](/blog/mistybanqi) against itself, ten million nodes a move, under the [Taiwanese competition rules](/rules/banqi) this site plays: one flip or one move a turn, the cannon jumping one screen to capture, forty plies without a flip or a capture a draw, a position repeated three times a draw. Every game is a fresh random deal, and the first player flips a tile and takes its colour, so red and black are decided by that flip. Both seats are the same engine at the same search, which means any edge in the results belongs to the seat, not to a player.',
    },
    {
      kind: 'table',
      headers: ['200 games, MistyBanqi against itself at 10M nodes', 'value'],
      rows: [
        ['decided', '168 (84%)'],
        ['drawn', '32 (16%)'],
        ['median length', '75 moves a side'],
        ['median captures', '27 of 32 pieces'],
        ['first capture', 'move 3 in the median game'],
        ['a general captured', '188 games (94%)'],
        ['first player won, of decided games', '89 of 168 (53%)'],
      ],
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
      heading: 'The lead stops changing at move 13 of 71',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Count captured material on a fixed scale (general 12, advisor 7, elephant and cannon 6, chariot 5, horse 4, soldier 2) and the leader settles early. In the games that were won, the winner took the lead for the last time at move 13 of a median 71, and in 46% of them by move 10. Four fifths of the average game is played after the last time the lead changed hands.',
        },
        {
          kind: 'paragraph',
          text: 'The games are not quiet. The first capture lands at move 3, the median game trades 27 of the 32 pieces, and the lead changes hands twice before it settles. But in a quarter of the 200 it never changed at all: whoever drew blood first held the advantage to the end. One drawn game swung twelve times, which is what a game with no winner looks like from this angle.',
        },
        {
          kind: 'paragraph',
          text: 'Part of this is definitional. A banqi game ends when a side has nothing left to move, and that side is usually the one that has been losing material, so the winner leading at the end is close to a tautology. The timing is not. The decision happens in the first fifth of the game, which is exactly where the flips are: a quarter of the tiles are still face-down at move 13 in the median game. A chess-style review would credit the winner for what was often a good bag, and the [review on finished games](/blog/skill-vs-luck) splits every flip into the decision and the tile for that reason.',
        },
      ],
    },
    {
      heading: 'Losing the general first loses the game 87% of the time',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A general was captured in 188 of the 200 games, and both generals in 46. The first one fell at move 24 in the median game; a quarter of the time by move 12, a quarter of the time after move 46. Only twelve games ended with both generals still standing, and eleven of those were draws.',
        },
        {
          kind: 'paragraph',
          text: 'In the 167 decided games where a general was taken, the side that lost its general first lost 146 of them: 87%, give or take three points. The general tops the ladder, and only a soldier, the other general or a cannon’s jump can take it, so the side that keeps its general keeps the one piece the other side can hardly answer. It is worth twelve points on the scale above against seven for the next piece down, which is usually enough to set the lead the section above says never comes back.',
        },
      ],
    },
    {
      heading: 'Flipping first is worth nothing this sample can measure',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Of the 168 games that ended in a win, the first player took 89: 53%, give or take four points. Counting draws as half a point each, the first seat scored 52.5% over all 200. Two hundred games rule out a large first-move advantage and cannot rule out a small one, so the answer to the oldest argument at the table is that if flipping first helps, it helps by less than this.',
        },
        {
          kind: 'paragraph',
          text: 'The colour that first flip hands you makes no difference either. The deal gave the first player red in exactly 100 games and black in 100, and the first seat won 45 of 80 decided games as red and 44 of 88 as black.',
        },
        {
          kind: 'paragraph',
          text: 'Nor, as far as this sample can see, does the rank of that first tile. Split 200 games seven ways and each rank keeps a dozen or two: a general first won eight of twelve and a horse first won one of ten, which is what small samples do rather than a finding about horses. Telling a five-point effect per rank apart from noise would take several thousand games, and this is 200.',
        },
      ],
    },
    {
      heading: 'One game in six is a draw, and the engine causes most of them',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Thirty-two of the 200 games were drawn, 16%. Thirty-one of them ran forty plies without a flip or a capture and the clock ended them; the last was still going at 150 moves and was stopped. Not one game repeated a position three times, so the repetition rule never fired at this search depth.',
        },
        {
          kind: 'paragraph',
          text: 'Read that 16% as a fact about MistyBanqi before reading it as a fact about banqi. Fourteen of the 32 draws passed through a position where one side was up twenty points or more, a general and a chariot of material, and that is the engine’s [known blind spot](/blog/mistybanqi): nothing in its evaluation rewards finishing a won game over holding what it has, so a winning position can shuffle until the clock runs out. Draws are also the long games, 88 moves in the median draw against 71 in the median win, which is what shuffling looks like in the length data. A player who converts what this engine drifts on would draw less often than one game in six.',
        },
      ],
    },
    {
      heading: 'What engine games leave out',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Two hundred games of one engine against itself measure that engine under these rules, not banqi in a park. The first-player and first-tile numbers should carry over, because they come from the deal and the rules rather than from anyone’s style. The rest carries over less. People lose generals to traps an engine searching ten million nodes does not walk into, people convert won games that this engine shuffles away, and two players of unequal strength settle games earlier than two copies of one program. The same engine has played [fifty-two games against people](/blog/skill-vs-luck) on this site, where the humans won 14, lost 33 and drew 5.',
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
              question: 'When is a banqi game decided?',
              answer:
                'Earlier than it looks. In 200 engine games the winner took the material lead for the last time at move 13 of a median 71-move game, and in a quarter of the games the leader never changed at all.',
            },
            {
              question: 'How important is the general in banqi?',
              answer:
                'In 200 engine games a general was captured in 94% of them, and the side that lost its general first lost 87% of the decided games. Only a soldier, the other general or a cannon can capture a general, so keeping yours while taking theirs is most of the game.',
            },
            {
              question: 'Does the first player have an advantage in banqi?',
              answer:
                'No advantage large enough for 200 engine games to detect. The first player won 53% of the decided games, within four points of a coin flip, and the colour handed over by the first flip made no difference.',
            },
            {
              question: 'How long is a game of banqi?',
              answer:
                'About 75 moves per side in the median engine game, with half of all games between 60 and 87 moves. The shortest of 200 was 36 moves. Draws run longer than wins, 88 moves against 71.',
            },
            {
              question: 'How often does banqi end in a draw?',
              answer:
                'One game in six when this engine plays itself, and every one of those came from the forty-ply no-progress rule rather than repetition. That rate says as much about the engine, which struggles to convert won positions, as about the game; human games are likely to draw less often.',
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
