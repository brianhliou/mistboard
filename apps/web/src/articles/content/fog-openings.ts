import { darkChessVariant, type Square } from '@mistboard/game';
import { ARTICLE_OG_POSITIONS, fogFor, replayMoves } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The position after 1.c4 d5 2.Qa4 e5, taken from a real game (chess.com
// #104462605). White is on move and the a4-e8 diagonal is clear, so the queen
// can see the black king. Built through the kernel rather than hand-placed so
// the diagram cannot drift from the rules.
const RAID_LINE = replayMoves(darkChessVariant.createInitialState('fog-openings-raid'), [
  { from: 'c2' as Square, to: 'c4' as Square },
  { from: 'd7' as Square, to: 'd5' as Square },
  { from: 'd1' as Square, to: 'a4' as Square },
  { from: 'e7' as Square, to: 'e5' as Square },
  { from: 'a4' as Square, to: 'e8' as Square },
]);
const BEFORE_RAID = RAID_LINE[4]!;
const AFTER_RAID = RAID_LINE[5]!;

// Same opening, but Black covers the diagonal's midpoint. The queen's sight
// stops at c6 and the king is hidden again.
const BLOCKED = replayMoves(darkChessVariant.createInitialState('fog-openings-blocked'), [
  { from: 'c2' as Square, to: 'c4' as Square },
  { from: 'd7' as Square, to: 'd5' as Square },
  { from: 'd1' as Square, to: 'a4' as Square },
  { from: 'b8' as Square, to: 'c6' as Square },
])[4]!;

// 1.c4 c5 2.Qa4: the reply that holds. Black's knight is about to reach c6 and
// the queen never sees anything. Shown as White saw it, which is the point:
// from White's side the two positions are almost the same picture.
const HELD = replayMoves(darkChessVariant.createInitialState('fog-openings-held'), [
  { from: 'c2' as Square, to: 'c4' as Square },
  { from: 'c7' as Square, to: 'c5' as Square },
  { from: 'd1' as Square, to: 'a4' as Square },
  { from: 'b8' as Square, to: 'c6' as Square },
])[4]!;

// The setup itself, replayed from chess.com #106124673 (a win over a 2012):
// 1.c4 c5 2.Nc3 Nc6 3.e4 Nf6 4.d3 g6 5.Be3 Bg7 6.g3 O-O 7.Bg2 Ne8 8.Nge2 Nc7
// 9.O-O. Taken from a real game so the diagram cannot drift into a shape the
// corpus never actually produced.
const SETUP = replayMoves(darkChessVariant.createInitialState('fog-openings-setup'), [
  ['c2', 'c4'], ['c7', 'c5'], ['b1', 'c3'], ['b8', 'c6'], ['e2', 'e4'], ['g8', 'f6'],
  ['d2', 'd3'], ['g7', 'g6'], ['c1', 'e3'], ['f8', 'g7'], ['g2', 'g3'], ['e8', 'h8'],
  ['f1', 'g2'], ['f6', 'e8'], ['g1', 'e2'], ['e8', 'c7'], ['e1', 'h1'],
].map(([from, to]) => ({ from: from as Square, to: to as Square })))[17]!;

export const fogOpeningsArticle: Article = {
  slug: 'fog-openings',
  kind: 'article',
  publisher: 'mistboard',
  title: 'An Opening System for Fog Chess',
  // "Fog Chess" is our name; "fog of war chess" is what players search.
  seoTitle: 'Fog of War Chess Openings: The Qa4 System',
  summary:
    'A complete Fog of War chess opening system built on 1.c4 and 2.Qa4, measured across 899 games. The queen doubles as a sensor and sometimes captures the king on move three. Which Black replies hold, which collapse, and where the system stops working.',
  status: 'draft',
  publishedAt: '2026-08-16',
  audience:
    'Fog of War players who want opening theory, and anyone who has lost a game on move three without understanding why.',
  thumbnail: ARTICLE_OG_POSITIONS['dark-chess'],
  intro: [
    {
      kind: 'paragraph',
      text:
        'Fog of War chess has no opening theory. There are no books, no databases, and no repertoires, so most players import their normal-chess opening and find out later that it was answering a question the game does not ask.',
    },
    {
      kind: 'paragraph',
      text:
        'This is the system I have played for about a thousand games as White. It is a shape rather than a move order: a setup that takes hard control of one square, and a queen sortie on the way there that doubles as a sensor and, roughly one game in twelve, captures the king on move three.',
    },
    {
      kind: 'paragraph',
      text:
        'The numbers come from 1,949 of my own games, 899 of them opening 1.c4 and 590 with the system fully on the board, so the claims below are measured rather than remembered. One caveat colours all of them: these are one player’s games, a record of what worked against the people I played, not opening theory in the sense chess has opening theory.',
    },
  ],
  sections: [
    {
      heading: 'What an opening has to do in fog',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'In normal chess an opening develops pieces, takes the centre, and gets the king safe. All three assume you can see the position. In fog you cannot, and there is no check, so the game ends when somebody captures a king that never got warned.',
        },
        {
          kind: 'paragraph',
          text:
            'That changes what a good move is. You see your own pieces and every square they can legally move to, which means each piece is a sensor pointed in the direction it moves, and moving a piece is also choosing what you get to watch. An opening in fog is a scanning pattern first and a development scheme second.',
        },
        {
          kind: 'paragraph',
          text:
            'A queen is the widest sensor on the board. That is the whole idea behind this system: put the queen somewhere it sweeps a long diagonal across the opponent’s position, early, and read what comes back.',
        },
      ],
    },
    {
      heading: 'The system is a shape, not a move order',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'What I am actually playing is a setup. The pawns go to c4, e4 and d3, the knight comes to c3 and its partner to e2, the dark bishop goes to e3, and the light one fianchettoes with g3 and Bg2. The king castles on either side, or stays home, depending on what the fog has told me by then.',
        },
        {
          kind: 'live-boards',
          spec: {
            layout: 'pair',
            boards: [
              {
                board: SETUP.board,
                orientation: 'white',
                label: 'THE SETUP',
                highlightSquares: ['d5' as Square],
              },
              {
                board: SETUP.board,
                fogSquares: fogFor(SETUP, 'white'),
                orientation: 'white',
                label: 'WHAT I CAN SEE FROM IT',
              },
            ],
          },
          caption:
            'From a real game, after nine moves. Every white piece except the rooks bears on d5 or supports something that does.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'The point of the whole arrangement is d5. The c4 pawn hits it, the e4 pawn hits it, the knight on c3 hits it, the bishop on g2 looks straight down the diagonal at it, and a knight arriving on e3 would hit it again. Nothing about the plan depends on seeing what Black is doing.',
        },
        {
          kind: 'paragraph',
          text:
            'That is what makes it a fog opening rather than a chess opening. You cannot react to your opponent, so you build something whose value does not depend on their reply, and you point it at the square they have to come through.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['at White’s move 12, across 738 games', 'value'],
          rows: [
            ['games with two or more White pieces hitting d5', '76%'],
            ['average White attackers on d5', '2.23'],
            ['average Black attackers on d5', '1.66'],
            ['doing most of the work', 'Nc3 77%, c4 61%, e4 61%'],
          ],
          highlightRows: [0],
        },
        {
          kind: 'paragraph',
          text:
            'The square is held more reliably than any particular move order reaches it. The four-piece core of c4, e4, d3 and Nc3 turns up in 42% of these games, and the complete setup with the bishops and the second knight in only 8%. The control is the constant; the route varies with what the fog allows.',
        },
      ],
    },
    {
      heading: 'Qa4 is one way in',
      blocks: [
        { kind: 'code', text: '1. c4    (anything)\n2. Qa4   (anything)\n3. Qxe8  (when the king is there)' },
        {
          kind: 'paragraph',
          text:
            'c4 is the first move of the setup and it also opens the d1-a4 diagonal, so the queen can step out to a4 before the rest of the pieces come. From a4 it looks down the a4-b5-c6-d7-e8 diagonal, which ends on the black king’s starting square, and it covers the a-file and the fourth rank on the way.',
        },
        {
          kind: 'paragraph',
          text:
            'This is a detour rather than a separate opening. The queen asks one question, comes back to c2 or d1, and the setup carries on from where it was. Most of the time the diagonal is blocked and the answer is small. Some of the time it runs all the way to e8, and then it is not a threat at all: the king is already visible, and the capture is just collecting it.',
        },
        {
          kind: 'live-boards',
          spec: {
            layout: 'pair',
            boards: [
              {
                board: BEFORE_RAID.board,
                orientation: 'white',
                label: "WHAT'S ON THE BOARD",
                arrows: [{ orig: 'a4', dest: 'e8' }],
              },
              {
                board: BEFORE_RAID.board,
                fogSquares: fogFor(BEFORE_RAID, 'black'),
                orientation: 'black',
                label: 'WHAT BLACK CAN SEE',
              },
            ],
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'Same position, same moment. Under normal rules this is nonsense, because Black watches the queen arrive on a4, sees the diagonal pointing at the king, and steps out of it. Black has a legal move here that stops it and no reason on earth to play it.',
        },
      ],
    },
    {
      heading: 'The three-move kill',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Across 590 games with an early Qa4, the queen could see the black king on e8 fifty-one times, and took it in all fifty-one. Forty-nine of those games ended right there, on White’s third move.',
        },
        {
          kind: 'live-boards',
          spec: {
            layout: 'pair',
            boards: [
              {
                board: AFTER_RAID.board,
                orientation: 'white',
                label: 'MOVE THREE',
                highlightSquares: ['e8' as Square],
              },
              {
                board: BLOCKED.board,
                orientation: 'white',
                label: 'ONE PIECE ON c6, AND NOTHING HAPPENS',
              },
            ],
          },
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'There is no judgement in the move. Either a black king is standing on a square White can move to or it is not, and the board answers that question before White decides anything. That is why the conversion rate is 51 out of 51 rather than something human-shaped.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 d7d5 d1a4 g8f6 a4e8',
            white: 'bhliou (1931)',
            black: 'gforce9 (1879)',
            event: 'chess.com Fog of War, 1+0, July 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'White wins by king capture, move 3.',
            notes: {
              1: 'clears the c2 square the queen needs.',
              2: 'vacates d7, which is half of what the trap needs.',
              3: 'and the diagonal is already open to e8. The king is visible from here on.',
              4: 'develops, and does nothing about a diagonal Black cannot see.',
              5: 'The king was visible a move ago, so this is collection rather than a gamble.',
            },
          },
          caption:
            'The whole game, as White saw it. Step through it: the fog never lifts, and the king is simply there on move three.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'The highest-rated player it ever caught was 1879, when I was 1931. Median victim rating is 1500, and not one was above 2000. It is a real weapon and it is a weapon against people who are still learning the variant.',
        },
      ],
    },
    {
      heading: 'What has to be true',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Three squares: b5, c6 and d7. All three must be empty on White’s third move.',
        },
        {
          kind: 'paragraph',
          text:
            'b5 and c6 start empty, so Black has to actively cover them. d7 starts with a pawn on it, so Black has to actively vacate it. Both conditions have to hold at once, inside two moves, which is why the trap can look inevitable and stay rare at the same time.',
        },
        {
          kind: 'paragraph',
          text:
            'It fired in about 9% of the games where I played it. In that 9% it was a certainty rather than a chance, and in the other 91% the queen was still on a good square doing its other job.',
        },
      ],
    },
    {
      heading: 'Why c4 and not c3',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Qd1-a4 runs the d1-c2-b3-a4 diagonal, so the c2 pawn has to move before the queen can come out at all. Both c4 and c3 do that, and they are not otherwise the same move.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['first move', 'games', 'White scores'],
          rows: [
            ['1. c4', '899', '75.8%'],
            ['1. c3', '9', '55.6%'],
          ],
          caption: 'Nine games is nothing, so read c3 as untested rather than worse.',
        },
        {
          kind: 'paragraph',
          text:
            'c3 should serve the trap identically. What it does not do is buy vision of c5, and c5 is the square this opening most wants to watch, because it is where Black contests the centre and where a bishop lands when it comes hunting f2.',
        },
        {
          kind: 'paragraph',
          text:
            'That vision arrives in an odd form. A pawn on c4 can advance to c5, so c5 is a square White can see. A pawn cannot advance onto an occupied square, so the moment a black piece lands on c5, that square stops being a legal destination and drops out of White’s vision entirely.',
        },
        {
          kind: 'paragraph',
          text:
            'You never see the bishop arrive. You see c5 go dark. A square you had been watching all game quietly stops reporting, nothing appears on your screen, and the thing that left is the thing telling you.',
        },
      ],
    },
    {
      heading: 'Black’s replies, ranked',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Splitting all 899 games by Black’s first move, and showing what happened in the subset where I went ahead with the system:',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['Black’s first move', 'games', 'White scores', 'with Qa4', 'kings taken'],
          rows: [
            ['1… c5', '195', '58.7%', '55.9%', '0'],
            ['1… c6', '63', '76.2%', '73.8%', '0'],
            ['1… Nc6', '48', '75.0%', '76.7%', '0'],
            ['1… e6', '146', '75.3%', '79.6%', '5'],
            ['1… d6', '47', '79.8%', '82.8%', '3'],
            ['1… Nf6', '93', '82.3%', '81.5%', '1'],
            ['1… b6', '25', '84.0%', '86.4%', '0'],
            ['1… g6', '38', '88.2%', '94.4%', '0'],
            ['1… e5', '101', '92.1%', '94.4%', '10'],
            ['1… d5', '100', '81.0%', '91.7%', '28'],
          ],
          highlightRows: [0, 9],
          caption:
            'Sorted by how well Black did. The two highlighted rows are the two ends of the system: the reply that holds, and the reply that hands over the king.',
        },
        {
          kind: 'paragraph',
          text:
            'One reply is separated from the rest of the board by fifteen points. Everything except 1…c5 scores between 73% and 94% for White. 1…c5 scores 58.7%, and 55.9% in the games where I went ahead and played Qa4 anyway.',
        },
      ],
    },
    {
      heading: '1…c5, the only reply that holds',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'c5 does two things at once and Black almost never plays it for the second reason. It takes the centre square, and it opens the c7-b8 line so a knight can come to c6, which is the midpoint of the diagonal the queen wants.',
        },
        {
          kind: 'live-boards',
          spec: {
            layout: 'single',
            boards: [
              {
                board: HELD.board,
                fogSquares: fogFor(HELD, 'white'),
                orientation: 'white',
                label: "WHITE'S VIEW AFTER 1.c4 c5 2.Qa4 Nc6",
              },
            ],
          },
          caption:
            'The queen’s sight down the diagonal stops at c6. From White’s side this looks almost exactly like the position where the king is visible, which is the honest difficulty of the variant.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'It is also where the strong players are, so this branch is simultaneously the hardest and the most rewarding one. Nineteen of my wins over a higher-rated opponent came out of it, more than every other branch combined.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 c7c5 d1a4 b8c6 g1f3 g8f6 b1c3 d7d6 d2d3 f6d7 a4c2 d7b6 c1g5 f7f6 g5h4 c8e6 h4g3 e6f7 e2e3 f7g6 h2h3 d8d7 f1e2 e8a8 e1h1 c8b8 a1d1 e7e5 e3e4 c6d4 f3d4 e5d4 c3d5 b6d5 e4d5 h7h6 e2f3 g6h7 c2d2 g7g5 f1e1 f8g7 e1e2 h8e8 e2e8 d8e8 a2a3 e8f8 b2b4 f8c8 b4c5 d6c5 g3b8',
            white: 'bhliou (1500)',
            black: 'Ukitza (1913)',
            event: 'chess.com Fog of War, 3+2, June 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'White wins by king capture on b8.',
            notes: {
              2: 'the reply that holds.',
              4: 'lands on the diagonal’s midpoint. The trap is dead from here on.',
              11: 'the queen has read the position and comes back to a normal square.',
              24: 'Black castles queenside, so the king is somewhere on the c-file.',
              26: 'the king walks to b8, onto the h2-b8 diagonal.',
              53: 'The bishop reached this diagonal on move 9 and never left it.',
            },
          },
          caption:
            'Rated 1500 against 1913. The queen finds nothing, retreats on move six, and the game is decided 47 moves later by a bishop that had been aimed at the right diagonal the whole time.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'That is the pattern worth taking from the c5 branch. Qa4 is a question, and against c5 the answer comes back negative. The system’s value is that the question is cheap: the queen returns to c2 or d1, nothing has been lost, and the rest of the game is played on normal chess terms with one extra piece of information.',
        },
      ],
    },
    {
      heading: '1…d5, where the kills live and the wins do not',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'd5 is the most principled reply Black has and it walks into the worst version of this. It vacates d7 immediately, which is the condition Black has to work to meet, and the follow-up …dxc4 vacates it while also opening the b5 and c6 squares.',
        },
        {
          kind: 'paragraph',
          text:
            '48 games, 91.7% for White, and 28 of them ended with the queen taking the king. That is the single most lopsided line in the corpus.',
        },
        {
          kind: 'paragraph',
          text:
            'It is also the branch I have zero wins over a higher-rated opponent in. Zero, out of 48 games. Strong players do not push the d-pawn on move one against a c4 they cannot read, so the line that produces the most spectacular results is the line that never gets tested.',
        },
        {
          kind: 'paragraph',
          text:
            'Both of those facts are about the same thing. The three-move kill is real and it is a measurement of the people it caught.',
        },
      ],
    },
    {
      heading: 'The e-pawn replies and the f2 scare',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Against 1…e5 and 1…e6 the thing to be afraid of is f2. It is the square defended only by the king, and Black’s bishop coming to c5 and queen coming to f6 both point at it. In fog you will not see either of them arrive.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['in the 1…e5 and 1…e6 games', 'games', 'White scores'],
          rows: [
            ['all of them', '247', '82.2%'],
            ['Black played …Bc5 by move 6', '41', '95.1%'],
            ['something actually captured on f2', '22', '79.5%'],
          ],
          highlightRows: [1],
          caption: '…Bc5 is one of the worst moves anyone played against me in the whole corpus.',
        },
        {
          kind: 'paragraph',
          text:
            'The fear is misplaced. Even when a piece does take on f2 I win four games in five, and the games where Black sets it up with …Bc5 are my best results in the entire corpus at 95.1%.',
        },
        {
          kind: 'paragraph',
          text:
            'Taking f2 costs more in fog than it does in normal chess. The piece that grabs it has spent two moves getting deep into a position it cannot see, it has won a pawn rather than learned anything, and the queenside is still live and still invisible. Meanwhile c5 going dark told me the bishop was coming.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 e7e6 d1a4 f8d6 g1f3 b8c6 d2d4 b7b6 d4d5 e6d5 c4d5 c6e7 b1c3 c8b7 e2e4 f7f5 f1d3 f5e4 d3e4 g8f6 e1h1 e8h8 f1e1 e7d5 e4d5 f6d5 a4b3 d5c3 b3g8',
            white: 'bhliou (1826)',
            black: 'NonameFr07 (1976)',
            event: 'chess.com Fog of War, 3+2, June 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'White wins by king capture on g8.',
            notes: {
              3: 'as always. Black’s bishop goes to d6 rather than c5.',
              12: 'the knight retreats and the centre opens up.',
              27: 'the queen comes back to a long diagonal, this one aimed at g8.',
              29: 'Black castled on move 11, so the king was sitting on a square the queen could reach.',
            },
          },
          caption:
            'A win against a 1976 in 15 moves. The queen leaves a4, comes back to b3, and the second diagonal does what the first one could not.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'The 1…e5 version of the same story, against the highest-rated opponent I have beaten with this system. Black’s dark bishop does go hunting, by the h6 route rather than c5, and it ends up trading itself off on e3 so my f-pawn recaptures toward the centre. The f2 square is never the problem.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 e7e5 d1a4 d8e7 e2e4 a7a5 b1c3 c7c6 g1f3 d7d6 a4d1 c8e6 f1d3 b8a6 d3c2 b7b6 e1h1 a6c5 d2d3 g7g6 c1e3 h7h5 a2a3 f8h6 d1e1 h6e3 f2e3 g8h6 c3a2 f7f5 e4f5 h6f5 b2b4 a5b4 a3b4 c5d7 g1h1 a8c8 a2c3 e8h8 b4b5 c6b5 c3b5 d7c5 f3d2 e6d7 d3d4 e5d4 e3d4 e7e1 a1e1 c5b7 c2f5 d7f5 d2f3 b7d8 e1d1 d8f7 f1e1 g8g7 d1c1 f7h6 d4d5 h6g8 f3d4 g8f6 e1f1 c8e8 d4f5 g6f5 c1d1 g7g6 b5d4 e8e7 d4f5 g6f5 f1f5',
            white: 'bhliou (2040)',
            black: 'RansonKFern (2115)',
            event: 'chess.com Fog of War, 3+0, July 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'White wins by king capture on f5.',
            notes: {
              3: 'again. Black’s queen steps to e7, and the diagonal never opens.',
              11: 'six moves out, nothing found, and the setup takes over.',
              26: 'the bishop that came to hunt trades itself off instead.',
              27: 'the f2 pawn recaptures toward the centre, which is the opposite of the disaster f2 is supposed to be.',
              76: 'the king takes the knight. Legal, winning, and fatal.',
              77: 'Rxf5. The rook had been on the f-file since move 19 and Black could not see it.',
            },
          },
          caption:
            'A win over a 2115, the strongest player this system has beaten. The last two moves are the variant in miniature: the king captures a knight it can take, and a rook it never saw takes it back.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The quiet replies',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Everything else on the table behaves the same way. 1…Nf6, 1…g6, 1…b6 and 1…d6 all develop sensibly, none of them address the diagonal, and none of them need to, because the d7 pawn is doing that job by sitting still.',
        },
        {
          kind: 'paragraph',
          text:
            'Against these the system is not a trap at all. It is an early scan followed by an ordinary game, and the scan is free.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 g8f6 d1a4 g7g6 b1c3 f8g7 e2e4 e8h8 d2d3 d7d6 c1e3 b8d7 a4d1 a7a6 g1f3 a8b8 f1e2 b7b6 e1h1 c8b7 d3d4 c7c5 d4d5 d8c7 d1d2 f8c8 e2d3 c7d8 f1e1 d8f8 e3f4 h7h6 f4g3 g8h7 e4e5 f6e8 e5d6 e8d6 a2a4 f8h8 a4a5 b6a5 c3e4 d6e4 e1e4 b8a8 a1e1 d7f8 d2e2 e7e6 d5e6 b7e4 e6f7 e4d3 e2d3 g7b2 h2h4 b2g7 f3e5 g7e5 g3e5 h8g8 f7g8q h7g8 g2g3 g8h7 g1h2 a8b8 e5b8 c8b8 e1e7 b8b7 e7h7',
            white: 'bhliou (1797)',
            black: 'igorchessa (1905)',
            event: 'chess.com Fog of War, 3+2, June 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'White wins by king capture on h7.',
            notes: {
              3: 'and it finds nothing. The d7 pawn has not moved, so the diagonal was never open.',
              13: 'five moves after coming out, the queen is home and this is normal chess with fog.',
              63: 'the pawn promotes on g8 and the black king takes it back.',
              73: 'The rook arrives on the square the king ran to.',
            },
          },
          caption:
            'The ordinary case. The queen asks, gets nothing, goes home on move seven, and the win comes 30 moves later from an endgame.',
        } as ArticleBlock,
      ],
    },
    {
      heading: 'The queen does not need rescuing',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'An early queen sortie should get harassed. That is the first thing anybody says about Qa4, and I expected the corpus to show a price for it.',
        },
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['what happened to the queen on a4', 'games'],
          rows: [
            ['captured on a4', '3'],
            ['moved away under its own power', '581'],
            ['still sitting there when the game ended', '6'],
          ],
          highlightRows: [0],
          caption: 'Out of 590 games with an early Qa4.',
        },
        {
          kind: 'paragraph',
          text:
            'Three times in 590 games, or half a percent. A piece deep in enemy territory is not the liability in fog that it is in normal chess, because the opponent has to find it before they can attack it, and looking for it costs them the moves they wanted to spend developing.',
        },
        {
          kind: 'paragraph',
          text:
            'The queen on a4 is doing what any invisible piece does. It forces Black to defend against something they cannot confirm exists, and most of them do not bother, which is the same reason the trap works.',
        },
      ],
    },
    {
      heading: 'Where it stops working',
      blocks: [
        {
          kind: 'table',
          compact: true,
          wrap: true,
          headers: ['opponent rating', 'games', 'White scores'],
          rows: [
            ['under 1500', '66', '90.9%'],
            ['1500-1799', '275', '87.8%'],
            ['1800-2099', '223', '69.1%'],
            ['2100+', '26', '36.5%'],
          ],
          caption: 'Games where I played an early Qa4, split by opponent rating.',
        },
        {
          kind: 'paragraph',
          text:
            'Read that table carefully, because it is not as clean as it looks. The bands are opponent rating, and my own rating moved from 1500 to 2140 across these games, so the bottom row partly measures strong players beating a weaker version of me.',
        },
        {
          kind: 'paragraph',
          text:
            'What survives the objection is the shape. Strong players do not push the d-pawn early, they cover c6 without being asked, and they answer 1.c4 with 1…c5. The trap is the first thing they stop falling for, and after that the system is worth exactly what the scan is worth.',
        },
        {
          kind: 'paragraph',
          text:
            'The clearest illustration I have is two games ninety minutes apart against the same opponent. The first is the three-move kill above. This is the rematch.',
        },
        {
          kind: 'chess-replay',
          spec: {
            uci: 'c2c4 c7c5 d1a4 d8c7 e2e4 e7e6 b1c3 b7b6 d2d3 c8b7 g2g3 a7a6 f1g2 f7f6 f2f4 h7h5 c1e3 h5h4 g1f3 h4g3 h2g3 h8h1 g2h1 g7g5 e1a1 b8c6 h1g2 c6d4 a2a3 b6b5 c4b5 a6b5 a4b4 c5c4 b4f8 e8f8 e3d4 c4d3 d1d3 b5b4 a3b4 g5f4 g3f4 g8e7 c3b1 c7c1',
            white: 'bhliou (1929)',
            black: 'gforce9 (1881)',
            event: 'chess.com Fog of War, 1+0, July 2026',
            perspective: 'white',
            fog: 'white',
            resultText: 'Black wins by king capture on c1.',
            notes: {
              2: 'c5 this time, ninety minutes after losing a king on move three.',
              3: 'played anyway. It finds nothing, which is the correct outcome against c5.',
              25: 'White castles queenside, which puts the king on c1.',
              46: 'Black’s queen had been on the c-file since move 2.',
            },
          },
          caption:
            'The same opponent, the same day. He played c5, the queen found nothing, and his queen took my king on the square I castled to.',
        } as ArticleBlock,
        {
          kind: 'paragraph',
          text:
            'One game is the system at its most dramatic and the other is the system being answered by a single sound move. Both are worth about the same amount as evidence.',
        },
      ],
    },
    {
      heading: 'If you are on the other side of this',
      blocks: [
        {
          kind: 'paragraph',
          text:
            'Leave the d-pawn alone for two moves. That is most of the defence, because it is the pawn on d7 rather than any choice you make that keeps the diagonal shut.',
        },
        {
          kind: 'paragraph',
          text:
            'If you do move it, put something on c6 or d7 immediately, and know that …dxc4 is the worst move on the board here. It vacates d7 and clears b5 and c6 in one go, it looks like free material, and the queen that punishes it is invisible.',
        },
        {
          kind: 'paragraph',
          text:
            'The general version is worth more than the specific one. Against 1.c4 the c-pawn has moved, so the d1-a4 diagonal is open and the queen can be on a4 whether or not you can see it. Openings in fog are about which of your opponent’s pieces have been given a road, and you can work that out from their pawn moves alone.',
        },
        {
          kind: 'cta',
          buttons: [
            {
              label: 'Play Fog Chess',
              href: '/?play=computer&gameSpecId=dark-chess',
              emphasis: 'primary',
            },
            { label: 'Fog Chess rules', href: '/rules/fog-chess', emphasis: 'secondary' },
          ],
        } as ArticleBlock,
      ],
    },
  ],
};
