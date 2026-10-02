import {
  CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD,
  CRAZYHOUSE_XIANGQI_RIVER_PAIR,
  CRAZYHOUSE_XIANGQI_START_BOARD,
} from '../../crazyhouse-xiangqi-rules-diagrams.js';
import { playClosing } from '../diagrams.js';
import type { Article } from '../types.js';

// Listed and indexed with the public launch, in English and machine-drafted
// zh-Hans / zh-Hant (article-i18n.ts). Every rule here is the kernel's,
// packages/game/src/variants-crazyhouse-xiangqi.ts: the start is
// createInitialCrazyhouseXiangqiState, the drop points are
// crazyhouseXiangqiCanStand, the advisor and elephant moves are its rule
// geometry, and the endings are applyCrazyhouseXiangqiMove. The diagrams are
// drawn from the kernel (crazyhouse-xiangqi-rules-diagrams.ts). Change the
// two together.
export const crazyhouseXiangqiArticle: Article = {
  slug: 'crazyhouse-xiangqi',
  gameSpecId: 'crazyhouse-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Crazyhouse Xiangqi Rules',
  summary:
    'Xiangqi where a captured piece joins your hand and the advisors and elephants start there: drop a piece on any empty point where it could stand, check and mate included.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-01',
  playableOnMistboard: true,
  audience:
    'Xiangqi players trying the drop version for the first time, and Crazyhouse players who want the xiangqi rules stated precisely.',
  thumbnail: { kind: 'svg', svg: CRAZYHOUSE_XIANGQI_START_BOARD },
  intro: [
    {
      kind: 'paragraph',
      text: 'Crazyhouse Xiangqi is [xiangqi](/rules/xiangqi) with drops. Captured pieces join your hand, and on your turn you may drop one of them instead of moving. Each side also starts with its two advisors and two elephants in hand, and those pieces move anywhere on their own side of the river.',
    },
    {
      kind: 'paragraph',
      text: 'Everything else is xiangqi: the board, how the other pieces move, the general in its palace, the river, the rule that the two generals may not face each other on an open file, and the way a game ends.',
    },
    // TODO link brianhliou.com/posts/crazyhouse-xiangqi/ once published
    {
      kind: 'paragraph',
      text: 'Brian H. Liou designed this version in 2026 as a Mistboard original. Drop rules for xiangqi already exist, with no settled standard: Moshe Callen’s Drop-Xiangqi (2007) takes shogi’s drop rules whole, Fairy-Stockfish’s built-in xiangqihouse allows drops only on your own half of the board, and no other site we found offers crazyhouse xiangqi as a game to play. To choose the rules, Fairy-Stockfish played well over 1,600 games across more than 40 candidate rule sets on the full board, and the set described here kept games even and decisive while giving advisors and elephants real play. As far as we found, it is the first crazyhouse xiangqi rule set chosen by measuring engine play on the full board.',
    },
  ],
  sections: [
    {
      heading: 'The start',
      blocks: [
        {
          kind: 'paragraph',
          text: 'Each side begins with its two advisors and two elephants in hand, not on the board. The back rank reads chariot, horse, two empty points, the general, two empty points, horse, chariot. The cannons and soldiers stand where they always do.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_START_BOARD,
          caption: 'The start. Both hands hold two advisors and two elephants.',
        },
        {
          kind: 'paragraph',
          text: 'Red moves first, and the first move may already be a drop.',
        },
      ],
    },
    {
      heading: 'Advisors and elephants',
      blocks: [
        {
          kind: 'paragraph',
          text: 'An advisor moves one point diagonally and an elephant two, and an elephant is still blocked when the point between is occupied. Neither is held to its usual points: an advisor may leave the palace, and an elephant may stand on any point, as long as both stay on their own side of the river. Neither ever crosses it.',
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_RIVER_PAIR,
          caption:
            'An advisor on e5 and an elephant on c5, on the river bank. The dots are where each may move; the crosses are the points the river keeps them from.',
        },
      ],
    },
    {
      heading: 'Captured pieces change sides',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When you capture a piece it leaves the board and goes into your hand as one of your own. Take a black horse and you hold a red horse. Both hands are shown beside the board, so you always know what your opponent can drop.',
        },
        {
          kind: 'paragraph',
          text: 'The general is never captured, so it is never in a hand. Every other piece can be: chariots, horses, elephants, advisors, cannons and soldiers.',
        },
      ],
    },
    {
      heading: 'Dropping a piece',
      blocks: [
        {
          kind: 'paragraph',
          text: 'A turn is either a normal move or a drop. To drop, take a piece from your hand and place it on an empty point. That is your whole turn.',
        },
        {
          kind: 'paragraph',
          text: '**Where a piece may land.** Only on a point where that piece could stand:',
        },
        {
          kind: 'table',
          headers: ['Piece', 'May be dropped on'],
          keyColumn: true,
          wrap: true,
          rows: [
            ['Chariot, horse, cannon', 'Any empty point.'],
            ['Advisor, elephant', 'Any empty point on your own side of the river.'],
            [
              'Soldier',
              'On your own side, one of the five soldier files, on the rank where soldiers start or the rank in front of it. Across the river, any empty point.',
            ],
          ],
        },
        {
          kind: 'raw-svg',
          svg: CRAZYHOUSE_XIANGQI_DROP_REGION_BOARD,
          caption:
            'At the start, Red may drop an advisor or an elephant on any of the marked points.',
        },
        {
          kind: 'paragraph',
          text: 'Any number of soldiers may share a file. A soldier dropped across the river already moves sideways, as a soldier that walked there would.',
        },
        {
          kind: 'paragraph',
          text: '**A drop may give check, and may mate.** The dropped piece may attack the general itself, or become the screen one of your own cannons fires over. The one drop you may not make is one that leaves your own general in check: a drop may block a check, but it may not become the screen an enemy cannon fires over at your general.',
        },
      ],
    },
    {
      heading: 'How the game ends',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Checkmate wins,** by a move or by a drop. As in xiangqi, so does stalemate: a player with no legal move loses, in check or not. Count your drops as moves. A player with a piece in hand and an empty point to put it on is rarely out of moves.',
        },
        {
          kind: 'paragraph',
          text: '**Repetition.** When the same position occurs for the third time, with the same pieces on the same points, the same pieces in both hands and the same player to move, the game is drawn. If one player gave check with every move of the repeating cycle and the other did not, the checking player loses instead: perpetual check is not a way to save a game.',
        },
        {
          kind: 'paragraph',
          text: '**Sixty plies without a capture** is a draw. Moves and drops both count toward the sixty; only a capture starts the count again.',
        },
        {
          kind: 'paragraph',
          text: 'Time, resignation and abandonment end a game as they do everywhere else on Mistboard.',
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
              question: 'Can a drop give check?',
              answer:
                'Yes. A drop may check and may mate, directly or by becoming the screen for one of your cannons. The only drop you may not make is one that leaves your own general in check.',
            },
            {
              question: 'Why can my elephant not cross the river?',
              answer:
                'Advisors and elephants never cross it, by move or by drop. On your own side of the river they may stand on any point, so that whole half is open to them.',
            },
            {
              question: 'Why do advisors and elephants start in hand?',
              answer:
                'So both sides have pieces to drop from the first move, placed where the game needs them instead of on fixed points.',
            },
            {
              question: 'Does a drop reset the sixty-ply count?',
              answer:
                'No. Only a capture does. Without that, two players could trade drops forever without either one taking anything.',
            },
          ],
        },
      ],
    },
    playClosing({
      heading: 'Play on Mistboard',
      lead: 'Crazyhouse Xiangqi is on Mistboard against the Fairy-Stockfish ladder, a friend with an invite link, or whoever is waiting in the lobby.',
      playLabel: 'Play the computer',
      playHref: '/?play=computer&gameSpecId=crazyhouse-xiangqi',
    }),
  ],
};
