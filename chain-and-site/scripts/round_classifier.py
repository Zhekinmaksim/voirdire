#!/usr/bin/env python3
"""Versioned six-probe behavioural classifier. Research-only until fresh PASS.

No network, billing or on-chain writes. Thresholds never adapt during predict.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import features as F

VERSION = 'voirdire-round-centroid/1'
GENERIC_NAMES = ['log_chars', 'log_words', 'log_lines', 'digit_fraction',
                 'uppercase_fraction', 'punctuation_fraction', 'code_fence', 'json_open']


def raw_features(probe_class, text):
    n = max(1, len(text))
    return F.signature(probe_class, [text]) + [
        math.log1p(len(text)), math.log1p(len(text.split())),
        math.log1p(len(text.splitlines())), sum(c.isdigit() for c in text)/n,
        sum(c.isupper() for c in text)/n,
        sum(c in '{}[]():;,.!?"' for c in text)/n,
        float('```' in text), float(text.lstrip().startswith(('{', '[')))]


def load_candidate(path):
    candidate = json.loads(Path(path).read_text())
    if candidate['version'] != VERSION:
        raise ValueError('Unsupported classifier version')
    feature_hash = hashlib.sha256(Path(F.__file__).read_bytes()).hexdigest()
    if candidate['features_source_sha256'] != feature_hash:
        raise ValueError('Feature implementation differs from frozen candidate')
    if candidate['classifier_source_sha256'] != hashlib.sha256(Path(__file__).read_bytes()).hexdigest():
        raise ValueError('Classifier implementation differs from frozen candidate')
    return candidate


def vector(candidate, transcripts):
    if not isinstance(transcripts, list) or len(transcripts) != 6:
        raise ValueError('Exactly six transcripts required')
    indexed = {t['probe_id']: t for t in transcripts}
    if len(indexed) != 6 or set(indexed) != set(candidate['probe_ids']):
        raise ValueError('Unique frozen probe set required')
    result = []
    for pid in candidate['probe_ids']:
        t = indexed[pid]
        if t['probe_class'] != candidate['probe_classes'][pid]:
            raise ValueError('Probe class differs')
        if hashlib.sha256(t['sent'].encode()).hexdigest() != candidate['probe_prompt_sha256'][pid]:
            raise ValueError('Probe prompt differs')
        if not isinstance(t['got'], str) or not t['got'].strip():
            raise ValueError('Empty response')
        raw = raw_features(t['probe_class'], t['got'])
        scale = candidate['scalers'][pid]
        if len(raw) != len(scale['mean']):
            raise ValueError('Feature dimensions differ')
        result.extend((raw[j]-scale['mean'][j])/scale['population_std'][j]
                      for j in scale['retained_dimensions'])
    if not all(math.isfinite(x) for x in result):
        raise ValueError('Nonfinite vector')
    return result


def predict(candidate, transcripts):
    try:
        v = vector(candidate, transcripts)
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        return {'decision': 'ABSTAIN', 'reason': 'invalid_evidence', 'detail': str(error)}
    distances = []
    for family, center in candidate['centroids'].items():
        if len(v) != len(center):
            raise ValueError('Invalid candidate centroid dimension')
        distances.append((math.sqrt(sum((x-y)**2 for x, y in zip(v, center))), family))
    distances.sort()
    nearest, family = distances[0]
    margin = (distances[1][0]-nearest)/max(distances[1][0], 1e-12)
    reason = 'within_profile'
    if nearest > candidate['rejection_radius'][family]:
        reason = 'outside_training_profile'
    elif margin < candidate['margin_threshold']:
        reason = 'ambiguous_margin'
    return {'decision': family if reason == 'within_profile' else 'ABSTAIN',
            'nearest_family': family, 'distance': nearest, 'margin': margin,
            'reason': reason}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--envelope', type=Path, required=True)
    args = parser.parse_args()
    envelope = json.loads(args.envelope.read_text())
    print(json.dumps(predict(load_candidate(args.candidate), envelope['transcripts']), indent=2))


if __name__ == '__main__':
    main()
