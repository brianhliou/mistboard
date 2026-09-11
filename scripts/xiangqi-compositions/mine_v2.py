"""Mine 適情雅趣 properly: the mainline lives in a JS var, not the movelist tag.

The first pass searched only `[DhtmlXQ_movelist]`, which is empty on most of these
pages, and concluded 306 of 550 compositions had no solution. They all do. The page
carries a variation TREE:

    var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]<variation>[/0_4_1]...'

`[0_1_0]` is the mainline; the rest branch from a parent segment at a given ply and
are captured here but not used yet. Ids come from the book's own volume directories
so the set is exactly the book, not an id range guess.

Same politeness as the repo fetcher: sequential, ~1.2s apart, honest User-Agent.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "mistboard-corpus-survey/1.0 (+https://mistboard.com; contact brianhliou@gmail.com)"}
BOOK = "http://www.dpxq.com/hldcg/share/chess_象棋谱大全/象棋谱大全-古谱残局/适情雅趣/"
VOLS = ["卷一", "卷二", "卷三", "卷四", "卷五", "卷六"]


def get(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(urllib.parse.quote(url, safe=":/?=&"), headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("gb18030", "replace")
        except Exception:
            if attempt == tries - 1:
                return None
            time.sleep(2.0)
    return None


def tag(text, name):
    m = re.search(rf"\[DhtmlXQ_{name}\]([^\[]*)", text)
    return m.group(1).strip() if m else ""


def segments(text):
    """Every [parent_ply_index] segment of the JS movelist var, in page order."""
    var = re.search(r"var\s+DhtmlXQ_movelist\s*=\s*'([^']*)'", text)
    if not var:
        return []
    return [
        {"key": k, "digits": d}
        for k, d in re.findall(r"\[(\d+_\d+_\d+)\](\d+)\[/\1\]", var.group(1))
    ]


out = []
for vi, vol in enumerate(VOLS, 1):
    idx = get(BOOK + vol + "/")
    if idx is None:
        print(f"  !! volume {vol} index failed", flush=True)
        continue
    ids = sorted({int(x) for x in re.findall(r"view_u_(\d+)\.html", idx)})
    print(f"vol {vi} ({vol}): {len(ids)} entries listed", flush=True)
    time.sleep(1.2)
    for gid in ids:
        url = f"http://www.dpxq.com/hldcg/search/view_u_{gid}.html"
        page = get(url)
        time.sleep(1.2)
        if page is None:
            print(f"  {gid}: fetch failed", flush=True)
            continue
        segs = segments(page)
        main = next((s["digits"] for s in segs if s["key"] == "0_1_0"), "")
        rec = {
            "id": gid,
            "vol": vi,
            "title": tag(page, "title"),
            "binit": tag(page, "binit"),
            "mainline": main,
            "variations": [s for s in segs if s["key"] != "0_1_0"],
            "url": url,
        }
        out.append(rec)
        if not main or not rec["binit"]:
            print(f"  {gid} {rec['title'][:16]}: NO {'mainline' if not main else 'binit'}", flush=True)
    print(f"vol {vi} done, {len([r for r in out if r['vol'] == vi])} records", flush=True)

json.dump(out, open(sys.argv[1], "w"), ensure_ascii=False)
withmain = sum(1 for r in out if r["mainline"])
withbinit = sum(1 for r in out if r["binit"])
print(f"\n{len(out)} records; {withmain} with a mainline, {withbinit} with a start position")
print(f"variation segments captured: {sum(len(r['variations']) for r in out)}")
