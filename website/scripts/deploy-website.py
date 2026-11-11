#!/usr/bin/env python3
"""Reviewed-plan implementation. DOES NOT RUN unless explicitly invoked.
Only the existing Wise web runtime from an independently pinned source worktree.
Preserve active bindings exactly; no Nginx, source HEAD, DB or desktop changes.
"""
import argparse,contextlib,ctypes,errno,fcntl,hashlib,html,http.client,json,os,pwd,re,signal,socket,ssl,stat,subprocess,sys,tempfile,time,urllib.request,urllib.error,uuid
from html.parser import HTMLParser
from pathlib import Path,PurePosixPath

REPO=Path('/home/jerry/codebase/passwisely'); WEBSITE=REPO/'website'
NGINX=Path('/etc/nginx/sites-available/passwisely.com')
SOURCE_REPO=None
SOURCE_BASE=Path('/home/jerry/.passwisely-private/source-worktrees')
BASE_COMMIT='d48cc7dcc551f1533bcee2573b374fa2fb68872b'
PENDING_COMMIT='35a12a339567fe4c5435b9db3e7a169d664f8f14'
LIVE_UNIT=Path('/etc/systemd/system/passwisely-web.service')
LIVE_UNIT_SHA='62fc334603d7db85cadb993e760d1f7a0b84c42a42ea35fd608d0328ee9feef9'
PUBLIC_BASE='https://passwisely.cn'
DOWNLOAD_ONLY_PATHS={
 'website/app/LandingPage.tsx','website/app/landing.css',
 'website/app/dashboard/Dashboard.tsx','website/app/dashboard/dashboard.css','website/tests/dashboard-navigation.test.mjs','website/tests/admin-observability.test.mjs',
 'website/lib/download-artifacts.json','website/lib/downloads.ts','website/lib/download-platform.ts',
 'website/tests/oss-download.test.mjs','website/tests/download-platform.test.mjs','website/tests/pricing-checkout.test.mjs',
 'website/README.md','website/scripts/deploy-website.py','website/scripts/tests/deploy-website.test.py',
}
# The release branch may contain only these additional broker/profile changes.
BROKER_RELEASE_PATHS={
 'website/lib/deepgram.ts','website/app/api/desktop/deepgram/token/route.ts',
 'website/tests/deepgram-token.test.mjs','website/tests/recall-upload.test.mjs',
 'shared/captureSession.ts','electron/live/transcription.ts',
}
DOWNLOAD_ONLY_PATHS |= BROKER_RELEASE_PATHS
# This exact domain-only change is layered on the active isolated release.
# It does not admit checkout, payment configuration, or pending WeChat changes.
CN_DOMAIN_RELEASE_PATHS={
 'website/lib/public-site.ts','website/app/layout.tsx','website/.env.example','website/README.md',
 'website/tests/public-site-origin.test.mjs','website/tests/live-account.mjs',
 'website/tests/live-ai.mjs','website/tests/live-ai-vision.mjs',
}
DOWNLOAD_ONLY_PATHS |= CN_DOMAIN_RELEASE_PATHS
# Public-home code splitting and its local recovery/verification only.
# This does not widen payment routes, configuration or pending WeChat authority.
HOME_PERFORMANCE_RELEASE_PATHS={
 'website/app/PassWiselySite.tsx','website/app/DeferredViewBoundary.tsx',
 'website/tests/helpers/lazy-components.mjs','website/tests/lazy-views.test.mjs',
 'website/tests/fixtures/lazy-import-failure.tsx','website/tests/verify-lazy-failures.mjs',
}
DOWNLOAD_ONLY_PATHS |= HOME_PERFORMANCE_RELEASE_PATHS
# Compatibility claims, their existing privacy explanation and exact public
# brand icons only. No public-directory wildcard or backend authority is added.
COMPATIBILITY_UI_RELEASE_PATHS={
 'website/app/LandingPrivacy.tsx',
 'website/public/compatibility-icons/microsoft-teams.ico',
 'website/public/compatibility-icons/zoom.ico',
 'website/public/compatibility-icons/google-meet.png',
 'website/public/compatibility-icons/amazon-chime.png',
 'website/public/compatibility-icons/lark-feishu.png',
 'website/public/compatibility-icons/hackerrank.png',
 'website/public/compatibility-icons/coderpad.png',
 'website/public/compatibility-icons/codility.ico',
}
DOWNLOAD_ONLY_PATHS |= COMPATIBILITY_UI_RELEASE_PATHS
# Shared Kimi request parameters and server defaults only. Desktop settings,
# production configuration and payment changes remain outside this release.
KIMI_MODEL_RELEASE_PATHS={
 'shared/kimi.ts','website/lib/ai-catalog.ts',
 'website/app/api/ai/chat/completions/route.ts','website/app/api/resume/agents/route.ts',
 'website/tests/kimi-model.test.mjs','website/tests/ai-provider-fallback.test.mjs',
}
DOWNLOAD_ONLY_PATHS |= KIMI_MODEL_RELEASE_PATHS
# Explicitly authorized Native checkout activation; configuration stays with its existing owner.
WECHAT_CHANNEL_RELEASE_PATHS = {'website/app/api/payments/wechat/notify/route.ts', 'website/app/api/checkout/route.ts', 'website/tests/wechat-protocol.test.mjs', 'website/app/PassWiselySite.tsx', 'website/lib/payments/catalog.ts', 'website/tests/public-site-origin.test.mjs', 'website/tests/pricing-checkout.test.mjs'}
DOWNLOAD_ONLY_PATHS |= WECHAT_CHANNEL_RELEASE_PATHS
BROKER_SOURCE_PATHS={'website/lib/deepgram.ts','website/app/api/desktop/deepgram/token/route.ts','shared/captureSession.ts'}
DEEPGRAM_ROUTE='/api/desktop/deepgram/token'
_PRESERVED_BINDING=None
_BINDING_INFO=None
NODE='/home/jerry/.nvm/versions/node/v22.15.0/bin/node'
WEB='passwisely-web.service';PLATFORMS=('mac-arm64','mac-x64','windows-x64')
class DeployError(Exception): pass

def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for part in iter(lambda:stream.read(1024*1024),b''):h.update(part)
 return h.hexdigest()
def check(condition,message):
 if not condition:raise DeployError(message)
def canonical_path(path):
 p=Path(path).absolute();check(p.resolve()==p,'Symlink path is not accepted.');return p

def forbidden(path):
 return any(part=='.env' or part.startswith('.env.') or part in {'.dev.vars','.wise-data','.git','node_modules'} for part in path.parts)
def forbidden_source(path):
 # This exact Git-tracked inert template participates in source provenance.
 # It remains forbidden in a compiled runtime candidate and is never loaded.
 return forbidden(path) and str(path)!='website/.env.example'
def safe_relative(value):
 check(isinstance(value,str) and value and not any(c in value for c in '\t\r\n\0'),'Invalid manifest path.')
 p=PurePosixPath(value);check(not p.is_absolute() and str(p)==value and not any(x in {'.','..'} for x in p.parts),'Invalid manifest path.');return p

def file_tree(directory,allow_runtime_binding=False):
 result=[]
 for root,dirs,files in os.walk(directory,followlinks=False):
  for name in dirs+files:
   path=Path(root)/name;rel=PurePosixPath(path.relative_to(directory).as_posix())
   check(not path.is_symlink(),'Unexpected runtime symlink.')
   if allow_runtime_binding and str(rel)=='server/.dev.vars':continue
   check(not forbidden(rel),'Environment/data entry is not accepted in a web candidate.')
   if path.is_dir():continue
   check(path.is_file() and stat.S_ISREG(path.stat().st_mode),'Unexpected non-regular runtime entry.')
   safe_relative(str(rel));result.append({'path':str(rel),'bytes':path.stat().st_size,'sha256':digest(path)})
 return sorted(result,key=lambda item:item['path'])
def fingerprint(files):
 return hashlib.sha256('\n'.join(f"{x['path']}\t{x['bytes']}\t{x['sha256']}" for x in files).encode()).hexdigest()

def command(argv,timeout=30,as_jerry=False):
 if as_jerry:argv=['sudo','-u','jerry','env','-i','PATH=/home/jerry/.nvm/versions/node/v22.15.0/bin:/usr/local/bin:/usr/bin:/bin',*argv]
 try:p=subprocess.run(argv,cwd=WEBSITE,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 except (OSError,subprocess.TimeoutExpired):raise DeployError('Command did not complete: '+Path(argv[-1]).name)
 if p.returncode:raise DeployError('Command failed: '+(' '.join(argv[:3]) if not as_jerry else 'production configuration/build helper'))
 return p.stdout

def write_private(path,data,uid,gid):
 fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno());os.fchown(stream.fileno(),uid,gid)
def replace_atomic(path,data,mode,uid,gid):
 fd,name=tempfile.mkstemp(prefix='.'+path.name+'.pw-',dir=path.parent)
 try:
  with os.fdopen(fd,'wb') as stream:stream.write(data);stream.flush();os.fsync(stream.fileno());os.fchmod(stream.fileno(),mode);os.fchown(stream.fileno(),uid,gid)
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)

def exchange(a,b):
 check(a.is_dir() and b.is_dir() and not a.is_symlink() and not b.is_symlink(),'Exchange requires real directories.')
 check(a.stat().st_dev==b.stat().st_dev,'Exchange requires one filesystem.')
 libc=ctypes.CDLL(None,use_errno=True)
 check(hasattr(libc,'renameat2'),'renameat2 unavailable; no non-atomic fallback attempted.')
 fn=libc.renameat2;fn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];fn.restype=ctypes.c_int
 if fn(-100,os.fsencode(a),-100,os.fsencode(b),2):raise DeployError('Atomic directory exchange failed; errno '+str(ctypes.get_errno()))

@contextlib.contextmanager
def critical():
 previous=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGINT,signal.SIGTERM})
 try:yield
 finally:signal.pthread_sigmask(signal.SIG_SETMASK,previous)

def remove_download_locations(text):
 pattern=r'(?m)^    location = /api/download/(?:mac-arm64|mac-x64|windows-x64) \{\n        return 302 https://passwisely-releases-prod\.oss-cn-beijing\.aliyuncs\.com/releases/v1\.2\.6/[^\n]+;\n    \}\n\n?'
 updated,count=re.subn(pattern,'',text)
 check(count in (0,3),'Expected all three legacy download locations or none.')
 check(not re.search(r'location\s*=\s*/api/download/',updated),'Unexpected download location needs review.')
 return updated,count

def record_state(path,state):
 replace_atomic(path,(json.dumps(state,indent=2)+'\n').encode(),0o600,state['ownerUid'],state['ownerGid'])
def emit(phase,**values):print(json.dumps({'phase':phase,**values}),flush=True)

def journal_summary():
 # Message bodies are intentionally not requested, printed or retained.
 try:
  raw=command(['journalctl','-u',WEB,'-n','20','--no-pager','-o','json','--output-fields=__REALTIME_TIMESTAMP,PRIORITY,_PID,_SYSTEMD_UNIT'],timeout=5)
  rows=[]
  for line in raw.splitlines()[-20:]:
   try:
    item=json.loads(line)
    if not isinstance(item,dict):continue
    rows.append({key:item.get(key) for key in ['__REALTIME_TIMESTAMP','PRIORITY','_PID','_SYSTEMD_UNIT']})
   except ValueError:pass
  status=command(['systemctl','show',WEB,'--property=ActiveState,SubState,Result,ExecMainStatus'],timeout=5)
  return {'service':dict(line.split('=',1) for line in status.splitlines() if '=' in line),'journalRecords':rows,'journalMessageTextOmitted':True}
 except DeployError:return {'diagnosticsUnavailable':True,'journalMessageTextOmitted':True}

class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

class ProbeError(DeployError):
 def __init__(self,diagnostic):
  self.diagnostic=diagnostic
  super().__init__(json.dumps(diagnostic,sort_keys=True))

def probe_context(base,path,method,phase):
 # Only reviewed route identifiers enter retained errors, never request URLs,
 # query strings, userinfo, payloads, response headers or exception messages.
 paths={DEEPGRAM_ROUTE,'/','/api/checkout','/api/desktop/recall/upload-token','/api/ai/chat/completions','/api/download/__proto__',*('/api/download/'+platform for platform in PLATFORMS)}
 return {'base':base if base in {'http://127.0.0.1:3011','https://passwisely.com',PUBLIC_BASE} else 'unrecognized',
  'method':method if method in {'HEAD','GET','POST'} else 'unrecognized',
  'path':path if path in paths else 'unrecognized','phase':phase if phase in {'request_build','open','body_read','close','health'} else 'unrecognized'}

def transport_diagnostic(error):
 # urllib wraps OS/DNS/TLS causes in URLError.reason. Inspect typed causes only;
 # string-valued reasons and certificate verify_message are never retained.
 def name(value):
  for kind,label in [(http.client.RemoteDisconnected,'RemoteDisconnected'),(http.client.IncompleteRead,'IncompleteRead'),(ssl.SSLCertVerificationError,'SSLCertVerificationError'),(ssl.SSLError,'SSLError'),(socket.gaierror,'gaierror'),(TimeoutError,'TimeoutError'),(ConnectionResetError,'ConnectionResetError'),(ConnectionRefusedError,'ConnectionRefusedError'),(ConnectionAbortedError,'ConnectionAbortedError'),(BrokenPipeError,'BrokenPipeError'),(urllib.error.URLError,'URLError'),(OSError,'OSError'),(http.client.HTTPException,'HTTPException'),(ValueError,'ValueError'),(TypeError,'TypeError')]:
   if isinstance(value,kind):return label
  return 'Exception'
 cause=error;seen=set()
 for _ in range(4):
  if not isinstance(cause,urllib.error.URLError) or not isinstance(cause.reason,BaseException) or id(cause) in seen:break
  seen.add(id(cause));cause=cause.reason
 reason='unclassified_transport';number=None;certificate=None
 os_codes={getattr(errno,key):key for key in ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','ECONNABORTED','EPIPE','ENETUNREACH','EHOSTUNREACH'] if hasattr(errno,key)}
 if isinstance(cause,ssl.SSLCertVerificationError):
  reason='tls_certificate_verification_failed'
  certificate={2:'issuer_unavailable',9:'not_yet_valid',10:'expired',18:'self_signed_leaf',19:'self_signed_chain',20:'issuer_unavailable',21:'leaf_unverifiable',23:'revoked',62:'hostname_mismatch',64:'ip_address_mismatch'}.get(getattr(cause,'verify_code',None),'unclassified_verification_failure')
 elif isinstance(cause,ssl.SSLError):
  reason={'WRONG_VERSION_NUMBER':'tls_protocol_mismatch','UNSUPPORTED_PROTOCOL':'tls_protocol_mismatch','TLSV1_ALERT_PROTOCOL_VERSION':'tls_protocol_mismatch','UNEXPECTED_EOF_WHILE_READING':'tls_unexpected_eof'}.get(getattr(cause,'reason',None),'tls_failure')
 elif isinstance(cause,socket.gaierror):
  dns_codes={getattr(socket,key):key for key in ['EAI_AGAIN','EAI_NONAME','EAI_FAIL','EAI_NODATA'] if hasattr(socket,key)}
  number=dns_codes.get(cause.errno)
  reason='dns_temporary_failure' if number=='EAI_AGAIN' else 'dns_name_not_found' if number in {'EAI_NONAME','EAI_NODATA'} else 'dns_failure'
 elif isinstance(cause,http.client.RemoteDisconnected):reason='remote_disconnected'
 elif isinstance(cause,http.client.IncompleteRead):reason='incomplete_body'
 elif isinstance(cause,TimeoutError):reason='timeout';number=os_codes.get(cause.errno)
 elif isinstance(cause,OSError):
  number=os_codes.get(cause.errno)
  reason={'ETIMEDOUT':'timeout','ECONNRESET':'connection_reset','ECONNREFUSED':'connection_refused','ECONNABORTED':'connection_aborted','EPIPE':'broken_pipe','ENETUNREACH':'network_unreachable','EHOSTUNREACH':'host_unreachable'}.get(number,'os_transport_failure')
 elif isinstance(cause,urllib.error.URLError):reason='url_failure'
 elif isinstance(cause,http.client.HTTPException):reason='http_protocol_failure'
 elif isinstance(cause,(ValueError,TypeError)):reason='request_or_response_configuration_failure'
 return {'kind':'transport','exception':name(error),'causeException':name(cause),'reason':reason,'errno':number,'tlsCertificateReason':certificate}

def transport_error(base,path,method,phase,error):
 return ProbeError({**probe_context(base,path,method,phase),**transport_diagnostic(error)})

def response(base,path,method='HEAD',payload=None):
 try:
  opener=urllib.request.build_opener(NoRedirect)
  data=json.dumps({} if payload is None else payload).encode() if method=='POST' else None
  request=urllib.request.Request(base+path,method=method,data=data,headers={'content-type':'application/json','cache-control':'no-cache'})
 except Exception as error:raise transport_error(base,path,method,'request_build',error) from None
 try:
  try:res=opener.open(request,timeout=5)
  except urllib.error.HTTPError as error:res=error
 except Exception as error:raise transport_error(base,path,method,'open',error) from None
 failure=None
 try:
  body=res.read(512*1024).decode('utf8','replace') if method=='GET' else ''
  result=(res.status,res.headers,body)
 except Exception as error:failure=transport_error(base,path,method,'body_read',error)
 finally:
  try:res.close()
  except Exception as error:
   cleanup=transport_error(base,path,method,'close',error)
   if failure:failure=ProbeError({**failure.diagnostic,'cleanup':cleanup.diagnostic})
   else:failure=cleanup
 if failure:raise failure from None
 return result

@contextlib.contextmanager
def health_stage(base,path,method,stage):
 try:yield
 except ProbeError:raise
 except DeployError:
  stages={'homepage','homepage_pricing','homepage_release_labels','download','unauthenticated_route','checkout_method','unauthenticated_checkout','unknown_download','baseline_homepage','baseline_download'}
  raise ProbeError({**probe_context(base,path,method,'health'),'kind':'semantic','stage':stage if stage in stages else 'unrecognized','reason':'health_validation_failed'}) from None

class PricingMarkup(HTMLParser):
 """Read visible SSR card text; embedded RSC scripts are not page evidence."""
 VOID={'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
 FIELDS={'name':'pw-plan-name','price':'pw-price','credits':'pw-credit-amount'}
 def __init__(self):
  super().__init__();self.stack=[];self.cards=[];self.current=None;self.card_depth=None;self.text=[]
 def handle_starttag(self,tag,attributes):
  classes=set(dict(attributes).get('class','').split())
  if tag in self.VOID:return
  self.stack.append((tag,classes))
  if tag=='article' and 'pw-price-card' in classes:
   check(self.current is None,'Nested pricing cards are unexpected.')
   self.current={key:[] for key in ['name','price','credits','text']};self.card_depth=len(self.stack)
 def handle_startendtag(self,tag,attributes):pass
 def handle_endtag(self,tag):
  matches=[index for index,item in enumerate(self.stack) if item[0]==tag]
  if not matches:return
  index=matches[-1]
  if self.current is not None and index+1==self.card_depth:
   self.cards.append({key:' '.join(' '.join(value).split()) for key,value in self.current.items()});self.current=None;self.card_depth=None
  del self.stack[index:]
 def handle_data(self,data):
  if any(tag in {'script','style','template'} for tag,_ in self.stack):return
  self.text.append(data)
  if self.current is None:return
  self.current['text'].append(data)
  for field,css in self.FIELDS.items():
   if any(css in classes for _,classes in self.stack):self.current[field].append(data)

def verify_pricing(body):
 page=PricingMarkup();page.feed(body);page.close()
 check(page.current is None and len(page.cards)==3,'Expected exactly three complete public pricing cards.')
 expected=[({'新用户体验','New user trial'},0,20),({'进阶包','Pro'},99,200),({'无限制包','Unlimited'},299,1000)]
 for index,(card,(names,price,credits)) in enumerate(zip(page.cards,expected)):
  check(card['name'] in names,'Pricing plan name mismatch.')
  amount=re.fullmatch(r'¥\s*([0-9]+)(?:\.00)?\s*(CNY|/月|/month)',card['price'])
  check(amount is not None and int(amount.group(1))==price,'Pricing amount mismatch.')
  credit=re.fullmatch(r'([0-9][0-9, ]*)\s*(积分|credits)',card['credits'])
  check(credit is not None and int(credit.group(1).replace(',','').replace(' ',''))==credits,'Pricing credit amount mismatch.')
  text=card['text']
  if index:
   check(amount.group(2) in {'/月','/month'},'Paid plan must show monthly pricing.')
   check('手动续购，无自动续费' in text or 'Manual renewal, no auto-renewal' in text,'Manual-renewal terms missing.')
   check('到账后 30 天到期' in text or 'Expires 30 days after credits arrive' in text,'Thirty-day expiry terms missing.')
   check('每次独立起算，不延长旧包' in text or 'Each purchase has its own expiry' in text,'Independent purchase expiry terms missing.')
  else:
   check(amount.group(2)=='CNY','Trial must not be presented as a paid monthly subscription.')
   check('体验积分长期有效' in text or 'Trial credits do not expire' in text,'Permanent trial terms missing.')
 visible=' '.join(' '.join(page.text).split()).lower()
 check('旧余额长期有效' in visible or 'existing permanent balances do not expire' in visible,'Existing permanent balance terms missing.')
 check('并非无限额度' in visible or 'not unlimited usage' in visible,'Unlimited pack credit-limit explanation missing.')
 return {'trialCredits':20,'paidPacks':[{'priceCny':99,'credits':200},{'priceCny':299,'credits':1000}],'paidValidityDays':30,'automaticRenewal':False}

def health_once(base,downloads,include_deepgram=False):
 with health_stage(base,'/','GET','homepage'):
  status,headers,body=response(base,'/','GET');check(status==200 and 'pw-hero-title' in body,'Homepage is not healthy.')
 with health_stage(base,'/','GET','homepage_pricing'):pricing=verify_pricing(body)
 with health_stage(base,'/','GET','homepage_release_labels'):
  release_text=html.unescape(body)
  check(all(artifact['version'] in release_text for artifact in downloads.values()),'Homepage release labels do not match.')
  for platform in ['windows-x64','mac-x64']:
   notice=downloads[platform].get('notice')
   if notice is not None:check(any(text and text in release_text for text in [notice.get('zh'),notice.get('en')]),'Catalog release notice missing: '+platform)
 for platform,artifact in downloads.items():
  with health_stage(base,'/api/download/'+platform,'HEAD','download'):
   status,headers,_=response(base,'/api/download/'+platform)
   check(status==307 and headers.get('Location')==artifact['url'],'Download URL mismatch: '+platform)
   check(headers.get('x-passwisely-release-version')==artifact['version'],'Download version mismatch: '+platform)
   if artifact.get('sha256'):check(headers.get('x-passwisely-artifact-sha256')==artifact['sha256'],'Download digest header mismatch: '+platform)
 for path in ['/api/desktop/recall/upload-token','/api/ai/chat/completions']+([DEEPGRAM_ROUTE] if include_deepgram else []):
  with health_stage(base,path,'POST','unauthenticated_route'):check(response(base,path,'POST')[0]==401,'Unauthenticated route is missing or not protected.')
 with health_stage(base,'/api/checkout','GET','checkout_method'):check(response(base,'/api/checkout','GET')[0]==405,'Checkout unexpectedly accepts GET.')
 for retired in ['starter','pro','max']:
  with health_stage(base,'/api/checkout','POST','unauthenticated_checkout'):check(response(base,'/api/checkout','POST',{'packId':retired,'provider':'alipay'})[0]==401,'Unauthenticated checkout is not protected.')
 with health_stage(base,'/api/download/__proto__','HEAD','unknown_download'):check(response(base,'/api/download/__proto__')[0]==404,'Unknown download platform was accepted.')
 return {'base':base,'homepage':200,'pricing':pricing,'downloadPlatforms':list(downloads),'unauthenticatedRecallAndAi':401,**({'unauthenticatedDeepgram':401} if include_deepgram else {}),'unauthenticatedCheckout':401,'checkoutGet':405,'retiredPackAuthenticatedRejection':'not_exercised_by_unauthenticated_probe','unknownPlatform':404,'providerCalls':0,'paymentOrdersCreated':0}

def wait_health(base,downloads,seconds,include_deepgram=False):
 deadline=time.monotonic()+seconds
 while True:
  try:return health_once(base,downloads,include_deepgram)
  except ProbeError as error:last=error
  except DeployError:last=ProbeError({**probe_context(base,'unrecognized','unrecognized','health'),'kind':'semantic','stage':'health','reason':'health_validation_failed'})
  if time.monotonic()>=deadline:raise last
  time.sleep(1)

def capture_baseline(base):
 with health_stage(base,'/','GET','baseline_homepage'):
  status,headers,body=response(base,'/','GET');check(status==200 and 'pw-hero-title' in body,'Current homepage is unhealthy before activation.')
 locations={}
 for platform in PLATFORMS:
  with health_stage(base,'/api/download/'+platform,'HEAD','baseline_download'):
   status,headers,_=response(base,'/api/download/'+platform);location=headers.get('Location','')
   check(status in {302,307} and location.startswith('https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/') and '?' not in location and '#' not in location,'Unexpected baseline download route.')
  locations[platform]={'status':status,'location':location}
 return {'base':base,'downloads':locations}

def verify_baseline(baseline,seconds=60):
 deadline=time.monotonic()+seconds
 while True:
  try:
   actual=capture_baseline(baseline['base']);check(actual==baseline,'Previous download routes were not restored.');return
  except ProbeError as error:last=error
  except DeployError:last=ProbeError({**probe_context(baseline['base'],'unrecognized','unrecognized','health'),'kind':'semantic','stage':'baseline_restore','reason':'health_validation_failed'})
  if time.monotonic()>=deadline:raise last
  time.sleep(1)

def has_deepgram_broker(manifest):
 paths={item['path'] for item in manifest.get('sourceFiles',[])}
 present=BROKER_SOURCE_PATHS & paths
 check(not present or present==BROKER_SOURCE_PATHS,'Incomplete Deepgram broker source provenance.')
 return bool(present)

def match_source_catalog(downloads):
 # Bind the build producer's parsed catalog to the pinned public source facts.
 # Capabilities come from liveAudio, never from notice wording or CPU guesses.
 raw=json.loads((SOURCE_REPO/'website/lib/download-artifacts.json').read_text())
 check(isinstance(raw,dict) and raw.get('releaseVersion')=='2.0.0' and isinstance(raw.get('artifacts'),dict) and set(raw['artifacts'])==set(PLATFORMS),'Invalid source download catalog.')
 for platform,item in downloads.items():
  source=raw['artifacts'][platform]
  check(isinstance(source,dict),'Invalid source download artifact.')
  for field in ['version','filename','sha256','bytes','legacy','liveAudio']:
   check(type(source.get(field)) is type(item.get(field)) and source.get(field)==item.get(field),'Deployment download catalog differs from pinned source: '+platform+'/'+field)
  notice=source.get('notice')
  if notice is not None:
   check(isinstance(notice,dict),'Invalid source artifact notice.')
   notice={locale:notice.get(locale) for locale in ['zh','en']}
  check(type(source.get('revision',1)) is int and item.get('revision',1)==source.get('revision',1) and item.get('notice')==notice,'Deployment download catalog differs from pinned source: '+platform+'/metadata')

def validate_manifest(args):
 path=canonical_path(args.manifest);check(path.is_file() and path.stat().st_size<=8*1024*1024,'Invalid or oversized deployment manifest.')
 check(digest(path)==args.manifest_sha256,'Deployment manifest digest mismatch.')
 manifest=json.loads(path.read_text());check(manifest.get('schemaVersion')==1 and manifest.get('releaseVersion')=='2.0.0' and manifest.get('credentialsIncluded') is False,'Invalid deployment manifest.')
 check(manifest.get('sourceCommit')==args.expected_current_commit,'Manifest source commit mismatch.')
 candidate=canonical_path(args.candidate_dist);check(candidate.is_relative_to(WEBSITE/'.release-candidates') and candidate.name=='dist','Candidate must be a production-owner release directory.')
 check(candidate!=WEBSITE/'dist' and candidate.is_dir(),'Invalid candidate directory.')
 declared=manifest.get('files');check(isinstance(declared,list) and declared,'Missing candidate file list.')
 for item in declared:
  safe_relative(item['path']);check(type(item.get('bytes')) is int and item['bytes']>=0 and re.fullmatch('[0-9a-f]{64}',str(item.get('sha256',''))),'Malformed file manifest entry.')
 actual=file_tree(candidate);check(actual==declared and fingerprint(actual)==manifest.get('treeFingerprint'),'Candidate files do not match the approved manifest.')
 check(any(x['path']=='server/index.js' for x in actual) and any(x['path']=='server/wrangler.json' for x in actual),'Incomplete candidate.')
 config=json.loads((candidate/'server/wrangler.json').read_text());check(config.get('main')=='index.js' and config.get('assets',{}).get('directory')=='../client','Unexpected runtime entry/asset paths.')
 source_items=manifest.get('sourceFiles',[]);source_paths=[item.get('path') for item in source_items]
 required={'package.json','website/lib/download-artifacts.json','website/lib/downloads.ts','electron/live/transcription.ts','website/scripts/stage-runtime-env.mjs','website/lib/recall.ts','website/app/api/desktop/recall/upload-token/route.ts'}
 check(required.issubset(source_paths) and len(source_paths)==len(set(source_paths)),'Incomplete or duplicate source provenance.')
 for item in source_items:
  rel=safe_relative(item['path']);check(not forbidden_source(rel),'Unexpected source manifest entry.')
  source=SOURCE_REPO/str(rel);check(source.is_file() and not source.is_symlink() and digest(source)==item['sha256'],'Source file drift: '+str(rel))
 check(manifest.get('sourceFiles'),'Missing source provenance.');has_deepgram_broker(manifest)
 downloads=manifest.get('downloads',{});check(set(downloads)==set(PLATFORMS),'Incomplete platform catalog.')
 for platform,item in downloads.items():
  check(item.get('available') is True,'Artifact not ready: '+platform)
  check(item.get('version')=='2.0.0' and item.get('legacy') is False,'Wrong platform version or legacy scope.')
  check(str(item.get('url','')).startswith('https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v'+item['version']+'/'),'Unexpected artifact origin.')
  check(re.fullmatch('[0-9a-f]{64}',str(item.get('sha256',''))) and type(item.get('bytes')) is int and item['bytes']>0,'Unverified new artifact.')
 notice=downloads['windows-x64'].get('notice');check(isinstance(notice,dict) and all(isinstance(notice.get(locale),str) and notice[locale] for locale in ['zh','en']),'Missing Windows release limitation notice.')
 for platform,item in downloads.items():
  names={'mac-arm64':'PassWisely-macOS-arm64.dmg','mac-x64':'PassWisely-macOS-x64.dmg','windows-x64':'PassWisely-Windows-x64.exe'}
  revision=item.get('revision',1)
  check(item.get('platform')==platform and item.get('filename')==names[platform] and type(revision) is int and revision>=1,'Artifact architecture/identity mismatch.')
  expected_url='https://passwisely-releases-prod.oss-cn-beijing.aliyuncs.com/releases/v2.0.0/'+(('r'+str(revision)+'/') if revision>1 else '')+names[platform]
  check(item['url']==expected_url,'Artifact URL does not match its platform/revision.')
  check(item.get('liveAudio') in {'included','not_included'},'Unknown live-audio scope.')
  if platform!='mac-x64':check(item['liveAudio']=='included','Wrong live-audio scope.')
  notice=item.get('notice')
  if notice is not None:check(isinstance(notice,dict) and all(isinstance(notice.get(locale),str) and notice[locale] for locale in ['zh','en']),'Malformed bilingual release notice.')
  if platform=='mac-x64' and item['liveAudio']=='not_included':check(notice is not None,'Missing Intel release limitation notice.')
 match_source_catalog(downloads)
 return manifest,candidate

def configuration_probe(runtime=False):
 global _PRESERVED_BINDING,_BINDING_INFO
 data,info=read_runtime_binding(WEBSITE/'dist/server/.dev.vars')
 if _PRESERVED_BINDING is None:
  check(not runtime,'Binding snapshot was not captured before exchange.')
  _PRESERVED_BINDING,_BINDING_INFO=data,info
 else:check(data==_PRESERVED_BINDING and info==_BINDING_INFO,'Active runtime bindings changed.')
 return {'scope':'preserved-running-binding-bytes','bindingBytes':len(data),'bindingValuesReturned':False,'sourceEnvironmentRead':False,'productionFileWrites':0,'exactBytesMatch':True}

def fresh_production_bindings():
 check(_PRESERVED_BINDING is not None and _BINDING_INFO is not None,'Missing pre-exchange binding snapshot.')
 path=WEBSITE/'dist/server/.dev.vars';check(not path.exists() and not path.is_symlink(),'Candidate contains unexpected bindings.')
 write_private(path,_PRESERVED_BINDING,_BINDING_INFO['uid'],_BINDING_INFO['gid'])
 return configuration_probe(runtime=True)

def read_runtime_binding(path):
 path=canonical_path(path);fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as stream:
  info=os.fstat(stream.fileno());account=pwd.getpwnam('jerry')
  check(stat.S_ISREG(info.st_mode) and info.st_nlink==1 and info.st_uid==account.pw_uid and stat.S_IMODE(info.st_mode)==0o600 and info.st_size<=16*1024*1024,'Unsafe protected runtime binding.')
  data=stream.read(16*1024*1024+1);after=os.fstat(stream.fileno());named=path.stat()
  key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mode,s.st_uid,s.st_gid,s.st_mtime_ns,s.st_ctime_ns)
  check(key(info)==key(after)==key(named) and len(data)==info.st_size,'Runtime bindings changed while reading.')
 return data,{'sha256':hashlib.sha256(data).hexdigest(),'bytes':len(data),'uid':info.st_uid,'gid':info.st_gid,'mode':stat.S_IMODE(info.st_mode)}

def verify_binding_info(expected):
 _,actual=read_runtime_binding(WEBSITE/'dist/server/.dev.vars')
 check(actual==expected,'Preserved runtime binding identity/content changed.')

def live_unit_pin():
 check(digest(canonical_path(LIVE_UNIT))==LIVE_UNIT_SHA,'Live service unit changed.')
 unit=dict(line.split('=',1) for line in command(['systemctl','show',WEB,'--property=WorkingDirectory,User,ActiveState,FragmentPath,DropInPaths']).splitlines() if '=' in line)
 check(unit.get('WorkingDirectory')==str(WEBSITE) and unit.get('User')=='jerry' and unit.get('ActiveState')=='active' and unit.get('FragmentPath')==str(LIVE_UNIT) and unit.get('DropInPaths')=='','Unexpected current web service identity/state.')
 return unit

def live_source_pin(expected):
 check(command(['git','-C',str(REPO),'rev-parse','HEAD'],as_jerry=True).strip()==expected,'Live source HEAD changed; no checkout/reset is authorized.')
 live_unit_pin()

def source_preflight(args,manifest):
 check(SOURCE_REPO is not None and SOURCE_REPO.is_relative_to(SOURCE_BASE) and SOURCE_REPO!=SOURCE_BASE,'Source worktree is outside its private owner directory.')
 check(command(['git','-C',str(SOURCE_REPO),'rev-parse','HEAD'],as_jerry=True).strip()==args.expected_current_commit,'Pinned source worktree HEAD mismatch.')
 check(command(['git','-C',str(SOURCE_REPO),'rev-parse','--abbrev-ref','HEAD'],as_jerry=True).strip()=='HEAD','Release source must be a detached worktree.')
 command(['git','-C',str(SOURCE_REPO),'diff','--quiet'],as_jerry=True);command(['git','-C',str(SOURCE_REPO),'diff','--cached','--quiet'],as_jerry=True)
 command(['git','-C',str(SOURCE_REPO),'merge-base','--is-ancestor',BASE_COMMIT,'HEAD'],as_jerry=True)
 history=command(['git','-C',str(SOURCE_REPO),'rev-list','HEAD','^'+BASE_COMMIT],as_jerry=True).splitlines()
 check(PENDING_COMMIT not in history,'Unpublished WeChat commit is not an authorized source ancestor.')
 changed=set(command(['git','-C',str(SOURCE_REPO),'diff','--name-only',BASE_COMMIT,'HEAD'],as_jerry=True).splitlines())
 check(changed and changed<=DOWNLOAD_ONLY_PATHS and 'website/lib/download-artifacts.json' in changed,'Release source exceeds the reviewed release scope.')
 actual=set(command(['git','-C',str(SOURCE_REPO),'ls-files','website','electron/live/transcription.ts','shared','package.json'],as_jerry=True).strip().splitlines())
 check(actual=={item['path'] for item in manifest['sourceFiles']},'Source provenance file set is incomplete.')
 live_source_pin(args.expected_live_commit)

def public_download_health(downloads,seconds):
 deadline=time.monotonic()+seconds
 while True:
  try:
   for platform,artifact in downloads.items():
    status,headers,_=response(PUBLIC_BASE,'/api/download/'+platform,'HEAD')
    check(status==307 and headers.get('Location')==artifact['url'] and headers.get('x-passwisely-release-version')==artifact['version'] and headers.get('x-passwisely-artifact-sha256')==artifact['sha256'],'Public download proxy does not match the approved artifact.')
   return {'base':PUBLIC_BASE,'downloadPlatforms':list(downloads),'homepageNotPartOfWiseActivation':True,'tlsNotExercised':False,'trackingEventNotCreated':True}
  except DeployError as error:last=error
  if time.monotonic()>=deadline:raise last
  time.sleep(1)

def rollback(state,path):
 errors=[];current=WEBSITE/'dist';retained=Path(state['retainedRuntime'])
 # The schema migration is a separate additive operation. Restoring the old
 # runtime cannot attest monthly-credit visibility after grants are issued.
 state.update(rollbackScope='runtime_and_routing_only',billingCompatibilityVerified=False,billingMigrationReverted=False,billingRecoveryAction='Retain migration 0010 and all grants. If monthly grants exist, use temporary maintenance and roll forward to a balance-owner-compatible runtime.')
 if state.get('status')=='rolled_back':
  check(fingerprint(file_tree(current,allow_runtime_binding=True))==state['oldFingerprint'] and digest(NGINX)==state['oldNginxSha256'],'A completed rollback now has outside changes; no action taken.')
  verify_binding_info(state['bindingBefore']);live_source_pin(state['liveSourceCommit'])
  return []
 restart_required=False
 try:
  now=fingerprint(file_tree(current,allow_runtime_binding=True))
  if now==state['newFingerprint']:
   check(fingerprint(file_tree(retained,allow_runtime_binding=True))==state['oldFingerprint'],'Retained old runtime identity changed.')
   check(read_runtime_binding(retained/'server/.dev.vars')[1]==state['bindingBefore'],'Retained old runtime bindings changed.')
  else:check(now==state['oldFingerprint'],'Current runtime identity is unknown; automatic exchange refused.')
  restart_required=bool(state.get('webTouched') or state.get('stopRequested'))
  if restart_required:command(['systemctl','stop',WEB])
  if now==state['newFingerprint']:
   with critical():
    exchange(current,retained);state['runtimeExchanged']=False
    try:record_state(path,state)
    except OSError:errors.append('runtime state persistence failed after restore')
  if restart_required:command(['systemctl','start',WEB])
 except Exception as error:
  errors.append('runtime: '+(str(error) if isinstance(error,DeployError) else type(error).__name__))
  if restart_required:
   try:command(['systemctl','start',WEB])
   except Exception:errors.append('runtime service recovery failed')
 try:
  if state.get('nginxInstalled') or state.get('nginxInstallRequested'):
   live=digest(NGINX);check(live in {state['oldNginxSha256'],state['newNginxSha256']},'Nginx identity changed outside this transaction; restore refused.')
   backup=Path(state['nginxBackup']);check(digest(backup)==state['oldNginxSha256'],'Nginx backup integrity failed.')
   with critical():
    replace_atomic(NGINX,backup.read_bytes(),state['nginxMode'],state['nginxUid'],state['nginxGid']);state['nginxInstalled']=False;state['nginxInstallRequested']=False
    try:record_state(path,state)
    except OSError:errors.append('nginx state persistence failed after restore')
   command(['nginx','-t']);command(['systemctl','reload','nginx'])
 except Exception as error:errors.append('nginx: '+(str(error) if isinstance(error,DeployError) else type(error).__name__))
 if not errors:
  try:
   for baseline in state.get('baselineHealth',[]):verify_baseline(baseline)
   verify_binding_info(state['bindingBefore']);live_source_pin(state['liveSourceCommit'])
  except DeployError as error:errors.append(str(error))
 state['rollbackErrors']=errors;state['status']='rollback_incomplete' if errors else 'rolled_back';state['diagnostics']=journal_summary()
 try:record_state(path,state)
 except OSError:errors.append('final rollback state persistence failed')
 return errors

def activate(args):
 manifest,candidate=validate_manifest(args)
 source_preflight(args,manifest)
 check(fingerprint(file_tree(WEBSITE/'dist',allow_runtime_binding=True))==args.expected_active_tree,'Current runtime fingerprint changed.')
 for name in ['.release-candidates/probe','.release-backups/probe','.release-activation.lock']:
  try:command(['git','-C',str(REPO),'check-ignore','--no-index','-q','website/'+name],as_jerry=True)
  except DeployError:raise DeployError('Private production release state must be ignored: '+name)
 check(digest(NGINX)==args.expected_nginx_sha256,'Nginx drift detected before stopping web.')
 nginx_original=NGINX.read_bytes();nginx_next,count=remove_download_locations(nginx_original.decode());check(count==0,'Nginx route changes are not authorized for this release.')
 info=NGINX.stat();account=pwd.getpwnam('jerry');current=canonical_path(WEBSITE/'dist')
 check(hasattr(ctypes.CDLL(None),'renameat2'),'Atomic exchange is unavailable before activation.')
 check(current.is_dir() and candidate.stat().st_dev==current.stat().st_dev,'Runtime exchange is not ready.')
 check(candidate.stat().st_uid==account.pw_uid and (candidate/'server').stat().st_uid==account.pw_uid and (candidate/'server').stat().st_mode&0o700==0o700,'Candidate/server must be readable and writable by the web owner.')
 check(candidate.parent.stat().st_uid==account.pw_uid and stat.S_IMODE(candidate.parent.stat().st_mode)==0o700,'Candidate parent must be private and owned by jerry.')
 env=WEBSITE/'.env.production';check(env.is_file() and not env.is_symlink() and env.stat().st_uid==account.pw_uid and stat.S_IMODE(env.stat().st_mode)==0o600,'Existing production environment must remain privately owned.')
 live_unit_pin()
 configuration_preflight=configuration_probe()
 baseline=[capture_baseline('http://127.0.0.1:3011'),capture_baseline(PUBLIC_BASE)]
 command([NODE,str(REPO/'desktop-api/healthcheck.mjs')],as_jerry=True)
 backups=WEBSITE/'.release-backups';backups.mkdir(mode=0o700,exist_ok=True);check(not backups.is_symlink(),'Unsafe backup parent.');os.chmod(backups,0o700);os.chown(backups,account.pw_uid,account.pw_gid)
 backup=backups/('v2.0.0-'+time.strftime('%Y%m%dT%H%M%SZ',time.gmtime())+'-'+uuid.uuid4().hex[:8]);backup.mkdir(mode=0o700);os.chown(backup,account.pw_uid,account.pw_gid)
 nginx_backup=backup/'nginx.before.conf';write_private(nginx_backup,nginx_original,account.pw_uid,account.pw_gid)
 path=backup/'transaction.json';state={'schemaVersion':1,'releaseVersion':'2.0.0','sourceCommit':args.expected_current_commit,'manifestSha256':args.manifest_sha256,'ownerUid':account.pw_uid,'ownerGid':account.pw_gid,'retainedRuntime':str(candidate),'oldFingerprint':fingerprint(file_tree(current,allow_runtime_binding=True)),'newFingerprint':manifest['treeFingerprint'],'oldNginxSha256':digest(NGINX),'newNginxSha256':hashlib.sha256(nginx_next.encode()).hexdigest(),'nginxBackup':str(nginx_backup),'nginxMode':stat.S_IMODE(info.st_mode),'nginxUid':info.st_uid,'nginxGid':info.st_gid,'webTouched':False,'stopRequested':False,'runtimeExchanged':False,'nginxInstalled':False,'nginxInstallRequested':False,'status':'prepared','productionDataModified':False,'desktopApiModified':False,'baselineHealth':baseline,'configurationPreflight':configuration_preflight,'sourceRepo':str(SOURCE_REPO),'liveSourceCommit':args.expected_live_commit,'bindingBefore':_BINDING_INFO}
 check(state['oldFingerprint']!=state['newFingerprint'],'Candidate matches the current compiled runtime; review a no-op/config-only operation instead.')
 record_state(path,state);emit('prepared',transaction=str(path))
 try:
  state['status']='stopping';state['stopRequested']=True;record_state(path,state)
  with critical():state['webTouched']=True;command(['systemctl','stop',WEB]);record_state(path,state)
  with critical():exchange(current,candidate);state['runtimeExchanged']=True;record_state(path,state)
  state['bindingsPresent']=fresh_production_bindings();record_state(path,state)
  command(['systemctl','start',WEB]);emit('web_started')
  state['localHealth']=wait_health('http://127.0.0.1:3011',manifest['downloads'],args.health_timeout,include_deepgram=has_deepgram_broker(manifest));record_state(path,state)
  check(digest(NGINX)==state['oldNginxSha256'],'Nginx changed during activation.')
  if count:
   state['nginxInstallRequested']=True;record_state(path,state)
   with critical():replace_atomic(NGINX,nginx_next.encode(),state['nginxMode'],state['nginxUid'],state['nginxGid']);state['nginxInstalled']=True;record_state(path,state)
   command(['nginx','-t']);command(['systemctl','reload','nginx']);emit('nginx_reloaded',removedExactLocations=count)
  state['publicHealth']=public_download_health(manifest['downloads'],args.health_timeout)
  live_source_pin(args.expected_live_commit);verify_binding_info(state['bindingBefore'])
  # Existing gRPC health only; never restarts or modifies its service.
  command([NODE,str(REPO/'desktop-api/healthcheck.mjs')],as_jerry=True)
  state['status']='active';record_state(path,state);emit('active',transaction=str(path),transactionSha256=digest(path),retainedOldRuntime=str(candidate),providerCalls=0)
 except BaseException as error:
  state['activationFailure']=str(error) if isinstance(error,DeployError) else type(error).__name__
  try:record_state(path,state)
  except OSError:pass
  errors=rollback(state,path);emit('activation_failed',transaction=str(path),transactionSha256=digest(path),rollbackComplete=not errors,rollbackScope='runtime_and_routing_only',billingCompatibilityVerified=False,diagnostics=state.get('diagnostics'))
  raise DeployError('Activation failed; '+('rollback incomplete, retain transaction for recovery.' if errors else 'previous runtime and routing restored; billing compatibility is unverified. Keep 0010/grants and use maintenance/forward recovery when monthly grants exist.'))

def parse():
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='operation',required=True)
 act=sub.add_parser('activate',aliases=['plan']);act.add_argument('--candidate-dist',required=True);act.add_argument('--manifest',required=True);act.add_argument('--manifest-sha256',required=True);act.add_argument('--expected-current-commit',required=True);act.add_argument('--expected-nginx-sha256',required=True);act.add_argument('--health-timeout',type=int,default=60);act.add_argument('--source-repo',required=True);act.add_argument('--expected-live-commit',required=True);act.add_argument('--expected-active-tree',required=True)
 undo=sub.add_parser('rollback');undo.add_argument('--transaction',required=True);undo.add_argument('--expected-transaction-sha256',required=True)
 return parser.parse_args()
def main():
 global SOURCE_REPO
 args=parse();check(sys.platform=='linux' and os.geteuid()==0,'Run the reviewed operation as root on Wise Linux.')
 if args.operation in {'activate','plan'}:
  SOURCE_REPO=canonical_path(args.source_repo)
  check(re.fullmatch('[0-9a-f]{40}',args.expected_live_commit) and re.fullmatch('[0-9a-f]{64}',args.expected_active_tree),'Invalid live source/runtime pin.')
 canonical_path(WEBSITE);check(WEBSITE.is_dir(),'Production website missing.')
 if args.operation=='plan':
  check(re.fullmatch('[0-9a-f]{64}',args.manifest_sha256) and re.fullmatch('[0-9a-f]{64}',args.expected_nginx_sha256) and re.fullmatch('[0-9a-f]{40}',args.expected_current_commit),'Invalid pinned digest/commit.')
  manifest,candidate=validate_manifest(args);source_preflight(args,manifest)
  check(fingerprint(file_tree(WEBSITE/'dist',allow_runtime_binding=True))==args.expected_active_tree,'Current runtime fingerprint changed.')
  check(digest(NGINX)==args.expected_nginx_sha256 and remove_download_locations(NGINX.read_text())[1]==0,'Nginx differs from the authorized unchanged configuration.')
  scope=configuration_probe()
  emit('read_only_plan',productionFileWrites=0,sourceCommit=args.expected_current_commit,liveSourceCommit=args.expected_live_commit,sourceRepo=str(SOURCE_REPO),compiledFiles=len(manifest['files']),treeFingerprint=manifest['treeFingerprint'],bindings=scope,servicesToRestart=[WEB],nginxChanges=False,desktopChanges=False,unauthenticatedDeepgramProbe=has_deepgram_broker(manifest))
  return
 lock=WEBSITE/'.release-activation.lock';fd=os.open(lock,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as stream:
  try:fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise DeployError('Another release operation holds the lock.')
  def interrupt(signum,frame):raise DeployError('Release interrupted by signal '+str(signum))
  signal.signal(signal.SIGINT,interrupt);signal.signal(signal.SIGTERM,interrupt)
  if args.operation=='activate':
   check(re.fullmatch('[0-9a-f]{64}',args.manifest_sha256) and re.fullmatch('[0-9a-f]{64}',args.expected_nginx_sha256) and re.fullmatch('[0-9a-f]{40}',args.expected_current_commit),'Invalid pinned digest/commit.')
   check(1<=args.health_timeout<=300,'Health timeout must be 1..300 seconds.');activate(args)
  else:
   path=canonical_path(args.transaction);check(path.is_relative_to(WEBSITE/'.release-backups') and path.name=='transaction.json','Rollback must use a retained production-owner transaction.')
   check(re.fullmatch('[0-9a-f]{64}',args.expected_transaction_sha256) and digest(path)==args.expected_transaction_sha256,'Rollback transaction digest mismatch.')
   state=json.loads(path.read_text());check(state.get('schemaVersion')==1 and state.get('releaseVersion')=='2.0.0','Invalid rollback transaction.')
   account=pwd.getpwnam('jerry');retained=canonical_path(state['retainedRuntime'])
   check(retained.is_relative_to(WEBSITE/'.release-candidates') and retained.name=='dist' and Path(state['nginxBackup'])==path.parent/'nginx.before.conf','Rollback path ownership mismatch.')
   check(state.get('ownerUid')==account.pw_uid and state.get('ownerGid')==account.pw_gid,'Rollback owner mismatch.')
   check(state.get('oldFingerprint')!=state.get('newFingerprint'),'Ambiguous runtime identity; review manually.')
   for key in ['oldFingerprint','newFingerprint','oldNginxSha256','newNginxSha256']:check(re.fullmatch('[0-9a-f]{64}',str(state.get(key,''))),'Invalid rollback identity.')
   before=Path(state['nginxBackup']);check(digest(before)==state['oldNginxSha256'],'Nginx backup identity mismatch.')
   expected,_=remove_download_locations(before.read_text());check(hashlib.sha256(expected.encode()).hexdigest()==state['newNginxSha256'],'Nginx transform identity mismatch.')
   errors=rollback(state,path);emit('rollback',complete=not errors,scope='runtime_and_routing_only',billingCompatibilityVerified=False,transaction=str(path),diagnostics=state.get('diagnostics'));check(not errors,'Rollback incomplete; ownership record retained.')
if __name__=='__main__':
 try:main()
 except (DeployError,ValueError,TypeError,KeyError,OSError) as error:print(json.dumps({'error':str(error) if isinstance(error,DeployError) else type(error).__name__}),file=sys.stderr);sys.exit(1)
