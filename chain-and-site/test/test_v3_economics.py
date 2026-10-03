"""Economic transitions, controlled classifier outcomes; not accuracy validation."""
import copy
import json
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch
from test_v3_contract import V, gl, stub, Clock, VENDOR, CHALLENGER, COLLECTOR, FIXTURE, sender
OTHER=stub.Address('0x'+'33'*20)

class Economics(unittest.TestCase):
    def setUp(self):
        self.c=V.Voirdire();self.deposits=0;self.withdrawn=0
        V.datetime=Clock;gl.evm.calls=[];gl.advanced.transfers=[]
        gl.nondet.handler=lambda prompt: ('{"visible_in_evidence":true}' if '"visible_in_evidence"' in prompt else '{"same_object":true}')
    def tearDown(self):V.datetime=Clock
    def invariant(self):
        s=self.c.solvency()
        self.assertTrue(s['balanced']);self.assertEqual(s['held'],self.deposits-self.withdrawn)
        self.assertEqual(s['credited'],sum(self.c.balance_of(a.as_hex) for a in [VENDOR,CHALLENGER,OTHER,COLLECTOR]))
        self.assertGreaterEqual(s['escrowed'],0)
        for cid,claim in self.c.claims.items():
            self.assertGreaterEqual(int(claim.pool),0)
            obligations=sum(int(cm.stake_locked) for cm in self.c.commitments if cm.claim_id==cid and not cm.opened)
            obligations+=sum(int(r.stake_locked) for r in self.c.rounds if r.claim_id==cid and not r.settled)
            self.assertGreaterEqual(int(claim.pool),obligations)
        return s
    def claim(self):
        sender(VENDOR,3000)
        cid=self.c.register_claim('openrouter:openai/gpt-4o-mini','gpt-class','openai/gpt-4o-mini','2026-01-01','2099-01-01',100,1000,1,COLLECTOR.as_hex)
        self.deposits+=3000;self.invariant();return cid
    def prepare(self,cid,who=CHALLENGER,attest=True,amount=100):
        env={'version':V.VERSION,'profile_hash':V.PROFILE_HASH,'claim_id':cid,'nonce':('%032x'%len(self.c.commitments)),'endpoint':'openrouter:openai/gpt-4o-mini','transcripts':copy.deepcopy(FIXTURE)}
        sender(who,amount);cm=self.c.commit(cid,V._fingerprint(V._canonical(env)));self.deposits+=amount;self.invariant()
        if attest:
            sender(COLLECTOR);self.c.attest_evidence(cm,V._fingerprint(V._canonical_evidence(env)))
        self.invariant();return cm,env,who
    def publish(self,prepared):
        cm,env,who=prepared;sender(who);rid=self.c.publish_evidence(cm,json.dumps(env));self.invariant();return rid
    def judge(self,rid,decision):
        fake={'decision':decision,'nearest_family':'llama-class' if decision=='ABSTAIN' else decision,'distance_squared':1,'radius_squared':2,'reason':'within_radius' if decision!='ABSTAIN' else 'outside_radius'}
        with patch.dict(V._CLASSIFIER,{'predict':lambda *_:fake.copy()}):self.c.judge_round(rid)
        r=self.c.get_round(rid);self.assertEqual(r['readings'],[]);self.assertEqual(r['classes_seen'],0);self.assertEqual(r['consensus_scope'],'round-profile');self.invariant();return r
    def advance(self,seconds):
        instant=Clock.now()+timedelta(seconds=seconds)
        class Later(datetime):
            @classmethod
            def now(cls,tz=None):return instant
        V.datetime=Later
    def withdraw(self,who,expected):
        sender(who);self.assertEqual(self.c.withdraw(),expected);self.withdrawn+=expected
        self.assertEqual(gl.evm.calls[-1],{'address':who,'value':expected,'on':'finalized'})
        self.invariant()
        with self.assertRaises(gl.vm.UserError):self.c.withdraw()
        self.invariant()
    def test_consistent_close_and_two_withdrawals(self):
        cid=self.claim();rid=self.publish(self.prepare(cid));self.judge(rid,'gpt-class')
        sender(OTHER)
        with self.assertRaises(gl.vm.UserError):self.c.close_claim(cid)
        sender(VENDOR);self.c.close_claim(cid);self.invariant()
        self.withdraw(CHALLENGER,100);self.withdraw(VENDOR,3000)
        self.assertEqual(self.c.solvency()['held'],0)
        with self.assertRaises(gl.vm.UserError):self.c.close_claim(cid)
    def test_inconclusive_cannot_count_as_confirmation_or_release_bond_early(self):
        cid=self.claim();rid=self.publish(self.prepare(cid));self.judge(rid,'ABSTAIN')
        self.assertEqual(self.c.get_claim(cid)['confirmed_rounds'],0)
        sender(VENDOR)
        with self.assertRaises(gl.vm.UserError):self.c.close_claim(cid)
        self.withdraw(CHALLENGER,100)
        self.advance(80*366*86400);sender(VENDOR);self.c.close_claim(cid);self.invariant();self.withdraw(VENDOR,3000)
    def test_payout_refunds_other_commitment_and_isolates_other_claim(self):
        cid=self.claim();otherclaim=self.claim()
        winner=self.prepare(cid,amount=125);other=self.prepare(cid,OTHER,amount=175)
        untouched=self.prepare(otherclaim,OTHER,False)
        rid=self.publish(winner);self.judge(rid,'llama-class')
        self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),0)
        self.assertEqual(self.c.confirm(rid),V.ADMISSIBLE);self.invariant()
        self.assertEqual(self.c.get_claim(cid)['pool'],0);self.assertEqual(self.c.get_claim(cid)['status'],V.VOIDED)
        self.assertEqual(self.c.get_claim(otherclaim)['pool'],3100)
        self.withdraw(CHALLENGER,3125);self.withdraw(OTHER,175)
        for operation in [lambda:self.c.confirm(rid),lambda:self.c.expire_round(rid),lambda:self.c.expire_commitment(other[0])]:
            with self.assertRaises(gl.vm.UserError):operation()
            self.invariant()
    def test_b1_and_b2_rejection_forfeit_only_challenger_stake(self):
        for stage in [1,2]:
            with self.subTest(stage=stage):
                self.setUp();cid=self.claim();rid=self.publish(self.prepare(cid))
                if stage==1:gl.nondet.handler=lambda prompt:'{"visible_in_evidence":false}'
                self.judge(rid,'llama-class')
                if stage==2:
                    gl.nondet.handler=lambda prompt:'{"same_object":false}'
                    self.assertEqual(self.c.confirm(rid),V.INADMISSIBLE)
                self.invariant();self.assertEqual(self.c.get_claim(cid)['pool'],3100)
                self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),0)
                self.assertTrue(self.c.get_round(rid)['settled'])
                self.advance(80*366*86400);sender(VENDOR);self.c.close_claim(cid);self.withdraw(VENDOR,3100)
    def test_published_pending_and_b2_pending_expire_refund(self):
        for judged in [False,True]:
            with self.subTest(judged=judged):
                self.setUp();cid=self.claim();rid=self.publish(self.prepare(cid))
                if judged:self.judge(rid,'llama-class')
                with self.assertRaises(gl.vm.UserError):self.c.expire_round(rid)
                self.advance(8*86400+1);self.c.expire_round(rid);self.invariant()
                self.withdraw(CHALLENGER,100)
                with self.assertRaises(gl.vm.UserError):self.c.judge_round(rid)
                with self.assertRaises(gl.vm.UserError):self.c.confirm(rid)
    def test_collector_timeout_refunds_but_attested_withholding_forfeits(self):
        for attested in [False,True]:
            with self.subTest(attested=attested):
                self.setUp();cid=self.claim();cm,_,_=self.prepare(cid,attest=attested)
                with self.assertRaises(gl.vm.UserError):self.c.expire_commitment(cm)
                self.advance(86401);self.c.expire_commitment(cm);self.invariant()
                self.assertEqual(self.c.balance_of(CHALLENGER.as_hex),0 if attested else 100)
                self.assertEqual(self.c.get_claim(cid)['pool'],3100 if attested else 3000)
                with self.assertRaises(gl.vm.UserError):self.c.expire_commitment(cm)
    def test_concurrently_consumed_profile_refunds_attested_loser(self):
        cid=self.claim();first=self.prepare(cid);second=self.prepare(cid,OTHER)
        rid=self.publish(first);self.judge(rid,'gpt-class')
        with self.assertRaises(gl.vm.UserError):self.publish(second)
        sender(VENDOR)
        with self.assertRaises(gl.vm.UserError):self.c.close_claim(cid)
        sender(OTHER,100)
        with self.assertRaisesRegex(gl.vm.UserError,'profile already consumed'):self.c.commit(cid,'ab'*32)
        self.invariant();self.advance(86401);self.c.expire_commitment(second[0]);self.invariant()
        self.withdraw(OTHER,100);self.withdraw(CHALLENGER,100)
        sender(VENDOR);self.c.close_claim(cid);self.withdraw(VENDOR,3000)
    def test_closed_date_does_not_unlock_unresolved_obligations(self):
        cid=self.claim();prepared=self.prepare(cid,attest=False)
        self.advance(80*366*86400);sender(VENDOR)
        with self.assertRaises(gl.vm.UserError):self.c.close_claim(cid)
        self.c.expire_commitment(prepared[0]);self.c.close_claim(cid);self.invariant()
    def test_collector_cannot_substitute_evidence_or_user(self):
        cid=self.claim();cm,env,who=self.prepare(cid,attest=False)
        sender(OTHER)
        with self.assertRaises(gl.vm.UserError):self.c.attest_evidence(cm,V._fingerprint(V._canonical_evidence(env)))
        sender(COLLECTOR);self.c.attest_evidence(cm,V._fingerprint(V._canonical_evidence(env)))
        env['transcripts'][0]['got']+=' altered'
        sender(who)
        with self.assertRaises(gl.vm.UserError):self.c.publish_evidence(cm,json.dumps(env))
        self.invariant();self.assertFalse(self.c.get_commitment(cm)['opened'])

if __name__=='__main__':unittest.main()
