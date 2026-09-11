"""Build one canonical 550-record set from the three extraction shapes.

dpxq serves these pages two ways and each of my earlier extractors read exactly
one, which is why two passes each found ~245 and their union was still short:

  segmented  var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]<var>...'
  nested     var DhtmlXQ_movelist = '[DhtmlXQ_movelist]<digits>[/DhtmlXQ_movelist]'

245 are segmented, 305 nested, and the sets are disjoint. The 61 nested records
still missing were dropped by an earlier >=2-move floor: they are legitimate
one-move problems.

Sources, in order of preference per id:
  1. sqyq-full.json  -- segmented mainlines, already parsed
  2. sqyq/*.dhtmlxq  -- nested movelists from the first pass
  3. re-fetch        -- only the ids neither source covers
"""
import glob
import json
import os
import re
import sys
import time
import urllib.request

S = "/private/tmp/claude-501/-Users-brianliou-projects-mistboard/3d8642e6-80f1-4d8c-bdc0-d062476f33d1/scratchpad"
UA = {"User-Agent": "mistboard-corpus-survey/1.0 (+https://mistboard.com; contact brianhliou@gmail.com)"}

full = {r["id"]: r for r in json.load(open(f"{S}/sqyq-full.json"))}

# nested movelists already on disk from pass one
local = {}
for f in glob.glob(f"{S}/sqyq/*.dhtmlxq"):
    gid = int(re.search(r"view_u_(\d+)", os.path.basename(f)).group(1))
    raw = open(f, encoding="utf8").read()
    m = re.search(r"\[DhtmlXQ_movelist\]([^\[]*)", raw)
    if m and m.group(1).strip():
        local[gid] = m.group(1).strip()


def extract(text):
    """Mainline digits from either shape, or ''. Segments win when present."""
    var = re.search(r"var\s+DhtmlXQ_movelist\s*=\s*'([^']*)'", text)
    inner = var.group(1) if var else text
    seg = re.search(r"\[0_1_0\](\d+)\[/0_1_0\]", inner)
    if seg:
        return seg.group(1)
    nested = re.search(r"\[DhtmlXQ_movelist\](\d+)\[/DhtmlXQ_movelist\]", inner)
    return nested.group(1) if nested else ""


need = [gid for gid, r in full.items() if not r["mainline"] and gid not in local]
print(f"{len(full)} records; {sum(1 for r in full.values() if r['mainline'])} segmented, "
      f"{len(local)} nested on disk, {len(need)} to fetch")

for i, gid in enumerate(sorted(need), 1):
    try:
        req = urllib.request.Request(
            f"http://www.dpxq.com/hldcg/search/view_u_{gid}.html", headers=UA)
        with urllib.request.urlopen(req, timeout=25) as r:
            text = r.read().decode("gb18030", "replace")
    except Exception as e:
        print(f"  {gid}: fetch failed {e}")
        time.sleep(1.2)
        continue
    got = extract(text)
    if got:
        local[gid] = got
    else:
        print(f"  {gid}: still no movelist")
    if i % 20 == 0:
        print(f"  ...{i}/{len(need)}", flush=True)
    time.sleep(1.2)

out = []
for gid, r in sorted(full.items()):
    main = r["mainline"] or local.get(gid, "")
    out.append({**r, "mainline": main,
                "shape": "segmented" if r["mainline"] else ("nested" if main else "none")})
json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False)

have = sum(1 for r in out if r["mainline"])
print(f"\nwrote {len(out)} records, {have} with a mainline, {len(out) - have} without")
from collections import Counter
print("shapes:", dict(Counter(r["shape"] for r in out)))
print("move counts:", dict(Counter(min(len(r['mainline']) // 4, 99) for r in out if r["mainline"]).most_common(6)))
