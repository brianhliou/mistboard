import {
  JUNGLE_FLIP_CAPTURE,
  JUNGLE_FLIP_ELEPHANT_STUCK,
  JUNGLE_FLIP_MOVE,
  JUNGLE_FLIP_MUTUAL,
  JUNGLE_FLIP_RAT_TAKES_ELEPHANT,
  JUNGLE_FLIP_REVEAL,
  JUNGLE_FLIP_SETUP,
  JUNGLE_RANK_LADDER,
  playClosing,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const jungleFlipArticle: Article = {
  slug: 'jungle-flip',
  kind: 'rules',
  title: 'Flip Jungle Rules (Flip Dou Shou Qi)',
  summary:
    'The 4×4 flip version of Jungle Chess, also called flip Dou Shou Qi or flip animal chess. Every animal starts face-down, you flip to reveal, and equal ranks trade off the board. Play it free in your browser.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-06-30',
  updatedAt: '2026-07-26',
  playableOnMistboard: true,
  audience:
    'Jungle players who want the flip variant, and anyone who grew up playing a face-down animal game on a chalk grid.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Flip Jungle is a compact hidden-piece relative of [Jungle Chess](/rules/jungle). All sixteen animals begin face-down on a 4×4 board. There are no rivers, dens, or traps: reveal tiles, move your animals, and eliminate the other color.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'One of each animal in two colors is shuffled and placed face-down on the sixteen squares. Nobody knows what is under a tile until it is flipped. The first tile the first player flips sets that player’s color; the other player takes the other color.',
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_FLIP_SETUP,
          className: 'jungle-figure-compact',
        },
      ],
    },
    {
      heading: 'Turns',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn, do one thing: flip one face-down tile, or move one of your revealed animals one square up, down, left, or right. Face-down tiles block movement and cannot be captured. You cannot pass.',
        },
        {
          kind: 'svg-row',
          items: [
            {
              svg: JUNGLE_FLIP_REVEAL,
              caption: 'A flip reveals both the animal and its color to both players.',
            },
            { svg: JUNGLE_FLIP_MOVE, caption: 'A revealed animal steps one square.' },
          ],
        },
      ],
    },
    {
      heading: 'Captures and trades',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Both colors use the same ladder. Strongest to weakest: elephant, lion, tiger, leopard, wolf, dog, cat, rat. A higher-ranked animal captures a lower-ranked enemy by moving onto its square. A weaker animal cannot capture a stronger one.',
        },
        {
          kind: 'raw-svg',
          svg: JUNGLE_RANK_LADDER,
          caption: 'Strongest at the left, weakest at the right.',
        },
        {
          kind: 'paragraph',
          text: 'Equal ranks work differently. When an animal captures an enemy of its own rank, both pieces leave the board, and neither side keeps the square.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_FLIP_CAPTURE, caption: 'A lion captures a lower-ranked wolf.' },
            { svg: JUNGLE_FLIP_MUTUAL, caption: 'Equal animals remove each other.' },
          ],
        },
        {
          kind: 'paragraph',
          text: 'The rat and elephant reverse the usual order: a rat can capture an elephant, while an elephant cannot capture a rat.',
        },
        {
          kind: 'svg-row',
          items: [
            { svg: JUNGLE_FLIP_RAT_TAKES_ELEPHANT, caption: 'The rat takes the elephant.' },
            { svg: JUNGLE_FLIP_ELEPHANT_STUCK, caption: 'The elephant cannot take the rat back.' },
          ],
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'You win when your opponent has no animals left, or starts a turn with no legal flip or move. If the last animal of each color is removed in an equal-rank trade, the game is drawn.',
        },
        {
          kind: 'paragraph',
          text: 'Games draw on threefold repetition, or when 40 half-moves (20 by each player) pass with no flip, capture, or trade.',
        },
        {
          kind: 'paragraph',
          text: 'Mistboard also ends a fully revealed, one-animal-each position when neither side can force a win. Equal ranks are always dead because any meeting removes both; some unequal-rank chases are also unwinnable. These positions are drawn immediately.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'MistyJungleFlip against itself at three times the strength the site’s bot plays at. The first flip turns up red, so the first player is Red. The cats meet and trade off on move 10, a red rat takes Blue’s elephant on move 24, and on move 28 the two lions trade off too, which leaves Blue with no move. Red wins.',
        },
        {
          kind: 'embed',
          path: '/embed/study/uKxJ60mN/8mQHGAqc',
          title: 'Flip Jungle: an engine game, Red wins on move 28',
          // Width-bound at the 702px column: the 4x4 board beside the move sheet,
          // plus seat rows, controls, header and credit.
          aspect: [702, 641],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The [companion study](/study/uKxJ60mN) has all twenty games from the run, each opening into its own deal, with a note on how it went.',
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
              question: 'Can the bot see the face-down tiles?',
              answer:
                'No. The engine gets the same board you do. Every face-down tile is sent to it as unknown, along with the count of what is still hidden, and it learns what a tile is at the moment it flips, the same moment you do.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Flip Jungle is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
      playLabel: 'Play vs computer',
      playHref: '/?play=computer&gameSpecId=jungle-flip',
      secondary: [
        { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=jungle-flip', emphasis: 'secondary' },
        { label: 'Twenty engine games', href: '/study/uKxJ60mN', emphasis: 'secondary' },
      ],
    }),
  ],
};
