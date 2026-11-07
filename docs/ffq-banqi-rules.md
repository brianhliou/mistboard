# FFQ banqi (翻翻棋) rules kernel

Rules as implemented by Huorongrong (mistboard#800), from the specification
recorded on 2026-11-01. This is an independent implementation of that rules
specification. No source-engine code was copied. Tencent's 天天象棋 live app
has not been checked against this kernel.

The game package supplies the kernel, public projections, tests and canonical
`FFQ_BANQI_SPEC_ID` (`ffq-banqi`). Its metadata names the 4x8 board
(`banqi-4x8`), FFQ movement (`ffq-banqi`), HP objective (`hp-depletion`) and
fixed-seat, four-reveal setup (`ffq-banqi-deal`). Its metadata remains
`publicSurface: 'hidden'` and `runtimeStatus: 'future'`; the registered hidden
tenant explicitly handles its admin playtest, never a fallback Fog Chess room.

`MISTBOARD_FFQ_BANQI_ENABLED=true` opens server room creation, the canonical
`/room/ffq_…` HTML shell and seat/observer sockets **only to admin accounts**.
The flag defaults off, including in development; off means 404 for every HTTP
caller, and on still means 404 for guests and ordinary accounts. Successful
private reads and refusals carry `Cache-Control: no-store` and `noindex`.
Canonical `gameSpecId` and legacy `variant` creation selectors share the gate.

`VITE_FFQ_BANQI_ENABLED=true` opts the web build into the live renderer. It also
offers an admin-only **friend** setup, via the standard play picker or
`/?play=friend&gameSpecId=ffq-banqi&side=red`. The admin hint only controls that
entry's appearance; server authorization owns access. A cold room load needs
no stored hint. Bot and lobby setups exclude FFQ, and its fixed seats say
Red/Black. Ratings, correspondence and studies exclude FFQ; there is no public
listing, rules page, watch channel, analysis, embed, export or review route.
Live and finished games use the same masked room client.

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
The seeded helper is for tests/replay; the live adapter supplies a secret
crypto-backed RNG and persists the initial deal with the action history.

A board back serializes to exactly `{ faceDown: true }`, without ink or role.
Legality and chase detection depend only on public occupancy and face-up pieces.
A face-up capture's role is public. A covered capture's exact role is sent only
to its capturer, including after game end; other seats and observers receive
`role: null`. Public HP changes still disclose the victim's ink and damage
class (some damage values uniquely identify a role). Canonical HP and movement
rules are unchanged. Covered pieces still on the board remain masked.

Pools are calculated from the initial multiset minus revealed on-board pieces
and captures whose roles the recipient knows. Unknown covered captures remain
in that recipient's candidate pool, counted by ink in `unknownCaptured`.
Observers receive their own projection, never either player's private captures.

The public FEN is an **observer snapshot**, not a save/import format:

```text
<board> <turn> <redHP> <blackHP> <clock> <redChases> <blackChases> <fullmove> <pool> <redUnknownCaptured> <blackUnknownCaptured>
```

Ranks run y=7 to y=0, files x=0 to x=3. `X` is a back, upper/lowercase
`G A E R H C S` denotes revealed red/black pieces, and digits collapse empty
runs. Turn is `r` or `b`. Pool pairs are letter+count in descending rank order,
red then black; `-` means empty. Covered captures stay in the observer's pool;
the final two fields count their unknown roles by ink. Equal-damage covered
roles cannot be distinguished through the pool. Permuting identities under
on-board backs leaves the entire FEN and serialized views unchanged, live and
finished. There is deliberately no dealt suffix or parser: canonical replay
requires the secret initial deal and moves.
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

## Local hidden playtest verification (s-16f5)

Review the HTTP allowlist in `apps/server/src/ffq-banqi-http.ts` first: only the
canonical room shell proceeds to static serving after authorization. Review,
alias pages, embeds/oEmbed, exports and event APIs stay closed. The browser
tenant uses the existing room route and dynamically imports its own styles;
this change adds no prerendered page or public discovery entry.

With the local Postgres already running, the desktop spec creates two fresh,
stats-excluded admin accounts and independent sessions, opens the standard
friend setup, flips as Red, replies as Black, checks both HP displays and
reconnects Red. It removes the sessions and admin roles afterward, retaining
excluded game attribution. It never uses an operator login or remote database.

```sh
MISTBOARD_DEV_PORT_BASE=3170 MISTBOARD_FFQ_BANQI_ENABLED=true VITE_FFQ_BANQI_ENABLED=true npm run test:e2e -- ffq-banqi.spec.ts --project=desktop --workers=1
```

The spec is discovered and its TypeScript check passes. The browser journey
has **not run** in the burn sandbox. The load guard reported saturated memory
(49% free against a 50% reserve), so the heavy checks below are also pending:

```sh
npm run build -w @mistboard/game && npm run build -w @mistboard/board-render && npm run build -w @mistboard/mahjong && npm run build --workspace @mistboard/web
```

The web build must print `css check: N baked pages link every stylesheet that
styles them`; that line is **not yet confirmed** for this branch. Run the
prescribed burn suite before committing, including the full server and web
registrar packages. No full suite or browser pass is implied by the targeted
checks below.

```sh
nice -n 10 sh -c 'W="--changed main"; git diff --quiet main...HEAD -- packages || W=; npm run build --workspace @mistboard/game && npm run build --workspace @mistboard/board-render && npm run build --workspace @mistboard/mahjong && npm run build --workspace @mistboard/server && npm run test:tooling && npm run test:unit -w @mistboard/server -w @mistboard/game -w @mistboard/board-render -w @mistboard/mahjong && VITEST_MAX_WORKERS=7 npm run test:unit -w @mistboard/web -- $W'
```

Targeted evidence: the new enabled-admin HTTP case failed before the change
(`GET /room/ffq_reserved`: 404 instead of 200), then passed with the entire
flag/account matrix. Server tenant tests also pass for both seats, alternating
moves, illegal actions, HP endings and the 30-ply draw. Web checks cover the
admin/flag matrix, mode switches, fixed seats, canonical casual room requests,
registry parity, conformance, the board and the live HP/result/history UI.
Final targeted runs exited 0: all six FFQ server test files (51 tests), five
web files (73 tests), the e2e TypeScript project and Biome on the nine changed
TypeScript files. The web conformance checks emitted sandbox `connect EPERM`
noise for localhost lookups but reported no failed tests or Vitest errors.

Planted-failure proof: temporarily returning the canonical board from
`getFFQBanqiClientView` made **serialized FFQ seat and observer payloads mask
identities at every ply, live AND HP-finished** exit 1 with `red payload
carries a covered identity`. Restoring the masked view made it pass again.
The integration regression additionally masks covered capture roles for everyone
except the capturer, including the full live and finished replay envelope.

The integration onto current main also runs `flip-jungle-name.test.ts` and
checks catalog key uniqueness. The branch remains hidden and unpushed.
