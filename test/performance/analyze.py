#!/usr/bin/env python3
"""Aggregate a saved performance run. Never sends requests or executes model code."""
import argparse, collections, datetime, json, math, pathlib, re, unicodedata

def read(p): return json.loads(p.read_text())
def percentile(values, q):
    values=sorted(values)
    if not values:return None
    at=(len(values)-1)*q;lo=math.floor(at);hi=math.ceil(at)
    return values[lo]+(values[hi]-values[lo])*(at-lo)
def distribution(values):
    values=list(values)
    return {'n':len(values),'p50Ms':percentile(values,.5),'p95Ms':percentile(values,.95),'minMs':min(values) if values else None,'maxMs':max(values) if values else None}
def distance(a,b):
    row=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        nxt=[i]
        for j,y in enumerate(b,1):nxt.append(min(nxt[-1]+1,row[j]+1,row[j-1]+(x!=y)))
        row=nxt
    return row[-1]
def characters(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).casefold() if not c.isspace() and not unicodedata.category(c).startswith('P'))
def words(text):return re.findall(r"[a-z0-9]+(?:'[a-z]+)?",unicodedata.normalize('NFKC',text).casefold())
def verdicts(directory,name='verdicts.json'):
    rows=read(directory/name)
    return {'problems':len(rows),'passedProblems':sum(r['status']=='passed' for r in rows),'failedProblems':sum(r['status']=='failed' for r in rows),'unverifiedProblems':sum(r['status']=='unverified' for r in rows),'passedCases':sum(r.get('passed',0) for r in rows),'totalCases':sum(r.get('total',0) for r in rows)}
def resource(p):
    s=p.read_text();result={}
    m=re.search(r'([\d.]+) real\s+([\d.]+) user\s+([\d.]+) sys',s)
    if m:result.update(wallSeconds=float(m[1]),userCpuSeconds=float(m[2]),systemCpuSeconds=float(m[3]))
    for label,key in [('maximum resident set size','maxRssBytes'),('peak memory footprint','peakFootprintBytes')]:
        m=re.search(r'(\d+)\s+'+label,s)
        if m:result[key]=int(m[1])
    return result

def analyze(root):
    config=read(root/'run-manifest.json')
    def file(relative):
        p=(root/relative).resolve();p.relative_to(root);return p
    text_dir=file(config['textDirectory']);summary=read(text_dir/'summary.json');answers=[read(p) for p in sorted(text_dir.glob('*.answer.json'))]
    if len(answers)!=20:raise ValueError('The pinned primary corpus requires exactly 20 retained answers')
    network=read(file(config['networkFile']));groups=collections.defaultdict(list)
    for row in network['samples']:groups[(row['host'],row['kind'],row.get('path',''),row['connection'])].append(row)
    net=[{'host':k[0],'kind':k[1],'path':k[2],'connection':k[3],**distribution(r.get('firstByteMs',r['totalMs']) for r in rows),'failures':sum(bool(r.get('error') or r.get('errorCode') or (r.get('status') not in [200,'SERVING'])) for r in rows)} for k,rows in groups.items()]
    vision_dir=file(config['visionDirectory']);vision=read(vision_dir/'summary.json')
    http_dir=file(config['httpControlDirectory']);http=read(http_dir/'summary.json')
    audio=[];scores={'zh-basic':{'errors':0,'units':0,'observations':0},'en':{'errors':0,'units':0,'observations':0}}
    for batch in config['audio']:
        observed=read(file(batch['file']));rows=[]
        for route,reference in zip(observed['routes'],batch['references'],strict=True):
            texts=[]
            for epoch in [0,1]:
                # A final may revise an existing row; the final retained value owns that ID.
                latest={s['id']:s for s in route['segments'] if s['isFinal'] and s['captureEpoch']==epoch}
                text=''.join(s['text'] for s in sorted(latest.values(),key=lambda s:s['startMs']))
                texts.append(text)
                if batch['scoreGroup']:
                    normalize=words if batch['scoreGroup']=='en' else characters
                    a,b=normalize(reference),normalize(text);score=scores[batch['scoreGroup']]
                    score['errors']+=distance(a,b);score['units']+=len(a);score['observations']+=1
            rows.append({'reference':reference,'observedFinalsByReplay':texts,'firstInterimMsFromAudioStart':route['firstInterimMsFromAudioStart'],'firstFinalMsFromAudioStart':route['firstFinalMsFromAudioStart'],'audioDurationMs':route['input']['durationMs'],'pauseAudioBytes':route['pause']['sentAudioBytes'],'connectionSurvivedPause':route['pause']['connectionStayedOpen'],'closeCode':route['closeCode']})
        audio.append({'language':observed['language'],'model':observed['model'],'profile':observed['transcriptionProfile'],'status':observed['status'],'synthetic':True,'routes':rows})
    for name,score in scores.items():score.update(errorRate=score['errors']/score['units'],metric='WER' if name=='en' else 'CER')
    server=read(file(config['serverResourcesFile']));elapsed=server[-1]['at']-server[0]['at'];units={}
    for name in server[0]['units']:
        samples=[s['units'][name] for s in server];cpu=int(samples[-1]['CPUUsageNSec'])-int(samples[0]['CPUUsageNSec'])
        units[name]={'sampleSeconds':elapsed,'cpuSeconds':cpu/1e9,'percentOfOneCpu':cpu/1e9/elapsed*100,'observedPeakCgroupMemoryBytes':max(int(s['MemoryCurrent']) for s in samples),'mainPidStable':len({s['MainPID'] for s in samples})==1}
    result={'schemaVersion':1,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'environment':config['environment'],'primaryText':{
      'attempted':len(answers),'completed':summary['completed'],'errors':summary['errors'],'actualModels':sorted({a['model'] for a in answers}),'firstContent':summary['responseFirstContentMs'],'total':summary['responseTotalMs'],
      'fixedCases':verdicts(text_dir),'withExistingBoundaryCases':verdicts(text_dir,'verdicts-with-boundary.json'),
      'usage':{k:sum((a.get('usage') or {}).get(k,0) for a in answers) for k in ['prompt_tokens','completion_tokens','total_tokens']},
      'transportRequests':dict(collections.Counter(r['transport'] for a in answers for r in a['transportRequests'])),
      'resources':resource(file(config['textResourceFile'])),'observations':summary['results']},
      'network':net,'vision':{'completed':sum(r['success'] for r in vision['records']),'attempted':len(vision['records']),'graded':verdicts(vision_dir),'records':vision['records'],'resources':resource(file(config['visionResourceFile']))},
      'httpStreamControl':{'completed':http['completed'],'attempted':http['attemptedCases'],'graded':verdicts(http_dir),'firstContent':http['responseFirstContentMs'],'total':http['responseTotalMs'],'observations':http['results']},
      'audio':audio,'audioScores':scores,'serverResources':units,'instrumentationFailures':config['instrumentationFailures'],
      'regressionTestsPassed':config['regressionTestsPassed'],'limitations':config['limitations']}
    if config.get('costFile'):result['testCost']=read(file(config['costFile']))
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--run',type=pathlib.Path,required=True);parser.add_argument('--out',type=pathlib.Path,required=True);a=parser.parse_args()
    if a.out.exists():parser.error('Preserve the previous summary; choose a new --out')
    result=analyze(a.run.resolve());a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'primary':result['primaryText']['withExistingBoundaryCases'],'vision':result['vision']['graded'],'audioScores':result['audioScores']},ensure_ascii=False))
