import type { Article, ArticleBlock } from '../types.js';

// Moved from the brianhliou.com post of 2026-08-31 (/posts/jungle-den-term/,
// "Testing a Den-Race Term in a Jungle Engine") on 2026-10-16. Its 10-07 fold-in
// into katago-jungle is cut back to a paragraph that links here. Structure and
// argument unchanged; what changed, beyond "I" becoming "we" and site links
// made relative:
// - The deficit table (0, 0, 0, 0, 2, 2, 2, 4 plies over 8 races) has a median
//   of 1 ply, not the "median of two plies" the post's prose, TL;DR and
//   description said (the fold-in's correction).
// - Races are won by a side "level or behind" ten plies out, as the post's own
//   table defined them, not "behind" (the fold-in's wording).
// - The tiger rule changed on 21 September (the fold-in's date).
// - The move list carries the study's ply numbers, 41 to 44, replayed from
//   chapter uL9YJyMn: the post numbered the elephant's step 41, which is
//   Red's ply (the tiger stepping back to d5).
// - The position image is the study embed at the same ply; its FEN matches the
//   post's analysis link.
// - The base-rate table's race row is a subset of den entries (the four shares
//   summed to 104.7%), so it reads "of which".

const STUDY_ID = '4UhOMlsE';
const GAME_10 = 'uL9YJyMn';
const POSITION_FEN = '6l/1tc2d1/3ep2/3T3/7/1R2r2/1PL1W2/3DCE1/7 b 0 20';

function p(text: string): ArticleBlock {
  return { kind: 'paragraph', text };
}

const EVAL_LOOP = `for idx in 0..N {
    let v = VAL[role_of(code) as usize];
    let friendly = color_of(code) == me;
    s += if friendly { 2 * v } else { -2 * v };

    // Advancement toward the relevant den: the enemy's for our pieces, ours for theirs.
    let target = if friendly { enemy_den } else { own_den };
    let dist = manhattan(idx as u8, target);
    let advance = if dist <= 1 { 400 } else { (16 - dist) * 3 };
    s += if friendly { advance } else { -advance };
}`;

const RACE_TERM = `for side in [me, 1 - me] {
    // Nearest enemy runner to this side's den, and this side's nearest defender
    // to its own trap ring.
    let (mut att, mut def) = (99, 99);
    for idx in 0..N { /* ...scan once... */ }

    if att > RACE_RADIUS { continue; }   // no race here: contribute nothing

    // The side to move gets one free step in the race for its own den.
    let margin = att - def + i32::from(side == me);
    let pen = if margin <= 0 { RACE_LOST }
              else if margin == 1 { RACE_TIGHT }
              else { 0 };
    score += if side == me { -pen } else { pen };
}`;

const MOVE_LIST = `41  Red   tiger     d6 -> d5    its only move, back down the corridor
42  Blue  elephant  d7 -> d6    steps into the corridor after the tiger
43  Red   lion      c3 -> c7    jumps into the square the elephant just left
44  Blue  elephant  d6 -> d5    takes the tiger, up a piece
    Red's lion is now three moves from a den Blue cannot defend`;

export const jungleDenTermArticle: Article = {
  slug: 'jungle-den-term',
  kind: 'article',
  publisher: 'mistboard',
  title: 'Teaching our Jungle Chess engine the den race bought nothing',
  cardTitle: 'Teaching Misty the den race',
  seoTitle: 'Dou Shou Qi Engine: Does a Den-Race Term Help?',
  summary:
    'Misty, our Jungle Chess engine, has no idea of a den race. Three ways to teach it one came back null or negative: races decide 4.7% of games at full strength, and a 12 times deeper search sees the loss a median of one ply sooner.',
  showSummaryOnPage: false,
  status: 'published',
  method: [
    'Base rate from 172 self-play games at the production budget of five million nodes a move.',
    'Headroom: in each of the 8 den races, the earliest ply at which five and sixty million nodes see the forced loss.',
    'The search extension tested as a harness policy that gives one side more nodes near an enemy den, 300 colour-swapped pairs per arm, with and without a fixed node budget.',
  ],
  publishedAt: '2026-08-31',
  updatedAt: '2026-10-16',
  updateNote:
    'Back as its own page, with the deeper-search deficit median corrected to 1 ply and the race shares restated.',
  thumbnail: {
    kind: 'image',
    src: '/article-thumbs/jungle-den-term/thumbnail.png',
    alt: 'A Jungle Chess board: Red’s tiger alone on the d-file between the two lakes, Blue’s elephant directly above it.',
  },
  audience:
    'Engine builders and Jungle Chess players curious whether an engine needs to be taught den races, and how to measure a search change without measuring its budget.',
  readNext: ['katago-jungle', 'dou-shou-qi-engine'],
  tldr: [
    'Misty, Mistboard’s Jungle Chess engine, has no idea of a den race, so we tried three ways to teach it one. All three came back null or negative.',
    'Den races decide only 4.7% of games at full strength (a weak-search test said 22%), and searching 12 times deeper sees the loss a median of one ply sooner.',
    'A search extension near the dens looked like +45 Elo until we held the node budget fixed; then it was slightly negative. A dedicated den-race term was null.',
    'Hold the budget fixed or you are measuring the budget. Two constants from the same games, a draw clock and draw contempt, doubled the share of decisive games instead.',
  ],
  intro: [
    p(
      'Misty, Mistboard’s Jungle Chess engine, has no concept of a den race. It scores a position by material plus a per-piece bonus for advancing toward the enemy den, and never asks whether the runner heading for *its* den arrives first. It finds out when the search reaches the den, about twelve plies out.',
    ),
    p(
      'That looked like a clear gap, filed as an issue after a game where the bot shuffled a rat back and forth while an enemy rat walked in. In August we spent a day trying to close it. Three routes, all null or negative. This is what the measurements said and what we would keep from them.',
    ),
  ],
  sections: [
    {
      heading: 'What the engine already does',
      blocks: [
        p(
          'Worth separating, because it framed everything after. The engine understands the win condition completely: reaching the den is scored as mate, ordered first among candidate moves, and searched in quiescence. What it lacks is foresight, not comprehension.',
        ),
        p(
          'It wins anyway, because Jungle is material-dominated and the evaluation reads material exactly. At the moment of den entry the median winner is 20 points ahead, about one cat. Only 4.7% of games are won by a side that was level or behind. How the engine is built, and how it measured against other engines, is in [A Dou Shou Qi engine](/blog/dou-shou-qi-engine).',
        ),
      ],
    },
    {
      heading: 'What it plays without the concept',
      blocks: [
        p(
          'Game 10 of the study turns on four moves, and it settles the question better than any table below.',
        ),
        p(
          'Jungle’s middle is three ranks of water, and the d-file runs between the two lakes, one square wide. Under the rules Mistboard used when these games were played, tigers jumped water lengthwise only, never sideways, so a tiger standing in that corridor had almost nowhere to go. Since 21 September the tiger jumps sideways too, like the lion, following the Chinese rule sets; the corridor is no longer a trap for it, and the line below is a line from the old rule.',
        ),
        {
          kind: 'embed',
          path: `/embed/study/${STUDY_ID}/${GAME_10}?ply=39`,
          title: 'Game 10, move 20, Blue to play',
          caption:
            'Move 20, Blue to play. Red’s tiger has just taken a wolf on d6 and stands in the corridor, one square below Blue’s elephant, which outranks it.',
          aspect: [702, 780],
        },
        p(
          'On move 20 Red’s tiger on d5 had two legal moves, forward or back, both still in the corridor. It went forward and took the wolf, which cost Blue 40 points and parked the tiger next to Blue’s elephant.',
        ),
        p(
          'Blue’s elephant outranks a tiger, so this looks like a gift. Blue declined to take it at once, which is the move the issue asked us to explain. The engine’s reason is that the tiger could not escape: with the elephant on d7 the tiger’s only move was d5, and from d5 its only move was d4, walked down a one-lane corridor by a piece that beats it. Grabbing it costs a tempo to collect something already collected. Blue played a free improving move and took the tiger two moves later, on d5 instead of d6. Both lines reach identical material.',
        ),
        p('The four moves that decided the game, by ply:'),
        { kind: 'code', text: MOVE_LIST },
        p(
          'The tiger was bait. Not a sacrifice: it was nearly trapped anyway, and taking the wolf scored +10 against +6 for almost every alternative, a difference of four points rather than a plan. What it does on its way off the board is pull the one piece that outranks a lion down the d-file. At move 20 the lion jump scores **−195**, because c7 sits next to Blue’s elephant on d7. Two moves later the same jump wins, because the elephant left.',
        ),
        p('Blue ends the sequence 13 points ahead and loses.'),
        p(
          'Read the plan back and it sounds like the engine understood a den race. It did not. There is no den-race term anywhere in that evaluation, before or after this project. It searched five million nodes and the line came out. That is the whole result: the behaviour the issue wanted to install was already there, produced by depth rather than knowledge.',
        ),
      ],
    },
    {
      heading: 'Base rate: 4.7% of games, measured at full strength',
      blocks: [
        p('172 self-play games at the production budget of five million nodes a move.'),
        {
          kind: 'table',
          headers: ['Game ended by', 'Share'],
          rows: [
            ['Repetition draw', '52.9%'],
            ['Den entry', '26.2%'],
            ['of which a genuine race', '4.7%'],
            ['No-progress draw', '20.9%'],
          ],
          keyColumn: true,
          highlightRows: [2],
          caption:
            'A genuine race is a game won by a side that was level or behind ten plies before the end.',
        },
        p(
          'The same harness at 200k nodes reports 22% races. Weaker play inflates the number about fivefold. The cheap measurement was available, and it would have been wrong by 5× in the direction that justifies more work.',
        ),
      ],
    },
    {
      heading: 'Headroom: a 12× deeper search buys about one ply',
      blocks: [
        p(
          'For each of the 8 races we binary-searched the loser’s game for the earliest ply at which each budget recognises the forced loss, then took the gap.',
        ),
        {
          kind: 'table',
          headers: ['Seen sooner by 60M nodes', 'Races'],
          rows: [
            ['0 plies', '4'],
            ['2 plies', '3'],
            ['4 plies', '1'],
          ],
          keyColumn: true,
          caption: '60 million nodes a move against 5 million, over the 8 genuine races.',
        },
        p(
          'Sixty million nodes against five million, and the deeper search sees the loss a median of one ply earlier: at most four, and no earlier at all in half the races. Before that horizon the two track closely, diverging only in the last ply or two.',
        ),
        p(
          'This is the number that should have ended the project. If twelve times the search recovers about a ply, the information is not sitting there waiting for a cleverer evaluation to surface it.',
        ),
      ],
    },
    {
      heading: 'Route A: a search extension, free and paid',
      blocks: [
        p(
          'Probed without building it. A harness policy grants one side a larger node budget whenever a piece is within R squares of an enemy den, which is a strict upper bound on any real extension.',
        ),
        p('First finding, before any Elo: the trigger is not sparse.'),
        {
          kind: 'table',
          headers: ['Radius', 'Plies where it fires'],
          rows: [
            ['2', '23%'],
            ['3', '43%'],
            ['4', '72%'],
          ],
        },
        p(
          'Jungle’s board is small and dens sit on the back ranks. At R=4, the radius needed to see a race early, the extension is just “search twelve times more everywhere”, so the surgical framing was wrong from the start.',
        ),
        p('At R=2, 300 colour-swapped pairs per arm:'),
        {
          kind: 'table',
          headers: ['Arm', 'Elo', 'Nodes vs control'],
          rows: [
            ['12× depth near dens, granted free', '+45', '3.3×'],
            ['Budget-neutral: 3.7M base, 10M near dens', '−15', '1.04×'],
            ['Budget-neutral: 1.1M base, 20M near dens', '−12', '0.98×'],
          ],
          keyColumn: true,
        },
        p(
          'Same idea, same code, opposite sign. The engine’s five million nodes are fixed by how long a player will wait, so a real extension cannot conjure depth: it takes it from the rest of the search. The free arm measured the extra compute, nothing about dens.',
        ),
        p(
          'We ran the budget-neutral arm because +45 looked too good. Stopping there would have bought a week of work for a feature worth slightly less than zero.',
        ),
        p(
          'Both arms cost an afternoon, because neither required touching the engine. The extension was a harness policy that varies the node budget on a board condition. For any proposal of the form “make it smarter about X”, granting it free perfect X first is the cheapest way to find out whether X matters at all.',
        ),
      ],
    },
    {
      heading: 'Route B: the term itself',
      blocks: [
        p(
          'We built it anyway, because the extension failed for a reason that does not apply to an evaluation term. An extension costs nodes; a term costs almost nothing per leaf.',
        ),
        p(
          'Here is the evaluation as it stood. One loop over the board, and every piece contributes independently:',
        ),
        { kind: 'code', language: 'rust', text: EVAL_LOOP },
        p(
          'That advancement term is why the evaluation is blind to a race, and the reason is the symmetry. Our runner three squares from your den scores +39. Your runner three squares from ours scores −39. Both sides sprinting produces a number near zero, and the position reads quiet at exactly the moment it is most decided.',
        ),
        p(
          'So the term cannot be another per-piece bonus. It has to be one verdict per side, computed once, comparing the two runners against each other:',
        ),
        { kind: 'code', language: 'rust', text: RACE_TERM },
        p(
          'The defender is measured to the **trap ring**, not to the den. That is the right interception zone because a den’s three neighbours *are* its three traps, and a piece standing on a trap can be captured by any defender regardless of rank. An elephant walking into your den has to cross a square where your rat can take it.',
        ),
        p(
          'It changes the chosen move in 17% of the positions it was designed for, and costs about 17% wall clock at equal nodes. Over 300 colour-swapped pairs per weight, before charging that cost:',
        ),
        {
          kind: 'table',
          headers: ['Weight', 'Elo'],
          rows: [
            ['10', '−3'],
            ['25', '+9'],
          ],
        },
        p('Null, in the generous direction.'),
      ],
    },
    {
      heading: 'What we would keep',
      blocks: [
        p(
          'Hold the budget constant, or you are measuring the budget. The free version of an experiment is the convenient one to build and it hands you a confident positive number. Whatever the change would have to take from, take it, and see whether the result survives.',
        ),
        p(
          'That trap caught us twice in one day. A contempt sweep the same afternoon showed decisive games rising from 32% to 50%, which is what higher contempt produces by construction, since both sides in a self-play sweep get the setting. Only the two values facing each other could say whether it cost anything. It did not, so that one shipped.',
        ),
        p(
          'The evaluation gap was real and correctly diagnosed. It just had nothing behind it. Two constants found in the same games, a no-capture draw clock that was ending games early and a draw contempt near zero, took Jungle self-play from a quarter of games ending in a win to about half, and neither teaches the engine anything. The issue asked for understanding. Understanding was never the constraint.',
        ),
        p(
          'The games are public, and so is the position above. The analysis board runs the same engine, under today’s rule where the tiger can jump sideways out of the corridor, so if you think Blue should have taken the tiger you can make it play a line out.',
        ),
        {
          kind: 'cta',
          layout: 'single-row',
          buttons: [
            { label: 'Walk the 52 games', href: `/study/${STUDY_ID}`, emphasis: 'primary' },
            {
              label: 'Open the position',
              href: `/analysis/jungle?fen=${encodeURIComponent(POSITION_FEN)}`,
              emphasis: 'secondary',
            },
          ],
        },
      ],
    },
  ],
};
