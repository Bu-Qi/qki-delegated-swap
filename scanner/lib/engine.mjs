import fs from 'node:fs';
import crypto from 'node:crypto';
import {AbiCoder,Interface,formatUnits,parseUnits,toBeHex,toQuantity} from 'ethers';
import {CHAIN,normalizeConfig} from './config.mjs';
import {rpcClient,chooseRpc,limited,errorText} from './rpc.mjs';
import {amountIn,optimum,graphFromPools,TopK,min,gasBudget,protectedOutput} from './math.mjs';

const artifact=JSON.parse(fs.readFileSync(new URL('../probe.json',import.meta.url),'utf8'));
const probeABI=new Interface(artifact.abi),coder=AbiCoder.defaultAbiCoder();
const PROBE='0x00000000000000000000000000000000a11ce007';
export const erc=new Interface(['function balanceOf(address) view returns(uint)','function allowance(address,address) view returns(uint)','function decimals() view returns(uint8)','function approve(address,uint) returns(bool)','function withdraw(uint)']);
const factoryABI=new Interface(['function allPairsLength() view returns(uint)']);
export const routerABI=new Interface(['function factory() view returns(address)','function WQKI() view returns(address)','function getAmountOut(uint,uint,uint) view returns(uint)','function getAmountsIn(uint,address[]) view returns(uint[])','function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint,uint,address[],address,uint)','function swapExactQKIForTokensSupportingFeeOnTransferTokens(uint,address[],address,uint) payable']);
export const json=(x)=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2);
const edgeKey=(r,i)=>r.pairs[i].toLowerCase()+'/'+r.path[i].toLowerCase()+'/'+r.path[i+1].toLowerCase();
const pathKey=r=>r.path.join('/').toLowerCase();
const scoreCompare=(a,b)=>BigInt(a.netRaw)>BigInt(b.netRaw)?-1:BigInt(a.netRaw)<BigInt(b.netRaw)?1:0;

export class Context{
 constructor(config,url,call=rpcClient(url)){this.config=config;this.url=url;this.call=call;this.gp=parseUnits(config.gasGwei,9);this.overrides={[PROBE]:{code:artifact.runtime}};}
 async value(to,abi,name,args=[]){return abi.decodeFunctionResult(name,await this.call('eth_call',[{to,data:abi.encodeFunctionData(name,args)},this.block]))[0];}
 async init(){
  const c=this.config;this.block=await this.call('eth_blockNumber');
  const [header,chain,native,usdt,wqki,allowance,decimals,wDecimals,factory,w,fee,ownerCode,probeCode]=await Promise.all([
   this.call('eth_getBlockByNumber',[this.block,false]),this.call('eth_chainId'),this.call('eth_getBalance',[c.owner,this.block]),
   this.value(CHAIN.usdt,erc,'balanceOf',[c.owner]),this.value(CHAIN.wqki,erc,'balanceOf',[c.owner]),this.value(CHAIN.usdt,erc,'allowance',[c.owner,CHAIN.router]),this.value(CHAIN.usdt,erc,'decimals'),this.value(CHAIN.wqki,erc,'decimals'),
   this.value(CHAIN.router,routerABI,'factory'),this.value(CHAIN.router,routerABI,'WQKI'),this.value(CHAIN.router,routerABI,'getAmountOut',[1000000n,1000000000n,1000000000n]),this.call('eth_getCode',[c.owner,this.block]),this.call('eth_getCode',[PROBE,this.block])]);
  if(BigInt(chain)!==BigInt(CHAIN.id)||factory.toLowerCase()!==CHAIN.factory.toLowerCase()||w.toLowerCase()!==CHAIN.wqki.toLowerCase()||fee!==996006n||decimals!==6n||wDecimals!==18n)throw Error('节点网络、Router、精度或手续费与 QKI 配置不一致。');
  if(ownerCode!=='0x')throw Error('当前版本支持普通钱包地址；合约钱包需要独立执行适配。');if(probeCode!=='0x')throw Error('检测器临时地址已被链上代码占用，已停止。');
  this.header=header;this.native=BigInt(native);this.usdt=usdt;this.wqki=wqki;this.allowance=allowance;
  if(usdt>0n){const key=keccakAllowance(c.owner,PROBE,5);this.overrides[CHAIN.usdt]={stateDiff:{[key]:toBeHex((1n<<256n)-1n,32)}};
   const response=await this.call('eth_call',[{to:CHAIN.usdt,data:erc.encodeFunctionData('allowance',[c.owner,PROBE])},this.block,this.overrides]);
   if(erc.decodeFunctionResult('allowance',response)[0]!==((1n<<256n)-1n))throw Error('USDT 授权布局验证失败，不能可靠模拟。');
  }
  // Empty-code overrides must execute, not silently return 0x.
  try{await this.probe('pools',[CHAIN.factory,0,0]);}catch(e){throw Error('此 RPC 不支持可靠的只读状态覆盖，请换节点。'+errorText(e));}
  return this;
 }
 meta(){return {chainId:CHAIN.id,block:this.block,blockNumber:BigInt(this.block).toString(),blockHash:this.header.hash,at:new Date(Number(BigInt(this.header.timestamp))*1000).toISOString(),rpc:this.url,owner:this.config.owner,nativeQKI:formatUnits(this.native,18),USDT:formatUnits(this.usdt,6),WQKI:formatUnits(this.wqki,18),USDTAllowance:formatUnits(this.allowance,6),gasGwei:this.config.gasGwei};}
 async probe(name,args,options={}){const tx={to:PROBE,from:this.config.owner,data:probeABI.encodeFunctionData(name,args),gas:'0x1c9c380',gasPrice:'0x0',...options};const out=await this.call('eth_call',[tx,this.block,this.overrides]);return probeABI.decodeFunctionResult(name,out);}
 async pools(emit){const count=Number(await this.value(CHAIN.factory,factoryABI,'allPairsLength'));if(count>20000)throw Error('池子数量异常，已停止。');let done=0;
  const pages=Array.from({length:Math.ceil(count/75)},(_,i)=>i*75);
  return (await limited(pages,3,async start=>{const [rows]=await this.probe('pools',[CHAIN.factory,start,75]);done+=rows.length;emit({phase:'pools',message:`读取池子 ${done}/${count}`,done,total:count});return rows.map(p=>({pair:p.pair,t0:p.t0,t1:p.t1,r0:String(p.r0),r1:String(p.r1),b0:String(p.b0),b1:String(p.b1),valid:p.valid}));})).flat();
 }
 async tokens(addresses){return (await limited(Array.from({length:Math.ceil(addresses.length/70)},(_,i)=>addresses.slice(i*70,i*70+70)),3,async ts=>{const [rows]=await this.probe('tokens',[ts]);return rows.map(t=>({address:t.token,symbol:t.symbol.slice(0,60),decimals:Number(t.decimals),precisionKnown:t.precisionKnown}));})).flat();}
 cap(symbol){if(symbol==='USDT')return min(this.usdt,parseUnits(this.config.capitalUSDT,6));const reserve=this.gp*750000n;return this.native>reserve?min(this.native-reserve,parseUnits(this.config.capitalQKI,18)):0n;}
 minimum(symbol){return parseUnits(symbol==='USDT'?this.config.minUSDT:this.config.minQKI,symbol==='USDT'?6:18);}
 checkRoute(r){const base=r.baseSymbol==='USDT'?CHAIN.usdt:CHAIN.wqki;if(!['USDT','QKI'].includes(r.baseSymbol)||r.path.length<4||r.path.length>7||r.path[0].toLowerCase()!==base.toLowerCase()||r.path.at(-1).toLowerCase()!==base.toLowerCase())throw Error('路径或起始资产不合法。');if(new Set(r.path.slice(0,-1).map(a=>a.toLowerCase())).size!==r.path.length-1)throw Error('路径重复经过同一代币。');}
 probeOptions(amount,isNative){const remaining=this.native-(isNative?amount:0n);if(remaining<=0n)throw Error('原生 QKI 余额不足。');const limit=min(3000000n,remaining/this.gp);if(limit<100000n)throw Error('原生 QKI 不足以支付模拟 Gas。');return {from:this.config.owner,gas:toQuantity(limit),gasPrice:toQuantity(this.gp),...(isNative?{value:toQuantity(amount)}:{})};}
 async measure(r){this.checkRoute(r);const amount=BigInt(r.inputRaw),isNative=r.baseSymbol==='QKI';if(amount<=0n||amount>this.cap(r.baseSymbol))throw Error('投入超过当前余额或配置上限。');const options=this.probeOptions(amount,isNative);
  return isNative?this.probe('nativeCycle',[CHAIN.router,CHAIN.wqki,r.path],options):this.probe('holderCycle',[CHAIN.router,CHAIN.usdt,this.config.owner,r.path,amount],options);
 }
 async fee(symbol,gas){const qki=gas*this.gp;if(symbol==='QKI')return qki;const amounts=await this.value(CHAIN.router,routerABI,'getAmountsIn',[qki,[CHAIN.usdt,CHAIN.wqki]]);return amounts[0];}
 tx(r,minOutput,gasLimit){const amount=BigInt(r.inputRaw),native=r.baseSymbol==='QKI';return {from:this.config.owner,to:CHAIN.router,chainId:CHAIN.hex,value:native?toQuantity(amount):'0x0',gas:toQuantity(gasLimit),gasPrice:toQuantity(this.gp),data:native?routerABI.encodeFunctionData('swapExactQKIForTokensSupportingFeeOnTransferTokens',[minOutput,r.path,this.config.owner,BigInt(this.header.timestamp)+180n]):routerABI.encodeFunctionData('swapExactTokensForTokensSupportingFeeOnTransferTokens',[amount,minOutput,r.path,this.config.owner,BigInt(this.header.timestamp)+180n])};}
 async verify(r){this.checkRoute(r);const amount=BigInt(r.inputRaw),d=r.baseSymbol==='USDT'?6:18;
  if(r.baseSymbol==='USDT'&&this.allowance<amount)throw Object.assign(Error('USDT 对 Router 的授权不足；授权后重新扫描。'),{needsApproval:true});
  const [out]=await this.measure(r);if(out<=amount)throw Error('兑换本身已经没有正毛收益。');
  const estimateTx=this.tx(r,amount+1n,BigInt(this.probeOptions(amount,r.baseSymbol==='QKI').gas));delete estimateTx.chainId;
  const estimate=BigInt(await this.call('eth_estimateGas',[estimateTx,this.block]));const totalGas=gasBudget(estimate,r.baseSymbol==='QKI'?75000n:0n),routerGas=gasBudget(estimate),fee=await this.fee(r.baseSymbol,totalGas),net=out-amount-fee;
  if(net<=0n||net<this.minimum(r.baseSymbol))throw Error('扣除 Gas 后低于最低净收益。');
  if((r.baseSymbol==='QKI'?amount:0n)+totalGas*this.gp>this.native)throw Error('当前 QKI 余额不足以支付投入和完整费用预算。');
  const guarded=this.tx(r,out,routerGas);delete guarded.chainId;await this.call('eth_call',[guarded,this.block]);
  const minOut=protectedOutput(out,amount,fee,this.minimum(r.baseSymbol),this.config.slippageBps);
  const id=crypto.createHash('sha256').update(r.baseSymbol+'/'+pathKey(r)+'/'+amount).digest('hex').slice(0,24);
  return {...r,id,decimals:d,outputRaw:String(out),input:formatUnits(amount,d),outputAtLeast:formatUnits(out,d),gross:formatUnits(out-amount,d),netRaw:String(net),net:formatUnits(net,d),gasEstimate:String(estimate),routerGasLimit:String(routerGas),totalGasBudget:String(totalGas),gasCostQKI:formatUnits(totalGas*this.gp,18),gasCostBase:formatUnits(fee,d),minimumOutputRaw:String(minOut),minimumOutput:formatUnits(minOut,d),gasGwei:this.config.gasGwei,verified:true,block:this.block,outputAsset:r.baseSymbol==='QKI'?'WQKI':'USDT',withdrawReserveGas:r.baseSymbol==='QKI'?'75000':'0',tx:this.tx(r,minOut,routerGas)};
 }
 async auxiliary(withdraw=false){const amount=withdraw?this.wqki:this.cap('USDT');if(amount<=0n)throw Error(withdraw?'钱包没有可赎回的 WQKI。':'钱包没有可授权的 USDT。');
  const tx={from:this.config.owner,to:withdraw?CHAIN.wqki:CHAIN.usdt,chainId:CHAIN.hex,value:'0x0',gasPrice:toQuantity(this.gp),data:withdraw?erc.encodeFunctionData('withdraw',[amount]):erc.encodeFunctionData('approve',[CHAIN.router,amount])},raw={...tx};delete raw.chainId;
  const estimate=BigInt(await this.call('eth_estimateGas',[raw,this.block]));tx.gas=toQuantity(gasBudget(estimate));if(BigInt(tx.gas)*this.gp>this.native)throw Error('QKI 不足以支付操作费用。');await this.call('eth_call',[{...raw,gas:tx.gas},this.block]);
  return {approval:!withdraw,withdraw,owner:this.config.owner,amount:formatUnits(amount,withdraw?18:6),spender:withdraw?undefined:CHAIN.router,gasCostQKI:formatUnits(BigInt(tx.gas)*this.gp,18),tx,meta:this.meta(),expiresAt:Date.now()+60000};
 }
}
// Known USDT layout is independently checked by the public allowance getter at each snapshot.
export function keccakAllowance(owner,spender,slot){return importKeccak(coder.encode(['address','bytes32'],[spender,importKeccak(coder.encode(['address','uint256'],[owner,slot]))]));}
import {keccak256 as importKeccak} from 'ethers';

function enumerate(pools,ctx,emit,cachedPaths,quick){
 const graph=graphFromPools(pools),allEdges=new Map();for(const p of pools){if(!p.valid||!BigInt(p.r0)||!BigInt(p.r1))continue;for(const [a,b,x,y] of [[p.t0,p.t1,p.r0,p.r1],[p.t1,p.t0,p.r1,p.r0]])allEdges.set(a.toLowerCase()+'/'+b.toLowerCase(),{to:b.toLowerCase(),pair:p.pair,rIn:BigInt(x),rOut:BigInt(y)});}
 const buckets={},scope={mode:quick?'quick':'full',cycleTokens:graph.size,bases:{},truncated:false};
 for(const symbol of ['USDT','QKI']){
  const base=(symbol==='USDT'?CHAIN.usdt:CHAIN.wqki).toLowerCase(),cap=ctx.cap(symbol),d=symbol==='USDT'?6:18,heaps=new Map([3,4,5,6].map(h=>[h,new TopK(750)])),first=new Map();let cycles=0,visits=0,truncated=false;
  const evaluate=(path,es)=>{const best=optimum(es,cap);if(!best||best.gross<parseUnits('0.01',d))return;const r={baseSymbol:symbol,path,pairs:es.map(e=>e.pair),hops:es.length,inputRaw:String(best.input),score:best.gross};heaps.get(es.length).push(r);if(!first.has(path[1]))first.set(path[1],new TopK(3));first.get(path[1]).push(r);return r;};
  const revisit=[];if(cap>0n){for(const r of cachedPaths){if(r.baseSymbol!==symbol||!Array.isArray(r.path)||r.path.length<4||r.path.length-1>ctx.config.maxHops)continue;const path=r.path.map(a=>a.toLowerCase()),es=path.slice(1).map((a,i)=>allEdges.get(path[i]+'/'+a));if(es.every(Boolean)){if(quick)cycles++;const row=evaluate(path,es);if(row)revisit.push(row);}}}
  if(cap>0n&&!quick){const dfs=(a,path,es,seen,spot)=>{if(++visits>12000000){truncated=true;return;}if(visits%100000===0)emit({phase:'enumerate',message:`${symbol} 已遍历 ${visits.toLocaleString()} 个分支`,visits,cycles});for(const e of graph.get(a)||[]){const ratio=Number(e.rOut)/Number(e.rIn)*.997;if(e.to===base){if(es.length>=2){cycles++;if(spot*ratio>1.000000001)evaluate([...path,base],[...es,e]);}continue;}if(es.length+1>=ctx.config.maxHops||seen.has(e.to))continue;seen.add(e.to);dfs(e.to,[...path,e.to],[...es,e],seen,spot*ratio);seen.delete(e.to);if(truncated)return;}};dfs(base,[base],[],new Set([base]),1);}
  buckets[symbol]={revisit:revisit.sort((a,b)=>a.score>b.score?-1:1),hops:new Map([...heaps].map(([h,heap])=>[h,heap.sorted()])),diverse:[...first.values()].flatMap(x=>x.sorted())};scope.bases[symbol]={capitalCap:formatUnits(cap,d),cycles,visits,truncated};scope.truncated||=truncated;
 }
 return {buckets,scope,allEdges};
}

export async function scan(input,{quick=false,cache={},emit=()=>{}}={}){
 const config=normalizeConfig(input),picked=await chooseRpc(config.rpc,emit),ctx=await new Context(config,picked.url,picked.call).init();emit({phase:'snapshot',message:'已读取钱包与区块快照',meta:ctx.meta()});
 if(ctx.native<ctx.gp*21000n)throw Error('钱包没有足够原生 QKI 支付交易 Gas，无法验证可执行机会。');
 const pools=await ctx.pools(emit),addresses=[...new Set(pools.filter(p=>p.valid).flatMap(p=>[p.t0,p.t1]))],tokens=await ctx.tokens(addresses),names=new Map(tokens.map(t=>[t.address.toLowerCase(),t.symbol||t.address.slice(0,10)]));
 const validCache=cache.chainId===CHAIN.id&&cache.factory?.toLowerCase()===CHAIN.factory.toLowerCase()?cache.knownPaths||[]:[];
 const {buckets,scope,allEdges}=enumerate(pools,ctx,emit,validCache,quick&&validCache.length>0),bad=new Map(),seen=new Set(),screen=[],failures={},pendingApproval=[];let tests=0,completed=0,diagnostics=0;
 const uEdge=allEdges.get(CHAIN.usdt.toLowerCase()+'/'+CHAIN.wqki.toLowerCase());
 const blocked=r=>r.pairs.some((_,i)=>(bad.get(edgeKey(r,i))||0)>=2);
 async function test(r){tests++;r={...r,symbols:r.path.map(a=>names.get(a.toLowerCase())||a.slice(0,10))};try{const [out,used]=await ctx.measure(r),gas=gasBudget(used+50000n),nativeCost=gas*ctx.gp,fee=r.baseSymbol==='QKI'?nativeCost:amountIn(nativeCost,uEdge.rIn,uEdge.rOut),net=out-BigInt(r.inputRaw)-fee;
   if(out>BigInt(r.inputRaw))screen.push({...r,observedOutput:String(out),netRaw:String(net)});
  }catch(e){const text=errorText(e);failures[text]=(failures[text]||0)+1;
   if(diagnostics<60&&/TRANSFER_FAILED|QkswapV2: K/.test(e.rpcError?.message||'')){diagnostics++;try{await ctx.probe('diagnose',[CHAIN.router,r.baseSymbol==='QKI'?CHAIN.wqki:CHAIN.usdt,config.owner,r.path,BigInt(r.inputRaw),r.baseSymbol==='QKI'],ctx.probeOptions(BigInt(r.inputRaw),r.baseSymbol==='QKI'));}catch(d){try{const parsed=probeABI.parseError(d.rpcError?.data);if(parsed?.name==='HopFailed'){const k=edgeKey(r,Number(parsed.args[0]));bad.set(k,(bad.get(k)||0)+1);}}catch{}}}
  }if(++completed%10===0)emit({phase:'simulate',message:`已模拟 ${completed} 个候选，${screen.length} 个有正毛收益`,tested:completed,limit:config.maxTests});
 }
 for(const symbol of ['USDT','QKI']){const budget=Math.floor(config.maxTests/2),start=tests,b=buckets[symbol];async function group(rows,n,ignoreBlocked=false){let next=0,claimed=0;await limited(Array(4).fill(0),4,async()=>{while(next<rows.length&&claimed<n&&tests-start<budget){const raw=rows[next++],key=pathKey(raw)+':'+raw.inputRaw;if(BigInt(raw.inputRaw)<=0n||seen.has(key)||(!ignoreBlocked&&blocked(raw)))continue;seen.add(key);claimed++;await test(raw);}});}
  await group(b.revisit,Math.min(10,Math.max(2,Math.floor(budget*.2))));
  for(const [h,fraction] of [[3,.20],[4,.25],[5,.25],[6,.15]]){if(h>config.maxHops)continue;await group(b.hops.get(h),Math.max(5,Math.floor(budget*fraction)));}
  const rest=[...b.hops.values()].flat().sort((a,b)=>a.score>b.score?-1:1),smaller=rest.slice(0,60).flatMap(r=>[10n,100n].map(divisor=>({...r,inputRaw:String(BigInt(r.inputRaw)/divisor)})));
  await group(smaller,Math.max(2,Math.floor(budget*.1)),true);await group(b.diverse,budget);await group(rest,budget);
 }
 emit({phase:'verify',message:'刷新区块，并用真实 Router 验证最终候选'});
 const final=await new Context(config,picked.url).init(),selected=[];
 for(const symbol of ['USDT','QKI']){const rows=screen.filter(r=>r.baseSymbol===symbol).sort(scoreCompare),chosen=[],seenPaths=new Set(),firstSeen=new Set(),limit=Math.ceil(config.finalists/2);
  for(const r of rows){if(firstSeen.size>=5)break;if(firstSeen.has(r.path[1]))continue;firstSeen.add(r.path[1]);chosen.push(r);seenPaths.add(pathKey(r));}
  for(const r of rows){if(chosen.length>=limit)break;if(!seenPaths.has(pathKey(r))){chosen.push(r);seenPaths.add(pathKey(r));}}selected.push(...chosen.slice(0,limit));
 }
 let checked=0;const routes=(await limited(selected,4,async r=>{try{return await final.verify(r);}catch(e){if(e.needsApproval)pendingApproval.push({baseSymbol:r.baseSymbol,path:r.path,symbols:r.symbols,inputRaw:r.inputRaw,reason:e.message});else failures[errorText(e)]=(failures[errorText(e)]||0)+1;return null;}finally{emit({phase:'verify',message:`真实地址复核 ${++checked}/${selected.length}`,done:checked,total:selected.length});}})).filter(Boolean).sort((a,b)=>a.baseSymbol===b.baseSymbol?scoreCompare(a,b):a.baseSymbol.localeCompare(b.baseSymbol));
 if((await final.call('eth_getBlockByNumber',[final.block,false])).hash!==final.header.hash)throw Error('区块发生重组，请重新扫描。');
 const conflicts={};for(const r of routes)for(const p of r.pairs)(conflicts[p.toLowerCase()]??=[]).push(r.id);for(const r of routes){r.sharedRouteCount=new Set(r.pairs.flatMap(p=>conflicts[p.toLowerCase()]||[])).size-1;delete r.score;}
 const known=new Map();for(const r of [...screen,...routes,...validCache])known.set(pathKey(r),{baseSymbol:r.baseSymbol,path:r.path});
 return {version:1,config,meta:final.meta(),screenMeta:ctx.meta(),scope:{...scope,registeredPools:pools.length,fundedPools:pools.filter(p=>p.valid&&BigInt(p.r0)&&BigInt(p.r1)).length,tokens:tokens.length,tested:tests,finalRechecked:selected.length,verifiedProfitable:routes.length},routes,pendingApproval,failures,tokens,cache:{chainId:CHAIN.id,factory:CHAIN.factory,knownPaths:[...known.values()].slice(0,12000)},notes:['同池路线的收益不能相加；每次成交后需要重算。','原生 QKI 路线输出 WQKI，净收益包含另行赎回的 75000 Gas 预算。','只有 routes 中的条目通过真实地址的无状态覆盖 Router 调用；待授权条目尚未通过执行复核。','金额是已测试的参考值，不保证是含税后全局最优投入。']};
}

export async function prepare(input,route,{approval=false,withdraw=false}={}){
 const config=normalizeConfig(input),{url,call}=await chooseRpc(config.rpc),ctx=await new Context(config,url,call).init();
 if(approval||withdraw)return ctx.auxiliary(withdraw);
 const verified=await ctx.verify(route);return {approval:false,owner:config.owner,route:verified,tx:verified.tx,meta:ctx.meta(),expiresAt:Date.now()+60000};
}
export async function validatePrepared(input,review){if(Date.now()>review.expiresAt)throw Error('复核结果已超过 60 秒，请重新复核。');const config=normalizeConfig(input);if(config.owner.toLowerCase()!==review.owner.toLowerCase())throw Error('钱包地址已改变，请重新扫描。');
 const ctx=await new Context(config,review.meta.rpc).init(),tx={...review.tx};delete tx.chainId;if(tx.from.toLowerCase()!==config.owner.toLowerCase()||BigInt(tx.gasPrice)!==ctx.gp)throw Error('交易参数与复核不一致。');
 if(!review.approval&&!review.withdraw){const r=review.route,amount=BigInt(r.inputRaw),fee=await ctx.fee(r.baseSymbol,BigInt(r.totalGasBudget));if(BigInt(r.minimumOutputRaw)<amount+fee+ctx.minimum(r.baseSymbol))throw Error('池价变化后最低输出不能覆盖 Gas 和最低净收益，请重新复核。');if(r.baseSymbol==='USDT'&&(ctx.usdt<amount||ctx.allowance<amount))throw Error('余额或授权已改变。');if((r.baseSymbol==='QKI'?amount:0n)+BigInt(r.totalGasBudget)*ctx.gp>ctx.native)throw Error('QKI 余额已不足。');}
 await ctx.call('eth_call',[tx,ctx.block]);return {tx:review.tx,block:ctx.block,expiresAt:review.expiresAt};
}
export function summarizeReceipt(r){return {hash:r.transactionHash,status:Number(BigInt(r.status)),blockNumber:BigInt(r.blockNumber).toString(),gasUsed:BigInt(r.gasUsed).toString(),effectiveGasPrice:r.effectiveGasPrice,gasCostQKI:r.effectiveGasPrice?formatUnits(BigInt(r.gasUsed)*BigInt(r.effectiveGasPrice),18):null};}
export async function receipt(url,hash){if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('交易哈希无效。');const call=rpcClient(url);const r=await call('eth_getTransactionReceipt',[hash]);return r?summarizeReceipt(r):null;}
