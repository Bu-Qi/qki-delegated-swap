export const min=(a,b)=>a<b?a:b;
export function sqrt(n){if(n<0n)throw Error('Negative square root');if(n<2n)return n;let x=1n<<BigInt(Math.ceil(n.toString(2).length/2));for(;;){const y=(x+n/x)>>1n;if(y>=x)return x;x=y;}}
export function amountOut(x,rin,rout){if(x<0n||rin<=0n||rout<=0n)throw Error('Invalid reserves');return x*997n*rout/(rin*1000n+x*997n);}
export function amountIn(y,rin,rout){if(y<=0n||rin<=0n||y>=rout)throw Error('Not enough liquidity for fee conversion');return rin*y*1000n/((rout-y)*997n)+1n;}
export function quote(x,es){for(const e of es){x=amountOut(x,e.rIn,e.rOut);if(!x)break;}return x;}
export function optimum(es,cap){if(cap<=0n||!es.length)return null;let A=1n,B=1n,C=0n;for(const e of es){C=e.rIn*1000n*C+997n*A;A*=997n*e.rOut;B*=1000n*e.rIn;}if(A<=B)return null;
 let x=min((sqrt(A*B)-B)/C,cap);if(x<1n)x=1n;let best=null;
 // Rounding at each hop can shift the discrete optimum; sample the local neighbourhood.
 const sizes=new Set([x,x>1n?x-1n:x,x<cap?x+1n:x,x*999n/1000n,x*1001n/1000n]);
 for(const n of sizes){if(n<=0n||n>cap)continue;const output=quote(n,es),gross=output-n;if(!best||gross>best.gross)best={input:n,output,gross};}return best?.gross>0n?best:null;
}
export class TopK{
 constructor(cap){this.cap=cap;this.heap=[];}
 push(row){const h=this.heap;if(h.length<this.cap){h.push(row);let i=h.length-1;while(i){const p=(i-1)>>1;if(h[p].score<=h[i].score)break;[h[i],h[p]]=[h[p],h[i]];i=p;}return;}
  if(row.score<=h[0].score)return;h[0]=row;let i=0;for(;;){let j=i,l=i*2+1,r=l+1;if(l<h.length&&h[l].score<h[j].score)j=l;if(r<h.length&&h[r].score<h[j].score)j=r;if(j===i)break;[h[i],h[j]]=[h[j],h[i]];i=j;}
 }
 sorted(){return [...this.heap].sort((a,b)=>a.score>b.score?-1:a.score<b.score?1:0);}
}
export function graphFromPools(pools){const graph=new Map();for(const p of pools){if(!p.valid||!BigInt(p.r0)||!BigInt(p.r1))continue;for(const [a,b,x,y] of [[p.t0,p.t1,p.r0,p.r1],[p.t1,p.t0,p.r1,p.r0]]){const from=a.toLowerCase();if(!graph.has(from))graph.set(from,[]);graph.get(from).push({to:b.toLowerCase(),pair:p.pair,rIn:BigInt(x),rOut:BigInt(y)});}}
 let changed=true;while(changed){changed=false;for(const [a,es] of graph){const kept=es.filter(e=>graph.has(e.to));if(kept.length<2){graph.delete(a);changed=true;}else graph.set(a,kept);}}return graph;
}
export function gasBudget(estimate,withdraw=0n){return ((estimate+withdraw)*120n+99n)/100n;}
export function protectedOutput(output,input,fee,minProfit,slippageBps){const bySlip=output*BigInt(10000-slippageBps)/10000n,profitFloor=input+fee+minProfit;return bySlip>profitFloor?bySlip:profitFloor;}
