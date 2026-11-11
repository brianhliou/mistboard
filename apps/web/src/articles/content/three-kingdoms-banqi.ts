import {
  TK_ADVISOR_TAKES_GENERAL,
  TK_CANNON,
  TK_CHARIOT,
  TK_ELEPHANT,
  TK_GENERAL,
  TK_HORSE,
  TK_POINTS,
  TK_SETUP,
  TK_SOLDIER,
  TK_THUMBNAIL,
} from '../../three-kingdoms-banqi-diagrams.js';
import { BANQI_FAMILY_COMPARISON } from './banqi-family-comparison.js';
import type { Article, ArticleBlock } from '../types.js';

// Launched rules for #628, checked against the kernel. Five rules the app
// leaves unwritten (perpetual chase, what resets the 40-ply count, face-down
// capture, wipe-out, no legal move) were decided for Mistboard on 2026-10-25
// (THREE_KINGDOMS_BANQI_RULES in the engine). The app's help has no section for
// this mode, so the page presents them as Mistboard's rules, not Gamesofa's;
// change the engine and this page together.

const PLAY: ArticleBlock = {
  kind: 'cta',
  buttons: [
    {
      label: 'Play a friend',
      href: '/?play=friend&gameSpecId=three-kingdoms-banqi',
      emphasis: 'primary',
    },
    {
      label: 'Play a bot',
      href: '/?play=computer&gameSpecId=three-kingdoms-banqi',
      emphasis: 'secondary',
    },
  ],
};

export const threeKingdomsBanqiArticle: Article = {
  slug: 'three-kingdoms-banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Three Kingdoms Banqi Rules',
  tagline: 'Face-down pieces, any piece takes any piece, first to 100 wins.',
  summary:
    'Three Kingdoms banqi is face-down banqi on a 9 by 5 board with xiangqi moves. Any piece can capture any piece, every capture scores points, and the first player to 100 wins.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-11-10',
  thumbnail: { kind: 'svg', svg: TK_THUMBNAIL },
  tldr: [
    'All thirty-two pieces start face-down. On your turn, flip one or move one of yours.',
    'Pieces move as in xiangqi with no palace and no river, and any piece can capture any face-up enemy piece.',
    'Every capture scores points. The first player to 100 wins.',
  ],
  audience:
    'Banqi players who have met the Three Kingdoms mode in Gamesofa’s banqi app and want its rules written down, and xiangqi players curious about a scoring version of dark chess.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Banqi’s face-down luck with the long reach of [xiangqi](/rules/xiangqi) pieces: chariots sweep the board, cannons fire over hidden tiles, and a soldier can take the general. The game turns on what to flip, what to grab and what to leave hanging.',
    },
    {
      kind: 'paragraph',
      text: 'Gamesofa’s banqi app introduced Three Kingdoms banqi in July 2026. Mistboard plays its own version and is not affiliated with Gamesofa.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board is 9 points wide and 5 deep, with no river and no palace. Each color has the full xiangqi set: a general, two advisors, two elephants, two chariots, two horses, two cannons and five soldiers. All thirty-two pieces start shuffled face-down in four blocks of eight, with the middle row and column empty.',
        },
        { kind: 'raw-svg', svg: TK_SETUP },
      ],
    },
    {
      heading: 'Your turn',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn, **flip** a face-down piece or **move** one of your face-up pieces. The first flip of the game sets the colors: you play the color you turned up. After that you may flip any face-down piece, even one that turns out to be your opponent’s.',
        },
      ],
    },
    {
      heading: 'Pieces move as in xiangqi, with three changes',
      blocks: [
        {
          kind: 'list',
          items: [
            '**No palace and no river.** Every piece can go anywhere on the board.',
            '**Nothing blocks a horse or an elephant.** They jump even when a piece stands next to them.',
            '**The general slides like a chariot, and a soldier can step backward.**',
          ],
        },
        { kind: 'sub-heading', text: 'Captures' },
        {
          kind: 'paragraph',
          text: '**Any piece takes any piece.** There is no rank order, so a soldier can take a chariot. Only face-up enemy pieces can be captured: nothing moves onto a face-down piece, and it blocks a sliding piece like any other. The general is not royal. There is no check, and taking it scores 20 points.',
        },
        { kind: 'sub-heading', text: 'Each piece' },
        {
          kind: 'paragraph',
          text: '*In the diagrams, dots are moves, rings are captures and blank tiles are face-down pieces.*',
        },
        {
          kind: 'paragraph',
          text: '**Chariot:** slides any distance along a row or column. Here it can take the black horse, and the face-down tile blocks it.',
        },
        { kind: 'raw-svg', svg: TK_CHARIOT },
        {
          kind: 'paragraph',
          text: '**General:** moves exactly like the chariot. Here it can take the black cannon.',
        },
        { kind: 'raw-svg', svg: TK_GENERAL },
        {
          kind: 'paragraph',
          text: '**Cannon:** moves like the chariot, but captures by jumping exactly one piece of either color, face-up or face-down. Here it can take the general over the face-down tile, but not the soldier next to it.',
        },
        { kind: 'raw-svg', svg: TK_CANNON },
        {
          kind: 'paragraph',
          text: '**Horse:** one point straight, then one diagonally. Here all four neighbors are taken and it still reaches all eight points, including the black chariot.',
        },
        { kind: 'raw-svg', svg: TK_HORSE },
        {
          kind: 'paragraph',
          text: '**Elephant:** two points diagonally, over any piece. Here it cannot land on the face-down tile at the bottom right.',
        },
        { kind: 'raw-svg', svg: TK_ELEPHANT },
        {
          kind: 'paragraph',
          text: '**Advisor:** one point diagonally. Here it can take the general, but not the face-down tile.',
        },
        { kind: 'raw-svg', svg: TK_ADVISOR_TAKES_GENERAL },
        {
          kind: 'paragraph',
          text: '**Soldier:** one point forward, backward or sideways. Here it can take the chariot in front of it.',
        },
        { kind: 'raw-svg', svg: TK_SOLDIER },
      ],
    },
    {
      heading: 'Scoring',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A capture scores the value of the piece taken: **5** for a soldier, advisor or elephant, **10** for a cannon or horse, **15** for a chariot and **20** for the general. The points go to whoever captures, no matter who flipped the piece.',
        },
        { kind: 'raw-svg', svg: TK_POINTS },
      ],
    },
    {
      heading: 'How the game ends',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first player to reach **100 points** wins at once, with pieces still on the board. One color’s sixteen pieces are worth 135, so a side is never wiped out first.',
        },
        {
          kind: 'paragraph',
          text: 'If 40 plies (single moves) pass with no flip and no capture, the game ends: more points wins, and equal points is a draw. A player with no legal move loses, which is rare: it takes nothing left to flip and every face-up piece boxed in.',
        },
        { kind: 'sub-heading', text: 'Repetition and chases' },
        {
          kind: 'paragraph',
          text: 'Repeating a position is never a draw, unlike in [banqi](/rules/banqi); the 40-ply count settles it. The one limit is on chasing.',
        },
        {
          kind: 'list',
          items: [
            'A *chase* is a move with no flip and no capture, after which the piece you moved could capture the enemy piece that just moved.',
            'You may not play a chase that brings about the same position, with the same player to move, for the third time.',
            'The chased piece may always run. A move that runs and threatens back is an ordinary move, and a chase onto new points never repeats.',
            'If forbidding the chase would leave you with no legal move, you may play it.',
          ],
        },
        {
          kind: 'paragraph',
          text: 'A flip or a capture starts both counts again: the 40 plies and the chase repetitions.',
        },
      ],
    },
    {
      heading: 'Compared with banqi',
      blocks: [BANQI_FAMILY_COMPARISON],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [PLAY],
    },
  ],
};
