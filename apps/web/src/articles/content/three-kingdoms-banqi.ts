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
import type { Article } from '../types.js';

// Draft for #628, written 2026-10-24 alongside the engine
// (packages/game/src/variants-three-kingdoms-banqi.ts) and checked against it
// rule by rule. Registered as a draft so dev serves it for review and
// production 404s it until the variant launches. Every move diagram asks the
// kernel for its marks (three-kingdoms-banqi-diagrams.ts).
// Five rules the app leaves unwritten (perpetual chase, what resets the 40-ply
// count, face-down capture, wipe-out, no legal move) were decided for Mistboard
// on 2026-10-25 (THREE_KINGDOMS_BANQI_RULES in the engine). The app's help has no
// section for this mode, so the page presents them as Mistboard's rules, not
// Gamesofa's; change the engine and this page together.
export const threeKingdomsBanqiArticle: Article = {
  slug: 'three-kingdoms-banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Three Kingdoms Banqi Rules',
  summary:
    'Three Kingdoms banqi is face-down banqi on a 9 by 5 board with xiangqi moves. Any piece can capture any piece, every capture scores points, and the first player to 100 wins.',
  showSummaryOnPage: false,
  status: 'draft',
  thumbnail: { kind: 'svg', svg: TK_THUMBNAIL },
  tldr: [
    'All thirty-two pieces start face-down. On your turn, flip one or move one of your face-up pieces.',
    'Pieces move much as in xiangqi, with no palace and no river, and any piece can capture any face-up enemy piece.',
    'Every capture scores points, and the first player to 100 wins.',
  ],
  audience:
    'Banqi players who have met the Three Kingdoms mode in Gamesofa’s banqi app and want its rules written down, and xiangqi players curious about a scoring version of dark chess.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Three Kingdoms banqi takes banqi’s face-down luck and gives the pieces [xiangqi](/rules/xiangqi) moves with the limits taken off. Chariots sweep the board, cannons fire over tiles, horses leap, and there is no rank order: a soldier can take the general. Every capture scores points, and the first player to 100 wins, so a game turns on what to flip, what to grab and what to leave hanging.',
    },
    {
      kind: 'paragraph',
      text: 'The mode comes from Gamesofa’s banqi app, which added it in July 2026 without a written rulebook. This page gives the rules Mistboard plays; where the app leaves one unclear, the choice is ours. Mistboard is not affiliated with Gamesofa.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'As in [banqi](/rules/banqi), all thirty-two pieces start shuffled and face-down. Here they stand on the points where the lines cross, in four blocks of eight with the middle row and column empty, on a board 9 points wide and 5 deep with no river. Each color has a general, two advisors, two elephants, two chariots, two horses, two cannons and five soldiers.',
        },
        {
          kind: 'raw-svg',
          svg: TK_SETUP,
        },
      ],
    },
    {
      heading: 'Turns',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On your turn you do one thing: flip a face-down piece, or move one of your face-up pieces. A flip takes the whole turn.',
        },
        {
          kind: 'paragraph',
          text: 'The first flip of the game decides the colors. Whoever makes it plays the color they turned up. After that you may flip any face-down piece, including one that turns out to be your opponent’s.',
        },
      ],
    },
    {
      heading: 'How the pieces move',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Pieces move much as in [xiangqi](/rules/xiangqi), but there is no palace and no river, so no piece is confined to one part of the board. Nothing blocks a horse or an elephant. The general slides like a chariot, and a soldier can step backward.',
        },
        {
          kind: 'paragraph',
          text: '**Any piece can capture any piece.** There is no rank order as in banqi: a soldier can take a chariot, and an advisor can take the general. Only face-up enemy pieces can be captured. Nothing can move onto a face-down piece, and it stops a sliding piece like any other. The general is an ordinary piece: there is no check, and capturing it only scores its points.',
        },
        {
          kind: 'paragraph',
          text: 'In the diagrams, dots show where the piece can move, rings show what it can capture, and blank tiles are face-down pieces.',
        },
        {
          kind: 'paragraph',
          text: '**General:** slides any distance along a row or column until a piece stops it. Below, it can take the black cannon.',
        },
        {
          kind: 'raw-svg',
          svg: TK_GENERAL,
        },
        {
          kind: 'paragraph',
          text: '**Chariot:** moves exactly like the general. Below, it can take the black horse, but the face-down tile blocks it.',
        },
        {
          kind: 'raw-svg',
          svg: TK_CHARIOT,
        },
        {
          kind: 'paragraph',
          text: '**Cannon:** slides like the chariot when it moves. To capture, it jumps exactly one piece, face-up or face-down, of either color. Below, it can take the general by jumping the face-down tile, but not the soldier next to it, with nothing to jump.',
        },
        {
          kind: 'raw-svg',
          svg: TK_CANNON,
        },
        {
          kind: 'paragraph',
          text: '**Horse:** jumps one point straight and one diagonally, even when a piece stands next to it. Below, all four points straight next to it are occupied, and it still reaches all eight of its points, including the capture on the black chariot.',
        },
        {
          kind: 'raw-svg',
          svg: TK_HORSE,
        },
        {
          kind: 'paragraph',
          text: '**Elephant:** jumps two points diagonally, even over a piece. Below, it jumps the pieces next to it, but cannot land on the face-down tile at the bottom right.',
        },
        {
          kind: 'raw-svg',
          svg: TK_ELEPHANT,
        },
        {
          kind: 'paragraph',
          text: '**Advisor:** steps one point diagonally. Below, it can take the general, but not the face-down tile.',
        },
        {
          kind: 'raw-svg',
          svg: TK_ADVISOR_TAKES_GENERAL,
        },
        {
          kind: 'paragraph',
          text: '**Soldier:** steps one point forward, backward or sideways. Below, it can take the chariot in front of it.',
        },
        {
          kind: 'raw-svg',
          svg: TK_SOLDIER,
        },
      ],
    },
    {
      heading: 'Scoring',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Every capture scores the value of the piece taken: 5 for a soldier, advisor or elephant, 10 for a cannon or horse, 15 for a chariot and 20 for the general. Each color’s sixteen pieces are worth 135 in all.',
        },
        {
          kind: 'raw-svg',
          svg: TK_POINTS,
        },
        {
          kind: 'paragraph',
          text: 'Points go to the player who captures. If you flipped one of your opponent’s pieces earlier, taking it later still scores for you.',
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first player to reach 100 points wins at once, even with pieces still on the board. A side can never be wiped out: its sixteen pieces are worth 135, so whoever is capturing them reaches 100 before the last ones go. It is rare, but a player who has nothing left to flip and every face-up piece boxed in has no legal move, and loses.',
        },
        {
          kind: 'paragraph',
          text: 'If 40 plies (single moves) pass with no flip and no capture, the game ends and the player with more points wins. Equal points is a draw. A flip or a capture starts the count again.',
        },
        { kind: 'sub-heading', text: 'Repetition and chases' },
        {
          kind: 'paragraph',
          text: 'A repeated position never draws here, unlike in [banqi](/rules/banqi); the 40-ply count settles it. The one limit is on chasing. A **chase** is a quiet move, with no flip and no capture, after which the piece you moved could capture the enemy piece that just moved.',
        },
        {
          kind: 'paragraph',
          text: 'You may not play a chase that brings about the same position, with the same player to move, for the third time or later, unless chases are all you can play. A flip or capture starts that count again. The chased piece may always run, a move that both runs and threatens back counts as an ordinary move, and a chase that keeps driving the piece onto new points never repeats, so it is never stopped.',
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
              question: 'Can you capture a face-down piece?',
              answer:
                'No. Only face-up enemy pieces can be captured, by the cannon or anything else. A face-down piece can only be flipped.',
            },
            {
              question: 'Is the general special in Three Kingdoms banqi?',
              answer:
                'Only in its value. It is worth 20, the most of any piece, and it slides like a chariot. It is not royal: capturing it scores 20 points, and play goes on unless that reaches 100.',
            },
            {
              question: 'How is this different from regular banqi?',
              answer:
                'Regular banqi is played on a 4 by 8 board, pieces move one square, cannons capture by jumping, and other captures follow a rank order with the soldier able to take the general. Three Kingdoms banqi uses a 9 by 5 board, xiangqi moves and no rank order, and you win on points, not by taking every enemy piece.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play a bot',
              href: '/?play=computer&gameSpecId=three-kingdoms-banqi',
              emphasis: 'primary',
            },
            {
              label: 'Play a friend',
              href: '/?play=friend&gameSpecId=three-kingdoms-banqi',
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
  ],
};
