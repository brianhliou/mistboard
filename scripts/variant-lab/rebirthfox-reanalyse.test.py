"""Narrow numerical/protocol invariants for the offline audit (no engines)."""
import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('rebirthfox-reanalyse.py'))
audit=importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)

class AuditTests(unittest.TestCase):
    def mock_audit(self,family,positions,evaluate):
        from types import SimpleNamespace
        obj=audit.Audit.__new__(audit.Audit)
        obj.args=SimpleNamespace(workers=1); obj.games={audit.IDS[family]:dict(positions=positions)}
        obj.series={}; obj.evaluate=evaluate; obj.save=lambda:None
        return obj

    def test_duck_black_only_series_does_not_require_opposite_side_scores(self):
        pp=[dict(terminal=None) for _ in range(5)]
        for i in [1,3]:
            pp[i].update(mover='black',played='d10e10,e10f8',move='d10e10@f8',chance=False,reveal=None,ply=i)
        def evaluate(name,p,nodes,forced=None):
            return dict(cp=100,best='d2e2,e2a1',wdl=[800,0,200] if p['ply']==1 else [600,0,400])
        s=self.mock_audit('duck',pp,evaluate).run_series('duck',5000000,[1,3])
        self.assertAlmostEqual(s['decisions']['2']['cost'],.2)
        self.assertIsNone(s['decisions']['4']['cost'])

    def test_preflip_choice_and_realized_draw_are_distinct(self):
        pp=[dict(terminal=None,mover='red',played='e0e0',move='@e1',chance=True,reveal={'color':'red','role':'cannon'},ply=0),
            dict(terminal=None,mover='black',ply=1)]
        def evaluate(name,p,nodes,forced=None):
            return dict(cp=100 if forced else 200,best='a0a0')
        s=self.mock_audit('banqi',pp,evaluate).run_series('banqi',1000000)
        d=s['decisions']['1']
        self.assertAlmostEqual(d['before'],.6)
        self.assertAlmostEqual(d['expected_after'],.55)
        self.assertAlmostEqual(d['actual_after'],.4)
        self.assertAlmostEqual(d['cost'],.05)
        self.assertAlmostEqual(d['luck'],-.15)

    def test_native_expected_score_is_not_generic_centipawn_logistic(self):
        self.assertEqual(audit.probability({'cp':420},'banqi'),.71)
        self.assertAlmostEqual(audit.probability({'cp':430},'jieqi'),1/(1+audit.math.exp(-1)))
        self.assertEqual(audit.probability({'cp':128,'wdl':[394,603,3]},'duck'),.6955)

    def test_missing_engine_conversion_fails_closed(self):
        with self.assertRaises(ValueError): audit.probability({'cp':128},'duck')

    def test_terminal_mate_zero_is_a_loss_not_a_draw(self):
        self.assertEqual(audit.probability({'mate':0},'fog'),0)
        self.assertEqual(audit.probability({'mate':-4},'jieqi'),0)
        self.assertEqual(audit.probability({'terminal_score':.5},'banqi'),.5)

    def test_turning_points_select_each_side_and_all_crossings(self):
        decisions={}
        for i in range(1,11):
            cost=i/100
            decisions[str(i)]=dict(ply=i,mover='red' if i%2 else 'black',cost=cost,before=.8,expected_after=.8-cost)
        # A small crossing outside the top three must still be retained.
        decisions['1'].update(before=.501,expected_after=.499)
        self.assertEqual(audit.turning_points(dict(decisions=decisions)),[1,5,6,7,8,9,10])

    def test_bounds_never_replace_exact_score(self):
        # The source parser deliberately ignores incomplete fail-high/fail-low
        # iterations; this fixture checks it with an actual protocol subprocess.
        import tempfile,sys
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'fake.py'
            p.write_text("""#!/usr/bin/env python3
import sys
for line in sys.stdin:
 if line.strip()=='uci': print('uciok',flush=True)
 if line.strip()=='isready': print('readyok',flush=True)
 if line.startswith('go'):
  print('info depth 4 score cp 430 nodes 42 pv a0a1',flush=True)
  print('info depth 5 score cp 900 lowerbound nodes 50 pv a0a1',flush=True)
  print('bestmove a0a1',flush=True)
 if line.strip()=='quit': break
""")
            p.chmod(0o755)
            uci=audit.UCI(dict(binary=str(p),model='chance-logistic-430',options=[]))
            try:
                row=uci.search(dict(fen='fixture',moves=[]),100)
                self.assertEqual(row['cp'],430); self.assertEqual(row['depth'],4)
            finally: uci.close()

if __name__=='__main__': unittest.main()
