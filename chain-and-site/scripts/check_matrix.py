#!/usr/bin/env python3
"""Fail a build when the matrix does not support publishing a verdict.

    check_matrix.py web/matrix.json --min-accuracy 0.75 --max-false-accusation 0.10

Exit codes follow the Jastrow gate, deliberately, so both projects can sit in
one CI file without a reader having to remember two conventions:

    0  PASS         the battery is good enough to publish verdicts from
    1  FAIL         it ran, and it is not good enough
    2  UNDECIDABLE  it cannot be judged at all: fixture provenance, no samples,
                    legacy evaluation, or insufficient held-out evidence

UNDECIDABLE is not a soft pass. A fixture matrix scores 2 and the build stops,
which is the whole reason `--offline` stamps provenance in the first place.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys


def decide(m: dict, min_acc: float, max_fa: float, allow_fixture: bool = False):
    from build_matrix import METHOD, wilson
    import math

    def undecidable(reason):
        return "UNDECIDABLE", 2, [reason]

    if not (math.isfinite(min_acc) and math.isfinite(max_fa) and 0 <= min_acc <= 1 and 0 <= max_fa <= 1):
        return undecidable("invalid gate thresholds")
    prov = m.get("provenance") or {}
    # Fixture bypasses must never turn a publish gate green.
    if prov.get("kind") != "live":
        return undecidable("matrix provenance is not a live measurement")
    if m.get("evaluation_method") != METHOD:
        return undecidable("missing independent held-out evaluation")
    families = m.get("families") or []
    b = m.get("battery") or {}
    conf = b.get("confusion") or {}
    if len(families) < 2 or len(set(families)) != len(families) or set(conf) != set(families):
        return undecidable("missing or invalid family coverage")
    counts = {}
    for f in families:
        row = conf[f]
        if not isinstance(row, dict) or set(row) != set(families):
            return undecidable("incomplete confusion matrix")
        if any(type(v) is not int or v < 0 for v in row.values()):
            return undecidable("invalid confusion counts")
        counts[f] = sum(row.values())
        if counts[f] == 0:
            return undecidable("no held-out observations for " + f)
    total = sum(counts.values())
    if b.get("samples") != total or b.get("underdetermined"):
        return undecidable("inconsistent or insufficient sample count")
    right = sum(conf[f][f] for f in families)
    acc = right / total
    if not isinstance(b.get("accuracy"), (float, int)) or not math.isfinite(b["accuracy"]) or abs(b["accuracy"] - acc) > 0.001:
        return undecidable("accuracy does not match confusion counts")
    reasons = []
    failed = acc < min_acc
    lower = wilson(right, total)[0]
    if lower < min_acc:
        reasons.append("95%% accuracy lower bound %.3f is below %.3f" % (lower, min_acc))
    for f in families:
        wrong = counts[f] - conf[f][f]
        failed |= wrong / counts[f] > max_fa
        upper = wilson(wrong, counts[f])[1]
        if upper > max_fa:
            reasons.append("95%% false accusation upper bound for %s is %.3f, above %.3f" % (f, upper, max_fa))
    expected = {tuple(sorted((a, c))) for i, a in enumerate(families) for c in families[i+1:]}
    pairs = b.get("pairs") or []
    try:
        actual = {tuple(sorted((p["a"], p["b"]))) for p in pairs}
    except (KeyError, TypeError):
        return undecidable("invalid pair coverage")
    if actual != expected or len(pairs) != len(expected):
        return undecidable("incomplete pair coverage")
    if any(p.get("verdict") != "SEPARATES" for p in pairs):
        reasons.append("battery contains blind or unvalidated pairs; universal verdicts cannot be published")
        failed = True
    if failed:
        return "FAIL", 1, reasons
    if reasons:
        return "UNDECIDABLE", 2, reasons
    return "PASS", 0, []


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="check_matrix.py", description=__doc__.split("\n")[0])
    ap.add_argument("matrix")
    ap.add_argument("--min-accuracy", type=float, default=0.75)
    ap.add_argument("--max-false-accusation", type=float, default=0.10)
    ap.add_argument("--allow-fixture", action="store_true", help="deprecated; fixtures always remain UNDECIDABLE")
    args = ap.parse_args(argv)

    try:
        m = json.loads(pathlib.Path(args.matrix).read_text(encoding="utf-8"))
        verdict, code, reasons = decide(m, args.min_accuracy, args.max_false_accusation, args.allow_fixture)
    except (ValueError, TypeError, KeyError, AttributeError, OSError) as exc:
        verdict, code, reasons = "UNDECIDABLE", 2, ["invalid matrix: " + str(exc)]

    print(verdict)
    for r in reasons:
        print("  - " + r)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
