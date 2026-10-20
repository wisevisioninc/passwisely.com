"""Runs only inside an OS sandbox. Input/output files are test-local."""
import collections, functools, heapq, itertools, json, math, resource, sys, typing
resource.setrlimit(resource.RLIMIT_CPU,(4,4))
resource.setrlimit(resource.RLIMIT_FSIZE,(2*1024*1024,2*1024*1024))
resource.setrlimit(resource.RLIMIT_NOFILE,(64,64))
class TreeNode:
    def __init__(self,val=0,left=None,right=None): self.val,self.left,self.right=val,left,right
def tree(values):
    if not values or values[0] is None: return None
    root=TreeNode(values[0]); queue=collections.deque([root]); i=1
    while queue and i<len(values):
        node=queue.popleft()
        for side in ['left','right']:
            if i>=len(values): break
            value=values[i]; i+=1
            if value is not None:
                child=TreeNode(value); setattr(node,side,child); queue.append(child)
    return root
data=json.load(open(sys.argv[1])); namespace={'TreeNode':TreeNode,'collections':collections,'functools':functools,'heapq':heapq,'itertools':itertools,'math':math,**vars(typing)}
code=open(sys.argv[2]).read(); exec(compile(code,'model_solution.py','exec'),namespace)
out=[]
for case in data['cases']:
    try:
        args=json.loads(json.dumps(case['args']))
        for index,p in enumerate(data['python']['params']):
            if 'TreeNode' in p['type']: args[index]=tree(args[index])
        fn=getattr(namespace['Solution'](),data['python']['method'])
        value=fn(*args)
        if data['python'].get('return',{}).get('type')=='void': value=args[0]
        out.append({'name':case['name'],'actual':value})
    except Exception as error: out.append({'name':case['name'],'error':type(error).__name__+': '+str(error)[:500]})
print('PW_RESULT:'+json.dumps(out,ensure_ascii=False))
