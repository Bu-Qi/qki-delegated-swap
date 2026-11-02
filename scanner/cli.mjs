import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {scan,json} from './lib/engine.mjs';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf('--'+key);return i>=0?args[i+1]:fallback;};
if(args.includes('--help')||!option('owner')){console.log('node cli.mjs --owner 0x... [--quick] [--gas 500] [--rpc auto] [--tests 400] [--hops 6] [--out report.json]\n--quick 按已发现/内置路径重算；默认全面遍历3至6跳闭环。');process.exit(args.includes('--help')?0:1);}
const root=path.dirname(fileURLToPath(import.meta.url)),data=path.join(root,'data');fs.mkdirSync(data,{recursive:true});let cache={};for(const file of [path.join(data,'cache.json'),path.join(root,'seed-paths.json')]){try{cache=JSON.parse(fs.readFileSync(file));break;}catch{}}
try{
 const report=await scan({owner:option('owner'),rpc:option('rpc','auto'),gasGwei:option('gas','500'),maxTests:Number(option('tests','400')),finalists:Number(option('finalists','40')),maxHops:Number(option('hops','6'))},{quick:args.includes('--quick'),cache,emit:e=>console.log(e.message)});
 const output=path.resolve(option('out',path.join(data,'latest-report.json')));fs.writeFileSync(output,json(report));fs.writeFileSync(path.join(data,'cache.json'),json(report.cache));console.table(report.routes.map(r=>({asset:r.baseSymbol,path:r.symbols.join(' → '),input:r.input,output:r.outputAtLeast,net:r.net,gasQKI:r.gasCostQKI})));console.log('已保存：'+output);
}catch(e){console.error(e.message);process.exitCode=1;}
