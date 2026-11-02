import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {CHAIN,DEFAULTS} from '../lib/config.mjs';
import * as ethers from 'ethers';

// Mock wallet and HTTP responses: this test never contacts a chain or broadcasts.
const owner='0x1111111111111111111111111111111111111111';
const route={id:'ui-test',baseSymbol:'USDT',path:[CHAIN.usdt,'0x2222222222222222222222222222222222222222','0x3333333333333333333333333333333333333333',CHAIN.usdt],symbols:['USDT','A','B','USDT'],inputRaw:'1000000',input:'1.0',outputAtLeast:'3.0',outputAsset:'USDT',net:'1.5',gasGwei:'500',hops:3,sharedRouteCount:0,gasCostQKI:'0.18',minimumOutput:'2.985',tx:{from:owner,to:CHAIN.router,chainId:CHAIN.hex,value:'0x0'}};
const report={config:{...DEFAULTS,owner},meta:{owner,nativeQKI:'10',USDT:'100',WQKI:'0',blockNumber:'1',at:new Date().toISOString(),rpc:'https://test.invalid'},routes:[route],scope:{tested:1},pendingApproval:[],tokens:[]};
const errors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',e=>errors.push(e.message));
const dom=new JSDOM(fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),{url:'http://127.0.0.1:3847',runScripts:'outside-only',virtualConsole});
const w=dom.window;w.ethers=ethers;let prepareDelay=0;const requests=[];
w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
w.EventSource=class {constructor(){w.events=this;}close(){}};
w.ethereum={on(){},async request({method}){requests.push(method);if(method==='eth_requestAccounts'||method==='eth_accounts')return [owner];if(method==='eth_chainId')return CHAIN.hex;throw Error('Unexpected wallet operation '+method);}};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn){const end=Date.now()+2500;while(!fn()){if(Date.now()>end)throw Error('UI condition timed out');await pause(10);}}
w.fetch=async(url,options)=>{let body;if(url==='/api/state')body={status:'done',config:report.config,report,chain:CHAIN,defaults:DEFAULTS,rpcs:[]};else if(url==='/api/prepare'){if(prepareDelay)await pause(prepareDelay);body={approval:false,owner,route,tx:route.tx,meta:report.meta,reviewId:'one-use-review',expiresAt:Date.now()+60000};}else if(url==='/api/validate'){await pause(200);body={tx:route.tx,expiresAt:Date.now()+60000};}else throw Error('Unexpected UI request '+url);return {ok:true,json:async()=>body};};
try{
 w.eval(fs.readFileSync(new URL('../public/app.mjs',import.meta.url),'utf8'));
 await waitFor(()=>w.document.querySelector('[data-execute]'));
 assert.equal(w.document.getElementById('result-count').textContent,'1');
 w.document.querySelector('[data-execute]').click();await waitFor(()=>w.document.getElementById('review').open);
 assert(w.document.getElementById('review-content').textContent.includes('最低输出'));
 assert.equal(w.document.getElementById('confirm').disabled,false);
 w.document.getElementById('confirm').click();w.document.getElementById('close-review').click();await pause(350);
 assert(!requests.includes('eth_sendTransaction'),'Closing during validation must prevent wallet send');
 prepareDelay=200;w.document.querySelector('[data-execute]').click();await pause(25);
 const gas=w.document.getElementById('gasGwei');gas.value='501';gas.dispatchEvent(new w.Event('input',{bubbles:true}));await pause(300);
 assert.equal(w.document.getElementById('review').open,false,'Late response must not reopen invalidated review');
 assert.equal(w.document.querySelector('[data-execute]').disabled,true,'Changed settings require rescan');
 assert.equal(w.document.getElementById('withdraw').disabled,true,'Zero WQKI cannot be redeemed');
 assert.deepEqual(errors,[]);
 console.log('PASS interface: render, protected review, cancellation race, late-response invalidation, changed configuration, no wallet broadcast');
}finally{w.close();}
