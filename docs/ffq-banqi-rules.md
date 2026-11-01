# FFQ banqi (翻翻棋) rules kernel

Rules as implemented by Huorongrong (mistboard#800), from the specification
recorded on 2026-11-01. This is an independent implementation of that rules
specification. No source-engine code was copied. Tencent's 天天象棋 live app
has not been checked against this kernel.

The game package supplies the kernel, public projections, tests and canonical
`FFQ_BANQI_SPEC_ID` (`ffq-banqi`). Its metadata names the 4x8 board
(`banqi-4x8`), FFQ movement (`ffq-banqi`), HP objective (`hp-depletion`) and
fixed-seat, four-reveal setup (`ffq-banqi-deal`). It remains `publicSurface:
'hidden'` and `runtimeStatus: 'future'` until a serving tenant exists.

Canonical `gameSpecId` and legacy `variant` room requests both return 501
`ffq_banqi_not_integrated`, never a fallback Fog Chess room. There is no tenant,
route or launch flag. Ratings, correspondence and studies exclude FFQ; the
export capability is explicitly empty (no PGN or JSON). Existing web metadata
placeholders offer no public play, marker, rules page, analysis or embed.

## Rules

1. **Board:** four files by eight ranks, 32 squares. Coordinates have x=0..3,
   y=0..7; square index is `y*4+x`. Orthogonal steps never wrap a row.
2. **Pieces:** each ink has one general, two advisors, two elephants, two
   chariots, two horses, two cannons and five soldiers. The kernel reuses
   standard banqi piece types, counts and shuffling.
3. **Setup:** shuffle all 32 pieces. Squares **6, 15, 16, 25** open face up,
   with whichever ink and role was dealt there; all others start face down.
   Both sides see a remaining-piece pool. Neither learns which identity is
   under any individual covered tile.
4. **Seats:** the first mover owns Red, the second Black. No opening flip binds
   a seat to an ink; a player can move a revealed own piece on the first turn.
5. **HP:** both sides start at **60**. A captured piece's **owner** loses HP:

   | Soldier | Cannon | Horse | Chariot | Elephant | Advisor | General |
   | --- | --- | --- | --- | --- | --- | --- |
   | 2 | 5 | 5 | 5 | 5 | 10 | 30 |

   A full side totals 100 damage. HP is clamped at zero. Zero HP loses;
   simultaneous zero HP draws, although a single capture damages only one side.
6. **Turn:** one of these actions:
   - Flip any covered piece, of either ink (`from === to`).
   - Move an own revealed **non-cannon** one orthogonal step to an empty square.
   - Capture an adjacent **revealed enemy** with a non-cannon. Rank order is
     general > advisor > elephant > chariot > horse > cannon > soldier. Equal
     or lower rank is capturable, except a general cannot take a soldier, and
     a soldier takes only soldiers and generals. Non-cannons cannot take a
     covered tile. There is no check, royal-general safety, palace or river.
   - A cannon **only captures**; it has **no quiet move**. Along a file or rank,
     jump exactly one occupied screen, of any ink and either face orientation.
     The first occupied square after that screen must be a revealed enemy of
     any rank or a covered piece of **either ink**. Stop at that victim: no
     skipping another piece. A covered victim is revealed to both seats and
     observers; taking a covered own piece damages the mover's own HP and can
     lose the game.
7. **No progress:** 30 consecutive plies without a flip or capture draw. Either
   action resets the clock, including a cannon's friendly covered capture.
8. **Long chase (长捉):** a quiet step chases if the moved piece then attacks
   at least one adjacent revealed enemy that it could capture. Covered targets
   do not count. Cannons never chase because they have no quiet move. A side's
   first chase counts as one; the fourth is legal, the fifth consecutive chase
   is illegal. Multiple targets still count as one chase; targets may change.
   A flip or capture by **either** side resets **both** counters. A non-chase
   quiet move resets only its mover's counter. The opponent's quiet turn does
   not interrupt the mover's streak. There is no only-legal-move exception.
9. **No legal move:** the side to move loses. Settlement order is HP, then the
   no-progress draw, then no-legal-move loss. Thus an HP result wins precedence
   over the draw clock, and a position at 30 plies draws even if immobile.

## Hidden-information boundary

Canonical state contains true covered identities and is **server-secret**, even
after game end. Only `getFFQBanqiPlayerView` and `ffqBanqiStateToFen` may cross a
player/engine boundary. No seed or exact-deal field is retained in either.
The seeded helper is for tests/replay; a future live adapter must supply a
secret crypto-backed RNG and persist the initial deal with the action history.

A board back serializes to exactly `{ faceDown: true }`, without ink or role.
Legality and chase detection depend only on public occupancy and face-up pieces.
Every off-board capture's ink and exact role are **public to both seats and
observers**, whether captured face up or covered, live or finished. This is an
explicit FFQ exception to Mistboard's capturer-only covered-capture policy:
public HP damage already identifies the ink and, unless clamped at zero,
distinguishes generals (30), advisors (10) and soldiers (2); five-damage victims
are now also identified.
The former capturer-only tests guarded a disclosure choice, not a movement or
settlement invariant. Making the removed victim public changes neither legal
moves nor HP. `wasFaceDown` records how it was captured; it never keeps an
off-board role private. Covered pieces **still on the board remain masked**,
including after an HP-ending friendly capture or any other game end.

Pools are calculated from the initial multiset minus revealed on-board pieces
and **all captures**, never from the truth under the remaining backs. Both seats
and observers therefore see the same pool, whose counts equal the remaining
covered on-board multiset without assigning identities to squares.
`unknownCaptured` is retained in the view for snapshot compatibility and is
always `{ red: 0, black: 0 }`.

The public FEN is an **observer snapshot**, not a save/import format:

```text
<board> <turn> <redHP> <blackHP> <clock> <redChases> <blackChases> <fullmove> <pool> <redUnknownCaptured> <blackUnknownCaptured>
```

Ranks run y=7 to y=0, files x=0 to x=3. `X` is a back, upper/lowercase
`G A E R H C S` denotes revealed red/black pieces, and digits collapse empty
runs. Turn is `r` or `b`. Pool pairs are letter+count in descending rank order,
red then black; `-` means empty. Public covered captures are subtracted from the
pool, so different captured roles may produce different pool fields even when
their damage is identical. The final two fields remain `0 0`, preserving the
11-field format with no privately captured identities. Permuting identities
under **on-board** backs leaves the **entire FEN and serialized views** unchanged,
live and finished. There is deliberately no dealt suffix or parser: canonical
replay requires the secret initial deal and moves.
This FFQ-specific dialect does not claim compatibility with an external engine.

## Unverified against Tencent's live app

Check these two first: **cannons have no quiet move**, and **cannons can capture
their own covered pieces**. Those are intentional kernel rules, with dedicated
tests; do not replace them with standard banqi movement by assumption.

The remaining setup, damage table, 30-ply threshold, exact chase definition and
resets, result precedence, and covered-capture/pool disclosure also need a live
app comparison. The supplied rules govern this implementation until that
comparison is available. `FFQ_BANQI_RULES` records the choices in one object.

Tests mirror the source self-test names `flip_reset` and `chase4_forbid5`, cover
each numbered rule, serialize full player/observer projections, and play 2,000
seeded random games to legal terminal outcomes, checking capture disclosure and
exact remaining pools for both seats and observers at every ply.

Disclosure regression check (2026-11-01): deliberately adding `color` and `role`
to a covered board entry caused **hidden permutations preserve complete
player/observer payloads and legality, even after game end** to fail. Restoring
the exact `{ faceDown: true }` projection made it pass. This sentinel checks
the whole serialized view after a covered capture, across all result reasons.
