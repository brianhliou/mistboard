import { boardToPieces } from '@mistboard/board-render';
import { parseDarkChessFen } from '@mistboard/game';
import { fogFor } from '../diagrams.js';
import type { Article } from '../types.js';

// Moved from the brianhliou.com post of 2026-09-12 (/posts/en-passant-under-fog/),
// text word for word as published there. The three board figures are the
// post's own SVGs, drawn by Misty's visibility code, served as static images
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
  title: 'Under Fog, En Passant Is Part of What You Can See',
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
      text: '[Misty](/blog/misty) plays [fog of war chess](/rules/fog-chess) by holding `P`, the set of every board consistent with what it has observed. `P` is stored as FEN strings, and one field of a FEN is written by a rule rather than by the position.',
    },
    {
      kind: 'table',
      keyColumn: true,
      wrap: true,
      headers: ['', ''],
      rows: [
        [
          '**Symptom**',
          '`P` fell from 625 boards to 41 in one ply, and the true board was not among the 41',
        ],
        ['**Impact**', 'Misty finished that game drawing search roots from 41 worlds, none of them real'],
        [
          '**Cause**',
          'The en passant square recorded under standard-chess legality, in a variant with no king-safety rule',
        ],
        [
          '**Fix**',
          'Record it on the pseudo-legal rule (`EnPassantMode.XFEN`), through one shared function',
        ],
        ['**Frequency**', '1 ply in 12,866, across 273 finished games'],
        [
          '**Detection**',
          'None. Found four months later while measuring belief sizes for something else',
        ],
      ],
    },
  ],
  sections: [
    {
      heading: 'The bug',
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
          text: "Black's f4 pawn can take on g3 en passant. Standard chess forbids it: Black is in check, and the capture does not address the check. Fog of war chess has no such rule. You cannot see the attack on your king, so you may leave it there, and the game ends on a captured king rather than at mate. f4xg3 is an ordinary move here.",
        },
        {
          kind: 'paragraph',
          text: 'Vision under fog is the set of squares your own pieces can move to. A pawn that can capture en passant sees the landing square, and sees the pawn it would take. The en passant square is therefore a fact about perception, not only about legality.',
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
          text: '`python-chess` writes that field with `EnPassantMode.LEGAL` by default, recording the square only when the capture is legal by standard rules. So it wrote `-`:',
        },
        {
          kind: 'code',
          language: 'text',
          text: 'stored  5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ -  0 29\nneeded  5k2/2Q4p/P2Qp3/4N3/5pP1/B7/4PP1P/RN2KB1R b KQ g3 0 29',
        },
        {
          kind: 'paragraph',
          text: 'The belief update rebuilds positions from those strings. Rebuilt from the stored one, the true position showed Black twelve squares instead of fourteen, no longer matched the observation it had itself produced, and dropped out of `P`.',
        },
      ],
    },
    {
      heading: 'The fix',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Record the square when a pawn can take, regardless of whether taking is wise. That is `EnPassantMode.XFEN`, and it is the fog rule. It still omits the square when no enemy pawn is adjacent, so the belief does not split over a square nobody can use.',
        },
        {
          kind: 'paragraph',
          text: 'Both writers now go through one named function instead of each calling a serializer with its own defaults. The membership check takes a board and canonicalizes it, since passing a raw `board.fen()` was the shape of the original mistake.',
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
          text: '**The tripwire fires on the wrong extreme.** The enumerator raises when `P` goes empty, which needs a belief so small that no candidate survives. Losing the truth from a set of 41 is silent, and has to be: in play the engine never knows the truth, so it has nothing to check against.',
        },
        {
          kind: 'paragraph',
          text: "**The differential test passed because both sides were wrong.** Misty's hot path is a Rust extension carrying a function written to reproduce python-chess byte for byte. It succeeded. The test comparing them across 178,145 move applications stayed green, comparing two encoders that had made the same mistake.",
        },
        {
          kind: 'paragraph',
          text: '**Replay could have seen it and was not looking.** The analysis pass records whether the truth is in `P`, but that column was only read on games past the sampling cap, where losing the truth is expected. On uncapped games it has no innocent explanation. Nobody had run that query.',
        },
      ],
    },
    {
      heading: 'What generalizes',
      blocks: [
        {
          kind: 'paragraph',
          text: "**A serializer from a standard-rules library is not a neutral encoder.** It writes that library's judgments into the bytes, and those judgments are rules. Use its output as a key and you have imported a rulebook you never read.",
        },
        {
          kind: 'paragraph',
          text: '**Two implementations agreeing tells you they agree.** Mine agreed for months, and the agreement hid the bug: whenever I wondered whether the Rust port had drifted, a green test said no. True, and not the question.',
        },
        {
          kind: 'paragraph',
          text: '**A belief that loses the truth gets sharper, not vaguer.** 41 worlds is a more confident belief than the 617 that survive once the square is recorded correctly. The failure does not look like uncertainty from the inside.',
        },
        {
          kind: 'paragraph',
          text: "Fixed in the engine on 2026-09-10 and released in [Misty 0.1.3](https://github.com/brianhliou/misty/releases/tag/v0.1.3). Every board above is drawn by the engine's own visibility code from that position; the script that draws them refuses to run if the two views stop differing by exactly g3 and g4.",
        },
      ],
    },
  ],
};
