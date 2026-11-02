import {getAddress,parseUnits} from 'ethers';
export const CHAIN=Object.freeze({id:20181205,hex:'0x'+(20181205).toString(16),router:'0x3c91FD5247B050A1536F24D012a17a618EEFbfCA',factory:'0x4cB5B19e8316743519072170886355B0e2C717cF',wqki:'0x835F6dF988B6f51c9477D49e96aDBbc644ba97a2',usdt:'0xDF0e293CC3c7bA051763FF6b026DA0853D446E38'});
export const RPCS=['https://rpc3.qkiscan.io','https://rpc1.qkiscan.io','https://rpc2.qkiscan.io','https://rpc1.qkirpc.org','https://rpc2.qkirpc.org','https://rpc3.qkirpc.org','https://116.62.144.117','https://118.178.121.168','https://101.132.39.198','https://8.210.130.36','https://139.224.206.117'];
export const DEFAULTS={owner:'',rpc:'auto',gasGwei:'500',capitalUSDT:'100',capitalQKI:'300',minUSDT:'0.1',minQKI:'0.05',maxHops:6,maxTests:400,finalists:40,slippageBps:50};
export function normalizeConfig(input={}){
 const c={...DEFAULTS,...input};try{c.owner=getAddress(c.owner);}catch{throw Error('请填写有效的钱包地址，或先连接钱包。');}
 if(/^0x0{40}$/i.test(c.owner))throw Error('不能使用零地址。');
 for(const [key,decimals,allowZero] of [['gasGwei',9,false],['capitalUSDT',6,false],['capitalQKI',18,false],['minUSDT',6,true],['minQKI',18,true]]){
  const v=String(c[key]).trim();if(!/^\d+(\.\d+)?$/.test(v)||v.length>36)throw Error(key+' 需要有效的非负十进制数。');
  let n;try{n=parseUnits(v,decimals);}catch{throw Error(key+' 的小数位数过多。');}if((allowZero?n<0n:n<=0n)||n>10n**36n)throw Error(key+' 超出范围。');c[key]=v;
 }
 for(const [key,min,max] of [['maxHops',3,6],['maxTests',20,1600],['finalists',2,100],['slippageBps',1,500]]){c[key]=Number(c[key]);if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw Error(key+' 超出允许范围 '+min+'–'+max+'。');}
 if(c.rpc!=='auto'){let u;try{u=new URL(c.rpc);}catch{throw Error('RPC 地址无效。');}if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('RPC 只支持无内嵌凭证的 HTTP/HTTPS 地址。');c.rpc=u.href;}
 return Object.fromEntries(Object.keys(DEFAULTS).map(k=>[k,c[k]]));
}
