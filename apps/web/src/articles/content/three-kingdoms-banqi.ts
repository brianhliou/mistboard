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
// production 404s it: the engine has no room, route or lobby, and whether it
// gets one is the 10-31 checkpoint's call. Every move diagram asks the kernel
// for its marks (three-kingdoms-banqi-diagrams.ts).
// Rules marked as defaults in the engine (face-down capture, the 7th chase,
// a capture resetting the 40-ply count, no legal move) are stated here as
// Mistboard's rules; change both together if the app turns out to differ.
export const threeKingdomsBanqiArticle: Article = {
  slug: 'three-kingdoms-banqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Three Kingdoms Banqi Rules (三國暗棋)',
  summary:
    'Three Kingdoms banqi is face-down banqi on a 9 by 5 board with xiangqi moves. Any piece can capture any piece, every capture scores points, and the first player to 100 wins.',
  showSummaryOnPage: false,
  status: 'draft',
  thumbnail: { kind: 'svg', svg: TK_THUMBNAIL },
  audience:
    'Banqi players who have met the Three Kingdoms mode in 神來也暗棋2 and want its rules written down, and xiangqi players curious about a scoring version of dark chess.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Three Kingdoms banqi (三國暗棋) is a two-player dark chess game from Gamesofa, added to their app 神來也暗棋2 in July 2026. It starts like [banqi](/rules/banqi), with every piece shuffled face-down, but it is played on a 9 by 5 board and the pieces move as they do in [xiangqi](/rules/xiangqi). There is no rank order: any piece can capture any enemy piece it reaches. Each capture scores points, and the first player to 100 wins.',
    },
    {
      kind: 'paragraph',
      text: 'Gamesofa has not published a full rulebook for the mode. This page gives the exact rules Mistboard uses, worked out from games played in the app. Mistboard is not affiliated with Gamesofa.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board has 9 columns and 5 rows of points, 45 in all, with no river. The thirty-two xiangqi pieces are shuffled face-down into four blocks of eight, one in each corner: two rows by four columns. The middle column and the middle row start empty.',
        },
        {
          kind: 'raw-svg',
          svg: TK_SETUP,
          caption:
            'The deal: four face-down blocks of eight, with the middle column and middle row empty.',
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
          text: 'Pieces move as in xiangqi, with three differences. There is no palace, so the general and advisors go anywhere. There is no river, so elephants cross the middle row and soldiers never change how they move. And horses and elephants cannot be blocked.',
        },
        {
          kind: 'paragraph',
          text: 'The chariot slides any distance along a row or column. The general moves exactly like the chariot, not one step at a time as in xiangqi. The cannon slides the same way when it moves, but to capture it must jump exactly one piece, face-up or face-down, of either color. The horse jumps one point straight and one diagonally, even when a piece stands next to it. The elephant jumps two points diagonally, even over a piece. The advisor steps one point diagonally. The soldier steps one point forward, backward or sideways.',
        },
        {
          kind: 'raw-svg',
          svg: TK_CHARIOT,
          caption:
            'The chariot slides until something stops it. It can take the black horse; the face-down tile blocks it and cannot be taken.',
        },
        {
          kind: 'raw-svg',
          svg: TK_GENERAL,
          caption:
            'The general slides like a chariot, the whole row or column, and can take the black cannon.',
        },
        {
          kind: 'raw-svg',
          svg: TK_CANNON,
          caption:
            'The cannon captures the general by jumping the face-down tile. The soldier next to it is not a target: there is nothing to jump.',
        },
        {
          kind: 'raw-svg',
          svg: TK_HORSE,
          caption:
            'Every point next to the horse is occupied, and it still reaches all eight of its points, including the capture on the black chariot.',
        },
        {
          kind: 'raw-svg',
          svg: TK_ELEPHANT,
          caption:
            'The elephant jumps over pieces and across the middle row. The face-down tile at the bottom right is not a destination.',
        },
        {
          kind: 'raw-svg',
          svg: TK_SOLDIER,
          caption:
            'The soldier steps in any of four directions, backward included, and can take the chariot in front of it.',
        },
        {
          kind: 'paragraph',
          text: 'A face-down piece blocks a sliding piece like any other, and nothing can move onto it.',
        },
      ],
    },
    {
      heading: 'Captures and points',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Any piece captures any face-up enemy piece it can reach. A soldier can take a chariot; an advisor can take the general. The general is an ordinary piece: there is no check, and losing it does not lose the game.',
        },
        {
          kind: 'raw-svg',
          svg: TK_ADVISOR_TAKES_GENERAL,
          caption:
            'The advisor can take the general. The face-down tile is not a destination.',
        },
        {
          kind: 'paragraph',
          text: 'You score the value of every piece you capture. Soldiers, advisors and elephants are worth 5, cannons and horses 10, chariots 15 and the general 20. Each color’s sixteen pieces add up to 135.',
        },
        {
          kind: 'raw-svg',
          svg: TK_POINTS,
          caption:
            'What each piece scores for the player who captures it.',
        },
        {
          kind: 'paragraph',
          text: 'Points go to the player who captures, whatever the color of the piece. If you flipped one of your opponent’s pieces earlier, capturing it later still scores for you.',
        },
      ],
    },
    {
      heading: 'Winning and draws',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The first player to reach 100 points wins at once, even with pieces still on the board. You also win if your opponent has no legal move on their turn: no face-down piece left to flip and no face-up piece that can move, which includes having no pieces at all.',
        },
        {
          kind: 'paragraph',
          text: 'If 40 plies (single moves) pass with no flip and no capture, the game ends and the player with more points wins. Equal points is a draw.',
        },
        {
          kind: 'paragraph',
          text: 'A chase (長捉) is a quiet move, with no flip and no capture, that threatens to capture an enemy piece. You may chase the same piece at most six times in a row; a seventh chasing move against it is not allowed, and you have to play something else.',
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
                'Only in its value. It is worth 20, the most of any piece, and it slides like a chariot. It is not royal: capturing it scores points and play goes on.',
            },
            {
              question: 'How is this different from regular banqi?',
              answer:
                'Regular banqi is played on a 4 by 8 board, pieces move one square, and captures follow a rank order with the soldier able to take the general. Three Kingdoms banqi uses a 9 by 5 board, full xiangqi moves and no rank order, and you win on points, not by taking every enemy piece.',
            },
          ],
        },
      ],
    },
  ],
};
