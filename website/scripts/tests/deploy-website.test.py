import argparse, contextlib, hashlib, importlib.util, io, json, os, subprocess, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('owner',Path(__file__).resolve().parents[1]/'deploy-website.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ReleaseTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name).resolve()
  self.repo=self.root/'live';self.website=self.repo/'website';self.website.mkdir(parents=True)
  self.source=self.root/'sources/download-only';self.source.mkdir(parents=True)
  self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
  for name,value in {'REPO':self.repo,'WEBSITE':self.website,'SOURCE_REPO':self.source,'SOURCE_BASE':self.root/'sources','_PRESERVED_BINDING':None,'_BINDING_INFO':None}.items():self.stack.enter_context(patch.object(m,name,value))
  self.stack.enter_context(patch.object(m.pwd,'getpwnam',return_value=SimpleNamespace(pw_uid=os.getuid(),pw_gid=os.getgid())))
 def write(self,path,data):
  path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data if isinstance(data,bytes) else data.encode());return path
 def binding(self,directory,value=b'FIXTURE="preserved-value"\n'):
  p=self.write(directory/'server/.dev.vars',value);p.chmod(0o600);return p
 def fixture(self):
  candidate=self.website/'.release-candidates/release/dist'
  self.write(candidate/'server/index.js','compiled fixture');self.write(candidate/'server/wrangler.json','{"main":"index.js","assets":{"directory":"../client"}}')
  required=['package.json','website/lib/download-artifacts.json','website/lib/downloads.ts','electron/live/transcription.ts','website/scripts/stage-runtime-env.mjs','website/lib/recall.ts','website/app/api/desktop/recall/upload-token/route.ts']
  sources=[]
  for name in required:
   p=self.write(self.source/name,'source fixture '+name);sources.append({'path':name,'sha256':m.digest(p)})
  downloads={}
  for platform,name in [('mac-arm64','PassWisely-macOS-arm64.dmg'),('mac-x64','PassWisely-macOS-x64.dmg'),('windows-x64','PassWisely-Windows-x64.exe')]:
   downloads[platform]={'platform':platform,'version':'2.0.0','revision':2,'filename':name,'sha256':'a'*64,'bytes':1234,'legacy':False,'available':True,'liveAudio':'not_included' if platform=='mac-x64' else 'included','notice':{'zh':'安装限制','en':'Installer limitation'},'url':'https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v2.0.0/r2/'+name}
  files=m.file_tree(candidate);manifest={'schemaVersion':1,'releaseVersion':'2.0.0','credentialsIncluded':False,'sourceCommit':'a'*40,'files':files,'treeFingerprint':m.fingerprint(files),'sourceFiles':sources,'downloads':downloads}
  path=candidate.parent/'web-manifest.json';self.write(path,json.dumps(manifest))
  args=argparse.Namespace(candidate_dist=str(candidate),manifest=str(path),manifest_sha256=m.digest(path),expected_current_commit='a'*40,expected_live_commit='b'*40)
  return args,manifest,candidate
 def test_manifest_uses_independent_source_worktree_and_rejects_source_drift(self):
  args,manifest,_=self.fixture();self.write(self.repo/'website/lib/download-artifacts.json','unpublished main checkout remains different')
  self.assertEqual(m.validate_manifest(args)[0]['sourceCommit'],'a'*40)
  self.write(self.source/'website/lib/download-artifacts.json','source drift')
  with self.assertRaisesRegex(m.DeployError,'Source file drift'):m.validate_manifest(args)
 def test_v2_intel_contract_rejects_legacy_unverified_wrong_arch_and_audio_claims(self):
  args,manifest,_=self.fixture();path=Path(args.manifest)
  for change in [{'version':'1.2.6','legacy':True},{'sha256':None},{'bytes':None},{'legacy':True},{'liveAudio':'included'},{'filename':'PassWisely-macOS-arm64.dmg'},{'url':manifest['downloads']['mac-arm64']['url']},{'notice':None}]:
   value=json.loads(json.dumps(manifest));value['downloads']['mac-x64'].update(change);path.write_text(json.dumps(value));args.manifest_sha256=m.digest(path)
   with self.subTest(change=change),self.assertRaises(m.DeployError):m.validate_manifest(args)
 def test_source_pin_requires_detached_clean_download_only_history(self):
  args,manifest,_=self.fixture()
  def command(argv,**kwargs):
   if argv[0]=='git' and argv[2]==str(self.repo):return 'b'*40
   if 'rev-parse' in argv:return 'HEAD' if '--abbrev-ref' in argv else 'a'*40
   if 'rev-list' in argv:return 'a'*40
   if '--name-only' in argv:return 'website/lib/download-artifacts.json'
   if 'ls-files' in argv:return '\n'.join(row['path'] for row in manifest['sourceFiles'])
   return ''
  with patch.object(m,'command',side_effect=command),patch.object(m,'live_unit_pin'):
   m.source_preflight(args,manifest)
   for selector,value in [('source','c'*40),('branch','main'),('history',m.PENDING_COMMIT),('scope','website/app/api/checkout/route.ts'),('live','c'*40)]:
    def bad(argv,**kwargs):
     if selector=='source' and argv[2]==str(self.source) and 'rev-parse' in argv and '--abbrev-ref' not in argv:return value
     if selector=='branch' and '--abbrev-ref' in argv:return value
     if selector=='history' and 'rev-list' in argv:return value
     if selector=='scope' and '--name-only' in argv:return value
     if selector=='live' and argv[2]==str(self.repo):return value
     return command(argv,**kwargs)
    with self.subTest(selector=selector),patch.object(m,'command',side_effect=bad),self.assertRaises(m.DeployError):m.source_preflight(args,manifest)
 def test_effective_working_directory_and_dropins_are_pinned_to_live_service(self):
  unit=self.write(self.root/'unit','known unit')
  fields={'WorkingDirectory':str(self.website),'User':'jerry','ActiveState':'active','FragmentPath':str(unit),'DropInPaths':''}
  with patch.object(m,'LIVE_UNIT',unit),patch.object(m,'LIVE_UNIT_SHA',m.digest(unit)):
   with patch.object(m,'command',return_value='\n'.join(k+'='+v for k,v in fields.items())):m.live_unit_pin()
   for key,value in [('WorkingDirectory',str(self.source/'website')),('DropInPaths','/unexpected/override.conf')]:
    changed={**fields,key:value}
    with patch.object(m,'command',return_value='\n'.join(k+'='+v for k,v in changed.items())),self.assertRaises(m.DeployError):m.live_unit_pin()
   missing={k:v for k,v in fields.items() if k!='DropInPaths'}
   with patch.object(m,'command',return_value='\n'.join(k+'='+v for k,v in missing.items())),self.assertRaises(m.DeployError):m.live_unit_pin()
 def test_dashboard_changes_are_download_scope_and_pending_merge_ancestor_is_rejected_by_real_git(self):
  for name in ['website/app/dashboard/Dashboard.tsx','website/app/dashboard/dashboard.css','website/tests/dashboard-navigation.test.mjs','website/tests/admin-observability.test.mjs']:
   self.assertIn(name,m.DOWNLOAD_ONLY_PATHS)
  def git(*args,allow_failure=False):
   result=subprocess.run(['git','-C',str(self.source),'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false',*args],capture_output=True,text=True)
   if not allow_failure:self.assertEqual(result.returncode,0,result.stderr)
   return result.stdout.strip(),result.returncode
  git('init','-q');manifest_path=self.write(self.source/'website/lib/download-artifacts.json','base\n');git('add','.');git('commit','-qm','base');base,_=git('rev-parse','HEAD')
  git('checkout','-qb','pending');manifest_path.write_text('pending\n');git('commit','-qam','pending');pending,_=git('rev-parse','HEAD')
  git('checkout','-qb','download',base);manifest_path.write_text('download\n');git('commit','-qam','download')
  _,status=git('merge','--no-ff','--no-commit','pending',allow_failure=True);self.assertEqual(status,1)
  manifest_path.write_text('download\n');git('add','.');git('commit','-qm','merge pending with download content');merged,_=git('rev-parse','HEAD');git('checkout','--detach','-q',merged)
  manifest={'sourceFiles':[{'path':'website/lib/download-artifacts.json'}]};args=argparse.Namespace(expected_current_commit=merged,expected_live_commit='b'*40)
  def read_command(argv,**kwargs):
   self.assertEqual(argv[:3],['git','-C',str(self.source)])
   result=subprocess.run(argv,capture_output=True,text=True)
   if result.returncode:raise m.DeployError('Git boundary failed.')
   return result.stdout
  with patch.object(m,'BASE_COMMIT',base),patch.object(m,'PENDING_COMMIT',pending),patch.object(m,'command',side_effect=read_command),patch.object(m,'live_source_pin'):
   with self.assertRaisesRegex(m.DeployError,'Unpublished WeChat'):m.source_preflight(args,manifest)
 def test_current_public_ip_is_preserved_in_transport_diagnostics(self):
  self.assertEqual(m.probe_context(m.PUBLIC_BASE,'/api/download/mac-x64','HEAD','open')['base'],'http://47.95.66.86')
 def test_preserves_runtime_binding_bytes_without_staging_current_configuration(self):
  active=self.website/'dist';binding=self.binding(active);original=binding.read_bytes()
  env=self.write(self.website/'.env.production','PENDING_CONFIGURATION="not-staged"\n');before=env.read_bytes()
  with patch.object(m,'command',side_effect=AssertionError('No config staging or child command is authorized')):
   info=m.configuration_probe();self.assertFalse(info['sourceEnvironmentRead']);binding.unlink()
   m.fresh_production_bindings();self.assertEqual(binding.read_bytes(),original);self.assertEqual(env.read_bytes(),before)
   binding.write_bytes(b'FIXTURE="drift"\n')
   with self.assertRaisesRegex(m.DeployError,'bindings changed'):m.configuration_probe(True)
 def rollback_fixture(self):
  current=self.website/'dist';retained=self.website/'.release-candidates/release/dist'
  self.write(current/'server/index.js','new runtime');self.write(retained/'server/index.js','old runtime')
  self.binding(current);self.binding(retained);binding_info=m.read_runtime_binding(retained/'server/.dev.vars')[1]
  nginx=self.write(self.root/'nginx','unchanged nginx');backup=self.root/'backup';self.write(backup/'nginx.before.conf','unchanged nginx')
  state={'status':'active','retainedRuntime':str(retained),'oldFingerprint':m.fingerprint(m.file_tree(retained,True)),'newFingerprint':m.fingerprint(m.file_tree(current,True)),'oldNginxSha256':m.digest(nginx),'newNginxSha256':m.digest(nginx),'nginxBackup':str(backup/'nginx.before.conf'),'nginxMode':0o644,'nginxUid':os.getuid(),'nginxGid':os.getgid(),'ownerUid':os.getuid(),'ownerGid':os.getgid(),'bindingBefore':binding_info,'liveSourceCommit':'b'*40,'webTouched':True,'stopRequested':True,'nginxInstalled':False,'baselineHealth':[]}
  return current,retained,nginx,backup/'transaction.json',state
 def test_rollback_restores_old_runtime_and_binding_and_retains_failed_candidate(self):
  current,retained,nginx,journal,state=self.rollback_fixture();old_inode=retained.stat().st_ino;commands=[]
  def exchange(a,b):
   # Simulate only the Linux atomic primitive. Real file identities/content/journal are exercised.
   swap=a.with_name('exchange');a.rename(swap);b.rename(a);swap.rename(b)
  with patch.object(m,'NGINX',nginx),patch.object(m,'command',side_effect=lambda args,**kw:commands.append(args) or ''),patch.object(m,'exchange',side_effect=exchange),patch.object(m,'live_source_pin'):
   self.assertEqual(m.rollback(state,journal),[])
  self.assertEqual(state['status'],'rolled_back');self.assertEqual(current.stat().st_ino,old_inode)
  self.assertEqual((current/'server/index.js').read_text(),'old runtime');self.assertEqual((retained/'server/index.js').read_text(),'new runtime')
  self.assertEqual([cmd[:2] for cmd in commands if cmd[:2] in [['systemctl','stop'],['systemctl','start'],['systemctl','reload']]],[['systemctl','stop'],['systemctl','start']])
  self.assertEqual(json.loads(journal.read_text())['bindingBefore'],state['bindingBefore'])
 def test_corrupted_retained_binding_refuses_rollback_before_stopping_or_exchanging(self):
  current,retained,nginx,journal,state=self.rollback_fixture();(retained/'server/.dev.vars').write_bytes(b'CHANGED="binding"\n')
  with patch.object(m,'NGINX',nginx),patch.object(m,'command',return_value='') as command,patch.object(m,'exchange') as exchange:
   self.assertTrue(m.rollback(state,journal));exchange.assert_not_called()
   self.assertFalse(any(call.args[0][:2] in [['systemctl','stop'],['systemctl','start'],['systemctl','reload']] for call in command.call_args_list))
  self.assertEqual((current/'server/index.js').read_text(),'new runtime');self.assertEqual(state['status'],'rollback_incomplete')
 def test_plan_writes_no_lock_backup_or_runtime_and_returns_no_binding_values(self):
  args,_,_=self.fixture();self.write(self.website/'dist/server/index.js','old runtime');self.binding(self.website/'dist')
  nginx=self.write(self.root/'nginx','unchanged nginx');args.operation='plan';args.source_repo=str(self.source)
  args.expected_active_tree=m.fingerprint(m.file_tree(self.website/'dist',True));args.expected_nginx_sha256=m.digest(nginx)
  with patch.object(m,'NGINX',nginx),patch.object(m,'parse',return_value=args),patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'source_preflight'),contextlib.redirect_stdout(io.StringIO()) as output:
   m.main()
  report=json.loads(output.getvalue());self.assertEqual(report['phase'],'read_only_plan');self.assertEqual(report['productionFileWrites'],0)
  self.assertNotIn('preserved-value',output.getvalue());self.assertFalse((self.website/'.release-activation.lock').exists());self.assertFalse((self.website/'.release-backups').exists())

if __name__=='__main__':unittest.main()
