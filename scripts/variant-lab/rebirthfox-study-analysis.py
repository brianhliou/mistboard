"""Build study:edit series plans and decisions files for the rebirthfox studies.

Usage: python3 scripts/variant-lab/rebirthfox-study-analysis.py scripts/variant-lab OUT_DIR STUDIES_JSON
STUDIES_JSON: {"banqi": ["study", "chapter"], ...}
"""
import json
import sys
from pathlib import Path

lab, out, studies = Path(sys.argv[1]), Path(sys.argv[2]), json.loads(sys.argv[3])
games = json.loads((lab / "rebirthfox-games.json").read_text())
analysis = json.loads((lab / "rebirthfox-reanalysis.json").read_text())
out.mkdir(parents=True, exist_ok=True)

# Chart side is a label: banqi's first seat (redScore) played the black pieces.
SIDE = {"banqi": "black", "jieqi": "red", "duck": "red", "fog": "red"}
BUDGET = {"banqi": "5000000", "jieqi": "20000000"}
NATIVE = {"banqi"}  # jieqi's chart is on the site curve, so its luck is too


def chart(name, s):
    # Duck scores swing ~10 points with the side to move; averaging each position
    # with the one before cancels that, so the line shows the game, not the tempo.
    if name != "duck":
        return s
    return [s[0]] + [(s[i] + s[i - 1]) / 2 for i in range(1, len(s))]


def pct(x):
    return round(100 * x, 1)


for name, (study, chapter) in studies.items():
    game = games[name]
    plan = {"study": study, "ops": [{"op": "series", "chapter": chapter, "scoreSeries": {
        "side": SIDE[name],
        "series": [{"name": "Engine", "color": "a", "values": [round(v, 4) for v in chart(name, game["redScore"])]}],
    }}]}
    (out / f"{name}-series.json").write_text(json.dumps(plan))
    if name not in BUDGET:
        continue
    meta = analysis["_meta"]["engines"][name]
    rows = analysis["games"][game["room"]["id"]]["series"][BUDGET[name]]["decisions"]
    prefix = "" if name in NATIVE else "site_curve_"
    decisions = []
    for key in sorted(rows, key=int):
        d = rows[key]
        if not d.get("chance"):
            continue
        ply = int(key)
        before, played = d[prefix + "before"], d[prefix + "expected_after"]
        # After the draw: the chart's next position, from the mover's side.
        after = game["redScore"][ply] if ply % 2 else 1 - game["redScore"][ply]
        if name in NATIVE:
            assert abs(after - d["actual_after"]) < 1e-6, (name, ply)
        # Guard the POV: before is the mover's view of redScore[ply-1].
        seat_before = game["redScore"][ply - 1] if ply % 2 else 1 - game["redScore"][ply - 1]
        assert abs(seat_before - before) < 1e-6, (name, ply, seat_before, before)
        row = {"ply": ply, "mover": d["mover"], "playedWin": pct(played), "realizedWin": pct(after)}
        if name == "banqi":
            best, mine = d["best"], d["engine_move"]
            row["bestWin"] = pct(before)
            row["playedRank"] = 1 if best == mine else None
            row["candidates"] = (
                [{"move": best, "win": pct(before), "played": True}] if best == mine
                else [{"move": best, "win": pct(before)}, {"move": mine, "win": pct(played), "played": True}]
            )
        decisions.append(row)
    (out / f"{name}-decisions.json").write_text(json.dumps({
        "engineId": f"{meta.get('name', name)} {meta.get('version', '')}".strip(),
        "source": f"offline reanalysis, {int(BUDGET[name]) // 1_000_000}M nodes a position",
        "decisions": decisions,
    }))
    by = {}
    for r in decisions:
        s = by.setdefault(r["mover"], [0.0, 0.0, 0])
        s[0] += max(0, r.get("bestWin", r["playedWin"]) - r["playedWin"])
        s[1] += min(0, r["realizedWin"] - r["playedWin"])
        s[2] += 1
    print(name, len(decisions), {k: (round(a, 1), round(b, 1), n) for k, (a, b, n) in by.items()})
