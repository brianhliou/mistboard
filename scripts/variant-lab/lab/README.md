# Variant lab

Measure whether a rule set is a game before building anything for it: does
the engine play the same rules as the kernel, are the rules symmetric, does
the engine understand the game, and who wins under best play.

```
npm run lab -- variants
npm run lab -- assert-variant --variant xiangqi
npm run lab -- perft-gate     --variant xiangqi --depth 2 --positions 200 --games 50
npm run lab -- randomplay     --variant xiangqi --games 3000
npm run lab -- match          --variant xiangqi --games 20 --nodes 100000
npm run lab -- ladder         --variant xiangqi --pairs 10 --hi 100000 --lo 10000
npm run lab -- bestplay       --variant xiangqi --nodes 1000000,2000000,5000000
npm run lab -- report         --variant xiangqi [--rules k=v] [--write results.md]
```

Run them in that order for a new variant. Each one is a precondition for
reading the next: a number from an engine that failed the gate is a number
about a different game.

## What each command proves

| command | question | instrument |
|---|---|---|
| `assert-variant` | does the engine speak this variant at all? | `uci` lists it, perft(1) at the start equals the kernel, start move sets agree |
| `perft-gate` | is the engine's ruleset the kernel's? | perft to `--depth`, the adapter's discriminating positions as exact move sets, a differential over positions reached by random play |
| `randomplay` | are the RULES symmetric? | random vs random, Red's share of decided games with a 95% interval; kernel only |
| `match` | is the engine above noise? | engine vs random, seats alternating |
| `ladder` | does search understand the game? | 10x nodes vs 1x on paired random openings, seats swapped; score and implied Elo |
| `bestplay` | who wins under best play? | engine vs engine from the start, no randomness, one game per budget |
| `report` | what do we know, and is it still current? | a table from the artifacts, stale rows marked |

Two rules the commands enforce so nobody has to remember them:

- **No randomised first ply in a first-mover figure.** A random opening
  samples the whole distribution and throws away the one best play finds.
  Only `bestplay` may be quoted as a first-mover result; `ladder` uses random
  openings because it compares two players to each other, not to the tempo.
- **The kernel is the referee.** The engine proposes, the kernel validates,
  applies and ends the game. An illegal engine move aborts the run with the
  position; a record of a different game is worse than none.

## Rules as data

An adapter declares the decisions that are still open for its variant as a
schema, and `--rules key=value` binds them:

```
npm run lab -- randomplay --variant xiangqi --rules progressClock=100
```

Unknown keys and out-of-schema values are errors, not defaults: a misspelled
rule that silently falls back is the flip that did not happen. Every artifact
records the resolved rules and their hash, so `report` can mark rows measured
under other rules as stale and say which rules changed and how far the flip
reaches (`movegen`: replay everything; `terminal`: re-score from the logs;
`cosmetic`: nothing moves). Once a decision is settled, collapse the field and
delete the dead branch before the variant ships.

## Artifacts

One JSON file per run, `<out>/<variant>/<command>-<fingerprint>-<seed>-<time>.json`,
with a header naming the lab version, rules and rules hash, the engine's
binary and ini hashes, the arguments and the seed. The fingerprint changes
when any of those do, so a rebuilt engine or a changed stanza reads as a new
row. Default `out` is `docs-private/variant-lab/out` (found through the main
worktree when run from a task worktree); `LAB_OUT` or `--out` overrides.

## Adding a variant

Copy `variants/_template.ts` to `variants/<id>.ts`, set `id`, and edit three
places: the schema (which decisions are open), the kernel config (what they
mean), and the stanza lines (what the engine is told). The template is
standard xiangqi through the configurable kernel and the lab's own tests run
the full gate on it against stock Fairy-Stockfish, so a copy starts from a
pairing known to agree. The registry discovers `variants/<id>.ts`, so nothing
shared is edited and two variants in two worktrees never touch the same file.

The foundation the template rests on:

- `packages/game/src/xiangqi-rule-kernel.ts`: one xiangqi geometry with rule
  hooks (regions per piece, facing, check, compulsory capture, blast on
  capture, royalty per side, extinction, flag regions, stalemate value,
  progress clock, repetition) and a lenient FEN codec. Its standard
  configuration is tied to the elephantops-backed kernel by a differential
  test, and a variant that only configures it inherits that gate. Hand-roll a
  kernel only for a rule the hooks cannot express (drops, hidden pieces).
- `lab/stanza.ts`: the shared rules vocabulary (`facing`, `stalemate`,
  `progressClock`, `perpetualCheck`), the kernel config it implies, and the
  Fairy-Stockfish lines that express it, with fragments for a non-royal
  general and a freed general. What stock FSF cannot express throws rather
  than silently measuring a different game.

A kernel that is not (yet) exported from `@mistboard/game` is imported by
relative path into `packages/game/src/`; the Benedict pattern of an
unregistered kernel is the default until a variant survives measurement. The
adapter binds a rules record to:

- a `LabKernel`: whole turns in and out, engine notation both ways, an
  engine-acceptable FEN both ways, and (for variants whose turn list is
  large) a cheap `isLegal` and `randomMove`;
- a `LabEngineSpec`: the UCI_Variant name, the `variants.ini` stanza to load
  (generated from the rules), and where the binary lives;
- discriminating positions: every rule the variant adds should have one that
  perft from the start array cannot reach.

`variants/xiangqi.ts` is the control (stock Fairy-Stockfish, the validated
kernel) and the template. `variants/duck-xiangqi.ts` shows the harder cases:
two-part turns, a piece that is not in `board`, a notation that repeats the
destination, a patched binary, and a FEN dialect that differs between kernel
and engine.

Engines: `MISTBOARD_FSF_PATH` for stock Fairy-Stockfish (largeboards build),
per-variant variables for patched binaries (`MISTBOARD_FSF_DUCK_PATH`). An
engine asked for a variant it does not have keeps playing the previous one
without a word, which is why `assert-variant` exists and why every other
command runs its checks before the first search.
