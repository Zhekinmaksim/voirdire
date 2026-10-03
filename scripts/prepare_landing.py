#!/usr/bin/env python3
"""Restore the original visual system with the already validated v3 evidence."""
import json
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def prepare_landing():
    original = (ROOT / 'chain-and-site/web/index.tpl.html').read_text()
    style = re.search(r'<style>(.*?)</style>', original, re.S).group(1)
    art = re.search(r'<svg class="fringe".*?</svg>', original, re.S).group(0)
    art = re.sub(r'aria-label="[^"]*"', 'aria-label="Metal plates under an interference film, an illustration of observable behaviour and unresolved outcomes."', art, count=1)
    art = art.replace('the lower two return the same fringe', 'behaviour is observable · identity is not')
    deployment = json.loads((ROOT / 'public/deployment.json').read_text())
    profile = json.loads((ROOT / 'public/profile.json').read_text())
    # prepare_web validates these bindings before calling this renderer.
    gate = json.loads((ROOT / 'public/research/confirmation-v3.json').read_text())
    plan = json.loads((ROOT / 'chain-and-site/calibration/candidates/int-v3/confirmation-plan.json').read_text())
    verification = json.loads((ROOT / 'public/release-verification.json').read_text())
    if deployment['protocolVersion'] != 'voirdire/3' or gate['gate'] != 'PASS':
        raise ValueError('The landing page requires the validated v3 release')
    if verification['contract'].lower() != deployment['contractAddress'].lower() or verification['status'] != 'VERIFIED_ON_BRADBURY' or verification['withdrawal']['actual_wallet_arrival_verified'] is not True:
        raise ValueError('The landing page requires verified live controls for this contract')
    families = list(sorted(plan['families']))
    labels = {'gpt-class': 'GPT', 'llama-class': 'Llama', 'mistral-class': 'Mistral', 'ABSTAIN': 'Abstain'}
    cols = families + ['ABSTAIN']
    table = '<thead><tr><th scope="col">Actual endpoint</th>' + ''.join(f'<th scope="col">{labels[f]}</th>' for f in cols) + '</tr></thead><tbody>'
    for family in families:
        spec = plan['families'][family]
        table += f'<tr><th scope="row">{escape(spec["model"])}<br><small>{escape(spec["provider"])} · {escape(spec["tag"])}</small></th>'
        for decision in cols:
            n = gate['confusion'][family][decision]
            css = 'blind' if decision == 'ABSTAIN' else 'sep' if decision == family else 'self'
            label = 'unresolved' if decision == 'ABSTAIN' else 'matched' if decision == family else 'wrong family'
            table += f'<td class="{css}" style="--lum:{n / 100:.2f}"><span class="n">{n}</span><span class="t">{label}</span></td>'
        table += '</tr>'
    table += '</tbody>'
    corpus = json.loads((ROOT / 'chain-and-site/corpus/probes.json').read_text())
    selected = set(profile['probe_ids'])
    probes = []
    for p in corpus['probes']:
        active = p['probe_id'] in selected
        rows = ''.join(f'<dt>{escape(label)}</dt><dd>{escape(str(p[key]))}</dd>' for label, key in [('Author hypothesis', 'discriminator'), ('Intended reading', 'reads')] if p.get(key))
        if p.get('ethics'):
            rows += f'<dt>Benign scope</dt><dd>{escape(p["ethics"])}</dd>'
        probes.append(f'''<details class="probe" data-class="{escape(p['class'])}" data-profile="{str(active).lower()}"><summary>
<span class="id">{escape(p['probe_id'])}</span><span class="tag">{escape(p['class'].replace('_', ' '))}</span><span class="tag{' profile' if active else ''}">{'Frozen v3 probe' if active else 'Source corpus only'}</span><span class="peek">{escape(p['carrier'])}</span><span class="chev" aria-hidden="true"></span></summary>
<div class="body"><p class="carrier">{escape(p['carrier'])}</p><dl>{rows}</dl></div></details>''')
    filters = [('all', 'everything'), ('profile', 'live profile')] + [(c, c.replace('_', ' ')) for c in dict.fromkeys(p['class'] for p in corpus['probes'])]
    html = (ROOT / 'app/home.tpl.html').read_text()
    replacements = {
        '__BASE_STYLE__': style, '__HERO_ART__': art, '__CONFUSION_TABLE__': table,
        '__PROBES__': '\n'.join(probes),
        '__FILTERS__': ''.join(f'<button type="button" data-filter="{escape(key)}" aria-pressed="{str(key == "all").lower()}">{escape(label)}</button>' for key, label in filters),
        '__CONTRACT__': escape(deployment['contractAddress']), '__PROFILE_HASH__': escape(deployment['profileHash']),
        '__WITHDRAWAL_URL__': escape(deployment['explorerUrl'] + '/tx/' + verification['withdrawal']['transaction']),
    }
    for key, value in replacements.items():
        html = html.replace(key, value)
    if re.search(r'__[A-Z_]+__', html):
        raise ValueError('Unresolved landing template placeholder')
    (ROOT / 'app/index.html').write_text(html)
