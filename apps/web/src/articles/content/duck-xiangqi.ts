import {
  DUCK_XIANGQI_CANNON_SCREEN,
  DUCK_XIANGQI_FACING_PIN,
  DUCK_XIANGQI_HORSE_PAIR,
  DUCK_XIANGQI_START_BOARD,
  DUCK_XIANGQI_THUMBNAIL,
  DUCK_XIANGQI_TURN_PAIR,
} from '../../duck-xiangqi-rules-diagrams.js';
import { relatedClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const duckXiangqiArticle: Article = {
  slug: 'duck-xiangqi',
  gameSpecId: 'duck-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: false,
  title: 'Duck Xiangqi Rules',
  summary:
    'Duck Chess on the xiangqi board. Every turn is a move and then a duck placement, the duck blocks and screens like a piece, and you win by capturing the general.',
  showSummaryOnPage: false,
  status: 'draft',
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
      kind: 'paragraph',
      text: 'The duck belongs to nobody. It cannot be captured, it is not material, and it is not either side’s piece. Its whole job is to be in the way, and both players take turns deciding where.',
    },
    {
      kind: 'paragraph',
      text: 'Dr Tim Paulden invented Duck Chess in 2016 and published it at [duckchess.com](https://duckchess.com); Jim Aikin had already put movable neutral stones on a chessboard in [Eight-Stone Chess](https://www.chessvariants.com/page/EightStoneChess) in 1999. Brian Liou adapted the one-duck game to the 9 by 10 board for Mistboard, and we have not found an earlier Chinese chess version of it. Chess has one way of blocking a piece and xiangqi has four, so the port raised questions the original never had to answer, and the sections below are where they land.',
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
          caption:
            'One turn, and it is the engine’s own first choice here: Red plays the horse to c3, then sends the duck to c8, deep in Black’s half. The move alone is not a turn, and neither is the placement.',
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
          text: 'Wherever xiangqi asks whether a point is occupied, the duck counts as occupied. It stops a chariot. It stands on the horse’s leg and fills the elephant’s eye. It screens for a cannon. It breaks the file between the two generals.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_HORSE_PAIR,
          caption:
            'The horse on e5 reaches eight points. Put the duck on e6 and the two destinations that step through it are gone, marked here with crosses.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That is a deliberate difference from the chess game, where the duck does not block a knight. A chess knight has no path to block. Xiangqi’s horse has a leg, the leg is a real point, and anything standing on it stops the horse. So the duck is stronger here than it is in chess: it freezes a horse from a point the horse was never going to occupy.',
        },
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
      ],
    },
    {
      heading: 'There is no check',
      blocks: [
        {
          kind: 'paragraph',
          text: 'No check, no checkmate, no warning. You are allowed to leave your general attacked, and your opponent wins by actually capturing it. Miss the threat and you lose the game, not a tempo.',
        },
      ],
    },
    {
      heading: 'The generals may face, and then one of them dies',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Xiangqi says the two generals may never be left facing each other down a file with nothing in between. The reason is that they attack each other along that file, so leaving them facing puts your own general in check, and standard xiangqi never lets you find out what would happen next.',
        },
        {
          kind: 'paragraph',
          text: 'Here you find out. There is no check, so the attack becomes a move: a general may fly the length of an open file and capture the other one, which ends the game. Leaving the generals facing is a legal thing to do and it normally loses. This is the only time a general leaves its palace.',
        },
        {
          kind: 'raw-svg',
          svg: DUCK_XIANGQI_FACING_PIN,
          caption:
            'Nothing stands on file e but the duck, so the duck is the only reason Red still has a general. It has to move somewhere every turn, and every point off the file hands Black the win.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'That makes the duck a defender as well as an obstacle, and an uncomfortable one, because it can never stand still. Holding a file costs you the duck every single turn, and the moment you want it somewhere else you have to find another way to block. The same trick works in reverse: open the file with a piece and you may still close it again with the duck in the same turn, since only the finished turn is judged.',
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
    relatedClosing({
      heading: 'Where to next',
      lead: 'Duck Xiangqi is not one of the games open for play here yet. Xiangqi is, and so is Fortress Xiangqi, the other variant on this board with a rule the original does not have.',
      links: [
        { label: 'Play xiangqi', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'primary' },
        { label: 'Xiangqi rules', href: '/rules/xiangqi', emphasis: 'secondary' },
        {
          label: 'Fortress Xiangqi rules',
          href: '/rules/fortress-xiangqi',
          emphasis: 'secondary',
        },
      ],
    }),
  ],
};
