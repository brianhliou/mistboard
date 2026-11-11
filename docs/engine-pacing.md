# Shared bot reply pacing (#1062)

Pacing uses one formula for every calibrated variant. The target is
`clamp(min(clockShare * clockAfterCompute + incrementShare * increment, maxBase)
* clamp(legalCount / variantMedian, .7, 1.4) * openingFactor * seededJitter,
minTarget, maxTarget)`. Untimed games use `untimedBaseMs` instead of the clock
share. A single move or decisive evaluation keeps only the short beat. A level eval stretches the target up to 1.4x and a lopsided one shortens it to 0.7x (`balanceFactor`); the usual wait caps at 7 s and a single reply at 12 s. Compute
time is subtracted from the target; the hold consumes real bot clock time.

`MISTBOARD_BOT_PACING=true` is the master switch.
`MISTBOARD_BOT_PACING_VARIANTS` is a comma-separated list of exact variant ids.
Unset paces every variant with a median; an empty list enables none. Unknown ids fail closed.
The policy supports nine shared-allocator variants. Live loops are integrated for
xiangqi, jieqi, Banqi, Jungle and Flip Jungle (#1063). Selecting another id does
not wire its loop. Fog and dark chess have no median and are never paced.
Correspondence and engine-vs-engine turns never receive a hold or pacing reserve.

## Calibration provenance

`apps/server/src/engine-pacing-fixtures.ts` defines a reproducible synthetic
corpus using the existing `variant-postgame-fixtures.ts` legal random-self-play
generator at base revision `385d23599`. These are kernel fixtures, not measured
human games or engine-quality positions. The Three Kingdoms Banqi fixture adds
its kernel enumerator and seeded setup to the same generator.

Seeds are the explicitly listed integers 7–22, in order, with an 80-ply cap per
game. The sampler takes the first 200 **distinct** pre-move board-and-turn
positions per variant. SHA-256 of the canonical board and turn excludes repeated
positions even across games. It stops when it has 200; a short corpus throws,
and is never cycled, repeated or padded. In this revision seeds 7, 8 and 9 supply
all 200 for every variant. Partial game prefixes are deliberate; they are not
represented as completed games. Fixtures and their legal counts are regenerated
from the pinned seeds during tests; no network, database or native engine is used.

| Variant | Positions | Median legal moves |
| --- | ---: | ---: |
| xiangqi | 200 | 40 |
| jieqi | 200 | 32 |
| banqi | 200 | 20 |
| jungle | 200 | 19 |
| jungle-flip | 200 | 8 |
| fortress-xiangqi | 200 | 19 |
| duck-xiangqi | 200 | 2210.5 |
| crazyhouse-xiangqi | 200 | 42 |
| three-kingdoms-banqi | 200 | 31 |

The calibration test regenerates and deduplicates the corpus, checks all nine
medians exactly, and checks reply-time variation. Duck counts full legal turns
(piece move plus duck placement), matching the enumerator's decision unit.

## Clock safety and cancellation

For paced live turns, both search allocation and the later hold keep
`max(5000 ms, 10% of initial clock)` **before** increment. Flat, phase and native
rules share this reserve. Already spent queue time is deducted first; the flat
search floor tapers near the reserve so a long 1+0 game cannot consume it via
repeated 50 ms minimum searches. A fully exhausted allocation never starts a
zero-budget engine search. This guarantee covers allocated search time and the
hold; arbitrary engine overruns, process/queue stalls and scheduling delays can
still spend real clock and are outside that mathematical guarantee.

The clock test runs 200 bot turns per variant, both seat parities, each time
rule, every `TIME_CONTROLS` preset and 1+0. Each search spends its full budget;
the actual pacing hold is then charged before increment. This is a whole-game
clock stress simulation driven by fixture legal counts, not a claim that random
prefixes form a single legal 400-ply game.

A reply turn captures state and clock identity **before** searching. The shared
wait checks validity every 25 ms and clears its timer and abort listener on
completion. Room timer cleanup aborts it immediately, including when cleanup
happens during search. Resign, abort and flag change state; pause/resume changes
the clock; shutdown marks the room stopping. All discard the result before
append or decision artifact. The live clock is checked too, so a flag whose
timer callback is still queued cannot let a held move through. Retries and
Jieqi draw-guard re-searches reallocate after the time already spent. Tenant rooms currently have no live takeback
endpoint; the regression replaces the projection with a restored state with the
same side to move. Reconnect metadata does not invalidate a turn.

## Review and validation

Start with `engine-pacing-calibration.test.ts` and `engine-reply-pacing-loop.test.ts`.
The before-change regression run failed twice: 1+0 crossed its 6000 ms reserve
on bot move 65 (5897 ms left), and room cleanup still appended a held move.
The exact same tests pass with the shared reserve and cancellation guards.
An additional before-fix test reproduced both loops appending after the clock
had elapsed but before a flag event; both now discard that reply.

Planted checks temporarily set `clockReserveMs` to zero and the Jungle median
to 4, then run the pacing/calibration tests and restore the source. The former
must fail the independent 5000 ms reserve assertion; the latter must fail the
fixture-derived median assertion. Both planted mutations failed these checks
and were restored. Gate results are recorded in the burn handoff.

## Banqi, Jungle and Flip Jungle integration (#1063)

The three live loops use the same cancellable reply turn and pace payload as
xiangqi/jieqi. This includes Banqi's chase fallback and strict external/internal
providers, Jungle's in-process search, Rust engine and KataGo seat, and Flip
Jungle's UCI provider. A provider that fails closed still resigns immediately;
pacing does not delay infrastructure failures. Successful decisions add only
`pace_wait_ms`, `pace_target_ms`, and `pace_reason` to the existing payload.

Search allocation uses the shared starting-clock reserve and deducts preparation
and earlier attempts before retrying. The hold charges the bot's running clock;
`think_time_ms` records compute before the hold. Every path checks state/clock
identity, terminal status, engine seat and live clock both during the wait and
again after awaiting it, immediately before queuing the decision and appending.
That final check also covers an abort between timer resolution and continuation.

There is no live takeback endpoint for these tenants. Tests model a restored
same-seat-to-move projection; this change adds no takeback surface. EvE and
correspondence skip both hold and pacing reserve. No registry, tenant list, route,
engine tier, or rollout default changes.

Review and local rehearsal evidence: [#1063](https://github.com/brianhliou/mistboard/issues/1063).
