"""Build the workflow args for a mining wave: every book that is fetched, replayed
and swept, minus the ones already handed to an earlier wave.

    python3 wave_args.py --dir ~/projects/xiangqi-corpus/dpxq-compositions \
        --exclude bai-ju-xiangqi-pu,jiao-chuang-yi-pin --size 40 --out wave2.args.json

Runs make-shards.mjs per book (it refuses a book whose sweep is incomplete, and
that refusal is the readiness check), then writes the args array the
manual-mining-wave workflow takes: slug, name, kind, note, total, shards.
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dir", required=True)
    p.add_argument("--exclude", default="", help="comma-separated slugs already in an earlier wave")
    p.add_argument("--only", default="", help="comma-separated slugs to restrict to")
    p.add_argument("--size", type=int, default=40)
    p.add_argument("--out", required=True)
    args = p.parse_args()

    plan = json.load(open(os.path.join(HERE, "books.json")))
    exclude = {s for s in args.exclude.split(",") if s}
    only = {s for s in args.only.split(",") if s}
    books, skipped = [], []
    for b in plan["books"]:
        slug = b["slug"]
        if b["status"] != "mine" or slug in exclude or (only and slug not in only):
            continue
        summary = os.path.join(args.dir, f"{slug}.json.summary.json")
        if not os.path.exists(summary) or not json.load(open(summary)).get("complete"):
            skipped.append((slug, "fetch incomplete"))
            continue
        if not os.path.exists(os.path.join(args.dir, f"{slug}.verify.json")):
            skipped.append((slug, "not verified"))
            continue
        r = subprocess.run(
            [
                "node",
                os.path.join(HERE, "make-shards.mjs"),
                "--dir", args.dir, "--slug", slug, "--size", str(args.size),
            ],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            skipped.append((slug, r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "make-shards failed"))
            continue
        shards = json.loads(r.stdout.strip().splitlines()[-1])
        books.append(
            {
                "slug": slug,
                "name": b["name"],
                "kind": b["kind"],
                "note": b.get("note", ""),
                "total": shards["total"],
                "shards": [{"shard": s["shard"], "path": s["path"], "records": s["records"]} for s in shards["shards"]],
            }
        )
    json.dump(books, open(args.out, "w"), ensure_ascii=False, indent=1)
    print(f"{len(books)} books, {sum(b['total'] for b in books)} records, {sum(len(b['shards']) for b in books)} shards -> {args.out}")
    for slug, why in skipped:
        print(f"  not ready: {slug} ({why})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
