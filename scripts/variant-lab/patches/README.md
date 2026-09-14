# Fairy-Stockfish patches for the variant lab

Lab-only engine patches. None of these is a shipped bot; a variant that
survives measurement gets its own `.ref` + `.patch` at the repo root and a
railpack step, the way `fairy-stockfish-duck-xiangqi.ref` does.

## fairy-stockfish-atomic-xiangqi.patch

Applies to upstream `1b5bdd40499bd5c7417bdc532d52fef8847bdf3f` (the same
commit `fairy-stockfish-duck-xiangqi.ref` pins). Three changes, each guarded
so a variant with a real KING is untouched:

1. `blastShape = king | wazir | lines` (new option, default `king`, upstream's
   hard-coded `attacks_bb<KING>`). `lines` is the wazir mask plus a xiangqi
   palace's drawn diagonals: on a 9x10 board, files d-f, ranks 1-3 and 8-10,
   a diagonal step counts only between a palace corner and its centre.
   Every blast site reads it: legality (`Position::legal`), `do_move`,
   `undo_move`, SEE, the touching-royals immunity, and the evaluation's
   blast-threat term.
2. The legality check honours `blastImmuneTypes` (and PAWN) when it judges
   whether the mover's pseudo-royal is attacked on the post-blast board.
   Upstream subtracted the whole blast, so a soldier that survives to screen
   the general read as gone and a legal move was refused (verified on
   `3kr4/9/9/9/9/R2n5/4P4/9/9/4K4 w`, a5d5). The parser warning about
   `blastImmuneTypes` with a pseudo-royal is dropped accordingly.
3. `flyingGeneral` and `perpetualCheckIllegal` key on the extinction
   pseudo-royal when the side has no KING. Facing is judged on the post-blast
   occupancy inside the pseudo-royal legality branch (a capture whose blast
   opens the file is illegal). A `StateInfo::pseudoCheck` flag records "the
   side to move's pseudo-royal is attacked" so the repetition law can see
   checks that the KING-only `checkersBB` cannot.

Build (macOS arm64; the lab's default binary path is
`bin/fairy-stockfish-atomic-xiangqi`, gitignored):

```sh
git clone -q https://github.com/fairy-stockfish/Fairy-Stockfish.git /tmp/fsf-atomic
git -C /tmp/fsf-atomic checkout -q 1b5bdd40499bd5c7417bdc532d52fef8847bdf3f
git -C /tmp/fsf-atomic apply scripts/variant-lab/patches/fairy-stockfish-atomic-xiangqi.patch
make -C /tmp/fsf-atomic/src -j build ARCH=apple-silicon largeboards=yes
cp /tmp/fsf-atomic/src/stockfish bin/fairy-stockfish-atomic-xiangqi
```

Proof the patch is right is the lab's own gate, not a perft count in this
file: `npm run lab -- perft-gate --variant atomic-xiangqi` at the adapter's
default rules (`blastShape=lines, soldiersImmune=true, facing=file,
perpetualCheck=loss`) must be GREEN against the kernel, including the 14
built positions that exercise each change.
