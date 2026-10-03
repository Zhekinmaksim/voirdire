#!/usr/bin/env python3
"""Run the probe corpus against one or more model endpoints and record the raw
responses.

    run_battery.py --family gpt-class --model gpt-4o --provider openai
    run_battery.py --offline --out runs/fixture.jsonl

Output is JSONL, one line per (probe, family, run index), plus a header line
carrying provenance. Nothing is scored here. Scoring is build_matrix.py, and the
split exists so a disputed number can be recomputed from the same raw text
without re-running anything against a paid endpoint.

Provenance is the point of this file. Every line records which family, which
model string, which probe, which run index, and when. `provenance.kind` is
`live` only when responses came from a real endpoint. `--offline` writes
`fixture`, and every downstream consumer refuses to publish a fixture as a
measurement — the same rule Jastrow's gate applies to fixture reports.

Network note: the offline synthesizer is not a model and does not pretend to be
one. It produces family-shaped response patterns so that the pipeline can be
exercised end to end. It proves the code runs. It proves nothing about models.
"""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus" / "probes.json"

ACTIVE_CLASSES = ("tokenizer_artifact", "refusal_shape", "repeat_stability")


# ---------------------------------------------------------------------------
# providers
# ---------------------------------------------------------------------------


def _post(url: str, headers: dict, payload: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"content-type": "application/json", **headers},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def call_anthropic(model: str, prompt: str, temperature: float) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set")
    data = _post(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": key, "anthropic-version": "2023-06-01"},
        {
            "model": model,
            "max_tokens": 600,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    return "".join(b.get("text", "") for b in data.get("content", []))


def call_openai_compatible(base: str, env_key: str, model: str, prompt: str, temperature: float) -> str:
    key = os.environ.get(env_key)
    if not key:
        raise RuntimeError("%s is not set" % env_key)
    data = _post(
        base.rstrip("/") + "/chat/completions",
        {"authorization": "Bearer " + key},
        {
            "model": model,
            "max_tokens": 600,
            "temperature": temperature,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    return data["choices"][0]["message"]["content"]


PROVIDERS = {
    "anthropic": lambda m, p, t: call_anthropic(m, p, t),
    "openai": lambda m, p, t: call_openai_compatible("https://api.openai.com/v1", "OPENAI_API_KEY", m, p, t),
    "together": lambda m, p, t: call_openai_compatible("https://api.together.xyz/v1", "TOGETHER_API_KEY", m, p, t),
    "mistral": lambda m, p, t: call_openai_compatible("https://api.mistral.ai/v1", "MISTRAL_API_KEY", m, p, t),
    "local": lambda m, p, t: call_openai_compatible(
        os.environ.get("LOCAL_BASE_URL", "http://127.0.0.1:8000/v1"), "LOCAL_API_KEY", m, p, t
    ),
}


# ---------------------------------------------------------------------------
# offline synthesizer
# ---------------------------------------------------------------------------

# Each family gets a fixed behavioural style. These are invented. They exist so
# the scoring code has something with structure to chew on; they are not claims
# about any real model, and build_matrix.py stamps every result derived from
# them as a fixture.
STYLES = {
    "gpt-class": {"count_bias": 0, "invisible": 0.2, "caveat": 0.4, "caveat_early": 0.7,
                  "balance": 0.6, "hedge": 3, "spread": 0.35, "modal": 7, "verbosity": 1.0},
    "claude-class": {"count_bias": 0, "invisible": 0.8, "caveat": 0.5, "caveat_early": 0.15,
                     "balance": 0.8, "hedge": 2, "spread": 0.20, "modal": 17, "verbosity": 1.3},
    "llama-class": {"count_bias": 2, "invisible": 0.05, "caveat": 0.9, "caveat_early": 0.05,
                    "balance": 0.2, "hedge": 5, "spread": 0.55, "modal": 7, "verbosity": 0.7},
    "mistral-class": {"count_bias": 1, "invisible": 0.1, "caveat": 0.15, "caveat_early": 0.9,
                      "balance": 0.15, "hedge": 1, "spread": 0.60, "modal": 42, "verbosity": 0.6},
}

_FILLER = (
    "The short answer is that it depends on the exact input. ",
    "Here is what I would do in that situation. ",
    "Broadly speaking this is straightforward. ",
)


def _rng(*parts) -> float:
    """Deterministic pseudo-random in [0,1) from the inputs. Reproducibility of
    a fixture matters as much as reproducibility of a measurement."""
    h = hashlib.sha256("|".join(str(p) for p in parts).encode("utf-8")).digest()
    return int.from_bytes(h[:8], "big") / 2**64


COLLIDED: dict = {}


def synth(family: str, probe: dict, run_index: int) -> str:
    st = STYLES.get(family, STYLES["gpt-class"])
    # A collided family must share the noise stream too, not only the style.
    # Otherwise two "identical" families still differ by their random draw and
    # the fixture proves the opposite of what it was built to prove.
    family = COLLIDED.get(family, family)
    cls = probe["class"]
    pid = probe["probe_id"]
    r = _rng(family, pid, run_index)
    r2 = _rng(family, pid, run_index, "b")

    if cls == "tokenizer_artifact":
        base = 7 + (len(pid) % 5)
        n = base + st["count_bias"] + (1 if r < st["spread"] else 0)
        out = "Counting it out, that comes to %d characters." % n
        if r2 < st["invisible"]:
            out += " Note there are also zero-width joiner codepoints in there (U+200D) that a naive length check will miss."
        out += " " + _FILLER[run_index % len(_FILLER)] * int(st["verbosity"] * 2)
        return out

    if cls == "refusal_shape":
        parts = []
        early = r < st["caveat_early"]
        caveat = "Please note that this is general information and you should consult a professional for your specific case."
        if early and r2 < st["caveat"]:
            parts.append(caveat)
        parts.append("Here is the practical answer: " + probe["reads"][:60] + ".")
        parts.append("It generally works, and typically you may find it depends on the details. " * max(1, st["hedge"] // 2))
        if r2 < st["balance"]:
            parts.append("On the other hand, the counterargument is worth stating too.")
        if not early and r2 < st["caveat"]:
            parts.append(caveat)
        return " ".join(parts)

    # repeat_stability
    if r < st["spread"]:
        value = st["modal"] + int(r2 * 20) - 10
    else:
        value = st["modal"]
    if "colour" in probe["carrier"] or "name" in probe["carrier"]:
        words = ["teal", "ochre", "slate", "indigo"]
        pick = words[int(r * len(words))] if r < st["spread"] else words[0]
        return pick
    return "%d" % max(1, value)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def run(args: argparse.Namespace) -> int:
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    probes = [
        p
        for p in corpus["probes"]
        if p["class"] in ACTIVE_CLASSES
        and p.get("status") == "active"
        and (not args.only or p["probe_id"] in args.only.split(","))
    ]
    if not probes:
        print("no probes selected", file=sys.stderr)
        return 2

    out_path = pathlib.Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if args.offline and args.collide:
        a, b = [x.strip() for x in args.collide.split(",")]
        STYLES[b] = dict(STYLES[a])
        COLLIDED[b] = a

    if args.offline:
        families = list(STYLES.keys())
        kind = "fixture"
        model_of = {f: "synthetic:" + f for f in families}
    else:
        if not args.family or not args.model or not args.provider:
            print("live runs need --family, --model and --provider", file=sys.stderr)
            return 2
        families = [args.family]
        kind = "live"
        model_of = {args.family: args.model}

    header = {
        "record": "header",
        "corpus_version": corpus["version"],
        "corpus_digest": hashlib.sha256(CORPUS.read_bytes()).hexdigest(),
        "provenance": {
            "kind": kind,
            "provider": "synthetic" if args.offline else args.provider,
            "temperature": args.temperature,
            "started_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        },
        "families": families,
        "models": model_of,
        "note": (
            "SYNTHETIC. Responses were generated by scripts/run_battery.py, not by any "
            "model. Anything derived from this file is a pipeline test, not a measurement."
            if kind == "fixture"
            else "Live responses. Raw text kept verbatim so the scoring can be recomputed."
        ),
    }

    written = 0
    with out_path.open("w", encoding="utf-8") as fh:
        fh.write(json.dumps(header, ensure_ascii=False) + "\n")
        for family in families:
            for probe in probes:
                k = args.k or probe.get("k", 3)
                for i in range(k):
                    if args.offline:
                        text = synth(family, probe, i)
                        err = ""
                    else:
                        try:
                            text = PROVIDERS[args.provider](model_of[family], probe["carrier"], args.temperature)
                            err = ""
                        except (urllib.error.URLError, urllib.error.HTTPError, RuntimeError, KeyError) as exc:
                            text = ""
                            err = "%s: %s" % (type(exc).__name__, exc)
                            print("  ! %s run %d: %s" % (probe["probe_id"], i, err), file=sys.stderr)
                        if args.sleep:
                            time.sleep(args.sleep)
                    fh.write(
                        json.dumps(
                            {
                                "record": "run",
                                "family": family,
                                "model": model_of[family],
                                "probe_id": probe["probe_id"],
                                "probe_class": probe["class"],
                                "run_index": i,
                                "sent": probe["carrier"],
                                "got": text,
                                "error": err,
                                "observed_at": datetime.datetime.now(datetime.timezone.utc)
                                .isoformat()
                                .replace("+00:00", "Z"),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    written += 1
                print("  %s %s x%d" % (family, probe["probe_id"], k), file=sys.stderr)

    print("wrote %d runs to %s (%s)" % (written, out_path, kind))
    if kind == "fixture":
        print(
            "these are synthetic responses; build_matrix.py will refuse to label "
            "anything derived from them as measured",
            file=sys.stderr,
        )
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="run_battery.py", description=__doc__.split("\n")[0])
    ap.add_argument("--offline", action="store_true", help="synthesize responses, no network")
    ap.add_argument("--family", default="", help="family label, e.g. gpt-class")
    ap.add_argument("--model", default="", help="exact model string sent to the provider")
    ap.add_argument("--provider", default="", choices=sorted(PROVIDERS.keys()) + [""])
    ap.add_argument("--k", type=int, default=0, help="override repeats per probe")
    ap.add_argument("--temperature", type=float, default=1.0)
    ap.add_argument("--only", default="", help="comma separated probe ids")
    ap.add_argument("--sleep", type=float, default=0.0)
    ap.add_argument(
        "--collide",
        default="",
        help="offline only: 'a,b' makes family b behave exactly like family a. "
        "Used to check that the matrix reports BLIND rather than inventing a "
        "separation that is not there.",
    )
    ap.add_argument("--out", default=str(ROOT / "runs" / "battery.jsonl"))
    return run(ap.parse_args(argv))


if __name__ == "__main__":
    raise SystemExit(main())
