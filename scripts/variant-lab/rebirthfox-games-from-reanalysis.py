#!/usr/bin/env python3
"""Rebuild the offline study input; run with python3, without engines or network.

Field mapping (all output probabilities are Red SEAT POV, including Banqi).
Banqi reads the native red_score/expected_after instead (see NATIVE):
  positions[i].site_curve_red_score -> redScore[i], never native red_score.
  positions[i].best -> best[i], translating engine UCI to kernel tokens.
  decisions[ply].site_curve_expected_after -> moveScore[ply-1], complemented
    for a Black mover. Banqi/Jieqi use the restricted pre-reveal search (also
    available for quiet moves); Duck uses the next BLACK-to-move position.
  positions[i].pv -> lines[i].moves (up to six plies, as in the old input).
  positions[i].site_curve_red_score -> lines[i].redScoreEnd: the root search
    backs up its PV's value, not a fresh evaluation of the resulting board.
    Banqi flip lines have no verdict because the tile has not been revealed.
    If final bestmove differs from the last exact PV, keep bestmove alone
    without attaching the other line's score or continuation.
  series.requested_nodes -> lines[i].nodes (budget, not achieved node count).

The historical site curves use K=.00269 for Jieqi and .00368208 otherwise,
with cp clamped at +/-1000. Do not substitute native expected_score, WDL,
linear NNUE utility, or the new AB-JChess chance conversion in these fields.
Fog promotes BOTH endpoints of the 20M series' turning-point decisions over
the 1M sweep. Only its explicitly recorded non-orthodox position retains the
input file's old score/best/line. Room metadata, moves and deals stay intact.
The study builder owns kernel replay and reports any truncated PV suffixes.
Candidate lines are emitted only for the sides that builder judges.
"""

import argparse
from copy import deepcopy
import json
from pathlib import Path
import re


LAB = Path(__file__).resolve().parent
# Banqi keeps the engine's native scale (0.5 + cp/2000, linear in cp), so a
# flip's pre-reveal score is a true average over the tiles it could turn up and
# choice + draw add up. The logistic site curve of an averaged cp does not.
NATIVE = {"banqi"}
GAMES = ("fog", "jieqi", "banqi", "duck")
JUDGE = {"fog": "both", "jieqi": "black", "banqi": "red", "duck": "black"}


def token(uci, game):
    if uci in (None, "0000", "(none)"):
        return None
    if game == "duck":
        match = re.fullmatch(r"([a-i](?:10|[1-9]))([a-i](?:10|[1-9])),\2([a-i](?:10|[1-9]))", uci)
        if not match:
            raise ValueError(f"invalid Duck engine turn: {uci}")
        return f"{match[1]}{match[2]}@{match[3]}"
    ranks = "[0-3]" if game == "banqi" else "[0-9]"
    match = re.fullmatch(rf"([a-i])({ranks})([a-i])({ranks})", uci)
    if not match:
        raise ValueError(f"invalid {game} engine move: {uci}")
    return f"{match[1]}{int(match[2])+1}{match[3]}{int(match[4])+1}"


def public_token(move):
    return move[1:] * 2 if move.startswith("@") else move


def red_probability(value, mover):
    if value is None or not 0 <= value <= 1:
        raise ValueError(f"missing or invalid site-curve probability: {value}")
    return value if mover == "red" else 1 - value


def fog_exceptions(meta):
    # The saved error contains a history-window FEN plus the moves since it.
    indices = set()
    for error in meta["errors"].get("fog_not_legal_xiangqi", []):
        fields = error["fen"].split()
        indices.add(2 * (int(fields[5]) - 1) + (fields[1] == "b") + len(error["moves"]))
    return indices


def selected_positions(source, name):
    series = source["series"]
    if name == "fog":
        base, high = series["1000000"], series["20000000"]
        promoted = {i for ply in high["turning_points"] for i in (ply - 1, ply)}
        return {
            i: (high if i in promoted else base)
            for i in range(source["ply_count"] + 1)
        }
    if name == "duck":
        return {
            i: series["50000000" if i % 2 else "300000"]
            for i in range(source["ply_count"] + 1)
        }
    budget = "5000000" if name == "banqi" else "20000000"
    return {i: series[budget] for i in range(source["ply_count"] + 1)}


def convert(old, analysis):
    result = {}
    retained = []
    for name in GAMES:
        game = old[name]
        # Match both name and room: jieqi-new must never be silently substituted.
        source = analysis["games"][game["room"]["id"]]
        if source["name"] != name or source["variant"] != game["room"]["variant"]:
            raise ValueError(f"wrong game for {name}")
        exported = source["public_export"]["plies"]
        moves = [
            public_token(p["uci"]) if name in ("duck", "banqi") else token(p["uci"], name)
            for p in exported
        ]
        if moves != game["moves"] or len(moves) != source["ply_count"]:
            raise ValueError(f"mainline mismatch for {name}")
        output = {key: deepcopy(game[key]) for key in ("room", "moves", "deal") if key in game}
        output.update(redScore=[], best=[], lines={})
        if name != "fog":
            output["moveScore"] = [None] * len(moves)
        exceptions = fog_exceptions(analysis["_meta"]) if name == "fog" else set()
        missing = set()
        for i, series in selected_positions(source, name).items():
            row = series["positions"].get(str(i))
            if row is None:
                if i not in exceptions:
                    raise ValueError(f"{name}: missing position {i} at {series['requested_nodes']} nodes")
                missing.add(i)
                retained.append(i)
                output["redScore"].append(game["redScore"][i])
                output["best"].append(game["best"][i])
                if str(i) in game.get("lines", {}):
                    output["lines"][str(i)] = deepcopy(game["lines"][str(i)])
                continue
            score = red_probability(row["red_score" if name in NATIVE else "site_curve_red_score"], "red")
            best = token(row.get("best"), name)
            output["redScore"].append(score)
            output["best"].append(best)
            if i == len(moves):
                continue
            if name in ("banqi", "jieqi") or (name == "duck" and i % 2):
                decision = series["decisions"][str(i + 1)]
                if public_token(decision["move"]) != moves[i]:
                    raise ValueError(f"{name}: decision mismatch at ply {i+1}")
                output["moveScore"][i] = red_probability(
                    decision["expected_after" if name in NATIVE else "site_curve_expected_after"], decision["mover"]
                )
            pv = [token(move, name) for move in row.get("pv", [])[:6]]
            mover = "black" if i % 2 else "red"
            if best and best != moves[i] and JUDGE[name] in ("both", mover):
                exact_pv = bool(pv) and pv[0] == best
                if not exact_pv:
                    pv = [best]
                flip = name == "banqi" and pv[0][:2] == pv[0][2:]
                output["lines"][str(i)] = dict(
                    moves=pv, redScoreEnd=score if exact_pv and not flip else None,
                    nodes=series["requested_nodes"]
                )
        if missing != exceptions:
            raise ValueError(f"Fog exception list does not match missing positions: {missing}, {exceptions}")
        result[name] = output
    versions = {name: analysis["_meta"]["engines"][name]["version"] for name in GAMES}
    result["_engines"] = {
        "fog": f"Pikafish {versions['fog']}, full information: 1M nodes a position, "
               f"20M at both endpoints of the 20M turning points; old October values retained "
               f"at position(s) {', '.join(map(str, retained))} (plies played, not legal standard xiangqi)",
        "jieqi": f"{versions['jieqi']}: 20M nodes per position and restricted move search; "
                 "reveals graded before the piece turns",
        "banqi": f"MistyBanqi {versions['banqi']}: 5M nodes per position and restricted move search; "
                 "flips graded before the tile turns",
        "duck": f"Fairy-Stockfish {versions['duck']}, classical evaluation: 300k nodes a position, "
                "50M at every Black-to-move position; Black graded against the next Black-to-move position",
    }
    for name in GAMES:
        result["_engines"][name] += (
            "; scores are the engine's own expected score" if name in NATIVE
            else "; scores use the historical site win curve"
        )
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reanalysis", type=Path, default=LAB / "rebirthfox-reanalysis.json")
    parser.add_argument("--games", type=Path, default=LAB / "rebirthfox-games.json")
    parser.add_argument("--out", type=Path, help="defaults to rewriting --games")
    args = parser.parse_args()
    converted = convert(json.loads(args.games.read_text()), json.loads(args.reanalysis.read_text()))
    target = args.out or args.games
    target.write_text(json.dumps(converted, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    print(f"wrote {target}")


if __name__ == "__main__":
    main()
