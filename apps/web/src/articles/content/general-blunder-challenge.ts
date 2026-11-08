import { xqHalfBoardThumbnailSvg, xqVisionDemoState } from '../diagrams.js';
import type { Article } from '../types.js';

// Card art: the challenge as a question over the mate it asks for, Black's
// chariots on c1 and g2 closing Red's general on e1. The headline template of
// xqHalfBoardThumbnailSvg.
const GENERAL_BLUNDER_CHALLENGE_THUMBNAIL = (): string =>
  xqHalfBoardThumbnailSvg({
  state: xqVisionDemoState('general-blunder-challenge-thumb', {
    e1: { color: 'red', role: 'general' },
    c1: { color: 'black', role: 'chariot' },
    g2: { color: 'black', role: 'chariot' },
  }),
  half: 'bottom',
  perspective: 'red',
  headline: 'Can you lose?',
  ariaLabel: "Can you lose? Black's two chariots checkmate Red's general",
});

// A test game from 2026-10-17: a scripted opponent choosing uniformly among its
// legal moves (Red) against General Blunder at its live budget (Black), played
// under the site's own rules kernel. It was the quickest of ten such games; the
// random player mated in all ten (37 to 207 plies). No game record exists, so
// it rides as a line embed, the moves in the query string (study UCI, ranks 1 to
// 10).
const RANDOM_MOVER_MOVES =
  'h3f3 h8h3 c4c5 e10e9 f3f7 h3c3 a1a3 e9d9 b3b5 f10e9 g4g5 a10a9 h1i3 b8h8 f7i7 h8i8 b5b2 i10i9 i7i5 c10a8 i3g4 c3i3 a4a5 a8c6 a3h3 i8i7 i5h5 d9d8 i1i3 c6e8 b2b7 a7a6 b7b6 i7i5 i3i2 g7g6 i2d2';
const RANDOM_MOVER_EMBED_PATH = `/embed/line/xiangqi?${new URLSearchParams({
  moves: RANDOM_MOVER_MOVES.replace(/ /g, ','),
  red: 'Random moves',
  black: 'General Blunder',
  event: 'Test game, 17 October 2026',
  result: '1-0',
}).toString()}`;

export const generalBlunderChallengeArticle: Article = {
  slug: 'general-blunder-challenge',
  kind: 'article',
  publisher: 'mistboard',
  game: 'xiangqi',
  title: 'Can you make General Blunder win?',
  cardTitle: 'Make General Blunder win',
  seoTitle: 'The General Blunder challenge: draw or lose to a xiangqi bot that tries to lose',
  summary:
    'General Blunder is a xiangqi bot that plays its worst move every turn, so beating it is easy. Two challenges for anyone who wants more: get a draw, then make it win.',
  status: 'published',
  publishedAt: '2026-10-19',
  updatedAt: '2026-10-24',
  updateNote: 'Added the first draw, by rebirthfox333, and our verdict on the harder challenge.',
  thumbnail: { kind: 'svg', svg: GENERAL_BLUNDER_CHALLENGE_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'Beginners and anyone who likes a puzzle with a twist.',
  tldr: [
    'General Blunder checks every legal move with a strong engine and plays the one that is worst for itself.',
    'In ten test games, an opponent choosing its moves at random checkmated it every time, the quickest in 19 moves.',
    'The easier challenge, a draw, fell on 19 October. We think the harder one, making it win, is out of reach in a real game.',
  ],
  intro: [
    {
      kind: 'paragraph',
      text: '[General Blunder](/bot/general-blunder) is the xiangqi bot that tries to lose. Every turn it asks a strong engine about each of its legal moves and plays the one that is worst for itself: the move that gets it checkmated soonest, or, when no mate is in sight, the one that gives away the most.',
    },
    {
      kind: 'paragraph',
      text: 'Winning against it is not the hard part. We played ten test games against it with an opponent that picked every move at random, and the random player checkmated it in all ten. The quickest took 19 moves.',
    },
    {
      kind: 'embed',
      path: RANDOM_MOVER_EMBED_PATH,
      title: 'Test game, 17 October 2026',
      aspect: [702, 696],
      caption:
        'Random moves (Red) against General Blunder (Black). Red chose every move at random and mated on its 19th move.',
    },
  ],
  sections: [
    {
      heading: 'The easier challenge: get a draw',
      blocks: [
        {
          kind: 'paragraph',
          text: 'General Blunder never resigns, and Mistboard has no draw offers, so a draw has to come from the rules themselves. That is harder than it sounds against a bot that spends every turn handing you something. The [xiangqi rules page](/rules/xiangqi) lists every way a game can end. Find the one that works against an opponent that wants to lose.',
        },
        {
          kind: 'paragraph',
          text: 'rebirthfox333 did it first, on 19 October, the day this page went up, in [a 137-move draw](/xiangqi/game/xq_e4ff1ac2-dafd-4690-ad41-4a72780e550a). The game page shows how it ended, if you want the answer.',
        },
      ],
    },
    {
      heading: 'The harder challenge: make it win',
      blocks: [
        {
          kind: 'paragraph',
          text: 'General Blunder treats winning as the worst thing it could do, so it wins when it has no other choice. A move that checkmates you sits at the very bottom of its list, and it plays one only when every legal move it has would end the game in its favour.',
        },
        {
          kind: 'paragraph',
          text: 'The challenge is to steer a real game into a position like that. It searches ahead, so it steps around a trap it can see coming.',
        },
      ],
    },
    {
      heading: 'We think the win is out of reach',
      blocks: [
        {
          kind: 'paragraph',
          text: 'rebirthfox333 tried that too, in [a 103-move game on 20 October](/xiangqi/game/xq_efe0c4b1-bdd9-4290-877f-594c8693e772). General Blunder kept capturing with a chariot or a cannon on squares where Red could then checkmate it at once. Red had a mate in one on 36 different turns and, trying to lose, played none of them, so every one of those captures stood.',
        },
        {
          kind: 'paragraph',
          text: 'That is the catch. Every piece General Blunder keeps is another piece it can move, and with 30 or 40 legal moves there is nearly always one that wins slowly or not at all. Late in that game every move it had was winning, and it still never had to mate. It shuffled until Red resigned.',
        },
        {
          kind: 'paragraph',
          text: 'It came close once. Around its 80th move it had three legal moves, and all three won by force. It picked the slowest, as it is built to, and Red\'s reply gave it room again.',
        },
        {
          kind: 'paragraph',
          text: 'So our verdict: making General Blunder win is probably impossible in a real game. The rules allow it, and the one route we can see runs against instinct: take its pieces until it has its general and almost nothing else, then leave it no move that does not win. No game we know of has got there.',
        },
      ],
    },
    {
      heading: 'Show us',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If you get it to win, post the game on the [forum](/forum) with its link. Every finished game on Mistboard has its own page. Running out of time, resigning or leaving the game do not count. Those are the ways it wins today without anyone trying.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play General Blunder', href: '/bot/general-blunder', emphasis: 'primary' },
            { label: 'Read the rules', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
