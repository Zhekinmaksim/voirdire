"""Candidate contract tests. Old responses are fixtures, never fresh validation."""
from pathlib import Path
import hashlib
import importlib.util
import json
import os
import sys
import unittest
from datetime import datetime, timezone
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'chain-and-site/test/stub'))
import genlayer as stub
from genlayer import gl
spec = importlib.util.spec_from_file_location('vd_v3_candidate',Path(os.environ.get('VOIRDIRE_CANDIDATE_PATH',str(ROOT/'chain-and-site/contracts/voirdire.py'))))
V=importlib.util.module_from_spec(spec);sys.modules[spec.name]=V;spec.loader.exec_module(V)
class Clock(datetime):
    @classmethod
    def now(cls,tz=None):return datetime(2026,10,3,tzinfo=timezone.utc)
V.datetime=Clock
VENDOR=stub.Address('0x'+'11'*20);CHALLENGER=stub.Address('0x'+'22'*20);COLLECTOR=stub.Address('0x'+'44'*20)
def sender(who,value=0):gl.message.sender_address=who;gl.message.value=value

def old_fixture():
    return json.loads((HERE/'fixtures/v3-development-gpt.json').read_text())['transcripts']
FIXTURE=old_fixture()

class ContractCandidate(unittest.TestCase):
    def setUp(self):
        self.c=V.Voirdire();self.calls=[]
        def handler(prompt):
            self.calls.append(prompt)
            if '"visible_in_evidence"' in prompt:return '{"visible_in_evidence":true}'
            if '"same_object"' in prompt:return '{"same_object":true}'
            raise AssertionError('No LLM classifier allowed')
        gl.nondet.handler=handler;gl.evm.calls=[];gl.advanced.transfers=[]
    def register(self,family='gpt-class',version=None,min_rounds=1):
        sender(VENDOR,3000)
        return self.c.register_claim('openrouter:openai/gpt-4o-mini',family,version or V.PROFILE['supported_models'].get(family,'openai/gpt-4o-mini'),'2026-01-01','2099-01-01',100,1000,min_rounds,COLLECTOR.as_hex)
    def env(self,cid):return {'version':V.VERSION,'profile_hash':V.PROFILE_HASH,'claim_id':cid,'nonce':'ab'*16,'endpoint':'openrouter:openai/gpt-4o-mini','transcripts':json.loads(json.dumps(FIXTURE))}
    def test_public_profile_results_have_no_calldata_floats(self):
        def check(value):
            self.assertNotIsInstance(value, float, 'GenVM calldata cannot encode floats')
            if isinstance(value, dict):
                for child in value.values(): check(child)
            elif isinstance(value, (tuple, list)):
                for child in value: check(child)
        check(self.c.protocol_info())
        cid=self.register('llama-class');rid=self.publish(self.env(cid))
        self.c.judge_round(rid)
        check(self.c.get_round(rid));check(self.c.report(cid))
        self.assertEqual(self.c.protocol_info()['generation_policy']['temperature'],1)
    def publish(self,env):
        sender(CHALLENGER,100);cm=self.c.commit(env['claim_id'],V._fingerprint(V._canonical(env)))
        sender(COLLECTOR);self.c.attest_evidence(cm,V._fingerprint(V._canonical_evidence(env)))
        sender(CHALLENGER);return self.c.publish_evidence(cm,json.dumps(env))
    def test_profile_exact_hash_in_canonical_plan_and_evidence(self):
        cid=self.register();env=self.env(cid);other={**env,'profile_hash':'00'*32}
        self.assertNotEqual(V._canonical(env),V._canonical(other))
        self.assertNotEqual(V._canonical_evidence(env),V._canonical_evidence(other))
        self.assertEqual(V.PROFILE_HASH,hashlib.sha256((ROOT/'chain-and-site/calibration/candidates/int-v3/profile.json').read_bytes()).hexdigest())
        with self.assertRaises(gl.vm.UserError):self.publish(other)
    def test_claim_scope_alias_version_and_single_round(self):
        cid=self.register('gpt');self.assertEqual(self.c.get_claim(cid)['claimed_model'],'gpt-class')
        for family,version,count in [('unknown','openai/gpt-4o-mini',1),('llama','openai/gpt-4o-mini',1),('gpt','openai/gpt-4o-mini',2)]:
            with self.assertRaises(gl.vm.UserError):self.register(family,version,count)
    def test_exact_six_prompt_set_required(self):
        cid=self.register();env=self.env(cid);env['transcripts'][0]['sent']+=' changed'
        with self.assertRaises(gl.vm.UserError):self.publish(env)
    def test_matching_profile_credits_stake_no_model_calls_no_class_fabrication(self):
        cid=self.register();rid=self.publish(self.env(cid));self.assertEqual(self.calls,[])
        self.c.judge_round(rid);r=self.c.get_round(rid)
        self.assertEqual(r['verdict'],V.CONSISTENT);self.assertEqual(self.calls,[])
        self.assertEqual(r['readings'],[]);self.assertEqual(r['classes_seen'],0)
        self.assertEqual(r['consensus_scope'],'round-profile')
        self.assertEqual(r['profile_result']['decision'],'gpt-class')
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),100)
        self.assertEqual(self.c.get_claim(cid)['confirmed_rounds'],1)
        self.assertEqual(self.c.report(cid)['classes'],[])
        with self.assertRaises(gl.vm.UserError):self.c.judge_round(rid)
        self.assertTrue(self.c.solvency()['balanced'])
        self.assertEqual(self.c.withdraw(),100)
    def test_out_of_profile_abstains_and_refunds_without_confirmation(self):
        cid=self.register();env=self.env(cid)
        for t in env['transcripts']:t['got']='x'
        self.assertEqual(V._CLASSIFIER['predict'](V.PROFILE,env['transcripts'])['decision'],'ABSTAIN')
        rid=self.publish(env);self.c.judge_round(rid)
        self.assertEqual(self.c.get_round(rid)['verdict'],V.INCONCLUSIVE)
        self.assertEqual(self.c.get_claim(cid)['confirmed_rounds'],0)
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),100)
        self.assertEqual(self.calls,[])
    def test_mismatch_runs_both_referees_and_preserves_payout(self):
        cid=self.register('llama-class');rid=self.publish(self.env(cid));self.c.judge_round(rid)
        r=self.c.get_round(rid);self.assertEqual(r['verdict'],V.INCONSISTENT)
        self.assertEqual(r['stage_b1'],V.ADMISSIBLE);self.assertEqual(r['stage_b2'],V.PENDING)
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),0)
        self.assertEqual(self.c.confirm(rid),V.ADMISSIBLE)
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),3100)
        self.assertTrue(self.c.solvency()['balanced'])
        self.assertEqual(len(self.calls),4)
        for prompt in self.calls:
            self.assertNotIn('openrouter:openai/gpt-4o-mini',prompt)
            self.assertIn('REPORTED ROUND-PROFILE FINDING',prompt)
    def test_b1_rejection_still_forfeits_stake(self):
        cid=self.register('llama-class');rid=self.publish(self.env(cid))
        gl.nondet.handler=lambda prompt:'{"visible_in_evidence":false}'
        self.c.judge_round(rid)
        self.assertTrue(self.c.get_round(rid)['settled'])
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),0)
        self.assertEqual(self.c.get_claim(cid)['pool'],3100)
    def test_termination_bound_to_evidence_but_not_future_plan(self):
        cid=self.register();env=self.env(cid)
        a=json.loads(json.dumps(env));a['transcripts'][0]['finish_reason']='stop'
        b=json.loads(json.dumps(env));b['transcripts'][0]['finish_reason']='length'
        self.assertEqual(V._canonical(a),V._canonical(b))
        self.assertNotEqual(V._canonical_evidence(a),V._canonical_evidence(b))
        rid=self.publish(b)
        self.assertEqual(self.c.get_round(rid)['envelope']['transcripts'][0]['finish_reason'],'length')
    def test_missing_or_tool_termination_cannot_publish(self):
        for reason in [None,'tool_calls','error','content_filter']:
            self.setUp();cid=self.register();env=self.env(cid)
            if reason is None:env['transcripts'][0].pop('finish_reason')
            else:env['transcripts'][0]['finish_reason']=reason
            with self.assertRaises(gl.vm.UserError):self.publish(env)
    def test_response_length_bound_and_separate_approval_flag(self):
        cid=self.register();env=self.env(cid);env['transcripts'][0]['got']='x'*4097
        with self.assertRaises(gl.vm.UserError):self.publish(env)
        self.assertIn(self.c.protocol_info()['profile_status'],('UNVALIDATED','APPROVED'))
        self.assertNotIn('status',V.PROFILE)
        profile_hash=self.c.protocol_info()['profile_hash']
        original_status=V.PROFILE_RELEASE_STATUS
        V.PROFILE_RELEASE_STATUS='APPROVED'
        try:
            self.assertEqual(self.c.protocol_info()['profile_status'],'APPROVED')
            self.assertEqual(self.c.protocol_info()['profile_hash'],profile_hash)
        finally:V.PROFILE_RELEASE_STATUS=original_status
    def test_embedded_classifier_source_exact(self):
        shared={};exec((ROOT/'chain-and-site/calibration/candidates/int-v3/classifier.py').read_text(),shared)
        self.assertEqual(shared['predict'](V.PROFILE,FIXTURE),V._CLASSIFIER['predict'](V.PROFILE,FIXTURE))

if __name__=='__main__':unittest.main()
