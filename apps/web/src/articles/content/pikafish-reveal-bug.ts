import type { XiangqiPlayerView } from '@mistboard/game';
import { parseJieqiFen, type XiangqiSquare } from '@mistboard/game';
import { XQ_CELL, xqBoardSvg, xqPoint, xqStaticView, xqVisionDemoState } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The follow-up the AB-JChess post promised (#497). Numbers and positions:
// - game 108 (run7, AB-JChess vs PikaJieQi): ply 23, Black's d9e8 (d10-e9); in-game
//   +18.7 for Black with Red's mate in its own PV; only an advisor (1 of 11 in
//   Black's pool) guards f10; it was a chariot. Fixed build: d9e8 is mated, plays h9g7.
// - game jq_23d2a761 ply 26, Red's b2d2 (b3-d3): old build (e75cee3a, fresh, 4M nodes)
//   +8.6; pool-weighted value -3.0 (chariot 0.4 wins; soldier 0.4 and elephant 0.2
//   mated); fixed build plays e1f2 (e2-f3), AB-JChess's move.
// - 71 decisive moves (fresh, 2M nodes, 1 thread): over-rated by 5+ pawns 16 -> 3;
//   30 controls 0 -> 0. Self-play vs e75cee3a, 1M nodes/move: colour fix alone
//   95-95-10 (200); everywhere re-search -150 Elo (128 games); shipped root-only
//   264-300-36 (600), -21 Elo [-48, +6]; at 4M nodes/move 95-97-8 (200), -3 [-51, +44]
//   (the post quotes the 4M result as "plays about as well").
// - AB-JChess: worst move in each of its 136 run7 losses, 60 reveals, 2 over-rated by
//   15+ win points. Rigs: mistboard-engine lab, issue #497.

// Card art: match game 108 after 23 plies, Black (Pikafish) to move, as Black saw
// it. It turned the piece on d10 over to e9 and was mated on f10 by the chariot on
// f9; the fixed bot plays h10-g8. pikafish-reveal-bug-thumbnail.test.ts asserts
// both moves are legal here.
export const REVEAL_BUG_FEN =
  'xxxxkxxxx/5R3/9/2x1x3x/6a2/2P1P1A1B/X5r2/4P1C2/3A1K3/c2b1X2X b R1C1B1r1a1c1p5n2b1 3 12';

// 16:10 to match the card media box (.articles-index-card-media, 16/10).
const THUMB_ASPECT = 16 / 10;

const REVEAL_BUG_THUMBNAIL = (): string => {
  const parsed = parseJieqiFen(REVEAL_BUG_FEN);
  if (!parsed.ok) throw new Error(`pikafish-reveal-bug thumbnail: ${parsed.error}`);
  const board: XiangqiPlayerView['board'] = {};
  for (const [square, piece] of Object.entries(parsed.state.board)) {
    if (!piece) continue;
    board[square as XiangqiSquare] = {
      piece: { color: piece.color, role: piece.role },
      shrouded: piece.faceDown,
    };
  }
  const boardY = 28; // xqBoardSvg draws the grid 28 below its y, under the title row.
  // Black's camp from Black's side: ranks 10 (bottom) up to 5.
  const top = xqPoint(4, 5, 'black', 0, boardY).y - XQ_CELL * 0.5;
  const bottom = xqPoint(4, 10, 'black', 0, boardY).y + XQ_CELL * 0.8;
  const h = bottom - top;
  const w = h * THUMB_ASPECT;
  const left = xqPoint(4, 10, 'black', 0, boardY).x - w / 2;
  const svg = xqBoardSvg({
    state: xqVisionDemoState('pikafish-reveal-bug-thumb', {}),
    view: xqStaticView('pikafish-reveal-bug-thumb', board),
    x: 0,
    y: 0,
    label: '',
    perspective: 'black',
    shroudedStyle: 'back',
    arrows: [{ from: 'h10' as XiangqiSquare, to: 'g8' as XiangqiSquare }],
    dots: [{ square: 'e9' as XiangqiSquare, blocked: true }],
  });
  return `<svg class="xq-article-svg" viewBox="${left} ${top} ${w} ${h}" role="img" aria-label="Pikafish turns over the piece on d10 and moves it to e9, and is mated on f10; the fixed bot plays h10-g8" xmlns="http://www.w3.org/2000/svg"><rect class="xq-diagram-bg" x="${left}" y="${top}" width="${w}" height="${h}"/>${svg}</svg>`;
};

const FORK = 'https://github.com/brianhliou/pikafish-jieqi-wasm';
// The served commit before the fix, so the line links keep pointing at the bug.
const OLD = `${FORK}/blob/e75cee3a3698794b4b6f5574a8774f0575bc0c21/src`;
const FIX = `${FORK}/commit/bcc83f88ee18760e60903d1a3aaa61ef6f70f2c9`;

const OLD_PSEUDOCODE = `# Before (simplified)
for piece in pieces_it_could_be:
    # cut short, this returns the window's edge
    s = -search(position_with(piece), window)
    # set from a field nobody fills in
    if mover_is_black:
        s = -s
    scores.add(s, weight = count[piece])
v = weighted_average(scores)
# for Black, "min" was really the best
if v - min(scores) > MAX_SPREAD:
    v = min(scores)`;

const NEW_PSEUDOCODE = `# After
for piece in pieces_it_could_be:
    s = -search(position_with(piece), window)
    # only a bound: search again for the score
    if at_root and s <= window.low:
        s = -search(position_with(piece), no_lower_limit)
    scores.add(s, weight = count[piece])
v = weighted_average(scores)
if v - min(scores) > MAX_SPREAD:
    v = min(scores)`;

// One game position, ply = moves already played, with the mover about to choose.
function gameEmbed(roomId: string, ply: number, title: string): ArticleBlock {
  return {
    kind: 'embed',
    path: `/embed/game/${roomId}?ply=${ply}`,
    title,
    aspect: [702, 696],
  } as ArticleBlock;
}

export const pikafishRevealBugArticle: Article = {
  slug: 'pikafish-reveal-bug',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Our Pikafish jieqi bot misjudged its reveals',
  seoTitle: 'A bug in the Pikafish jieqi bot: how it misjudged turning over a piece',
  summary:
    'Our Pikafish jieqi bot rated some reveals far better than they were. Two bugs caused it. Both are fixed, at little or no cost in strength.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-03',
  thumbnail: { kind: 'svg', svg: REVEAL_BUG_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard, and people who build jieqi engines.',
  intro: [
    {
      kind: 'paragraph',
      text: 'In [jieqi](/rules/jieqi), turning over a face-down piece is a bet. You know which pieces it could be, and not which one it is. Our Pikafish bot, the engine behind Levels 1 to 8, priced some of those bets far too well. It would turn over a piece that gets mated for most of what it could be, and rate the move as winning.',
    },
    {
      kind: 'paragraph',
      text: 'We found it on October 2, while writing the [AB-JChess post](/blog/ab-jchess). The fix is live for every level and for the engine you can run on the analysis board.',
    },
  ],
  sections: [
    {
      heading: 'The bot averages a reveal over the pieces it could be',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When the bot considers a move that turns a piece over, it plays the move once for each piece the face-down one could be. It scores each, then averages the scores, weighted by how many of each piece are left. A reveal that wins if the piece is a chariot and gets mated if it is a soldier should score somewhere in between. Two bugs broke that average.',
        },
      ],
    },
    {
      heading: "For Black, the average took the best piece",
      blocks: [
        {
          kind: 'paragraph',
          text: 'Before averaging, the code turns every score to one player\'s point of view. It picked the player from a setting that was never filled in, so it always assumed Red. For Red\'s reveals that was right. For Black\'s, the scores were upside down, and a rule meant to take the worst outcome, when the outcomes spread far apart, took the best one.',
        },
        {
          kind: 'paragraph',
          text: 'That was the game the AB-JChess post first led with. Pikafish, as Black, turned over the piece on d10 and moved it to e9, rating the game nearly 19 pawns in its favour. Only an advisor on e9 stops the chariot\'s mate on f10, and an advisor was 1 of the 11 pieces it could have been. It was a chariot, and Black was mated next move.',
        },
        gameEmbed('jq_ab-jchess-vs-pikajieqi-4s-2026-09-108', 23, 'Jieqi: Pikafish, as Black, is about to reveal on d10'),
      ],
    },
    {
      heading: 'Scores the search cut short were averaged as exact',
      blocks: [
        {
          kind: 'paragraph',
          text: 'An engine saves time by giving up on a move once it knows the move is worse than the best one so far. It then returns a bound, which means "this much, or worse". That is safe when the next step is a comparison. The bot fed these bounds into the average as if they were exact scores, so a piece that gets mated could come back as "no better than +7" and count as +7.',
        },
        {
          kind: 'paragraph',
          text: 'In the first game of the AB-JChess post, the bot, as Red, turned over the piece on b3 and moved it to d3. Searched again with the old bot, the move rates more than eight pawns in Red\'s favour. Six times in ten that piece is a soldier or an elephant, and Black\'s cannon mates at once on h1. Averaged honestly, the move is worth about three pawns to Black. The fixed bot sees the mate and plays the advisor from e2 to f3, the move AB-JChess recommends.',
        },
        gameEmbed('jq_23d2a761-b37d-4bf0-a786-3ce7edf7e0fd', 26, 'Jieqi: the bot is about to reveal on b3'),
      ],
    },
    {
      heading: 'Where the bugs are in the code',
      blocks: [
        {
          kind: 'paragraph',
          text: `Both are in our copy of Pikafish's jieqi branch. Simplified, the old code scored a reveal like this:`,
        },
        { kind: 'code', language: 'python', text: OLD_PSEUDOCODE },
        {
          kind: 'paragraph',
          text: `The colour flip is in [misc.h, lines 360 to 366](${OLD}/misc.h#L360-L366), set from [search.cpp, line 1310](${OLD}/search.cpp#L1310) by asking whether the side to move is the "first side", a field [nothing ever assigns](${OLD}/position.h#L212). The window is the one at [search.cpp, line 1462](${OLD}/search.cpp#L1462): each piece is searched inside the window of the move above it, and a piece that gets mated comes back as the window's lower edge.`,
        },
        {
          kind: 'paragraph',
          text: 'We found the second one by printing every piece\'s score at a reveal. In one match game, three of the four pieces the bot could turn over were mated, and all three came back as exactly 738, the bottom of the window. The fourth scored 792. The bot averaged them to 745 and rated the move as winning.',
        },
        { kind: 'code', language: 'python', text: NEW_PSEUDOCODE },
        {
          kind: 'paragraph',
          text: `The colour flip is gone, and a piece whose score came back as a bound is searched again. The whole change is [one commit, 28 lines](${FIX}).`,
        },
      ],
    },
    {
      heading: 'The fixed bot rates reveals close to their worth, and plays about as well',
      blocks: [
        {
          kind: 'paragraph',
          text: "Of the 71 moves that decided Pikafish's losses in the AB-JChess match, the old bot rated 16 at least five pawns better than they were. The fixed bot rates 3. It plays about as well as the old one: in 200 games between them, it won 95 and lost 97.",
        },
        {
          kind: 'paragraph',
          text: 'The fix covers the move the bot is choosing. Deeper in its search the old averaging is still there, because fixing it everywhere made the bot about 150 Elo weaker.',
        },
      ],
    },
    {
      heading: 'AB-JChess has the second flaw, and it rarely matters',
      blocks: [
        {
          kind: 'paragraph',
          text: 'AB-JChess is built from Pikafish and averages reveals the same way. It has the cut-short flaw and not the colour one. Of the 60 reveals that decided its losses to our bot, it overrated 2.',
        },
      ],
    },
    {
      heading: 'A question about one move caught it',
      blocks: [
        {
          kind: 'paragraph',
          text: "The AB-JChess post first used game 108 to show how Pikafish judged a reveal. What caught the bug was asking why the bot would play d10-e9 at all. A correct search cannot find a mate in its own best line and still call the position winning. We took the examples out of that post the same day.",
        },
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Play the jieqi bot', href: '/bots', emphasis: 'primary' },
            { label: 'Jieqi rules', href: '/rules/jieqi', emphasis: 'secondary' },
          ],
        },
      ],
    },
  ],
};
