#!/usr/bin/env python3
"""Package the exact reviewed source under Bradbury's transaction gas cap.

The payload decompresses byte-for-byte to the published source. Do not add a
comment beside the dependency JSON header: GenVM parses adjacent comments as
one metadata object. Integrity hashes belong in the sidecar JSON map.
No AST transformations, storage renames, or third-party build dependencies.
"""
import base64
import bz2
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zlib

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'chain-and-site/contracts/voirdire.py').read_bytes()
v3 = 'VERSION = "voirdire/3"' in source.decode()
codec = 'bz2' if v3 else 'zlib'
encoding = 'b85' if v3 else 'b64'
compressor = bz2 if v3 else zlib
payload = getattr(base64, encoding+'encode')(compressor.compress(source, 9)).decode('ascii')
assert compressor.decompress(getattr(base64, encoding+'decode')(payload)) == source
packaged = source.decode().splitlines()[0] + '\n'
packaged += f'import base64 as _b64, {codec} as _zl\n'
packaged += f'exec(compile(_zl.decompress(_b64.{encoding}decode({payload!r})), "voirdire.py", "exec"))\n'
compile(packaged, 'voirdire.deploy.py', 'exec')
public = ROOT / 'public'
public.mkdir(exist_ok=True)
(public / 'voirdire.py').write_bytes(source)
(public / 'voirdire.deploy.py').write_text(packaged)
(public / 'voirdire.deploy.map.json').write_text(json.dumps({
    'source_sha256': hashlib.sha256(source).hexdigest(),
    'deployment_sha256': hashlib.sha256(packaged.encode()).hexdigest(),
    'packaging': 'bz2-level-9-base85-exact-source' if v3 else 'zlib-level-9-base64-exact-source',
    'source_bytes': len(source), 'deployment_bytes': len(packaged.encode()),
}, indent=2) + '\n')
print(f'Exact source {len(source)} bytes; deployment wrapper {len(packaged.encode())} bytes', flush=True)
# Tests for the reviewed v2 source stay pinned to its archive. v3 tests target
# the packaged active module via a path override and run in a fresh process.
if v3:
    import os
    subprocess.run([sys.executable, '-B', str(ROOT/'chain-and-site/test/run_tests.py')],check=True)
    subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', str(ROOT/'chain-and-site/test'), '-p', 'test_v3_*.py'],check=True,env={**os.environ,'VOIRDIRE_CANDIDATE_PATH':str(public/'voirdire.deploy.py')})
else:
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
    import textwrap
    subprocess.run([sys.executable, '-B', '-c', textwrap.dedent(harness), str(ROOT)], check=True)
