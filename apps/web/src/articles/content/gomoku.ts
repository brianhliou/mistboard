import { GOMOKU_BOARD_SIZE } from '@mistboard/game';
import {
  GOMOKU_OPENING,
  GOMOKU_PLACEMENT,
  GOMOKU_WINNING_BOARD,
} from '../../gomoku-rules-diagrams.js';
import type { Article } from '../types.js';

// Set after the re-screened openings have a published study.
export const GOMOKU_OPENINGS_STUDY_URL: string | null = null;

// Gomoku rules. Indexing and public listings derive from publicSurface;
// play links also respect the VITE_GOMOKU_ENABLED build-time gate.
export function createGomokuArticle(
  openingsStudyUrl: string | null = GOMOKU_OPENINGS_STUDY_URL,
): Article {
  return {
    slug: 'gomoku',
    gameSpecId: 'gomoku',
    kind: 'rules',
    title: 'Gomoku Rules',
    seoTitle: 'Gomoku Rules: Freestyle 15x15 and Dealt Openings',
    summary: 'Learn to place stones, make five in a row and follow the turn indicator from Mistboard’s dealt openings.',
    showSummaryOnPage: false,
    status: 'published',
    publishedAt: '2026-10-31',
    updatedAt: '2026-11-07',
    updateNote: 'Updated the starting-position diagram to match how every game now starts: two black stones, three white stones, Black to move.',
    audience: 'Players learning Mistboard’s freestyle Gomoku and dealt openings.',
    thumbnail: { kind: 'svg', svg: GOMOKU_OPENING },
    tldr: [
      'Place a stone on an empty point each turn. Stones stay where you put them.',
      'Five or more stones of your colour in a straight line wins in freestyle Gomoku.',
    ],
    intro: [
      { kind: 'paragraph', text: `Gomoku has two players, Black and White, who take turns placing one stone on a ${GOMOKU_BOARD_SIZE}×${GOMOKU_BOARD_SIZE} board. Stones never move. The player who completes five in a row wins.` },
    ],
    sections: [
      {
        heading: 'Placing stones',
        blocks: [
          { kind: 'paragraph', text: 'Place your stone on a point, where two lines cross. The points along the edges and in the corners are playable too. An occupied point stays occupied for the rest of the game: stones cannot be captured or replaced. Unless your stone ends the game, your opponent plays next.' },
          { kind: 'raw-svg', svg: GOMOKU_PLACEMENT, caption: 'Black places h8, the centre point.' },
          { kind: 'paragraph', text: `Coordinates run a–o across the board and 1–${GOMOKU_BOARD_SIZE} up it. On your turn, choose any empty point, whether beside an existing stone or away from the group.` },
        ],
      },
      {
        heading: 'Five in a row wins',
        blocks: [
          { kind: 'paragraph', text: 'A winning line runs horizontally, vertically or diagonally. Its stones must be consecutive, with no empty point or opposing stone between them. A bent line does not count. Completing the line ends the game immediately; your opponent gets no reply.' },
          { kind: 'raw-svg', svg: GOMOKU_WINNING_BOARD, caption: 'Black completes e8–i8. Green rings mark the five; the red square marks i8.' },
          { kind: 'paragraph', text: 'Mistboard uses freestyle rules: six or more in a row, called an overline, also wins for either colour. Renju has restrictions on Black’s moves; those restrictions do not apply here.' },
          { kind: 'paragraph', text: 'Before placing a stone, look for a line your opponent could complete next turn. Filling its empty point can block the win. Your stones can build toward several directions at once, so check the diagonals as well as the rows and columns.' },
        ],
      },
      {
        heading: 'Draws',
        blocks: [
          { kind: 'paragraph', text: 'A full board without a winning line is drawn. In a human game, once both players have moved, press ½ (Offer draw) and confirm; your opponent can accept or decline. Resigning concedes the game to your opponent.' },
        ],
      },
      {
        heading: 'Dealt openings',
        blocks: [
          { kind: 'paragraph', text: 'Every game starts from a position already on the board, picked from a set an engine searched and judged close to even. From an empty board, Black’s first move is a real advantage, so the game starts from a balanced position instead. Follow the turn indicator to see who plays next.' },
          { kind: 'raw-svg', svg: GOMOKU_OPENING, caption: 'A dealt starting position. The stones already on the board stay in play.' },
          { kind: 'paragraph', text: 'Tournament rules such as Swap2 balance the start by letting players place stones and choose colours; Mistboard deals a screened position instead.' },
          ...(openingsStudyUrl ? [{ kind: 'paragraph' as const, text: `You can study [every opening](${openingsStudyUrl}).` }] : []),
        ],
      },
      {
        heading: 'Names and history',
        blocks: [
          { kind: 'paragraph', text: 'The Japanese name gomokunarabe means “five in a row”; the game is also called Chinese wuziqi, Korean omok and English gobang. Japanese records date to the Edo period, with a verifiable book from 1856; Renju, which restricts Black’s moves, was named in 1899. [L. Victor Allis’s 1994 PhD thesis](https://project.dke.maastrichtuniversity.nl/games/files/phd/SearchingForSolutions.pdf) proved Black wins with perfect play from an empty 15×15 board under both freestyle and exactly-five rules.' },
        ],
      },
      {
        heading: 'Common questions',
        blocks: [
          { kind: 'faq', items: [
            { question: 'Does screening guarantee a draw?', answer: 'Screening uses finite search. A near-even evaluation is an estimate; play can still reveal a winning continuation.' },
          ] },
        ],
      },
      {
        heading: 'Play on Mistboard',
        blocks: [
          { kind: 'cta', buttons: [
            { label: 'Play Gomoku', href: '/?play=computer&gameSpecId=gomoku', emphasis: 'primary' },
            { label: 'Play a friend', href: '/?play=friend&gameSpecId=gomoku', emphasis: 'secondary' },
          ] },
        ],
      },
    ],
  };
}

export const gomokuArticle: Article = createGomokuArticle();
