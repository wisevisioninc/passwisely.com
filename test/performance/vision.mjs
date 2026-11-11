// Three synthetic screenshots through production question extraction + solution code.
// No native screen capture, user audio, private screenshots, or fabricated model answers.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {loadProduction} from '../leetcode/scripts/production-loader.mjs';
import {loadToken} from '../leetcode/scripts/run-live.mjs';
const options=Object.fromEntries(process.argv.slice(2).map((v,i,a)=>v.startsWith('--')?[v.slice(2),a[i+1]]:null).filter(Boolean));
if(!options.live||!options.out||!options['images-dir']||!options['token-file'])throw Error('Required: --live yes --out NEW_DIR --images-dir DIR --token-file PRIVATE_JSON');
const root=fileURLToPath(new URL('../../',import.meta.url)),token=loadToken(options['token-file']),logs=[];
const production=loadProduction(root,(level,text)=>{logs.push({level,text:text.split(token).join('[redacted]')});});
const output=path.resolve(options.out);fs.mkdirSync(output,{mode:0o700});
const slugs=['pass-the-pillow','delete-and-earn','minimum-number-of-taps-to-open-to-water-a-garden'];
const records=[],cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss;
const memoryTimer=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},100);
try{for(const slug of slugs){
 const image=fs.readFileSync(path.join(options['images-dir'],slug+'.png'));if(image.length>690000)throw Error('Synthetic image exceeds the existing single-image budget');
 let firstContentMs=null,firstParseableProgressMs=null,completion=null,calls=0,started;
 const window={isDestroyed:()=>false,webContents:{executeJavaScript:async expression=>{if(expression!=='window.__LANGUAGE__')throw Error('Unexpected UI state read');return 'python';},send:(event,payload)=>{if(event==='solution-progress'&&firstParseableProgressMs===null)firstParseableProgressMs=performance.now()-started;}}};
 const helper=new production.ProcessingHelper({getScreenshotHelper:()=>({}),getWiseAccessToken:()=>token,getMainWindow:()=>window,setHasDebugged(){},setProblemInfo(){},setView(){},onAuthenticationFailure(){},PROCESSING_EVENTS:{PROBLEM_EXTRACTED:'benchmark-problem-extracted'}});
 helper.configure({provider:'kimi',providerLabel:'Kimi / Moonshot',apiKey:'',model:'kimi-k3.1-pro',baseUrl:'https://api.moonshot.cn/v1',supportsVision:true,supportsJsonMode:true,responseLanguage:'zh-CN',route:'wise',usesWiseDefaultKey:true});
 const original=helper.streamCompletion.bind(helper);
 helper.streamCompletion=async(body,signal,update,...rest)=>{calls++;const result=await original(body,signal,(text,model)=>{if(text&&firstContentMs===null)firstContentMs=performance.now()-started;update(text,model);},...rest);completion=result;return result;};
 started=performance.now();let result;
 try{result=await helper.solveScreenshotProblemHelper([{data:image.toString('base64'),mimeType:'image/png'}],'',AbortSignal.timeout(95000));}
 catch(e){result={success:false,error:String(e.message).split(token).join('[redacted]')};}
 finally{try{helper.cancelOngoingRequests();}finally{helper.wiseGrpcClient?.close();}}
 const record={slug,transport:'production ProcessingHelper multimodal gRPC stream',imageSha256:createHash('sha256').update(image).digest('hex'),imageBytes:image.length,firstContentMs,firstParseableProgressMs,totalMs:performance.now()-started,model:completion?.model,finishReason:completion?.choices?.[0]?.finish_reason,usage:completion?.usage,productionModelCalls:calls,success:result.success,error:result.error||null,problemStatement:result.data?.problem_statement||'',fullAnswer:result.data?.code?'```python\n'+result.data.code+'\n```':'',solution:result.data||null};
 fs.writeFileSync(path.join(output,slug+'.answer.json'),JSON.stringify(record,null,2)+'\n',{flag:'wx',mode:0o600});records.push(record);console.log(`${slug}: ${record.success}; first=${Math.round(firstContentMs||0)}ms total=${Math.round(record.totalMs)}ms calls=${calls}`);
}}finally{clearInterval(memoryTimer);}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify({records:records.map(({fullAnswer,solution,problemStatement,...r})=>r),resources:{cpuMicroseconds:process.cpuUsage(cpu),sampledPeakRssBytes:peakRss},scope:'Synthetic images + real production extraction/solution transport; native capture, image preprocessing and actual GUI rendering excluded.',logs},null,2)+'\n',{flag:'wx',mode:0o600});
