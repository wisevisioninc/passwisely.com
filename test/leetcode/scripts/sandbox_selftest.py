"""Author-written sandbox tests only. Never reads saved model answers or credentials."""

import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile


ROOT = Path(__file__).resolve().parent
SOURCE_SCRIPTS = ROOT
sys.path.insert(0, str(SOURCE_SCRIPTS))
spec = importlib.util.spec_from_file_location('fixed_judge', ROOT / 'judge.py')
judge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(judge)

fixture = {
    'slug': 'pass-the-pillow',
    'python': {'method': 'passThePillow', 'params': [{'name': 'n', 'type': 'integer'}, {'name': 'time', 'type': 'integer'}], 'return': {'type': 'integer'}},
    'cases': [
        {'name': 'one-second', 'args': [2, 1], 'expected': 2},
        {'name': 'bounce-back', 'args': [5, 7], 'expected': 2},
        {'name': 'complete-cycle', 'args': [6, 10], 'expected': 1},
        {'name': 'upper-boundary', 'args': [1000, 1000], 'expected': 999},
    ],
}
authored_answer = '''```python
class Solution:
    def passThePillow(self, n: int, time: int) -> int:
        position, direction = 1, 1
        for _ in range(time):
            position += direction
            if position == n or position == 1:
                direction *= -1
        return position
```'''
verdict = judge.evaluate(fixture, authored_answer)
assert verdict['status'] == 'passed', verdict

python_binary = os.path.realpath(sys.executable)
framework = Path(os.path.realpath(sys.base_prefix)) / 'Resources/Python.app/Contents/MacOS/Python'
if '/Python3.framework/' in python_binary and framework.is_file():
    python_binary = str(framework.resolve())

with tempfile.TemporaryDirectory(prefix='passwisely-sandbox-selftest-') as outer:
    test_folder = Path(outer).resolve() / 'permitted'
    test_folder.mkdir()
    sentinel = Path(outer).resolve() / 'outside-authored-sentinel.txt'
    sentinel.write_text('AUTHORED_NON_SECRET_SENTINEL_ONLY')
    listener = socket.socket()
    listener.bind(('127.0.0.1', 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    script = test_folder / 'security_check.py'
    script.write_text('''import errno,json,os,socket,subprocess
checks={}
try:
    with open(SENTINEL) as source:
        source.read()
    checks['external_sentinel_read_denied']=False
except PermissionError:
    checks['external_sentinel_read_denied']=True
try:
    connection=socket.socket()
    connection.settimeout(.3)
    connection.connect(('127.0.0.1',PORT))
    checks['network_denied']=False
except PermissionError:
    checks['network_denied']=True
try:
    subprocess.run(['/usr/bin/true'], check=True)
    checks['child_process_denied']=False
except PermissionError:
    checks['child_process_denied']=True
try:
    with open(SENTINEL,'w') as destination:
        destination.write('changed')
    checks['external_write_denied']=False
except PermissionError:
    checks['external_write_denied']=True
print(json.dumps(checks))
'''.replace('SENTINEL', repr(str(sentinel))).replace('PORT', str(port)))
    read_dirs = [os.path.realpath(sys.base_prefix), str(test_folder), '/System/Library', '/usr/lib', '/Library/Apple/System/Library']
    profile = '(version 1)(deny default)(allow process-exec (literal '+json.dumps(python_binary)+'))(allow sysctl-read)(allow file-read-metadata)(allow file-read* (literal "/") '+''.join('(subpath '+json.dumps(p)+')' for p in read_dirs)+')(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))(allow file-write* (literal "/dev/null"))'
    result = subprocess.run(['/usr/bin/sandbox-exec', '-p', profile, python_binary, '-I', '-S', str(script)], cwd=test_folder, env={'PATH': '/usr/bin:/bin', 'LANG': 'en_US.UTF-8', 'PYTHONDONTWRITEBYTECODE': '1'}, capture_output=True, text=True, timeout=8)
    listener.close()
    assert result.returncode == 0, (result.returncode, result.stderr)
    checks = json.loads(result.stdout)
    assert all(checks.values()), checks
    assert sentinel.read_text() == 'AUTHORED_NON_SECRET_SENTINEL_ONLY'
    sentinel.unlink()

record = {'python': sys.executable, 'sandboxExecutable': python_binary, 'authorWrittenPillowCases': verdict['passed'], 'securityChecks': checks, 'scope': 'Author-written code only; no saved model answers or credentials read/executed.'}
print(json.dumps(record, indent=2))
