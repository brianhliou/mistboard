import {
  playClosing,
  XQ_PRIMER_ADVISOR_BOARD,
  XQ_PRIMER_CANNON_PAIR,
  XQ_PRIMER_CHARIOT_BOARD,
  XQ_PRIMER_ELEPHANT_PAIR,
  XQ_PRIMER_FACING_PAIR,
  XQ_PRIMER_GENERAL_BOARD,
  XQ_PRIMER_HORSE_PAIR,
  XQ_PRIMER_SOLDIER_PAIR,
  XQ_RULES_PRIMER_START_BOARD,
  XQ_RULES_PRIMER_THUMBNAIL,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const xiangqiArticle: Article = {
    slug: 'xiangqi',
    boardFamily: 'xiangqi',
    kind: 'rules',
    playableOnMistboard: true,
    title: 'Xiangqi Rules',
    // The h1 keeps the variant's own name (renaming variants is a product
    // decision, not an SEO one). This carries the term English speakers
    // actually type: "Chinese chess" appeared only once in body prose, never in
    // the title or the description, on the page sitting at position 37.
    seoTitle: 'Xiangqi Rules: How to Play Chinese Chess',
    summary:
      'The rules of xiangqi: palaces, the river, cannon screens, facing generals, and a famous game to play through. Now playable on Mistboard against the Pikafish engine or a friend.',
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-05-26',
    updatedAt: '2026-09-17',
    audience:
      'Players new to Xiangqi, and chess players who want to learn xiangqi and play it on Mistboard.',
    thumbnail: { kind: 'svg', svg: XQ_RULES_PRIMER_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text:
          'Xiangqi, also known as Chinese chess, took its modern form in China during the Song dynasty (960 to 1279), when the cannon joined the board. Its ancestors run back several centuries earlier, and it shares a common root with chess, shogi, and janggi in the older Indian game chaturanga. It is now among the most widely played board games in the world.',
      },
      {
        kind: 'paragraph',
        text:
          'Red and Black alternate moves, with Red first. Each side begins with 16 pieces: one general, two advisors, two elephants, two horses, two chariots, two cannons, and five soldiers. The goal is to checkmate the opposing general.',
      },
    ],
    sections: [
      {
        heading: 'The board',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'The board has 9 files and 10 ranks. In the traditional presentation, pieces sit on the intersections of the lines rather than inside squares.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_RULES_PRIMER_START_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              'The **palace** is the 3 by 3 box on each player\'s back side. Generals and advisors must stay inside their own palace. The **river** divides the board in half. Elephants cannot cross it, and soldiers gain sideways movement after crossing it.',
          },
        ],
      },
      {
        heading: 'The pieces',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'A piece captures by landing on an enemy-occupied point, and no piece may move through an occupied point. The cannon\'s capturing jump is the only exception. The pieces are listed below in the traditional order.',
          },
          {
            kind: 'table',
            headers: ['Piece (red / black)', 'Moves', 'Captures', 'Limits'],
            rows: [
              [
                'General 帥 / 將',
                'One point along a line',
                'The same way',
                'Never leaves the palace; may not face the other general on an open file',
              ],
              ['Advisor 仕 / 士', 'One point diagonally', 'The same way', 'Never leaves the palace'],
              [
                'Elephant 相 / 象',
                'Two points diagonally',
                'The same way',
                'Cannot cross the river; blocked by a piece on the midpoint',
              ],
              [
                'Horse 傌 / 馬',
                'One point along a line, then one diagonally outward',
                'The same way',
                'Blocked by a piece on the first point',
              ],
              ['Chariot 俥 / 車', 'Any distance along a line', 'The same way', 'Cannot jump'],
              [
                'Cannon 炮 / 砲',
                'Any distance along a line',
                'Jumps exactly one piece and takes the enemy beyond it',
                'Needs a screen to capture',
              ],
              [
                'Soldier 兵 / 卒',
                'One point forward; one point sideways too after crossing the river',
                'The same way',
                'Never backward; never promotes',
              ],
            ],
            caption: 'The seven pieces. Every piece captures the way it moves, except the cannon.',
          },
          {
            kind: 'paragraph',
            text:
              '**General:** moves one point horizontally or vertically and can never leave its own palace. The two generals may never face each other along an open file with nothing between them: a move that would expose that line is illegal. In effect, a general guards the file in front of it like a chariot.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_GENERAL_BOARD,
          } as ArticleBlock,
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_FACING_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Advisor:** moves one point diagonally and, like the general, stays inside the palace. Both advisors share just five possible points. Their main job is to protect the general, but they can also become a liability by blocking its escape or serving as a cannon screen.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_ADVISOR_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Elephant:** moves exactly two points diagonally and cannot cross the river, so the two elephants share only seven possible points on their own half. It does not jump: a piece on the midpoint of the diagonal, the elephant\'s eye, blocks the move.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_ELEPHANT_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Horse:** moves one point orthogonally and then one point diagonally outward, like a chess knight, but it does not jump. If the orthogonal point it steps through, the horse\'s leg, is occupied, the horse cannot move in that direction.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_HORSE_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Chariot:** moves any distance horizontally or vertically and cannot jump, exactly like a rook. It is the strongest piece on the board.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_CHARIOT_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Cannon:** moves like a chariot when it is not capturing. To capture, it jumps over exactly one piece, friend or foe, called the screen, and lands on an enemy piece beyond it.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_CANNON_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Soldier:** moves one point straight forward and never backward. After crossing the river it may also move one point sideways. It never promotes.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_SOLDIER_PAIR,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Check, checkmate, and endings',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'A general is in **check** when an enemy piece attacks it. Every move must leave your own general safe, so a player in check must move the general, capture the attacker, or block the attack. If no legal answer exists, it is checkmate and the checked player loses.',
          },
          {
            kind: 'paragraph',
            text:
              'A player with no legal move also loses, even when the general is not in check. In Western chess that position is a stalemate draw; in xiangqi it is a win for the player who made the last move.',
          },
          {
            kind: 'paragraph',
            text:
              'Tournament rules use detailed procedures for perpetual check, perpetual chase, and other repeated attacks. Mistboard uses two automatic draw rules: the same position three times, or 60 consecutive plies without a capture.',
          },
        ],
      },
      {
        heading: 'A famous game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'To see the pieces work together, step through a famous trap from a manual printed in 1632. Red gives up a horse; when Black grabs it, Red\'s chariots and cannons pour through the gap and checkmate on the thirteenth move.',
          },
          {
            kind: 'embed',
            path: '/embed/study/dpz2AiXD/47mvlshL',
            title: 'Xiangqi: Sacrifice the Horse in 13, from a manual printed in 1632',
            // Width-bound at the 702px column: the 9x10 board beside the SAN
            // move sheet, plus seat rows, controls, header and credit.
            aspect: [702, 600],
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Common questions',
        blocks: [
          {
            kind: 'faq',
            items: [
              {
                question: 'How does each piece move in xiangqi?',
                answer:
                  'General: one point along a line, inside the palace. Advisor: one point diagonally, inside the palace. Elephant: two points diagonally, never across the river. Horse: one point along a line then one diagonally out, blocked if the first point is occupied. Chariot: any distance along a line. Cannon: moves like a chariot, captures by jumping exactly one piece. Soldier: one point forward, and sideways too after crossing the river.',
              },
              {
                question: 'What can a soldier capture?',
                answer:
                  'Any enemy piece on a point it could move to: the point straight ahead, and after crossing the river the points to its left and right as well. It never captures backward or diagonally, and it never promotes.',
              },
              {
                question: 'Can the general capture a soldier?',
                answer:
                  'Yes. The general captures any enemy piece on an adjacent point along a line, including a soldier, as long as it stays inside the palace and the move does not leave the two generals facing each other on an open file.',
              },
              {
                question: 'Which xiangqi pieces are worth the most?',
                answer:
                  'The usual rule of thumb: chariot 9, cannon 4.5, horse 4, advisor 2, elephant 2, soldier 1 before crossing the river and 2 after. The chariot is worth about two of any other piece, so a trade of a horse or cannon for a chariot is nearly always good.',
              },
              {
                question: 'How do you win at xiangqi?',
                answer:
                  'Checkmate the general, or leave your opponent with no legal move: unlike Western chess, stalemate is a loss for the player who cannot move. In practice games are decided by getting the chariots onto open files early, keeping cannons behind a screen, and using soldiers that have crossed the river as attacking pieces. The eight engine levels on this page start well below club strength, and the post-game review shows where a game turned.',
              },
              {
                question: 'When was xiangqi invented?',
                answer:
                  'The modern game, with the cannon on the board, took shape in China during the Song dynasty (960 to 1279). Its ancestors run several centuries earlier, and it shares a root with chess, shogi, and janggi in the older Indian game chaturanga.',
              },
              {
                question: 'What is the difference between xiangqi and chess?',
                answer:
                  'Pieces sit on the intersections of a 9 by 10 grid, not inside squares. A river splits the board and a palace confines the general and advisors. The cannon captures by jumping, the horse can be blocked, elephants cannot cross the river, and soldiers never promote. Stalemate loses instead of drawing.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Xiangqi is playable on Mistboard: find a casual or rated game against another player, take on the engine ladder, or challenge a friend. No account required. Signing in unlocks rated games.',
        playLabel: 'Find an opponent',
        playHref: '/?play=lobby&gameSpecId=xiangqi',
        secondary: [
          { label: 'Play vs computer', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'secondary' },
        ],
      }),
    ],
};
