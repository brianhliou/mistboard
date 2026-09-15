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

LISTINGS PAGINATE. A leaf listing shows 100 records and links the rest as 2.html,
3.html ...; the first pass never saw this because every 適情雅趣 volume is under
100, and it would have mined exactly 100 of 心武残编's 155 and reported the book
complete. Every listing is now followed to its last page.

PROGRESS IS DURABLE. Each record is appended to `<out>.partial.jsonl` the moment
it is fetched, and a rerun skips ids already there, so a failure at record 540
costs one record, not the run. `<out>` itself (the JSON the seeder reads) is
written at the end, and `<out>.summary.json` says whether listed == mined.

Usage:
  python3 mine_v2.py --out records.json                          # 適情雅趣, six volumes
  python3 mine_v2.py --out kjm.json --book <url> --no-volumes    # a flat, unvolumed book
  python3 mine_v2.py --out x.json --book <url> --vols 卷一,卷二
  python3 mine_v2.py --out x.json --book <url> --vols auto       # first-level subdirs, sorted
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request

UA = {"User-Agent": "mistboard-corpus-survey/1.0 (+https://mistboard.com; contact brianhliou@gmail.com)"}
RECORD_URL = "http://www.dpxq.com/hldcg/search/view_{owner}_{gid}.html"
# dpxq's flat re-listing of a whole book; a duplicate of the volumes, never a volume.
LISTING_MIRROR = "棋谱列表"

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
        help="comma-separated volume directory names under --book, or `auto` to take "
        "the book's first-level subdirectories in sorted order",
    )
    p.add_argument(
        "--skip-vols",
        default="",
        help="comma-separated subdirectory names to leave out of `--vols auto` "
        "(prefaces and prose shelved beside the compositions)",
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


def listing_records(html):
    """(owner, id) for every record a listing page links; owner is `u` or `m`."""
    return {(o, int(g)) for o, g in re.findall(r"view_([um])_(\d+)\.html", html)}


def discover_volumes(book, skip):
    """The book's first-level subdirectories, sorted, minus the flat mirror and `skip`."""
    idx = get(book)
    if idx is None:
        return None
    path = urllib.parse.urlparse(book).path
    found = []
    for href in re.findall(r'href="([^"]+/)"', idx):
        href = urllib.parse.unquote(href)
        if not href.startswith(path) or href == path:
            continue
        rel = href[len(path):].rstrip("/")
        if "/" in rel or not rel or rel in found:
            continue
        if rel.startswith(LISTING_MIRROR) or rel in skip:
            continue
        found.append(rel)
    return sorted(found)


def list_volume(book, vol, delay):
    """Every record in one listing, following 2.html, 3.html ... to the last page.

    Returns None when the first page cannot be fetched, else the sorted ids. A
    later page failing three times is reported and the listing is treated as
    truncated: the summary will show listed < the book's directory, not a clean
    total that hides a missing page.
    """
    base = book + (f"{vol}/" if vol else "")
    idx = get(base)
    if idx is None:
        return None, False
    found = listing_records(idx)
    truncated = False
    current = base
    seen_pages = {base}
    while True:
        nxt = next_page(idx, current)
        if nxt is None or nxt in seen_pages:
            break
        time.sleep(delay)
        idx = get(nxt)
        if idx is None:
            truncated = True
            print(f"  !! listing {vol or '(flat)'} page {nxt.rsplit('/', 1)[-1]} failed", flush=True)
            break
        seen_pages.add(nxt)
        current = nxt
        new = listing_records(idx) - found
        if not new:
            break
        found |= new
    return sorted(found, key=lambda r: r[1]), truncated


def next_page(html, current):
    """The absolute URL dpxq's 下一页 link points at, or None on the last page.

    The pager is `[首页] 上一页 下一页` with numbered `N.html` targets; on the
    last page 下一页 points back at the page itself, which the caller treats as
    the end. Counting to 100 was the alternative and it cannot tell a listing of
    exactly 100 from a truncated one.
    """
    m = re.search(r'href="([^"]+)"[^>]*>\s*下一页', html)
    if not m:
        return None
    href = urllib.parse.unquote(m.group(1))
    return urllib.parse.urljoin(current, href)


def mine_listing(book, vol, vol_index, delay, out, done, partial):
    """Fetch every record linked from one listing page. vol may be None (flat book).

    `done` is the set of ids already on disk from an earlier attempt; `partial` is
    the open JSONL file each new record is appended to. Returns (listed, truncated).
    """
    label = vol or "(flat)"
    ids, truncated = list_volume(book, vol, delay)
    if ids is None:
        print(f"  !! listing {label} failed", flush=True)
        return 0, True
    pending = [(o, g) for o, g in ids if g not in done]
    print(
        f"vol {vol_index} ({label}): {len(ids)} entries listed, {len(ids) - len(pending)} already mined",
        flush=True,
    )
    time.sleep(delay)
    for owner, gid in pending:
        url = RECORD_URL.format(owner=owner, gid=gid)
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
        partial.write(json.dumps(rec, ensure_ascii=False) + "\n")
        partial.flush()
        if not main or not rec["binit"]:
            missing = "mainline" if not main else "binit"
            note = f" (has {len(rec['comments'])} comment tags)" if rec["comments"] else ""
            print(f"  {gid} {rec['title'][:16]}: NO {missing}{note}", flush=True)
    return len(ids), truncated


def load_partial(path):
    """Records an earlier attempt already wrote, keyed by id (last write wins)."""
    found = {}
    if not os.path.exists(path):
        return found
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue  # a line cut short by the death this file exists to survive
            found[rec["id"]] = rec
    return found


def main():
    args = parse_args()
    partial_path = args.out + ".partial.jsonl"
    earlier = load_partial(partial_path)
    if earlier:
        print(f"resuming: {len(earlier)} records already in {partial_path}", flush=True)
    out = list(earlier.values())
    done = set(earlier)

    if args.no_volumes:
        vols = [None]
    elif args.vols == "auto":
        skip = {v for v in args.skip_vols.split(",") if v}
        vols = discover_volumes(args.book, skip)
        if vols is None:
            raise SystemExit(f"could not list {args.book}")
        if not vols:
            raise SystemExit(f"{args.book} has no subdirectories; use --no-volumes")
        print(f"volumes discovered: {' '.join(vols)}", flush=True)
    else:
        vols = [v for v in args.vols.split(",") if v]

    listed = 0
    truncated = False
    with open(partial_path, "a") as partial:
        for vi, vol in enumerate(vols, 1):
            n, cut = mine_listing(args.book, vol, vi, args.delay, out, done, partial)
            listed += n
            truncated = truncated or cut
            print(f"vol {vi} done, {len([r for r in out if r['vol'] == vi])} records", flush=True)

    # Re-key volumes for resumed records: a rerun with the same --vols keeps them.
    out.sort(key=lambda r: (r["vol"], r["id"]))
    with open(args.out, "w") as fh:
        json.dump(out, fh, ensure_ascii=False)
    summary = {
        "book": args.book,
        "volumes": vols,
        "listed": listed,
        "mined": len(out),
        "listingTruncated": truncated,
        "complete": (not truncated) and listed == len(out),
    }
    with open(args.out + ".summary.json", "w") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=2)
    print(f"listed {listed}, mined {len(out)}, complete={summary['complete']}", flush=True)

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
