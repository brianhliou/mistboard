# Gomoku tree review

`mountGomokuReview()` is the Gomoku presentation of the shared `mountTreeReview`
controller. It mounts a board, move tree, navigation, Rapfi panel and evaluation
gauge. It does not register a catalog entry, route, offering or finished-game
link. Callers must enforce Gomoku's existing access gate before mounting it.

```ts
import { mountGomokuReview } from './review/gomoku-review.js';

const review = mountGomokuReview(host, {
  reviewSurface: 'analysis',
  ariaLabel: 'Gomoku analysis', // Use translated caller copy.
  title: 'Gomoku',
  summary: '',
  moves: [{ to: 'a1' }, { to: 'b1' }],
  // opening: recordedOpening, // Omit for an empty-board game.
  analysis: null,
  urlPly: true, // Open at ?ply=N and remember navigation in the URL.
});

const tree = review.serialize();
review.destroy(); // Stops the worker and removes input/listener ownership.
```

The root is the recorded public opening, including its side to move. Tree ply
zero means zero recorded placements after that opening. The adapter replays each
placement through the existing rules kernel and projects the side to move's
legal moves; it never reconstructs a position by editing the displayed board.
Supply the same `opening` alongside an `initialTree` snapshot when reloading it.
A caller with a parsed root can instead pass the controller's `root` option.

First, previous, next and last controls, arrow keys, move-list jumps and side
lines use the shared move tree. A move played from a recorded position adds or
follows a child; an existing recorded continuation remains its first child.
The caller's `moves` array is not edited. Playing from the final position extends
the local tree; it never writes to the recorded game or server.

The board reuses `gomoku-board.ts` and its board-colour CSS variables. The
coordinate preference re-renders it. Coordinates stay a1 at bottom left, o15 at
top right; URL orientation, the flip key and flip controls cannot rotate it.
Black and White are the fixed first/second analysis slots, including the gauge
and optional player strips.

Local analysis starts off. A viewer's choice is stored in
`mistboard.review.gomoku.localEngine` in browser storage; unreadable or missing
storage means off. The controller restores it after setting the initial
position. Turning it off clears all engine drawing, including stored best-move
advice. The separate shared best-move-indicator preference still applies.

Every navigation clears the old engine drawing immediately and restarts analysis
at the current public position, using the existing Rapfi worker, command builder,
multi-PV parser and score conversion described in
[Gomoku browser ceval](gomoku-rapfi-ceval.md). Terminal positions display normally
and suppress search, including a 225-stone draw. Navigating back permits analysis
again. Existing translated panel, navigation and board labels are reused.

The top PV paints translucent numbered stones in alternating colours from the
current turn, with a ring on its best placement. The board validates placements
through the kernel, stopping at the first illegal placement or terminal five.
Overlays never change the board state, legal moves or exported tree, and cannot
intercept input. Secondary PVs stay in the three-line engine panel.

Regression coverage lives in `apps/web/src/review/gomoku-review.test.ts`:
recorded Rapfi output, off/late-output clearing, exact position reconstruction
and worker restart at ply k, buttons/keys, side-line round trips, persisted choice,
storage refusal, fixed orientation, coordinates, player inks, terminal draws,
legal PV prefixes and keyboard/read-only input.

```sh
npm run test:unit -w @mistboard/web -- src/review/gomoku-review.test.ts --maxWorkers=1
```
