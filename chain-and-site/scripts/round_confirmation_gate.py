#!/usr/bin/env python3
"""Fail-closed fresh six-response confirmation audit. No training or network."""
import argparse
import hashlib
import importlib.util
import json
import datetime
from pathlib import Path
from decimal import Decimal
from build_matrix import load, wilson
from openrouter_battery import budget_state, records, retry_delay


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def evaluate(release, run_dir, old_source):
    release, run_dir, old_source = map(Path, (release, run_dir, old_source))
    manifest = json.loads((release/'manifest.json').read_text())
    for name, digest in manifest['files_sha256'].items():
        require(Path(name).name == name, 'Invalid release filename')
        require(sha(release/name) == digest, 'Frozen artifact differs: '+name)
    require(sha(__file__) == manifest['gate_source_sha256'], 'Gate source differs from preregistration')
    plan = json.loads((release/'confirmation-plan.json').read_text())
    profile = json.loads((release/'profile.json').read_text())
    require(json.loads((run_dir/'plan.json').read_text()) == plan, 'Collection plan differs')
    require(sha(old_source) == manifest['old_dataset_sha256'], 'Old comparison source differs')
    _, old_rows = load(old_source)
    old_ids = {r['response_id'] for r in old_rows}
    events = records(run_dir/'ledger.jsonl')
    spent, pending, completed = budget_state(events)
    require(not pending, 'Unresolved billing reservations')
    require(spent <= Decimal('2.00'), 'Fresh confirmation budget exceeded')
    # Failures must preserve every attempt; only up to8 explicitly resolved429s,
    # one per identity, can occur. No other retry is admitted by this protocol.
    failures = {}
    last_failure = {}
    recovery = records(run_dir/'recovery.jsonl')
    recovery_auth = {e['failure_line']: e for e in recovery if e['event']=='authorized_429_recovery'}
    for line, event in enumerate(events):
        if event['event'] == 'failed':
            require(event.get('http_status') == 429, 'Non429 failed attempt prevents PASS')
            failures[event['identity']] = failures.get(event['identity'], 0)+1
            require(line in recovery_auth, 'Failed request lacks recovery authorization')
            auth=recovery_auth[line]
            require(auth['identity']==event['identity'] and auth['not_before']-auth['authorized_at']>=max(60,retry_delay(event.get('retry_after'),auth['authorized_at'])), 'Invalid cooldown authorization')
            last_failure[event['identity']]=auth
        if event['event']=='reserved' and event['identity'] in last_failure:
            stamp=datetime.datetime.fromisoformat(event['at']).timestamp()
            require(stamp>=last_failure[event['identity']]['not_before'], 'Retry precedes frozen cooldown')
    resolved={}
    for event in events:
        if event['event']=='resolved_failed':resolved[event['identity']]=resolved.get(event['identity'],0)+1
    require(resolved==failures, 'Every failed attempt must be fully charged before retry')
    require(sum(failures.values()) <= 8 and all(n<=1 for n in failures.values()), 'Recovery allowance exceeded')
    expected = {f'{f}:{p["probe_id"]}:{i}' for f in plan['families'] for p in plan['probes'] for i in range(100)}
    require(plan['k'] == 100 and plan['calls'] == 1800 and len(expected) == 1800, 'Invalid fixed sample plan')
    require(set(completed) == expected, 'Exactly1800 complete logical responses required')
    require(len(plan['families']) == 3 and len(plan['probes']) == 6, 'Wrong strata/probe count')
    all_rows=[]
    plan_hash=hashlib.sha256(json.dumps(plan,sort_keys=True).encode()).hexdigest()
    for family, spec in plan['families'].items():
        header, rows = load(run_dir/(family+'.jsonl'))
        require(header['provenance']['plan_sha256'] == plan_hash, 'Wrong family file provenance')
        require(header['families'] == [family] and header['models'] == {family:spec['model']}, 'Wrong header family/model')
        require(len(rows)==600, 'Incomplete family file')
        for r in rows:
            require(r.get('family')==family and completed.get(r.get('identity'))==r, 'Raw response differs from ledger')
            require(r['response_model']==spec['model'] and r['model']==spec['model'] and r['response_provider']==spec['provider'], 'Provider/model identity differs')
            require(r['observed_at'] > plan['created_at'], 'Response predates frozen plan')
            require(not r.get('error') and isinstance(r.get('got'),str) and r['got'].strip(), 'Unsuccessful response')
            require(Decimal(r['cost_usd'])>=0 and Decimal(str(r['usage']['cost']))==Decimal(r['cost_usd']), 'Cost receipt differs')
        all_rows.extend(rows)
    require(len({r['identity'] for r in all_rows})==1800, 'Duplicate logical response')
    ids=[r['response_id'] for r in all_rows]
    require(all(isinstance(i,str) and i for i in ids) and len(set(ids))==1800, 'Duplicate/missing upstream ID')
    require(not set(ids)&old_ids, 'Old responses reused')
    spec=importlib.util.spec_from_file_location('frozen_round_classifier',release/'classifier.py')
    classifier=importlib.util.module_from_spec(spec);spec.loader.exec_module(classifier)
    groups={}
    probes={p['probe_id']:p for p in plan['probes']}
    for r in all_rows:
        p=probes[r['probe_id']]
        require(r['sent']==p['carrier'] and r['probe_class']==p['class'], 'Prompt/class differs')
        require(r['identity']==f'{r["family"]}:{r["probe_id"]}:{r["run_index"]}', 'Malformed logical identity')
        groups.setdefault((r['family'],r['run_index']),[]).append(r)
    families=sorted(plan['families']);conf={f:{g:0 for g in families+['ABSTAIN']} for f in families};quality_counts={f:0 for f in families}
    for (truth,i),ts in groups.items():
        require(len(ts)==6 and len({t['probe_id'] for t in ts})==6, 'Incomplete unique six-probe round')
        quality=all(t['finish_reason'] in profile['generation_policy']['accepted_finish_reasons'] and len(t['got'])<=profile['generation_policy']['max_response_chars'] for t in ts)
        if quality:decision=classifier.predict(profile,ts)['decision']
        else:decision='ABSTAIN';quality_counts[truth]+=1
        conf[truth][decision]+=1
    metrics={};reasons=[]
    for f,row in conf.items():
        require(sum(row.values())==100, 'Exactly100 rounds/family required')
        errors=sum(v for g,v in row.items() if g not in (f,'ABSTAIN'))
        metrics[f]={'correct':row[f],'abstain':row['ABSTAIN'],'false_accusations':errors,'quality_abstentions':quality_counts[f],'correct_all_interval95':wilson(row[f],100),'false_accusation_interval95':wilson(errors,100)}
        if metrics[f]['correct_all_interval95'][0]<.75:reasons.append(f+': correct/all lower95 below0.75')
        if metrics[f]['false_accusation_interval95'][1]>.10:reasons.append(f+': false accusation upper95 above0.10')
    return {'gate':'PASS' if not reasons else 'UNDECIDABLE','gate_exit_code':0 if not reasons else 2,'scope':'Frozen known model/provider combinations only; unknown rejection not certified. Not on-chain payment approval.','responses':1800,'rounds':300,'confusion':conf,'metrics':metrics,'reasons':reasons,'conservative_debit_usd':str(spent),'old_response_id_overlap':0,'manifest_sha256':sha(release/'manifest.json')}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--run-dir',type=Path,required=True)
    parser.add_argument('--old-source',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    a=parser.parse_args()
    try:report=evaluate(a.release,a.run_dir,a.old_source)
    except (ValueError,KeyError,TypeError,OSError) as error:report={'gate':'INVALID','gate_exit_code':2,'reasons':[str(error)]}
    a.out.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
    return report['gate_exit_code']


if __name__=='__main__':raise SystemExit(main())
