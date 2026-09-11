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
  // The launch date, not the day the rules text was last edited. The homepage
  // row sorts on publishedAt ?? updatedAt and prints it on the card.
  publishedAt: '2026-09-11',
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
          kind: 'duck-xiangqi-replay',
          spec: {
            red: 'Fairy-Stockfish',
            black: 'Fairy-Stockfish',
            event: 'Engine self-play \u00b7 8s per move',
            moves:
              'b3b5@d9 b8b6@a8 h3e3@b9 g7g6@e5 b5c5@g8 b6c6@e5 b1a3@c8 h10g8@g3 e3e7@f8 b10c8@e6 e7h7@b3 g8f6@e5 c5c7@c5 h8e8@e6 c1e3@c5 c6e6@e2 h1g3@e5 i10h10@c6 h7h6@h9 f6g4@f6 h6h3@h7 e6a6@b10 a1a2@h9 a6b6@b2 h3i3@h7 a10b10@b2 c4c5@c6 g4i3@i2 a2h2@h3 c10a8@h5 i1i3@h7 b6b3@h4 c7f7@h3 b3c3@h5 a3c2@h3 h10h7@h6 f7f2@h3 h7f7@g2 h2h10@f3 f7g7@d2 g3f5@g9 g7f7@f6 f2f3@d3 b10b3@f6 f5d4@f5 b3b2@d3 f3g3@f3 g10i8@d3 h10h8@g2 e8f8@d3 h8h7@g7 f7d7@e7 h7h8@d6 d10e9@d3 d4e6@e7 f8f3@h3 i3i2@e2 b2c2@g2 f1e2@f5 d7e7@f8 e6d4@d2 f3f8@d3 g3g2@f2 c2b2@d2 d4c2@f2 b2c2@d2 i4i5@f4 c2a2@d2 e2f1@c2 f8f2@e2 i2i4@f4 c3c4@d2 h8i8@g4 f2d2@e2 e4e5@c2 d2d4@e4 i4i2@h2 d4e4@e2 e3c1@b2 g6g5@e3 g2h2@h5 e7h7@e3 i8g8@b2 g5f5@e8 h2g2@b2 h7h1@g7 g2g3@h2 a2c2@g2 c1e3@e2 h1g1@f2 g3g2@e2 c2c3@d3 i2h2@e2 c3e3@a5 g2g7@e2 c8e7@d8 g8i8@e2 g1g7@g2 e5e6@e2 e7d9@f2 e6d6@e2 e3d3@e3 e1e2@d4 a8c10@e3 i8i7@h7 g7g1@f2 i7a7@e1 d3d1@g2 e2e3@e2 e4e5@f3 a7f7@d4 f5f4@f3 f7f5@e2 g1f1@e1 d6d7@e2 f4e4@d2 e3e2@e3 f1e1@f2 h2h1@a1 e1e2',
            resultText:
              'Black captures the general on move 60. Red had the better of the opening, but the engine eval was still within a pawn and a half of level as late as ply 63, and Black ground it out from there.',
          },
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
