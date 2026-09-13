import {
  FORTRESS_XIANGQI_ADVISOR_DIAGRAM,
  FORTRESS_XIANGQI_CANNON_DIAGRAM,
  FORTRESS_XIANGQI_DROP_REGIONS_DIAGRAM,
  FORTRESS_XIANGQI_CHARIOT_DIAGRAM,
  FORTRESS_XIANGQI_ELEPHANT_DIAGRAM,
  FORTRESS_XIANGQI_GENERAL_DIAGRAM,
  FORTRESS_XIANGQI_HORSE_DIAGRAM,
  FORTRESS_XIANGQI_SOLDIER_DIAGRAM,
  FORTRESS_XIANGQI_START_BOARD,
  FORTRESS_XIANGQI_TREASURE_DIAGRAM,
} from '../../fortress-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const fortressXiangqiArticle: Article = {
  slug: 'fortress-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  playableOnMistboard: true,
  title: 'Fortress Xiangqi Rules',
  summary:
    'A compact Xiangqi variant with captured pieces in reserve, piece drops, and one new piece: the Treasure.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-07-01',
  updatedAt: '2026-09-03',
  audience: 'Xiangqi and crazyhouse players who want a compact, decisive drop variant.',
  thumbnail: { kind: 'svg', svg: FORTRESS_XIANGQI_START_BOARD },
  intro: [
    {
      kind: 'paragraph',
      text: 'Fortress Xiangqi is a compact [Xiangqi](/rules/xiangqi) variant designed by Brian H. Liou in 2026 as a Mistboard original. It keeps the familiar pieces, adds one new piece called the Treasure, and gives each player an open reserve. Capture an enemy piece and you can later drop it back as your own.',
    },
    {
      kind: 'paragraph',
      text: 'Captured material stays in the game, so every exchange changes both the board and the reserves. A defensive trade now may supply the attacker you need later.',
    },
    {
      kind: 'paragraph',
      text: 'Shigenobu Kusumoto, working in Osaka, invented Mini Xiangqi in 1973. A Japanese designer took a Chinese game and built it a smaller board, the same move he made for his own country’s game with minishogi. Fortress Xiangqi runs that trade in the other direction. Shogi has had drops for centuries and xiangqi never has, so this is what xiangqi looks like when it borrows them.',
    },
  ],
  sections: [
    {
      heading: 'Board and setup',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The board is 7 files (a to g) by 8 ranks, with a river between ranks 4 and 5. Each side has a 3 by 3 palace, but the two palaces sit in opposite corners: Red holds the bottom left (a1 to c3) and Black holds the top right (e6 to g8). The whole setup has 180 degree rotational symmetry.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_START_BOARD,
          caption:
            'The starting position. Red holds the bottom-left palace, Black the top-right, and the Treasure starts on each palace corner.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'Red moves first. This is open information: both players see the whole board and both reserves.',
        },
      ],
    },
    {
      heading: 'The pieces',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The Chariot, Cannon, Horse, Elephant, Advisor, and General move as they do in [xiangqi](/rules/xiangqi). The Soldier is the one standard piece with a changed move, and the Treasure is new. In the diagrams below, a green dot marks a quiet destination, a green ring marks a capture, and a red cross marks a point the piece cannot reach.',
        },
        {
          kind: 'paragraph',
          text: '**Chariot:** slides any distance orthogonally, the strongest piece on the board. Here it can take the soldier on d7.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_CHARIOT_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Cannon:** moves like the Chariot on open lines, but captures only by jumping exactly one screen piece, friend or enemy. On the right, the cannon on d2 takes the chariot on d7 over its own soldier screen.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_CANNON_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Horse:** steps one point orthogonally, then one point diagonally outward. If the orthogonal step is occupied, that whole direction is blocked. On the right, the soldier on d5 takes away both forward destinations.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_HORSE_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Elephant:** moves exactly two points diagonally, is blocked by an occupied midpoint (the elephant eye), and can never cross the river.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_ELEPHANT_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Advisor:** moves one point diagonally and stays inside the palace.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_ADVISOR_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**General:** moves one point orthogonally and stays inside the palace. One xiangqi rule retires itself here: because the palaces sit in opposite corners, the two generals never share a file, so the facing-generals rule never comes into play.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_GENERAL_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Soldier:** moves one point forward, never backward. Once it crosses the river it may also step one point sideways, exactly as in xiangqi. The Treasure is the other piece the river holds back: it never crosses at all.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_SOLDIER_DIAGRAM,
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: '**Treasure:** the one new piece. It steps one point in any of the eight directions and never promotes. It roams its own half freely, but it never crosses the river, moving or dropping. It is the piece you are storming for, and it stays in the fortress.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_TREASURE_DIAGRAM,
          caption:
            'Left, the Treasure has all eight steps, including the capture on e4. Right, standing on the last rank of its own half, the three squares across the river are closed to it.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'There are no promotions. The river matters three ways: the Soldier gains its sideways step by crossing it, and neither the Elephant nor the Treasure may cross it at all.',
        },
      ],
    },
    {
      heading: 'Capture, hold, drop',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When you capture any piece other than the General, it changes to your color and enters your reserve. Both reserves are open information, have no size limit, and keep pieces for as long as needed. On your turn, either move a piece on the board or drop one piece from your reserve onto an empty point. Generals are never captured or held in reserve.',
        },
        {
          kind: 'paragraph',
          text: 'Chariots, Horses, Cannons, and Soldiers may drop on any empty point. Advisors, Elephants, and Treasures keep their normal territory restrictions.',
        },
        {
          kind: 'raw-svg',
          svg: FORTRESS_XIANGQI_DROP_REGIONS_DIAGRAM,
          caption:
            'Where a captured piece may land. The Chariot, Horse, Cannon and Soldier drop on any empty point; the Elephant and the Treasure are held to your own half, and the Advisor to your own palace.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'A dropped piece is live immediately. A drop may give check or deliver checkmate, and a Soldier dropped past the river arrives with its sideways step already earned. The one limit is the usual one: no move, drop included, may leave your own general in check.',
        },
      ],
    },
    {
      heading: 'How games end',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Checkmate wins. A player with no legal move also loses, even when not in check. There is no fifty-move or no-progress draw.',
        },
        {
          kind: 'paragraph',
          text: 'On the third occurrence of the same position, a player who gave check on every one of their moves in the repeating cycle loses. If neither player was the sole perpetual checker, the repetition is drawn.',
        },
        {
          kind: 'paragraph',
          text: 'Games can also end by timeout, resignation, or abandonment.',
        },
      ],
    },
    {
      heading: 'A sample game',
      blocks: [
        {
          kind: 'paragraph',
          text: 'This engine game shows both new rules at work. Three soldiers cross the river and gain their sideways step, and on move 23 Red drops its captured Treasure on d1, back inside its own half, because that is the only half it may enter.',
        },
        {
          kind: 'fortress-xiangqi-replay',
          spec: {
            red: 'Fairy-Stockfish',
            black: 'Fairy-Stockfish',
            event: 'Engine self-play · 2.5 s per move',
            moves:
              'd1b3 c8c6 e1d1 a7a6 f2f3 a6a5 f3f4 a5a4 f1e3 a8a5 f4f5 a5c5 d1f1 c5c3 f5g5 d8f6 e3f5 c6b6 f5d4 d7d6 g5f5 d6d5 d4b5 c3c5 f5f6 c5b5 f6e6 N@f4 E@d1 d5d4 e6d6 b5c5 g2g3 f7f6 d6e6 g8f7 e6f6 f7f6 f1f6 P@c2 d1f3 d4d3 d2d3 f4d3 T@d1 P@c3 P@a5 c5a5 d1c2 c3c2 P@d2 c2d2 f6d6 P@c2 g1f1 a5c5 d6d2 c2d2 P@b5 c5b5 P@a6 b6b3 b2b3 d2c2 a1b2 c2b2 c1b2 P@c2 f3d1 P@f2 b1a1 c2b2 f1f2 d3f2 C@f1 f2d1 P@f6 e8f7 f6f7 f8f7 A@b1 C@e1 P@c1 d1c3 f1f6 b2b1',
            resultText:
              'Black mates on move 43 with the soldier to b1, the same soldier that crossed the river on move 4. Red’s general has nowhere to go: its own soldier blocks a2, and Black covers both b1 and b2.',
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text: 'This game was chosen from twenty engine games played the same way. All twenty are in the [companion study](/study/NUVBVjFf), one chapter each, with a note on where the engine’s evaluation says the game turned.',
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Fortress Xiangqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
      playLabel: 'Play vs computer',
      playHref: '/?play=computer&gameSpecId=fortress-xiangqi',
      secondary: [
        {
          label: 'Challenge a friend',
          href: '/?play=friend&gameSpecId=fortress-xiangqi',
          emphasis: 'secondary',
        },
      ],
    }),
  ],
};
