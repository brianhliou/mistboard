import { playClosing } from '../diagrams.js';
import type { Article } from '../types.js';

// Written while the table is an admin playtest (publicSurface 'hidden',
// allowlisted on the server), so it is unlisted and non-indexed
// (apps/server/src/article-meta.ts NON_INDEXED_ARTICLE_SLUGS) and English only.
// Every rule here is the kernel's, packages/game/src/variants-crazyhouse-
// xiangqi.ts: the drop points are crazyhouseXiangqiCanStand, the no-check
// drop is the legal-move filter, and the endings are applyCrazyhouseXiangqiMove.
// Change the two together.
export const crazyhouseXiangqiArticle: Article = {
  slug: 'crazyhouse-xiangqi',
  gameSpecId: 'crazyhouse-xiangqi',
  boardFamily: 'xiangqi',
  kind: 'rules',
  title: 'Crazyhouse Xiangqi Rules',
  summary:
    'Xiangqi where a captured piece joins your hand: on your turn you may drop it on any empty point where it could stand in a normal game, as long as the drop does not give check.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-01',
  playableOnMistboard: true,
  audience:
    'Xiangqi players trying the drop version for the first time, and Crazyhouse players who want the xiangqi rules stated precisely.',
  intro: [
    {
      kind: 'paragraph',
      text: 'Crazyhouse Xiangqi is [xiangqi](/rules/xiangqi) with one addition. Captured pieces join your hand. On your turn you may drop one of them on any empty point where that piece could stand in a normal game. A drop may not give check.',
    },
    {
      kind: 'paragraph',
      text: 'Everything else is xiangqi: the board, the starting array, how each piece moves, the palace, the river, the rule that the two generals may not face each other on an open file, and the way a game ends.',
    },
  ],
  sections: [
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
          text: '**Where a piece may land.** Only on a point where that piece could stand in a normal game of xiangqi:',
        },
        {
          kind: 'table',
          headers: ['Piece', 'May be dropped on'],
          keyColumn: true,
          wrap: true,
          rows: [
            ['Chariot, horse, cannon', 'Any empty point.'],
            ['Advisor', 'One of the five advisor points of your own palace.'],
            ['Elephant', 'One of the seven elephant points on your own side of the river.'],
            [
              'Soldier',
              'On your own side, one of the five soldier files, on the rank where soldiers start or the rank in front of it. Across the river, any empty point.',
            ],
          ],
        },
        {
          kind: 'paragraph',
          text: 'Any number of soldiers may share a file. A soldier dropped across the river already moves sideways, as a soldier that walked there would.',
        },
        {
          kind: 'paragraph',
          text: '**A drop may not give check.** Whatever makes it check is ruled out: the dropped piece attacking the general itself, or the dropped piece becoming the screen one of your own cannons fires over. You may still drop a piece to block a check against your own general. A drop that gives check is not on the board as a choice; the game does not offer it.',
        },
        {
          kind: 'paragraph',
          text: 'Moves give check as they do in any game of xiangqi. Only drops are restricted.',
        },
      ],
    },
    {
      heading: 'How the game ends',
      blocks: [
        {
          kind: 'paragraph',
          text: '**Checkmate wins.** As in xiangqi, so does stalemate: a player with no legal move loses, in check or not. Count your drops as moves. A player with a piece in hand and an empty point to put it on is rarely out of moves.',
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
              question: 'Why can I not drop my chariot on that point?',
              answer:
                'The drop would give check. A chariot dropped on the general’s file or rank with nothing in between checks it, and so does any piece dropped between one of your cannons and the general, because it becomes the cannon’s screen.',
            },
            {
              question: 'Why does my elephant only drop on some points?',
              answer:
                'An elephant can only ever stand on its seven points on its own side of the river, and an advisor on its five palace points. A drop puts a piece where a game could have put it, nowhere else.',
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
      lead: 'Crazyhouse Xiangqi is on Mistboard against the Fairy-Stockfish ladder or a friend with an invite link. It is still being tested and is open to invited accounts.',
      playLabel: 'Play the computer',
      playHref: '/?play=computer&gameSpecId=crazyhouse-xiangqi',
    }),
  ],
};
