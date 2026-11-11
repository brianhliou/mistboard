"""Offline regressions for budget selection, score scales and study conversion."""

from copy import deepcopy
import importlib.util
import json
from pathlib import Path
import unittest


LAB = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("converter", LAB / "rebirthfox-games-from-reanalysis.py")
converter = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(converter)


class ConverterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.games = json.loads((LAB / "rebirthfox-games.json").read_text())
        cls.analysis = json.loads((LAB / "rebirthfox-reanalysis.json").read_text())
        cls.result = converter.convert(cls.games, cls.analysis)

    def source(self, name):
        return self.analysis["games"][self.games[name]["room"]["id"]]

    def test_checked_in_input_is_reproducible_and_idempotent(self):
        self.assertEqual(self.result, self.games)
        self.assertEqual(converter.convert(self.result, self.analysis), self.result)

    def test_keeps_only_the_study_schema_and_preserves_replay_inputs(self):
        for name in converter.GAMES:
            old, new = self.games[name], self.result[name]
            expected = {"room", "moves", "redScore", "best", "lines"}
            if name != "fog":
                expected.add("moveScore")
            if "deal" in old:
                expected.add("deal")
                self.assertEqual(new["deal"], old["deal"])
            self.assertEqual(set(new), expected)
            self.assertEqual(new["room"], old["room"])
            self.assertEqual(new["moves"], old["moves"])
            self.assertEqual(len(new["redScore"]), len(new["moves"]) + 1)
            self.assertEqual(len(new["best"]), len(new["redScore"]))

    def test_every_position_uses_the_site_curve_at_the_selected_budget(self):
        for name in converter.GAMES:
            for i, series in converter.selected_positions(self.source(name), name).items():
                row = series["positions"].get(str(i))
                if row is not None:
                    self.assertEqual(self.result[name]["redScore"][i], row["site_curve_red_score"])
        # These values differ substantially from native WDL/NNUE/chance scores.
        for name, budget, index in [("fog", "20000000", 10), ("banqi", "5000000", 22),
                                    ("jieqi", "20000000", 46), ("duck", "50000000", 35)]:
            row = self.source(name)["series"][budget]["positions"][str(index)]
            self.assertNotEqual(self.result[name]["redScore"][index], row["red_score"])

    def test_restricted_search_is_red_seat_pov_before_the_reveal(self):
        for name, budget in [("banqi", "5000000"), ("jieqi", "20000000")]:
            for ply, decision in self.source(name)["series"][budget]["decisions"].items():
                expected = decision["site_curve_expected_after"]
                if decision["mover"] == "black":
                    expected = 1 - expected
                self.assertEqual(self.result[name]["moveScore"][int(ply) - 1], expected)
        # Banqi's first seat has Black ink: do not invert its seat-based score.
        game = self.result["banqi"]
        self.assertAlmostEqual(game["moveScore"][14], 0.46324561670945996)
        self.assertNotEqual(game["moveScore"][14], game["redScore"][15])
        self.assertEqual(self.result["jieqi"]["best"][46], "g1e3")
        self.assertEqual(self.result["jieqi"]["moveScore"][46], self.result["jieqi"]["redScore"][46])

    def test_duck_compares_black_to_next_black_never_the_red_reply_position(self):
        game = self.result["duck"]
        for i in range(len(game["moves"])):
            if i % 2:
                self.assertAlmostEqual(game["moveScore"][i], game["redScore"][i + 2])
            else:
                self.assertIsNone(game["moveScore"][i])
        self.assertNotEqual(game["moveScore"][35], game["redScore"][36])
        self.assertEqual(game["lines"]["35"]["nodes"], 50_000_000)

    def test_fog_promotes_both_endpoints_and_retains_only_documented_exception(self):
        series = converter.selected_positions(self.source("fog"), "fog")
        high = {i for i, s in series.items() if s["requested_nodes"] == 20_000_000}
        self.assertEqual(high, {0, 1, 2, 3, 4, 5, 6, 10, 11})
        self.assertEqual(converter.fog_exceptions(self.analysis["_meta"]), {47})
        self.assertEqual(self.result["fog"]["redScore"][47], self.games["fog"]["redScore"][47])
        self.assertIn("47", self.result["_engines"]["fog"])
        changed = deepcopy(self.analysis)
        room = self.games["fog"]["room"]["id"]
        del changed["games"][room]["series"]["1000000"]["positions"]["20"]
        with self.assertRaisesRegex(ValueError, "missing position 20"):
            converter.convert(self.games, changed)

    def test_wrong_jieqi_game_is_rejected(self):
        changed = deepcopy(self.analysis)
        room = self.games["jieqi"]["room"]["id"]
        other = next(g for g in changed["games"].values() if g["name"] == "jieqi-new")
        changed["games"][room] = other
        with self.assertRaisesRegex(ValueError, "wrong game for jieqi"):
            converter.convert(self.games, changed)

    def test_tokens_keep_duck_ranks_and_shift_other_engine_ranks(self):
        self.assertEqual(converter.token("d10e10,e10f8", "duck"), "d10e10@f8")
        self.assertEqual(converter.token("c9e7", "jieqi"), "c10e8")
        self.assertEqual(converter.token("h5h0", "fog"), "h6h1")
        self.assertEqual(converter.token("e0e0", "banqi"), "e1e1")
        self.assertEqual(converter.public_token("@f3"), "f3f3")
        with self.assertRaises(ValueError):
            converter.token("d10e10,d10f8", "duck")

    def test_pv_mismatch_never_attaches_another_moves_continuation_or_score(self):
        row = self.source("duck")["series"]["50000000"]["positions"]["27"]
        self.assertNotEqual(row["pv"][0], row["best"])
        self.assertEqual(self.result["duck"]["lines"]["27"], {
            "moves": ["h3h4@f3"], "redScoreEnd": None, "nodes": 50_000_000,
        })

    def test_lines_use_their_root_score_budget_and_preferred_move(self):
        for name in converter.GAMES:
            for index, line in self.result[name]["lines"].items():
                self.assertEqual(line["moves"][0], self.result[name]["best"][int(index)])
                self.assertLessEqual(len(line["moves"]), 6)
                if line["redScoreEnd"] is not None:
                    self.assertEqual(line["redScoreEnd"], self.result[name]["redScore"][int(index)])
            self.assertIn(self.analysis["_meta"]["engines"][name]["version"],
                          self.result["_engines"][name])


if __name__ == "__main__":
    unittest.main()
