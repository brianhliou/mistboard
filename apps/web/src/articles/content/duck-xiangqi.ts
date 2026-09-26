import {
  DUCK_XIANGQI_CANNON_SCREEN,
  DUCK_XIANGQI_ELEPHANT_PAIR,
  DUCK_XIANGQI_FACING_PIN,
  DUCK_XIANGQI_HORSE_PAIR,
  DUCK_XIANGQI_INTRO_BOARD,
  DUCK_XIANGQI_START_BOARD,
  DUCK_XIANGQI_THUMBNAIL,
  DUCK_XIANGQI_TURN_PAIR,
} from '../../duck-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const duckXiangqiArticle: Article = {
  slug: 'duck-xiangqi',
  gameSpecId: 'duck-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Duck Xiangqi Rules',
  summary:
    'Duck Chess on the xiangqi board. Every turn is a move and then a duck placement, the duck blocks and screens like a piece, and you win by capturing the general.',
  showSummaryOnPage: false,
  status: 'published',
  updatedAt: '2026-09-09',
  audience:
    'Xiangqi players, and Duck Chess players who want the xiangqi version stated precisely.',
  thumbnail: { kind: 'svg', svg: DUCK_XIANGQI_THUMBNAIL },
  intro: [
    {
      kind: 'paragraph',
      text: 'Duck Xiangqi is [xiangqi](/rules/xiangqi) with a duck on the board. Every turn you make a legal xiangqi move, and then you move the duck to an empty point. Both halves are one turn, and neither of them is optional.',
    },
    {
      kind: 'raw-svg',
      svg: DUCK_XIANGQI_INTRO_BOARD,
      caption:
        'One turn in. Red moved the horse, then placed the duck on c8, ringed. The duck is not on the board at the start.',
    } as ArticleBlock,
    {
      kind: 'paragraph',
      text: 'Brian H. Liou adapted Duck Xiangqi to the 9 by 10 board in 2026 as a Mistboard original. Dr Tim Paulden invented [Duck Chess](https://duckchess.com) in 2016, and Jim Aikin had already put movable neutral stones on a chessboard in [Eight-Stone Chess](https://www.chessvariants.com/page/EightStoneChess) in 1999. Nobody had carried the idea across to xiangqi. The cannon is the piece that makes it strange: it captures only by jumping over something, and a duck placed anywhere is something, so every placement you make is a platform your opponent may fire over.',
    },
    {
      kind: 'paragraph',
      text: 'The duck belongs to nobody. Nothing can capture it and nothing can land on it, it is never material, and it is not either side\u2019s piece. Its whole job is to be in the way, and both players take turns deciding where.',
    },
    {
      kind: 'paragraph',
      text: 'Chess has one way of blocking a piece: stand on the point it wants. Xiangqi has four. The sections below are where that difference lands.',
    },
  ],
  sections: [
    {
      heading: 'One turn, two actions',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board, the pieces, and the opening array are ordinary xiangqi. Red moves first.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_START_BOARD,
          caption:
            'The starting position. The duck is not on the board yet: it arrives as the second half of Red’s first turn.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'After that it moves every single turn. It may not stay where it is, and it may not land on an occupied point, so each turn ends with the duck somewhere new. Anywhere new: it is not a stepping piece, and any empty point on the board is a legal placement.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_TURN_PAIR,
          caption: 'The move alone is not a turn, and neither is the placement.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The one exception is the move that captures the enemy general. That ends the game on the spot, so the duck never gets its half of the turn.',
        },
      ],
    },
    {
      heading: 'The duck blocks like a piece',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Wherever xiangqi asks whether a point is occupied, the duck counts as occupied. It stops a chariot. It stands on the horse’s leg and fills the elephant’s eye. It screens for a cannon. It stands between the two generals.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_HORSE_PAIR,
          caption:
            'The horse on e5 reaches eight points. The duck on e6 stands on its leg, and the two steps through that point are gone.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That is a deliberate difference from Duck Chess, where the duck does not block a knight. A chess knight has no path to block. Xiangqi’s horse has a leg, the leg is a real point, and anything standing on it stops the horse. So the duck is stronger here than in Duck Chess: it freezes a horse from a point the horse was never going to occupy.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_ELEPHANT_PAIR,
          caption:
            'The elephant on c1 reaches a3 and e3. The duck on d2 fills the eye of the second one.',
        } as ArticleBlock,
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_CANNON_SCREEN,
          caption:
            'The cannon on e3 stops short of the duck going up the file, and shoots over it to take the chariot on e8. A screen is a screen, whoever it belongs to.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'The cannon is where the timing bites. You place the duck at the end of your turn, which means the screen you build is the screen your opponent fires over. Duck placement is never a cannon platform for yourself.',
        },
        {
          kind: 'paragraph',
          text: 'This one was a choice, and it is the choice that most changes how the game feels. Chess has no cannon and no capture that needs a platform, so Duck Chess never had to rule on it. The duck could have been written as a blocker a cannon may not fire over, which would have made it a purely defensive piece and a much quieter game. It counts as a screen instead, exactly as any piece does, because a rule that asks whether a point is occupied should get the same answer whatever is standing there.',
        },
      ],
    },
    {
      heading: 'There is no check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'No check, no checkmate, no warning. That comes straight from Duck Chess. You may move a piece that leaves your general attacked, you may place the duck and still leave it attacked, and you may move the general onto an attacked point. Neither half of the turn is tested for it. Your opponent wins by actually capturing the general, so miss the threat and you lose the game, not a tempo.',
        },
      ],
    },
    {
      heading: 'The generals may face',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Xiangqi never lets the two generals sit on one file with nothing between them. Here they may, because a general may fly down that file and capture the other one. That ends the game, and it is the only time a general leaves its palace.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_FACING_PIN,
          caption:
            'Only the duck stands on file e. Every point off the file hands Black the general, and the duck has to move somewhere every turn.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'So the duck defends as well as blocks, and it is an uncomfortable defender: holding a file costs you the duck every single turn.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'An engine game at full strength, 8 seconds a move. Watch the duck rather than the pieces: a cannon is firing over it in 30 of the 120 plies, and near the end Red is using it to hold a file its general cannot survive without.',
        },
        {
          kind: 'embed',
          path: '/embed/study/uMbk76wd/RPLi9LsH',
          title: 'Duck Xiangqi: an engine game, Black captures the general on move 60',
          // Shorter than atomic's 700: duck notation (b3-b5@d9) widens the
          // move sheet, so the board gets less of the 702px column (408px).
          // Its full height (435px) plus the card's 202px of seat rows,
          // controls, header and credit is 637; measured 2026-09-25, and 620
          // left the board height-bound.
          aspect: [702, 640],
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This game was chosen from 8 played the same way, for how much the duck does in it. 7 of the 8 finished; all 7 are in the [companion study](/study/uMbk76wd), one chapter each, with a note on how long each stayed competitive and what the duck was doing.',
        },
      ],
    },
    {
      heading: 'How games end',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Capturing the enemy general wins. A player with no legal turn loses, which is xiangqi’s answer to stalemate and the reverse of Duck Chess, where a player with no move wins. Games also end by timeout, resignation, or abandonment, the same as any other game here.',
        },
        {
          kind: 'paragraph',
          text: 'Two rules draw. The third occurrence of the same position is a draw, and the duck’s point is part of the position, since where it stands changes what every piece can do. Sixty moves by each player without a capture is also a draw, which is xiangqi’s own no-progress limit. Duck Chess never defined draw rules, so this half of the ruleset had to come from the xiangqi side.',
        },
      ],
    },
    playClosing({
      heading: 'Where to next',
      lead: 'Play it against the engine at any of eight strengths, or against a friend. The sample game above is one of seven in the companion study.',
      playLabel: 'Play Duck Xiangqi',
      playHref: '/?play=computer&gameSpecId=duck-xiangqi',
      secondary: [{ label: 'Seven engine games', href: '/study/uMbk76wd', emphasis: 'secondary' }],
    }),
  ],
};
