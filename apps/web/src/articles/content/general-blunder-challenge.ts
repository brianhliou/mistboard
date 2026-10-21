import { xqHalfBoardThumbnailSvg, xqVisionDemoState } from '../diagrams.js';
import type { Article } from '../types.js';

// Card art: the challenge as a question over the mate it asks for, Black's
// chariots on c1 and g2 closing Red's general on e1. The headline template of
// xqHalfBoardThumbnailSvg.
const GENERAL_BLUNDER_CHALLENGE_THUMBNAIL = xqHalfBoardThumbnailSvg({
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
  title: 'Can you make General Blunder win?',
  cardTitle: 'Make General Blunder win',
  seoTitle: 'The General Blunder challenge: draw or lose to a xiangqi bot that tries to lose',
  summary:
    'General Blunder is a xiangqi bot that plays its worst move every turn, so beating it is easy. Two challenges for anyone who wants more: get a draw, then make it win.',
  status: 'published',
  publishedAt: '2026-10-19',
  thumbnail: { kind: 'svg', svg: GENERAL_BLUNDER_CHALLENGE_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'Beginners and anyone who likes a puzzle with a twist.',
  tldr: [
    'General Blunder checks every legal move with a strong engine and plays the one that is worst for itself.',
    'In ten test games, an opponent choosing its moves at random checkmated it every time, the quickest in 19 moves.',
    'The easier challenge is to get a draw. The harder one is to make it win on the board.',
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
          text: 'The challenge is to steer a real game into a position like that. It searches ahead, so it steps around a trap it can see coming. We have not managed it ourselves, and we do not know how hard it is.',
        },
      ],
    },
    {
      heading: 'Show us',
      blocks: [
        {
          kind: 'paragraph',
          text: 'If you draw General Blunder or get it to win, post the game on the [forum](/forum) with its link. Every finished game on Mistboard has its own page. Running out of time, resigning or leaving the game do not count. Those are the ways it wins today without anyone trying.',
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play General Blunder', href: '/bot/general-blunder', emphasis: 'primary' },
            { label: 'Read the rules', href: '/rules/xiangqi', emphasis: 'secondary' },
          ],
        },
        {
          kind: 'paragraph',
          text: 'So can you make a bot that tries to lose win? The rules allow it: positions exist where every move General Blunder has would beat you, and in one of those it has to play one. Whether a person can walk a real game there, against a bot that sees the trap and tries to dodge it, is the open question. We will add the first game that does it to this page.',
        },
      ],
    },
  ],
};
