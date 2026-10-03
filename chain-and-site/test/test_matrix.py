"""Regression checks for raw-response isolation and fail-closed publication."""
import copy
import pathlib
import sys
import unittest
from unittest.mock import patch
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
import build_matrix as B
import check_matrix as G
import features as F
import merge_runs as M


class MatrixTests(unittest.TestCase):
    def test_raw_batches_never_overlap(self):
        runs = [dict(family="a", probe_id="p", probe_class="repeat_stability", run_index=i,
                     got=str(i)) for i in range(30)]
        seen = []
        with patch.object(F, "signature", side_effect=lambda cls, texts: seen.append(texts) or [1]):
            sigs = B.samples(runs)
        self.assertEqual(len(sigs["a", "p", "repeat_stability"]), 10)
        train = {x for batch in seen[::2] for x in batch}
        test = {x for batch in seen[1::2] for x in batch}
        self.assertFalse(train & test)
        self.assertEqual(len(train | test), 30)

    def test_test_data_does_not_fit_centroids(self):
        # Training labels and test labels deliberately conflict. A classifier
        # leaking held-out rows into centroids can mask this failure.
        conf, _ = B.classify_probe({"a": [[0.], [10.]], "b": [[10.], [0.]]})
        self.assertEqual(conf, {"a": {"a": 0, "b": 1}, "b": {"a": 1, "b": 0}})

    def test_duplicate_and_failed_responses_rejected(self):
        r = dict(family="a", probe_id="p", probe_class="repeat_stability", run_index=0, got="x")
        with self.assertRaises(ValueError): B.samples([r, r])
        with self.assertRaises(ValueError): B.samples([{**r, "error": "timeout"}])

    def test_dimensions_cannot_silently_truncate(self):
        with self.assertRaises(ValueError): F.distance([1, 2], [1])

    def matrix(self, n=100):
        return dict(evaluation_method=B.METHOD, provenance=dict(kind="live"), families=["a", "b"],
                    battery=dict(samples=2*n, accuracy=1., confusion={"a":{"a":n,"b":0}, "b":{"a":0,"b":n}},
                                 pairs=[dict(a="a",b="b",verdict="SEPARATES")]))

    def test_fixture_cannot_bypass_gate(self):
        m = self.matrix(); m["provenance"]["kind"] = "fixture"
        self.assertEqual(G.decide(m, .75, .1, True)[1], 2)

    def test_small_perfect_sample_insufficient(self):
        self.assertEqual(G.decide(self.matrix(5), .75, .1)[1], 2)
        self.assertEqual(G.decide(self.matrix(), .75, .1)[1], 0)

    def test_legacy_and_empty_matrix_rejected(self):
        m = self.matrix(); del m["evaluation_method"]
        self.assertEqual(G.decide(m, .75, .1)[1], 2)
        self.assertEqual(G.decide(self.matrix(0), .75, .1)[1], 2)

    def test_nan_and_forged_counts_rejected(self):
        m = self.matrix(); m["battery"]["accuracy"] = float("nan")
        self.assertEqual(G.decide(m, .75, .1)[1], 2)
        m = self.matrix(); m["battery"]["samples"] = 1
        self.assertEqual(G.decide(m, .75, .1)[1], 2)

    def test_incomplete_coverage_rejected(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "runs" / "fixture.jsonl"
        h, runs = B.load(path)
        runs = [r for r in runs if not (r["family"] == h["families"][0] and r["probe_id"] == runs[0]["probe_id"])]
        with patch.object(B, "load", return_value=(h,runs)):
            with self.assertRaises(ValueError): B.build(path)

    def test_duplicate_merge_rejected(self):
        path = pathlib.Path(__file__).resolve().parents[1] / "runs" / "fixture.jsonl"
        with self.assertRaises(ValueError): M.merge([path,path])


if __name__ == "__main__": unittest.main()
