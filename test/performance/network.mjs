// Read-only network timings. Does not change VPN, DNS, services, or proxy settings.
import fs from 'node:fs';
import https from 'node:https';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
const require=createRequire(new URL('../../package.json',import.meta.url));
const grpc=require('@grpc/grpc-js'),loader=require('@grpc/proto-loader');
const Client=grpc.loadPackageDefinition(loader.loadSync(new URL('../../proto/desktop_ai.proto',import.meta.url).pathname,{defaults:true,oneofs:true})).passwisely.desktop.v1.DesktopAI;
const args=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
if(!args.out)throw Error('--out must name a new JSON file');
if(fs.existsSync(args.out))throw Error('Preserve the existing report; use a new --out');
let token;
if(args['token-file']){const s=fs.lstatSync(args['token-file']);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o777)!==0o600)throw Error('Token must be a private regular file');token=JSON.parse(fs.readFileSync(args['token-file'],'utf8')).token;if(typeof token!=='string')throw Error('Missing token');}
const samples=[],startedAt=new Date().toISOString(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss;
const rssTimer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
const httpsClients=new Map(),grpcClients=new Map();
function http(host,pathname,cold){return new Promise(resolve=>{
 const start=performance.now(),timing={};let received=0;
 const agent=cold?new https.Agent({keepAlive:false}):httpsClients.get(host);
 const req=https.request({hostname:host,path:pathname,agent,headers:{accept:pathname==='/'?'text/html':'application/json',...(token&&pathname!=='/'?{authorization:`Bearer ${token}`}:{})}},res=>{
  timing.firstByteMs=performance.now()-start;res.on('data',chunk=>{received+=chunk.length;if(received>2*1024*1024)req.destroy(Object.assign(new Error('LIMIT'),{code:'BODY_LIMIT'}));});
  res.on('end',()=>resolve({kind:'https',host,path:pathname,connection:cold?'new':'keep-alive',status:res.statusCode,bytes:received,totalMs:performance.now()-start,reusedSocket:req.reusedSocket,...timing}));
 });
 req.on('socket',socket=>{if(!socket.connecting)return;socket.once('lookup',()=>{timing.dnsMs=performance.now()-start;});socket.once('connect',()=>{timing.tcpMs=performance.now()-start;});socket.once('secureConnect',()=>{timing.tlsMs=performance.now()-start;});});
 req.setTimeout(12000,()=>req.destroy(Object.assign(new Error('TIMEOUT'),{code:'TIMEOUT'})));req.on('error',e=>resolve({kind:'https',host,path:pathname,connection:cold?'new':'keep-alive',error:e.code||e.name,totalMs:performance.now()-start,...timing}));req.end();
 });}
function health(host,cold){return new Promise(resolve=>{
 const client=cold?new Client(host+':443',grpc.credentials.createSsl()):grpcClients.get(host),start=performance.now();
 client.Health({},new grpc.Metadata(),{deadline:Date.now()+12000},(error,response)=>{if(cold)client.close();resolve({kind:'grpc-health',host,connection:cold?'new':'reused',totalMs:performance.now()-start,...(error?{errorCode:error.code}:{status:response.status})});});
 });}
try{
 for(const host of ['passwisely.cn','passwisely.com']){httpsClients.set(host,new https.Agent({keepAlive:true,maxSockets:1}));grpcClients.set(host,new Client(host+':443',grpc.credentials.createSsl()));}
 for(let i=0;i<10;i++){
  for(const operation of [host=>http(host,'/',i<3),host=>http(host,'/api/account',i<3),host=>health(host,i<3)]){
   const rows=await Promise.all(['passwisely.cn','passwisely.com'].map(operation));for(const row of rows)samples.push({iteration:i+1,...row});
  }
  console.log(`network ${i+1}/10; errors ${samples.filter(r=>r.error||r.errorCode).length}`);
 }
}finally{clearInterval(rssTimer);for(const agent of httpsClients.values())agent.destroy();for(const client of grpcClients.values())client.close();}
const report={schemaVersion:1,startedAt,endedAt:new Date().toISOString(),runtime:process.versions,arch:process.arch,vpn:'Kept unchanged at user request. Running under the current network state does not establish that Astrill routed this process or a VPN-on/off causal effect.',scope:'Fresh versus persistent TLS/HTTP2 connections; authenticated account reads if token supplied. No model calls, audio capture, GUI rendering, mobile LCP or configuration writes.',authenticated:!!token,resources:{cpuMicroseconds:process.cpuUsage(cpu),sampledPeakRssBytes:peakRss},samples};
fs.writeFileSync(args.out,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(`Saved ${samples.length} network observations`);
