// The move-level comments of the AB-JChess vs jqe study (scripts/variant-lab/
// ab-jchess-vs-jqe-study.ts writes them into each chapter). They carry what the
// post's prose used to: where the engines split and why, the reveals and face-down
// captures that swung the game, and the finish. The graph carries the numbers, so a
// comment never just restates one (Brian, 2026-11-03: the per-move percentages were
// "way too noisy in the move list").
//
// Keyed by game, then by ply: the comment sits on the position after that many plies,
// so `ply` = the marked move's ply is the position the post's board opens on. Every
// fact here is checked against the replays and the engines' lines in
// content/ab-jchess-vs-jqe.test.ts.

import { AB_JQE_MATCH } from './content/ab-jchess-vs-jqe.js';

const game = (key: string) => {
  const g = AB_JQE_MATCH.games.find((x) => x.key === key);
  if (!g) throw new Error(`ab-jchess-vs-jqe notes: ${key} is not in the match data`);
  return g;
};
/** A centipawn score as the review shows it, "-2.9". */
const score = (cp: number): string => (cp === 0 ? '0' : `${cp > 0 ? '+' : '-'}${(Math.abs(cp) / 100).toFixed(1)}`);

function finish(key: string): string {
  const g = game(key);
  if (g.winner === 'draw') return 'Drawn: the same position came up a third time.';
  const loser = g.winner === 'red' ? 'Black' : 'Red';
  return `${loser} has no legal move: ${g.winner === 'red' ? 'Red' : 'Black'} wins.`;
}

/** The study comments for one game, by ply (the position after that many plies). */
export function abJqeNotes(key: string): Record<number, string> {
  const g = game(key);
  const end = g.plies;
  switch (key) {
    case 'run2:115':
      return {
        162: 'Every piece is face up. jqe, with Red, pushes the soldier from d5 to d6 here; AB-JChess would bring the horse from e6 to c5 to take Black’s advisor on d3, giving the horse back for it.',
        163: 'AB-JChess now expects Black’s cannon to go to e10 and a soldier to come to e2, with the advisor on d3 joining in against Red’s general. jqe’s line brings the soldier to e2 too but no attack, and jqe calls the game level for three more moves.',
        180: 'Only now does jqe see Black winning too, eight of Red’s moves after the push.',
        [end]: finish(key),
      };
    case 'run2:22':
      return {
        44: 'Black’s chariot takes a face-down piece on g1, on Red’s back rank.',
        48: 'The chariot takes Red’s advisor on h1 too.',
        49: 'jqe, with Black, brings the chariot home from h1 to h7 here. AB-JChess would keep it in Red’s camp, moving it to g1, and in both engines’ lines for that Black’s cannon then wins Red’s horse on e2. Our reading is that jqe wanted it home because Red’s chariot on d9 and soldier on b9 were already deep in Black’s half.',
        69: 'Red turns over the piece on f1, a soldier, and both engines now call the game about even.',
        71: 'Red’s soldier on d9 takes a face-down piece on d10, and both engines now have Red winning.',
        [end]: finish(key),
      };
    case 'run1:8':
      return {
        12: 'Black’s soldier takes a face-down piece on b3, and both engines put Black well ahead.',
        27: 'Red’s cannon takes a face-down piece on g7, and both engines now have Red ahead.',
        29: 'jqe, with Black, moves the cannon from e4 to e6 here, starting a run of trades. AB-JChess would move the horse from d6 to f5: in its line Red’s horse takes the cannon on e4, an elephant takes it back, and Black’s horse goes on to take an elephant on h6.',
        35: 'The game has followed jqe’s line move for move: Black has taken an elephant and an advisor and given a soldier and its horse. jqe scored this line about the same as the horse move; AB-JChess scored it clearly worse for Black.',
        42: 'This is the third move in a row to turn a piece over, and here the two engines’ numbers meet: part of what jqe caught up on came from reveals both read the same way.',
        [end]: finish(key),
      };
    case 'run2:104':
      return {
        26: 'AB-JChess, with Red, moves the cannon from h6 to h9 here; jqe would turn over Red’s piece on h1 instead. Both engines expect Black to turn over d10 next, so the split is about how each values a board with many pieces still face down.',
        28: 'Black turns over d10, a soldier, and both engines’ numbers for Black fall.',
        37: 'Red turns over the piece on d1, a soldier, and both engines’ numbers for Black jump.',
        39: 'Red turns over the piece on c4, a chariot, taking a soldier on c5, where Black’s cannon can take it.',
        40: 'Black’s cannon takes the chariot, and from here both engines have Black winning.',
        [end]: finish(key),
      };
    case 'run1:157':
      return {
        76: 'jqe, with Red, moves the chariot from f3 to d3 here; AB-JChess would move the other chariot from a10 to f10 and trade chariots at once. The game follows jqe’s line move for move from here.',
        87: 'Red’s chariot takes a face-down piece on a7. Since the split Red has taken a horse and traded chariots, as jqe’s line planned; our reading is that jqe counted the material and AB-JChess the attack Red gave up for it.',
        99: 'Red turns over the piece on d1, a soldier, and AB-JChess now has Black well ahead.',
        107: 'From here Red’s chariot goes back and forth between f7 and f4, and Black’s elephant between c4 and e6.',
        [end]: `${finish(key)} AB-JChess had Black winning, but it was sent each position on its own and could not see the repetition coming.`,
      };
    case 'run1:54': {
      const c = g.chase!;
      const t = c.toggle.at(-1)!;
      const abj = t.abj.skyrule === t.abj.none ? `${score(t.abj.skyrule)} either way` : `${score(t.abj.skyrule)} with its rule and ${score(t.abj.none)} without`;
      return {
        100: 'AB-JChess, with Red, moves the chariot from c9 to c3 here, attacking Black’s horse on a3. jqe would move it to f9 and take the advisor on f7 next, while Black’s chariot runs down to d1.',
        101: 'From here Red’s chariot attacks the horse after every move it makes. jqe’s rule calls a side that chases on every move lost, so it scores Black far ahead; AB-JChess’s rule sees the horse chasing back and scores a draw.',
        [t.ply]: `Searched on its own with each chase rule on and off, jqe gives Red ${score(t.jqe.on)} with its rule and ${score(t.jqe.off)} without; AB-JChess gives ${abj}.`,
        [end]: `${finish(key)} Mistboard draws it too: a side loses a repetition only if it gave check on every move of it.`,
      };
    }
    default:
      throw new Error(`ab-jchess-vs-jqe notes: no notes for ${key}`);
  }
}
