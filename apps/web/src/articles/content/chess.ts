import type { Square } from '@mistboard/game';
import {
  BASIC_BISHOP,
  BASIC_BISHOP_TARGETS,
  BASIC_CASTLE_AFTER,
  BASIC_CASTLE_BEFORE,
  BASIC_EN_PASSANT_AFTER,
  BASIC_EN_PASSANT_BEFORE,
  BASIC_KING,
  BASIC_KING_TARGETS,
  BASIC_KNIGHT,
  BASIC_KNIGHT_TARGETS,
  BASIC_PAWN,
  BASIC_PROMOTION_AFTER,
  BASIC_PROMOTION_BEFORE,
  BASIC_QUEEN,
  BASIC_QUEEN_TARGETS,
  BASIC_ROOK,
  BASIC_ROOK_TARGETS,
  BASIC_STALEMATE,
  boardToPieces,
  DARK_CHESS_START_STATE,
  relatedClosing,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const chessArticle: Article = {
    slug: 'chess',
    kind: 'rules',
    // Hidden from the rules rail/index 2026-07-03 (project_xiangqi_pivot_track):
    // chess is deranked as Mistboard repositions around the xiangqi family. The
    // page stays reachable at /rules/chess for SEO + the Fog Chess primer link.
    showInIndex: false,
    title: 'Chess Rules',
    summary:
      'Standard chess rules, the primer behind Fog Chess: castling, promotion, en passant, the draw rules, and a famous game to play through.',
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-05-30',
    audience: 'Mistboard visitors who want the regular chess baseline before reading Fog Chess rules.',
    thumbnail: {
      pieces: boardToPieces(DARK_CHESS_START_STATE.board),
      orientation: 'white',
    },
    intro: [
      {
        kind: 'paragraph',
        text:
          'Chess is a two-player strategy game played for centuries. It descends from the Indian game chaturanga of around the 6th century and reached Europe through Persia and the Islamic world; its modern form, with the long-range queen and bishop, took shape in Europe in the late 1400s.',
      },
    ],
    sections: [
      {
        heading: 'Board setup',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Chess is played on an 8 by 8 board of alternating light and dark squares.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                { board: DARK_CHESS_START_STATE.board, orientation: 'white', label: 'STARTING POSITION' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              'White moves first, then players alternate. Each side fills the two rows nearest it, with the queen starting on her own color. On your turn, move one piece to a legal square: you cannot land on your own piece, and landing on an enemy piece captures it, removing it from the board.',
          },
        ],
      },
      {
        heading: 'The pieces',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Each piece moves in its own way. In every diagram below, the highlighted squares are the legal moves and captures for the marked white piece.',
          },
          {
            kind: 'paragraph',
            text:
              '**King:** moves one square in any direction. In regular chess, a king may not move onto a square attacked by the opponent.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                { board: BASIC_KING.board, moveDotSquares: BASIC_KING_TARGETS, orientation: 'white', label: 'KING' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Queen:** moves any number of squares horizontally, vertically, or diagonally. Other pieces block her path.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                {
                  board: BASIC_QUEEN.board,
                  moveDotSquares: BASIC_QUEEN_TARGETS,
                  orientation: 'white',
                  label: 'QUEEN',
                },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Rook:** moves any number of squares horizontally or vertically. It cannot jump, so the first occupied square in a line stops it.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                {
                  board: BASIC_ROOK.board,
                  moveDotSquares: BASIC_ROOK_TARGETS,
                  orientation: 'white',
                  label: 'ROOK',
                },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Bishop:** moves any number of squares diagonally. Because diagonals stay on one color, each bishop stays on light squares or dark squares for the whole game.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                {
                  board: BASIC_BISHOP.board,
                  moveDotSquares: BASIC_BISHOP_TARGETS,
                  orientation: 'white',
                  label: 'BISHOP',
                },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Knight:** moves in an L shape: two squares one way and one square sideways. The knight is the only piece that jumps over other pieces.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                { board: BASIC_KNIGHT.board, moveDotSquares: BASIC_KNIGHT_TARGETS, orientation: 'white', label: 'KNIGHT' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              '**Pawn:** the pawn moves and captures differently from every other piece. It moves straight forward into an empty square, one square at a time, or two squares from its starting position. It can never move backward or sideways, and a piece directly in front of it blocks it completely. It captures only diagonally forward, one square (the green rings below), never straight ahead. Two further pawn rules, promotion and en passant, appear under Special moves below.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                {
                  board: BASIC_PAWN.board,
                  moveDotSquares: ['e3' as Square, 'e4' as Square],
                  captureSquares: ['d3' as Square, 'f3' as Square],
                  orientation: 'white',
                  label: 'PAWN',
                },
              ],
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Check and checkmate',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'In regular chess, the king is protected by check and checkmate. A king is **in check** when an enemy piece attacks it. The checked player must make a legal move that leaves the king safe.',
          },
          {
            kind: 'paragraph',
            text:
              'Most checks are answered in one of three ways: move the king, block the line of attack, or capture the attacking piece. If none of those legal answers works, the game ends by **checkmate**.',
          },
          {
            kind: 'paragraph',
            text:
              'In regular chess the king is never actually captured: the game ends at checkmate, with the king still on the board.',
          },
        ],
      },
      {
        heading: 'Special moves',
        blocks: [
          { kind: 'sub-heading', text: 'Castling' },
          {
            kind: 'paragraph',
            text:
              'Castling is a one-move king-and-rook move. The king moves two squares toward a rook, and that rook moves to the square the king crossed. In regular chess, the pieces must be unmoved, the path must be empty, and the king cannot castle out of, through, or into check.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                {
                  board: BASIC_CASTLE_BEFORE,
                  orientation: 'white',
                  label: 'BEFORE',
                  arrows: [{ orig: 'e1' as Square, dest: 'g1' as Square }],
                },
                { board: BASIC_CASTLE_AFTER, orientation: 'white', label: 'AFTER' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              'Queenside castling works the same way on the other side: the king moves two squares toward the rook, and the rook lands next to it.',
          },
          { kind: 'sub-heading', text: 'Promotion' },
          {
            kind: 'paragraph',
            text:
              'When a pawn reaches the farthest rank, it promotes into a queen, rook, bishop, or knight.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                {
                  board: BASIC_PROMOTION_BEFORE,
                  highlightSquares: ['e8' as Square],
                  orientation: 'white',
                  label: 'BEFORE',
                  arrows: [{ orig: 'e7' as Square, dest: 'e8' as Square }],
                },
                { board: BASIC_PROMOTION_AFTER, orientation: 'white', label: 'AFTER' },
              ],
            },
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'En passant' },
          {
            kind: 'paragraph',
            text:
              'En passant is the unusual pawn capture. If an enemy pawn moves two squares from its starting rank and lands beside your pawn, your pawn may capture it diagonally as if it had moved only one square. This chance exists only on the very next move.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                {
                  board: BASIC_EN_PASSANT_BEFORE,
                  highlightSquares: ['d6' as Square],
                  orientation: 'white',
                  label: 'BEFORE',
                  arrows: [
                    { orig: 'd7' as Square, dest: 'd5' as Square, brush: 'yellow' as const },
                    { orig: 'e5' as Square, dest: 'd6' as Square },
                  ],
                },
                { board: BASIC_EN_PASSANT_AFTER, orientation: 'white', label: 'AFTER' },
              ],
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'Draws',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'Not every game is won. Some end in a draw, where neither side wins.',
          },
          { kind: 'sub-heading', text: 'Stalemate' },
          {
            kind: 'paragraph',
            text:
              'Stalemate is when the player to move has no legal move but their king is not in check. It is a draw, not a win, even if one side is far ahead. Below it is Black to move: the king on a8 is not in check, yet every square it could step to is covered by the white queen, and Black has nothing else to move. The game is drawn.',
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'single',
              boards: [
                {
                  board: BASIC_STALEMATE,
                  orientation: 'white',
                  label: 'STALEMATE — BLACK TO MOVE',
                },
              ],
            },
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'Other draws' },
          {
            kind: 'paragraph',
            text:
              '**Threefold repetition:** the same position, with the same player to move, occurs three times. Either player can then claim a draw.',
          },
          {
            kind: 'paragraph',
            text:
              '**Fifty-move rule:** fifty moves by each side pass with no capture and no pawn move. The clock resets whenever a pawn moves or a piece is taken.',
          },
          {
            kind: 'paragraph',
            text:
              '**Insufficient material:** neither side has enough force to deliver checkmate, such as king versus king, or king and a lone bishop or knight against a bare king.',
          },
          {
            kind: 'paragraph',
            text:
              '**Agreement:** both players simply agree to a draw.',
          },
        ],
      },
      {
        heading: 'A famous game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              'To see the pieces work together in a real game, step through Game 11 of the 2014 World Championship in Sochi. Playing White, Magnus Carlsen grinds down Viswanathan Anand in a Berlin endgame to clinch the title; Anand resigns on move 45.',
          },
          {
            kind: 'chess-replay',
            spec: {
              uci: 'e2e4 e7e5 g1f3 b8c6 f1b5 g8f6 e1g1 f6e4 d2d4 e4d6 b5c6 d7c6 d4e5 d6f5 d1d8 e8d8 h2h3 c8d7 b1c3 h7h6 b2b3 d8c8 c1b2 c6c5 a1d1 b7b6 f1e1 d7e6 c3d5 g7g5 c2c4 c8b7 g1h2 a7a5 a2a4 f5e7 g2g4 e7g6 h2g3 f8e7 f3d2 h8d8 d2e4 e7f8 e4f6 b6b5 b2c3 b5a4 b3a4 b7c6 g3f3 d8b8 f3e4 b8b4 c3b4 c5b4 f6h5 c6b7 f2f4 g5f4 h5f4 g6f4 d5f4 e6c4 d1d7 a8a6 f4d5 a6c6 d7f7 f8c5 f7c7 c6c7 d5c7 b7c6 c7b5 c4b5 a4b5 c6b5 e5e6 b4b3 e4d3 c5e7 h3h4 a5a4 g4g5 h6g5 h4g5 a4a3 d3c3',
              white: 'Magnus Carlsen',
              black: 'Viswanathan Anand',
              event: 'World Championship Game 11, Sochi 2014',
              resultText: 'Anand resigns. Carlsen (White) wins the match.',
            },
          } as ArticleBlock,
        ],
      },
      relatedClosing({
        heading: 'Where to next',
        lead: 'Chess is the open-information base game. Add Fog of War for Fog Chess, where enemy pieces outside your vision disappear and the king falls by capture.',
        links: [
          { label: 'Read Fog Chess', href: '/rules/fog-chess', emphasis: 'primary' },
          { label: 'All rules', href: '/rules', emphasis: 'secondary' },
        ],
      }),
    ],
};
