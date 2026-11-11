#!/usr/bin/env python3
"""Replay redacted site requests through the actual Misty FDX v1.2 profile.

Run with mistboard-engine/.venv/bin/python; never hand the bot a true FEN.
State is maintained separately for each mover; each budget is an independent
replay with seed 20261111. Output is JSONL, flushed after every decision.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import sys
import time

ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--positions', default='/private/tmp/rebirthfox-reanalysis/positions.json')
ap.add_argument('--out', default='/private/tmp/rebirthfox-reanalysis/fog-misty.jsonl')
ap.add_argument('--seconds', type=float, default=4)
ap.add_argument('--limit', type=int, default=48)
args = ap.parse_args()
engine_dir = Path.home() / 'projects/mistboard-engine'
sys.path.insert(0, str(engine_dir/'src'))
os.environ['FOW_XIANGQI_PIKAFISH'] = str(Path.home()/'projects/tools/pikafish-6a59ee2f/src/pikafish')
os.environ['FOW_XIANGQI_PIKAFISH_NET'] = str(Path.home()/'projects/tools/pikafish-6a59ee2f/src/pikafish.nnue')
os.environ['FOW_XIANGQI_SHROUD_BLOCKERS'] = '1'
spec = importlib.util.spec_from_file_location('rebirthfox_live_worker',engine_dir/'scripts/live_move_worker.py')
worker = importlib.util.module_from_spec(spec); sys.modules[spec.name] = worker; spec.loader.exec_module(worker)
from fow_chess import engine_protocol as proto, rust_health
from fow_chess.xiangqi import protocol_adapter as adapter

if not rust_health.available():
    raise RuntimeError(rust_health.report())
if not worker._xiangqi_pikafish_available():
    raise RuntimeError('Pikafish leaf unavailable: refusing material fallback')
profile=worker._xiangqi_profile('python-fdx-v1.2')
games=json.loads(Path(args.positions).read_text())
pp=games['dxq_cfa3ee3a-a688-4338-a626-e6c923b65bbb']['positions']
engines={}; processed={}
out=Path(args.out).open('w',buffering=1)
def label(m):
    return proto._int_to_square(m.from_square,9)+proto._int_to_square(m.to_square,9)
def choose(eng, legal):
    return eng.choose_move(iterations=profile['iterations'], i_sample_size=profile['i_sample_size'],
        kluss_k=profile['kluss_k'], time_budget_seconds=args.seconds,
        use_rust_tree=profile['use_rust_tree'], legal_moves=legal)
try:
    for i,p in enumerate(pp[:args.limit]):
        req=proto.request_from_json(p['fogRequest'])
        side=adapter.color_from_protocol(req.color)
        t=time.monotonic()
        if side not in engines:
            engines[side]=worker._build_xiangqi_engine(side,20261111,'python-fdx-v1.2')
            processed[side]=adapter.replay_transcript_into_engine(engines[side],req)
        else:
            processed[side]=adapter.feed_transcript_tail_into_engine(engines[side],req,processed[side])
        eng=engines[side]
        best=choose(eng,[adapter.move_from_protocol(m) for m in req.legal_moves])
        sol=eng.last_solution
        values={label(m):float(v) for m,v in (sol.action_values_at_root or {}).items()}
        pv=p['move']
        chosen=label(best)
        row=dict(ply=i+1,mover=p['mover'],move=pv,best=chosen,
            budget_seconds=args.seconds,profile=profile,seed=20261111,
            belief_size=eng.enumerator.size,iterations=sol.iterations,
            value_at_root=sol.value_at_root,values=values,
            before=(1+max(values.values()))/2 if values else None,
            expected_after=(1+values[pv])/2 if pv in values else None,
            decision_source='site-profile-v1.2',observation_count=processed[side],
            leaf='Pikafish 6a59ee2f depth 1',guards=worker._commit_guard_telemetry(eng))
        row['policy_expected_score']=(1+sol.value_at_root)/2
        row['search_best']=max(values,key=values.get) if values else None
        row['committed_move_expected_score']=(1+values[chosen])/2 if chosen in values else None
        if row['expected_after'] is None:
            # Same root, same perspective, restricted action. If the site's
            # candidate filter still excludes it, retain null explicitly.
            legal=[adapter.move_from_protocol(m) for m in req.legal_moves if label(adapter.move_from_protocol(m))==pv]
            if legal:
                choose(eng,legal)
                forced=eng.last_solution
                fv={label(m):float(v) for m,v in (forced.action_values_at_root or {}).items()}
                row['restricted_values']=fv
                row['expected_after']=(1+fv[pv])/2 if pv in fv else None
        row['cost']=row['before']-row['expected_after'] if row['before'] is not None and row['expected_after'] is not None else None
        row['wall_seconds']=time.monotonic()-t
        out.write(json.dumps(row)+'\n')
        print(f'fog misty {args.seconds}s: ply {i+1} belief {row["belief_size"]} cost {row["cost"]}',flush=True)
finally:
    for e in engines.values(): e.close()
    out.close()
