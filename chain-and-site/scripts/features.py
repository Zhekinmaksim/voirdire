#!/usr/bin/env python3
"""Turn raw responses into a numeric signature, deterministically.

This module is the load-bearing half of the off-chain measurement. The contract
asks a validator for a judgement; the confusion matrix asks nothing of any model
at all — it extracts fixed features from the text and does arithmetic. That
separation is on purpose. A matrix whose numbers came from a model judging its
own family is not a measurement.

Everything here must be a pure function of the response strings. No randomness,
no clock, no network. Two people running this on the same runs must get the same
vector, or the published matrix is not reproducible.

One feature vector is produced per (probe, family) from that probe's k runs.
"""

from __future__ import annotations

import math
import re

# Markers are lowercase-matched against the response. They are heuristics and
# they are wrong sometimes; what matters for a matrix is that they are wrong in
# the same way for every family, so the error does not favour anyone.

REFUSAL_MARKERS = (
    "i can't", "i cannot", "i won't", "i'm not able", "i am not able",
    "i'm unable", "cannot help", "can't help", "not something i can",
    "i must decline", "i'd rather not",
)

CAVEAT_MARKERS = (
    "however", "that said", "keep in mind", "important to note", "please note",
    "i'm not a lawyer", "i am not a lawyer", "not legal advice",
    "not a substitute", "consult a", "speak to a", "see a doctor",
    "seek professional", "for informational purposes", "be careful",
    "safety note", "a caveat", "worth noting",
)

HEDGE_MARKERS = (
    "generally", "typically", "usually", "in most cases", "it depends",
    "roughly", "approximately", "about", "might", "may ", "could ",
    "tends to", "often",
)

BALANCE_MARKERS = (
    "on the other hand", "the counterargument", "the other side",
    "to be fair", "critics argue", "proponents argue", "both sides",
)

INVISIBLE_MARKERS = (
    "zero-width", "zero width", "zwj", "zwnj", "u+200", "combining",
    "codepoint", "code point", "grapheme", "invisible character",
    "non-printing",
)

_INT = re.compile(r"-?\d[\d,]*")
_WORD = re.compile(r"[a-zà-ÿ']+")


def _ints(text: str) -> list[int]:
    out = []
    for m in _INT.finditer(text):
        try:
            out.append(int(m.group(0).replace(",", "")))
        except ValueError:
            pass
    return out


def _first_int(text: str):
    got = _ints(text)
    return got[0] if got else None


def _log1p(x: float) -> float:
    return math.log1p(abs(float(x))) * (1.0 if x >= 0 else -1.0)


def _hits(text: str, markers) -> int:
    low = text.lower()
    return sum(1 for m in markers if m in low)


def _first_hit_position(text: str, markers) -> float:
    """Where in the response the first marker appears, as a fraction. 1.0 means
    absent, which reads as 'at the very end or not at all' and is the right
    default: what the class measures is how early a caveat lands."""
    low = text.lower()
    best = None
    for m in markers:
        i = low.find(m)
        if i >= 0 and (best is None or i < best):
            best = i
    if best is None or not low:
        return 1.0
    return min(1.0, best / max(1, len(low)))


def _words(text: str) -> set:
    return set(_WORD.findall(text.lower()))


def _mean_pairwise_jaccard(runs: list[str]) -> float:
    sets = [_words(r) for r in runs if r.strip()]
    if len(sets) < 2:
        return 1.0
    total = 0.0
    n = 0
    for i in range(len(sets)):
        for j in range(i + 1, len(sets)):
            union = sets[i] | sets[j]
            if not union:
                continue
            total += len(sets[i] & sets[j]) / len(union)
            n += 1
    return total / n if n else 1.0


def _numeric_spread(runs: list[str]) -> float:
    vals = [v for v in (_first_int(r) for r in runs) if v is not None]
    if len(vals) < 2:
        return 0.0
    mean = sum(vals) / len(vals)
    if mean == 0:
        return 0.0
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    return min(2.0, math.sqrt(var) / abs(mean))


def _modal_fraction(runs: list[str]) -> tuple[float, float]:
    """Support size and modal frequency over the normalized first answer.

    For repeat_stability the whole signal is the shape of the distribution, not
    its content, so the answer is squeezed to a short key first.
    """
    keys = []
    for r in runs:
        first = _first_int(r)
        if first is not None:
            keys.append("n:%d" % first)
        else:
            w = _WORD.findall(r.lower())
            keys.append("w:" + (w[0] if w else ""))
    if not keys:
        return 0.0, 0.0
    counts: dict = {}
    for k in keys:
        counts[k] = counts.get(k, 0) + 1
    support = len(counts) / len(keys)
    modal = max(counts.values()) / len(keys)
    return support, modal


# ---------------------------------------------------------------------------
# per-class extractors
# ---------------------------------------------------------------------------


def _tokenizer(runs: list[str]) -> dict:
    firsts = [v for v in (_first_int(r) for r in runs) if v is not None]
    mean_first = sum(firsts) / len(firsts) if firsts else 0.0
    return {
        "first_int": _log1p(mean_first) / 8.0,  # kept on the same 0..1-ish scale as the rest
        "int_density": sum(len(_ints(r)) for r in runs) / max(1, len(runs)) / 8.0,
        "names_invisible": sum(1 for r in runs if _hits(r, INVISIBLE_MARKERS)) / max(1, len(runs)),
        "answer_spread": _numeric_spread(runs),
        "length": _log1p(sum(len(r) for r in runs) / max(1, len(runs))) / 8.0,
    }


def _refusal(runs: list[str]) -> dict:
    return {
        "refused": sum(1 for r in runs if _hits(r, REFUSAL_MARKERS)) / max(1, len(runs)),
        "caveat_count": sum(_hits(r, CAVEAT_MARKERS) for r in runs) / max(1, len(runs)) / 4.0,
        "caveat_position": sum(_first_hit_position(r, CAVEAT_MARKERS) for r in runs) / max(1, len(runs)),
        "hedge_density": sum(_hits(r, HEDGE_MARKERS) for r in runs) / max(1, len(runs)) / 6.0,
        "balanced_unprompted": sum(1 for r in runs if _hits(r, BALANCE_MARKERS)) / max(1, len(runs)),
        "length": _log1p(sum(len(r) for r in runs) / max(1, len(runs))) / 8.0,
    }


def _stability(runs: list[str]) -> dict:
    support, modal = _modal_fraction(runs)
    return {
        "support": support,
        "modal": modal,
        "lexical_overlap": _mean_pairwise_jaccard(runs),
        "numeric_spread": _numeric_spread(runs),
        "length_spread": _numeric_spread([str(len(r)) for r in runs]),
    }


EXTRACTORS = {
    "tokenizer_artifact": _tokenizer,
    "refusal_shape": _refusal,
    "repeat_stability": _stability,
}

# Feature order is fixed per class so that a vector is comparable across runs
# and across machines. Adding a feature is a corpus version bump, not a patch.
ORDER = {
    "tokenizer_artifact": ("first_int", "int_density", "names_invisible", "answer_spread", "length"),
    "refusal_shape": ("refused", "caveat_count", "caveat_position", "hedge_density", "balanced_unprompted", "length"),
    "repeat_stability": ("support", "modal", "lexical_overlap", "numeric_spread", "length_spread"),
}


def signature(probe_class: str, runs: list[str]) -> list[float]:
    if probe_class not in EXTRACTORS:
        raise KeyError("no extractor for class %r" % probe_class)
    raw = EXTRACTORS[probe_class](runs)
    return [float(raw[name]) for name in ORDER[probe_class]]


def feature_names(probe_class: str) -> tuple:
    return ORDER[probe_class]


def distance(a: list[float], b: list[float]) -> float:
    """Plain euclidean on already-normalized features. Deliberately not learned:
    a fitted metric on four families and twenty probes would memorise the
    families and report a number that means nothing out of sample."""
    if len(a) != len(b):
        raise ValueError("feature vector dimensions differ")
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


if __name__ == "__main__":
    demo = ["The answer is 17.", "17", "Probably 17, though it varies."]
    for cls in ORDER:
        print(cls, dict(zip(feature_names(cls), signature(cls, demo))))
