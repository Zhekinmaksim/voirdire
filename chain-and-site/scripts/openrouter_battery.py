#!/usr/bin/env python3
"""Pinned OpenRouter battery. `plan` is read-only; `run` requires a USD budget.

Budget is cumulative for the output directory. A fsynced reservation precedes
any POST. Ambiguous requests are never retried automatically, including after a
crash. Existing completed responses are never overwritten. Use a separately
capped OpenRouter key for an upstream account-wide spending limit.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import datetime as dt
from email.utils import parsedate_to_datetime
from decimal import Decimal
import fcntl
import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = "https://openrouter.ai/api/v1"
MODELS = {
    "gpt-class": "openai/gpt-4o-mini",
    "claude-class": "anthropic/claude-haiku-4.5",
    "llama-class": "meta-llama/llama-3.3-70b-instruct",
    "mistral-class": "mistralai/mistral-small-3.2-24b-instruct",
}
MAX_TOKENS = 600


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def money(value):
    amount = Decimal(str(value))
    if not amount.is_finite() or amount < 0:
        raise ValueError("invalid nonnegative USD amount")
    return amount


def request(path, payload=None, key=None):
    headers = {"Content-Type": "application/json", "X-OpenRouter-Title": "VoirDire research battery"}
    if key:
        headers["Authorization"] = "Bearer " + key
    req = urllib.request.Request(API + path, headers=headers,
        data=None if payload is None else json.dumps(payload).encode(),
        method="GET" if payload is None else "POST")
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def load_key(path):
    """Read only OPENROUTER_API_KEY; never execute or print .env content."""
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    if path.exists():
        for line in path.read_text().splitlines():
            name, sep, value = line.strip().removeprefix("export ").partition("=")
            if sep and name.strip() == "OPENROUTER_API_KEY":
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                if value and not any(c.isspace() for c in value):
                    return value
    raise ValueError("OPENROUTER_API_KEY is missing")


def select_endpoint(data, provider_tag=None):
    candidates = []
    for ep in data["data"]["endpoints"]:
        if provider_tag is not None and ep.get("tag") != provider_tag:
            continue
        params = ep.get("supported_parameters", [])
        prices = ep.get("pricing", {})
        if ep.get("status") != 0 or not {"temperature", "max_tokens"} <= set(params):
            continue
        if not ep.get("tag") or not ep.get("provider_name") or not ep.get("context_length"):
            continue
        # No tools/media and no fixed request fees in this text-only experiment.
        if any(money(prices.get(k, 0)) for k in ("request", "internal_reasoning")):
            continue
        p, c = money(prices["prompt"]), money(prices["completion"])
        if ep.get("max_completion_tokens") is not None and ep["max_completion_tokens"] < MAX_TOKENS:
            continue
        direct = ep["tag"].split("/")[0] == data["data"].get("id", "").split("/")[0]
        candidates.append((p * 1000 + c * MAX_TOKENS, not direct, ep["tag"], ep))
    if not candidates:
        raise ValueError("no healthy endpoint supports pinned parameters and bounded text pricing")
    return min(candidates, key=lambda x: x[:3])[3]


def create_plan(corpus_path, families, k, provider_tags=None):
    provider_tags = provider_tags or {}
    if set(provider_tags) - set(families):
        raise ValueError("provider override names a family outside this plan")
    if k < 6 or k % 6:
        raise ValueError("k must be a positive multiple of six (disjoint training/test batches)")
    corpus_bytes = corpus_path.read_bytes()
    corpus = json.loads(corpus_bytes)
    probes = [p for p in corpus["probes"] if p.get("status") == "active" and
              p["class"] in {"tokenizer_artifact", "refusal_shape", "repeat_stability"}]
    if not probes or len(set(families)) < 2 or len(set(families)) != len(families):
        raise ValueError("need active probes and at least two unique families")
    selected = {}
    estimate = Decimal(0)
    for family in families:
        model = MODELS[family]
        ep = select_endpoint(request("/models/" + model + "/endpoints"), provider_tags.get(family))
        p, c = money(ep["pricing"]["prompt"]), money(ep["pricing"]["completion"])
        # Reserving full context price is deliberately stricter than estimating
        # prompt tokens. Unused reservation is released only after reported cost.
        reserve = p * ep["context_length"] + c * MAX_TOKENS
        selected[family] = {"model": model, "provider": ep["provider_name"], "tag": ep["tag"],
            "context_length": ep["context_length"], "pricing": ep["pricing"],
            "reservation_usd": str(reserve), "endpoint": ep,
            "routing": {"only": [ep["tag"]], "order": [ep["tag"]],
                        "allow_fallbacks": False, "require_parameters": True,
                        "max_price": {"prompt": float(p*1000000), "completion": float(c*1000000)}}}
        estimate += sum((p*(len(x["carrier"].encode())+256) + c*MAX_TOKENS)*k for x in probes)
    return {"version": "openrouter-battery/1", "created_at": now(),
            "corpus_digest": hashlib.sha256(corpus_bytes).hexdigest(), "corpus_version": corpus["version"],
            "k": k, "temperature": 1.0, "max_tokens": MAX_TOKENS, "families": selected,
            "probes": [{k: p[k] for k in ("probe_id", "class", "carrier")} for p in probes],
            "calls": len(selected)*len(probes)*k, "estimated_ceiling_usd": str(estimate),
            "estimate_note": "Byte-based input estimate plus 600 output tokens; not a billing guarantee. Each POST reserves full-context input cost."}


def append(path, record):
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def records(path):
    if not path.exists():
        return []
    # Torn or corrupt writes stop safely, rather than losing budget history.
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def budget_state(events):
    pending = {}
    completed = {}
    spend = Decimal(0)
    for e in events:
        ident = e["identity"]
        if e["event"] == "reserved":
            if ident in pending or ident in completed:
                raise ValueError("duplicate ledger request")
            pending[ident] = money(e["reservation_usd"])
        elif e["event"] == "completed":
            if ident not in pending:
                raise ValueError("completion without reservation")
            charged = money(e["cost_usd"])
            spend += charged
            del pending[ident]
            completed[ident] = e["response_record"]
        elif e["event"] == "resolved_failed":
            if ident not in pending or money(e["cost_usd"]) != pending[ident]:
                raise ValueError("failed reconciliation must charge the full outstanding reservation")
            spend += pending.pop(ident)
        elif e["event"] == "failed":
            if ident not in pending:
                raise ValueError("failure without reservation")
        else:
            raise ValueError("unknown ledger event")
    return spend, pending, completed


def reconcile(out, identity, charge_reservation):
    """Explicitly charge a failed attempt's full ceiling before permitting retry.

    This is a conservative budget debit, not a claim about actual provider
    billing. Original attempt and failure records remain append-only.
    """
    if not charge_reservation:
        raise ValueError("explicit --charge-reservation is required")
    ledger = out / "ledger.jsonl"
    if not ledger.exists():
        raise ValueError("no existing ledger to reconcile")
    with (out / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        events = records(ledger)
        spend, pending, completed = budget_state(events)
        if identity not in pending or identity in completed:
            raise ValueError("identity has no unresolved reservation")
        latest = next(e for e in reversed(events) if e["identity"] == identity)
        if latest["event"] != "failed":
            raise ValueError("attempt has no drained failure record; reconcile its outcome first")
        charged = pending[identity]
        append(ledger, {"event": "resolved_failed", "identity": identity,
                        "cost_usd": str(charged), "at": now(),
                        "resolution": "manual_full_reservation_charge",
                        "note": "Conservative ceiling charged to local budget; actual upstream cost unknown. Logical request may now be retried."})
        print("RECONCILED: charged reserved USD %s; cumulative budget debit USD %s" % (charged, spend + charged))
    return 0


class ModelPacer:
    """Serialize request starts per model; waiting never changes budget state."""
    def __init__(self, interval, models):
        self.interval = interval
        self.locks = {model: threading.Lock() for model in models}
        self.last_start = {}

    def call(self, path, payload, key):
        model = payload["model"]
        with self.locks[model]:
            previous = self.last_start.get(model)
            delay = 0 if previous is None else self.interval - (time.monotonic() - previous)
            if delay > 0:
                time.sleep(delay)
            self.last_start[model] = time.monotonic()
        return request(path, payload, key)


def http_diagnostics(exc, key, prompt):
    """Bounded, redacted remote message; never retain headers or request bodies."""
    if getattr(exc, "code", None) != 429:
        return {}
    result = {}
    headers = getattr(exc, "headers", None)
    retry = str(headers.get("Retry-After", "")) if headers else ""
    if retry and len(retry) <= 80 and re.fullmatch(r"[a-zA-Z0-9,: +./-]+", retry):
        result["retry_after"] = retry
    try:
        body = json.loads(exc.read(65536))
        error = body.get("error", {})
        message = error.get("message", "") if isinstance(error, dict) else str(error)
        raw = error.get("metadata", {}).get("raw", "") if isinstance(error, dict) else ""
        if isinstance(raw, str):
            try:
                parsed = json.loads(raw)
                raw_error = parsed.get("error", parsed)
                raw = raw_error.get("message", "") if isinstance(raw_error, dict) else str(raw_error)
            except (ValueError, TypeError):
                pass
        message = str(message) + ("; " + str(raw) if raw else "")
        for secret in (key, prompt):
            if secret:
                message = message.replace(secret, "[redacted]")
        message = re.sub(r"(?i)bearer\s+\S+|sk-[a-zA-Z0-9_-]+", "[redacted]", message)
        message = " ".join(message.split())[:500]
        if message:
            result["rate_limit_message"] = message
    except Exception:
        pass
    return result


def run(plan, out, budget, key, max_calls=None, concurrency=1, min_interval=1.2):
    if not isinstance(min_interval, (float, int)) or not 0 <= min_interval <= 60:
        raise ValueError("min-interval must be finite and between 0 and 60 seconds")
    if type(concurrency) is not int or not 1 <= concurrency <= 32:
        raise ValueError("concurrency must be between 1 and 32")
    out.mkdir(parents=True, exist_ok=True)
    with (out / ".lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_locked(plan, out, money(budget), key, max_calls, concurrency, min_interval)


def run_locked(plan, out, budget, key, max_calls, concurrency=1, min_interval=1.2):
    plan_path = out / "plan.json"
    if plan_path.exists():
        if json.loads(plan_path.read_text()) != plan:
            raise ValueError("resume plan differs from saved plan")
    else:
        with plan_path.open("x") as f:
            json.dump(plan, f, indent=2); f.flush(); os.fsync(f.fileno())
    ledger = out / "ledger.jsonl"
    spend, pending, completed = budget_state(records(ledger))
    if pending:
        raise ValueError("ambiguous billed request remains in ledger; inspect provider billing before manual reconciliation; no automatic retry")
    if spend > budget:
        raise ValueError("existing spend exceeds requested total budget")
    # Repair crash between completed ledger record and family file append.
    existing = set()
    for family, spec in plan["families"].items():
        path = out / (family + ".jsonl")
        rows = records(path)
        if not rows:
            append(path, {"record": "header", "families": [family], "models": {family: spec["model"]},
                "corpus_version": plan["corpus_version"], "corpus_digest": plan["corpus_digest"],
                "provenance": {"kind": "live", "provider": "openrouter", "temperature": plan["temperature"],
                               "started_at": plan["created_at"], "endpoint": spec,
                               "plan_sha256": hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()}})
        for r in rows:
            if r.get("record") == "run":
                ident = r["identity"]
                if ident in existing or ident not in completed or r != completed[ident]:
                    raise ValueError("family records differ from completed ledger")
                existing.add(ident)
    for ident, rec in completed.items():
        if ident not in existing:
            append(out / (rec["family"] + ".jsonl"), rec)
    made = 0
    launched = 0
    failed = False
    held = Decimal(0)
    # Only the coordinator mutates budget/ledger/files; workers perform HTTP.
    jobs = iter((i, probe, family, spec) for i in range(plan["k"])
                for probe in plan["probes"] for family, spec in plan["families"].items()
                if "%s:%s:%d" % (family, probe["probe_id"], i) not in completed)
    next_job = next(jobs, None)
    inflight = {}
    pacer = ModelPacer(min_interval, {spec["model"] for spec in plan["families"].values()})
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        while next_job is not None or inflight:
            while not failed and next_job is not None and len(inflight) < concurrency:
                if max_calls is not None and launched >= max_calls:
                    break
                i, probe, family, spec = next_job
                ident = "%s:%s:%d" % (family, probe["probe_id"], i)
                reserve = money(spec["reservation_usd"])
                if spend + held + reserve > budget:
                    break  # Wait for charged cost to release a reservation.
                append(ledger, {"event": "reserved", "identity": ident,
                               "reservation_usd": str(reserve), "at": now()})
                held += reserve
                launched += 1
                payload = {"model": spec["model"],
                    "messages": [{"role": "user", "content": probe["carrier"]}],
                    "max_tokens": plan["max_tokens"], "temperature": plan["temperature"],
                    "provider": spec["routing"], "stream": False}
                future = pool.submit(pacer.call, "/chat/completions", payload, key)
                inflight[future] = (i, probe, family, spec, ident, reserve)
                next_job = next(jobs, None)
            if not inflight:
                break
            try:
                done, _ = wait(inflight, return_when=FIRST_COMPLETED)
            except KeyboardInterrupt:
                # Stop admitting work, then collect every already-submitted bill.
                failed = True
                continue
            # Process every completed request before admitting any more work.
            for future in done:
                i, probe, family, spec, ident, reserve = inflight.pop(future)
                result = None
                try:
                    result = future.result()
                    text = result["choices"][0]["message"]["content"]
                    cost = money(result["usage"]["cost"])
                    if (result.get("model") != spec["model"] or result.get("provider") != spec["provider"]
                            or not result.get("id") or not isinstance(text, str) or not text.strip()):
                        raise ValueError("response identity/content failed verification")
                    if cost > reserve:
                        raise ValueError("reported cost exceeds reservation; stop and inspect billing")
                    rec = {"record": "run", "identity": ident, "family": family, "model": spec["model"],
                        "probe_id": probe["probe_id"], "probe_class": probe["class"], "run_index": i,
                        "sent": probe["carrier"], "got": text, "error": "", "observed_at": now(),
                        "response_model": result["model"], "response_provider": result["provider"],
                        "response_id": result["id"], "usage": result["usage"], "cost_usd": str(cost),
                        "finish_reason": result["choices"][0].get("finish_reason")}
                    append(ledger, {"event": "completed", "identity": ident,
                                    "cost_usd": str(cost), "response_record": rec})
                    append(out / (family + ".jsonl"), rec)
                    completed[ident] = rec
                    spend += cost
                    held -= reserve
                    made += 1
                except Exception as exc:
                    diagnostics = ({k: result.get(k) for k in ("id", "model", "provider", "usage")}
                                   if isinstance(result, dict) else {})
                    append(ledger, {"event": "failed", "identity": ident, "error_type": type(exc).__name__,
                                    "response_metadata": diagnostics,
                                    "http_status": getattr(exc, "code", None) if isinstance(getattr(exc, "code", None), int) else None,
                                    **http_diagnostics(exc, key, probe["carrier"]),
                                    "at": now()})
                    # Preserve this reservation, stop new work, drain other bills.
                    failed = True
    if failed:
        raise RuntimeError("request failed or was interrupted; all in-flight requests drained; ambiguous reservations retained; no retry")
    if next_job is not None:
        print("PAUSED: %d new calls, cumulative reported USD %s" % (made, spend))
        return 2
    print("COMPLETE: %d calls, cumulative reported USD %s" % (len(completed), spend))
    return 0


def retry_delay(value, current):
    """Return server-requested seconds, accepting numeric or HTTP-date headers."""
    if value is None:
        return 0.0
    try:
        seconds = float(value)
        if not 0 <= seconds < float("inf"):
            raise ValueError("invalid Retry-After")
        return seconds
    except (TypeError, ValueError):
        try:
            date = parsedate_to_datetime(str(value))
            if date.tzinfo is None:
                date = date.replace(tzinfo=dt.timezone.utc)
            return max(0.0, date.timestamp() - current)
        except (TypeError, ValueError, OverflowError):
            raise ValueError("unrecognized Retry-After; manual review required") from None


def authorize_recovery(out, events, policy, current=None):
    """Persist an explicit supervisor decision before charging a failed attempt.

    Failure line numbers identify attempts, including repeated logical IDs.
    Replay never resets the global or per-identity recovery allowance.
    """
    current = time.time() if current is None else current
    _, pending, _ = budget_state(events)
    journal = out / "recovery.jsonl"
    history = records(journal)
    expected = {"event": "policy", **policy}
    if not history:
        append(journal, expected)
        history = [expected]
    elif history[0] != expected:
        raise ValueError("recovery policy differs from saved policy; refusing allowance reset")
    latest = {e["identity"]: (i, e) for i, e in enumerate(events)}
    for identity in pending:
        _, failure = latest[identity]
        if failure["event"] != "failed" or failure.get("http_status") != 429:
            raise ValueError("unresolved non-429 or undrained request; no supervised retry")
    authorizations = [e for e in history if e["event"] == "authorized_429_recovery"]
    by_attempt = {e["failure_line"]: e for e in authorizations}
    counts = {}
    for e in authorizations:
        counts[e["identity"]] = counts.get(e["identity"], 0) + 1
    additions = [(identity, *latest[identity]) for identity in pending if latest[identity][0] not in by_attempt]
    if len(authorizations) + len(additions) > policy["max_retries"]:
        raise ValueError("429 recovery allowance exhausted")
    for identity, _, _ in additions:
        if counts.get(identity, 0) >= policy["max_identity_retries"]:
            raise ValueError("429 recovery allowance exhausted for " + identity)
    for identity, index, failure in additions:
        delay = max(policy["cooldown_seconds"], retry_delay(failure.get("retry_after"), current))
        event = {"event": "authorized_429_recovery", "identity": identity, "failure_line": index,
                 "reservation_usd": str(pending[identity]), "authorized_at": current,
                 "not_before": current + delay, "at": now()}
        append(journal, event)
        by_attempt[index] = event
    return max((by_attempt[latest[identity][0]]["not_before"] for identity in pending), default=current)


def supervise(plan, out, budget, key, concurrency=9, min_interval=1.2,
              max_retries=12, cooldown=60):
    """Explicit bounded recovery policy; no unaccounted or hidden network retries."""
    if type(max_retries) is not int or not 0 <= max_retries <= 12 or not 60 <= cooldown < float("inf"):
        raise ValueError("supervisor requires at most 12 recoveries and cooldown >=60 seconds")
    out.mkdir(parents=True, exist_ok=True)
    policy = {"version": 1, "max_retries": max_retries, "max_identity_retries": 2,
              "cooldown_seconds": cooldown, "budget_usd": str(money(budget)),
              "concurrency": concurrency, "min_interval": min_interval,
              "plan_sha256": hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()}
    with (out / ".supervisor.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        while True:
            events = records(out / "ledger.jsonl")
            _, pending, _ = budget_state(events)
            due = authorize_recovery(out, events, policy)
            if pending:
                print("RECOVERY: %d upstream 429 attempts; full reservations will be charged after cooldown" % len(pending), flush=True)
                while time.time() < due:
                    time.sleep(min(60.0, max(0.0, due - time.time())))
                for identity in pending:
                    reconcile(out, identity, True)
            try:
                return run(plan, out, budget, key, concurrency=concurrency, min_interval=min_interval)
            except RuntimeError:
                # Next iteration independently inspects drained errors and the
                # persistent allowance. Keyboard interruption with no failed
                # requests is never interpreted as permission to restart.
                _, remaining, _ = budget_state(records(out / "ledger.jsonl"))
                if not remaining:
                    raise


def status(out):
    plan = json.loads((out / "plan.json").read_text())
    events = records(out / "ledger.jsonl")
    spend, pending, completed = budget_state(events)
    latest = {e["identity"]: e for e in events}
    result = {"completed": len(completed), "target": plan["calls"],
              "conservative_debit_usd": str(spend),
              "pending_reservation_usd": str(sum(pending.values())),
              "inflight_or_unresolved": len(pending),
              "failed_pending": [identity for identity in pending if latest[identity]["event"] == "failed"],
              "by_family": {family: sum(r["family"] == family for r in completed.values())
                            for family in plan["families"]}}
    history = records(out / "recovery.jsonl")
    if history:
        result["authorized_429_recoveries"] = sum(e["event"] == "authorized_429_recovery" for e in history)
        result["max_429_recoveries"] = history[0]["max_retries"]
    print(json.dumps(result, indent=2))
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--corpus", type=Path, default=ROOT / "corpus/probes.json")
    p.add_argument("--families", default=",".join(MODELS))
    p.add_argument("--k", type=int, default=210)
    p.add_argument("--provider", action="append", default=[], help="pin exact endpoint tag as family=tag; repeat for each override")
    p.add_argument("--out", type=Path, required=True)
    r = sub.add_parser("run")
    r.add_argument("--plan", type=Path, required=True)
    r.add_argument("--out", type=Path, required=True)
    r.add_argument("--budget", type=money, required=True, help="total cumulative USD budget, including prior completed calls")
    r.add_argument("--env", type=Path, default=ROOT.parent / ".env")
    r.add_argument("--max-calls", type=int)
    r.add_argument("--concurrency", type=int, default=1, help="simultaneous requests, 1..32; shared reserved budget")
    r.add_argument("--min-interval", type=float, default=1.2, help="minimum seconds between request starts per model; default 1.2 (50 RPM)")
    v = sub.add_parser("supervise", help="explicitly authorize bounded, logged, full-charge 429 recovery")
    v.add_argument("--plan", type=Path, required=True)
    v.add_argument("--out", type=Path, required=True)
    v.add_argument("--budget", type=money, required=True)
    v.add_argument("--env", type=Path, default=ROOT.parent / ".env")
    v.add_argument("--concurrency", type=int, default=9)
    v.add_argument("--min-interval", type=float, default=1.2)
    v.add_argument("--max-retries", type=int, default=12)
    v.add_argument("--cooldown", type=float, default=60)
    c = sub.add_parser("reconcile", help="explicitly debit the full ceiling of one failed attempt")
    c.add_argument("--out", type=Path, required=True)
    c.add_argument("--identity", required=True)
    c.add_argument("--charge-reservation", action="store_true", required=True)
    t = sub.add_parser("status", help="read completion and conservative budget from a ledger, without API calls")
    t.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    try:
        if args.command == "supervise":
            return supervise(json.loads(args.plan.read_text()), args.out, args.budget, load_key(args.env),
                             args.concurrency, args.min_interval, args.max_retries, args.cooldown)
        if args.command == "status":
            return status(args.out)
        if args.command == "reconcile":
            return reconcile(args.out, args.identity, args.charge_reservation)
        if args.command == "plan":
            overrides = {}
            for value in args.provider:
                family, separator, tag = value.partition("=")
                if not separator or not family or not tag or family in overrides:
                    raise ValueError("provider overrides must be unique family=tag pairs")
                overrides[family] = tag
            plan = create_plan(args.corpus, args.families.split(","), args.k, overrides)
            args.out.parent.mkdir(parents=True, exist_ok=True)
            with args.out.open("x") as f: json.dump(plan, f, indent=2)
            print(json.dumps({k: plan[k] for k in ("calls", "estimated_ceiling_usd", "estimate_note")}, indent=2))
            return 0
        if args.max_calls is not None and args.max_calls < 1:
            raise ValueError("max-calls must be positive")
        return run(json.loads(args.plan.read_text()), args.out, args.budget, load_key(args.env), args.max_calls, args.concurrency, args.min_interval)
    except Exception as exc:
        # Local validation messages are safe. Remote exception payloads are not.
        print("STOPPED: " + (str(exc) if isinstance(exc, (ValueError, RuntimeError)) else type(exc).__name__))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
