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
  catalog={'releaseVersion':'2.0.0','artifacts':{platform:{key:item[key] for key in ['version','revision','filename','sha256','bytes','legacy','liveAudio','notice']} for platform,item in downloads.items()}}
  self.write(self.source/'website/lib/download-artifacts.json',json.dumps(catalog))
  for item in sources:item['sha256']=m.digest(self.source/item['path'])
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
  for change in [{'version':'1.2.6','legacy':True},{'sha256':None},{'bytes':None},{'legacy':True},{'liveAudio':'pending'},{'filename':'PassWisely-macOS-arm64.dmg'},{'url':manifest['downloads']['mac-arm64']['url']},{'notice':None}]:
   value=json.loads(json.dumps(manifest));value['downloads']['mac-x64'].update(change);path.write_text(json.dumps(value));args.manifest_sha256=m.digest(path)
   with self.subTest(change=change),self.assertRaises(m.DeployError):m.validate_manifest(args)
 def save_manifest(self,args,manifest,source_catalog=False):
  if source_catalog:
   catalog={'releaseVersion':'2.0.0','artifacts':{platform:{key:item[key] for key in ['version','revision','filename','sha256','bytes','legacy','liveAudio','notice']} for platform,item in manifest['downloads'].items()}}
   self.write(self.source/'website/lib/download-artifacts.json',json.dumps(catalog))
   for item in manifest['sourceFiles']:item['sha256']=m.digest(self.source/item['path'])
  Path(args.manifest).write_text(json.dumps(manifest));args.manifest_sha256=m.digest(args.manifest)
 def add_broker(self,manifest):
  existing={item['path'] for item in manifest['sourceFiles']}
  for name in sorted(m.BROKER_RELEASE_PATHS-existing):
   source=self.write(self.source/name,'broker source fixture '+name);manifest['sourceFiles'].append({'path':name,'sha256':m.digest(source)})
 def test_intel_catalog_accepts_explicit_r3_without_audio_and_new_r4_with_audio_facts(self):
  args,manifest,_=self.fixture();self.assertEqual(m.validate_manifest(args)[0]['downloads']['mac-x64']['liveAudio'],'not_included')
  intel=manifest['downloads']['mac-x64'];intel.update(revision=4,liveAudio='included',sha256='c'*64,bytes=5678,notice={'zh':'Intel 原生音频说明','en':'Intel native audio facts'})
  intel['url']=intel['url'].replace('/r2/','/r4/')
  self.save_manifest(args,manifest,source_catalog=True)
  self.assertEqual(m.validate_manifest(args)[0]['downloads']['mac-x64']['liveAudio'],'included')
  intel['notice']=None;self.save_manifest(args,manifest,source_catalog=True);m.validate_manifest(args)
 def test_manifest_download_facts_cannot_disagree_with_the_pinned_public_source_catalog(self):
  args,manifest,_=self.fixture()
  for change in [{'sha256':'c'*64},{'bytes':5678},{'liveAudio':'included'},{'notice':{'zh':'不同事实','en':'Different facts'}}]:
   changed=json.loads(json.dumps(manifest));changed['downloads']['mac-x64'].update(change);self.save_manifest(args,changed)
   with self.subTest(change=change),self.assertRaisesRegex(m.DeployError,'catalog differs from pinned source'):m.validate_manifest(args)
 def test_broker_provenance_is_all_or_none_and_adds_only_the_reviewed_source_paths(self):
  args,manifest,_=self.fixture();self.assertFalse(m.has_deepgram_broker(manifest))
  self.add_broker(manifest);self.save_manifest(args,manifest)
  self.assertTrue(m.has_deepgram_broker(m.validate_manifest(args)[0]))
  expected={'website/lib/deepgram.ts','website/app/api/desktop/deepgram/token/route.ts','website/tests/deepgram-token.test.mjs','website/tests/recall-upload.test.mjs','shared/captureSession.ts','electron/live/transcription.ts'}
  self.assertEqual(m.BROKER_RELEASE_PATHS,expected)
  self.assertTrue(expected<=m.DOWNLOAD_ONLY_PATHS)
  self.assertNotIn('website/app/api/payments/wechat/notify/route.ts',m.DOWNLOAD_ONLY_PATHS)
  self.assertNotIn('desktop-api/server.mjs',m.DOWNLOAD_ONLY_PATHS)
  partial=json.loads(json.dumps(manifest));partial['sourceFiles']=[item for item in partial['sourceFiles'] if item['path']!='shared/captureSession.ts'];self.save_manifest(args,partial)
  with self.assertRaisesRegex(m.DeployError,'Incomplete Deepgram'):m.validate_manifest(args)
 def test_health_uses_catalog_notice_and_probes_deepgram_only_when_present(self):
  _,manifest,_=self.fixture();downloads=manifest['downloads'];calls=[]
  downloads['mac-x64'].update(liveAudio='included',notice={'zh':'Intel 支持原生音频','en':'Native audio is available for Intel'})
  def response(base,path,method='HEAD',payload=None):
   calls.append((path,method,payload))
   if path=='/':return 200,{},'pw-hero-title 2.0.0 '+downloads['windows-x64']['notice']['en']+' '+downloads['mac-x64']['notice']['en']
   if path=='/api/download/__proto__':return 404,{},''
   if path.startswith('/api/download/'):
    item=downloads[path.rsplit('/',1)[1]];return 307,{'Location':item['url'],'x-passwisely-release-version':item['version'],'x-passwisely-artifact-sha256':item['sha256']},''
   if path=='/api/checkout' and method=='GET':return 405,{},''
   return 401,{},''
  with patch.object(m,'response',side_effect=response),patch.object(m,'verify_pricing',return_value={}):
   old=m.health_once('http://127.0.0.1:3011',downloads)
   self.assertNotIn('unauthenticatedDeepgram',old);self.assertFalse(any(row[0]==m.DEEPGRAM_ROUTE for row in calls))
   calls.clear();new=m.health_once('http://127.0.0.1:3011',downloads,include_deepgram=True)
   self.assertEqual(new['unauthenticatedDeepgram'],401);self.assertEqual(new['providerCalls'],0)
   self.assertIn((m.DEEPGRAM_ROUTE,'POST',None),calls)
  def absent(base,path,method='HEAD',payload=None):return (404,{},'') if path==m.DEEPGRAM_ROUTE else response(base,path,method,payload)
  with patch.object(m,'response',side_effect=absent),patch.object(m,'verify_pricing',return_value={}):
   with self.assertRaises(m.ProbeError) as error:m.health_once('http://127.0.0.1:3011',downloads,include_deepgram=True)
  self.assertEqual(error.exception.diagnostic['path'],m.DEEPGRAM_ROUTE)
 def test_source_pin_requires_detached_clean_download_only_history(self):
  args,manifest,_=self.fixture();self.add_broker(manifest)
  def command(argv,**kwargs):
   if argv[0]=='git' and argv[2]==str(self.repo):return 'b'*40
   if 'rev-parse' in argv:return 'HEAD' if '--abbrev-ref' in argv else 'a'*40
   if 'rev-list' in argv:return 'a'*40
   if '--name-only' in argv:return '\n'.join(['website/lib/download-artifacts.json',*sorted(m.BROKER_RELEASE_PATHS)])
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
 def test_current_public_cn_origin_is_preserved_in_transport_diagnostics(self):
  self.assertEqual(m.PUBLIC_BASE,'https://passwisely.cn')
  self.assertEqual(m.probe_context(m.PUBLIC_BASE,'/api/download/mac-x64','HEAD','open')['base'],'https://passwisely.cn')
  self.assertEqual(m.probe_context('http://47.95.66.86','/api/download/mac-x64','HEAD','open')['base'],'unrecognized')
 def test_cn_domain_scope_adds_only_exact_reviewed_paths_and_keeps_payment_excluded(self):
  expected={'website/lib/public-site.ts','website/app/layout.tsx','website/.env.example','website/README.md','website/tests/public-site-origin.test.mjs','website/tests/live-account.mjs','website/tests/live-ai.mjs','website/tests/live-ai-vision.mjs'}
  self.assertEqual(m.CN_DOMAIN_RELEASE_PATHS,expected)
  self.assertTrue(expected<=m.DOWNLOAD_ONLY_PATHS)
  self.assertNotIn('website/app/api/checkout/route.ts',m.DOWNLOAD_ONLY_PATHS)
  self.assertNotIn('website/app/api/payments/wechat/notify/route.ts',m.DOWNLOAD_ONLY_PATHS)
  self.assertEqual(m.PENDING_COMMIT,'35a12a339567fe4c5435b9db3e7a169d664f8f14')
 def test_home_performance_scope_adds_exact_views_and_tests_without_payment_authority(self):
  expected={'website/app/PassWiselySite.tsx','website/app/DeferredViewBoundary.tsx','website/tests/helpers/lazy-components.mjs','website/tests/lazy-views.test.mjs','website/tests/fixtures/lazy-import-failure.tsx','website/tests/verify-lazy-failures.mjs'}
  self.assertEqual(m.HOME_PERFORMANCE_RELEASE_PATHS,expected)
  self.assertTrue(expected<=m.DOWNLOAD_ONLY_PATHS)
  args,manifest,_=self.fixture()
  def command(argv,**kwargs):
   if argv[0]=='git' and argv[2]==str(self.repo):return 'b'*40
   if 'rev-parse' in argv:return 'HEAD' if '--abbrev-ref' in argv else 'a'*40
   if 'rev-list' in argv:return 'a'*40
   if '--name-only' in argv:return '\n'.join(['website/lib/download-artifacts.json',*sorted(expected)])
   if 'ls-files' in argv:return '\n'.join(row['path'] for row in manifest['sourceFiles'])
   return ''
  with patch.object(m,'command',side_effect=command),patch.object(m,'live_unit_pin'):
   m.source_preflight(args,manifest)
  for name in ['website/app/api/checkout/route.ts','website/app/api/payments/wechat/notify/route.ts','website/lib/payments/config.ts','website/lib/payments/catalog.ts','website/.env.production','desktop-api/server.mjs']:
   self.assertNotIn(name,m.DOWNLOAD_ONLY_PATHS)
  self.assertEqual(m.PENDING_COMMIT,'35a12a339567fe4c5435b9db3e7a169d664f8f14')
 def test_kimi_model_release_scope_accepts_exact_server_policy_without_configuration_or_payment_authority(self):
  expected={'shared/kimi.ts','website/lib/ai-catalog.ts','website/app/api/ai/chat/completions/route.ts','website/app/api/resume/agents/route.ts','website/tests/kimi-model.test.mjs','website/tests/ai-provider-fallback.test.mjs'}
  self.assertEqual(m.KIMI_MODEL_RELEASE_PATHS,expected)
  self.assertTrue(expected<=m.DOWNLOAD_ONLY_PATHS)
  args,manifest,_=self.fixture()
  def command(argv,**kwargs):
   if argv[0]=='git' and argv[2]==str(self.repo):return 'b'*40
   if 'rev-parse' in argv:return 'HEAD' if '--abbrev-ref' in argv else 'a'*40
   if 'rev-list' in argv:return 'a'*40
   if '--name-only' in argv:return '\n'.join(['website/lib/download-artifacts.json',*sorted(expected)])
   if 'ls-files' in argv:return '\n'.join(row['path'] for row in manifest['sourceFiles'])
   return ''
  with patch.object(m,'command',side_effect=command),patch.object(m,'live_unit_pin'):
   m.source_preflight(args,manifest)
  excluded=['website/app/api/checkout/route.ts','website/app/api/payments/alipay/notify/route.ts','website/app/api/payments/wechat/notify/route.ts','website/lib/ai-config.ts','website/lib/payments/config.ts','website/.env.production','electron/aiProviders.ts','electron/ProcessingHelper.ts','desktop-api/server.mjs']
  for name in excluded:
   self.assertNotIn(name,m.DOWNLOAD_ONLY_PATHS)
   def unauthorized(argv,**kwargs):
    return '\n'.join(['website/lib/download-artifacts.json',name]) if '--name-only' in argv else command(argv,**kwargs)
   with self.subTest(path=name),patch.object(m,'command',side_effect=unauthorized),patch.object(m,'live_unit_pin'),self.assertRaisesRegex(m.DeployError,'reviewed release scope'):
    m.source_preflight(args,manifest)
  self.assertEqual(m.PENDING_COMMIT,'35a12a339567fe4c5435b9db3e7a169d664f8f14')
 def test_compatibility_ui_scope_accepts_only_reviewed_explanation_and_eight_brand_icons(self):
  expected={'website/app/LandingPrivacy.tsx',*[f'website/public/compatibility-icons/{name}' for name in ['microsoft-teams.ico','zoom.ico','google-meet.png','amazon-chime.png','lark-feishu.png','hackerrank.png','coderpad.png','codility.ico']]}
  self.assertEqual(m.COMPATIBILITY_UI_RELEASE_PATHS,expected)
  self.assertEqual(len(expected),9)
  self.assertTrue(expected<=m.DOWNLOAD_ONLY_PATHS)
  args,manifest,_=self.fixture()
  def command(argv,**kwargs):
   if argv[0]=='git' and argv[2]==str(self.repo):return 'b'*40
   if 'rev-parse' in argv:return 'HEAD' if '--abbrev-ref' in argv else 'a'*40
   if 'rev-list' in argv:return 'a'*40
   if '--name-only' in argv:return '\n'.join(['website/lib/download-artifacts.json',*sorted(expected)])
   if 'ls-files' in argv:return '\n'.join(row['path'] for row in manifest['sourceFiles'])
   return ''
  with patch.object(m,'command',side_effect=command),patch.object(m,'live_unit_pin'):
   m.source_preflight(args,manifest)
  excluded=['website/public/compatibility-icons/webex.png','website/public/compatibility-icons/unreviewed.svg','website/public/unrelated.js','website/app/api/checkout/route.ts','website/app/api/payments/wechat/notify/route.ts','website/lib/ai-config.ts','website/.env.production','desktop-api/server.mjs']
  for name in excluded:
   self.assertNotIn(name,m.DOWNLOAD_ONLY_PATHS)
   def unauthorized(argv,**kwargs):
    return '\n'.join(['website/lib/download-artifacts.json',name]) if '--name-only' in argv else command(argv,**kwargs)
   with self.subTest(path=name),patch.object(m,'command',side_effect=unauthorized),patch.object(m,'live_unit_pin'),self.assertRaisesRegex(m.DeployError,'reviewed release scope'):
    m.source_preflight(args,manifest)
  self.assertFalse(any('*' in name or name.endswith('/') for name in m.COMPATIBILITY_UI_RELEASE_PATHS))
  self.assertEqual(m.PENDING_COMMIT,'35a12a339567fe4c5435b9db3e7a169d664f8f14')
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

 def test_active_tree_pin_is_caller_selected_and_drift_refuses_without_writes(self):
  args,_,_=self.fixture();self.write(self.website/'dist/server/index.js','active ec04 fixture');self.binding(self.website/'dist')
  nginx=self.write(self.root/'nginx','unchanged nginx');args.operation='plan';args.source_repo=str(self.source)
  args.expected_active_tree='0'*64;args.expected_nginx_sha256=m.digest(nginx)
  with patch.object(m,'NGINX',nginx),patch.object(m,'parse',return_value=args),patch.object(m.sys,'platform','linux'),patch.object(m.os,'geteuid',return_value=0),patch.object(m,'source_preflight'),patch.object(m,'configuration_probe') as probe:
   with self.assertRaisesRegex(m.DeployError,'runtime fingerprint changed'):m.main()
   probe.assert_not_called()
  self.assertFalse((self.website/'.release-activation.lock').exists());self.assertFalse((self.website/'.release-backups').exists())

if __name__=='__main__':unittest.main()
