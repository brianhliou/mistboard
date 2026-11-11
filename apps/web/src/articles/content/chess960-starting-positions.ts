import { boardToPieces } from '@mistboard/board-render';
import { parseStandardChessFen } from '@mistboard/game';
import type { Article, ArticleBlock } from '../types.js';

// Moved from the brianhliou.com post of 2026-05-07
// (/posts/chess960-starting-position-evals/), text word for word as published
// there, numbers included. Boards are the post's own SVGs, served as static
// images (public/article-thumbs/chess960/); each position card's start and
// after-PV boards are joined into one image with the post's two labels. The CSV
// is served unchanged from public/article-data/. The scaling post stays on
// brianhliou.com and is linked there.

const CSV_HREF = '/article-data/chess960-starting-position-evals.csv';
const SCALING_POST = 'https://brianhliou.com/posts/scaling-stockfish-compute-workloads/';
const BOARDS = '/article-thumbs/chess960';

// SP-783, QRKNRNBB, for the card thumbnail.
const SP_783 = (() => {
  const parsed = parseStandardChessFen(
    'qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB w - - 0 1',
    'chess960-starting-positions',
  );
  if (!parsed.ok) throw new Error(`chess960-starting-positions: ${parsed.error}`);
  return parsed.state.board;
})();

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

function board(file: string, alt: string, caption: string): ArticleBlock {
  return {
    kind: 'image-figure',
    src: `${BOARDS}/${file}.svg`,
    alt,
    caption,
    className: 'article-figure-board',
  };
}

// The post's position cards: SP, back rank, the header line, the board image
// stem, and the principal variation.
type Card = [sp: string, backRank: string, line: string[], file: string, pv: string];

function cards(rows: Card[]): ArticleBlock[] {
  return rows.flatMap(([sp, backRank, line, file, pv]): ArticleBlock[] => [
    p(`**${sp}** \`${backRank}\` · ${line.join(' · ')}`),
    {
      kind: 'image-figure',
      src: `${BOARDS}/${file}-pair.svg`,
      alt: `${sp} starting position; ${sp} final position after principal variation`,
    },
    p(`Principal variation: \`${pv}\``),
  ]);
}

const WHITE_FAVORED: Card[] = [
  ['SP-783', 'QRKNRNBB', ["+1.08", "best b4", "29 plies"], 'sp-783', '1. b4 b5 2. a4 a5 3. axb5 axb4 4. Qxa8 Rxa8 5. Rxb4 g5 6. g4 Ra1+ 7. Rb1 Rxb1+ 8. Kxb1 Nb7 9. d3 h5 10. gxh5 Ne6 11. Ng3 Nd6 12. c4 Bh7 13. Ne3 Nd4 14. Kc1 f5 15. Kd2'],
  ['SP-879', 'QRKRNNBB', ["+0.92", "best b4", "41 plies"], 'sp-879', '1. b4 a5 2. a4 f5 3. Nd3 axb4 4. Ne3 d6 5. f4 c5 6. Nxf5 Be6 7. Nxe7+ Kd7 8. Nxc5+ Kxe7 9. Nxe6 Nxe6 10. Bb6 Rdc8 11. Rxb4 Qa6 12. f5 g6 13. Qa2 gxf5 14. g4 f4 15. a5 Nf6 16. Bf3 Bg7 17. c3 Ng5 18. Re1 Nd7 19. h4 Bxc3 20. dxc3 Rxc3+ 21. Kb1'],
  ['SP-604', 'RBQNKRBN', ["+0.81", "best f4", "39 plies"], 'sp-604', '1. f4 c5 2. Ng3 Ne6 3. e3 f6 4. c4 g5 5. Ne2 gxf4 6. exf4 Nd4 7. Nxd4 cxd4 8. Bxd4 Qxc4 9. Qxc4 Bxc4 10. Rf2 Ng6 11. g3 Bb5 12. Ne3 Bc6 13. Bc3 e5 14. fxe5 fxe5 15. Rxf8+ Nxf8 16. Bf5 Bc7 17. O-O-O O-O-O 18. Rf1 Re8 19. Bc2 Ne6 20. Rf7'],
  ['SP-298', 'QNRKBBRN', ["+0.73", "best c4", "28 plies"], 'sp-298', '1. c4 f5 2. d4 e6 3. e3 Bh5+ 4. f3 Bf7 5. b3 Be7 6. Bc3 Ng6 7. Nd2 a5 8. f4 O-O 9. Bd3 Ba3 10. Bb2 Bxb2 11. Qxb2 d6 12. g4 Rce8 13. O-O-O a4 14. d5 fxg4'],
  ['SP-80', 'BBNNRKRQ', ["+0.73", "best g3", "39 plies"], 'sp-080', '1. g3 c5 2. Nd3 c4 3. Nc5 Nb6 4. b3 d6 5. Ne4 Nc6 6. h4 e6 7. h5 h6 8. Qh4 d5 9. Nec3 a6 10. e4 d4 11. Ne2 g5 12. hxg6 fxg6 13. Bb2 Bd6 14. e5 Bxe5 15. c3 d3 16. Nd4 Qf6 17. Nxc6 bxc6 18. Ba3+ Kf7 19. Nb2 c5 20. Qxf6+'],
  ['SP-868', 'QBBRKRNN', ["+0.70", "best Ng3", "39 plies"], 'sp-868', '1. Ng3 d5 2. Nh5 f6 3. Nxg7+ Kf7 4. Nh5 Ng6 5. d4 Nh4 6. f3 Nxg2+ 7. Kf2 Nh4 8. c4 dxc4 9. b3 c5 10. Bxh7 cxd4 11. Qb1 d3 12. bxc4 Bd6 13. exd3 Bf5 14. Bxf5 Nxf5 15. Ng3 Nd4 16. N1e2 Bc5 17. Be3 Qc8 18. Bxd4 Bxd4+ 19. Kg2 Nh6 20. Rh1'],
  ['SP-399', 'QRNNKRBB', ["+0.70", "best b4", "34 plies"], 'sp-399', '1. b4 h6 2. f4 Bh7 3. Nc3 g5 4. f5 b6 5. Nb3 Nd6 6. Bd4 Bxd4 7. Nxd4 f6 8. d3 c6 9. a4 Qb7 10. Kd2 O-O 11. g4 Kg7 12. h4 Qc7 13. hxg5 hxg5 14. b5 Bg8 15. bxc6 dxc6 16. Ne4 Nxe4+ 17. Bxe4 Qd6'],
  ['SP-794', 'RQKNBBRN', ["+0.68", "best f4", "35 plies"], 'sp-794', '1. f4 c6 2. e3 f5 3. c4 g5 4. Qxf5 gxf4 5. Qxf4 Qxf4 6. exf4 Ne6 7. f5 Nd4 8. Ng3 Nf7 9. Bf2 Bg7 10. Nc3 Nh6 11. Bd3 Rf8 12. O-O Ndxf5 13. Nxf5 Nxf5 14. Rae1 Bg6 15. Bxf5 Rxf5 16. Rxe7 Bxc3 17. dxc3 b6 18. Ree1'],
  ['SP-557', 'RNKBNQBR', ["+0.68", "best e4", "32 plies"], 'sp-557', '1. e4 e5 2. f4 exf4 3. Nc3 f5 4. Qxf4 Be6 5. e5 g5 6. Qe3 Nc6 7. d4 d5 8. h4 h6 9. Qf3 gxh4 10. Nd3 Ng7 11. Nf4 Bg5 12. Ne2 O-O-O 13. Kb1 Bf7 14. Bf2 Ne6 15. Nxe6 Bxe6 16. Nf4 Bf7'],
  ['SP-176', 'BBNRNKRQ', ["+0.68", "best g4", "36 plies"], 'sp-176', '1. g4 c5 2. b3 Nc7 3. c4 b6 4. Be4 Bxe4 5. Qxe4 Nd6 6. Qf3 h6 7. e3 Qh7 8. Ne2 Ne6 9. Be5 O-O 10. Bxd6 Bxd6 11. h4 f5 12. g5 hxg5 13. hxg5 f4 14. e4 Qg6 15. d3 Bb8 16. d4 cxd4 17. Nxd4 Nxd4 18. Rxd4 Be5'],
];

const MOST_EQUAL: Card[] = [
  ['SP-418', 'BRNQNBKR', ["+0.07", "best b4", "32 plies"], 'sp-418', '1. b4 b5 2. e3 e6 3. Be2 Be7 4. O-O O-O 5. d3 a6 6. Qd2 d6 7. Nb3 c5 8. bxc5 dxc5 9. Nf3 Nb6 10. c4 Nd7 11. Ne5 Nef6 12. Qa5 Bd6 13. Qxd8 Rfxd8 14. Nxd7 Nxd7 15. cxb5 axb5 16. Rfc1 Rdc8'],
  ['SP-563', 'BRNKNRQB', ["+0.07", "best g4", "40 plies"], 'sp-563', '1. g4 g5 2. Ncd3 a5 3. b3 Bxa1 4. Rxa1 b6 5. h4 h6 6. Bxa8 Rxa8 7. a4 f6 8. f4 gxf4 9. Nxf4 e5 10. Nh5 Ne7 11. Qg2 c6 12. Nd3 Qe6 13. Kc1 Kc7 14. e4 Rg8 15. Nf2 d5 16. Kb2 Nd6 17. Qf3 Raf8 18. d3 d4 19. Ng3 b5 20. Nf5 bxa4'],
  ['SP-269', 'NRKBNQBR', ["+0.09", "best Nb3", "38 plies"], 'sp-269', '1. Nb3 f5 2. f4 Nb6 3. d3 c6 4. c3 d6 5. Nd2 Bc7 6. Nef3 Nf6 7. e4 fxe4 8. dxe4 e5 9. fxe5 dxe5 10. b4 Nbd7 11. Bb3 Bb6 12. Qd1 Bxg1 13. Qxg1 a5 14. Bxg8 Qxg8 15. Qa7 Qxa2 16. O-O O-O 17. bxa5 Ra8 18. Qxb7 Qxa5 19. Qb3+ Kh8'],
  ['SP-444', 'RBNNQKBR', ["+0.10", "best d4", "33 plies"], 'sp-444', '1. d4 f6 2. f3 Bf7 3. e4 c6 4. Bf2 O-O 5. a4 a5 6. O-O e5 7. dxe5 fxe5 8. Ne3 Ne7 9. Qd2 Ne6 10. Ne2 d6 11. Kh1 Nc5 12. Ng4 Ng6 13. Ng3 Bc7 14. Nf5 Rd8 15. Bxc5 dxc5 16. Qc3 c4 17. Ba2'],
  ['SP-786', 'BRQKNBRN', ["+0.10", "best c4", "31 plies"], 'sp-786', '1. c4 e6 2. f4 b5 3. c5 a5 4. b3 d6 5. Nd3 Ng6 6. e3 Be7 7. Be2 Nf6 8. cxd6 cxd6 9. Qxc8+ Rxc8 10. g3 Nd5 11. Nhf2 Bf6 12. a3 O-O 13. Bxf6 Nxf6 14. Nb2 Bd5 15. Bxb5 Bxb3+ 16. Ke2'],
  ['SP-29', 'NQNBRKBR', ["+0.11", "best c4", "31 plies"], 'sp-029', '1. c4 e5 2. f3 c6 3. b4 f6 4. Bb3 Bf7 5. Bf2 O-O 6. O-O d5 7. cxd5 cxd5 8. a4 Bb6 9. e3 Ne7 10. Nc2 Kh8 11. Qa2 a5 12. d4 Bc7 13. dxe5 Bxe5 14. Kh1 Nb6 15. Ne2 Nc4 16. bxa5'],
  ['SP-482', 'BQRNKBNR', ["+0.11", "best e3", "32 plies", "elite match"], 'sp-482', '1. e3 e6 2. b4 f5 3. f4 Nf6 4. Nf3 Be7 5. c4 b6 6. Be2 Nf7 7. Nf2 c5 8. bxc5 bxc5 9. Qc2 Rg8 10. h4 Bc6 11. Rb1 Qa8 12. Bc3 Nh5 13. d3 Ng3 14. Rh3 Nxe2 15. Kxe2 Rb8 16. Rxb8+ Qxb8'],
  ['SP-719', 'RKQNNRBB', ["+0.11", "best f4", "43 plies"], 'sp-719', '1. f4 f5 2. g3 g6 3. d3 d6 4. c4 c5 5. Nc3 Nc6 6. Qd2 Qd7 7. Nc2 Nc7 8. b3 Bf7 9. O-O-O Ne6 10. e3 O-O 11. d4 Nb4 12. Nxb4 cxb4 13. Nd5 Nc7 14. Nxc7 Qxc7 15. Qxb4 Rfb8 16. Qc3 a5 17. a4 d5 18. Kd2 dxc4 19. bxc4 Qxc4 20. Qxc4 Bxc4 21. Rfe1 Ra7 22. Rb1'],
  ['SP-85', 'NNBBRKRQ', ["+0.12", "best d3", "25 plies"], 'sp-085', '1. d3 e5 2. h4 d6 3. Nb3 h5 4. g3 Nb6 5. e4 Nc6 6. Bd2 g6 7. Bf3 Bf6 8. Nc3 Bd7 9. Bg2 O-O-O 10. a4 Be6 11. Bh3 Nd7 12. Nd5 g5 13. Nxf6'],
  ['SP-119', 'NQBRNKRB', ["+0.12", "best c4", "31 plies"], 'sp-119', '1. c4 g6 2. d4 c6 3. O-O d5 4. cxd5 cxd5 5. Nac2 Bf5 6. g3 Nac7 7. Bg2 Bg7 8. a4 Nd6 9. Qa2 O-O 10. Ne3 Be6 11. b3 b5 12. Nd3 Ne4 13. Bb2 b4 14. Qa1 Bh6 15. f4 a5 16. Nc5'],
];

export const chess960StartingPositionsArticle: Article = {
  slug: 'chess960-starting-positions',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Chess960 Starting Positions Ranked By Stockfish',
  // Homepage card only (the full title wraps at the 186px card budget).
  cardTitle: 'Chess960 Positions Ranked',
  summary:
    'Stockfish 18 rankings for all 960 Chess960/Fischer Random starting positions. Most balanced: SP-418 and SP-563; standard chess is near median.',
  showSummaryOnPage: false,
  status: 'published',
  method: [
    'All 960 starting positions searched by Stockfish 18 with `UCI_Chess960=true`, to the same target of depth 36.',
    '959 reached depth 36; one stopped at depth 35 at the time cap.',
    'Compared with the Lichess cloud-eval cache, which had all 960 positions at depths 28 to 75.',
    'Every evaluation is in the [CSV](/article-data/chess960-starting-position-evals.csv).',
  ],
  publishedAt: '2026-05-07',
  updatedAt: '2026-10-15',
  updateNote:
    "Corrected two histogram counts, SP-663's depth-36 score and the run cost against the published CSV.",
  thumbnail: {
    pieces: boardToPieces(SP_783),
    orientation: 'white',
  },
  audience:
    'Chess and Chess960 players who want to know which starting positions are balanced, which are lopsided, and where standard chess falls.',
  tldr: [
    'I evaluated all 960 Chess960 starting positions with Stockfish 18 at depth 36. Every one favors White.',
    'The most balanced are SP-418 and SP-563, at +0.07. The most lopsided is SP-783 (QRKNRNBB) at +1.08, the only one over a pawn.',
    'Standard chess, SP-518, is +0.31 and ranks 463 of 960: almost exactly the median.',
    'None of the 105 starts used in recent elite Freestyle events came from the ten most White-favored. All 960 are in a CSV.',
  ],
  intro: [
    p(
      'I evaluated all 960 **Chess960 starting positions** with Stockfish 18 at uniform depth 36. Chess960 is also called **Fischer Random chess**; each legal back rank is usually identified by a **Scharnagl ID** from 0 to 959.',
    ),
    p(
      'Chess960 is the modern tournament name for Fischer Random chess, the variant Bobby Fischer proposed in 1996 to reduce opening memorization and force players back into over-the-board problem solving. The pieces are randomized across 960 legal back-rank layouts while preserving bishops on opposite colors and keeping the king between the rooks so castling still works.',
    ),
    p('Evaluations are white-POV: positive favors White, and **+1.00 is roughly one pawn**.'),
    {
      kind: 'table',
      headers: ['Finding', 'Result'],
      rows: [
        ['Evaluation range', '+0.07 to +1.08'],
        ['Black-favored starts', '0'],
        ['Standard chess, SP-518', '+0.31'],
        ['Standard chess rank by balance', '463 / 960'],
        ['Starts more balanced than standard chess', '462'],
        ['Move-1 castling best moves', '9'],
        ['Recent elite corpus overlap with highlighted starts', 'SP-482, once'],
      ],
    },
    p(
      "If you want the **most balanced Chess960 starting positions**, the clean candidates are **SP-418, SP-563, SP-269, SP-444, and SP-786**. All evaluate at +0.10 or below, far under standard chess's +0.31.",
    ),
    p(`Full dataset: [chess960_starting_position_evals.csv](${CSV_HREF}) (960 rows).`),
  ],
  sections: [
    {
      heading: 'How I Evaluated The Chess960 Positions',
      blocks: [
        p('The evaluation contract is deliberately narrow:'),
        {
          kind: 'table',
          headers: ['Parameter', 'Value'],
          rows: [
            ['Engine', 'Stockfish 18'],
            ['Depth', '36'],
            ['MultiPV', '1'],
            ['Chess960 mode', '`UCI_Chess960=true`'],
            ['Compute', 'Modal, 96 batches × 10 positions'],
            ['Runtime', '33 minutes wall, under $3'],
          ],
        },
        p(
          `Every starting position used the same depth target, so the rankings do not mix shallow and deep engine outputs. The pipeline is the same cloud Stockfish setup described in the [previous post on scaling Stockfish compute](${SCALING_POST}).`,
        ),
        p('Quality checks:'),
        p('959/960 reached depth 36; 1 position fell back to depth 35 at the time cap.'),
        p('Median principal-variation length: 36 plies.'),
        p('Castling appears in 1,290 PV moves, all replayed legally under Chess960 rules.'),
        p(
          'I also probed the [Lichess cloud-eval API](https://lichess.org/api#tag/Analysis/operation/apiCloudEval) at `variant=chess960` for all 960 starts. Lichess had cache hits for all 960 positions, at depths 28 to 75, with median depth 33.',
        ),
        {
          kind: 'table',
          headers: ['Check against Lichess cache', 'Result'],
          rows: [
            ['Best-move agreement', '53.1%'],
            ['Evaluation correlation', '0.68'],
            ['Absolute Δcp <= 0.20', '95.5%'],
            ['Mean Δcp', '+0.05'],
          ],
        },
        p(
          'The top-10 order moves around between datasets, but the headline does not: standard chess sits near the median, every start favors White at depth 36, and 9 starts have castling as the best first move.',
        ),
      ],
    },
    {
      heading: 'Chess960 Evaluation Distribution',
      blocks: [
        p(
          'Most starts land in a narrow white-edge band. The right tail is short: only one start crosses +1.00.',
        ),
        {
          kind: 'table',
          headers: ['evaluation', 'count'],
          rows: [
            ['< 0.00 (black-favored)', '0'],
            ['0.00 to 0.09', '3'],
            ['0.10 to 0.24', '232'],
            ['0.25 to 0.49', '655'],
            ['0.50 to 0.99', '69'],
            ['>= 1.00', '1'],
          ],
        },
        {
          kind: 'image-figure',
          src: '/article-thumbs/chess960-cp-distribution.png',
          alt: 'Evaluation distribution histogram',
        },
        p(
          'At shallower public-cache depth, SP-663 can appear slightly black-favored (-0.10 in the Lichess cache). At depth 36 it evaluates at +0.14. The "black-favored start" result disappears under the uniform deeper search.',
        ),
      ],
    },
    {
      heading: 'Where Standard Chess Ranks',
      blocks: [
        p(
          'The default start, **SP-518 (RNBQKBNR)**, evaluates to **+0.31**. It ranks 463/960 by ascending imbalance: almost exactly the median. 462 Chess960 starts are more balanced; 497 are more imbalanced.',
        ),
        board(
          'sp-518',
          'SP-518, the standard chess starting position',
          'SP-518: standard chess. +0.31 at depth 36, best move d4.',
        ),
        p(
          'This is a structural result, not a claim about which starting position is better to play. Standard chess is near the middle of the Chess960 balance distribution.',
        ),
      ],
    },
    {
      heading: 'Most Imbalanced Chess960 Start: SP-783',
      blocks: [
        p(
          'One position crosses +1.00: **SP-783 (QRKNRNBB)**, at **+1.08** with best move `b4`. It is the largest opening edge in the full 960-position set.',
        ),
        board(
          'sp-783',
          'SP-783, the most imbalanced Chess960 starting position',
          'SP-783: QRKNRNBB. The most white-favored start at +1.08, best move b4.',
        ),
        p('Every other starting position lands between +0.07 and +0.92.'),
      ],
    },
    {
      heading: 'Most White-Favored Chess960 Starting Positions',
      blocks: [
        p('Only one position crosses +1.00. The rest of the top 10 sit between +0.68 and +0.92.'),
        {
          kind: 'table',
          headers: ['SP', 'back-rank', 'evaluation', 'depth', 'best'],
          rows: [
            ['783', 'QRKNRNBB', '+1.08', '36', 'b4'],
            ['879', 'QRKRNNBB', '+0.92', '36', 'b4'],
            ['604', 'RBQNKRBN', '+0.81', '36', 'f4'],
            ['298', 'QNRKBBRN', '+0.73', '36', 'c4'],
            ['80', 'BBNNRKRQ', '+0.73', '36', 'g3'],
            ['868', 'QBBRKRNN', '+0.70', '36', 'Ng3'],
            ['399', 'QRNNKRBB', '+0.70', '36', 'b4'],
            ['794', 'RQKNBBRN', '+0.68', '36', 'f4'],
            ['557', 'RNKBNQBR', '+0.68', '36', 'e4'],
            ['176', 'BBNRNKRQ', '+0.68', '36', 'g4'],
          ],
        },
        p(
          "Board previews are clickable. The green arrow marks the engine's best first move. Full principal variations are in the CSV.",
        ),
        ...cards(WHITE_FAVORED),
      ],
    },
    {
      heading: 'Most Balanced Chess960 Starting Positions',
      blocks: [
        p(
          "These are the starts where the position itself contributes the least white edge. All are +0.12 or below, far under standard chess's +0.31.",
        ),
        {
          kind: 'table',
          headers: ['SP', 'back-rank', 'evaluation', 'depth', 'best'],
          rows: [
            ['418', 'BRNQNBKR', '+0.07', '36', 'b4'],
            ['563', 'BRNKNRQB', '+0.07', '36', 'g4'],
            ['269', 'NRKBNQBR', '+0.09', '36', 'Nb3'],
            ['444', 'RBNNQKBR', '+0.10', '36', 'd4'],
            ['786', 'BRQKNBRN', '+0.10', '36', 'c4'],
            ['29', 'NQNBRKBR', '+0.11', '36', 'c4'],
            ['482', 'BQRNKBNR', '+0.11', '36', 'e3'],
            ['719', 'RKQNNRBB', '+0.11', '36', 'f4'],
            ['85', 'NNBBRKRQ', '+0.12', '36', 'd3'],
            ['119', 'NQBRNKRB', '+0.12', '36', 'c4'],
          ],
        },
        ...cards(MOST_EQUAL),
      ],
    },
    {
      heading: 'Best First Moves In Chess960',
      blocks: [
        p(
          "Across all 960 starts, **94.9%** have a pawn move as Stockfish's best first move. `e4` and `d4` are still the most common, but they cover only 36% of the field. The Chess960-specific signal is flank activity: `f4`, `b4`, and `g4` combine for 27.3%.",
        ),
        {
          kind: 'table',
          headers: ['Move', 'Count', '%'],
          rows: [
            ['e4', '187', '19.5%'],
            ['d4', '160', '16.7%'],
            ['c4', '117', '12.2%'],
            ['f4', '114', '11.9%'],
            ['b4', '81', '8.4%'],
            ['g4', '67', '7.0%'],
            ['a4', '52', '5.4%'],
          ],
        },
        { kind: 'sub-heading', text: 'Piece-move and move-1 castling details' },
        p(
          'Piece moves account for 49 positions, or 5.1% of the field. Knights account for 40 of them. The other 9 are legal move-1 castles.',
        ),
        {
          kind: 'table',
          headers: ['Move', 'Origin to dest', 'Count', '%'],
          rows: [
            ['`Ng3`', 'h1 to g3', '16', '1.7%'],
            ['`O-O`', 'f1 to g1', '9', '0.9%'],
            ['`Nc3`', 'b1 to c3', '7', '0.7%'],
            ['`Nb3`', 'a1 to b3', '7', '0.7%'],
            ['`Nf3`', 'g1 to f3', '7', '0.7%'],
            ['`Nh3`', 'g1 to h3', '1', '0.1%'],
            ['`Nde3`', 'd1 to e3', '1', '0.1%'],
            ['`Ncd3`', 'c1 to d3', '1', '0.1%'],
          ],
        },
        p(
          'The 9 move-1 castling starts all place the king on `f1` and the kingside rook on `g1`: SP-296 (+0.20), SP-308 (+0.35), SP-312 (+0.37), SP-324 (+0.22), SP-407 (+0.16), SP-580 (+0.26), SP-585 (+0.26), SP-596 (+0.22), and SP-612 (+0.40).',
        ),
      ],
    },
    {
      heading: 'What Recent Elite Chess960 Actually Picked',
      blocks: [
        p(
          'I mapped recent elite Freestyle broadcast PGNs back to Scharnagl IDs using the starting FEN. This avoids relying on the PGN `Variant` tag: some 2025 Freestyle broadcasts are labeled `Variant "Standard"` even though the FEN is a Chess960 start.',
        ),
        p('The modern elite corpus:'),
        {
          kind: 'table',
          headers: ['Event', 'Games', 'unique SPs'],
          rows: [
            ['2026 FIDE Freestyle World Championship', '57', '15'],
            ['2025 Freestyle Grand Slam Weissenhaus', '80', '22'],
            ['2025 Freestyle Grand Slam Paris', '102', '21'],
            ['2025 Freestyle Grand Slam Las Vegas', '123', '31'],
            ['2025 Freestyle Grand Slam Finals', '64', '20'],
            ['**Total**', '**426**', '**105**'],
          ],
        },
        p(
          'The most repeated starts are mostly tournament-format artifacts: paired games, rematches, and bracket mini-matches reuse the same position.',
        ),
        {
          kind: 'table',
          headers: ['SP', 'back-rank', 'eval', 'games', 'appeared in'],
          rows: [
            ['828', '`RBKNQRBN`', '+0.30', '9', 'Las Vegas, Paris, 2026 FIDE'],
            ['575', '`RNKNRQBB`', '+0.17', '8', 'Las Vegas'],
            ['685', '`QRKBNNBR`', '+0.29', '8', 'Las Vegas'],
            ['96', '`BBQNRNKR`', '+0.22', '8', 'Las Vegas'],
            ['253', '`NRKBQNBR`', '+0.31', '8', 'Las Vegas'],
            ['503', '`RQBNKNRB`', '+0.19', '8', 'Las Vegas'],
            ['524', '`RBNQKNBR`', '+0.24', '8', 'Las Vegas'],
            ['549', '`RNBBKNQR`', '+0.32', '8', 'Las Vegas'],
          ],
        },
        { kind: 'sub-heading', text: 'All selected Scharnagl IDs by event' },
        {
          kind: 'table',
          wrap: true,
          headers: ['Event', 'SPs used'],
          rows: [
            [
              '2026 FIDE Freestyle World Championship',
              '`75, 133, 184, 187, 195, 255, 277, 349, 483, 506, 545, 770, 828, 858, 889`',
            ],
            [
              '2025 Freestyle Grand Slam Weissenhaus',
              '`5, 55, 200, 270, 328, 336, 339, 360, 381, 477, 500, 588, 789, 799, 836, 866, 903, 906, 909, 931, 942, 958`',
            ],
            [
              '2025 Freestyle Grand Slam Paris',
              '`4, 33, 60, 73, 74, 103, 111, 216, 384, 454, 591, 599, 616, 636, 667, 692, 751, 826, 828, 841, 848`',
            ],
            [
              '2025 Freestyle Grand Slam Las Vegas',
              '`48, 56, 96, 101, 122, 132, 253, 262, 331, 356, 373, 383, 406, 414, 455, 482, 498, 503, 524, 542, 548, 549, 555, 575, 583, 593, 639, 685, 700, 828, 893`',
            ],
            [
              '2025 Freestyle Grand Slam Finals',
              '`1, 21, 36, 44, 146, 182, 219, 285, 305, 413, 454, 477, 478, 516, 613, 745, 767, 807, 850, 899`',
            ],
          ],
        },
        p('Overlap with the highlighted sets:'),
        {
          kind: 'table',
          headers: ['Highlight set', 'Matches in the 426-game corpus'],
          rows: [
            ['Top 10 most white-favored', 'none'],
            ['Top 10 most equal', 'SP-482, once'],
            ['Standard chess, SP-518', 'none'],
            ['2022 FIDE outlier from this post, SP-317', 'none'],
          ],
        },
        p(
          'The only highlighted start that appeared was neutral, not extreme: **SP-482 (BQRNKBNR) evaluates at +0.11** and appeared once in Las Vegas.',
        ),
        {
          kind: 'table',
          headers: ['Field', 'Value'],
          rows: [
            ['SP', '482'],
            ['back-rank', '`BQRNKBNR`'],
            ['eval', '+0.11'],
            ['game', 'Magnus Carlsen vs Levon Aronian'],
            ['result', '0-1'],
            ['round', '8.4'],
            [
              'broadcast',
              '[Las Vegas round-robin white tiebreak, game 1](https://lichess.org/broadcast/freestyle-chess-grand-slam-las-vegas--round-robin-white/tiebreak--game-1/nhVdjSZB)',
            ],
          ],
        },
        board(
          'sp-482-carlsen-aronian-critical',
          'Critical midgame position after 20...d5 in Magnus Carlsen vs Levon Aronian, SP-482',
          'Critical position after 20...d5. White to move. Lichess marks 21.c5? as the mistake; 21.cxd5 was best. Green arrow: best capture. Gray arrow: game move.',
        ),
        p(
          'The game result is not meaningful by itself. The selection result is: among 105 unique modern elite starts, none came from the top-10 white-favored list.',
        ),
        p(
          'For comparison, the 2022 FIDE World Fischer Random Championship used 11 distinct starts across 60 games. They ranged from +0.19 to +0.54, with mean +0.32. It also avoided the extreme tail.',
        ),
        p(
          'Any start in the CSV opens on a Chess960 analysis board: [SP-418](https://lichess.org/analysis/chess960/brnqnbkr/pppppppp/8/8/8/8/PPPPPPPP/BRNQNBKR_w_KQkq_-_0_1) for one of the most balanced starts, [SP-783](https://lichess.org/analysis/chess960/qrknrnbb/pppppppp/8/8/8/8/PPPPPPPP/QRKNRNBB_w_KQkq_-_0_1) for the most white-favored.',
        ),
      ],
    },
    {
      heading: 'Reproducibility',
      blocks: [
        p(
          'The 960 evaluations were computed in one Modal run, on Chess960 plumbing built for it: `UCI_Chess960` engine mode, X-FEN castling round-trips, shredder-UCI castling in PV replay, and regression coverage for Chess960 correctness.',
        ),
        p(
          "The successful production run took 33.1 minutes wall time: 96 ten-position batches, run in parallel under Modal's 100-container Starter cap. At Modal's base CPU/memory rates, that run lands under $3 of cloud spend.",
        ),
      ],
    },
    {
      heading: 'Quick Answers',
      blocks: [
        {
          kind: 'faq',
          items: [
            {
              question: 'What is the most balanced Chess960 starting position?',
              answer:
                'SP-418 (BRNQNBKR) and SP-563 (BRNKNRQB) are the most balanced in this run. Both evaluate at +0.07 for White.',
            },
            {
              question: 'What is the most imbalanced Chess960 starting position?',
              answer: 'SP-783 (QRKNRNBB) is the most white-favored start at +1.08.',
            },
            {
              question: 'Is standard chess balanced compared to Chess960?',
              answer:
                'Standard chess, SP-518 (RNBQKBNR), evaluates at +0.31 and ranks 463/960 by balance. It is almost exactly median.',
            },
            {
              question: 'Are any Chess960 starts better for Black?',
              answer: 'Not at Stockfish 18 depth 36. All 960 starts evaluate as White-favored.',
            },
          ],
        },
      ],
    },
    {
      heading: 'Further Reading',
      blocks: [
        p(
          `[Scaling Parallel Stockfish Analysis](${SCALING_POST}): methodology for running Stockfish at scale on cloud CPU workers, written for the case where the cache doesn't have the answer.`,
        ),
        p(
          '[Mistboard](/): free online Chinese chess in English, which also hosts open-source Fog of War chess. Its Chess960 pregame (Draft960) was retired in September 2026.',
        ),
      ],
    },
    {
      heading: 'Dataset',
      blocks: [
        p(
          `[Download the full CSV](${CSV_HREF}) (960 rows). Columns: \`scharnagl_id\`, \`back_rank\`, \`fen\`, \`position_key\`, \`cp\`, \`mate\`, \`best_move\`, \`pv\`, \`depth\`, \`nodes\`, \`source\`, \`fetched_at_iso\`.`,
        ),
      ],
    },
  ],
};
