import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {CHAIN,DEFAULTS,RPCS,normalizeConfig} from './lib/config.mjs';
import {json,prepare,validatePrepared,receipt} from './lib/engine.mjs';
import {errorText} from './lib/rpc.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const readJson=(p,fallback)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return fallback;}};
export function createApp({dataDir=path.join(root,'data'),services={prepare,validatePrepared,receipt},workerFactory=(data)=>new Worker(new URL('./worker.mjs',import.meta.url),{workerData:data})}={}){
 fs.mkdirSync(dataDir,{recursive:true});
 let cache=readJson(path.join(dataDir,'cache.json'),readJson(path.join(root,'seed-paths.json'),{})),worker=null;
 const clients=new Set(),reviews=new Map(),state={status:'idle',progress:null,report:null,error:null,config:DEFAULTS,events:[]};
 const notify=(event)=>{state.events.push(event);state.events=state.events.slice(-100);for(const client of clients)client.write('data: '+JSON.stringify(event)+'\n\n');};
 function start(config,quick){if(worker)throw Object.assign(Error('已有扫描正在运行。'),{status:409});reviews.clear();state.status='running';state.error=null;state.report=null;state.config=config;state.events=[];
  const current=workerFactory({config,quick,cache});worker=current;notify({type:'started',quick,config});
  current.on('message',m=>{if(worker!==current)return;if(m.type==='progress'){state.progress=m.event;notify(m);}else if(m.type==='done'){
   const {cache:newCache,...publicReport}=m.report;state.report=publicReport;state.status='done';worker=null;cache=newCache;
   try{const temp=path.join(dataDir,'cache.next.json');fs.writeFileSync(temp,json(cache));fs.renameSync(temp,path.join(dataDir,'cache.json'));fs.writeFileSync(path.join(dataDir,'latest-report.json'),json(m.report));}catch(e){notify({type:'warning',message:'结果已生成，但本地保存失败：'+e.message});}
   notify({type:'done',report:state.report});current.terminate();
  }else if(m.type==='error'){state.status='error';state.error=m.message;worker=null;notify(m);current.terminate();}});
  current.on('error',e=>{if(worker!==current)return;worker=null;state.status='error';state.error=e.message;notify({type:'error',message:e.message});});
  current.on('exit',code=>{if(worker===current){worker=null;state.status='error';state.error='扫描进程提前退出（'+code+'），请重试。';notify({type:'error',message:state.error});}});
 }
 function cancel(){if(worker){const current=worker;worker=null;current.terminate();state.status='cancelled';state.report=null;state.progress=null;reviews.clear();notify({type:'cancelled'});}}
 const server=http.createServer(async(req,res)=>{
  const host=req.headers.host,port=server.address()?.port,allowed=new Set(['127.0.0.1:'+port,'localhost:'+port]);
  const send=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(body));};
  if(!allowed.has(host)){send(403,{error:'Host 不被允许。'});return;}
  const origin=req.headers.origin;if(origin&&!['http://127.0.0.1:'+port,'http://localhost:'+port].includes(origin)){send(403,{error:'只允许本地界面发起请求。'});return;}
  if(req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'拒绝跨站请求。'});return;}
  const url=new URL(req.url,'http://'+host);
  try{
   if(req.method==='GET'&&url.pathname==='/api/state'){send(200,{...state,chain:CHAIN,defaults:DEFAULTS,rpcs:RPCS});return;}
   if(req.method==='GET'&&url.pathname==='/api/events'){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive'});res.write(': connected\n\n');clients.add(res);const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(heartbeat);clients.delete(res);});return;}
   if(req.method==='GET'&&url.pathname==='/api/export'){if(!state.report){send(404,{error:'请先完成扫描。'});return;}res.writeHead(200,{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="qki-arbitrage-'+Date.now()+'.json"','cache-control':'no-store'});res.end(json(state.report));return;}
   if(req.method==='POST'&&url.pathname.startsWith('/api/')){
    if(!(req.headers['content-type']||'').startsWith('application/json')){send(415,{error:'需要 JSON 请求。'});return;}
    let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>65536){send(413,{error:'请求太大。'});return;}body+=chunk;}let data;try{data=JSON.parse(body||'{}');}catch{send(400,{error:'JSON 格式不正确。'});return;}
    if(url.pathname==='/api/scan'){start(normalizeConfig(data.config),Boolean(data.quick));send(202,{started:true});return;}
    if(url.pathname==='/api/cancel'){cancel();send(200,{cancelled:true});return;}
    if(url.pathname==='/api/prepare'){
     if(worker||!state.report){send(409,{error:'先完成当前扫描，再复核交易。'});return;}
     const owner=String(data.owner||'').toLowerCase();if(owner!==state.config.owner.toLowerCase()){send(409,{error:'连接钱包与扫描地址不一致，请换成该钱包地址重新扫描。'});return;}
     const route=state.report.routes.find(r=>r.id===data.routeId);if(data.approval===true&&data.withdraw===true){send(400,{error:'一次只复核一种操作。'});return;}if(data.approval!==true&&data.withdraw!==true&&!route){send(404,{error:'候选已失效，请重新扫描。'});return;}
     const config={...state.config},report=state.report;const review=await services.prepare(config,route,{approval:data.approval===true,withdraw:data.withdraw===true});
     if(worker||state.report!==report){send(409,{error:'扫描结果已改变，请重新复核。'});return;}
     reviews.clear();const id=crypto.randomUUID();reviews.set(id,{...review,config});send(200,{...review,reviewId:id});return;
    }
    if(url.pathname==='/api/validate'){
     const review=reviews.get(data.reviewId);if(!review||worker){send(410,{error:'复核已失效，请重新复核。'});return;}
     if(String(data.owner||'').toLowerCase()!==review.owner.toLowerCase()){send(409,{error:'钱包已经切换，请重新复核。'});return;}
     // Single-use review: even a double-click cannot authorize duplicate wallet requests.
     const report=state.report;reviews.delete(data.reviewId);const checked=await services.validatePrepared(review.config,review);if(worker||state.report!==report){send(409,{error:'扫描结果已改变，请重新复核。'});return;}send(200,checked);return;
    }
    if(url.pathname==='/api/receipt'){if(!state.report){send(409,{error:'没有扫描节点可用于查回执。'});return;}send(200,{receipt:await services.receipt(state.report.meta.rpc,String(data.hash||''))});return;}
    send(404,{error:'未知 API。'});return;
   }
   if(req.method!=='GET'){send(405,{error:'不支持此方法。'});return;}
   const files={'/':['public/index.html','text/html; charset=utf-8'],'/app.mjs':['public/app.mjs','text/javascript; charset=utf-8'],'/style.css':['public/style.css','text/css; charset=utf-8']};
   let file,mime;if(url.pathname==='/vendor/ethers.js'){file=fileURLToPath(new URL('../dist/ethers.umd.min.js',import.meta.resolve('ethers')));mime='text/javascript; charset=utf-8';}else if(files[url.pathname]){[file,mime]=files[url.pathname];file=path.join(root,file);}else{send(404,{error:'Not found'});return;}
   const content=fs.readFileSync(file);res.writeHead(200,{'content-type':mime,'x-content-type-options':'nosniff','cache-control':'no-store','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});res.end(content);
  }catch(e){if(!res.headersSent)send(e.status||400,{error:errorText(e)});else res.end();}
 });
 return {server,state,cancel,close:async()=>{cancel();for(const c of clients)c.end();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2),index=args.indexOf('--port'),port=index>=0?Number(args[index+1]):3847;
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Port must be between 1024 and 65535');
 const app=createApp();app.server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'端口已被占用，请打开已运行的 http://127.0.0.1:'+port+' 或用 --port 换端口。':e.message);process.exitCode=1;});
 app.server.listen(port,'127.0.0.1',()=>{const url='http://127.0.0.1:'+port;console.log('\nQKI 套利扫描器 1.0\n'+url+'\n保持此窗口开启；Ctrl+C 关闭。\n');if(!args.includes('--no-open')){const [cmd,argv]=process.platform==='win32'?['cmd',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];const p=spawn(cmd,argv,{stdio:'ignore'});p.on('error',()=>{});p.unref();}});
 process.on('SIGINT',()=>app.close().then(()=>process.exit(0)));
}
