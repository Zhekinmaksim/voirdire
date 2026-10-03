#!/usr/bin/env python3
"""Turn battery runs into the confusion matrix.

    build_matrix.py runs/fixture.jsonl --out web/matrix.json

This is the number section 7 of the spec says the project is taken for, and the
reason the honesty rules here are strict:

- classification is leave-one-out. A signature is never compared against a
  centroid it helped compute, because that reports memorisation as accuracy
- pairs the battery cannot separate are named, not averaged away. A single
  accuracy figure over four families hides exactly the fact a vendor would
  dispute, which makes it marketing rather than measurement
- `provenance.kind` rides through untouched. A matrix built from `--offline`
  runs is stamped `fixture` and every consumer, including the page and the
  gate, refuses to present it as measured

No model is consulted anywhere in this file. Features are extracted by
scripts/features.py and everything after that is arithmetic.
"""

from __future__ import annotations

import argparse
import itertools
import json
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

import features as F  # noqa: E402

# Below this ratio of between-family distance to within-family spread, a pair is
# reported BLIND for that probe. 1.0 means the families are no further apart
# than one family is from itself.
SEPARATION_FLOOR = 1.0


def load(path: pathlib.Path):
    header = None
    runs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("record") == "header":
            header = rec
        elif rec.get("record") == "run":
            runs.append(rec)
    if header is None:
        raise SystemExit("no header line: cannot establish provenance, refusing to score")
    return header, runs


def samples(runs):
    """Leave-one-out subsets, so each (family, probe) yields several signatures
    from k runs without any of them sharing a run with its own centroid."""
    grouped: dict = {}
    for r in runs:
        if r.get("error"):
            continue
        grouped.setdefault((r["family"], r["probe_id"], r["probe_class"]), []).append(
            (r["run_index"], r["got"])
        )

    out: dict = {}
    for (family, probe_id, cls), items in grouped.items():
        items.sort()
        texts = [t for _, t in items]
        if len(texts) < 2:
            continue
        sigs = []
        for i in range(len(texts)):
            subset = texts[:i] + texts[i + 1:]
            sigs.append(F.signature(cls, subset))
        out[(family, probe_id, cls)] = sigs
    return out


def _centroid(vectors):
    if not vectors:
        return None
    n = len(vectors[0])
    return [sum(v[i] for v in vectors) / len(vectors) for i in range(n)]


def _spread(vectors):
    c = _centroid(vectors)
    if c is None or len(vectors) < 2:
        return 0.0
    return statistics.mean(F.distance(v, c) for v in vectors)


def classify_probe(sigs_by_family):
    """Leave-one-out nearest centroid, one probe at a time."""
    families = sorted(sigs_by_family.keys())
    confusion = {a: {b: 0 for b in families} for a in families}
    for truth in families:
        for idx, sig in enumerate(sigs_by_family[truth]):
            best = None
            best_d = None
            for cand in families:
                pool = sigs_by_family[cand]
                if cand == truth:
                    pool = pool[:idx] + pool[idx + 1:]
                c = _centroid(pool)
                if c is None:
                    continue
                d = F.distance(sig, c)
                if best_d is None or d < best_d:
                    best_d = d
                    best = cand
            if best is not None:
                confusion[truth][best] += 1
    return confusion, families


def pair_separation(sigs_by_family, a, b):
    ca, cb = _centroid(sigs_by_family[a]), _centroid(sigs_by_family[b])
    if ca is None or cb is None:
        return 0.0
    between = F.distance(ca, cb)
    within = max(1e-9, (_spread(sigs_by_family[a]) + _spread(sigs_by_family[b])) / 2)
    return between / within


def accuracy(confusion, families):
    total = sum(confusion[a][b] for a in families for b in families)
    right = sum(confusion[a][a] for a in families)
    return (right / total) if total else 0.0


def build(path: pathlib.Path) -> dict:
    header, runs = load(path)
    sigs = samples(runs)

    families = sorted({f for (f, _, _) in sigs})
    probe_ids = sorted({p for (_, p, _) in sigs})
    class_of = {p: c for (_, p, c) in sigs}

    per_probe = []
    blind_pairs: dict = {}
    for pid in probe_ids:
        by_family = {f: sigs[(f, pid, class_of[pid])] for f in families if (f, pid, class_of[pid]) in sigs}
        if len(by_family) < 2:
            continue
        confusion, fams = classify_probe(by_family)
        pairs = []
        for a, b in itertools.combinations(fams, 2):
            sep = pair_separation(by_family, a, b)
            verdict = "SEPARATES" if sep >= SEPARATION_FLOOR else "BLIND"
            pairs.append({"a": a, "b": b, "separation": round(sep, 3), "verdict": verdict})
            if verdict == "BLIND":
                blind_pairs.setdefault("%s|%s" % (a, b), []).append(pid)
        per_probe.append(
            {
                "probe_id": pid,
                "class": class_of[pid],
                "accuracy": round(accuracy(confusion, fams), 3),
                "confusion": {a: confusion[a] for a in fams},
                "pairs": pairs,
            }
        )

    # The battery: per fold index, concatenate every probe signature for a
    # family into one long vector. This is the instrument as actually used — a
    # verdict is never taken from one probe.
    battery: dict = {}
    fold_counts = {
        f: min(
            len(sigs[(f, pid, class_of[pid])])
            for pid in probe_ids
            if (f, pid, class_of[pid]) in sigs
        )
        for f in families
    }
    for f in families:
        vectors = []
        for fold in range(fold_counts[f]):
            vec = []
            for pid in probe_ids:
                key = (f, pid, class_of[pid])
                if key in sigs:
                    vec.extend(sigs[key][fold])
            vectors.append(vec)
        battery[f] = vectors

    width = min(len(v) for vs in battery.values() for v in vs)
    battery = {f: [v[:width] for v in vs] for f, vs in battery.items()}
    bconf, bfams = classify_probe(battery)
    bacc = accuracy(bconf, bfams)

    # The honest-vendor control, stated separately because it is the number a
    # vendor cares about: how often does the battery point at the wrong family
    # for a family that is telling the truth.
    false_accusation = {}
    for f in bfams:
        total = sum(bconf[f].values())
        wrong = total - bconf[f][f]
        false_accusation[f] = round(wrong / total, 3) if total else 0.0

    # Nearest-centroid over more features than samples will separate almost
    # anything, including two families that are identical by construction. That
    # is not a finding, it is dimensionality. The guard is stated on the record
    # rather than quietly fixed, because the fix is more samples, not more code.
    total_samples = sum(len(v) for v in battery.values())
    underdetermined = width >= total_samples

    battery_pairs = []
    for a, b in itertools.combinations(bfams, 2):
        sep = pair_separation(battery, a, b)
        battery_pairs.append(
            {
                "a": a,
                "b": b,
                "separation": round(sep, 3),
                "verdict": "SEPARATES" if sep >= SEPARATION_FLOOR else "BLIND",
            }
        )

    kind = header["provenance"]["kind"]
    return {
        "corpus_version": header.get("corpus_version"),
        "corpus_digest": header.get("corpus_digest"),
        "provenance": header["provenance"],
        "source_file": path.name,
        "families": families,
        "models": header.get("models", {}),
        "battery": {
            "accuracy": round(bacc, 3),
            "confusion": bconf,
            "false_accusation_rate": false_accusation,
            "pairs": battery_pairs,
            "feature_width": width,
            "folds": fold_counts,
            "samples": total_samples,
            "underdetermined": underdetermined,
            "reliability": (
                "UNRELIABLE: %d features against %d samples. Nearest-centroid "
                "separates anything under those conditions, so this accuracy is "
                "not evidence. Raise k, or cut the battery to fewer probes."
                % (width, total_samples)
                if underdetermined
                else "%d features against %d samples." % (width, total_samples)
            ),
        },
        "per_probe": per_probe,
        "blind_pairs": {k: sorted(v) for k, v in sorted(blind_pairs.items())},
        "separation_floor": SEPARATION_FLOOR,
        "honesty": (
            "FIXTURE. Built from synthetic responses. Every number below describes "
            "the scoring pipeline, not any model. It may not be presented as a "
            "measurement anywhere."
            if kind != "live"
            else "Built from live responses. Pairs marked BLIND are pairs this "
            "battery cannot separate, and that limit is part of the result."
        ),
    }


def summarize(m: dict) -> None:
    print("provenance : %s (%s)" % (m["provenance"]["kind"], m["provenance"]["provider"]))
    print("families   : %s" % ", ".join(m["families"]))
    print("battery acc: %.3f over %d features" % (m["battery"]["accuracy"], m["battery"]["feature_width"]))
    print("reliability: %s" % m["battery"]["reliability"])
    print("false accusation rate per family:")
    for f, v in sorted(m["battery"]["false_accusation_rate"].items()):
        print("  %-16s %.3f" % (f, v))
    print("pairs at battery level:")
    for p in m["battery"]["pairs"]:
        print("  %-16s vs %-16s  sep %6.2f  %s" % (p["a"], p["b"], p["separation"], p["verdict"]))
    if m["blind_pairs"]:
        print("pairs blind on at least one probe:")
        for pair, probes in m["blind_pairs"].items():
            print("  %-34s %d probes: %s" % (pair, len(probes), ", ".join(probes[:6])))
    print("\n" + m["honesty"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="build_matrix.py", description=__doc__.split("\n")[0])
    ap.add_argument("runs")
    ap.add_argument("--out", default=str(ROOT / "web" / "matrix.json"))
    args = ap.parse_args(argv)

    m = build(pathlib.Path(args.runs))
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summarize(m)
    print("\nwrote %s" % out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
