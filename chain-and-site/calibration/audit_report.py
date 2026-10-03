#!/usr/bin/env python3
"""Audit a completed frozen run and reproduce its matrix without network calls.

The report excludes response text and credentials. Keep the raw files whose
SHA256 digests it records if independent recomputation will be needed.
"""
from __future__ import annotations
import argparse
import datetime as dt
from collections import Counter
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build_matrix as B
import check_matrix as G
import openrouter_battery as O


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def account(path):
    events = O.records(path / "ledger.jsonl")
    debit, pending, completed = O.budget_state(events)
    require(not pending, "unresolved billing reservations in " + path.name)
    actual = sum((O.money(r["cost_usd"]) for r in completed.values()), Decimal(0))
    unknown = sum((O.money(e["cost_usd"]) for e in events if e["event"] == "resolved_failed"), Decimal(0))
    require(debit == actual + unknown, "budget ledger does not balance")
    return {"dataset": path.name, "ledger_sha256": digest(path / "ledger.jsonl"),
            "successful_calls": len(completed),
            "attempts": sum(e["event"] == "reserved" for e in events),
            "failed_attempts": sum(e["event"] == "failed" for e in events),
            "reported_success_cost_usd": str(actual),
            "unknown_attempts_full_reservation_debit_usd": str(unknown),
            "conservative_debit_usd": str(debit), "pending_reservations": 0}, completed


def audit(run_dir, discarded, merged, matrix_path):
    plan_path = run_dir / "plan.json"
    plan = json.loads(plan_path.read_text())
    plan_hash = hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()
    budget, completed = account(run_dir)
    require(len(completed) == plan["calls"], "run is incomplete; do not inspect holdout")
    expected = {(f, p["probe_id"], i) for f in plan["families"]
                for p in plan["probes"] for i in range(plan["k"])}
    require(len(expected) == plan["calls"], "plan has duplicate coordinates")
    probes = {p["probe_id"]: p for p in plan["probes"]}
    seen = set()
    response_ids = set()
    partitions = {"training": set(), "heldout": set()}
    source_files = []
    per_family = {}
    timestamps = []
    for family, spec in plan["families"].items():
        path = run_dir / (family + ".jsonl")
        header, rows = B.load(path)
        require(header["provenance"]["kind"] == "live", "non-live family file")
        require(header["provenance"]["plan_sha256"] == plan_hash, "family plan differs")
        require(header["corpus_digest"] == plan["corpus_digest"], "family corpus differs")
        source_files.append({"file": path.name, "sha256": digest(path), "rows": len(rows)})
        endings = Counter()
        for r in rows:
            coord = (r["family"], r["probe_id"], r["run_index"])
            require(coord not in seen and coord in expected, "duplicate or unexpected sample")
            require(r["identity"] == "%s:%s:%d" % coord, "logical identity differs")
            require(r == completed.get(r["identity"]), "raw record differs from ledger")
            require(r["family"] == family and r["model"] == spec["model"], "requested identity differs")
            require(r["response_model"] == spec["model"] and r["response_provider"] == spec["provider"], "observed identity differs")
            require(r["got"].strip() and not r.get("error"), "empty or failed response")
            require(r["sent"] == probes[r["probe_id"]]["carrier"], "prompt differs from frozen plan")
            require(r["probe_class"] == probes[r["probe_id"]]["class"], "probe class differs")
            require(O.money(r["cost_usd"]) == O.money(r["usage"]["cost"]), "cost differs from usage receipt")
            require(r["response_id"] not in response_ids, "duplicate upstream response ID")
            response_ids.add(r["response_id"])
            seen.add(coord)
            split = "training" if (r["run_index"] // B.BATCH_SIZE) % 2 == 0 else "heldout"
            partitions[split].add(coord)
            endings[r.get("finish_reason") or "missing"] += 1
            timestamps.append(r["observed_at"])
        per_family[family] = {"model": spec["model"], "provider": spec["provider"],
                              "endpoint_tag": spec["tag"], "responses": len(rows),
                              "finish_reasons": dict(endings)}
    require(dt.datetime.fromisoformat(min(timestamps)) >= dt.datetime.fromisoformat(plan["created_at"]), "plan postdates collection")
    require(seen == expected, "incomplete family/probe/repeat coverage")
    require(not partitions["training"] & partitions["heldout"], "raw training/test overlap")
    require(partitions["training"] | partitions["heldout"] == expected, "unassigned raw response")
    require(plan["k"] % (2 * B.BATCH_SIZE) == 0, "unbalanced disjoint batches")
    matrix = json.loads(matrix_path.read_text())
    require(B.build(merged) == matrix, "published candidate does not reproduce from source")
    merged_header, merged_rows = B.load(merged)
    require({r["identity"]: r for r in merged_rows} == completed and len(merged_rows) == len(completed),
            "merged file differs from completed ledger")
    require(merged_header["corpus_digest"] == plan["corpus_digest"], "merged corpus differs")
    verdict, code, reasons = G.decide(matrix, .75, .10, False)
    old = [account(path)[0] for path in discarded]
    total_debit = sum((O.money(x["conservative_debit_usd"]) for x in [budget, *old]), Decimal(0))
    require(total_debit <= Decimal("8.50"), "battery allocation exceeded")
    history = O.records(run_dir / "recovery.jsonl")
    files = [ROOT / "scripts" / name for name in
             ("build_matrix.py", "check_matrix.py", "features.py", "merge_runs.py", "openrouter_battery.py")]
    files.append(Path(__file__).resolve())
    return {
        "schema": "voirdire-calibration-audit/1", "audited_at": O.now(),
        "quality_status": "COMPLETE_AND_REPRODUCIBLE", "responses": len(seen),
        "unique_upstream_response_ids": len(response_ids), "corpus_version": plan["corpus_version"],
        "corpus_sha256": plan["corpus_digest"], "plan_file_sha256": digest(plan_path),
        "plan_canonical_sha256": plan_hash, "plan_created_at": plan["created_at"],
        "first_response_at": min(timestamps), "last_response_at": max(timestamps),
        "per_family": per_family, "sources": source_files,
        "merged_file": {"file": merged.name, "sha256": digest(merged)},
        "matrix_file": {"file": matrix_path.name, "sha256": digest(matrix_path)},
        "source_code_sha256": {str(path.relative_to(ROOT)): digest(path) for path in files},
        "disjointness": {"evaluation_method": B.METHOD, "responses_per_probe_batch": B.BATCH_SIZE,
                         "split": "even batch indices train; odd batch indices held out",
                         "training_raw_responses": len(partitions["training"]),
                         "heldout_raw_responses": len(partitions["heldout"]),
                         "raw_overlap": 0, "discarded_partial_batches": 0,
                         "training_battery_samples_per_family": plan["k"] // (2*B.BATCH_SIZE),
                         "heldout_battery_samples_per_family": plan["k"] // (2*B.BATCH_SIZE)},
        "gate": {"verdict": verdict, "exit_code": code, "min_accuracy": .75,
                 "max_false_accusation": .10, "reasons": reasons},
        "battery_metrics": matrix["battery"],
        "budget": {"user_total_authorized_usd": "9.50", "battery_allocation_usd": "8.50",
                   "separate_application_smoke_allocation_usd": "0.99",
                   "bounded_storage_verification_allocation_usd": "0.01",
                   "active": budget, "discarded_datasets": old,
                   "battery_conservative_total_usd": str(total_debit),
                   "application_smoke_note": "Application smoke and bounded storage verification spending are outside this measurement ledger."},
        "recovery": {"journal_sha256": digest(run_dir / "recovery.jsonl"),
                     "authorized_429_recoveries": sum(e["event"] == "authorized_429_recovery" for e in history),
                     "manual_one_shot_503_recoveries": sum(e["event"] == "authorized_one_shot_503_recovery" for e in history),
                     "max_429_recoveries": history[0]["max_retries"]},
        "limitations": [
            "Measures only these exact model IDs, providers, prompts, temperature and 600-token response cap.",
            "Raw responses, including output-cap truncations, were retained; no feature or threshold tuning against this holdout.",
            "Wilson intervals are per metric/family, not a simultaneous family-wise guarantee.",
            "The plan was saved before collection. Evaluator source hashes were recorded at analysis, not embedded in the initial plan.",
            "Provider/model identity is reported by OpenRouter; it is not cryptographic proof of model weights.",
            "Reported successful-call costs and conservative debits for ambiguous attempts are distinct; upstream billing may differ for those attempts.",
            "Raw JSONL files remain local unless separately published; this report records their hashes without response text."
        ]
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--run-dir", type=Path, required=True)
    ap.add_argument("--discarded", type=Path, action="append", default=[])
    ap.add_argument("--merged", type=Path, required=True)
    ap.add_argument("--matrix", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    result = audit(args.run_dir, args.discarded, args.merged, args.matrix)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"quality": result["quality_status"], "responses": result["responses"],
                      "gate": result["gate"], "battery_conservative_total_usd": result["budget"]["battery_conservative_total_usd"]}, indent=2))
    return result["gate"]["exit_code"]


if __name__ == "__main__":
    raise SystemExit(main())
