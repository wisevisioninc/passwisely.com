// Run on wise from the website directory after deploying the gateway-aware build.
// Secrets remain in protected configuration files and are never printed.
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const productionPath=fileURLToPath(new URL('../.env.production',import.meta.url));
const rootPath=fileURLToPath(new URL('../../.env',import.meta.url));
function parse(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap(line=>{
    const m=line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    return m ? [[m[1],m[2].trim().replace(/^(['"])(.*)\1$/,'$2')]] : [];
  }));
}
const original=await readFile(productionPath,'utf8');
const env=parse(original);
const key=parse(await readFile(rootPath,'utf8')).OPENAI_API_KEY;
if(!key||!env.ADMIN_USERNAME||!env.ADMIN_PASSWORD) throw Error('Required gateway or admin credentials are missing.');
const probe=await fetch('https://wisepa.cn/v1/chat/completions',{
  method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
  body:JSON.stringify({model:'gpt-5.6-sol',messages:[{role:'user',content:'Reply with exactly OK.'}],max_completion_tokens:128,reasoning_effort:'low',stream:false}),signal:AbortSignal.timeout(90000),
});
const result=await probe.json();
if(!probe.ok||result.model!=='gpt-5.6-sol'||!result.choices?.[0]?.message?.content?.trim()) throw Error(`Gateway preflight failed: HTTP ${probe.status}; production configuration unchanged.`);
const base='https://admin.passwisely.com/api/admin';
const login=await fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:env.ADMIN_USERNAME,password:env.ADMIN_PASSWORD}),signal:AbortSignal.timeout(20000)});
const cookie=login.headers.get('set-cookie')?.split(';')[0];
if(!login.ok||!cookie) throw Error('PassWisely admin login failed.');
const secret=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
const snapshot=await fetch(`${env.SUPABASE_URL}/rest/v1/admin_settings?key=like.ai_*&select=key,value,updated_at`,{headers:{apikey:secret,Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(20000)});
if(!snapshot.ok) throw Error('Cannot back up previous AI settings.');
const backup=join(homedir(),'.config/passwisely/backups',`wisepa-${Date.now()}`);
await mkdir(backup,{recursive:true,mode:0o700});
await writeFile(join(backup,'website.env.production'),original,{mode:0o600,flag:'wx'});
await writeFile(join(backup,'ai-settings.json'),JSON.stringify(await snapshot.json(),null,2),{mode:0o600,flag:'wx'});
const changes={ai_default_provider:'openai',ai_default_model:'gpt-5.6-sol',ai_base_url_openai:'https://wisepa.cn/v1',ai_api_key_openai:key};
const saved=await fetch(base+'/settings',{method:'PUT',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(changes),signal:AbortSignal.timeout(20000)});
if(!saved.ok) throw Error(`Saving admin AI settings failed: HTTP ${saved.status}; backup at ${backup}`);
const verified=await fetch(base+'/settings',{headers:{Cookie:cookie},signal:AbortSignal.timeout(20000)});
const settings=await verified.json();
if(!verified.ok||settings.ai_default_model!==changes.ai_default_model||settings.ai_default_provider!=='openai'||settings.ai_base_url_openai!==changes.ai_base_url_openai||settings.ai_api_key_openai_configured!=='true') throw Error(`Saved configuration verification failed; backup at ${backup}`);
const fallback={AI_DEFAULT_PROVIDER:'openai',AI_DEFAULT_MODEL:'gpt-5.6-sol',OPENAI_BASE_URL:'https://wisepa.cn/v1',OPENAI_API_KEY:key};
let updated=original;
for(const [name,value] of Object.entries(fallback)) {
  const line=`${name}=${JSON.stringify(value)}`;
  const pattern=new RegExp(`^${name}=.*$`,'m');
  updated=pattern.test(updated)?updated.replace(pattern,()=>line):updated.replace(/\s*$/,'')+'\n'+line+'\n';
}
await writeFile(productionPath,updated,{mode:0o600});
await chmod(productionPath,0o600);
console.log(JSON.stringify({configured:true,provider:'openai',model:'gpt-5.6-sol',baseUrl:changes.ai_base_url_openai,keyStored:'encrypted in Supabase and protected server environment',backup}));
