"""Pack books into render jobs (~60 records each, small books sharing an agent) and
book-block groups, for the manual-mining-lean-jobs workflow.

    python3 lean_jobs.py --dir <corpus> --only a,b,c --out stage1.json [--job-size 60] [--group-size 6]

Runs lean_args.py's per-book prep first (soundness rule, slim shards).
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    p.add_argument("--only", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--job-size", type=int, default=60)
    p.add_argument("--group-size", type=int, default=6)
    a = p.parse_args()
    tmp = a.out + ".books.json"
    r = subprocess.run(
        [sys.executable, os.path.join(HERE, "lean_args.py"), "--dir", a.dir, "--only", a.only, "--size", str(a.job_size), "--out", tmp],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        raise SystemExit(r.stderr + r.stdout)
    print(r.stdout.strip())
    books = json.load(open(tmp))

    # Render jobs: a big book's shards are one job each; small books pack together.
    jobs = []
    pack = {"label": None, "books": [], "shards": [], "records": 0}
    for b in books:
        for s in b["shards"]:
            shard = {"slug": b["slug"], "shard": s["shard"], "path": s["path"], "records": s["records"]}
            if s["records"] >= a.job_size * 0.6:
                jobs.append({"label": f"{b['slug']}#{s['shard']}", "books": [b], "shards": [shard], "records": s["records"]})
                continue
            if pack["records"] + s["records"] > a.job_size and pack["shards"]:
                jobs.append(pack)
                pack = {"label": None, "books": [], "shards": [], "records": 0}
            pack["shards"].append(shard)
            pack["records"] += s["records"]
            if b["slug"] not in [x["slug"] for x in pack["books"]]:
                pack["books"].append(b)
    if pack["shards"]:
        jobs.append(pack)
    for j in jobs:
        if j["label"] is None:
            j["label"] = "+".join(x["slug"] for x in j["books"])[:60]

    # Book-block groups: big books alone, small ones in groups.
    groups = []
    small = []
    for b in books:
        entry = {**{k: b[k] for k in ("slug", "name", "kind", "note", "singleStudy", "volNames", "total", "rulePublish", "rulePublishPerVol")}, "firstShard": b["shards"][0]["path"]}
        if b["total"] >= a.job_size:
            groups.append({"label": b["slug"], "books": [entry]})
        else:
            small.append(entry)
    for i in range(0, len(small), a.group_size):
        chunk = small[i : i + a.group_size]
        groups.append({"label": "+".join(x["slug"] for x in chunk)[:60], "books": chunk})

    json.dump({"jobs": jobs, "bookGroups": groups}, open(a.out, "w"), ensure_ascii=False)
    print(f"{len(books)} books -> {len(jobs)} render job(s), {len(groups)} book group(s); {len(jobs) + len(groups)} agents")
    for j in jobs:
        print(f"  job {j['label']:50} {j['records']:4} records {len(j['shards'])} shard(s)")
    for g in groups:
        print(f"  group {g['label']:48} {len(g['books'])} book(s)")


if __name__ == "__main__":
    sys.exit(main())
