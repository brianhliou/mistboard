"""Mine a dpxq classical manual: the mainline lives in a JS var, not the movelist tag.

The first pass searched only `[DhtmlXQ_movelist]`, which is empty on most of these
pages, and concluded 306 of 550 compositions had no solution. They all do. The page
carries a variation TREE:

    var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]<variation>[/0_4_1]...'

`[0_1_0]` is the mainline; the rest branch from a parent segment at a given ply and
are captured here but not used yet. Ids come from the book's own directory listing
so the set is exactly the book, not an id range guess.

THE PROSE SOLUTIONS. Some compositions carry a genuine one-move `movelist` because
the answer is not a forced line -- a draw study's answer is a principle. dpxq keeps
those in `[DhtmlXQ_comment0]` / `[DhtmlXQ_comment1]`:

    [DhtmlXQ_comment0]红先和局[/DhtmlXQ_comment0]
    [DhtmlXQ_comment1]再三退四，四退三，退占相头，即成和棋。[/DhtmlXQ_comment1]

Every comment tag is captured. Without them, 53 of 適情雅趣 卷六's 84 chapters are a
diagram and a single move, which is how they shipped in September 2026.

Same politeness as the repo fetcher: sequential, ~1.2s apart, honest User-Agent.

Usage:
  python3 mine_v2.py --out records.json                          # 適情雅趣, six volumes
  python3 mine_v2.py --out kjm.json --book <url> --no-volumes    # a flat, unvolumed book
  python3 mine_v2.py --out x.json --book <url> --vols 卷一,卷二
"""
import argparse
import json
import re
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "mistboard-corpus-survey/1.0 (+https://mistboard.com; contact brianhliou@gmail.com)"}
RECORD_URL = "http://www.dpxq.com/hldcg/search/view_u_{gid}.html"

# dpxq is HTTP-ONLY: https returns one byte. Do not "fix" these to https.
SHI_QING_YA_QU = "http://www.dpxq.com/hldcg/share/chess_象棋谱大全/象棋谱大全-古谱残局/适情雅趣/"
SHI_QING_YA_QU_VOLS = ["卷一", "卷二", "卷三", "卷四", "卷五", "卷六"]


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, help="where to write the records JSON")
    p.add_argument("--book", default=SHI_QING_YA_QU, help="dpxq book directory URL (trailing slash)")
    p.add_argument(
        "--vols",
        default=",".join(SHI_QING_YA_QU_VOLS),
        help="comma-separated volume directory names under --book",
    )
    p.add_argument(
        "--no-volumes",
        action="store_true",
        help="the book is one flat listing with no volume directories (e.g. 桔中秘残局谱)",
    )
    p.add_argument("--delay", type=float, default=1.2, help="seconds between requests")
    return p.parse_args()


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


def comments(text):
    """Every [DhtmlXQ_commentN] on the page, keyed by N.

    N is the ply the note hangs off, so comment0 is the problem's own verdict
    ("红先和局") and comment1 onward annotate moves. Kept as a dict rather than a
    list because the numbering is sparse on annotated records.
    """
    found = {}
    for n, body in re.findall(r"\[DhtmlXQ_comment(\d+)\]([^\[]*)\[/DhtmlXQ_comment\1\]", text):
        body = body.strip()
        if body:
            found[n] = body
    return found


def segments(text):
    """Every [parent_ply_index] segment of the JS movelist var, in page order."""
    var = re.search(r"var\s+DhtmlXQ_movelist\s*=\s*'([^']*)'", text)
    if not var:
        return []
    return [
        {"key": k, "digits": d}
        for k, d in re.findall(r"\[(\d+_\d+_\d+)\](\d+)\[/\1\]", var.group(1))
    ]


def mainline(text):
    """The mainline digits and which of dpxq's two shapes carried them.

    dpxq serves these pages two ways and the sets are disjoint -- roughly 245
    segmented and 305 nested across 適情雅趣 -- which is why an earlier pass that
    understood only one shape found half the book and declared the rest empty:

        segmented  var DhtmlXQ_movelist = '[0_1_0]<mainline>[/0_1_0][0_4_1]...'
        nested     var DhtmlXQ_movelist = '[DhtmlXQ_movelist]<digits>[/DhtmlXQ_movelist]'

    Segments win when present: `[0_1_0]` is dpxq's own label for the mainline, so
    reading it is not a heuristic. This is the difference between this miner and
    the `view_m_` fetcher, whose "digit-richest occurrence" rule can splice a
    variation onto a mainline (issue #377). Never replace this with that.

    The `[DhtmlXQ_movelist]` TAG in the page's hidden div is a different thing and
    ships empty on most of these records; only the JS var is authoritative.
    """
    var = re.search(r"var\s+DhtmlXQ_movelist\s*=\s*'([^']*)'", text)
    inner = var.group(1) if var else text
    seg = re.search(r"\[0_1_0\](\d+)\[/0_1_0\]", inner)
    if seg:
        return seg.group(1), "segmented"
    nested = re.search(r"\[DhtmlXQ_movelist\](\d+)\[/DhtmlXQ_movelist\]", inner)
    if nested:
        return nested.group(1), "nested"
    return "", "none"


def mine_listing(book, vol, vol_index, delay, out):
    """Fetch every record linked from one listing page. vol may be None (flat book)."""
    idx = get(book + (f"{vol}/" if vol else ""))
    label = vol or "(flat)"
    if idx is None:
        print(f"  !! listing {label} failed", flush=True)
        return
    ids = sorted({int(x) for x in re.findall(r"view_u_(\d+)\.html", idx)})
    print(f"vol {vol_index} ({label}): {len(ids)} entries listed", flush=True)
    time.sleep(delay)
    for gid in ids:
        url = RECORD_URL.format(gid=gid)
        page = get(url)
        time.sleep(delay)
        if page is None:
            print(f"  {gid}: fetch failed", flush=True)
            continue
        segs = segments(page)
        main, shape = mainline(page)
        rec = {
            "id": gid,
            "vol": vol_index,
            "volName": vol,
            "title": tag(page, "title"),
            "binit": tag(page, "binit"),
            "mainline": main,
            "shape": shape,
            "variations": [s for s in segs if s["key"] != "0_1_0"],
            "comments": comments(page),
            "url": url,
        }
        out.append(rec)
        if not main or not rec["binit"]:
            missing = "mainline" if not main else "binit"
            note = f" (has {len(rec['comments'])} comment tags)" if rec["comments"] else ""
            print(f"  {gid} {rec['title'][:16]}: NO {missing}{note}", flush=True)


def main():
    args = parse_args()
    out = []
    if args.no_volumes:
        mine_listing(args.book, None, 1, args.delay, out)
    else:
        for vi, vol in enumerate([v for v in args.vols.split(",") if v], 1):
            mine_listing(args.book, vol, vi, args.delay, out)
            print(f"vol {vi} done, {len([r for r in out if r['vol'] == vi])} records", flush=True)

    with open(args.out, "w") as fh:
        json.dump(out, fh, ensure_ascii=False)

    from collections import Counter

    withmain = sum(1 for r in out if r["mainline"])
    withbinit = sum(1 for r in out if r["binit"])
    withcomments = sum(1 for r in out if r["comments"])
    thin = [r for r in out if len(r["mainline"]) <= 4]
    thin_with_prose = sum(1 for r in thin if r["comments"])
    print(f"\n{len(out)} records; {withmain} with a mainline, {withbinit} with a start position")
    print(f"movelist shapes: {dict(Counter(r['shape'] for r in out))}")
    print(f"variation segments captured: {sum(len(r['variations']) for r in out)}")
    print(f"records carrying comment tags: {withcomments}")
    print(
        f"records whose mainline is one move or less: {len(thin)}, "
        f"{thin_with_prose} of which carry prose"
    )
    if len(thin) != thin_with_prose:
        print("  ^ the difference is compositions with neither a line nor a written answer")


if __name__ == "__main__":
    main()
