import fs from 'node:fs';
import crypto from 'node:crypto';
import solc from 'solc';
const source=fs.readFileSync('scanner/contracts/ReadOnlyProbe.sol','utf8');
const input={language:'Solidity',sources:{'ReadOnlyProbe.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'paris',outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}};
const output=JSON.parse(solc.compile(JSON.stringify(input)));const errors=(output.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
const c=output.contracts['ReadOnlyProbe.sol'].ReadOnlyProbe;
fs.writeFileSync('scanner/probe.json',JSON.stringify({compiler:solc.version(),evmVersion:'paris',sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),abi:c.abi,runtime:'0x'+c.evm.deployedBytecode.object},null,2)+'\n');
console.log('Read-only scanner probe compiled; no deployment or transaction.');
