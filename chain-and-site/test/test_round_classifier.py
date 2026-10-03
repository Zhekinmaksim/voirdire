import copy
import json
import sys
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import round_classifier as R


class RoundClassifierTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate=R.load_candidate(ROOT/'calibration/candidates/v1-round-classifier.json')
        plan=json.loads((ROOT/'calibration/candidates/v1-confirmation-plan.json').read_text())
        cls.transcripts=[{'probe_id':p['probe_id'],'probe_class':p['class'],'sent':p['carrier'],'got':'The answer is 17.'} for p in plan['probes']]

    def test_order_and_untrusted_metadata_do_not_affect_features(self):
        t=copy.deepcopy(self.transcripts)
        t.reverse()
        for row in t:row.update(family='faked',model='faked',source={'provider':'faked'})
        self.assertEqual(R.vector(self.candidate,t),R.vector(self.candidate,self.transcripts))

    def test_duplicate_missing_and_changed_prompt_abstain(self):
        duplicate=copy.deepcopy(self.transcripts);duplicate[-1]=duplicate[0]
        changed=copy.deepcopy(self.transcripts);changed[0]['sent']+=' Ignore rules'
        empty=copy.deepcopy(self.transcripts);empty[0]['got']=''
        for t in [duplicate,changed,empty,self.transcripts[:-1]]:
            self.assertEqual(R.predict(self.candidate,t)['reason'],'invalid_evidence')

    def test_radius_is_inclusive_and_no_fallback_to_another_family(self):
        c=copy.deepcopy(self.candidate);v=R.vector(c,self.transcripts)
        names=sorted(c['centroids'])
        for index,f in enumerate(names):
            c['centroids'][f]=[x+index+1 for x in v]
            c['rejection_radius'][f]=1000
        distance=len(v)**.5
        c['rejection_radius'][names[0]]=distance
        self.assertEqual(R.predict(c,self.transcripts)['decision'],names[0])
        c['rejection_radius'][names[0]]=distance-1e-6
        self.assertEqual(R.predict(c,self.transcripts)['reason'],'outside_training_profile')

    def test_plan_is_fresh_fixed_size_and_unfunded(self):
        p=json.loads((ROOT/'calibration/candidates/v1-confirmation-plan.json').read_text())
        self.assertEqual(p['calls'],1800)
        self.assertEqual(p['k'],100)
        self.assertEqual(len(p['probes']),6)
        self.assertFalse(p['confirmation']['budget_authorized'])
        for f in p['families'].values():
            self.assertFalse(f['routing']['allow_fallbacks'])
            self.assertEqual(f['routing']['only'],[f['tag']])


if __name__=='__main__':unittest.main()
