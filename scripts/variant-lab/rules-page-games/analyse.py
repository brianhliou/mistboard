#!/usr/bin/env python3
"""Run a list of UCI searches on a local engine, resumably, for the rules-page studies.

The TypeScript builders (scripts/variant-lab/rules-page-games/*.ts) replay each game on the
site's own kernels and write a jobs file; this runs the searches and appends one JSON line
per job to --out, so a rerun skips what is done. Local engines only: no network, no hosted
compute.

  A job with "extend": N builds the engine's line by searching again after each move
  (for engines that print one-move PVs), stopping before a move from or to a square in
  "hidden".

  jobs.json: {"engine": {"binary": PATH, "options": ["Name value X", ...]},
              "limit": {"nodes": N} | {"movetime": MS},
              "jobs": [{"id": "p12", "fen": FEN, "moves": [...], "searchmoves": "a0a1"?}]}

  python3 -I scripts/variant-lab/rules-page-games/analyse.py --jobs jobs.json --out rows.jsonl

Each row: {"id", "best", "pv", "cp" | "mate", "wdl" (when the engine shows it), "depth", "nodes"},
scores from the side to move's point of view, as UCI reports them.
"""
from __future__ import annotations

import argparse
import json
import queue
import re
import subprocess
import threading
import time
from pathlib import Path


class Engine:
    def __init__(self, binary: str, options: list[str]):
        self.p = subprocess.Popen([binary], cwd=str(Path(binary).parent), stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.q: queue.Queue[str | None] = queue.Queue()

        def read():
            for line in self.p.stdout:
                self.q.put(line.rstrip())
            self.q.put(None)

        threading.Thread(target=read, daemon=True).start()
        self.send('uci')
        self.until('uciok', 30)
        for opt in options:
            self.send('setoption name ' + opt)
        self.send('isready')
        startup = self.until('readyok', 60)
        if any('ERROR' in l or 'error EvalFile' in l or 'using classical' in l for l in startup):
            raise RuntimeError(startup)

    def send(self, s: str) -> None:
        self.p.stdin.write(s + '\n')
        self.p.stdin.flush()

    def until(self, token: str, timeout: float) -> list[str]:
        deadline = time.monotonic() + timeout
        lines: list[str] = []
        while True:
            try:
                line = self.q.get(timeout=max(.01, deadline - time.monotonic()))
            except queue.Empty:
                self.p.kill()
                raise TimeoutError(f'{token}: {lines[-3:]}')
            if line is None:
                raise RuntimeError(f'engine exited {self.p.poll()}: {lines[-5:]}')
            lines.append(line)
            if line == token or line.startswith(token + ' '):
                return lines

    def search(self, job: dict, limit: dict) -> dict:
        self.send('ucinewgame')
        self.send('isready')
        self.until('readyok', 30)
        moves = job.get('moves') or []
        self.send('position fen ' + job['fen'] + (' moves ' + ' '.join(moves) if moves else ''))
        cmd = 'go ' + ' '.join(f'{k} {v}' for k, v in limit.items())
        if job.get('searchmoves'):
            cmd += ' searchmoves ' + job['searchmoves']
        self.send(cmd)
        lines = self.until('bestmove', 900)
        exact = [l for l in lines if re.search(r'\bscore (cp|mate) -?\d+', l)
                 and 'lowerbound' not in l and 'upperbound' not in l
                 and (' multipv ' not in l or ' multipv 1 ' in l)]
        row: dict = {'id': job['id'], 'best': lines[-1].split()[1]}
        if not exact:
            row['error'] = 'no exact score: ' + ' | '.join(lines[-3:])
            return row
        line = exact[-1]
        kind, val = re.search(r'\bscore (cp|mate) (-?\d+)', line).groups()
        row[kind] = int(val)
        for field in ('depth', 'nodes'):
            m = re.search(r'\b' + field + r' (\d+)', line)
            row[field] = int(m[1]) if m else None
        m = re.search(r'\bwdl (\d+) (\d+) (\d+)', line)
        row['wdl'] = list(map(int, m.groups())) if m else None
        # Some engines (AB-JChess) cut the final PV at a hash hit: keep the longest
        # exact PV of the last few depths that starts with the move played.
        pvs = [l.split(' pv ')[1].split() for l in exact[-6:] if ' pv ' in l]
        pvs = [pv for pv in pvs if pv and pv[0] == row['best']]
        row['pv'] = max(pvs, key=len) if pvs else []
        return row

    def close(self) -> None:
        if self.p.poll() is None:
            self.send('quit')
            try:
                self.p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.p.kill()


def extend(eng: Engine, job: dict, limit: dict, first: dict) -> list[str]:
    """The engine's line, one search per ply, for engines whose PV stops at one move.
    Stops before a move that touches a square in job["hidden"] (a face-down piece)."""
    line: list[str] = []
    best = first['best']
    hidden = set(job.get('hidden') or [])
    while best not in ('(none)', '0000') and len(line) < job['extend']:
        if best[:2] in hidden or best[2:4] in hidden:
            break
        line.append(best)
        nxt = eng.search({**job, 'moves': (job.get('moves') or []) + line, 'searchmoves': None}, limit)
        if 'error' in nxt and nxt['best'] in ('(none)', '0000'):
            break
        best = nxt['best']
    return line


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--jobs', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    spec = json.loads(Path(args.jobs).read_text())
    out = Path(args.out)
    done = set()
    if out.exists():
        done = {json.loads(l)['id'] for l in out.read_text().splitlines() if l.strip()}
    todo = [j for j in spec['jobs'] if j['id'] not in done]
    print(f'{len(todo)} of {len(spec["jobs"])} jobs to run', flush=True)
    if not todo:
        return
    eng = Engine(spec['engine']['binary'], spec['engine'].get('options', []))
    try:
        with out.open('a') as f:
            for i, job in enumerate(todo):
                row = eng.search(job, spec['limit'])
                if job.get('extend'):
                    row['pv'] = extend(eng, job, spec['limit'], row)
                f.write(json.dumps(row) + '\n')
                f.flush()
                print(i + 1, job['id'], row.get('cp', row.get('mate')), row['best'], flush=True)
    finally:
        eng.close()
    print('DONE', flush=True)


if __name__ == '__main__':
    main()
