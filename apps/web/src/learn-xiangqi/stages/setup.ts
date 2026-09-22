// Xiangqi Learn — Stage: board setup (lila setup.ts arc, xiangqi-ized).
// Each level starts with the formation partly assembled and the next pieces
// just off their home points; the player walks them home. The boards
// accumulate level over level, so by the capstone the full red starting
// position stands: chariots a1/i1, horses b1/h1, elephants c1/g1, advisors
// d1/f1, general e1, cannons b3/h3, soldiers a4 c4 e4 g4 i4.
// The accumulating board doubles as the maze: pieces already home block the
// straight-line walk, so every level has exactly one par route (stated in the
// comment above each level). Success asserts pin the walkers on their home
// points AND pin any already-placed piece that could be shuffled aside or
// substituted to fake completion (relaxed rules let the player move anything
// red). No apples and no scenario: proof is sampleSolution replay.
// detectCapture is off (nothing to capture; this stage is geography).

import { and, pieceOn } from '../learn-assert.js';
import { circle, type LearnLevelPartial } from '../learn-types.js';

const levels: LearnLevelPartial[] = [
  {
    // Chariot home. The horse on b1 seals the back rank, so the tempting
    // drop e5-e1 dead-ends. Unique par route: e5-a5, a5-a1 (2 moves).
    // Pins: the b1 horse (clearing it would open the back rank) and the i1
    // chariot (it could otherwise impersonate the walker on a1).
    goal: 'learn.xiangqi.setup.goal.chariot',
    fen: '9/9/9/9/9/4R4/9/9/9/1N5NR w',
    nbMoves: 2,
    shapes: [circle('a1', 'green')],
    success: and(
      pieceOn('red', 'chariot', 'a1'),
      pieceOn('red', 'chariot', 'i1'),
      pieceOn('red', 'horse', 'b1'),
    ),
    sampleSolution: 'e5a5 a5a1',
  },
  {
    // Cannons home. Both cannons are parked on the elephants' points, and the
    // one-step slide toward home (c1-b1, g1-h1) is blocked by the horses
    // already at their posts. Par route per cannon: rise two, then slide over
    // (c1-c3, c3-b3 and g1-g3, g3-h3; 4 moves). Pins: both horses, so the
    // player cannot clear b1/h1 to sneak along the back rank.
    goal: 'learn.xiangqi.setup.goal.cannon',
    fen: '9/9/9/9/9/9/9/9/9/RNC3CNR w',
    nbMoves: 4,
    success: and(
      pieceOn('red', 'cannon', 'b3'),
      pieceOn('red', 'cannon', 'h3'),
      pieceOn('red', 'horse', 'b1'),
      pieceOn('red', 'horse', 'h1'),
    ),
    sampleSolution: 'c1c3 c3b3 g1g3 g3h3',
  },
  {
    // Elephants home. i3 only connects to g1 and g5, so if the g5 elephant
    // grabs g1 first (the natural-looking hop), its partner is stranded.
    // Unique par assignment: i3-g1, then g5-e3, e3-c1 (3 moves). No pins
    // needed: no piece on the board can impersonate an elephant or shorten
    // the elephant graph.
    goal: 'learn.xiangqi.setup.goal.elephant',
    fen: '9/9/9/9/9/6B2/9/1C5CB/9/RN5NR w',
    nbMoves: 3,
    success: and(pieceOn('red', 'elephant', 'c1'), pieceOn('red', 'elephant', 'g1')),
    sampleSolution: 'i3g1 g5e3 e3c1',
  },
  {
    // Palace. The general squats on e2, which is the ONLY path the f3
    // advisor has toward f1 (advisors move one diagonal step; f3 connects
    // only to e2). Forced order: general steps down first. Unique par route:
    // e2-e1, f3-e2, e2-f1 (3 moves). Pin: the d1 advisor, or the player
    // could route IT to f1 and leave the f3 advisor stranded.
    goal: 'learn.xiangqi.setup.goal.palace',
    fen: '9/9/9/9/9/9/9/1C3A1C1/4K4/RNBA2BNR w',
    nbMoves: 3,
    success: and(
      pieceOn('red', 'general', 'e1'),
      pieceOn('red', 'advisor', 'f1'),
      pieceOn('red', 'advisor', 'd1'),
    ),
    sampleSolution: 'e2e1 f3e2 e2f1',
  },
  {
    // Capstone: three raiders come home through your own battle line.
    // - Chariot d10 to a1: the a-file is walled by the a4 soldier and rank 3
    //   is sealed by the b3 cannon, so the only par corridor is straight down
    //   the d-file and along rank 2 (d10-d2, d2-a2, a2-a1; 3 moves).
    // - Cannon h6 to h3: one clean drop (1 move); it also plugs the h-file
    //   so the chariot cannot detour through it.
    // - Elephant c5 to g1: a3 dead-ends (c1 is occupied), so it must cross
    //   the middle (c5-e3, e3-g1; 2 moves).
    // Par 6. Pins: the i1 chariot, b3 cannon, and c1 elephant, each of which
    // could otherwise slide or hop over to impersonate a walker.
    goal: 'learn.xiangqi.setup.goal.formation',
    fen: '3R5/9/9/9/7C1/2B6/P1P1P1P1P/1C7/9/1NBAKA1NR w',
    nbMoves: 6,
    success: and(
      pieceOn('red', 'chariot', 'a1'),
      pieceOn('red', 'cannon', 'h3'),
      pieceOn('red', 'elephant', 'g1'),
      pieceOn('red', 'chariot', 'i1'),
      pieceOn('red', 'cannon', 'b3'),
      pieceOn('red', 'elephant', 'c1'),
    ),
    sampleSolution: 'h6h3 c5e3 e3g1 d10d2 d2a2 a2a1',
  },
].map((level) => ({ rules: 'relaxed' as const, detectCapture: false, ...level }));

export const setupStage = {
  key: 'setup',
  title: 'learn.xiangqi.setup.title',
  subtitle: 'learn.xiangqi.setup.subtitle',
  intro: 'learn.xiangqi.setup.intro',
  complete: 'learn.xiangqi.setup.complete',
  illustration: { glyph: '布' },
  copy: {
    'learn.xiangqi.setup.title': 'Board setup',
    'learn.xiangqi.setup.subtitle': 'How the game begins',
    'learn.xiangqi.setup.intro':
      'Every xiangqi game starts from the same formation. Walk each piece to its home point, around the comrades already at their posts, and learn the battle line by heart.',
    'learn.xiangqi.setup.complete':
      'Congratulations! You know the starting position: chariots in the corners, cannons two points in front of the horses, and the general safe at the heart of his palace.',
    'learn.xiangqi.setup.goal.chariot':
      'Chariots anchor the corners. Home is a1, but the horse on b1 seals the back rank. Find another road in.',
    'learn.xiangqi.setup.goal.cannon':
      'Cannons sit two points in front of the horses, on b3 and h3. Yours are parked on the elephant points, and the horses block the direct slide. Lift each cannon up and over.',
    'learn.xiangqi.setup.goal.elephant':
      'Elephants guard from c1 and g1, hopping two points diagonally. Both want g1 first. Choose wisely, or one elephant strands the other.',
    'learn.xiangqi.setup.goal.palace':
      'The general lives on e1 with advisors at his shoulders. The palace is cramped: someone must step aside before the last advisor can slip home to f1.',
    'learn.xiangqi.setup.goal.formation':
      'Three raiders are still in the field: a chariot, a cannon, and an elephant. March them home through your own battle line to complete the formation!',
  },
  levels,
};
