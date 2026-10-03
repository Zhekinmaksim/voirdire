#!/usr/bin/env python3
"""Package the exact reviewed source under Bradbury's transaction gas cap.

The payload decompresses byte-for-byte to the published source. Do not add a
comment beside the dependency JSON header: GenVM parses adjacent comments as
one metadata object. Integrity hashes belong in the sidecar JSON map.
No AST transformations, storage renames, or third-party build dependencies.
"""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'chain-and-site/contracts/voirdire.py').read_bytes()
payload = base64.b64encode(zlib.compress(source, 9)).decode('ascii')
assert zlib.decompress(base64.b64decode(payload)) == source
packaged = source.decode().splitlines()[0] + '\n'
packaged += 'import base64 as _b64, zlib as _zl\n'
packaged += f'exec(compile(_zl.decompress(_b64.b64decode({payload!r})), "voirdire.py", "exec"))\n'
compile(packaged, 'voirdire.deploy.py', 'exec')
public = ROOT / 'public'
public.mkdir(exist_ok=True)
(public / 'voirdire.py').write_bytes(source)
(public / 'voirdire.deploy.py').write_text(packaged)
(public / 'voirdire.deploy.map.json').write_text(json.dumps({
    'source_sha256': hashlib.sha256(source).hexdigest(),
    'deployment_sha256': hashlib.sha256(packaged.encode()).hexdigest(),
    'packaging': 'zlib-level-9-base64-exact-source',
    'source_bytes': len(source), 'deployment_bytes': len(packaged.encode()),
}, indent=2) + '\n')
print(f'Exact source {len(source)} bytes; deployment wrapper {len(packaged.encode())} bytes', flush=True)
harness = '''import sys,importlib.util,runpy
from pathlib import Path
root=Path(sys.argv[1])
sys.path.insert(0,str(root/'chain-and-site/test/stub'))
spec=importlib.util.spec_from_file_location('voirdire',root/'public/voirdire.deploy.py')
module=importlib.util.module_from_spec(spec)
sys.modules['voirdire']=module
spec.loader.exec_module(module)
runpy.run_path(str(root/'chain-and-site/test/run_tests.py'),run_name='__main__')
'''
subprocess.run([sys.executable, '-B', '-c', harness, str(ROOT)], check=True)
