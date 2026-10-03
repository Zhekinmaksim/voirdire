#!/usr/bin/env python3
"""Merge distinct family runs with matching corpus and generation settings.

Repeating a family is rejected: concatenating retries can duplicate observations.
Source SHA256 hashes and individual provenance are retained in the merged header.
"""
import argparse
import hashlib
import json
import pathlib
from build_matrix import load, build


def merge(paths):
    records = []
    sources = []
    families = []
    models = {}
    first = None
    for path in paths:
        h, runs = load(path)
        settings = (h.get("corpus_digest"), h.get("corpus_version"),
                    h.get("provenance", {}).get("kind"), h.get("provenance", {}).get("temperature"))
        if not all(v is not None for v in settings):
            raise ValueError("incomplete source provenance")
        if first is None:
            first = settings
            base = h
        elif settings != first:
            raise ValueError("corpus, provenance kind or temperature differ")
        if set(families) & set(h["families"]):
            raise ValueError("duplicate family: use one complete run per family")
        families.extend(h["families"])
        models.update(h["models"])
        records.extend(runs)
        sources.append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                        "families": h["families"], "models": h["models"], "provenance": h["provenance"]})
    if first is None:
        raise ValueError("no input files")
    header = {**base, "families": sorted(families), "models": models,
              "provenance": {**base["provenance"], "provider": "merged", "sources": sources}}
    return header, records


def main():
    import tempfile
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("runs", nargs="+")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    try:
        inputs = [pathlib.Path(p) for p in args.runs]
        target = pathlib.Path(args.out)
        if target.resolve() in {p.resolve() for p in inputs}:
            raise ValueError("output would overwrite an input")
        header, runs = merge(inputs)
        text = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in [header, *runs])
        with tempfile.TemporaryDirectory() as d:
            candidate = pathlib.Path(d) / "merged.jsonl"
            candidate.write_text(text, encoding="utf-8")
            build(candidate)  # Validate before publishing any output.
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    except (ValueError, KeyError, TypeError) as exc:
        print("UNDECIDABLE: " + str(exc))
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
