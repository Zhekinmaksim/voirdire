#!/usr/bin/env python3
"""Publish the operational app without substituting synthetic model evidence."""
import json
from pathlib import Path
import shutil
root = Path(__file__).resolve().parents[1]
public = root / 'public'
public.mkdir(exist_ok=True)
shutil.copy2(root / 'chain-and-site/corpus/probes.json', public / 'corpus.json')
research = public / 'research'
research.mkdir(exist_ok=True)
matrix_path = root / 'chain-and-site/web/matrix.json'
matrix = json.loads(matrix_path.read_text())
if matrix.get('provenance', {}).get('kind') == 'live':
    import subprocess, sys
    subprocess.run([sys.executable, str(root/'chain-and-site/scripts/check_matrix.py'), str(matrix_path)], check=True)
    subprocess.run([sys.executable, str(root/'chain-and-site/scripts/build_page.py')], check=True)
    shutil.copy2(root/'chain-and-site/web/index.html', research/'index.html')
    shutil.copy2(matrix_path, research/'matrix.json')
else:
    (research/'matrix.json').unlink(missing_ok=True)
    (research/'index.html').write_text('''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Voirdire — measurement status</title><style>body{background:#101110;color:#ddd;font:18px/1.6 system-ui;max-width:760px;margin:10vh auto;padding:24px}a{color:#bce5cf}h1{font-weight:450}</style><a href="/">← Voirdire</a><h1>Measurement status</h1><p>No validated cross-family measurement is published yet.</p><p>The application records real claims and collector-attested responses on Bradbury. Those records are behavioural testimony, not proof of model identity or calibrated model-classification accuracy.</p><p>Model calibration uses disjoint groups of responses for training and held-out evaluation. Publication requires the measurement gate to pass; synthetic fixture scores are not published here.</p><p><a href="https://github.com/Zhekinmaksim/voirdire">Source and methodology</a></p></html>''')
