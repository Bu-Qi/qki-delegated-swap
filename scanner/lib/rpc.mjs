import {CHAIN,RPCS} from './config.mjs';
export const READ_METHODS=new Set(['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getBalance','eth_getCode','eth_call','eth_estimateGas','eth_gasPrice','eth_getTransactionReceipt']);
export function rpcClient(url,{timeout=18000,retries=1}={}){let id=0;return async(method,params=[])=>{
 if(!READ_METHODS.has(method))throw Error('程序后端仅支持只读 RPC。');let last;
 for(let attempt=0;attempt<=retries;attempt++){try{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params}),signal:AbortSignal.timeout(timeout)});if(!response.ok)throw Error('RPC HTTP '+response.status);const body=await response.json();if(body.error)throw Object.assign(Error(body.error.message),{rpcError:body.error});if(body.result===undefined)throw Error('RPC 响应缺少 result');return body.result;}catch(e){last=e;if(e.rpcError||attempt===retries)throw e;}}
 throw last;
};}
export async function chooseRpc(setting='auto',emit=()=>{}){
 const urls=setting==='auto'?RPCS:[setting],rows=await Promise.all(urls.map(async url=>{const at=Date.now();try{const call=rpcClient(url,{timeout:setting==='auto'?(url.includes('qkiscan.io')?10000:4500):18000,retries:setting==='auto'?0:1});const [chain,block]=await Promise.all([call('eth_chainId'),call('eth_blockNumber')]);if(BigInt(chain)!==BigInt(CHAIN.id))throw Error('网络不是 QKI');return {url,block,height:BigInt(block),ms:Date.now()-at};}catch(e){return {url,error:e.message};}}));
 const good=rows.filter(r=>!r.error);if(!good.length)throw Error('没有可用的 QKI RPC，请手动选择节点重试。');const height=good.reduce((n,r)=>r.height>n?r.height:n,0n);const fresh=good.filter(r=>r.height+2n>=height).sort((a,b)=>a.ms-b.ms);emit({phase:'rpc',message:'选择节点 '+fresh[0].url,nodes:rows.map(({height,...r})=>r)});return {url:fresh[0].url,call:rpcClient(fresh[0].url)};
}
export async function limited(items,count,fn){let next=0;const out=Array(items.length);await Promise.all(Array.from({length:Math.min(count,items.length)},async()=>{while(next<items.length){const i=next++;out[i]=await fn(items[i],i);}}));return out;}
export function errorText(e){let raw=e.rpcError?.message||e.shortMessage||e.message||String(e);if(raw.includes('TRANSFER_FAILED'))return '代币转账被限制，或税费使交易池转账失败。';if(/QkswapV2: K/.test(raw))return '代币税或余额变化导致交易池 K 校验失败。';if(/INSUFFICIENT_OUTPUT_AMOUNT/.test(raw))return '实际到账已低于最低输出，当前报价已失效。';if(/insufficient funds|insufficient balance/i.test(raw))return 'QKI 余额不足以同时支付投入和 Gas 上限。';return String(raw).slice(0,360);}
