# Banqi engine providers

Mistboard can call a private Banqi executable or an authenticated HTTP worker
without receiving its source. This contributor kit implements the transport,
public turn contract and a strict adapter for the existing live move caller.
It does **not** register an outside engine, add a public upload service or deploy
a worker.

| Hosting | Who holds the engine and model files |
|---|---|
| Private executable or container operated by Mistboard | Mistboard receives the runnable files; source can stay with the author. |
| Author-operated HTTP worker | The author retains the runnable files; Mistboard exchanges public positions and results. |

A container packages an executable and its dependencies; it does not conceal
those files from its host. Browser WASM would deliver executable/model files to
players and is outside this kit.

An author can supply an existing tournament interface. We can write its adapter;
authors do not have to implement the wrapper contract below themselves. The
included native adapter speaks one specific Banqi UCI dialect, rather than
assuming that every engine is UCI-compatible.

## Try an existing executable

From the repository root, after installing dependencies and building the local
packages:

```sh
npm run engine:banqi-provider -- probe --bin /absolute/path/to/engine
```

For an executable that advertises the UCI `EvalFile` option:

```sh
npm run engine:banqi-provider -- probe --bin /absolute/path/to/engine --eval-file /absolute/path/to/model.nnue
```

The probe calls the binary directly, then starts an ephemeral authenticated
loopback bridge and calls it through HTTP. It checks both returned moves against
the kernel's legal roots, prints the moves and any actual evaluation, and closes
the bridge. It needs no engine source, model download or external endpoint. The
model path is operator-local and never enters the shared turn payload.

To keep the reference bridge running locally, supply a token through the operator
environment. This example contains a placeholder, never a real credential:

```sh
MISTBOARD_BANQI_PROVIDER_TOKEN='<local-test-token>' npm run engine:banqi-provider -- bridge --bin /absolute/path/to/engine --port 3217
```

`--eval-file` also works with `bridge`. It binds only `127.0.0.1`; production
TLS, credential provisioning, isolation and deployment are separate operator
work. The bridge route is `POST /turn`, with JSON and a Bearer token.

## The turn contract

The version is `mistboard-banqi/1`. A checked [example request](examples/banqi-provider-request.json)
and [move-only response](examples/banqi-provider-response.json) accompany the
[TypeScript contract](../apps/server/src/banqi-provider-protocol.ts). Example
timestamps are illustrative offsets; the probe generates fresh deadlines.

Each request carries:

- Game, request and engine IDs, ply, first/second seat, and that seat's bound red
  or black ink. Ink is `null` before the first flip determines colors.
- The current **five-field masked FEN**, the previous move and chased square.
  Face-down pieces are `X`, without color or identity. The pool contains public
  remaining piece counts. No sixth dealt-FEN field, shuffle seed, canonical game
  state or player metadata is sent.
- Stamped rules, public repetition counts, a masked replay-window FEN and its
  quiet moves, plus the exact legal root list. These permit stateless resumption;
  a reconnect needs no private process memory.
- Remaining clock, increment, optional node ceiling, request time and absolute
  deadline in Unix milliseconds.

UCI coordinates use files `a`–`h` and ranks `0`–`3`. Thus site square `a1` is
engine square `a0`, and `a0a0` means flip that square. The FEN lists four ranks
top-first. Piece letters are `G A E R H C S`, lower case for black. The native
adapter issues `uci`, `NoProgressLimit`, optional `EvalFile`, `isready`,
`ucinewgame`, `position fen … moves …`, and `go … searchmoves …`.

Native UCI **requires the complete quiet replay window**: its base clock is zero
and the number of quiet moves equals the current no-progress clock. It refuses
a FEN-only quiet resume because this dialect cannot consume the separate public
repetition-count map. Supplied windows must legally replay to the current FEN.

The response echoes protocol, game/request IDs and ply, then supplies one legal
move. Optional `analysis.score` uses a stated `side-to-move` perspective:

| Type | Value |
|---|---|
| `cp` | Raw engine score, not assumed comparable across engines. |
| `mate` | Signed moves to mate. |
| `win-probability` | Win probability from 0 to 1. |
| `wdl` | `win`, `draw`, `loss` probabilities, each 0 to 1, summing to 1. |

Depth, searched nodes and a PV are optional. A move-only engine emits no analysis.
Transport support for probability/WDL is implemented; conversion to Mistboard's
current score-based grading is **not**. The live adapter does not invent
centipawns from those values. Postgame grading also needs an agreed score meaning
and the ability to analyze arbitrary public positions at their historical ply;
it must never look ahead into later reveals or receive the hidden deal.

## Rule compatibility

New games draw after **60 plies without a capture or flip**; older stamped games
can use 40. Ordinary third repetition draws. Under the current chase rule, a
chase that would produce the third occurrence is forbidden unless it is the
side's only legal move. A chase or flee does not itself trigger a repetition
draw; mutual chase is treated as an ordinary move. Historical games can have the
chase rule off. See the [rule implementation](../packages/game/src/variants-banqi.ts)
and [public rules](https://mistboard.com/rules/banqi).

Root filtering prevents a forbidden move from being accepted. It does **not**
repair an engine's internal search assumptions, learned value targets, draw
clock or chase adjudication. The UCI dialect can supply the clock limit and
root moves, but internal parity must be established with the author before
serving it. Different tournament draw rules are a compatibility question, not
an automatic rules change on the site.

## Calling and onboarding

Server-side entry points are `createBanqiUciProvider` and
`createBanqiHttpProvider` in [banqi-provider.ts](../apps/server/src/banqi-provider.ts).
HTTP configuration takes an operator-controlled endpoint and token. HTTPS is
required; the explicit `allowLocalhostHttp` exception permits only numeric
loopback addresses for testing. URLs cannot contain credentials, query strings
or fragments, and redirects are refused. Nothing accepts client URLs or shell
commands.

One deadline covers admission, startup/network, bounded output/body reads and
validation. Concurrency is bounded; expired queued requests never start work.
Native processes receive a minimal environment, are terminated on cancellation
or deadline, and have capped stdout. Responses have capped size and must match
the original request and legal roots. Errors omit tokens, endpoints and raw
child/HTTP diagnostics.

`banqiProviderForLive(provider, publicEngineVersion)` adapts a provider to the injectable
`playBanqiEngineMoveIfReady` caller. The operator supplies the pinned public build
version recorded in decision/failure artifacts. It uses one attempt, rejects stale plies and
expired clocks, and resigns on failure. It never silently substitutes the
built-in chase fallback. The default built-in provider's behavior is unchanged.

Before an actual outside bot is enabled, the operator must:

1. Obtain its runnable artifact or endpoint, platform/CPU/GPU requirements,
   dependencies, permitted use and agreed author credit. Wrap its existing
   interface if it differs from this native dialect or HTTP contract.
2. Verify rule and hidden-information parity, startup and move latency, clocks,
   legal roots, failures and a local complete game. Record a pinned artifact
   version and rollback target without publishing private files.
3. Register its real engine identity, provider routing, play options and bot
   profile, plus the variant EvE adapter needed for a rateable ladder. The kit
   deliberately creates none of these on an author's behalf.
4. Review any optional analysis/benchmark work separately, then follow the
   repository's normal review and release process. Engine strength and public
   availability are measured and confirmed after integration.

The reference bridge is a local proof, not a general production hosting service.
An outbound pull-worker API, public self-service registration and provider-backed
grading remain outside this implementation.
