"""Walk books.json and mine every book marked `mine`, one at a time, resumably.

One process, sequential, the same 1.2 s politeness as a single book: the fan-out
for this corpus goes on the agent work downstream, never on dpxq's server, which
is run by one person we are on good terms with.

Resumable at two levels. A book whose `<slug>.json.summary.json` says complete is
skipped; inside a book, mine_v2.py appends each record to `<slug>.json.partial.jsonl`
as it lands and skips those ids on a rerun. Killing this at any point costs one
record.

    python3 mine_books.py --out ~/projects/xiangqi-corpus/dpxq-compositions
    python3 mine_books.py --out ... --only bai-ju-xiangqi-pu,hu-ya-ji
    python3 mine_books.py --out ... --status        # per-book state, no network
"""
import argparse
import json
import os
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PLAN = os.path.join(HERE, "books.json")
MINER = os.path.join(HERE, "mine_v2.py")


def parse_args():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", required=True, help="directory the per-book JSON files go to (outside any git repo)")
    p.add_argument("--only", default="", help="comma-separated slugs to restrict the run to")
    p.add_argument("--status", action="store_true", help="print each book's state and exit")
    p.add_argument("--delay", type=float, default=1.2)
    return p.parse_args()


def summary_for(out_dir, slug):
    path = os.path.join(out_dir, f"{slug}.json.summary.json")
    if not os.path.exists(path):
        return None
    with open(path) as fh:
        return json.load(fh)


def partial_count(out_dir, slug):
    path = os.path.join(out_dir, f"{slug}.json.partial.jsonl")
    if not os.path.exists(path):
        return 0
    with open(path) as fh:
        return sum(1 for line in fh if line.strip())


def state_of(out_dir, book):
    if book["status"] == "skip":
        return "skip"
    if book["status"] == "done":
        return "done"
    summary = summary_for(out_dir, book["slug"])
    if summary and summary.get("complete"):
        return "complete"
    if summary:
        return f"incomplete ({summary['mined']}/{summary['listed']})"
    n = partial_count(out_dir, book["slug"])
    return f"partial ({n})" if n else "pending"


def miner_args(plan, book, out_dir, delay):
    url = plan["root"] + book["section"] + "/" + book.get("dir", book["name"]) + "/"
    args = [sys.executable, MINER, "--out", os.path.join(out_dir, f"{book['slug']}.json"), "--book", url, "--delay", str(delay)]
    vols = book.get("vols")
    if vols is None:
        args.append("--no-volumes")
    elif vols == "auto":
        args += ["--vols", "auto"]
        if book.get("skipVols"):
            args += ["--skip-vols", ",".join(book["skipVols"])]
    else:
        args += ["--vols", ",".join(vols)]
    return args


def main():
    args = parse_args()
    with open(PLAN) as fh:
        plan = json.load(fh)
    os.makedirs(args.out, exist_ok=True)
    only = {s for s in args.only.split(",") if s}
    books = [b for b in plan["books"] if not only or b["slug"] in only]

    if args.status:
        for b in books:
            print(f"{state_of(args.out, b):<24} {b['slug']:<30} {b['name']} (expected {b['expected']})")
        return 0

    failures = []
    for b in books:
        state = state_of(args.out, b)
        if state in ("skip", "done", "complete"):
            print(f"== {b['slug']}: {state}, skipping", flush=True)
            continue
        print(f"== {b['slug']} {b['name']}: {state}, expected {b['expected']} -- {time.strftime('%H:%M:%S')}", flush=True)
        result = subprocess.run(miner_args(plan, b, args.out, args.delay))
        summary = summary_for(args.out, b["slug"])
        if result.returncode != 0 or not summary or not summary.get("complete"):
            failures.append(b["slug"])
            print(f"!! {b['slug']}: exit {result.returncode}, summary {summary}", flush=True)
            continue
        drift = summary["mined"] - b["expected"]
        flag = "" if drift == 0 else f"  (expected {b['expected']}, drift {drift:+d})"
        print(f"== {b['slug']}: complete, {summary['mined']} records{flag}", flush=True)

    print(f"\ndone at {time.strftime('%H:%M:%S')}; {len(failures)} book(s) need a rerun: {' '.join(failures) or 'none'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
