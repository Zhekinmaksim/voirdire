"""Frozen-formula integer six-response classifier candidate; research only.
All runtime arithmetic is integer. Score scale=10**6. Ratios truncate toward
zero. ln uses power-of-two reduction and 40 atanh-series terms at10**24 scale.
Profile float parameters quantize nearest-ties-even OFFLINE only. Distances
are squared integers; radius comparison is inclusive. No learned margin.
"""
import hashlib
import re

VERSION = "voirdire-round-centroid-int/1"
SCALE = 1_000_000
_LOG_SCALE = 10 ** 24
_LN2 = 693147180559945309417232

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


def _trunc(n, d):
    if d <= 0:
        raise ValueError("positive denominator required")
    return n // d if n >= 0 else -((-n) // d)


def _log_integer(n):
    """floor-compatible ln(n) at feature scale, n positive integer."""
    if n < 1:
        raise ValueError("positive log argument required")
    k = n.bit_length() - 1
    unit = 1 << k
    y = (n - unit) * _LOG_SCALE // (n + unit)
    y2 = y * y // _LOG_SCALE
    term = y
    total = 0
    for denominator in range(1, 80, 2):
        total += term // denominator
        term = term * y2 // _LOG_SCALE
    return (k * _LN2 + 2 * total) // (_LOG_SCALE // SCALE)


def _ints(text):
    result = []
    for item in _INT.finditer(text):
        try:
            result.append(int(item.group(0).replace(",", "")))
        except ValueError:
            pass
    return result


def _hits(text, markers):
    low = text.lower()
    return sum(1 for marker in markers if marker in low)


def raw_features(probe_class, text):
    n = max(1, len(text))
    log_length = _log_integer(len(text) + 1)
    if probe_class == "tokenizer_artifact":
        ints = _ints(text)
        first = ints[0] if ints else 0
        signed_log = _log_integer(abs(first) + 1) * (-1 if first < 0 else 1)
        values = [_trunc(signed_log, 8), len(ints) * SCALE // 8,
                  SCALE if _hits(text, INVISIBLE_MARKERS) else 0, 0,
                  log_length // 8]
    elif probe_class == "refusal_shape":
        low = text.lower()
        positions = [low.find(m) for m in CAVEAT_MARKERS if m in low]
        position = min(positions) * SCALE // max(1, len(low)) if positions else SCALE
        values = [SCALE if _hits(text, REFUSAL_MARKERS) else 0,
                  _hits(text, CAVEAT_MARKERS) * SCALE // 4, position,
                  _hits(text, HEDGE_MARKERS) * SCALE // 6,
                  SCALE if _hits(text, BALANCE_MARKERS) else 0, log_length // 8]
    elif probe_class == "repeat_stability":
        # Signature over ONE response has constant support/modal/overlap and
        # zero spreads. No false claim that a single response measures repeat
        # stability; discrimination here comes from generic textual features.
        values = [SCALE, SCALE, SCALE, 0, 0]
    else:
        raise ValueError("unsupported probe class")
    return values + [log_length, _log_integer(len(text.split()) + 1),
        _log_integer(len(text.splitlines()) + 1),
        sum(c.isdigit() for c in text) * SCALE // n,
        sum(c.isupper() for c in text) * SCALE // n,
        sum(c in '{}[]():;,.!?"' for c in text) * SCALE // n,
        SCALE if '```' in text else 0,
        SCALE if text.lstrip().startswith(('{', '[')) else 0]


def vector(candidate, transcripts):
    if candidate["version"] != VERSION or candidate["scale"] != SCALE:
        raise ValueError("unsupported integer profile")
    if not isinstance(transcripts, list) or len(transcripts) != 6:
        raise ValueError("exactly six transcripts required")
    indexed = {t["probe_id"]: t for t in transcripts}
    if len(indexed) != 6 or set(indexed) != set(candidate["probe_ids"]):
        raise ValueError("unique frozen probe set required")
    result = []
    for pid in candidate["probe_ids"]:
        t = indexed[pid]
        if t["probe_class"] != candidate["probe_classes"][pid]:
            raise ValueError("probe class differs")
        if hashlib.sha256(t["sent"].encode()).hexdigest() != candidate["probe_prompt_sha256"][pid]:
            raise ValueError("probe prompt differs")
        if not isinstance(t["got"], str) or not t["got"].strip() or len(t["got"]) > 4096:
            raise ValueError("response missing or too long")
        raw = raw_features(t["probe_class"], t["got"])
        scaler = candidate["scalers"][pid]
        if len(raw) != len(scaler["mean"]):
            raise ValueError("feature dimensions differ")
        for j in scaler["retained_dimensions"]:
            result.append(_trunc((raw[j] - scaler["mean"][j]) * SCALE,
                                 scaler["population_std"][j]))
    return result


def predict(candidate, transcripts):
    try:
        values = vector(candidate, transcripts)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        return {"decision": "ABSTAIN", "reason": "invalid_evidence", "detail": str(error)}
    distances = []
    for family, center in candidate["centroids"].items():
        if len(values) != len(center):
            raise ValueError("centroid dimension differs")
        distances.append((sum((x-y)*(x-y) for x, y in zip(values, center)), family))
    distances.sort()
    nearest, family = distances[0]
    accepted = nearest <= candidate["rejection_radius"][family] ** 2
    return {"decision": family if accepted else "ABSTAIN", "nearest_family": family,
            "distance_squared": nearest, "radius_squared": candidate["rejection_radius"][family] ** 2,
            "reason": "within_profile" if accepted else "outside_training_profile"}
