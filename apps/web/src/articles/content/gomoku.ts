import {
  GOMOKU_BOARD_SIZE,
  GOMOKU_OPENING_SCREEN,
  GOMOKU_OPENINGS,
  type GomokuOpening,
} from '@mistboard/game';
import {
  GOMOKU_OPENING,
  GOMOKU_PLACEMENT,
  GOMOKU_WINNING_BOARD,
} from '../../gomoku-rules-diagrams.js';
import type { Article } from '../types.js';

function openingDescription(opening: GomokuOpening): string {
  const stones = (color: 'black' | 'white') => {
    const count = opening.stones.filter((stone) => stone.color === color).length;
    return `${count} ${color} ${count === 1 ? 'stone' : 'stones'}`;
  };
  return `${stones('black')} and ${stones('white')}, ${opening.turn === 'black' ? 'Black' : 'White'} to move`;
}

const poolSize = `${GOMOKU_OPENINGS.length} ${GOMOKU_OPENINGS.length === 1 ? 'position' : 'positions'}`;
const setups = [...new Set(GOMOKU_OPENINGS.map(openingDescription))];
const percent = (value: number) => `${Number((value * 100).toFixed(2))}%`;
const whiteToMove = GOMOKU_OPENINGS.some((opening) => opening.turn === 'white');

// Direct-URL English review page. The hidden spec, sitemap exclusion and
// VITE_GOMOKU_ENABLED playtest gate stay in place. Pool facts follow the kernel's
// JSON exports so re-screening changes the prose and example together.
export const gomokuArticle: Article = {
  slug: 'gomoku',
  gameSpecId: 'gomoku',
  kind: 'rules',
  title: 'Gomoku Rules',
  summary: 'Place stones, connect five, and compete from a dealt opening the engine judged even.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-31',
  updatedAt: '2026-11-01',
  updateNote: 'Shortened the rules, explained the dealt openings and added the game’s history and draw-offer controls.',
  audience: 'Players learning Mistboard’s freestyle Gomoku and dealt openings.',
  thumbnail: { kind: 'svg', svg: GOMOKU_OPENING },
  tldr: [
    'Take turns placing stones. Connect five or more in a straight line to win.',
    'Mistboard deals an opening the engine judged even; follow the turn indicator.',
  ],
  intro: [
    { kind: 'paragraph', text: 'As with Chess960, a fresh starting position lets you test each other’s play beyond memorised openings.' },
  ],
  sections: [
    {
      heading: 'Mistboard deals an engine-balanced opening',
      blocks: [
        { kind: 'paragraph', text: `The pool has ${poolSize}, screened at ${GOMOKU_OPENING_SCREEN.nodes.toLocaleString('en-US')} search nodes each: ${percent(GOMOKU_OPENING_SCREEN.minWinrate)}–${percent(GOMOKU_OPENING_SCREEN.maxWinrate)} estimated win rate for the side to move, no forced win found. Dealt stones use no clock time.` },
        { kind: 'paragraph', text: `Starting setups: ${setups.join('; ')}. Follow the turn indicator.` },
        { kind: 'raw-svg', svg: GOMOKU_OPENING, caption: `Opening ${GOMOKU_OPENINGS[0].id}: ${openingDescription(GOMOKU_OPENINGS[0])}.` },
        { kind: 'paragraph', text: 'Tournament rules such as Swap2, used at world championships since 2009, balance Black’s advantage by letting players place stones and choose colours. Mistboard deals a screened position instead.' },
      ],
    },
    {
      heading: 'The board and your turn',
      blocks: [
        { kind: 'paragraph', text: `Place one stone per turn on an empty intersection of the ${GOMOKU_BOARD_SIZE}×${GOMOKU_BOARD_SIZE} board. Stones stay put. Coordinates run a–o and 1–${GOMOKU_BOARD_SIZE}.` },
        { kind: 'raw-svg', svg: GOMOKU_PLACEMENT, caption: 'Black places h8, the centre intersection.' },
      ],
    },
    {
      heading: 'Five in a row wins',
      blocks: [
        { kind: 'paragraph', text: 'Connect five stones of your colour horizontally, vertically or diagonally to win immediately. Freestyle also counts six or more in a row (an overline) for either colour.' },
        { kind: 'raw-svg', svg: GOMOKU_WINNING_BOARD, caption: 'Black completes e8–i8. Green rings mark the five; the red square marks i8.' },
      ],
    },
    {
      heading: 'Players can agree to a draw',
      blocks: [
        { kind: 'paragraph', text: 'In a human game, once both players have moved, press ½ (Offer draw) and confirm; your opponent can accept or decline. A full board without five is drawn; running out of time or resigning loses.' },
      ],
    },
    {
      heading: 'Black wins a perfect game from the empty board',
      blocks: [
        { kind: 'paragraph', text: 'The Japanese name gomokunarabe means “five in a row”; the game is also called Chinese wuziqi, Korean omok and English gobang. Japanese records date to the Edo period, with a verifiable book from 1856; Renju, which restricts Black’s moves, was named in 1899. [L. Victor Allis’s 1994 PhD thesis](https://project.dke.maastrichtuniversity.nl/games/files/phd/SearchingForSolutions.pdf) proved Black wins with perfect play on 15×15 under both freestyle and exactly-five rules. Dealing balanced positions keeps a solved game competitive and fair for both colours.' },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        { kind: 'faq', items: [
          { question: 'Can I start from an empty board?', answer: 'Choose Free opening (empty board) in setup. Black begins.' },
          ...(whiteToMove ? [{ question: 'Why is White moving first in my game?', answer: 'The deal has one extra black stone, so White moves next.' }] : []),
          { question: 'Does screening guarantee a draw?', answer: 'Screening uses finite search. A near-even evaluation is an estimate, not a proof.' },
        ] },
      ],
    },
    {
      heading: 'Play on Mistboard',
      blocks: [
        { kind: 'cta', buttons: [
          { label: 'Play vs computer', href: '/?play=computer&gameSpecId=gomoku', emphasis: 'primary' },
          { label: 'Challenge a friend', href: '/?play=friend&gameSpecId=gomoku', emphasis: 'secondary' },
        ] },
      ],
    },
  ],
};
