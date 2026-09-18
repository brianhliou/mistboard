import {
  XQ_BLOCKED_ELEPHANT_EYES_PAIR,
  XQ_BLOCKED_HORSE_LEGS_PAIR,
  XQ_CANNON_RULE_PAIR,
  XQ_DARK_XIANGQI_THUMBNAIL,
  XQ_FACING_GENERAL_STEPS,
  XQ_FOG_SAMPLE_STEPS,
  XQ_GENERAL_CAPTURE_PAIR,
  XQ_START_TRIPTYCH,
  XQ_VISIBILITY_GRID,
  XQ_VISION_MOVE_PAIR,
  playClosing,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const darkXiangqiArticle: Article = {
    slug: 'fog-xiangqi',
    gameSpecId: 'dark-xiangqi',
    boardFamily: 'xiangqi',
    kind: 'rules',
    title: 'Fog Xiangqi Rules',
    // Same fix fog-chess already got: we brand it "Fog", the world searches
    // "fog of war". The summary carries the phrase; the title did not.
    seoTitle: 'Fog of War Xiangqi Rules',
    summary:
      'Fog Xiangqi rules: xiangqi under Fog of War, where each side sees only the points its pieces reach, hidden blockers matter, and the general falls by capture.',
    showSummaryOnPage: false,
    status: 'published',
    playableOnMistboard: true,
    publishedAt: '2026-05-26',
    updatedAt: '2026-07-23',
    audience:
      'Xiangqi players, Fog Chess players, and anyone who wants a clean first explanation of xiangqi under fog.',
    thumbnail: { kind: 'svg', svg: XQ_DARK_XIANGQI_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text: 'Fog Xiangqi is xiangqi under Fog of War. Pieces keep their normal movement, but unseen enemy pieces stay hidden and danger is not announced. Capture the general to win.',
      },
      {
        kind: 'paragraph',
        text:
          'Brian H. Liou designed Fog Xiangqi in 2026 as a Mistboard original. Fog of War has been played on the chess board since Jens Bæk Nielsen and Torben Osted invented dark chess in 1989, and chess.com runs it as a standard variant today. Nobody had carried it across to xiangqi. The cannon is the piece that makes it strange. It captures only by jumping over another piece, so under fog you are firing at something you cannot see, across a screen you are not certain is still there.',
      },
      {
        kind: 'paragraph',
        text:
          'If Xiangqi is new to you, start with [Xiangqi Rules](/rules/xiangqi). If you already play xiangqi, the sections below explain only what fog changes.',
      },
    ],
    sections: [
      {
        heading: 'The starting position',
        blocks: [
          {
            kind: 'paragraph',
            text: 'At the start, you see your own pieces and every legal destination they control. Everything else is fog. Your opponent sees a different board from the same true position.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_START_TRIPTYCH,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'What you see',
        blocks: [
          {
            kind: 'paragraph',
            text: "Here's the same rule, piece by piece.",
          },
          {
            kind: 'raw-svg',
            svg: XQ_VISIBILITY_GRID,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: 'Vision is recomputed from the true position after every move, so hidden blockers, cannon screens, horse legs, elephant eyes, and newly opened lines immediately change what you know.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_VISION_MOVE_PAIR,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Win condition: general capture',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Capture the general to win. Checks and checkmates are not announced, and the server does not warn a player who has moved into danger.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_GENERAL_CAPTURE_PAIR,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Draws',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Games auto-draw on threefold repetition and after 60 plies with no capture. Both are judged from the true position, not either player\'s view. There is no stalemate draw: if the side to move has no legal move, it loses, and with no check to freeze you, this almost never happens.',
          },
        ],
      },
      {
        heading: 'Edge cases',
        blocks: [
          { kind: 'sub-heading', text: 'Cannons' },
          {
            kind: 'paragraph',
            text: 'A cannon moves like a chariot when it is not capturing. To capture, it jumps exactly one screen and lands on the first enemy piece beyond it. Under fog, the screen appears as unknown occupancy and the target is visible as the enemy piece.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_CANNON_RULE_PAIR,
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'Horse legs' },
          {
            kind: 'paragraph',
            text: 'A horse can move only when the adjacent leg square is clear. If a hidden piece blocks that leg, the destination disappears from your visible set and the leg square appears as a ? marker.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_BLOCKED_HORSE_LEGS_PAIR,
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'Elephant eyes' },
          {
            kind: 'paragraph',
            text: 'An elephant moves two points diagonally and cannot cross the river. If a hidden piece sits on the midpoint eye, the diagonal destination disappears and the eye square appears as a ? marker.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_BLOCKED_ELEPHANT_EYES_PAIR,
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'Facing generals' },
          {
            kind: 'paragraph',
            text: 'Orthodox xiangqi forbids facing generals. Fog Xiangqi allows the position; if one general sees the other on a clear file, it can capture across that file.',
          },
          {
            kind: 'raw-svg-stepper',
            steps: XQ_FACING_GENERAL_STEPS,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'A sample game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'This public production game ends with the rule that most clearly separates Fog Xiangqi from ordinary xiangqi. Red sends a chariot to d10, Black’s general captures it, and the open file lets Red’s general fly from d1 to d10 for the win.',
          },
          {
            kind: 'raw-svg-stepper',
            header: {
              players: 'rebirthfox333 (Red) vs Misty DXQ 1.1 (Black)',
              event: 'Production game · July 17, 2026',
            },
            steps: XQ_FOG_SAMPLE_STEPS,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '[Open the original game](/dark-xiangqi/game/dxq_ef889df8-a1eb-4d0a-bd0a-ffd7e8bc30f4).',
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
                question: 'Can the bot see through the fog?',
                answer:
                  'No. Misty DXQ never sees the whole board. Each move it receives only the squares its own pieces can see, the same vision rule you play under, and it has to reason about everything else from what it has observed. The full position stays on the server, and the server is open source, so anyone can check what the engine is sent.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Fog Xiangqi is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
        playLabel: 'Play vs computer',
        playHref: '/?play=computer&gameSpecId=dark-xiangqi',
        secondary: [
          {
            label: 'Challenge a friend',
            href: '/?play=friend&gameSpecId=dark-xiangqi',
            emphasis: 'secondary',
          },
        ],
      }),
    ],
};
