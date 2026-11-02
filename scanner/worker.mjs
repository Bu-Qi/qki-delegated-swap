import {parentPort,workerData} from 'node:worker_threads';
import {scan} from './lib/engine.mjs';
try{const report=await scan(workerData.config,{quick:workerData.quick,cache:workerData.cache,emit:event=>parentPort.postMessage({type:'progress',event})});parentPort.postMessage({type:'done',report});}catch(e){parentPort.postMessage({type:'error',message:e.message||String(e)});}
