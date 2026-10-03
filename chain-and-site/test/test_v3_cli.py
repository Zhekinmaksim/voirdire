import copy
import hashlib
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from test_v3_contract import V,FIXTURE
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('round_cli_v3',ROOT/'cli/round.py')
CLI=importlib.util.module_from_spec(spec);spec.loader.exec_module(CLI)
spec=importlib.util.spec_from_file_location('legacy_v2',ROOT/'test/archive/voirdire_v2.py')
LEGACY=importlib.util.module_from_spec(spec);sys.modules[spec.name]=LEGACY;spec.loader.exec_module(LEGACY)
class CLIParity(unittest.TestCase):
    def env(self,version):return {'version':version,'profile_hash':V.PROFILE_HASH,'claim_id':3,'nonce':'ab'*16,'endpoint':'openrouter:openai/gpt-4o-mini','transcripts':copy.deepcopy(FIXTURE)}
    def test_v2_exact_bytes_unchanged_including_ignored_v3_fields(self):
        env=self.env('voirdire/2')
        self.assertEqual(CLI.canonical(env),LEGACY._canonical(env))
        self.assertEqual(CLI.canonical_evidence(env),LEGACY._canonical_evidence(env))
    def test_v3_exact_plan_and_evidence_bytes(self):
        env=self.env('voirdire/3')
        self.assertEqual(CLI.canonical(env),V._canonical(env))
        self.assertEqual(CLI.canonical_evidence(env),V._canonical_evidence(env))
        self.assertEqual(CLI.validate(env),[])
        changed=copy.deepcopy(env);changed['transcripts'][0]['got']+=' changed';changed['transcripts'][0]['finish_reason']='length'
        self.assertEqual(CLI.digest(env),CLI.digest(changed))
        self.assertNotEqual(CLI.evidence_digest(env),CLI.evidence_digest(changed))
    def test_v3_plan_validates_without_responses_but_evidence_does_not(self):
        env=self.env('voirdire/3')
        for t in env['transcripts']:t.pop('got');t.pop('finish_reason')
        self.assertEqual(CLI.validate(env,plan=True),[])
        self.assertTrue(CLI.validate(env))
    def test_v3_scope_validation(self):
        for edit in [lambda e:e.update(profile_hash='00'*32),lambda e:e['transcripts'].pop(),lambda e:e['transcripts'][0].update(sent='altered'),lambda e:e['transcripts'][0].update(finish_reason='tool_calls')]:
            env=self.env('voirdire/3');edit(env);self.assertTrue(CLI.validate(env))
