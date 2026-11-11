#!/usr/bin/env python3
"""Local, resumable engine audit. Python for UCI/process control; TS for kernel replay.

Prepare with the TS companion, then:
  python3 scripts/variant-lab/rebirthfox-reanalyse.py --positions /tmp/rebirthfox-positions.json --game jieqi-new --nodes 1000000
  python3 scripts/variant-lab/rebirthfox-reanalyse.py --positions /tmp/rebirthfox-positions.json --suite
All raw searches are flushed to --cache (default /tmp/rebirthfox-reanalysis/searches.jsonl).
No network, provider SDKs, or hosted compute. Explicit binary paths; never substitute engines.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import math
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[2]
LAB = ROOT / 'scripts/variant-lab'
WORK = Path('/private/tmp/rebirthfox-reanalysis')
TOOLS = Path.home() / 'projects/tools'
ENGINE = Path.home() / 'projects/mistboard-engine'
ABJ = Path('/private/tmp/claude-501/-Users-brianliou-projects-mistboard/b61017db-5d19-4152-9436-daef3f9492bf/scratchpad/abjbuild/abjchess')
IDS = {
    'fog': 'dxq_cfa3ee3a-a688-4338-a626-e6c923b65bbb',
    'banqi': 'bq_6f89b56d-39d1-42ba-a39c-a413babc4807',
    'jieqi': 'jq_8f4e0d9c-01be-4480-a84e-3b469fedd28f',
    'duck': 'dkx_b076e2a8-60ee-4443-99aa-b69a7b584ec1',
    'jieqi-new': 'jq_a9840ec7-12a0-4f81-8b00-42d07934038e',
}
SPECS = {
    'fog': dict(binary=str(TOOLS / 'pikafish-6a59ee2f/src/pikafish'), version='6a59ee2f',
                net=str(TOOLS / 'pikafish-6a59ee2f/src/pikafish.nnue'), model='uci-wdl',
                options=['UCI_ShowWDL value true']),
    'banqi': dict(binary=str(WORK / 'banqi-target/release/banqi-engine'), version='0.3.0@45f0fdea',
                  net=str(Path.home() / 'projects/misty-banqi-wt-net/nets/misty-banqi-0.3.0.bqnn'),
                  model='linear-utility', options=['NoProgressLimit value 40']),
    'jieqi': dict(binary=str(ABJ), version='AB-JChess-20261031@efc83867',
                  net=str(TOOLS / 'AB-JChess/nets/abjchess-20261030.nnue'), model='chance-logistic-430',
                  options=['ChaseRule value default']),
    'duck': dict(binary=str(WORK / 'duck/src/stockfish'), version='1b5bdd40+duck-patch-f563b5aa/0.3.1',
                 model='uci-wdl', options=[f'VariantPath value {ROOT}/apps/server/src/duck-xiangqi.ini',
                 'UCI_Variant value duckxiangqi', 'Use NNUE value false', 'UCI_ShowWDL value true']),
}

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def sigmoid(x):
    return 1 / (1 + math.exp(-max(-700, min(700, x))))

def probability(row, family, legacy=False):
    if 'terminal_score' in row:
        return row['terminal_score']
    if row.get('mate') is not None:
        if not legacy:
            return 1.0 if row['mate'] > 0 else 0.0
        v = (21 - min(10, abs(row['mate']))) * 100 * (1 if row['mate'] > 0 else -1)
        return sigmoid(v * (.00269 if family == 'jieqi' else .00368208))
    cp = row.get('cp')
    if cp is None:
        return None
    if legacy:
        return sigmoid(max(-1000, min(1000, cp)) * (.00269 if family == 'jieqi' else .00368208))
    if family == 'banqi':
        return .5 + .5 * max(-1, min(1, cp / 1000))
    if family == 'jieqi':
        return sigmoid(cp / 430)
    if row.get('wdl'):
        w, d, _ = row['wdl']
        return (w + d/2) / 1000
    raise ValueError(f'{family}: engine omitted WDL; no silent win-curve fallback: {row}')

class UCI:
    def __init__(self, spec):
        self.spec = spec
        self.p = subprocess.Popen([spec['binary']], cwd=str(Path(spec['binary']).parent),
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        self.q = queue.Queue()
        def read():
            for line in self.p.stdout:
                self.q.put(line.rstrip())
            self.q.put(None)
        threading.Thread(target=read, daemon=True).start()
        self.send('uci')
        self.identity = self.until('uciok', 20)
        options = ['Threads value 1', 'Hash value 256'] if spec['model'] != 'linear-utility' else []
        if spec.get('net'):
            options.append('EvalFile value ' + spec['net'])
        for opt in options + spec['options']:
            self.send('setoption name ' + opt)
        self.send('isready')
        self.startup = self.until('readyok', 30)
        if any('using classical' in l or 'ERROR' in l or 'error EvalFile' in l for l in self.startup):
            raise RuntimeError(self.startup)

    def send(self, s):
        self.p.stdin.write(s + '\n'); self.p.stdin.flush()

    def until(self, token, timeout):
        deadline = time.monotonic() + timeout
        lines = []
        while True:
            try:
                line = self.q.get(timeout=max(.01, deadline-time.monotonic()))
            except queue.Empty:
                self.p.kill()
                raise TimeoutError(f'{token}: {lines[-3:]}')
            if line is None:
                raise RuntimeError(f'engine exited {self.p.poll()}: {lines[-5:]}')
            lines.append(line)
            if line == token or line.startswith(token + ' '):
                return lines

    def search(self, position, nodes, forced=None):
        self.send('ucinewgame')  # cold hash for each independent estimate
        self.send('isready'); self.until('readyok', 10)
        self.send('position fen ' + position['fen'] + (' moves ' + ' '.join(position['moves']) if position['moves'] else ''))
        cmd = f'go nodes {nodes}'
        if self.spec['model'] == 'linear-utility':
            cmd += ' movetime 0'
        if forced:
            cmd += ' searchmoves ' + forced
        t = time.monotonic(); self.send(cmd)
        lines = self.until('bestmove', 900)
        exact = [l for l in lines if re.search(r'\bscore (cp|mate) -?\d+', l) and 'lowerbound' not in l and 'upperbound' not in l and (' multipv ' not in l or ' multipv 1 ' in l)]
        row = dict(wall_seconds=time.monotonic()-t, best=lines[-1].split()[1], info=exact[-1] if exact else None)
        if not exact:
            raise RuntimeError(f'no exact score: {lines[-5:]}')
        line = exact[-1]
        kind, val = re.search(r'\bscore (cp|mate) (-?\d+)', line).groups()
        row[kind] = int(val)
        for field in ['nodes', 'depth', 'time']:
            m = re.search(r'\b' + field + r' (\d+)', line)
            row[field] = int(m[1]) if m else None
        m = re.search(r'\bwdl (\d+) (\d+) (\d+)', line)
        row['wdl'] = list(map(int,m.groups())) if m else None
        row['pv'] = line.split(' pv ')[1].split() if ' pv ' in line else []
        if forced and row['best'] != forced:
            raise RuntimeError(f'forced move not searched: {forced}: {row}')
        return row

    def close(self):
        if self.p.poll() is None:
            self.send('quit')
            try: self.p.wait(timeout=3)
            except subprocess.TimeoutExpired: self.p.kill(); self.p.wait()
        self.p.stdin.close(); self.p.stdout.close()

class Audit:
    def __init__(self, args):
        self.args = args
        self.games = json.loads(Path(args.positions).read_text())
        self.cache = {}
        self.path = Path(args.cache); self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            for line in self.path.read_text().splitlines():
                entry = json.loads(line); self.cache[entry['key']] = entry['value']
        self.stream = self.path.open('a', buffering=1)
        self.engines = {}; self.errors = {}; self.series = {}
        self.lock = threading.Lock()
        self.stopping = threading.Event()

    def evaluate(self, name, pos, nodes, forced=None):
        if self.stopping.is_set(): raise InterruptedError('audit stopped')
        family = 'jieqi' if name.startswith('jieqi') else name
        if pos['terminal'] and not forced:
            winner = pos['terminal'].get('winner')
            return dict(terminal_score=.5 if winner is None else float(winner == pos['mover']), best=None, nodes=0)
        spec = SPECS[family]
        key_data = [spec['version'], spec['model'], nodes, pos['position'], forced]
        key = hashlib.sha256(json.dumps(key_data, sort_keys=True).encode()).hexdigest()
        if key in self.cache: return self.cache[key]
        if getattr(self.args,'cached_only',False): raise LookupError('not cached')
        engine_key = (family, threading.get_ident())
        if engine_key not in self.engines:
            self.engines[engine_key] = UCI(spec)
        try:
            row = self.engines[engine_key].search(pos['position'], nodes, forced)
        except RuntimeError as e:
            # Fog allows moves standard xiangqi forbids (a general left in check);
            # Pikafish refuses such a line and exits. Record the gap, restart, go on.
            if family != 'fog' or 'CRITICAL ERROR' not in str(e): raise
            eng = self.engines.pop(engine_key)
            try: eng.close()
            except Exception: pass
            with self.lock:
                gaps = self.errors.setdefault('fog_not_legal_xiangqi', [])
                if pos['position'] not in gaps: gaps.append(pos['position'])
            raise LookupError('not a legal xiangqi position')
        # Fail closed on missing conversion rather than cache a vacuous score.
        probability(row, family)
        with self.lock:
            self.stream.write(json.dumps(dict(key=key, request=key_data, value=row))+'\n')
            self.cache[key] = row
        return row

    def run_series(self, name, nodes, indices=None, tag=None):
        game = self.games[IDS[name]]; pp = game['positions']
        family = 'jieqi' if name.startswith('jieqi') else name
        tag = tag or str(nodes)
        # Partial-budget series still stores the actual position indices.
        selected = list(range(len(pp))) if indices is None else sorted(set(indices))
        series = dict(engine=family, version=SPECS[family]['version'], requested_nodes=nodes,
                      conversion=SPECS[family]['model'], threads=1, hash_mb=256 if family != 'banqi' else None,
                      cold_hash=True, positions={}, decisions={}, coverage=selected)
        start = time.monotonic()
        def work(i):
            if i >= len(pp): return i, None
            try: return i, self.evaluate(name,pp[i],nodes)
            except LookupError: return i, None
        # One independent one-thread engine per worker; no shared UCI stdin.
        with ThreadPoolExecutor(max_workers=self.args.workers) as pool:
            futures = [pool.submit(work,i) for i in selected]
            completed = []
            try:
                for f in as_completed(futures):
                    completed.append(f.result())
                    if len(completed)%10==0: print(f'{name}/{tag}: searched {len(completed)}/{len(selected)}',flush=True)
            except BaseException:
                self.stopping.set()
                for f in futures: f.cancel()
                raise
        for i, row in sorted(completed):
            if i >= len(pp) or row is None: continue
            p = pp[i]
            score = probability(row,family); legacy = probability(row,family,True)
            series['positions'][str(i)] = dict(**row, stm=p['mover'], expected_score=score,
                red_score=score if p['mover']=='red' else 1-score,
                site_curve_red_score=legacy if p['mover']=='red' else 1-legacy)
            if i % 10 == 0: print(f'{name}/{tag}: position {i}/{len(pp)-1}', flush=True)
        for i in selected:
            if i >= len(pp)-1 or str(i) not in series['positions']: continue
            p = pp[i]; before = series['positions'][str(i)]
            after = series['positions'].get(str(i+1))
            forced = None
            if family in ('banqi','jieqi'):
                try:
                    forced = before if before['best'] == p['played'] else self.evaluate(name,p,nodes,p['played'])
                except LookupError: pass
                expected = probability(forced,family) if forced else None
                legacy_expected = probability(forced,family,True) if forced else None
            elif family == 'duck':
                expected = legacy_expected = None
            elif after:
                expected = 1-after['expected_score']
                legacy_expected = after['site_curve_red_score'] if p['mover']=='red' else 1-after['site_curve_red_score']
            else: continue
            # Duck's cross-budget test uses ONLY same-side-to-move positions.
            paired = series['positions'].get(str(i+2)) if family == 'duck' else None
            if family == 'duck':
                expected = paired['expected_score'] if paired else None
                legacy_expected = (paired['site_curve_red_score'] if p['mover']=='red' else 1-paired['site_curve_red_score']) if paired else None
                if not paired and after and pp[i+1]['terminal']:
                    expected = 1-after['expected_score']
                    legacy_expected = expected
            cost = before['expected_score']-expected if expected is not None else None
            actual = (1-after['expected_score']) if after else None
            d = dict(ply=i+1, mover=p['mover'], move=p['move'], engine_move=p['played'], chance=p['chance'],
                reveal=p['reveal'], before=before['expected_score'], expected_after=expected,
                cost=cost, nonnegative_cost=max(0,cost) if cost is not None else None,
                actual_after=actual, luck=(actual-expected) if p['chance'] and actual is not None and expected is not None else None,
                best=before['best'], forced=forced,
                site_curve_before=before['site_curve_red_score'] if p['mover']=='red' else 1-before['site_curve_red_score'],
                site_curve_expected_after=legacy_expected,
                attribution='two-ply net change (includes opponent reply)' if family=='duck' else ('pre-reveal restricted root' if family in ('banqi','jieqi') else 'adjacent full-information positions'))
            series['decisions'][str(i+1)] = d
        series['turning_points'] = turning_points(series)
        series['complete_positions'] = len(series['positions']) == len(selected)
        series['complete_decisions'] = all(d['cost'] is not None for d in series['decisions'].values()) and len(series['decisions']) == sum(i<len(pp)-1 for i in selected)
        series['elapsed_seconds_this_invocation'] = time.monotonic()-start
        series['search_wall_seconds_including_cache'] = sum(r.get('wall_seconds',0) for r in series['positions'].values()) + sum(d['forced'].get('wall_seconds',0) for d in series['decisions'].values() if d['forced'] and d['forced'] is not series['positions'].get(str(d['ply']-1)))
        self.series.setdefault(name,{})[tag] = series
        self.save()
        return series

    def save(self):
        result = dict(_meta=dict(schema_version=1, created_utc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
            local_only=True, command=' '.join(sys.argv), errors=self.errors, engines={},
            sizing=dict(base_shard=dict(game='jieqi-new',nodes=1000000,wall_seconds=55.08366579201538,
                positions=49,restricted_searches=31), duck_probe=dict(nodes=5000000,wall_seconds=31.417068457987625),
                maximum_engine_workers=4,target_hours=3,estimated_active_minutes=155,
                estimate_basis='Duck dominates: 69 × 50M / ~159k nps / 4 workers ≈ 90 min, plus other sweeps and fog belief replays. Shared-Mac pauses are excluded.')),
            games={})
        for family, spec in SPECS.items():
            provenance = dict(spec)
            for key in ['binary','net']:
                if spec.get(key) and Path(spec[key]).is_file(): provenance[key+'_sha256'] = digest(spec[key])
            matching = [e for (f,_),e in self.engines.items() if f==family]
            if matching:
                provenance['uci_identity'] = matching[0].identity
                provenance['startup'] = matching[0].startup
            result['_meta']['engines'][family] = provenance
        for name, room in IDS.items():
            game = self.games[room]
            result['games'][room] = dict(name=name, variant=game['variant'], export_sha256=digest(LAB/'rebirthfox-exports'/f'{room}.json'),
                players=game['export']['players'], result=game['export']['result'], termination=game['export']['termination'],
                ply_count=game['export']['ply_count'], public_export=game['export'], series=self.series.get(name,{}))
        out = Path(self.args.out); out.parent.mkdir(parents=True,exist_ok=True)
        tmp = out.with_suffix('.tmp'); tmp.write_text(json.dumps(result,indent=2)+'\n'); tmp.replace(out)

    def close(self):
        for e in self.engines.values(): e.close()
        self.stream.close()

def turning_points(series, side=None):
    ds = [d for d in series['decisions'].values() if d['cost'] is not None and (side is None or d['mover']==side)]
    selected = set()
    for color in ['red','black']:
        ranked = sorted((d for d in ds if d['mover']==color and d['cost']>0),key=lambda d:(-d['cost'],d['ply']))
        selected.update(d['ply'] for d in ranked[:3])
    selected.update(d['ply'] for d in ds if (d['before']-.5)*(d['expected_after']-.5)<0)
    return sorted(selected)

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--positions',default=str(WORK/'positions.json'))
    ap.add_argument('--cache',default=str(WORK/'searches.jsonl'))
    ap.add_argument('--out',default=str(LAB/'rebirthfox-reanalysis.json'))
    ap.add_argument('--game',choices=list(IDS)); ap.add_argument('--nodes',type=int,default=1_000_000)
    ap.add_argument('--suite',action='store_true'); ap.add_argument('--resume-output',action='store_true')
    ap.add_argument('--workers',type=int,default=1)
    ap.add_argument('--only',nargs='+',choices=list(IDS))
    ap.add_argument('--allow-saturated',action='store_true',help='Use only after explicit operator authorization')
    ap.add_argument('--cached-only',action='store_true',help='Materialize completed cached work; starts no engines')
    args=ap.parse_args(); audit=Audit(args)
    if not 1 <= args.workers <= 4: ap.error('workers must be 1..4 on this shared Mac')
    guard=Path.home()/'projects/life-os/scripts/codex_load_guard.py'
    if not args.allow_saturated and not args.cached_only:
        state=json.loads(subprocess.check_output([sys.executable,str(guard),'--status'],text=True))
        if state['status'] != 'ready':
            print(json.dumps(state)); raise SystemExit('Load guard paused new work; no automatic retry.')
    WORK.mkdir(parents=True,exist_ok=True)
    (WORK/'runner.pid').write_text(str(os.getpid()))
    if args.resume_output and Path(args.out).exists():
        old=json.loads(Path(args.out).read_text())
        audit.series={g['name']:g['series'] for g in old['games'].values()}; audit.errors=old['_meta'].get('errors',{})
    try:
        if args.game: audit.run_series(args.game,args.nodes)
        if args.suite:
            for name in ['banqi','jieqi-new','fog','jieqi','duck']:
                if args.only and name not in args.only: continue
                try:
                    base=audit.run_series(name,300_000 if name=='duck' else 1_000_000)
                    if name=='jieqi': audit.run_series(name,50_000)
                    if name in ['fog','jieqi','jieqi-new','banqi']:
                        # Full high-budget sweeps permit exact top-three re-ranking,
                        # not merely rescoring a preselected list.
                        audit.run_series(name,20_000_000 if name!='banqi' else 5_000_000)
                    if name=='duck':
                        # Black-to-move indices are odd, including each reply endpoint.
                        indices=[i for i in range(len(audit.games[IDS[name]]['positions'])) if i%2]
                        audit.run_series(name,5_000_000,indices)
                        audit.run_series(name,50_000_000,indices)
                except Exception as exc:
                    audit.errors[name]=f'{type(exc).__name__}: {exc}'; print(name,audit.errors[name],flush=True); audit.save()
    finally:
        audit.save(); audit.close()

if __name__=='__main__': main()
