import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const {validateNode,checkFiles,findNpmCli,runLauncher}=require('../launch.cjs');

test('launcher rejects old Node versions with an installation hint',()=>{
 assert.throws(()=>validateNode('18.20.0'),/20.*18\.20/);
 assert.doesNotThrow(()=>validateNode('20.0.0'));
});
test('both Windows entry points use ASCII CRLF and the worker shell stays open',()=>{
 for(const file of ['../start-windows.cmd','../../start-scanner-windows.cmd']){
  const bytes=fs.readFileSync(new URL(file,import.meta.url));
  assert([...bytes].every(b=>b<128));
  assert(bytes.includes(Buffer.from('\r\n')));
  assert(!bytes.toString().replaceAll('\r\n','').includes('\n'));
 }
 const source=fs.readFileSync(new URL('../start-windows.cmd',import.meta.url),'ascii');
 assert(source.includes('/d /v:off /s /k'));
 assert(source.includes('"%~dp0launch.cjs"'));
});
test('incomplete ZIP extraction produces an actionable error',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qki-missing-'));
 try{assert.throws(()=>checkFiles(dir),/完整解压 ZIP/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('npm CLI lookup supports Node installation paths containing spaces',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qki node-'));
 try{const cli=path.join(dir,'node_modules/npm/bin/npm-cli.js');fs.mkdirSync(path.dirname(cli),{recursive:true});fs.writeFileSync(cli,'');assert.equal(findNpmCli(path.join(dir,'node.exe')),cli);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('child startup failures retain their original stderr in a persistent log',async()=>{
 const parent=fileURLToPath(new URL('../test-output/',import.meta.url));fs.mkdirSync(parent,{recursive:true});
 const root=fs.mkdtempSync(path.join(parent,'中文 & (startup)-'));
 try{
  for(const file of ['server.mjs','package.json','package-lock.json','probe.json','lib/engine.mjs','public/index.html','public/app.mjs','public/style.css']){const p=path.join(root,file);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,file==='package.json'?'{"type":"module"}':'');}
  fs.writeFileSync(path.join(root,'server.mjs'),'console.error("EXPECTED_STARTUP_DIAGNOSTIC"); process.exitCode=7;');
  const logDirectory=path.join(root,'logs');
  await assert.rejects(runLauncher({root,logDirectory,noOpen:true,write:()=>{},errorWrite:()=>{}}),/退出码 7/);
  const log=fs.readFileSync(path.join(logDirectory,'startup.log'),'utf8');
  assert(log.includes('EXPECTED_STARTUP_DIAGNOSTIC'));assert(log.includes('程序目录：'+root));
  assert(log.includes('日志位置：'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
