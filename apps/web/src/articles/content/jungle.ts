import { JUNGLE_SAMPLE_GAME } from '../../jungle-sample-game.js';
import {
  JUNGLE_DEN_ENTRY,
  JUNGLE_ELEPHANT_STUCK,
  JUNGLE_LION_LEAP_ACROSS,
  JUNGLE_LION_LEAP_CAPTURE,
  JUNGLE_NO_WATER,
  JUNGLE_OWN_TRAP,
  JUNGLE_RANK_LADDER,
  JUNGLE_RAT_BLOCKS,
  JUNGLE_RAT_ELEPHANT,
  JUNGLE_RAT_ENTERS_WATER,
  JUNGLE_RAT_SHORELINE,
  JUNGLE_START_BOARD,
  JUNGLE_STEP,
  JUNGLE_TIGER_LEAP,
  JUNGLE_TIGER_LEAP_ACROSS,
  JUNGLE_TRAP,
  playClosing,
} from '../diagrams.js';
import type { Article } from '../types.js';

export const jungleArticle: Article = {
  slug: 'jungle',
  kind: 'rules',
  title: 'Jungle Chess Rules (Dou Shou Qi, Animal Chess)',
  summary:
    "Jungle Chess, also called Dou Shou Qi or Animal Chess: eight ranked animals on a 7 by 9 board, rivers only the rat can cross, and a race to the opponent's den. Play rated games and analyse them free in your browser.",
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-30',
  updatedAt: '2026-09-17',
  playableOnMistboard: true,
  audience:
    'Experienced Jungle Chess players who want a clear reference, plus chess and xiangqi players meeting it for the first time.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Jungle Chess is a two-player strategy game about rank and terrain. Each side commands eight animals and tries to reach the enemy den or eliminate the enemy army.',
    },
    {
      kind: 'paragraph',
      text: 'Jungle has been played online for years, mostly in apps and on Chinese game portals. Rated games, a post-game review, and an engine that tells you where it went wrong have not come with it. The serious Jungle engine work sits in academic papers and endgame tablebases, nowhere you can actually play. Mistboard puts all three in one place.',
    },
    {
      kind: 'paragraph',
      text: 'Three rules give the game its character: the rat captures the elephant, only the rat can swim, and the lion and tiger leap the rivers.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board is seven files wide and nine ranks deep. Your den sits at the center of your back rank, ringed by three trap squares. Two rivers, each a 2×3 block of water, split the middle of the board. Red moves first from the fixed starting position below.',
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_START_BOARD,
        },
      ],
    },
    {
      heading: 'How the animals move',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every animal moves one square up, down, left, or right. Animals never move diagonally. Most animals stay on land, so they cannot enter a river. The rat, lion, and tiger are the three movement exceptions.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_STEP, caption: 'One square, four directions.' },
            { svg: JUNGLE_NO_WATER, caption: 'The river is not a move for a land animal.' },
          ],
        },
        { kind: 'sub-heading', text: 'Rat' },
        {
          kind: 'paragraph',
          text: 'The rat is the only animal that can enter water. A rat in a river can move and capture another rat there, but no piece can capture across the shoreline: a land rat cannot capture into water, and a water rat cannot capture onto land.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: JUNGLE_RAT_ENTERS_WATER,
              caption: 'The rat can step off the bank into the river.',
            },
            {
              svg: JUNGLE_RAT_SHORELINE,
              caption:
                'In the water it is safe: the wolf is not a target, and it cannot reach the rat either.',
            },
          ],
        },
        { kind: 'sub-heading', text: 'Lion' },
        {
          kind: 'paragraph',
          text: 'The lion can move one land square normally, or leap straight across a river horizontally or vertically. It lands on the first square beyond the water and may capture an animal there if rank allows.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_LION_LEAP_ACROSS, caption: 'The lion clears either river sideways.' },
            {
              svg: JUNGLE_LION_LEAP_CAPTURE,
              caption: 'The same jump lengthwise, landing on the wolf and taking it.',
            },
          ],
        },
        { kind: 'sub-heading', text: 'Tiger' },
        {
          kind: 'paragraph',
          text: 'The tiger moves exactly like the lion: one land square, or a leap straight across a river lengthwise or sideways, landing on the first square past the water. A rat of either color on any water square in the path blocks either animal’s jump.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_TIGER_LEAP, caption: 'The tiger clears the river the long way.' },
            {
              svg: JUNGLE_TIGER_LEAP_ACROSS,
              caption: 'The tiger on the lion’s square: the same leaps sideways.',
            },
          ],
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_RAT_BLOCKS,
          className: 'jungle-figure-compact',
          caption: 'A rat in the river blocks the leap.',
        },
      ],
    },
    {
      heading: 'Ranks and captures',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Each side has the same eight animals. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A piece captures an adjacent enemy of equal or lower rank.',
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_RANK_LADDER,
          caption: 'Strongest at the left, weakest at the right.',
        },
        {
          kind: 'paragraph',
          text: 'The rank exception connects the ends of the ladder: a rat on land can capture an elephant, while an elephant cannot capture a rat.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: JUNGLE_RAT_ELEPHANT,
              caption: 'On land, the lowest-ranked rat can capture the highest-ranked elephant.',
            },
            { svg: JUNGLE_ELEPHANT_STUCK, caption: 'The elephant cannot take the rat back.' },
          ],
        },
      ],
    },
    {
      heading: 'Traps',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Step a piece onto one of your opponent’s three trap squares and it loses all rank while it stands there, so any defending piece can take it, down to a rat capturing a trapped elephant. Only an enemy’s traps do this: a piece can sit on one of its own traps and keeps its full rank.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_TRAP, caption: 'On red’s trap the lion is rank 0, so a cat takes it.' },
            {
              svg: JUNGLE_OWN_TRAP,
              caption: 'Red’s own trap costs red nothing: the cat still cannot touch the elephant.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win immediately by moving any piece into the enemy den, capturing every enemy piece, or leaving your opponent with no legal move. You cannot move into your own den.',
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_DEN_ENTRY,
          className: 'jungle-figure-compact',
          caption:
            'One step into the den ends the game. Rank does not matter, and neither does the trap square.',
        },
        {
          kind: 'paragraph',
          text: 'Games draw on threefold repetition, or when 100 half-moves (50 by each player) pass with no capture.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'This engine game shows a lion leap, a rat swim and capture an elephant, and the final entry into Blue’s den.',
        },
        {
          kind: 'jungle-replay',
          spec: {
            red: JUNGLE_SAMPLE_GAME.red,
            black: JUNGLE_SAMPLE_GAME.black,
            event: JUNGLE_SAMPLE_GAME.event,
            outcome: JUNGLE_SAMPLE_GAME.outcome,
            resultText: JUNGLE_SAMPLE_GAME.result,
            moves: JUNGLE_SAMPLE_GAME.moves,
          },
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
              question: 'What is the rank order in Jungle Chess?',
              answer:
                'Elephant > lion > tiger > leopard > wolf > dog > cat > rat. An animal captures an adjacent enemy of equal or lower rank. The one exception: a rat on land can capture the elephant, and the elephant can never capture a rat.',
            },
            {
              question: 'Can the elephant capture the rat?',
              answer:
                'No, never. The rat is the only piece that can capture the elephant, and only from a land square. A rat in the river cannot capture onto land.',
            },
            {
              question: 'Which animals can jump the river?',
              answer:
                'The lion and the tiger both jump a river sideways or lengthwise, land on the first square past the water, and may capture there. A rat of either color on any water square in the path blocks the jump. Some English rule sets let only the lion jump sideways; Mistboard follows the Chinese rule sets, where both animals do.',
            },
            {
              question: 'How do the traps work?',
              answer:
                'An animal standing on one of the three trap squares around the enemy den loses all rank, so any defender can capture it, even a rat taking an elephant. Your own traps do nothing to your own animals.',
            },
            {
              question: 'How do you win Jungle Chess?',
              answer:
                'Move any animal into the enemy den, capture all eight enemy animals, or leave your opponent with no legal move. You cannot enter your own den. The game draws on threefold repetition or 100 half-moves without a capture.',
            },
            {
              question: 'Is there a winning strategy for Jungle Chess?',
              answer:
                'No forced win is known. Dou Shou Qi has been solved only up to seven pieces on the board, and the full sixteen-piece game is open. In practice the strong ideas are to keep the rat alive as your answer to the elephant, keep the lion and tiger near the rivers where their jumps threaten, and never leave the squares around your den unguarded.',
            },
            {
              question: 'What other names does Jungle Chess have?',
              answer:
                'Dou Shou Qi, Animal Chess, Jungle, and Animal Checkers in English. Dou shou qi is the Chinese name, literally fighting-animal chess, and it is the same name in Taiwan, Hong Kong, and the mainland.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Jungle Chess is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
      playLabel: 'Play vs computer',
      playHref: '/?play=computer&gameSpecId=jungle',
      secondary: [
        {
          label: 'Challenge a friend',
          href: '/?play=friend&gameSpecId=jungle',
          emphasis: 'secondary',
        },
      ],
    }),
  ],
};
