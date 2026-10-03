import hashlib,json,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import round_confirmation_gate as G


class ConfirmationGateTest(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.release=self.root/'release';self.run=self.root/'run';self.release.mkdir();self.run.mkdir()
  self.old=self.root/'old.jsonl';self.old.write_text(json.dumps({'record':'header'})+'\n'+json.dumps({'record':'run','response_id':'old-id'})+'\n')
  families={f:{'model':f,'provider':'p'} for f in ['a','b','c']};probes=[{'probe_id':str(i),'class':'test','carrier':'prompt'+str(i)} for i in range(6)]
  self.plan={'k':100,'calls':1800,'created_at':'2026-01-01T00:00:00+00:00','families':families,'probes':probes}
  for p in [self.release/'confirmation-plan.json',self.run/'plan.json']:p.write_text(json.dumps(self.plan))
  (self.release/'profile.json').write_text(json.dumps({'generation_policy':{'accepted_finish_reasons':['stop','length'],'max_response_chars':4096}}))
  (self.release/'classifier.py').write_text('def predict(profile,ts): return {"decision": ts[0]["got"]}\n')
  self.manifest={'old_dataset_sha256':G.sha(self.old),'gate_source_sha256':G.sha(G.__file__),'files_sha256':{n:G.sha(self.release/n) for n in ['profile.json','classifier.py','confirmation-plan.json']}}
  (self.release/'manifest.json').write_text(json.dumps(self.manifest));self.rows=[]
  for f in families:
   for i in range(100):
    for p in probes:
     identity=f'{f}:{p["probe_id"]}:{i}'
     self.rows.append({'record':'run','identity':identity,'family':f,'model':f,'response_model':f,'response_provider':'p','observed_at':'2026-01-02T00:00:00+00:00','probe_id':p['probe_id'],'probe_class':'test','sent':p['carrier'],'run_index':i,'got':f,'error':'','response_id':identity,'usage':{'cost':0.0001},'cost_usd':'0.0001','finish_reason':'length'})
  self.save()
 def save(self):
  events=[]
  for r in self.rows:
   events.extend([{'event':'reserved','identity':r['identity'],'reservation_usd':'0.01'}, {'event':'completed','identity':r['identity'],'cost_usd':r['cost_usd'],'response_record':r}])
  (self.run/'ledger.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
  for f in self.plan['families']:
   h={'record':'header','families':[f],'models':{f:f},'provenance':{'plan_sha256':hashlib.sha256(json.dumps(self.plan,sort_keys=True).encode()).hexdigest()}}
   (self.run/(f+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in [h]+[r for r in self.rows if r['family']==f]))
 def evaluate(self):return G.evaluate(self.release,self.run,self.old)
 def test_complete_length_responses_pass_frozen_quality_policy(self):
  self.assertEqual(self.evaluate()['gate'],'PASS')
 def test_incomplete_cannot_be_evaluated(self):
  self.rows.pop();self.save()
  with self.assertRaisesRegex(ValueError,'1800'):self.evaluate()
 def test_duplicate_or_old_upstream_ids_rejected(self):
  self.rows[0]['response_id']='old-id';self.save()
  with self.assertRaisesRegex(ValueError,'Old responses'):self.evaluate()
  self.rows[0]['response_id']=self.rows[1]['response_id'];self.save()
  with self.assertRaisesRegex(ValueError,'Duplicate'):self.evaluate()
 def test_quality_abstentions_count_against_correct_all(self):
  for r in self.rows:
   if r['family']=='a' and r['run_index']<30:r['finish_reason']='tool_calls'
  self.save();report=self.evaluate()
  self.assertEqual(report['gate'],'UNDECIDABLE');self.assertEqual(report['metrics']['a']['correct'],70);self.assertEqual(report['metrics']['a']['abstain'],30)
 def test_provider_identity_and_release_tampering_rejected(self):
  self.rows[0]['response_provider']='other';self.save()
  with self.assertRaisesRegex(ValueError,'Provider'):self.evaluate()
  (self.release/'classifier.py').write_text('different')
  with self.assertRaisesRegex(ValueError,'Frozen artifact'):self.evaluate()

if __name__=='__main__':unittest.main()
