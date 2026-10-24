import type { XiangqiPlayerView } from '@mistboard/game';
import { parseJieqiFen, type XiangqiSquare } from '@mistboard/game';
import { xqHalfBoardThumbnailSvg, xqStaticView, xqVisionDemoState } from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

// The follow-up the AB-JChess post promised (#497). Numbers and positions:
// - game 108 (run7, AB-JChess vs PikaJieQi): ply 23, Black's d9e8 (d10-e9); in-game
//   +18.7 for Black with Red's mate in its own PV; only an advisor (1 of 11 in
//   Black's pool) guards f10; it was a chariot. Fixed build: d9e8 is mated, plays h9g7.
// - game jq_23d2a761 ply 26, Red's b2d2 (b3-d3): old build (e75cee3a, fresh, 4M nodes)
//   +8.6; pool-weighted value -3.0 (chariot 0.4 wins; soldier 0.4 and elephant 0.2
//   mated); fixed build plays e1f2 (e2-f3), AB-JChess's move.
// - 71 decisive moves (fresh, 2M nodes, 1 thread): over-rated by 5+ pawns 16 -> 3;
//   30 controls (moves from games Pikafish won) 0 -> 0. Self-play vs e75cee3a,
//   1M nodes/move: colour fix alone
//   95-95-10 (200); everywhere re-search -150 Elo (128 games); shipped root-only
//   264-300-36 (600), -21 Elo [-48, +6]; at 4M nodes/move 95-97-8 (200), -3 [-51, +44]
//   (the post quotes both).
// - AB-JChess: worst move in each of its 136 run7 losses, 60 reveals, 2 over-rated by
//   15+ win points. Rigs: mistboard-engine lab, issue #497.

// Card art: match game 108 after 24 plies, the moment the bet lost, as Black's
// half of the board seen from Black's side. Pikafish (Black) moved the face-down piece on d10 up to e9, needing an advisor there to
// guard f10; it turned over a chariot, and Red's chariot on f9 mates on f10.
// pikafish-reveal-bug-thumbnail.test.ts asserts the position and the mate.
export const REVEAL_BUG_FEN =
  'xxx1kxxxx/4rR3/9/2x1x3x/6a2/2P1P1A1B/X5r2/4P1C2/3A1K3/c2b1X2X w R1C1B1a1c1p5n2b1 4 13';

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
  return xqHalfBoardThumbnailSvg({
    state: xqVisionDemoState('pikafish-reveal-bug-thumb', {}),
    view: xqStaticView('pikafish-reveal-bug-thumb', board),
    half: 'bottom',
    perspective: 'black',
    shroudedStyle: 'back',
    arrows: [
      { from: 'd10' as XiangqiSquare, to: 'e9' as XiangqiSquare },
      { from: 'f9' as XiangqiSquare, to: 'f10' as XiangqiSquare },
    ],
    ariaLabel:
      "Pikafish moves the face-down piece on d10 up to e9 and turns over a chariot, not the advisor it needed; Red's chariot mates on f10",
  });
};

const FORK = 'https://github.com/brianhliou/pikafish-jieqi-wasm';
// The served commit before the fix, so the line links keep pointing at the bug.
const OLD = `${FORK}/blob/e75cee3a3698794b4b6f5574a8774f0575bc0c21/src`;
const FIX = `${FORK}/commit/bcc83f88ee18760e60903d1a3aaa61ef6f70f2c9`;

const OLD_PSEUDOCODE = `# Before (simplified)
for piece in pieces_it_could_be:
    # bug two: cut short, this returns the window's edge
    s = -search(position_with(piece), window)
    # bug one: set from a field nobody fills in
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
    # bug two fixed: only a bound, search again
    if at_root and s <= window.low:
        s = -search(position_with(piece), no_lower_limit)
    scores.add(s, weight = count[piece])
v = weighted_average(scores)
if v - min(scores) > MAX_SPREAD:
    v = min(scores)`;

// The September audit's two ways of pricing a reveal, in the vocabulary of
// the pseudocode above (weighted_average, count[piece], MAX_SPREAD).
const AUDIT_FORMULAS = `# Shipped: inside the search, each time a move turns over a piece
v = weighted_average(s[piece], weight = count[piece])
if v - min(s) > MAX_SPREAD:
    v = min(s)              # fall back to the worst case

# Replacement: at the root, when the top move is a reveal
for move in top_four_moves:
    v[move] = average(win[move][piece] for piece in pieces_it_could_be)
play(argmax(v))`;

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
  topic: 'engineering',
  title: 'Our Pikafish jieqi bot misjudged its reveals',
  cardTitle: 'Pikafish misjudged its reveals',
  seoTitle: 'A bug in the Pikafish jieqi bot: how it misjudged turning over a piece',
  summary:
    'Our Pikafish jieqi bot rated some reveals far better than they were. Two bugs caused it. Both are fixed, at little or no cost in strength.',
  showSummaryOnPage: false,
  status: 'published',
  publishedAt: '2026-10-03',
  updatedAt: '2026-10-16',
  updateNote:
    'Retold in order, with the match results in one table; the 7x row now reads as within noise rather than a loss.',
  thumbnail: { kind: 'svg', svg: REVEAL_BUG_THUMBNAIL },
  boardFamily: 'xiangqi',
  audience: 'People who play jieqi against the bot on Mistboard, and people who build jieqi engines.',
  intro: [
    {
      kind: 'paragraph',
      text: "In [jieqi](/rules/jieqi), turning over a face-down piece is a bet. You know which pieces it could be, and not which one it is. Our Pikafish bot, the engine behind Levels 1 to 8, would turn over a piece that gets mated for most of what it could be and rate the move as winning. We caught it while writing the [AB-JChess post](/blog/ab-jchess). Its reveal scoring had two separate bugs: for Black's reveals the scores were upside down, and for both colours a score the search had cut short was averaged as if it were exact. Both are fixed for every level and for the engine you can run on the analysis board.",
    },
    {
      kind: 'table',
      headers: ['Bug', 'Whose reveals', 'What went wrong', 'Shown by'],
      rows: [
        ['One: colour flip', 'Black’s', 'Scores upside down, so the worst-case rule took the best piece', 'Game 108, d10'],
        ['Two: cut-short scores', 'Both', 'Bounds averaged as exact scores', 'The b3 reveal'],
      ],
      keyColumn: true,
      compact: true,
      wrap: true,
    },
  ],
  sections: [
    {
      heading: 'The bot called a move winning with a mate in its own line',
      blocks: [
        {
          kind: 'paragraph',
          text: 'On October 2 we had game 108 of the AB-JChess match open, to show how Pikafish judged a reveal. Pikafish, as Black, turned over the piece on d10 and moved it to e9, and rated the position 18.7 pawns in its favour. Its own best line had Red mating. A correct search cannot find a mate in its own best line and still call the position winning.',
        },
        gameEmbed('jq_ab-jchess-vs-pikajieqi-4s-2026-09-108', 23, 'Jieqi: Pikafish, as Black, is about to reveal on d10'),
        {
          kind: 'paragraph',
          text: "Only an advisor on e9 stops the chariot's mate on f10, and an advisor was 1 of the 11 pieces it could have been. It was a chariot, and Black was mated next move. We took the examples out of that post the same day. This move led us to bug one, and looking further turned up bug two.",
        },
      ],
    },
    {
      heading: 'Bug one: for Black, the average took the best piece',
      blocks: [
        {
          kind: 'paragraph',
          text: 'When the bot considers a move that turns a piece over, it plays the move once for each piece the face-down one could be. It scores each, then averages the scores, weighted by how many of each piece are left. A reveal that wins if the piece is a chariot and gets mated if it is a soldier should score somewhere in between. Two bugs broke that average.',
        },
        {
          kind: 'paragraph',
          text: 'Before averaging, the code turns every score to one player\'s point of view. It picked the player from a setting that was never filled in, so it always assumed Red. For Red\'s reveals that was right. For Black\'s, the scores were upside down, and a rule meant to take the worst outcome, when the outcomes spread far apart, took the best one.',
        },
        {
          kind: 'paragraph',
          text: `The flip is in [misc.h, lines 360 to 366](${OLD}/misc.h#L360-L366), set from [search.cpp, line 1310](${OLD}/search.cpp#L1310) by asking whether the side to move is the "first side", a field [nothing ever assigns](${OLD}/position.h#L212). Game 108 was a Black reveal, so its scores went through the flip.`,
        },
      ],
    },
    {
      heading: 'Bug two: cut-short scores were averaged as exact',
      blocks: [
        {
          kind: 'paragraph',
          text: 'We printed the score of every piece the bot could turn over at a reveal. In one match game, three of the four were mated:',
        },
        {
          kind: 'table',
          headers: ['Searched as', 'Search score'],
          rows: [
            ['Piece 1, mated', '738'],
            ['Piece 2, mated', '738'],
            ['Piece 3, mated', '738'],
            ['Piece 4', '792'],
            ['Averaged', '745'],
          ],
          keyColumn: true,
          compact: true,
          highlightRows: [4],
          caption:
            '738 is the lower edge of the search window. Each mated piece came back as that edge, and the bot averaged it as a real score.',
        },
        {
          kind: 'paragraph',
          text: `An engine saves time by giving up on a move once it knows the move is worse than the best one so far. It then returns a bound, which means "this much, or worse". That is safe when the next step is a comparison. The bot fed these bounds into the average as if they were exact scores, and rated a move that gets mated for three of its four pieces as winning. Each piece is searched inside the window of the move above it, at [search.cpp, line 1462](${OLD}/search.cpp#L1462).`,
        },
        {
          kind: 'paragraph',
          text: 'Bug two is independent of bug one: it hits both colours, and AB-JChess has it without bug one.',
        },
        {
          kind: 'paragraph',
          text: "Bug two alone hid a mate in the first game of the AB-JChess post. The bot, as Red, turned over the piece on b3 and moved it to d3. If that piece is a soldier or an elephant, Black's cannon mates at once on h1.",
        },
        gameEmbed('jq_23d2a761-b37d-4bf0-a786-3ce7edf7e0fd', 26, 'Jieqi: the bot is about to reveal on b3'),
        {
          kind: 'table',
          headers: ['If b3 is', 'Share', 'For Red'],
          rows: [
            ['A chariot', '0.4', 'Wins'],
            ['A soldier', '0.4', 'Mated'],
            ['An elephant', '0.2', 'Mated'],
            ['Old bot’s rating', '', '+8.6'],
            ['Weighted by share', '', 'About −3.0'],
          ],
          keyColumn: true,
          compact: true,
          highlightRows: [4],
          caption:
            'Share is that piece’s part of what b3 could be, by count. Ratings are in pawns for Red, from a fresh search with the old bot.',
        },
        {
          kind: 'paragraph',
          text: 'Weighted honestly, Black is better. The fixed bot sees the mate and plays the advisor from e2 to f3, the move AB-JChess recommends.',
        },
      ],
    },
    {
      heading: 'The fix drops the flip and searches a cut-short piece again',
      blocks: [
        {
          kind: 'paragraph',
          text: `Both are in our copy of Pikafish's jieqi branch. Simplified, the old code scored a reveal like this:`,
        },
        { kind: 'code', language: 'python', text: OLD_PSEUDOCODE },
        { kind: 'code', language: 'python', text: NEW_PSEUDOCODE },
        {
          kind: 'paragraph',
          text: `Deleting the colour flip fixes bug one. Searching again any piece whose score came back as a bound fixes bug two. Both are in [one commit, 28 lines](${FIX}).`,
        },
      ],
    },
    {
      heading: 'The fixed bot rates reveals close to their worth, and plays about as well',
      blocks: [
        {
          kind: 'paragraph',
          text: "We searched the 71 moves that decided Pikafish's losses in the AB-JChess match again with both bots, then played the fixed bot against the old one.",
        },
        {
          kind: 'table',
          headers: ['Moves', 'Count', 'Old bot', 'Fixed bot'],
          rows: [
            ['Decided a loss', '71', '16', '3'],
            ['Controls', '30', '0', '0'],
          ],
          keyColumn: true,
          compact: true,
          caption:
            'How many moves each bot rated at least five pawns better than they were, searched fresh at 2M nodes on one thread. Controls are 30 moves from games Pikafish won.',
        },
        {
          kind: 'table',
          headers: ['Fixed bot', 'Games', 'W-L-D', 'Elo'],
          rows: [
            ['Colour fix only', '200', '95-95-10', ''],
            ['Shipped: colour fix, root re-search', '600', '264-300-36', '−21 [−48, +6]'],
            ['Shipped, at 4M nodes a move', '200', '95-97-8', '−3 [−51, +44]'],
            ['Re-search everywhere', '128', '', 'About −150'],
          ],
          keyColumn: true,
          compact: true,
          highlightRows: [1],
          caption:
            'The fixed bot against the old one, at 1M nodes a move unless noted. W-L-D is the fixed bot’s; the brackets are the Elo interval.',
        },
        {
          kind: 'paragraph',
          text: 'The fixed bot rates reveals close to their worth, and its strength is unchanged within the noise, perhaps slightly weaker: both intervals include zero. The fix for bug two covers only the move the bot is choosing. Deeper in its search the old averaging is still there, because re-searching everywhere cost about 150 Elo.',
        },
      ],
    },
    {
      heading: 'AB-JChess has bug two, and it rarely matters',
      blocks: [
        {
          kind: 'paragraph',
          text: 'AB-JChess is built from Pikafish and averages reveals the same way, so it has bug two. Of the 60 reveals that decided its losses to our bot, it overrated 2.',
        },
      ],
    },
    {
      // Folded in from the brianhliou.com post of 2026-09-22 ("Testing an Audit
      // of the Jieqi Engine"), which 301s here, keeping its October 7 correction.
      // The post put a 200-game match at "roughly ± 25 Elo"; ±0.07 around 0.5 is
      // about ±50 Elo, corrected here. The table's margins are 1.96 standard
      // errors of the per-game score (wins, draws and losses as given): the post
      // printed ±0.068 and ±0.067 for the 200-game rows; ±0.087 and ±0.126 for
      // the 100- and 50-game rows were derived the same way on 2026-10-16.
      heading: "Why a September test of this averaging doesn't stand",
      blocks: [
        {
          kind: 'paragraph',
          text: "In September we tested replacing this averaging with a separate search for each piece, and kept the averaging. That test ran with bug one in place, so for Black the worst-case fallback it credited was taking the best case, and its verdict doesn't stand.",
        },
        {
          kind: 'paragraph',
          text: 'The idea came from an outside review of the engine’s source, [iwestlin/jieqi-ai](https://github.com/iwestlin/jieqi-ai). In July the averaging had chosen a reveal with a true 64% chance of winning over a safe move at 97%. Each test played the changed engine against the shipped one, colours alternating, with a referee dealing the hidden pieces so neither engine saw one.',
        },
        {
          kind: 'code',
          language: 'python',
          text: AUDIT_FORMULAS,
          caption:
            'piece: each piece the hidden one could be. s[piece]: the search score if it is that piece. count[piece]: how many of that piece are still face down. MAX_SPREAD: how far the average may sit above the worst case. win[move][piece]: the winning chance from a separate search.',
        },
        {
          kind: 'table',
          headers: ['Change', 'Games', 'W-L-D', 'Score', '95% margin', 'Time'],
          rows: [
            ['Separate searches', '100', '30-56-14', '0.370', '±0.09', '2.2×'],
            ['Separate searches, longer', '50', '17-26-7', '0.410', '±0.13', '7.0×'],
            ['Evaluation bug fixed', '200', '91-101-8', '0.475', '±0.07', '1.0×'],
            ['Evaluation bug fixed and retuned', '200', '96-93-11', '0.507', '±0.07', '1.0×'],
          ],
          keyColumn: true,
          compact: true,
          highlightRows: [0],
          caption:
            'Score is the changed engine’s against the shipped one, a draw counting half, so 0.500 is no change. Time is a multiple of the shipped engine’s.',
        },
        {
          kind: 'paragraph',
          text: 'The separate searches lost clearly at 2.2 times the time, and at 7 times they still scored below even. Since then [AB-JChess](/blog/ab-jchess) has beaten this engine 248-136-16 over 400 games and is now the top jieqi bot.',
        },
        {
          kind: 'paragraph',
          text: 'The last two rows are a separate bug, unrelated to the averaging: the same review found that one colour’s face-down pieces were never counted in the evaluation. We fixed it then and retuned the 43 terms it touches over 10,000 SPSA game pairs. Neither change left its margin: at 200 games ±0.07 is roughly ±50 Elo.',
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
