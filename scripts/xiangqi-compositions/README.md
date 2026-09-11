# 適情雅趣 composition pipeline

What builds the classical-manual studies from dpxq records. Recovered 2026-09-10
from a session transcript after the scratchpad holding it was deleted, and made
runnable the same day: until then the only durable copy of any of it was the
study rows in production.

| file | what it does |
|---|---|
| `mine_v2.py` | pulls composition records from dpxq `view_u_<id>.html` pages |
| `seed-v2.mjs` | writes one study per volume, one chapter per composition |
| `run-seed-v2.sh` | supplies the Postgres credential from Railway without a human reading it |
| `merge_all.py` | **superseded**, see below |
| `../data/xiangqi-compositions/titles-en.json` | 817 hand-authored English renderings of the composition names |

```
python3 mine_v2.py --out /tmp/sqyq.json
command railway run -s Postgres -- sh run-seed-v2.sh \
  --app /path/to/checkout --data /tmp/sqyq.json \
  --titles ../data/xiangqi-compositions/titles-en.json --dry-run
```

`--book` selects the manual (`shi-qing-ya-qu`, `ju-zhong-mi`). Volume count comes
from the mined data, so a flat book seeds as one volume.

`seed-v2.mjs` only CREATES. Re-pointing an existing chapter is a PATCH against
the live study, never a re-seed: delete-and-recreate loses the chapter id, its
permalink, and its place in the ordering.

## What dpxq actually serves

Two movelist shapes, disjoint across the corpus, which is why an earlier pass
that understood only one found half the book and declared the rest empty:

```
segmented   var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]<var>...'
nested      var DhtmlXQ_movelist = '[DhtmlXQ_movelist]<digits>[/DhtmlXQ_movelist]'
```

`mine_v2.mainline()` reads both. `[0_1_0]` is dpxq's own label for the mainline,
so preferring it is not a heuristic: **never** replace this with the
"digit-richest occurrence" rule the `view_m_` fetcher uses, which can splice a
variation onto a mainline (issue #377). The `[DhtmlXQ_movelist]` tag in the
page's hidden div is a different thing and ships empty on most of these records.

## The prose solutions

Some compositions carry a genuine one-move movelist because the answer is not a
forced line: a draw study's answer is a principle. dpxq keeps those in the
comment tags, which `mine_v2.py` now captures:

```
[DhtmlXQ_comment0]红先和局[/DhtmlXQ_comment0]
[DhtmlXQ_comment1]再三退四，四退三，退占相头，即成和棋。[/DhtmlXQ_comment1]
```

Nothing read them before 2026-09-10, so 53 of 適情雅趣 卷六's 84 chapters shipped
as a diagram plus a single move, under a comment claiming the source recorded
only the opening move. That was false about the record. `seed-v2.mjs` now quotes
the prose instead.

This is a deliberate, narrow exception to the standing "moves only, never dpxq's
annotations" rule: for a Ming manual these comments are the **book's own**
solution text, not a modern annotator's layer. It does not license taking
annotations off modern tournament records.

## `merge_all.py` is superseded

It existed to re-fetch the records whose shape the original miner could not read.
`mine_v2.mainline()` now reads both shapes in the first pass, so that second
network round is gone. The file is kept for its notes on how the two shapes were
discovered; it still hardcodes the deleted scratchpad and does not run. Delete it
once nothing needs its reasoning.

## Provenance

Positions come from dpxq.com and are credited per chapter. The compositions are
Ming-dynasty and long out of copyright; the English titles are ours. Legality
replay is a check on the record, not on the book: this text has a single source
and a solution recorded short would still replay cleanly. See the FAQ's library
answer for the standing posture.
