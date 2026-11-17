#!/usr/bin/env python3
"""Merge flushed Misty decisions and render the audit. No engine work here."""
import importlib.util
import json
from pathlib import Path
import subprocess
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('audit',HERE/'rebirthfox-reanalyse.py')
a=importlib.util.module_from_spec(spec); spec.loader.exec_module(a)
path=HERE/'rebirthfox-reanalysis.json'
data=json.loads(path.read_text()); old=json.loads((HERE/'rebirthfox-games.json').read_text())
games={v['name']:v for v in data['games'].values()}
def pct(v): return 'unscored' if v is None else f'{100*v:.1f}%'
def points(v): return 'unscored' if v is None else f'{100*v:.1f} pp'
def highest(name):
    ss=games[name]['series']
    nums=[int(k) for k,s in ss.items() if k.isdigit() and s['positions']]
    return ss[str(max(nums))] if nums else None
def decision(name,ply):
    s=highest(name)
    return s and s['decisions'].get(str(ply))
def public_move(token,family):
    if not token: return '—'
    if family=='duck':
        import re
        halves=token.split(','); return halves[0]+('@'+re.sub(r'^[a-i](10|[1-9])','',halves[1]) if len(halves)>1 else '')
    def inc(m): return m[1]+str(int(m[2])+1)
    import re
    out=re.sub(r'([a-i])(\d)',inc,token)
    if family=='banqi' and out[:2]==out[2:]: return '@'+out[:2]
    return out

fog=games['fog']
for seconds in [4,20]:
    f=a.WORK/('fog-misty.jsonl' if seconds==4 else 'fog-misty-20s.jsonl')
    if not f.exists(): continue
    ds=[json.loads(line) for line in f.read_text().splitlines()]
    for d in ds:
        d['policy_expected_score']=(1+d['value_at_root'])/2
        d['search_best']=max(d['values'],key=d['values'].get) if d['values'] else None
        d['committed_move_expected_score']=(1+d['values'][d['best']])/2 if d['best'] in d['values'] else None
    series=dict(engine='Misty',version='python-fdx-v1.2',requested_seconds=seconds,
        conversion='(1+GT-CFR utility)/2',information='mover-only redacted site observation transcript',
        engine_git_sha=subprocess.check_output(['git','-C',str(a.ENGINE),'rev-parse','HEAD'],text=True).strip(),
        threads=1,positions={},decisions={str(d['ply']):d for d in ds},coverage=[d['ply']-1 for d in ds])
    series['turning_points']=a.turning_points(series)
    series['complete_positions']=len(ds)==48
    series['complete_decisions']=len(ds)==48 and all(d['cost'] is not None for d in ds)
    for d in ds:
        series['positions'][str(d['ply']-1)]=dict(stm=d['mover'],expected_score=d['before'],
            red_score=d['before'] if d['mover']=='red' else (1-d['before'] if d['before'] is not None else None),best=d['best'])
    fog['series'][f'misty-{seconds}s']=series

tests=[]
def compare(name,low,high,side=None):
    ss=games[name]['series']; lo=ss.get(low); hi=ss.get(high)
    if not lo or not hi: return
    if not lo.get('complete_positions') or not hi.get('complete_positions') or not hi.get('complete_decisions'): return
    base=a.turning_points(lo,side); deep=set(a.turning_points(hi,side))
    pairs=[(p,lo['decisions'].get(str(p)),hi['decisions'].get(str(p))) for p in base]
    scored=[(p,l,h) for p,l,h in pairs if h and h.get('cost') is not None]
    tests.append(dict(game=name,base=low,higher=high,side=side or 'both',
        base_turning_points=base,higher_turning_points=sorted(deep),survive=sum(p in deep for p,_,_ in scored),
        n=len(base),scored=len(scored),same_best=sum(l['best']==h['best'] for _,l,h in scored),
        details=[dict(ply=p,base_cost=l['cost'],higher_cost=h['cost'],base_best=l['best'],higher_best=h['best'],survives=p in deep) for p,l,h in scored]))
compare('fog','1000000','20000000')
compare('fog','misty-4s','misty-20s')
compare('jieqi','50000','1000000'); compare('jieqi','50000','20000000'); compare('jieqi','1000000','20000000')
compare('duck','300000','5000000','black'); compare('duck','300000','50000000','black'); compare('duck','5000000','50000000','black')
cross=None
if fog['series'].get('1000000') and fog['series'].get('misty-4s'):
    p=set(a.turning_points(fog['series']['1000000'])); m=set(a.turning_points(fog['series']['misty-4s']))
    cross=dict(pikafish_turning_points=sorted(p),misty_turning_points=sorted(m),
        common=sorted(p&m),agree=len(p&m),n=len(p),misty_n=len(m),union_n=len(p|m),
        misty_scored=len(fog['series']['misty-4s']['decisions']))
data['_meta']['weak_engine_tests']=tests; data['_meta']['fog_agreement']=cross

claims=[]
def add(claim,status,evidence): claims.append(dict(claim=claim,status=status,evidence=evidence))
def unresolved(claim): add(claim,'unresolved','Required sweep is incomplete.')
ban=highest('banqi')
if ban:
    d=ban['decisions']['15']; draw=-d['luck'] if d['luck'] is not None else None
    holds=d['best']==d['engine_move'] and abs(d['cost'])<.005 and abs(draw-.21)<.03
    add('Banqi: e1 was the engine’s own flip; all 21 points were the draw', 'holds' if holds else 'changes',
        f"Ply 15: {pct(d['before'])} → expected {pct(d['expected_after'])} → realized {pct(d['actual_after'])}; choice {points(d['cost'])}, draw loss {points(draw)}; best {public_move(d['best'],'banqi')}.")
    flips=[d for d in ban['decisions'].values() if d['mover']=='red' and d['chance']]
    total=sum(d['nonnegative_cost'] for d in flips if d['nonnegative_cost'] is not None); luck=-sum(d['luck'] for d in flips if d['luck'] is not None)
    complete=all(d['cost'] is not None for d in flips)
    signed=sum(d['cost'] for d in flips if d['cost'] is not None)
    add('Banqi: Brian’s 19 flips gave away 52 points by choice', ('holds' if abs(signed-.52)<.03 and len(flips)==19 else 'changes') if complete else 'unresolved',
        f'{len(flips)} flips ({sum(d["cost"] is not None for d in flips)} scored): {points(signed)} signed choice loss, {points(total)} when negative costs are clipped; {points(luck)} signed draw loss. The supplied 10-14 JSON reproduces 52.12 pp by summing signed costs (56.25 pp clipped).')
else:
    unresolved('Banqi: e1 was the engine’s own flip; all 21 points were the draw'); unresolved('Banqi: 19 flips gave away 52 points')
j=highest('jieqi')
if j:
    d=j['decisions']['44']
    add('Jieqi: f6-f3 took Black from 52% to 24%; the engine wanted f2',
        'holds' if abs(d['before']-.52)<.03 and abs(d['expected_after']-.24)<.03 and public_move(d['best'],'jieqi')=='f6f2' else 'changes',
        f"Ply 44: {pct(d['before'])} → {pct(d['expected_after'])}; best {public_move(d['best'],'jieqi')}. Site-calibrated curve: {pct(d['site_curve_before'])} → {pct(d['site_curve_expected_after'])}.")
    d=j['decisions']['47']
    add('Jieqi: the g1 elephant reveal helped Red by about 7 points', 'holds' if d['luck'] is not None and abs(d['luck']-.071)<.03 else 'changes',
        f"Ply 47: expected {pct(d['expected_after'])}, realized {pct(d['actual_after'])}; reveal effect {points(d['luck'])}.")
else:
    unresolved('Jieqi: f6-f3 52% → 24%, f2 preferred'); unresolved('Jieqi: g1 elephant reveal helped Red by 7 points')
duck=highest('duck')
if duck and '35' in duck['positions']:
    before=duck['positions']['35']['expected_score']; legacy=1-duck['positions']['35']['site_curve_red_score']
    add('Duck: Black was 79% before move 18', 'holds' if abs(before-.79)<.03 else 'changes',
        f'Before ply 36, Black {pct(before)}; site curve {pct(legacy)}. Budget {duck["requested_nodes"]:,}.')
    p1=duck['positions'].get('77'); p2=duck['positions'].get('103')
    if p1 and p2:
        red1=p1['red_score']; red2=p2['red_score']
        add('Duck: 13 general shuffles from moves 39–51; Red 51% → 70%',
            'holds' if abs(red1-.51)<.03 and abs(red2-.70)<.03 else 'changes',
            f'Red {pct(red1)} → {pct(red2)} at Black-to-move indices 77 and 103; includes Red replies. Site curve {pct(p1["site_curve_red_score"])} → {pct(p2["site_curve_red_score"])}. The move count is unchanged.')
    else: unresolved('Duck: 13 shuffles; Red 51% → 70%')
else:
    unresolved('Duck: 79% before Black move 18'); unresolved('Duck: 13 shuffles; Red 51% → 70%')
f=highest('fog')
if f:
    for ply,claim,was,after in [(11,'Fog: d2-d9 took Red 58% → 9%',.58,.09),(4,'Fog: Black’s second move was ??, 55% → 23%',.55,.23)]:
        d=f['decisions'][str(ply)]
        add(claim,'holds' if abs(d['before']-was)<.03 and abs(d['expected_after']-after)<.03 else 'changes',
            f"Ply {ply}: {pct(d['before'])} → {pct(d['expected_after'])}; best {public_move(d['best'],'fog')}. Site curve {pct(d['site_curve_before'])} → {pct(d['site_curve_expected_after'])}.")
else:
    unresolved('Fog: d2-d9 58% → 9%'); unresolved('Fog: Black’s second move 55% → 23%')
data['_meta']['claims']=claims

required={'fog':['1000000','20000000','misty-4s','misty-20s'],
    'banqi':['1000000','5000000'],'jieqi':['50000','1000000','20000000'],
    'jieqi-new':['1000000','20000000'],'duck':['300000','5000000','50000000']}
pending=[]
for name,tags in required.items():
    for tag in tags:
        s=games[name]['series'].get(tag)
        expected=games[name]['ply_count'] if tag.startswith('misty') else (69 if name=='duck' and tag!='300000' else games[name]['ply_count']+1)
        if not s or len(s['positions'])<expected or any(d['cost'] is None for d in s['decisions'].values()):
            pending.append(f'{name}/{tag}')
data['_meta']['status']='complete' if not pending else 'partial-paused-load-guard'
data['_meta']['pending_series']=pending
data['_meta']['verification']=dict(replayed_positions=351,reveal_assertions=True,unit_tests=7,
    biome='passes on replay companion',typecheck='No diagnostics in companion; transitive server imports report existing errors (including engine-alert-email.ts).')
data['_meta']['engine_validation']=dict(abj_october_bench_nodes=43125,abj_net_md5='75c231853a486f171e3093caf3408662',
    duck_opening_perft_1=2554,banqi_source_commit='45f0fdea786a91707604d905f359ab8b4ac3dc23',
    abj_source_build_failure='unguarded _tzcnt_u32/_blsr_u32/_lzcnt_u32/_bzhi_u32 on ARM; existing October ARM binary used and bench-verified',
    duck_build='pinned source + f563b5aa patch; make -C src -j2 build ARCH=apple-silicon COMP=clang largeboards=yes nnue=no')

lines=['# What holds and what does not','',
    'Expected scores below use each engine’s native conversion. “pp” means percentage points. Banqi’s Red seat is Brian, whose pieces are Black; seat and ink are kept separate.', '']
if pending:
    lines += ['**Incomplete, paused for shared-Mac capacity.** Only the new Jieqi game’s 1M shard and Misty’s 4-second Fog sweep are complete. Banqi’s 1M position sweep is complete, but some restricted move searches are pending. All current claim verdicts are provisional. No higher-budget survival counts are available yet.', '']
for c in claims: lines += [f'- **{c["status"]} — {c["claim"]}.** {c["evidence"]}']
lines += ['', 'The article and study script were not edited. The JSON retains native scores, raw exact UCI lines, budgets, preferred moves, pre-reveal costs, luck, and the site’s separate historical win-curve conversion. A curve-only difference is not evidence of a changed move assessment.', '',
    '## Per-game turning points','',
    'Selection: the three largest positive costs for each side, plus every strict crossing of 50%. A tie is resolved by earlier ply. These are engine estimates; small negative costs expose independent-search noise rather than being erased. Duck uses two-ply net changes between the same side to move and therefore includes the opponent’s reply.', '']
for name in a.IDS:
    game=games[name]; s=highest(name)
    lines += [f'### {name} — `{a.IDS[name]}`','']
    if not s: lines += ['Incomplete; no full series available.','']; continue
    lines += [f'{s["version"]}; {s["requested_nodes"]:,} requested nodes per search. Brian: '+('first mover, Black ink' if name=='banqi' else 'Red' if name=='jieqi-new' else 'Black')+'.','',
        '| Ply | Side | Played | Before → after | Cost | Engine’s choice |','|---:|---|---|---|---:|---|']
    for p in s['turning_points']:
        d=s['decisions'][str(p)]
        lines.append(f'| {p} | {d["mover"]} | {d["move"]} | {pct(d["before"])} → {pct(d["expected_after"])} | {points(d["cost"])} | {public_move(d["best"],s["engine"])} |')
    lines += ['']
    if name in ('banqi','jieqi'):
        prior=old[name]
        lines += ['10-14 comparison (all probabilities are mover POV; “old expected” removes the reveal draw):','',
            '| Ply | Move | 10-14 before → expected | New before → expected | New best |','|---:|---|---|---|---|']
        chosen=[15] if name=='banqi' else [44,47]
        for p in chosen:
            d=s['decisions'][str(p)]; red=p%2==1
            b=prior['redScore'][p-1]; e=(prior.get('moveScore') or [])[p-1] if prior.get('moveScore') else None
            if e is None: e=prior['redScore'][p]
            if not red: b,e=1-b,1-e
            lines += [f'| {p} | {d["move"]} | {pct(b)} → {pct(e)} | {pct(d["before"])} → {pct(d["expected_after"])} | {public_move(d["best"],s["engine"])} |']
        lines += ['']
lines += ['## Does more search preserve the read?','',
    'A turning point “survives” only if it is selected again after re-ranking the entire eligible higher-budget sweep. “Same choice” compares the root’s exact preferred move on the original turning points, independently of survival.', '',
    '| Game / side | Base → higher | Survive | Same choice | Scored |','|---|---|---:|---:|---:|']
for t in tests:
    lines.append(f'| {t["game"]} / {t["side"]} | {t["base"]} → {t["higher"]} | {t["survive"]} of {t["n"]} | {t["same_best"]} of {t["n"]} | {t["scored"]} of {t["n"]} |')
if not tests: lines += ['| Pending | — | — | — | — |']
lines += ['']
if cross:
    lines += [f'Fog information boundary: Pikafish and mover-view Misty share **{cross["agree"]} of {cross["n"]}** Pikafish turning points. Misty selected {cross["misty_n"]}; common plies: {cross["common"]}. Misty has {cross["misty_scored"]}/48 decisions.','']
lines += ['## Known limits','',
    '- Native expected score is a model output, not an empirically guaranteed human win rate: Banqi `0.5 + cp/2000` (NNUE utility); AB-JChess `sigmoid(cp/430)` (its chance-node conversion); Pikafish and Duck `(W + D/2)/1000` from their own UCI WDL. Mate/terminal outcomes are exact. The JSON also retains the site’s historical logistic curves (AB October K=0.00269, others K=0.00368208, cp clamped at ±1000) for comparison.',
    '- Public Jieqi exports do not identify pieces captured while covered or still covered at the end. Replay completes those identities from the unused bag, but only `public:true` pools reach AB-JChess, so this completion conveys no extra information. Reveal actions are restricted searches from the pre-reveal position. They use the engine’s chance-node approximation, not the actual dealt piece.',
    '- Banqi searches use the NNUE’s depth ceiling of 64 and report achieved depth and nodes, rather than pretending that a node budget is depth 12. Every flip is searched against the still-covered bag; all supplied reveals are checked by the rules kernel. Quiet repetition history is replayed. The no-progress limit is explicitly 40.',
    '- Pikafish is an orthodox, full-information Xiangqi evaluator, while Fog permits leaving the general exposed. Its scores cannot establish what the player knew, and orthodox terminal assessments can differ from Fog’s capture-the-general rules. Misty receives only the site’s mover-view transcripts, including color-only shrouded blockers, and uses the site’s v1.2 profile and general/material guards.',
    '- Misty’s cost is search regret: maximum raw action utility minus the played action’s utility. Its committed move also passes safety guards, which can deliberately prefer a lower raw-utility move (ply 38 does this). The JSON retains the search-best move, committed move, guard changes, and policy expected score; a positive search regret is not necessarily a disagreement with the guarded bot’s actual choice.',
    '- Duck has no new stronger evaluator here: more nodes test the same patched classical engine. Adjacent opposite-side scores are not compared. Paired net loss includes the opponent’s intervening move, and the last move without a matching same-side endpoint is explicitly unscored. A repeated-loop aggregate does not prove that any one shuffle was the causal mistake.',
    '- Full and restricted root searches have independent cold hashes. A forced move can score better than the unrestricted root because all search is concentrated on it; signed costs preserve this disagreement. Zero cost for the exact preferred move reuses its root score. Search stability is evidence at the tested budgets, not proof of the objective value.',
    '- The October AB-JChess source tag fails a direct ARM compile at unguarded x86 bit-scan intrinsics. We used the existing local October ARM binary, verified its net md5 and published 43,125-node bench, and recorded its SHA-256. Duck was rebuilt locally from the production pin plus the committed patch with NNUE embedding disabled and classical evaluation selected; its opening perft is 2,554.',
    '', '## Reproduce and resume','',
    'The TypeScript companion uses the site kernels and redaction builder; Python owns process control, exact-score parsing, native conversions, flushed caching, and reports. This split avoids reimplementing game rules in the analysis driver. All inputs exclude the live `xmj_` export. Only local processes are used.', '',
    '```sh',
    'node --import tsx scripts/variant-lab/rebirthfox-reanalyse.ts > /private/tmp/rebirthfox-reanalysis/positions.json',
    'python3 scripts/variant-lab/rebirthfox-reanalyse.py --game jieqi-new --nodes 1000000',
    'python3 scripts/variant-lab/rebirthfox-reanalyse.py --suite --resume-output --workers 4',
    'PYTHONDONTWRITEBYTECODE=1 /Users/brianliou/projects/mistboard-engine/.venv/bin/python scripts/variant-lab/rebirthfox-reanalyse-fog.py',
    'PYTHONDONTWRITEBYTECODE=1 /Users/brianliou/projects/mistboard-engine/.venv/bin/python scripts/variant-lab/rebirthfox-reanalyse-fog.py --seconds 20 --out /private/tmp/rebirthfox-reanalysis/fog-misty-20s.jsonl',
    'python3 scripts/variant-lab/rebirthfox-reanalyse-report.py',
    'python3 scripts/variant-lab/rebirthfox-reanalyse.test.py',
    '```','',
    'Set the explicit `SPECS` paths if the binaries move. The raw local cache is `/private/tmp/rebirthfox-reanalysis/searches.jsonl`; full deliverable numbers are in the committed JSON. A fresh run checks the shared-Mac guard once and stops if saturated; it never polls or automatically starts replacement work.','']
lines += ['## Run status and handoff','',
    'Branch `agent/rebirthfox-deep-dive`, worktree `/Users/brianliou/projects/mistboard-wt-rebirthfox`. Article and study script unchanged; supplied export files remain untracked and are not included in this commit. The result JSON embeds the five public exports so this checkpoint preserves its inputs.', '',
    'Calibration: the complete new-Jieqi 1M shard took 55.08 seconds (49 positions, 31 additional restricted searches). The Duck 5M probe took 31.42 seconds. Four one-thread UCI workers were sized for about 155 active minutes overall, including the 50M Duck sweep and 20-second Misty control.', '',
    'The shared-Mac guard then reported saturation (load 20.95, 14 cores). During the concurrency change an accidental duplicate runner started; both UCI runners were interrupted, and their flushed caches were preserved. The already-running Misty base sweep was allowed to finish. No further heavy work was launched and the guard was not polled. The next action needs an operator capacity signal or an explicit override of the supplied AGENTS.md rule: “If saturated or unknown, pause new heavy work … Do not retry/poll, launch replacement work”.', '',
    'Pending: '+', '.join(pending)+'.' if pending else 'All requested series complete.', '',
    'Verification: all 351 positions replay through site kernels, every supplied reveal matches, seven numerical/protocol tests pass, and the replay companion passes Biome. A direct TypeScript check reports no companion diagnostics but fails on existing transitive server errors; it is not claimed as a passing repository typecheck.', '',
    'Checkpoint commit: the pre-commit hook refuses the supplied untracked export inputs. They were left intact and outside the commit; the documented `SKIP_PRECOMMIT=1` escape was used after targeted checks. The hook’s full-workspace typecheck was not launched while the resource guard was saturated.', '']
if data['_meta'].get('errors'):
    lines += ['Recorded failures: '+json.dumps(data['_meta']['errors'])+'.','']
path.write_text(json.dumps(data,indent=2)+'\n')
(HERE/'REBIRTHFOX-REANALYSIS.md').write_text('\n'.join(lines))
print('\n'.join(f'{c["status"]}: {c["claim"]}' for c in claims))
