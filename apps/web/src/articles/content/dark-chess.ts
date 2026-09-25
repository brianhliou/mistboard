import type { Square } from '@mistboard/game';
import {
  ARTICLE_OG_POSITIONS,
  CASTLE_TRIPLE_AFTER,
  CASTLE_TRIPLE_AFTER_FOG_B,
  CASTLE_TRIPLE_AFTER_FOG_W,
  CASTLE_TRIPLE_BEFORE,
  CASTLE_TRIPLE_BEFORE_FOG_B,
  CASTLE_TRIPLE_BEFORE_FOG_W,
  CASTLE_TRIPLE_FINAL,
  CASTLE_TRIPLE_FINAL_FOG_B,
  CASTLE_TRIPLE_FINAL_FOG_W,
  CASTLE_TRIPLE_PRE,
  CASTLE_TRIPLE_PRE_FOG_B,
  CASTLE_TRIPLE_PRE_FOG_W,
  CONE_BISHOP,
  CONE_BISHOP_FOG,
  CONE_KING,
  CONE_KING_FOG,
  CONE_KNIGHT,
  CONE_KNIGHT_FOG,
  CONE_PAWN,
  CONE_PAWN_FOG,
  CONE_QUEEN,
  CONE_QUEEN_FOG,
  CONE_ROOK,
  CONE_ROOK_FOG,
  DARK_CHESS_START_FOG_B,
  DARK_CHESS_START_FOG_W,
  DARK_CHESS_START_STATE,
  DISCOVERY_BEFORE,
  DISCOVERY_BEFORE_FOG_W,
  DISCOVERY_FINAL,
  DISCOVERY_FINAL_FOG_W,
  ENGINE_SAMPLE_POSITIONS,
  ENPASSANT_POSITIONS,
  PAWN_CAPTURE_EXAMPLES,
  PAWN_CAPTURE_EXAMPLES_FOG,
  WHITE_BISHOP_WIN_POSITIONS,
  playClosing,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const darkChessArticle: Article = {
    slug: 'fog-chess',
    gameSpecId: 'dark-chess',
    kind: 'rules',
    playableOnMistboard: true,
    title: 'Fog Chess Rules',
    // "Fog Chess" is our name for it; "fog of war chess" is what players search.
    // The page ranked 8th for the first and 26th for the second, so the document
    // title carries theirs while the h1 keeps ours.
    seoTitle: 'Fog of War Chess Rules',
    summary:
      'Fog Chess rules: chess under Fog of War, where each side sees only the squares its pieces reach, there are no check warnings, and the king falls by capture.',
    status: 'published',
    publishedAt: '2026-05-22',
    updatedAt: '2026-07-12',
    audience:
      'Any chess player who has heard of fog chess, dark chess, or Fog of War and wants to understand it from scratch.',
    thumbnail: ARTICLE_OG_POSITIONS['dark-chess'],
    intro: [
      {
        kind: 'paragraph',
        text:
          "[Fog Chess](https://en.wikipedia.org/wiki/Dark_chess) is Mistboard's public name for dark chess, also called Fog of War chess. Jens Bæk Nielsen and Torben Osted invented it in 1989. It is the implicit-fog version of the idea: no umpire, no scan action. Each side's visibility is derived from where its pieces can legally move.",
      },
    ],
    sections: [
      {
        heading: 'The starting position',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Each side sees the squares its own pieces could legally move to (under [regular chess rules](https://en.wikipedia.org/wiki/Rules_of_chess)), plus the squares they stand on. Everything else is fog.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'triptych',
              boards: [
                { board: DARK_CHESS_START_STATE.board, fogSquares: DARK_CHESS_START_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                { board: DARK_CHESS_START_STATE.board, orientation: 'white', label: 'SERVER TRUTH' },
                { board: DARK_CHESS_START_STATE.board, fogSquares: DARK_CHESS_START_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
              ],
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'What you see',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Here's the same rule, piece by piece.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'grid',
              boards: [
                { board: CONE_PAWN.board, fogSquares: CONE_PAWN_FOG, orientation: 'white', label: 'PAWN' },
                { board: CONE_KNIGHT.board, fogSquares: CONE_KNIGHT_FOG, orientation: 'white', label: 'KNIGHT' },
                { board: CONE_BISHOP.board, fogSquares: CONE_BISHOP_FOG, orientation: 'white', label: 'BISHOP' },
                { board: CONE_ROOK.board, fogSquares: CONE_ROOK_FOG, orientation: 'white', label: 'ROOK' },
                { board: CONE_QUEEN.board, fogSquares: CONE_QUEEN_FOG, orientation: 'white', label: 'QUEEN' },
                { board: CONE_KING.board, fogSquares: CONE_KING_FOG, orientation: 'white', label: 'KING' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Vision moves with pieces. When a piece moves, the squares it used to cover go dark (unless another piece still sees them), and the squares it now reaches light up.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                { board: DISCOVERY_BEFORE.board, fogSquares: DISCOVERY_BEFORE_FOG_W, orientation: 'white', label: 'BEFORE' },
                { board: DISCOVERY_FINAL.board, fogSquares: DISCOVERY_FINAL_FOG_W, orientation: 'white', label: 'AFTER', arrows: [{ orig: 'd3', dest: 'd7' }] },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "Notice the rook on d7 sees the queen on b7 and the king on h7, but not a7. A piece's vision ends where its movement ends.",
          },
        ],
      },
      {
        heading: 'Win condition: king capture',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "The game ends when a king is captured. No check, no checkmate, no warning.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: WHITE_BISHOP_WIN_POSITIONS,
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
              "Mistboard auto-draws games on threefold repetition (same true position three times, same side to move, same castling and en-passant rights) and the 50-move rule (fifty full moves with no pawn move or capture). Both apply to the true position, not either player's view. There is no stalemate draw and no insufficient-material draw.",
          },
        ],
      },
      {
        heading: 'Edge cases',
        blocks: [
          { kind: 'sub-heading', text: 'Castling' },
          {
            kind: 'paragraph',
            text:
              "A king may castle out of, through, or into check.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: [
                {
                  boards: [
                    { board: CASTLE_TRIPLE_PRE.board, fogSquares: CASTLE_TRIPLE_PRE_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                    { board: CASTLE_TRIPLE_PRE.board, orientation: 'white', label: 'SERVER TRUTH' },
                    { board: CASTLE_TRIPLE_PRE.board, fogSquares: CASTLE_TRIPLE_PRE_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
                  ],
                },
                {
                  boards: [
                    { board: CASTLE_TRIPLE_BEFORE.board, fogSquares: CASTLE_TRIPLE_BEFORE_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                    {
                      board: CASTLE_TRIPLE_BEFORE.board,
                      orientation: 'white',
                      label: 'SERVER TRUTH',
                      arrows: [
                        { orig: 'e4' as Square, dest: 'f6' as Square },
                        { orig: 'e8' as Square, brush: 'red' as const },
                        { orig: 'f8' as Square, brush: 'red' as const },
                        { orig: 'g8' as Square, brush: 'red' as const },
                      ],
                    },
                    { board: CASTLE_TRIPLE_BEFORE.board, fogSquares: CASTLE_TRIPLE_BEFORE_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
                  ],
                },
                {
                  boards: [
                    { board: CASTLE_TRIPLE_AFTER.board, fogSquares: CASTLE_TRIPLE_AFTER_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                    { board: CASTLE_TRIPLE_AFTER.board, orientation: 'white', label: 'SERVER TRUTH', arrows: [{ orig: 'e8' as Square, dest: 'g8' as Square }] },
                    { board: CASTLE_TRIPLE_AFTER.board, fogSquares: CASTLE_TRIPLE_AFTER_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
                  ],
                },
                {
                  boards: [
                    { board: CASTLE_TRIPLE_FINAL.board, fogSquares: CASTLE_TRIPLE_FINAL_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                    { board: CASTLE_TRIPLE_FINAL.board, orientation: 'white', label: 'SERVER TRUTH', arrows: [{ orig: 'f6' as Square, dest: 'g8' as Square }] },
                    { board: CASTLE_TRIPLE_FINAL.board, fogSquares: CASTLE_TRIPLE_FINAL_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
                  ],
                },
              ],
            },
          } as ArticleBlock,
          { kind: 'sub-heading', text: 'Pawn vision' },
          {
            kind: 'paragraph',
            text:
              "Pawns see forward push squares when those squares are empty. They see diagonal squares only when an enemy piece is actually there to capture.",
          },
          {
            kind: 'live-boards',
            spec: {
              layout: 'pair',
              boards: [
                { board: PAWN_CAPTURE_EXAMPLES.board, fogSquares: PAWN_CAPTURE_EXAMPLES_FOG, orientation: 'white', label: "WHITE'S VIEW" },
                { board: PAWN_CAPTURE_EXAMPLES.board, orientation: 'white', label: 'SERVER TRUTH' },
              ],
            },
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text:
              "White does not see a4 or b4: black pawns block those pushes, so they are not legal moves. Some rulesets reveal blocked pawn squares; Mistboard does not.",
          },
          { kind: 'sub-heading', text: 'En passant' },
          {
            kind: 'paragraph',
            text:
              "En passant is chess's strangest move, so our vision rule bends for it: the capturing pawn sees the captured pawn on its adjacent square. The window is one move only. Pass on the capture and the chance is gone.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: ENPASSANT_POSITIONS,
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'A sample game',
        blocks: [
          {
            kind: 'paragraph',
            text:
              "Here is a complete game between Mistboard's engine and a human, shown from both player views and the server's full position.",
          },
          {
            kind: 'interactive',
            widget: 'stepper',
            spec: {
              layout: 'triptych',
              positions: ENGINE_SAMPLE_POSITIONS,
            },
          } as ArticleBlock,
        ],
      },
      {
        heading: 'An engine game',
        blocks: [
          {
            kind: 'paragraph',
            text: 'Misty against itself at 30 seconds a move, shown with the whole board visible. Black wins White’s queen for a rook on move 10, but on move 27 White’s rook lands on e8 and Black’s king steps to d8 beside it. Fog chess has no check to warn it, and 28.Rxd8 captures the king.',
          },
          {
            kind: 'embed',
            path: '/embed/study/MbaW80XR/GMg6Qz89',
            title: 'Fog Chess: Misty against itself, White captures the king on move 28',
            // Width-bound at the 702px column: the 8x8 board gets the column
            // minus the move sheet, plus seat rows, controls, header and credit.
            aspect: [702, 645],
          } as ArticleBlock,
          {
            kind: 'paragraph',
            text: 'The [companion study](/study/MbaW80XR) has eleven of these games, and shows each side’s fogged view move by move.',
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
                  'No. Misty never sees the whole board. Each move it receives only what its own pieces can see, the same fog you play under, and it treats the rest as a set of boards that could all be true. The server that enforces this is open source, and tests fail the build if a hidden square ever leaks into what the engine is sent.',
              },
            ],
          },
        ],
      },
      playClosing({
        heading: 'Play on Mistboard',
        lead: 'Fog Chess is playable on Mistboard. Play against an engine or challenge a friend. No account required.',
        playLabel: 'Play vs computer',
        playHref: '/?play=computer&gameSpecId=dark-chess',
        secondary: [
          {
            label: 'Challenge a friend',
            href: '/?play=friend&gameSpecId=dark-chess',
            emphasis: 'secondary',
          },
          { label: 'Eleven engine games', href: '/study/MbaW80XR', emphasis: 'secondary' },
        ],
      }),
    ],
};
