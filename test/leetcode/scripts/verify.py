#!/usr/bin/env python3
"""Offline corpus checks and trusted reference checks. Never executes model code."""
import argparse, collections, copy, hashlib, importlib.util, json, pathlib, random, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def load_references():
    modules=[]
    for part in ['part1','part2']:
        spec=importlib.util.spec_from_file_location('oracle_'+part, ROOT/'oracles'/part/'references.py')
        mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); modules.append(mod)
    return modules

def owner(modules, slug, args):
    for module in modules:
        try: return module, module.solve(slug, args)
        except KeyError: continue
    raise AssertionError('missing oracle: '+slug)

def verify():
    manifest=read(ROOT/'manifest.json'); problems=manifest['problems']
    assert len(problems)==20, 'exactly 20 samples required'
    assert len({x['slug'] for x in problems})==20
    pool=read(ROOT/'selection-pool.json'); rng=random.Random(manifest['selection']['seed']); drawn=[]
    for level,count in [(1,8),(2,8),(3,4)]:
        group=[x for x in pool if x['level']==level]; rng.shuffle(group); drawn.extend(group[:count])
    rng.shuffle(drawn)
    assert [x['slug'] for x in drawn]==[x['slug'] for x in problems], 'fixed-seed selection mismatch'
    assert len(pool)==manifest['selection']['numericFreeCandidates'], 'pool size mismatch'
    assert hashlib.sha256((ROOT/'selection-pool.json').read_bytes()).hexdigest()==manifest['selection']['poolSha256'], 'pool integrity mismatch'
    modules=load_references(); cases=0; diffs=collections.Counter()
    for item in problems:
        path=ROOT/'cases'/(item['slug']+'.json'); raw=path.read_bytes(); data=json.loads(raw)
        assert hashlib.sha256(raw).hexdigest()==item['sha256'], 'fixture changed; regenerate manifest hashes: '+item['slug']
        assert data['slug']==item['slug'] and data['id']==item['id']
        assert data['source']['url']=='https://leetcode.cn/problems/'+data['slug']+'/'
        assert len(data['source']['originalStatementSha256'])==64
        assert data['statement'] and data['python']['method']
        assert len(data['cases'])>=6 and any(x['kind']=='boundary' for x in data['cases'])
        assert len({x['name'] for x in data['cases']})==len(data['cases'])
        for case in data['cases']:
            assert len(case['args'])==len(data['python']['params'])
            module, actual=owner(modules,data['slug'],copy.deepcopy(case['args']))
            assert module.validate(data['slug'],case['args'],actual,case['expected']), (data['slug'],case['name'],actual,case['expected'])
            cases+=1
        diffs[data['difficulty']]+=1
    assert dict(diffs)=={'Easy':8,'Medium':8,'Hard':4}, diffs
    from boundary_generators import load_cases
    boundary=load_cases()
    assert len(boundary)==3
    for case in boundary:
        module, actual=owner(modules,case['slug'],copy.deepcopy(case['args']))
        assert module.validate(case['slug'],case['args'],actual,case['expected']), case['name']
    result={'boundaryCases':len(boundary),'problems':len(problems),'cases':cases,'difficulty':dict(diffs),'status':'passed','scope':'offline fixture integrity + trusted small-input reference checks; no ASR/model/UI assertion'}
    print(json.dumps(result,ensure_ascii=False,indent=2)); return result

if __name__=='__main__': verify()
