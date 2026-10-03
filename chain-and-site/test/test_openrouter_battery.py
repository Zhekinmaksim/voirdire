import contextlib
import copy
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import openrouter_battery as O


class BatteryTests(unittest.TestCase):
    def plan(self):
        return dict(k=1, created_at="now", corpus_version="x", corpus_digest="abc", temperature=1., max_tokens=600,
            probes=[dict(probe_id="p", **{"class":"refusal_shape"}, carrier="hello")],
            families={"gpt-class": dict(model="openai/gpt-4o-mini", provider="OpenAI", reservation_usd="0.1", routing={})})

    def response(self):
        return dict(model="openai/gpt-4o-mini",provider="OpenAI",id="gen-123",usage={"cost":0.01},
                    choices=[dict(message={"content":"text"},finish_reason="stop")])

    def invoke(self, plan, out, budget):
        with contextlib.redirect_stdout(io.StringIO()):
            return O.run(plan, out, budget, "secret", min_interval=0)

    def test_no_request_when_reservation_exceeds_budget(self):
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request") as req:
            self.assertEqual(self.invoke(self.plan(),Path(d),"0.09"),2)
            req.assert_not_called()

    def test_resume_does_not_repeat_completed_or_overwrite_output(self):
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value=self.response()) as req:
            out=Path(d)
            self.assertEqual(self.invoke(self.plan(),out,"1"),0)
            before=(out/"gpt-class.jsonl").read_bytes()
            self.assertEqual(self.invoke(self.plan(),out,"1"),0)
            self.assertEqual(req.call_count,1)
            self.assertEqual(before,(out/"gpt-class.jsonl").read_bytes())

    def test_ambiguous_failure_is_not_retried(self):
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",side_effect=TimeoutError) as req:
            with self.assertRaises(RuntimeError): self.invoke(self.plan(),Path(d),"1")
            with self.assertRaises(ValueError): self.invoke(self.plan(),Path(d),"1")
            self.assertEqual(req.call_count,1)

    def test_resume_repairs_completed_record_from_ledger(self):
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value=self.response()) as req:
            out=Path(d); self.invoke(self.plan(),out,"1")
            path=out/"gpt-class.jsonl"
            path.write_text(path.read_text().splitlines()[0]+"\n")
            self.invoke(self.plan(),out,"1")
            self.assertEqual(len(O.records(path)),2)
            self.assertEqual(req.call_count,1)

    def test_model_mismatch_stops(self):
        response=self.response(); response["model"]="wrong"
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value=response):
            with self.assertRaises(RuntimeError): self.invoke(self.plan(),Path(d),"1")
            self.assertEqual(len(O.records(Path(d)/"gpt-class.jsonl")),1)

    def test_plan_mutation_stops_resume(self):
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value=self.response()):
            self.invoke(self.plan(),Path(d),"1")
            plan=self.plan();plan["temperature"]=0
            with self.assertRaises(ValueError): self.invoke(plan,Path(d),"1")

    def test_endpoint_filters_unsupported_and_fees(self):
        ep=dict(status=0, supported_parameters=["temperature","max_tokens"],tag="openai",provider_name="OpenAI",
                context_length=128000,pricing={"prompt":"0.000001","completion":"0.000002"})
        bad=copy.deepcopy(ep);bad["pricing"]["request"]="0.01"
        self.assertEqual(O.select_endpoint({"data":{"endpoints":[bad,ep]}}),ep)
        with self.assertRaises(ValueError): O.select_endpoint({"data":{"endpoints":[bad]}})

    def test_preflight_is_get_only_and_pins_routes_and_prices(self):
        ep=dict(status=0, supported_parameters=["temperature","max_tokens"],tag="openai",provider_name="OpenAI",
                context_length=128000,pricing={"prompt":"0.000001","completion":"0.000002"})
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value={"data":{"endpoints":[ep]}}) as req:
            corpus=Path(d)/"corpus.json"
            corpus.write_text(json.dumps({"version":"test","probes":[
                {"status":"active","probe_id":"p","class":"refusal_shape","carrier":"hello"}]}))
            plan=O.create_plan(corpus,["gpt-class","claude-class"],6)
            self.assertTrue(all(len(call.args)==1 and call.args[0].endswith("/endpoints") for call in req.call_args_list))
            route=plan["families"]["gpt-class"]["routing"]
            self.assertEqual(route["only"],["openai"])
            self.assertFalse(route["allow_fallbacks"])
            self.assertTrue(route["require_parameters"])
            self.assertEqual(route["max_price"],{"prompt":1.,"completion":2.})
            self.assertEqual(plan["calls"],12)

    def test_concurrency_reservations_and_writes_stay_on_coordinator(self):
        barrier = threading.Barrier(2)
        coordinator = threading.get_ident()
        original_append = O.append
        observed_pending = []
        def http(*args):
            self.assertNotEqual(threading.get_ident(), coordinator)
            barrier.wait(timeout=3)
            return self.response()
        def audited_append(path, record):
            self.assertEqual(threading.get_ident(), coordinator)
            original_append(path, record)
            if path.name == "ledger.jsonl":
                spend, pending, _ = O.budget_state(O.records(path))
                self.assertLessEqual(spend + sum(pending.values()), O.money("0.25"))
                observed_pending.append(len(pending))
        plan = self.plan(); plan["k"] = 4
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",side_effect=http), patch.object(O,"append",side_effect=audited_append):
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(O.run(plan,Path(d),"0.25","secret",concurrency=4,min_interval=0),0)
            self.assertEqual(max(observed_pending),2)
            self.assertEqual(len(O.records(Path(d)/"gpt-class.jsonl")),5)

    def test_failed_request_drains_other_bill_and_stops_admission(self):
        barrier = threading.Barrier(2)
        failed_logged = threading.Event()
        counter_lock = threading.Lock()
        call_count = 0
        original_append = O.append
        def http(*args):
            nonlocal call_count
            with counter_lock:
                call_count += 1
                ordinal = call_count
            barrier.wait(timeout=3)
            if ordinal == 1:
                raise TimeoutError()
            self.assertTrue(failed_logged.wait(timeout=3))
            return self.response()
        def audited_append(path, record):
            original_append(path, record)
            if record.get("event") == "failed": failed_logged.set()
        plan = self.plan(); plan["k"] = 5
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",side_effect=http), patch.object(O,"append",side_effect=audited_append):
            with self.assertRaises(RuntimeError):
                O.run(plan,Path(d),"1","secret",concurrency=2,min_interval=0)
            spend,pending,completed = O.budget_state(O.records(Path(d)/"ledger.jsonl"))
            self.assertEqual(call_count,2)
            self.assertEqual(spend,O.money("0.01"))
            self.assertEqual(len(pending),1)
            self.assertEqual(len(completed),1)
            self.assertEqual(len(O.records(Path(d)/"gpt-class.jsonl")),2)

    def test_concurrent_max_calls_caps_admissions(self):
        plan=self.plan();plan["k"]=20
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",return_value=self.response()) as req:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(O.run(plan,Path(d),"10","secret",max_calls=3,concurrency=16,min_interval=0),2)
            self.assertEqual(req.call_count,3)

    def test_manual_full_charge_allows_retry_without_losing_attempt(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)
            with patch.object(O,"request",side_effect=TimeoutError):
                with self.assertRaises(RuntimeError): self.invoke(self.plan(),out,"1")
            before=(out/"ledger.jsonl").read_bytes()
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(O.reconcile(out,"gpt-class:p:0",True),0)
            self.assertTrue((out/"ledger.jsonl").read_bytes().startswith(before))
            with patch.object(O,"request",return_value=self.response()) as req:
                # Full failed reserve 0.10 plus new reserve 0.10 must fit.
                self.assertEqual(self.invoke(self.plan(),out,"0.19"),2)
                req.assert_not_called()
                self.assertEqual(self.invoke(self.plan(),out,"0.20"),0)
            spend,pending,completed=O.budget_state(O.records(out/"ledger.jsonl"))
            self.assertEqual(spend,O.money("0.11"))
            self.assertFalse(pending)
            self.assertEqual(len(completed),1)
            self.assertEqual(len(O.records(out/"gpt-class.jsonl")),2)
            with self.assertRaises(ValueError): O.reconcile(out,"gpt-class:p:0",True)

    def test_reconciliation_rejects_discount_and_nonfailed_attempt(self):
        events=[{"event":"reserved","identity":"x","reservation_usd":"1"},
                {"event":"resolved_failed","identity":"x","cost_usd":"0.5"}]
        with self.assertRaises(ValueError): O.budget_state(events)
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);O.append(out/"ledger.jsonl",events[0])
            with self.assertRaises(ValueError): O.reconcile(out,"x",True)
            with self.assertRaises(ValueError): O.reconcile(out,"x",False)

    def test_http_error_records_only_status_not_remote_body(self):
        import urllib.error
        error=urllib.error.HTTPError("https://openrouter.ai",429,"sensitive response",{},None)
        with tempfile.TemporaryDirectory() as d, patch.object(O,"request",side_effect=error):
            with self.assertRaises(RuntimeError): self.invoke(self.plan(),Path(d),"1")
            text=(Path(d)/"ledger.jsonl").read_text()
            self.assertNotIn("sensitive response",text)
            self.assertEqual(O.records(Path(d)/"ledger.jsonl")[-1]["http_status"],429)

    def test_pacer_applies_spacing_per_model_independently(self):
        pacer=O.ModelPacer(1.2,["a","b"])
        with patch.object(O,"request",return_value={}) as req, patch.object(O.time,"monotonic",side_effect=[0.,.1,1.2,1.2]), patch.object(O.time,"sleep") as sleep:
            pacer.call("/x",{"model":"a"},"secret")
            pacer.call("/x",{"model":"a"},"secret")
            pacer.call("/x",{"model":"b"},"secret")
            self.assertEqual(req.call_count,3)
            self.assertEqual(sleep.call_count,1)
            self.assertAlmostEqual(sleep.call_args.args[0],1.1)

    def test_429_metadata_is_bounded_and_redacted(self):
        import urllib.error
        body={"error":{"message":"Too many requests sk-other-key secret hello", "metadata":{
            "raw":json.dumps({"error":{"message":"Limit: 20 requests per minute"}})}}}
        exc=urllib.error.HTTPError("https://openrouter.ai",429,"ignored",{"Retry-After":"60"},
                                  io.BytesIO(json.dumps(body).encode()))
        data=O.http_diagnostics(exc,"secret","hello")
        self.assertEqual(data["retry_after"],"60")
        self.assertIn("20 requests per minute",data["rate_limit_message"])
        for value in ("secret","hello","sk-other-key"):
            self.assertNotIn(value,data["rate_limit_message"])

    def test_exact_provider_override_never_falls_back(self):
        ep=dict(status=0, supported_parameters=["temperature","max_tokens"],tag="cheap",provider_name="Cheap",
                context_length=128000,pricing={"prompt":"0.000001","completion":"0.000002"})
        other=copy.deepcopy(ep);other["tag"]="stable/bf16";other["pricing"]["prompt"]="0.000003"
        data={"data":{"endpoints":[ep,other]}}
        self.assertEqual(O.select_endpoint(data,"stable/bf16"),other)
        with self.assertRaises(ValueError): O.select_endpoint(data,"missing")

    def recovery_policy(self, **changes):
        return {"max_retries":12,"max_identity_retries":2,"cooldown_seconds":60,**changes}

    def failed_events(self, code=429, identity="x"):
        return [{"event":"reserved","identity":identity,"reservation_usd":"0.1"},
                {"event":"failed","identity":identity,"http_status":code,"retry_after":"120"}]

    def test_recovery_persists_allowance_and_respects_retry_after(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);events=self.failed_events();policy=self.recovery_policy()
            self.assertEqual(O.authorize_recovery(out,events,policy,current=100),220)
            self.assertEqual(O.authorize_recovery(out,events,policy,current=110),220)
            self.assertEqual(len(O.records(out/"recovery.jsonl")),2)
            with self.assertRaises(ValueError):
                O.authorize_recovery(out,events,self.recovery_policy(max_retries=11),current=110)

    def test_recovery_rejects_non429_and_third_same_identity(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                O.authorize_recovery(Path(d),self.failed_events(503),self.recovery_policy(),100)
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);events=[];policy=self.recovery_policy()
            for attempt in range(2):
                events += self.failed_events()
                O.authorize_recovery(out,events,policy,current=100+attempt*1000)
                events.append({"event":"resolved_failed","identity":"x","cost_usd":"0.1"})
            events += self.failed_events()
            with self.assertRaises(ValueError): O.authorize_recovery(out,events,policy,current=5000)
            self.assertEqual(len(O.records(out/"recovery.jsonl")),3)

    def test_one_retry_identity_policy_survives_resume(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); policy=self.recovery_policy()
            policy["max_identity_retries"]=1
            events=self.failed_events(identity="x")
            O.authorize_recovery(out,events,policy,current=100)
            events.append({"event":"resolved_failed","identity":"x","cost_usd":"0.1"})
            events += self.failed_events(identity="x")
            with self.assertRaises(ValueError):
                O.authorize_recovery(out,events,policy,current=500)

    def test_recovery_identity_limit_includes_earlier_manual_attempts(self):
        events=[]
        for attempt in range(2):
            events += self.failed_events()
            events.append({"event":"resolved_failed","identity":"x","cost_usd":"0.1"})
        events += self.failed_events()
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError):
                O.authorize_recovery(Path(d),events,self.recovery_policy(),100)

    def test_manual_503_is_one_shot_with_persistent_cooldown(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);policy=self.recovery_policy()
            self.assertEqual(O.authorize_recovery(out,[],policy,current=100),100)
            O.append(out/"recovery.jsonl",{"event":"authorized_one_shot_503_recovery",
                "identity":"x","failure_line":1,"not_before":160})
            events=self.failed_events(503)
            events.append({"event":"resolved_failed","identity":"x","cost_usd":"0.1"})
            self.assertEqual(O.authorize_recovery(out,events,policy,current=110),160)
            events += self.failed_events(429)
            with self.assertRaises(ValueError): O.authorize_recovery(out,events,policy,current=200)

    def test_recovery_global_limit_cannot_reset_on_restart(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);events=[];policy=self.recovery_policy(max_retries=1)
            events += self.failed_events(identity="first")
            O.authorize_recovery(out,events,policy,100)
            events.append({"event":"resolved_failed","identity":"first","cost_usd":"0.1"})
            events += self.failed_events(identity="second")
            with self.assertRaises(ValueError): O.authorize_recovery(out,events,policy,1000)

    def test_supervisor_charges_and_waits_before_resuming(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)
            for e in self.failed_events(): O.append(out/"ledger.jsonl",e)
            clock=[100.]
            def sleep(delay):
                self.assertLessEqual(delay,60)
                clock[0]+=delay
            def run(*args,**kwargs):
                self.assertEqual(clock[0],220.)
                spend,pending,_=O.budget_state(O.records(out/"ledger.jsonl"))
                self.assertEqual(spend,O.money("0.1"))
                self.assertFalse(pending)
                return 0
            with patch.object(O.time,"time",side_effect=lambda:clock[0]), patch.object(O.time,"sleep",side_effect=sleep), patch.object(O,"run",side_effect=run), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(O.supervise(self.plan(),out,"1","secret"),0)

    def test_bad_budget_fails(self):
        for value in ["NaN","Infinity","-1"]:
            with self.assertRaises(ValueError): O.money(value)

    def test_dotenv_never_executes(self):
        with tempfile.TemporaryDirectory() as d, patch.dict(O.os.environ,{},clear=True):
            path=Path(d)/".env";path.write_text("OTHER=$(touch /tmp/unsafe)\nOPENROUTER_API_KEY='test-secret'\n")
            self.assertEqual(O.load_key(path),"test-secret")


if __name__ == "__main__": unittest.main()
