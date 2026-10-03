#!/usr/bin/env python3
"""Publish measured research only when its release and deployment bindings agree."""
import hashlib
import json
from html import escape
from pathlib import Path
import shutil

root = Path(__file__).resolve().parents[1]
public = root / 'public'
public.mkdir(exist_ok=True)
shutil.copy2(root / 'chain-and-site/corpus/probes.json', public / 'corpus.json')
research = public / 'research'
research.mkdir(exist_ok=True)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def original_diagnostic():
    diagnostic = root / 'chain-and-site/calibration/status.json'
    if not diagnostic.exists():
        (research / 'run-status.json').unlink(missing_ok=True)
        return ''
    status = json.loads(diagnostic.read_text())
    require(status.get('schema') == 'voirdire-calibration-status/1' and
            status.get('approved_for_verdicts') is False and
            status.get('gate') in ('UNDECIDABLE', 'FAIL'),
            'Unexpected original diagnostic status')
    shutil.copy2(diagnostic, research / 'run-status.json')
    return f'''<section><h2>Original live run: {escape(status['gate'])}</h2>
<p>{int(status['total_responses']):,} real responses; {int(status['held_out_batches'])} held-out observations.</p>
<p>{escape(status['summary'])}</p><p>This earlier experiment remains undecidable. Its results have not been relabelled as approved or pooled with the fresh v3 confirmation.</p>
<p><a href="/research/run-status.json">Original diagnostic data and integrity hashes</a></p></section>'''


def approved_v3(deployment):
    require(deployment.get('sourceSha256') == sha(root / 'chain-and-site/contracts/voirdire.py') == sha(public / 'voirdire.py'),
            'Published contract source differs from deployment')
    require(deployment.get('deploymentSha256') == sha(public / 'voirdire.deploy.py'),
            'Published deployment wrapper differs from deployment')
    release = root / 'chain-and-site/calibration/candidates/int-v3'
    gate_path = root / 'chain-and-site/calibration/confirmation-v3/gate.json'
    require(gate_path.exists(), 'A v3 deployment requires its fresh confirmation gate')
    gate = json.loads(gate_path.read_text())
    observed = json.loads((gate_path.parent / 'release.json').read_text())
    require(observed['files_sha256']['gate.json'] == sha(gate_path), 'Confirmation report hash differs')
    manifest_path = release / 'manifest.json'
    manifest = json.loads(manifest_path.read_text())
    require(gate.get('gate') == 'PASS' and gate.get('gate_exit_code') == 0 and not gate.get('reasons'),
            'The fresh v3 confirmation gate did not pass')
    require(gate.get('manifest_sha256') == sha(manifest_path), 'Confirmation manifest hash differs')
    require(deployment.get('calibrationManifestHash') == sha(manifest_path), 'Deployment manifest hash differs')
    for name, digest in manifest['files_sha256'].items():
        require(Path(name).name == name and sha(release / name) == digest, 'Frozen release file differs: ' + name)
    require(sha(root / 'chain-and-site/scripts/round_confirmation_gate.py') == manifest['gate_source_sha256'],
            'Fresh confirmation gate source differs from the frozen manifest')
    profile_hash = sha(release / 'profile.json')
    require(deployment.get('profileHash') == profile_hash, 'Deployment profile hash differs from the confirmed release')
    require((public / 'profile.json').exists() and sha(public / 'profile.json') == profile_hash,
            'Published profile bytes differ from the confirmed release')
    profile = json.loads((release / 'profile.json').read_text())
    plan = json.loads((release / 'confirmation-plan.json').read_text())
    require(gate.get('responses') == 1800 and gate.get('rounds') == 300 and gate.get('old_response_id_overlap') == 0,
            'Confirmation sample size or freshness differs')
    families = sorted(plan['families'])
    require(families == ['gpt-class', 'llama-class', 'mistral-class'] and set(gate['metrics']) == set(families),
            'Unexpected confirmation scope')
    require(len(profile['probe_ids']) == 6 and len(set(profile['probe_ids'])) == 6,
            'Expected six unique frozen probes')
    rows = []
    for family in families:
        spec, metric = plan['families'][family], gate['metrics'][family]
        correct, abstain, wrong = (metric[k] for k in ('correct', 'abstain', 'false_accusations'))
        require(all(type(n) is int and n >= 0 for n in (correct, abstain, wrong)) and correct + abstain + wrong == 100,
                'Invalid per-model sample counts')
        require(metric['correct_all_interval95'][0] >= .75 and metric['false_accusation_interval95'][1] <= .10,
                'Confirmation confidence bounds do not meet the preregistered thresholds')
        require(profile['supported_models'][family] == spec['model'], 'Confirmed model differs from profile')
        rows.append(f'''<tr><td>{escape(spec['model'])}<br><small>{escape(spec['provider'])} · {escape(spec['tag'])}</small></td>
<td>{correct}/100</td><td>{abstain}</td><td>{wrong}</td>
<td>{metric['correct_all_interval95'][0]*100:.3f}%</td><td>{metric['false_accusation_interval95'][1]*100:.3f}%</td></tr>''')
    shutil.copy2(gate_path, research / 'confirmation-v3.json')
    shutil.copy2(manifest_path, research / 'confirmation-v3-manifest.json')
    collection_time = ''
    if observed.get('observed_from') and observed.get('observed_until'):
        collection_time = f"<p>Observed responses: {escape(observed['observed_from'])} — {escape(observed['observed_until'])}.</p>"
    return f'''<section><h2>Fresh v3 confirmation: PASS within the tested scope</h2>
<p>1,800 newly collected responses formed 300 six-response rounds: 100 rounds for each of the three model/provider combinations below. The frozen classifier was not fitted on this confirmation sample. Abstentions count as incorrect in the correct/all confidence bound.</p>
<p>Preregistered plan timestamp: {escape(plan['created_at'])}.</p>{collection_time}
<div class="table-wrap"><table><thead><tr><th>Model / provider</th><th>Correct</th><th>Abstained</th><th>Wrong family</th><th>Correct/all 95% lower bound</th><th>False accusation 95% upper bound</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<p>These are per-model Wilson 95% intervals. Thresholds fixed before confirmation: correct/all lower bound ≥75%; false-accusation upper bound ≤10%. Zero observed wrong-family results does not establish zero future risk.</p>
<p>Scope: these three endpoints and providers, the six fixed probes, and the frozen collection policy. No claim is made for unknown models, other providers, model weights or future endpoint changes. This statistical PASS does not approve payouts or establish model identity.</p>
<p>Probe IDs: {escape(', '.join(profile['probe_ids']))}. Collection: temperature {profile['generation_policy']['temperature']}, maximum {profile['generation_policy']['max_tokens']} output tokens. Token-limited responses remain partial and are handled by the preregistered policy.</p>
<p class="hash">Profile SHA-256: {profile_hash}</p>
<p><a href="/profile.json">Exact frozen profile</a> · <a href="/research/confirmation-v3.json">Fresh gate and metrics</a> · <a href="/research/confirmation-v3-manifest.json">Frozen release manifest</a></p></section>'''


deployment = json.loads((public / 'deployment.json').read_text())
original = original_diagnostic()
v3 = deployment.get('protocolVersion') == 'voirdire/3'
# Never leave stale approved assets behind when publishing a different release.
for name in ('confirmation-v3.json', 'confirmation-v3-manifest.json'):
    (research / name).unlink(missing_ok=True)
report = approved_v3(deployment) if v3 else ''
matrix_path = root / 'chain-and-site/web/matrix.json'
matrix = json.loads(matrix_path.read_text())
if not v3 and matrix.get('provenance', {}).get('kind') == 'live':
    import subprocess, sys
    subprocess.run([sys.executable, str(root/'chain-and-site/scripts/check_matrix.py'), str(matrix_path)], check=True)
    subprocess.run([sys.executable, str(root/'chain-and-site/scripts/build_page.py')], check=True)
    shutil.copy2(root/'chain-and-site/web/index.html', research/'index.html')
    shutil.copy2(matrix_path, research/'matrix.json')
else:
    (research/'matrix.json').unlink(missing_ok=True)
    intro = 'The fresh v3 result below is limited to its frozen three-model test scope.' if v3 else 'No validated cross-family measurement is published yet.'
    operational = 'The application records collector-attested evidence on Bradbury. Profile results are behavioural classifications, not proof of model identity. Transaction finality and settlement must be checked independently.' if v3 else 'The application records collector-attested evidence on Bradbury. Those records are behavioural testimony, not proof of model identity. On-chain LLM adjudication is experimental and can fail to reach consensus.'
    (research/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voirdire — measurement status</title><style>body{background:#101110;color:#ddd;font:18px/1.6 system-ui;max-width:960px;margin:8vh auto;padding:24px}a{color:#bce5cf}h1,h2{font-weight:450}section{border-top:1px solid #444;margin-top:36px;padding-top:16px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;font-size:14px}td,th{text-align:left;padding:10px;border-bottom:1px solid #444;vertical-align:top}.hash{overflow-wrap:anywhere;font-size:14px}</style><a href="/">← Voirdire</a><h1>Measurement status</h1><p>'''+intro+'</p>'+report+original+'<p>'+operational+'''</p><p><a href="/release-verification.json">Live protocol controls and native withdrawal status</a></p><p>Synthetic fixture scores are not published here.</p><p><a href="https://github.com/Zhekinmaksim/voirdire/tree/main/chain-and-site/calibration">Source, methodology and limitations</a></p></html>''')
