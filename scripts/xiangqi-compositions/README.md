# 適情雅趣 composition pipeline (recovered)

What built the live Elegant Pastime Manual studies, recovered 2026-09-10 from a
session transcript after the scratchpad that held it was deleted. Until this
commit the only durable copy of any of it was the study rows in production.

| file | what it does |
|---|---|
| `mine_v2.py` | pulls composition records from dpxq `view_u_<id>.html` pages |
| `merge_all.py` | reconciles the two movelist shapes dpxq serves, re-fetching only the ids neither pass covered |
| `seed-v2.mjs` | writes one study per volume, one chapter per composition |
| `run-seed-v2.sh` | the wrapper the Vol. 6 run actually used |
| `../data/xiangqi-compositions/titles-en.json` | 817 hand-authored English renderings of the composition names |

**These are recovered verbatim and are NOT runnable as they stand.** Every path
is hardcoded to a scratchpad directory that no longer exists, and the mined data
they consumed (`sqyq-full.json`, `sqyq/*.dhtmlxq`) went with it. Parameterize the
paths and re-mine before trusting any of it. They are committed as the record of
how the studies were made, not as a working tool.

## What dpxq actually serves

Two movelist shapes, disjoint across the corpus, which is why two separate
extraction passes each found roughly half and their union was still short:

```
segmented   var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]<var>...'
nested      var DhtmlXQ_movelist = '[DhtmlXQ_movelist]<digits>[/DhtmlXQ_movelist]'
```

The `[DhtmlXQ_movelist]` **tag** in the page's hidden div ships empty on these
pages; the real value is in the JS variable. 245 records are segmented, 305
nested.

## The known gap: the prose solutions

Roughly 61 records carry a genuine one-move movelist, and for those dpxq keeps
the solution as prose instead:

```
[DhtmlXQ_comment0] 红先和局
[DhtmlXQ_comment1] 再三退四，四退三，退占相头，即成和棋。
```

**Nothing in this pipeline or in `packages/game` reads those tags.** `mine_v2.py`
does not extract them, `apps/server/src/scripts/fetch-dpxq-archive.ts` does not
write them, and `XiangqiImportResult` has no field to carry them. So chapters
built from those records show a diagram and one move, and their comment says the
source recorded only the opening move, which is true of the movelist and false of
the record. Closing it means a re-fetch of the `view_u_` pages: no copy on disk
has ever held a comment tag. `merge_all.py` already has the fetch loop.

## Provenance

Positions come from dpxq.com and are credited per chapter. The compositions
themselves are Ming-dynasty and long out of copyright; the English titles are
ours. See the FAQ's library answer for the standing posture.
