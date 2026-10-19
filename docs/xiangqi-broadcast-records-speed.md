# Broadcast records-speed check

The November 2026 experiment measures when completed, replayable games first
appear at WXF, dpxq and Mistboard. This is post-round coverage. It does not
establish a live feed. The sampler is read-only and never imports or merges
games, changes a tour's source, or writes to production.

## Readiness, checked 2026-10-19

- The WXF category adapter is shipped. Its saved 2025 Worlds fixture imports
  round 1 as 24 legal games; the full category was previously verified at 223
  games across nine rounds. A fresh read-only run against the real WXF site
  also yielded 24 completed round-1 games and one skipped forfeit without moves.
- Production's WXF dry-run returned `source_disallowed`. The web service's
  host allowance was extended to `wxf-xiangqi.org,www.wxf-xiangqi.org`, keeping
  its existing `dpxq.com,*.dpxq.com` entries. Deploys were skipped. The saved
  configuration was read back and verified; the running process will pick it
  up at the next normal release. This is still awaiting a runtime re-check.
- The World Open and Rapid event pages exist and currently target dpxq.
  WXF's November results categories have not been identified. Do not reuse
  the 2025 category id as a November source.
- The organiser's official schedule separates the World Open (Nov 10–13)
  and Rapid (Nov 14–15). Existing production shells use Nov 10–15 for both.
  Round start times are not published yet. Update the dates from the official
  schedule during the event setup; the poller's dpxq index sweep can move an
  end date later again, so re-check after the next sweep.
- The organiser advertises YouTube streams, results and pairings at its news
  centre. No machine-readable move feed has been identified there.
- Do not start new dpxq automation until its operator's pending automated-
  access question is resolved. The sampler requires an explicit
  `--dpxq-permitted` flag for that source. No dpxq requests were made in this
  preparation.

Official pages:

- [World Open](https://www.xiangqi.sg/xqsite/wxs2026-world-open/)
- [Rapid](https://www.xiangqi.sg/xqsite/wxs2026-world-rapid/)
- [News and live video](https://www.xiangqi.sg/xqsite/wxs2026-news/)
- [WXF game-records index](https://www.wxf-xiangqi.org/index.php?option=com_content&view=article&id=219&lang=cn)

## Before November 6

1. After the next normal release, run the existing admin source-import preview
   against the known WXF round below. It must get past host validation and
   return replayable boards. `dryRun: true` rolls back all imported rows:

   ```js
   fetch('/api/admin/xiangqi/broadcasts/import', {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: JSON.stringify({
       sourceUrl: 'https://www.wxf-xiangqi.org/index.php?option=com_content&view=article&id=1844&lang=cn',
       dryRun: true,
       timeoutMs: 30000,
     }),
   }).then(response => response.json());
   ```

2. Find the actual November results categories on the WXF/organiser event
   pages. A category can describe a section (men/women/youth), not the whole
   event. Verify event, year, section and round numbers before configuring it.
   If none is published yet, record that fact and re-check when the organiser
   posts the first round. Never guess a category id.
3. Preview each source under the existing November tour slug. Compare a
   sample of shared games by exact mainline before any import. WXF and dpxq
   assign different source board ids; a matching round/table is not proof
   that the importer will update the same stored board. Keep one publishing
   source per section until that overlap is checked. The sampler compares
   both independently without creating duplicate public games.
4. Correct the event dates and seed round times once officially available.
   National Individual (Nov 21–29) stays on its existing dpxq source; WXF
   coverage for that domestic event is not assumed.

## Take observations during the event

Keep one JSONL file per event/round, outside git, backed up between sessions.
Run each configured source once every five minutes starting before the round
finishes, then retain the late tail. This script is one-shot: no new scheduled
job has been installed and nothing runs before the real source is identified.
All requests are sequential, at least one second apart, bounded by a timeout;
redirects must remain on the approved source hosts.

Replace `CATEGORY_ID` with the verified section category, not a past event's id:

```sh
node scripts/broadcast-records-speed.mjs \
  --source wxf \
  --url 'mistboard-discover://wxf-category?catid=CATEGORY_ID&tourSlug=2026-world-xiangqi-open' \
  --tour 2026-world-xiangqi-open --round 1 --log /tmp/world-open-r01.jsonl

node scripts/broadcast-records-speed.mjs \
  --source mistboard --tour 2026-world-xiangqi-open \
  --round 1 --log /tmp/world-open-r01.jsonl
```

After automated access is confirmed, the third observation uses
`--source dpxq --dpxq-permitted` with
`--url 'mistboard-discover://dpxq-tour?tour=12529&tourSlug=2026-world-xiangqi-open'`.
For Rapid use tour `12528` and slug `2026-world-rapid-championship`.

Record the actual round-end time from an official result or observation. The
scheduled start plus the time control is not a measured end time. Then:

```sh
node scripts/broadcast-records-speed.mjs --report \
  --log /tmp/world-open-r01.jsonl \
  --round-ended-at '2026-11-10T18:00:00+08:00'
```

The timestamp above is an example, not an announced round end. The report
matches complete games by event, round and exact coordinate mainline, retaining
each source's first observation across restarts. It excludes live/partial and
results-only boards, records failures separately from empty successful reads,
flags conflicting results and ambiguous identical mainlines, and marks records
already present at the first successful sample. A first observation is an upper
bound on publication time, not an exact publication timestamp. Differing
mainlines remain unmatched for manual inspection.

## Read the result

For each source, report unique completed games observed, unmatched records,
result conflicts, typical and slowest observed delay after the actual round
end, and observation gaps. Use the event week's filtered PostHog visitor count
for audience; SSE connections are not unique human visitors. Choose the source
with better measured timeliness and completeness for the next event. No source
publishing during play means the live-feed milestone remains open.

## Implementation handoff

- Branch: `agent/broadcast-wxf-readiness`; worktree:
  `/Users/brianliou/projects/mistboard-broadcast-wxf-readiness`.
- Changed files: this runbook, `INDEX.md`, the sampler and its test file.
- Verification: seven focused tests, including the saved WXF round through
  the real discovery and legal-replay adapters; fresh WXF round-1 read;
  formatter and diff checks. Production preview proved the missing host
  allowance; Railway read-back verified the saved correction.
- Release state: tooling is committed and parked. No release, public import,
  source switch, scheduled collector, or outreach was performed. The saved
  Railway allowance applies on the next normal web deployment. No public
  changelog line is needed for the tooling alone.
- Next owner: the next shipping session runs the production dry-run above.
  The November setup session identifies the actual section/category URLs,
  checks overlap before importing, and runs the round observations. Existing
  dated work: the November 6 WXF setup gate and November 10–13 speed test.
