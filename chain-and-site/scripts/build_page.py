#!/usr/bin/env python3
"""Embed the corpus and the matrix into a single self-contained page.

The page must work from a file:// URL and from a static host with no fetch, so
the data is inlined rather than loaded. Same approach as jastrow's embed step.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
tpl = (ROOT / "web" / "index.tpl.html").read_text(encoding="utf-8")
corpus = json.loads((ROOT / "corpus" / "probes.json").read_text(encoding="utf-8"))
matrix_path = ROOT / "web" / "matrix.json"
if not matrix_path.exists():
    print("no web/matrix.json — run build_matrix.py first", file=sys.stderr)
    raise SystemExit(2)
matrix = json.loads(matrix_path.read_text(encoding="utf-8"))

# Trim the corpus to what the page renders. Author notes and hypotheses stay
# out of the page for the same reason they stay out of a prompt: they are the
# author's commentary, not evidence.
slim = {
    "version": corpus["version"],
    "status": corpus["status"],
    "probes": [
        {k: p[k] for k in ("probe_id", "class", "status", "carrier", "discriminator", "reads", "k") if k in p}
        | ({"blind_to": p["blind_to"]} if p.get("blind_to") else {})
        | ({"ethics": p["ethics"]} if p.get("ethics") else {})
        for p in corpus["probes"]
    ],
}

def inline_json(value):
    # A provider response must never be able to close the containing script tag.
    return json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")


notice = (
    "Live response data. See the matrix for reliability and limits."
    if matrix.get("provenance", {}).get("kind") == "live"
    else "<strong>These numbers are not a measurement.</strong> Synthetic demo. "
         "No live battery or Bradbury deployment has been completed."
)
out = tpl.replace("__NOTICE__", notice) \
         .replace("__CORPUS__", inline_json(slim)) \
         .replace("__MATRIX__", inline_json(matrix))
dest = ROOT / "web" / "index.html"
dest.write_text(out, encoding="utf-8")
print("wrote %s (%d KB)" % (dest, len(out) // 1024))
