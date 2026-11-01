import {
  GOMOKU_BEFORE_FIVE,
  GOMOKU_OPENING_BLACK,
  GOMOKU_OPENING_WHITE,
  GOMOKU_WINNING_BOARDS,
} from '../../gomoku-rules-diagrams.js';
import type { Article } from '../types.js';

// Direct-URL review page. The spec's publicSurface keeps it out of rules
// lists, rails and homepage cards; article-meta.ts mirrors that for the sitemap.
// Rules and figures come from variants-gomoku.ts and gomoku-openings.json.
export const gomokuArticle: Article = {
  slug: 'gomoku',
  gameSpecId: 'gomoku',
  kind: 'rules',
  title: 'Gomoku Rules',
  summary: 'Freestyle five-in-a-row on a 15×15 board: learn placements, Mistboard’s dealt balanced openings, winning lines, draws and clocks.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-31',
  audience: 'Newcomers learning freestyle Gomoku and Mistboard’s dealt openings.',
  thumbnail: { kind: 'svg', svg: GOMOKU_OPENING_WHITE },
  tldr: [
    'Place one stone on an empty intersection each turn. Five or more connected stones in a straight line wins.',
    'The default opening is dealt from 50 Rapfi-screened positions. Continue with the side to move shown on the board.',
    'A full board without a winning line is a draw. In a timed game, running out of time loses.',
  ],
  intro: [
    { kind: 'paragraph', text: '**Your goal: make five in a row before your opponent does.**' },
    { kind: 'paragraph', text: 'Gomoku (五子棋) is a game for two players, one with black stones and one with white. Take turns placing stones; once placed, they stay put. Mistboard uses freestyle rules: a line of five or more wins for either colour, with no forbidden moves.' },
  ],
  sections: [
    {
      heading: 'The board and your turn',
      blocks: [
        { kind: 'paragraph', text: 'The board has 15 lines in each direction, giving 225 intersections. Put a stone where two lines cross, including at an edge or corner, rather than inside a square. Coordinates run from a to o and 1 to 15; the centre is h8.' },
        { kind: 'paragraph', text: 'On your turn, place exactly one stone of your colour on any empty intersection. You cannot pass, move a stone already on the board, capture a stone, or play on an occupied point. All stones remain visible to both players.' },
      ],
    },
    {
      heading: 'A dealt balanced opening',
      blocks: [
        { kind: 'paragraph', text: 'By default, Mistboard deals a starting position from a pool of 50 openings, so you begin with several stones already on the board. Those stones are part of the game, not moves you must play again.' },
        { kind: 'paragraph', text: 'Rapfi screened each opening at one million search nodes under freestyle rules, keeping positions with an estimated win rate between 45% and 55% for the side to move and no forced win found for either side. This is an engine screening result, not a mathematical proof that every opening is drawn.' },
        { kind: 'svg-row', items: [
          { svg: GOMOKU_OPENING_WHITE, caption: 'Opening gmk-001: Black has h8 and f6, White has i9. White places the next stone.' },
          { svg: GOMOKU_OPENING_BLACK, caption: 'Opening gmk-002 adds a white stone on i10. Both colours have two stones, so Black moves next.' },
        ] },
        { kind: 'paragraph', text: 'Read the turn indicator rather than assuming Black starts after the deal. Equal numbers of black and white stones mean Black to move; one extra black stone means White to move. The dealt stones cost neither player clock time.' },
        { kind: 'paragraph', text: 'Choose the free opening option to start from an empty board instead. Black then places the first stone and White follows. Mistboard does not use a colour-swap phase in either opening mode.' },
      ],
    },
    {
      heading: 'Five in a row wins',
      blocks: [
        { kind: 'paragraph', text: 'Connect at least five stones of your own colour horizontally, vertically, or along either diagonal. The stones must be consecutive: a gap or an enemy stone breaks the line. The game ends as soon as a placement completes the line; your opponent does not get a reply.' },
        { kind: 'svg-row', items: [
          { svg: GOMOKU_BEFORE_FIVE, caption: 'Black to move: e8, f8, g8 and h8 are four connected stones. The empty i8 completes five.' },
          { svg: GOMOKU_WINNING_BOARDS[0], caption: 'Black places i8 and wins immediately. Green rings mark the winning line; the red square marks the last placement.' },
        ] },
        { kind: 'svg-row', items: [
          { svg: GOMOKU_WINNING_BOARDS[1], caption: 'Vertical five: h5 through h9.' },
          { svg: GOMOKU_WINNING_BOARDS[2], caption: 'Diagonal five: f6, g7, h8, i9 and j10.' },
          { svg: GOMOKU_WINNING_BOARDS[3], caption: 'The other diagonal: f10, g9, h8, i7 and j6.' },
        ] },
      ],
    },
    {
      heading: 'Freestyle: longer lines count too',
      blocks: [
        { kind: 'paragraph', text: 'A line of six or more stones, often called an overline, also wins. The same rule applies to Black and White. Double threes and double fours are legal; Mistboard does not use Renju’s forbidden-move rules or an exactly-five requirement.' },
        { kind: 'raw-svg', svg: GOMOKU_WINNING_BOARDS[4], caption: 'Black fills i8 between h8 and j8, joining f8 through k8 into six. This is a freestyle win.' },
      ],
    },
    {
      heading: 'Draws and clocks',
      blocks: [
        { kind: 'paragraph', text: 'If all 225 intersections are occupied and neither player has made a winning line, the game is drawn. A winning line made on the very last empty point still wins: the five-in-a-row check comes before the board-full draw.' },
        { kind: 'paragraph', text: 'Once the clocks are running in a timed game, your time counts down on your turn. Placing a legal stone ends your turn and adds the chosen increment, if any. For example, 3+2 gives each player three minutes and adds two seconds after each move. Running out of time loses; resigning also gives the opponent the win.' },
      ],
    },
    {
      heading: 'Common questions',
      blocks: [
        { kind: 'faq', items: [
          { question: 'Do I have to make exactly five?', answer: 'No. Freestyle Gomoku counts five or more consecutive stones as a win for either colour.' },
          { question: 'Can I take an opponent’s stone?', answer: 'No. Stones are placed only on empty intersections and stay on the board. Blocking means occupying an empty point your opponent needs.' },
          { question: 'Why is White moving first in my game?', answer: 'A dealt opening can already contain one more black stone than white. White then has the next turn. On an empty board, Black always starts.' },
          { question: 'Is a screened opening guaranteed fair?', answer: 'The pool passed Rapfi’s finite search with a near-even evaluation and no forced win found. That reduces the opening advantage; it does not prove perfect balance or prevent a player from winning later.' },
        ] },
      ],
    },
    {
      heading: 'More rules',
      blocks: [
        { kind: 'cta', buttons: [
          { label: 'Browse all rules', href: '/rules', emphasis: 'primary' },
        ] },
      ],
    },
  ],
};
