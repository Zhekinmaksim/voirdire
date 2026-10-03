#!/usr/bin/env python3
"""Build a fixed held-out evaluation from disjoint batches of raw responses.

Each batch contains three responses per probe. Even batches fit centroids;
odd batches evaluate them. No raw response is reused across these partitions.
The fixed feature extractor and split must be chosen before collecting results.
"""

from __future__ import annotations

import argparse
import hashlib
import itertools
import math
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


BATCH_SIZE = 3
METHOD = "disjoint-batches-heldout-v1"


def load(path: pathlib.Path):
    header = None
    runs = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec.get("record") == "header":
            if header is not None:
                raise ValueError("multiple headers; use merge_runs.py")
            header = rec
        elif rec.get("record") == "run":
            runs.append(rec)
        else:
            raise ValueError("unknown record type")
    if header is None:
        raise ValueError("missing provenance header")
    return header, runs


def samples(runs):
    """Non-overlapping batches; missing/error responses invalidate the input."""
    grouped = {}
    seen = set()
    for r in runs:
        key = (r["family"], r["probe_id"], r["run_index"])
        if key in seen:
            raise ValueError("duplicate response identity: %r" % (key,))
        seen.add(key)
        if r.get("error") or not isinstance(r.get("got"), str) or not r["got"].strip():
            raise ValueError("failed or empty response: %r" % (key,))
        if not isinstance(r["run_index"], int) or r["run_index"] < 0:
            raise ValueError("invalid run index")
        grouped.setdefault((r["family"], r["probe_id"], r["probe_class"]), []).append(
            (r["run_index"], r["got"]))
    out = {}
    for key, items in grouped.items():
        items.sort()
        if [i for i, _ in items] != list(range(len(items))):
            raise ValueError("run indices must be contiguous from zero")
        texts = [t for _, t in items]
        out[key] = [F.signature(key[2], texts[i:i+BATCH_SIZE])
                    for i in range(0, len(texts)-BATCH_SIZE+1, BATCH_SIZE)]
    return out


def wilson(successes, total, z=1.959963984540054):
    if not total:
        return [0.0, 1.0]
    p = successes / total
    scale = 1 + z*z/total
    center = (p + z*z/(2*total))/scale
    radius = z * math.sqrt(p*(1-p)/total + z*z/(4*total*total))/scale
    return [max(0.0, center-radius), min(1.0, center+radius)]


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
    """Fit on even batches and evaluate once on independent odd batches."""
    families = sorted(sigs_by_family)
    confusion = {a: {b: 0 for b in families} for a in families}
    centroids = {f: _centroid(sigs_by_family[f][::2]) for f in families}
    if any(c is None for c in centroids.values()):
        raise ValueError("no training batches")
    for truth in families:
        for sig in sigs_by_family[truth][1::2]:
            best = min(families, key=lambda f: (F.distance(sig, centroids[f]), f))
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
    if header.get("provenance", {}).get("kind") not in {"live", "fixture"}:
        raise ValueError("unknown provenance")
    declared = header.get("families", [])
    models = header.get("models", {})
    if len(set(declared)) < 2 or len(set(declared)) != len(declared):
        raise ValueError("at least two distinct families required")
    for r in runs:
        if r["family"] not in declared or r.get("model") != models.get(r["family"]):
            raise ValueError("response family/model differs from header")
    if header["provenance"]["kind"] == "live" and (
        header["provenance"].get("provider") == "synthetic" or
        any(str(model).startswith("synthetic:") for model in models.values())
    ):
        raise ValueError("synthetic sources cannot be labeled live")
    probe_specs = {}
    for r in runs:
        spec = (r["probe_class"], r.get("sent"))
        if r["probe_id"] in probe_specs and probe_specs[r["probe_id"]] != spec:
            raise ValueError("probe class or prompt differs between observations")
        probe_specs[r["probe_id"]] = spec
    sigs = samples(runs)

    families = sorted({f for (f, _, _) in sigs})
    probe_ids = sorted({p for (_, p, _) in sigs})
    class_of = {p: c for (_, p, c) in sigs}

    if families != sorted(declared) or not probe_ids:
        raise ValueError("missing declared families/probes")
    for f in families:
        for pid in probe_ids:
            key = (f, pid, class_of[pid])
            if key not in sigs or len(sigs[key]) < 2:
                raise ValueError("incomplete family/probe coverage or fewer than six responses")
    if len({(p,c) for (_,p,c) in sigs}) != len(probe_ids):
        raise ValueError("inconsistent probe classes")
    per_probe = []
    blind_pairs: dict = {}
    for pid in probe_ids:
        by_family = {f: sigs[(f, pid, class_of[pid])] for f in families if (f, pid, class_of[pid]) in sigs}
        if len(by_family) < 2:
            continue
        confusion, fams = classify_probe(by_family)
        pairs = []
        for a, b in itertools.combinations(fams, 2):
            sep = pair_separation({f: vs[::2] for f, vs in by_family.items()}, a, b)
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

    # Concatenate the same disjoint batch index across all probes.
    # Truncate surplus complete batches consistently across probes per family.
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

    widths = {len(v) for vs in battery.values() for v in vs}
    if len(widths) != 1:
        raise ValueError("inconsistent feature widths")
    width = widths.pop()
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

    total_samples = sum(sum(row.values()) for row in bconf.values())
    training_samples = sum(len(v[::2]) for v in battery.values())
    underdetermined = total_samples == 0
    accuracy_interval = wilson(sum(bconf[f][f] for f in bfams), total_samples)
    fa_intervals = {f: wilson(sum(bconf[f].values()) - bconf[f][f], sum(bconf[f].values()))
                    for f in bfams}

    battery_pairs = []
    for a, b in itertools.combinations(bfams, 2):
        sep = pair_separation({f: vs[::2] for f, vs in battery.items()}, a, b)
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
        "evaluation_method": METHOD,
        "corpus_version": header.get("corpus_version"),
        "corpus_digest": header.get("corpus_digest"),
        "provenance": header["provenance"],
        "source_file": path.name,
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "families": families,
        "models": header.get("models", {}),
        "battery": {
            "accuracy": bacc,
            "accuracy_interval_95": accuracy_interval,
            "false_accusation_interval_95": fa_intervals,
            "batch_size": BATCH_SIZE,
            "training_samples": training_samples,
            "confusion": bconf,
            "false_accusation_rate": false_accusation,
            "pairs": battery_pairs,
            "feature_width": width,
            "folds": fold_counts,
            "samples": total_samples,
            "underdetermined": underdetermined,
            "reliability": (
                "%d independent held-out batches; %d training batches; %d fixed features. "
                "Intervals describe these models, prompts and settings only; no deployment generalization."
                % (total_samples, training_samples, width)
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

    try:
        m = build(pathlib.Path(args.runs))
    except (ValueError, KeyError, TypeError) as exc:
        print("UNDECIDABLE: " + str(exc), file=sys.stderr)
        return 2
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    summarize(m)
    print("\nwrote %s" % out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
