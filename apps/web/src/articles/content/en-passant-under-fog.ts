import { boardToPieces } from '@mistboard/board-render';
import { parseDarkChessFen } from '@mistboard/game';
import { fogFor } from '../diagrams.js';
import type { Article } from '../types.js';

// Moved from the brianhliou.com post of 2026-09-12 (/posts/en-passant-under-fog/)
// and recut as a bug story (2026-10-15): the edge case, the bug, the game it
// hit, the fix. Facts follow mistboard-engine 129c2b4 (the fix), issue #21 and
// 8f85306 (Misty 0.1.3). The three board figures are the post's own SVGs, drawn
// by Misty's visibility code, served as static images
// (public/article-thumbs/en-passant-under-fog/) so the closing note about how
// they were drawn stays true. Only the card thumbnail is a live board.

const NEEDED_FEN = '5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ g3 0 29';
const parsed = parseDarkChessFen(NEEDED_FEN, 'en-passant-under-fog');
if (!parsed.ok) throw new Error(`en-passant-under-fog: ${parsed.error}`);
const WITH_EP = parsed.state;

const FIGURES = '/article-thumbs/en-passant-under-fog';

export const enPassantUnderFogArticle: Article = {
  slug: 'en-passant-under-fog',
  kind: 'article',
  publisher: 'mistboard',
  title: 'An En Passant Bug Under Fog',
  // Homepage card only (the full title wraps at the 186px card budget).
  cardTitle: 'En Passant Under Fog',
  summary:
    "My fog of war chess engine recorded the en passant square under standard chess legality, in a variant with no such rule. En passant availability decides what a pawn can see, so the true board fell out of the engine's belief and it finished the game against 41 worlds that did not exist.",
  showSummaryOnPage: false,
  status: 'draft',
  publishedAt: '2026-09-12',
  updatedAt: '2026-10-15',
  thumbnail: {
    pieces: boardToPieces(WITH_EP.board),
    fogSquares: fogFor(WITH_EP, 'black'),
    orientation: 'black',
  },
  audience:
    'Fog of war chess players and engine builders curious how a hidden-information engine can lose track of the real board.',
  readNext: ['misty', 'mistybanqi'],
  tldr: [
    'Misty tracks every board consistent with what it has seen, stored as FEN strings. In one game it finished against 41 boards, none of them the real one.',
    'python-chess writes the en passant square only when the capture is legal in standard chess. Under fog the capture is legal even in check, and a pawn that can take en passant sees that square, so the true position stopped matching what Misty had seen.',
    'The fix records the square whenever a pawn can take. Replaying all 271 games, lost-truth cases outside the sampled games went from four to none.',
    'Nothing caught it: the Rust port copied python-chess byte for byte, so the test comparing the two passed, and a belief that loses the truth gets more confident, not less.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: 'In [fog of war chess](/rules/fog-chess) you may leave your king attacked, so a pawn can take en passant in positions where standard chess forbids it. And since you see every square your pieces can move to, whether that capture exists changes what you see: a pawn that can take en passant sees the landing square and the pawn it would take.',
    },
    {
      kind: 'paragraph',
      text: '[Misty](/blog/misty) plays fog of war chess by holding `P`, the set of every board consistent with what it has observed, stored as FEN strings. It wrote the en passant field of those strings by the standard chess rule, and in one game that dropped the real board out of `P`.',
    },
  ],
  sections: [
    {
      heading: 'Misty recorded the en passant square by standard chess rules',
      blocks: [
        {
          kind: 'paragraph',
          text: "`python-chess` writes the en passant field with `EnPassantMode.LEGAL` by default: it records the square only when the capture is legal in standard chess, and that includes not leaving the capturing side's king in check. Misty's Rust hot path copied the same filter on purpose, so its strings would match python-chess byte for byte.",
        },
        {
          kind: 'paragraph',
          text: "So the square went missing in one kind of position: a pawn has just moved two squares to stand beside an enemy pawn, and taking it en passant would leave the capturer's king attacked, as it does when that king is already in check. With the square gone, the rebuilt position no longer sees the landing square or the pawn it could take, so the real board stops matching what Misty observed and drops out of `P`. The trigger came up 1 ply in 12,866, in 1 of 273 finished games.",
        },
      ],
    },
    {
      heading: 'One game lost the real board at move 29',
      blocks: [
        {
          kind: 'paragraph',
          text: "Game `e751c6c4`, Misty as Black, move 29. White pushes the g-pawn two squares, beside Black's pawn on f4. White's queen on d6 attacks the black king.",
        },
        {
          kind: 'image-figure',
          src: `${FIGURES}/after-29-g4.svg`,
          alt: "After 29.g4, from Black's side",
          caption:
            "After 29.g4, from Black's side. Tinted: White's pawn on g4, Black's pawn on f4, and the empty square g3 between them. The arrow is White's queen attacking the black king.",
          className: 'article-figure-board',
        },
        {
          kind: 'paragraph',
          text: 'Black is in check, so standard chess forbids f4xg3 en passant. Under fog it is an ordinary move, and it decides what Black sees.',
        },
        {
          kind: 'image-figure',
          src: `${FIGURES}/black-view-with-ep.svg`,
          alt: "Black's view with the en passant square",
          caption:
            'With the en passant square. 14 squares. Black sees g3, and sees the pawn on g4.',
          className: 'article-figure-board',
        },
        {
          kind: 'image-figure',
          src: `${FIGURES}/black-view-without-ep.svg`,
          alt: "Black's view without the en passant square",
          caption: 'Without it. 12 squares. g3 and g4 go dark. Same pieces, same board.',
          className: 'article-figure-board',
        },
        {
          kind: 'paragraph',
          text: 'Under the standard rule the square was dropped:',
        },
        {
          kind: 'code',
          language: 'text',
          text: 'stored  5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ -  0 29\nneeded  5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ g3 0 29',
        },
        {
          kind: 'paragraph',
          text: 'Misty built the position after 29.g4 without the square, counted 12 visible squares for Black, compared them with the 14 in the real observation, and threw out the true move. `P` fell from 625 boards to 41 in that ply, and the real board was not among the 41. Misty played its last four decisions of the game drawing search roots from those 41.',
        },
        {
          kind: 'paragraph',
          text: 'Move the black king one square over, where nothing attacks it, and change nothing else: the square is recorded as g3 and the real board stays in `P`.',
        },
      ],
    },
    {
      heading: 'The fix records the square whenever a pawn can take',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Record the square when a pawn can take, regardless of whether taking is wise. That is `EnPassantMode.XFEN`, and it is the fog rule. It still omits the square when no enemy pawn is adjacent, so the belief does not split over a square nobody can use.',
        },
        {
          kind: 'paragraph',
          text: 'The Rust path now checks only that an enemy pawn stands beside the pushed one. On the Python side every board written into `P` goes through one function, `belief_fen`, and the membership check takes a board and spells it the same way, since passing a raw `board.fen()` was how the mistake got in.',
        },
        {
          kind: 'paragraph',
          text: 'At the failing ply `P` now goes 625 to 617, truth kept. Replaying all 271 games reports no lost-truth decisions outside the sampled games, against four before.',
        },
      ],
    },
    {
      heading: 'Why nothing caught it',
      blocks: [
        {
          kind: 'paragraph',
          text: 'The enumerator raises only when `P` goes empty, and losing the truth from a set of 41 is silent, as it has to be: in play the engine never knows the truth. The test comparing the Rust port with python-chess stayed green across 178,145 move applications, because both made the same mistake. Replay records whether the truth is in `P`, but that column was only read on games past the sampling cap, where losing the truth is expected.',
        },
        {
          kind: 'paragraph',
          text: "Fixed in the engine on 2026-09-10 and released in [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3). Every board above is drawn by the engine's own visibility code from that position; the script that draws them refuses to run if the two views stop differing by exactly g3 and g4.",
        },
      ],
    },
  ],
};
