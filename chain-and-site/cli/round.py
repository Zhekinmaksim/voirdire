#!/usr/bin/env python3
"""Build, canonicalize and hash a `voirdire/2` round envelope.

The canonical form here MUST be byte-identical to `_canonical` in
contracts/voirdire.py. If the two ever drift, every reveal fails with
"reveal does not match the commitment" and the cause is invisible from the
chain. test/run_tests.py pins both against the same vectors.

    round.py new --claim 0 --probes tok-002,ref-005,stb-001 > round.json
    round.py hash round.json
    # commit; collect responses into filled.json
    round.py check filled.json

Typical flow:

    1. `new`   picks probes from the corpus, skipping burned ones, and writes a
               skeleton with a fresh nonce and empty `got` fields
    2. `hash` the empty response skeleton; commit its digest on chain
    3. wait for the commitment to be accepted, then send the probes
    4. fill `got` and `observed_at`, `check`, then reveal within 24 hours

Doing step 4 out of order is the single mistake that makes the whole exercise
pointless: a probe set the vendor could have seen before answering measures
nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import secrets
import sys

VERSION = "voirdire/2"
MAX_FIELD = 4096
MAX_TRANSCRIPTS = 24
ACTIVE_CLASSES = ("tokenizer_artifact", "refusal_shape", "repeat_stability")

ROOT = pathlib.Path(__file__).resolve().parents[1]
CORPUS = ROOT / "corpus" / "probes.json"


# ---------------------------------------------------------------------------
# canonical form — mirrored in contracts/voirdire.py
# ---------------------------------------------------------------------------


def canonical(env: dict) -> str:
    items = []
    for t in env.get("transcripts") or []:
        one = {
            "probe_id": str(t.get("probe_id", "")),
            "probe_class": str(t.get("probe_class", "")),
            "sent": str(t.get("sent", "")),
        }
        items.append(one)

    core = {
        "version": str(env.get("version", "")),
        "claim_id": int(env.get("claim_id", 0)),
        "nonce": str(env.get("nonce", "")),
        "transcripts": items,
    }
    endpoint = str(env.get("endpoint", ""))
    if endpoint:
        core["endpoint"] = endpoint
    return json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_evidence(env: dict) -> str:
    core = json.loads(canonical(env))
    for item, original in zip(core["transcripts"], env.get("transcripts") or []):
        item["got"] = str(original.get("got", ""))
        observed = str(original.get("observed_at", ""))
        if observed:
            item["observed_at"] = observed
    return json.dumps(core, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def evidence_digest(env: dict) -> str:
    return hashlib.sha256(canonical_evidence(env).encode("utf-8")).hexdigest()


def digest(env: dict) -> str:
    return hashlib.sha256(canonical(env).encode("utf-8")).hexdigest()


def normalize_for_dedup(text: str) -> str:
    out = []
    for ch in text:
        o = ord(ch)
        if o in (0x200B, 0x200C, 0x200D, 0x2060, 0xFEFF):
            continue
        if ch.isspace():
            out.append(" ")
            continue
        out.append(ch.lower())
    flat = "".join(out)
    while "  " in flat:
        flat = flat.replace("  ", " ")
    return flat.strip()


# ---------------------------------------------------------------------------
# validation
# ---------------------------------------------------------------------------


def validate(env: dict, corpus: dict | None = None, plan: bool = False) -> list[str]:
    """Everything the contract will check, checked locally first. A reveal that
    reverts on chain still burns the window."""
    problems: list[str] = []

    if env.get("version") != VERSION:
        problems.append("version must be exactly %s" % VERSION)
    if not isinstance(env.get("claim_id"), int):
        problems.append("claim_id must be an integer")

    nonce = str(env.get("nonce", ""))
    if len(nonce) < 16 or len(nonce) > 64:
        problems.append("nonce must be 16 to 64 characters")
    elif any(ch not in "0123456789abcdefABCDEF" for ch in nonce):
        problems.append("nonce must be hex")

    ts = env.get("transcripts")
    if not isinstance(ts, list) or not ts:
        problems.append("transcripts must be a non-empty list")
        return problems
    if len(ts) > MAX_TRANSCRIPTS:
        problems.append("at most %d transcripts" % MAX_TRANSCRIPTS)

    known = {}
    if corpus:
        known = {p["probe_id"]: p for p in corpus.get("probes", [])}

    classes = set()
    for i, t in enumerate(ts):
        where = "transcripts[%d]" % i
        pid = str(t.get("probe_id", ""))
        cls = str(t.get("probe_class", ""))
        if not pid:
            problems.append("%s: probe_id is required" % where)
        if cls not in ACTIVE_CLASSES:
            problems.append("%s: probe_class %r is not judged in this version" % (where, cls))
        else:
            classes.add(cls)
        for field in (("sent",) if plan else ("sent", "got")):
            val = str(t.get(field, ""))
            if not val:
                problems.append("%s: %s is empty" % (where, field))
            elif len(val) > MAX_FIELD:
                problems.append("%s: %s exceeds %d bytes" % (where, field, MAX_FIELD))
        if known and pid and not pid.startswith("field:"):
            probe = known.get(pid)
            if probe is None:
                problems.append("%s: probe_id %r is not in the corpus" % (where, pid))
            elif probe.get("status") == "burned":
                problems.append("%s: probe %r is burned" % (where, pid))
            elif probe.get("class") != cls:
                problems.append(
                    "%s: probe %r is class %r in the corpus, not %r"
                    % (where, pid, probe.get("class"), cls)
                )

    if len(classes) < 2:
        problems.append(
            "a round covering fewer than two classes can only ever return "
            "INCONCLUSIVE — add probes from another class"
        )
    return problems


# ---------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------


def load_corpus() -> dict:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def cmd_new(args: argparse.Namespace) -> int:
    corpus = load_corpus()
    by_id = {p["probe_id"]: p for p in corpus["probes"]}
    burned = set()
    if args.burned and os.path.exists(args.burned):
        burned = set(json.loads(pathlib.Path(args.burned).read_text()))

    if args.probes:
        wanted = [p.strip() for p in args.probes.split(",") if p.strip()]
    else:
        # Default selection: spread across every active class, because a round
        # confined to one class cannot produce anything but INCONCLUSIVE.
        wanted = []
        for cls in ACTIVE_CLASSES:
            pool = [
                p["probe_id"]
                for p in corpus["probes"]
                if p["class"] == cls
                and p.get("status") == "active"
                and p["probe_id"] not in burned
            ]
            wanted.extend(pool[: args.per_class])

    transcripts = []
    for pid in wanted:
        if pid in burned:
            print("skipping burned probe %s" % pid, file=sys.stderr)
            continue
        probe = by_id.get(pid)
        if probe is None:
            print("unknown probe %s" % pid, file=sys.stderr)
            return 2
        transcripts.append(
            {
                "probe_id": pid,
                "probe_class": probe["class"],
                "sent": probe["carrier"],
                "got": "",
                "observed_at": "",
            }
        )

    env = {
        "version": VERSION,
        "claim_id": args.claim,
        "nonce": secrets.token_hex(16),
        "transcripts": transcripts,
        "endpoint": "",
        "author_note": "",
        "expects": "",
    }
    json.dump(env, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    print(
        "\n%d probes across %d classes. Commit the hash BEFORE sending any of "
        "these to the agent." % (len(transcripts), len({t["probe_class"] for t in transcripts})),
        file=sys.stderr,
    )
    return 0


def cmd_hash(args: argparse.Namespace) -> int:
    env = json.loads(pathlib.Path(args.envelope).read_text(encoding="utf-8"))
    problems = validate(env, load_corpus(), plan=True)
    if problems and not args.force:
        for p in problems:
            print("  " + p, file=sys.stderr)
        print("\nrefusing to hash an envelope the contract will reject; --force to override", file=sys.stderr)
        return 1
    print(digest(env))
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    env = json.loads(pathlib.Path(args.envelope).read_text(encoding="utf-8"))
    problems = validate(env, load_corpus())
    if problems:
        for p in problems:
            print("  " + p)
        return 1
    classes = sorted({t["probe_class"] for t in env["transcripts"]})
    print("ok: %d transcripts, classes: %s" % (len(env["transcripts"]), ", ".join(classes)))
    print("digest: %s" % digest(env))
    return 0


def cmd_canonical(args: argparse.Namespace) -> int:
    env = json.loads(pathlib.Path(args.envelope).read_text(encoding="utf-8"))
    sys.stdout.write(canonical(env) + "\n")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="round.py", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("new", help="assemble a skeleton round from the corpus")
    p.add_argument("--claim", type=int, required=True)
    p.add_argument("--probes", default="", help="comma separated probe ids")
    p.add_argument("--per-class", type=int, default=2)
    p.add_argument("--burned", default="", help="json list of burned probe ids")
    p.set_defaults(fn=cmd_new)

    p = sub.add_parser("hash", help="digest to commit on chain")
    p.add_argument("envelope")
    p.add_argument("--force", action="store_true")
    p.set_defaults(fn=cmd_hash)

    p = sub.add_parser("check", help="run every check the contract runs")
    p.add_argument("envelope")
    p.set_defaults(fn=cmd_check)

    p = sub.add_parser("canonical", help="print the exact string that gets hashed")
    p.add_argument("envelope")
    p.set_defaults(fn=cmd_canonical)

    args = ap.parse_args(argv)
    return args.fn(args)


if __name__ == "__main__":
    raise SystemExit(main())
