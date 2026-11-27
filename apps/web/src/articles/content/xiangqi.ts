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
  XQ_PRIMER_SOLDIER_TRIO,
  XQ_RULES_PRIMER_START_BOARD,
  XQ_RULES_PRIMER_THUMBNAIL,
} from '../diagrams.js';
import { xiangqiRulesDiagram } from '../../xiangqi-rules-diagrams.js';
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
    tagline: 'A river, a palace, and cannons that jump to capture.',
    summary:
      'The rules of xiangqi for chess players: the palace and river, cannon screens, facing generals, perpetual check, notation, and a famous game to play through. Playable on Mistboard against the Pikafish engine or a friend.',
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-05-26',
    updatedAt: '2026-11-27',
    updateNote: 'The rules are shorter, set out as lists beside the diagrams, with new boards showing a horse move and a cannon capture from the start.',
    tldr: [
      'Red moves first on a board of 9 files and 10 ranks. Generals and advisors stay in their palaces; elephants cannot cross the river.',
      'Cannons capture by jumping exactly one screen. Horses and elephants can be blocked; soldiers gain sideways movement after crossing the river.',
      'Checkmate wins, and a player with no legal move loses. Generals may never face each other on a clear file.',
    ],
    audience:
      'Players new to Xiangqi, and chess players who want to learn xiangqi and play it on Mistboard.',
    thumbnail: { kind: 'svg', svg: XQ_RULES_PRIMER_THUMBNAIL },
    intro: [
      {
        kind: 'paragraph',
        text:
          'Xiangqi, also known as Chinese chess, is played by Red and Black on the points of a 9 by 10 board. Red moves first. The goal is to checkmate the enemy general.',
      },
    ],
    sections: [
      {
        heading: 'The board and setup',
        blocks: [
          {
            kind: 'raw-svg',
            svg: XQ_RULES_PRIMER_START_BOARD,
          } as ArticleBlock,
          {
            kind: 'list',
            items: [
              '**Pieces stand on points**, where the lines cross. The board has 9 files and 10 ranks.',
              "**The river splits the board in half.** Elephants never cross it; soldiers gain a sideways step once they do.",
              "**The palace is the 3 by 3 box** marked with diagonals on each side's back ranks. The general and advisors never leave it.",
              '**Each side has 16 pieces:** one general, two advisors, two elephants, two horses, two chariots, two cannons and five soldiers.',
              '**The back rank holds, from edge to edge,** a chariot, horse, elephant, advisor, general, advisor, elephant, horse and chariot. The cannons stand two ranks ahead on the b and h files, and the soldiers one rank further on the a, c, e, g and i files.',
            ],
          },
        ],
      },
      {
        heading: 'The pieces',
        blocks: [
          {
            kind: 'paragraph',
            text: '**A piece captures by landing on an enemy piece.** No piece moves through an occupied point, except the cannon when it captures.',
          },
          { kind: 'sub-heading', text: 'General' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_GENERAL_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The general moves one point along a line** and never leaves its palace.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_FACING_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The generals may never face each other** on a file with nothing between them. A move that opens that file is illegal, so a general guards the file in front of it like a chariot.',
          },
          { kind: 'sub-heading', text: 'Advisor' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_ADVISOR_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The advisor moves one point diagonally** and never leaves its palace, so it has only five points to stand on.',
          },
          { kind: 'sub-heading', text: 'Elephant' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_ELEPHANT_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: "**The elephant moves exactly two points diagonally** and never crosses the river, so it has seven points on its own half. A piece on the point in between blocks the move; that point is called the elephant's eye.",
          },
          { kind: 'sub-heading', text: 'Horse' },
          {
            kind: 'raw-svg',
            svg: xiangqiRulesDiagram('horse', 'A HORSE MOVE', 'THE HORSE ON C3'),
          },
          {
            kind: 'paragraph',
            text: '**The horse moves one point along a line, then one point diagonally outward.** It moves like a chess knight, but it cannot jump.',
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_HORSE_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: "**A piece on the first point blocks that move.** That point is called the horse's leg. At the start, the elephant beside each horse blocks its way toward the centre.",
          },
          { kind: 'sub-heading', text: 'Chariot' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_CHARIOT_BOARD,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The chariot moves any distance along a line**, like a chess rook. It is the strongest piece on the board.',
          },
          { kind: 'sub-heading', text: 'Cannon' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_CANNON_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The cannon moves like a chariot when it is not capturing.**',
          },
          {
            kind: 'raw-svg',
            svg: xiangqiRulesDiagram('cannon', 'CAPTURES BY JUMPING', 'THE CANNON TAKES A HORSE'),
          },
          {
            kind: 'paragraph',
            text: '**To capture, the cannon jumps exactly one piece**, of either colour, and lands on the enemy piece beyond it. The piece it jumps is called the screen. Here the red cannon jumps the black cannon and takes the horse behind it.',
          },
          { kind: 'sub-heading', text: 'Soldier' },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_SOLDIER_PAIR,
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: '**The soldier moves one point straight forward and never backward**, and it captures the same way. Once it crosses the river it may also step one point sideways, and on the last rank it can only step sideways. It never promotes.',
          },
        ],
      },
      {
        heading: 'Check, checkmate, and draws',
        blocks: [
          {
            kind: 'paragraph',
            text: '**Answer every check.** A move that leaves your own general attacked is illegal. A general can help mate from the far end of an open file, because the enemy general may not step onto that file.',
          },
          {
            kind: 'table',
            wrap: true,
            headers: ['When', 'Result'],
            rows: [
              ['You have no legal move and are in check', 'Checkmate: you lose.'],
              ['You have no legal move and are not in check', 'Stalemate: you lose too.'],
              [
                'The same position, with the same side to move, comes a third time',
                'Whoever checked on every move of the cycle loses. If both sides did, or neither did, it is a draw.',
              ],
              ['120 plies (60 moves each) pass without a capture', 'Draw.'],
            ],
          },
          {
            kind: 'note',
            label: 'Chases and older games',
            text: 'Tournament rules also forbid chasing an unprotected piece forever. Mistboard does not judge chases, so a repeated chase is a draw. Games started before the 120-ply limit keep their 60-ply limit.',
          },
        ],
      },
      {
        heading: 'For chess players',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Stalemate loses** for the player who cannot move. It is no escape from a lost game.',
              '**Perpetual check loses** for the side giving it, where chess would call it a draw.',
              '**The generals may not face each other**, so a piece standing between them may be pinned there.',
              '**A piece between an enemy cannon and your general** is a screen: the cannon then gives check.',
              '**Horses and elephants can be blocked.** Check the leg and the eye before you plan a move.',
              '**Soldiers capture straight ahead, never diagonally, and never promote.**',
              '**There is no castling and no double first step.**',
            ],
          },
          {
            kind: 'raw-svg',
            svg: XQ_PRIMER_SOLDIER_TRIO,
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Reading xiangqi moves',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Algebraic notation is the default here outside Chinese.** Files run a to i from Red\'s left and ranks 1 to 10 from Red\'s side, so the central cannon opening is **Che3**.',
              "**WXF notation** numbers the files from each player's right. The same move is **C2.5**: the cannon on file 2 moves across to file 5.",
              '**Chinese notation** writes the WXF form in characters. The move list setting switches between all three.',
            ],
          },
        ],
      },
      {
        heading: 'A famous game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'A trap from a manual printed in 1632. Red gives up a horse; when Black takes it, Red\'s chariots and cannons pour through the gap and mate on move 13.',
          },
          {
            kind: 'embed',
            // Local study ids (scripts/variant-lab/rules-page-games/plans/xiangqi.plan.json);
            // swapped for the prod ids when the study is created there.
            path: '/embed/study/FhTsmUme/Z9O7CHU2',
            title: 'Sacrifice the Horse in 13',
            // Width-bound at the 702px column, as the jieqi rules page's embed.
            aspect: [702, 800],
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              'For a first opening: Red\'s most common is the central cannon, aimed down the centre file, and Black\'s most common answer is the screen horses, both horses guarding the centre. [Central Cannon vs Screen Horses](/study/4KXXmLaG) collects model games.',
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
                question: 'How does each piece move in xiangqi?',
                answer:
                  'The general moves one point along a line and the advisor one point diagonally, both inside the palace. The elephant moves two points diagonally and never crosses the river. The horse moves one point along a line, then one diagonally outward, and is blocked if the first point is taken. The chariot moves any distance along a line. The cannon moves like a chariot but captures by jumping exactly one piece. The soldier moves one point forward, and sideways too once it has crossed the river.',
              },
              {
                question: 'How big is a xiangqi board, and how many pieces are there?',
                answer:
                  '9 files by 10 ranks, 90 points, with pieces on the points. There are 32 pieces, 16 a side.',
              },
              {
                question: 'What can a soldier capture?',
                answer:
                  'An enemy piece on a point it could move to: straight ahead, and after the river also left and right. Never backward or diagonally.',
              },
              {
                question: 'Can the general capture a soldier?',
                answer:
                  'Yes, on an adjacent point along a line, as long as it stays in the palace and the move does not leave the generals facing each other.',
              },
              {
                question: 'What is the flying general rule?',
                answer:
                  'The two generals may never face each other on an open file. The name comes from the idea that a general could fly down the file and capture the other. Any move that would leave them facing is illegal.',
              },
              {
                question: 'Which xiangqi pieces are worth the most?',
                answer:
                  'A common rule of thumb: chariot 9, cannon 4.5, horse 4, advisor 2, elephant 2, soldier 1 before the river and 2 after.',
              },
              {
                question: 'How do you win at xiangqi?',
                answer:
                  'Checkmate the general, or leave your opponent with no legal move: stalemate is a loss for the player who cannot move.',
              },
              {
                question: 'Is perpetual check allowed in xiangqi?',
                answer:
                  'No. If the position repeats three times and one side checked on every move of the cycle, that side loses. If both did, or neither did, it is a draw.',
              },
              {
                question: 'When was xiangqi invented?',
                answer:
                  'The modern game, with the cannon on the board, took shape in China during the Song dynasty (960 to 1279). Its ancestors run several centuries earlier. Its siblings are janggi in Korea and shogi in Japan, and it shares a more distant root with chess.',
              },
              {
                question: 'What is the difference between xiangqi and chess?',
                answer:
                  'Pieces stand on the points of a 9 by 10 grid. A river splits the board and a palace confines the general and advisors. The cannon captures by jumping, the horse and elephant can be blocked, soldiers never promote, and stalemate loses.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Play it here in English with no account: find an opponent, invite a friend, or take on eight bot levels, and every finished game gets a move-by-move review. Rated games need an account.',
        playLabel: 'Find an opponent',
        playHref: '/?play=lobby&gameSpecId=xiangqi',
        secondary: [
          { label: 'Play vs computer', href: '/?play=computer&gameSpecId=xiangqi', emphasis: 'secondary' },
        ],
      }),
    ],
};
