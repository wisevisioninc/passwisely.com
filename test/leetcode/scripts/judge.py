#!/usr/bin/env python3
"""Judge saved answers with a deny-by-default macOS sandbox; refuses unsandboxed execution."""
import argparse, copy, json, os, pathlib, re, shutil, signal, subprocess, sys, tempfile
from verify import ROOT, load_references, owner, read

def evaluate(fixture, answer):
    if sys.version_info < (3,10): return {'status':'unverified','reason':'benchmark requires Python>=3.10; use a compatible interpreter without rewriting model code'}
    blocks=re.findall(r'```(?:python3?|py)\s*\n(.*?)```',answer,flags=re.S|re.I)
    if not blocks: return {'status':'unverified','reason':'no Python fenced code block'}
    code=next((b for b in blocks if 'class Solution' in b),blocks[0])
    if sys.platform!='darwin' or not pathlib.Path('/usr/bin/sandbox-exec').exists():
        return {'status':'unverified','reason':'required macOS OS sandbox unavailable; model code not executed'}
    with tempfile.TemporaryDirectory(prefix='passwisely-judge-') as folder:
        folder=pathlib.Path(folder).resolve()
        public_input={'python':fixture['python'],'cases':[{'name':c['name'],'args':c['args']} for c in fixture['cases']]}
        (folder/'case.json').write_text(json.dumps(public_input)); (folder/'solution.py').write_text(code)
        shutil.copyfile(ROOT/'scripts'/'driver.py',folder/'driver.py')
        # Deny network, secrets, child processes and arbitrary filesystem access.
        python_binary=os.path.realpath(sys.executable)
        # Xcode's bin/python3.9 is a launcher that spawns this actual interpreter.
        # Execute the interpreter directly so child-process execution stays denied.
        framework_runner=pathlib.Path(os.path.realpath(sys.base_prefix))/'Resources'/'Python.app'/'Contents'/'MacOS'/'Python'
        if '/Python3.framework/' in python_binary and framework_runner.is_file():
            python_binary=str(framework_runner.resolve())
        read_dirs=[os.path.realpath(sys.base_prefix),str(folder),'/System/Library','/usr/lib','/Library/Apple/System/Library']
        profile='(version 1)(deny default)(allow process-exec (literal '+json.dumps(python_binary)+'))(allow sysctl-read)(allow file-read-metadata)(allow file-read* (literal "/") '+''.join('(subpath '+json.dumps(p)+')' for p in read_dirs)+')(allow file-read* (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))(allow file-write* (literal "/dev/null") (literal '+json.dumps(str(folder/'stdout'))+') (literal '+json.dumps(str(folder/'stderr'))+'))'
        env={'PATH':'/usr/bin:/bin','LANG':'en_US.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
        with open(folder/'stdout','wb') as stdout, open(folder/'stderr','wb') as stderr:
            process=subprocess.Popen(['/usr/bin/sandbox-exec','-p',profile,python_binary,'-I','-S',str(folder/'driver.py'),str(folder/'case.json'),str(folder/'solution.py')],stdout=stdout,stderr=stderr,env=env,cwd=folder,start_new_session=True)
            try: process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid,signal.SIGKILL); process.wait(); return {'status':'failed','reason':'8s sandbox timeout'}
        stdout=(folder/'stdout').read_text(errors='replace')[:2*1024*1024]; stderr=(folder/'stderr').read_text(errors='replace')[:2000]
        if process.returncode or 'PW_RESULT:' not in stdout:
            return {'status':'unverified' if 'sandbox' in stderr.lower() else 'failed','reason':'sandbox process failed','exitCode':process.returncode,'stderr':stderr}
        results=json.loads(stdout.rsplit('PW_RESULT:',1)[1]); modules=load_references(); checks=[]
        for case,item in zip(fixture['cases'],results):
            module,_=owner(modules,fixture['slug'],copy.deepcopy(case['args']))
            good='error' not in item and module.validate(fixture['slug'],case['args'],item.get('actual'),case['expected'])
            checks.append({**item,'passed':good,'expected':case['expected']})
        return {'status':'passed' if len(checks)==len(fixture['cases']) and all(x['passed'] for x in checks) else 'failed','passed':sum(x['passed'] for x in checks),'total':len(fixture['cases']),'cases':checks,'scope':'saved-code functional cases in OS sandbox; does not prove full constraints/complexity'}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('--results',type=pathlib.Path,required=True); parser.add_argument('--allow-execution',action='store_true'); parser.add_argument('--boundary',action='store_true',help='include the three saved adversarial regressions'); args=parser.parse_args()
    if not args.allow_execution: parser.error('explicit --allow-execution required; saved model code executes inside OS sandbox')
    from boundary_generators import load_cases
    extra=load_cases() if args.boundary else []
    output=[]
    for path in sorted(args.results.glob('*.answer.json')):
        record=read(path); fixture=read(ROOT/'cases'/(record['slug']+'.json'))
        fixture['cases'].extend({k:v for k,v in case.items() if k!='slug'} for case in extra if case['slug']==record['slug'])
        verdict=evaluate(fixture,record.get('answer',record.get('fullAnswer','')))
        output.append({'slug':record['slug'],'pythonVersion':'.'.join(map(str,sys.version_info[:3])),**verdict})
    if not output: parser.error('no *.answer.json records found')
    destination=args.results/('verdicts-with-boundary.json' if args.boundary else 'verdicts.json')
    if destination.exists(): parser.error(str(destination)+' exists; preserve previous run or use a new result directory')
    destination.write_text(json.dumps(output,ensure_ascii=False,indent=2)); print(json.dumps({'problems':len(output),'statuses':{s:sum(x['status']==s for x in output) for s in ['passed','failed','unverified']}},ensure_ascii=False))
