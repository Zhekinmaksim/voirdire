import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import unittest
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / 'chain-and-site/scripts'))
spec=importlib.util.spec_from_file_location('v3_frozen_classifier', ROOT/'chain-and-site/calibration/candidates/int-v3/classifier.py')
C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C)
import round_classifier as F
PROFILE = json.loads((ROOT / 'chain-and-site/calibration/candidates/int-v3/profile.json').read_text())

class IntegerFeatures(unittest.TestCase):
    def test_exact_source_is_profile_pinned(self):
        self.assertEqual(PROFILE['classifier_source_sha256'], hashlib.sha256((ROOT / 'chain-and-site/calibration/candidates/int-v3/classifier.py').read_bytes()).hexdigest())
    def test_fixed_log_formula_accuracy_without_runtime_float(self):
        for n in list(range(1, 500)) + [10000, 10**18, 2**255, 10**100]:
            self.assertLess(abs(C._log_integer(n)/C.SCALE - math.log(n)), 1.1e-6)
    def test_unicode_and_markers_track_parent_single_response_features(self):
        texts = ['', '17', '-12,345 and ٣٤５', 'İ Ω ² Ⅳ 你好\r\nA\x85B\u2028C',
                 'I cannot help. However, consult a doctor. Generally, both sides.',
                 'Zero-width U+200B combining characters!', '```json\n{"KEY": 1}\n```',
                 "[...]{X}: ; ! ?\n\n words  words", 'one' * 1000]
        for cls in ('tokenizer_artifact', 'refusal_shape', 'repeat_stability'):
            for text in texts:
                integer = C.raw_features(cls, text)
                parent = F.raw_features(cls, text)
                self.assertEqual(len(integer), len(parent))
                for actual, expected in zip(integer, parent):
                    self.assertLess(abs(actual/C.SCALE-expected), 2e-6, (cls, repr(text[:30]), actual, expected))
    def test_standardization_and_distance_are_integer_only(self):
        corpus = json.loads((ROOT / 'chain-and-site/corpus/probes.json').read_text())
        probes = {p['probe_id']:p for p in corpus['probes']}
        ts = [{'probe_id':pid,'probe_class':PROFILE['probe_classes'][pid],
               'sent':probes[pid]['carrier'],'got':'Novel output not guaranteed in domain'} for pid in PROFILE['probe_ids']]
        self.assertTrue(all(type(x) is int for x in C.vector(PROFILE, ts)))
        result=C.predict(PROFILE,ts)
        self.assertIs(type(result['distance_squared']),int)
        self.assertIs(type(result['radius_squared']),int)
    def test_frozen_probe_validation_fail_closed(self):
        self.assertEqual(C.predict(PROFILE,[])['decision'],'ABSTAIN')

if __name__=='__main__':unittest.main()
