#!/usr/bin/env python3
"""Fail a build when the matrix does not support publishing a verdict.

    check_matrix.py web/matrix.json --min-accuracy 0.75 --max-false-accusation 0.10

Exit codes follow the Jastrow gate, deliberately, so both projects can sit in
one CI file without a reader having to remember two conventions:

    0  PASS         the battery is good enough to publish verdicts from
    1  FAIL         it ran, and it is not good enough
    2  UNDECIDABLE  it cannot be judged at all: fixture provenance, no samples,
                    or an underdetermined battery

UNDECIDABLE is not a soft pass. A fixture matrix scores 2 and the build stops,
which is the whole reason `--offline` stamps provenance in the first place.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys


def decide(m: dict, min_acc: float, max_fa: float, allow_fixture: bool):
    reasons: list[str] = []

    prov = m.get("provenance") or {}
    if prov.get("kind") != "live" and not allow_fixture:
        return "UNDECIDABLE", 2, ["matrix provenance is %r, not a live measurement" % prov.get("kind")]

    battery = m.get("battery") or {}
    if not battery:
        return "UNDECIDABLE", 2, ["matrix has no battery section"]

    if battery.get("underdetermined"):
        return "UNDECIDABLE", 2, [battery.get("reliability", "underdetermined battery")]

    acc = float(battery.get("accuracy", 0.0))
    if acc < min_acc:
        reasons.append("battery accuracy %.3f is below %.3f" % (acc, min_acc))

    worst = 0.0
    worst_family = ""
    for family, rate in (battery.get("false_accusation_rate") or {}).items():
        if float(rate) > worst:
            worst = float(rate)
            worst_family = family
    if worst > max_fa:
        reasons.append(
            "false accusation rate for %s is %.3f, above %.3f — the tool would "
            "point at honest vendors this often" % (worst_family, worst, max_fa)
        )

    blind = [p for p in (battery.get("pairs") or []) if p.get("verdict") == "BLIND"]
    if blind:
        # Not a failure. A named blind pair is a stated limit, and stating it is
        # the point. It fails only if somebody publishes a verdict on that pair.
        reasons.append(
            "blind pairs (report as limits, never as verdicts): "
            + ", ".join("%s/%s" % (p["a"], p["b"]) for p in blind)
        )

    hard = [r for r in reasons if "below" in r or "above" in r]
    return ("FAIL" if hard else "PASS"), (1 if hard else 0), reasons


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="check_matrix.py", description=__doc__.split("\n")[0])
    ap.add_argument("matrix")
    ap.add_argument("--min-accuracy", type=float, default=0.75)
    ap.add_argument("--max-false-accusation", type=float, default=0.10)
    ap.add_argument("--allow-fixture", action="store_true")
    args = ap.parse_args(argv)

    m = json.loads(pathlib.Path(args.matrix).read_text(encoding="utf-8"))
    verdict, code, reasons = decide(m, args.min_accuracy, args.max_false_accusation, args.allow_fixture)

    print(verdict)
    for r in reasons:
        print("  - " + r)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
