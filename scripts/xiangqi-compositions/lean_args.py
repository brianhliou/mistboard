"""Args for the lean workflow: classify soundness, cut slim shards, count what the rule publishes.

    python3 lean_args.py --dir ~/projects/xiangqi-corpus/dpxq-compositions --only mei-hua-pu,mei-hua-quan --out stage.json
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SINGLE_STUDY_KINDS = {"games"}


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{' '.join(args)}\n{r.stderr}{r.stdout}")
    return r.stdout.strip().splitlines()[-1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    p.add_argument("--only", required=True)
    p.add_argument("--size", type=int, default=60)
    p.add_argument("--out", required=True)
    a = p.parse_args()
    plan = {b["slug"]: b for b in json.load(open(os.path.join(HERE, "books.json")))["books"]}
    out = []
    for slug in [s for s in a.only.split(",") if s]:
        b = plan[slug]
        run(["node", os.path.join(HERE, "classify-soundness.mjs"), "--dir", a.dir, "--slug", slug])
        shards = json.loads(run(["node", os.path.join(HERE, "make-slim-shards.mjs"), "--dir", a.dir, "--slug", slug, "--size", str(a.size)]))
        sound = json.load(open(os.path.join(a.dir, f"{slug}.sound.json")))
        raw = json.load(open(os.path.join(a.dir, f"{slug}.json")))
        single = b["kind"] in SINGLE_STUDY_KINDS and len({r["vol"] for r in raw}) > 1
        per_vol = {}
        for r in raw:
            if sound[str(r["id"])]["publish"]:
                v = 1 if single else r["vol"]
                per_vol[str(v)] = per_vol.get(str(v), 0) + 1
        vol_names = []
        for r in raw:
            if r["volName"] not in vol_names:
                vol_names.append(r["volName"])
        out.append(
            {
                "slug": slug,
                "name": b["name"],
                "kind": b["kind"],
                "note": b.get("note", ""),
                "singleStudy": single,
                "volNames": vol_names,
                "total": shards["total"],
                "rulePublish": sum(per_vol.values()),
                "rulePublishPerVol": per_vol,
                "shards": [{"shard": s["shard"], "path": s["path"], "records": s["records"]} for s in shards["shards"]],
            }
        )
        print(f"{slug:28} {shards['total']:4} records {len(shards['shards'])} shard(s)  rule publishes {sum(per_vol.values())}  single={single}")
    json.dump(out, open(a.out, "w"), ensure_ascii=False)
    print(f"-> {a.out}")


if __name__ == "__main__":
    sys.exit(main())
