# Mahjong table prototype

A playable Hong Kong mahjong table against three bots, running `@mistboard/mahjong`
entirely in the browser. **Not shipped and not wired into `apps/web`.** This is the
reference the real client gets ported from when the mahjong `GameSpecId` lands.

```
node prototype/build.mjs            # bundle the kernel next to the page
node prototype/build.mjs --inline   # also emit a single self-contained file
```

Then open `table.html` over HTTP (not `file://` — the module bundle needs a real
origin). `table.standalone.html` is what gets published as an artifact.

## What it demonstrates

- The full hand loop: deal, draw, discard, claim window, win or exhausted wall
- Claim resolution with priority, including the buttons a human sees for
  pung / chow / kong / win, and Pass
- The L2 efficiency bots in the other three seats
- Live analysis surfaced in play: how far your hand is from winning, what it is
  waiting on with live-tile counts, and an optional marker on the widest discard
- HK scoring at the end, with the faan breakdown and the settlement

## Things it gets right that are easy to get wrong

- **Bots receive a `PlayerView`, never the game.** They cannot read the wall or
  another seat's hand, and the same code moves to the server unchanged.
- **The drawn tile is held apart at the end of the hand**, not sorted into it.
  Sorting it in puts the divider wherever that tile happens to rank, which reads
  as a grouping that does not exist.
- **Only your own hand shows a shanten readout.** Showing one for an opponent
  would be reading their tiles.
- **The claim window says it is waiting on YOU** — the status line, the
  highlighted seat and the ringed tile all point at the decision. An earlier
  version left all three pointing at the discarder and read as a hang.

## Caveats

The HK scoring it displays is **unverified** — see
`docs-private/mahjong/hk-old-style.md` §8. The hand math (shanten, acceptance) is
proven against an independent implementation; the faan table is not.
