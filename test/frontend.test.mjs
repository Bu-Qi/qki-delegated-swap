import assert from 'node:assert/strict';
import { parseTokenAmount, positiveInteger, parsePath, budgetFor, orderState, stripSolidityMetadata, UINT256_MAX, UINT64_MAX, ZERO } from '../docs/core.mjs';
import { keccak256 } from 'ethers';
import fs from 'node:fs';

let passed=0;
function test(name,fn){fn();++passed;console.log(`PASS ${name}`);}
const a='0x1111111111111111111111111111111111111111';
const b='0x2222222222222222222222222222222222222222';
const c='0x3333333333333333333333333333333333333333';
const order={owner:a,executor:ZERO,amountIn:100n,deadline:1000n,remainingExecutions:1n,cancelled:false};
test('token units preserve exact integers beyond Number precision',()=>{
 assert.equal(parseTokenAmount('12345678901234567890.123456789012345678',18),12345678901234567890123456789012345678n);
 assert.equal(parseTokenAmount('0.000001',6),1n);
 assert.equal(parseTokenAmount('123',0),123n);
 for(const value of ['0','-1','1e18','NaN','0.0000001','1.0000000'])assert.throws(()=>parseTokenAmount(value,6));
});
test('uint limits and cumulative execution budget reject overflow',()=>{
 assert.equal(positiveInteger(UINT64_MAX.toString(),UINT64_MAX),UINT64_MAX);
 assert.equal(budgetFor(100n,3n),300n);
 assert.throws(()=>positiveInteger((UINT64_MAX+1n).toString(),UINT64_MAX));
 assert.throws(()=>budgetFor(UINT256_MAX,2n));
 assert.throws(()=>budgetFor(1n,0n));
});
test('paths allow cycles and reject invalid addresses or repeated neighbors',()=>{
 assert.deepEqual(parsePath(JSON.stringify([a,b,a])),[a,b,a]);
 assert.deepEqual(parsePath(`${a}, ${b}`),[a,b]);
 for(const path of [[a,a],[a,ZERO],[a],Array(17).fill(a),[a,'<script>']])assert.throws(()=>parsePath(JSON.stringify(path)));
});
test('executor check allows holder and selected keeper, rejects other address',()=>{
 const fixed={...order,executor:b};
 assert.equal(orderState(fixed,{now:900,account:b}).eligible,true);
 assert.equal(orderState(fixed,{now:900,account:a}).eligible,true);
 assert.equal(orderState(fixed,{now:900,account:c}).eligible,false);
 assert.equal(orderState(order,{now:900,account:c}).eligible,true);
 assert.equal(orderState(order,{now:900}).eligible,false);
});
test('deadline matches contract boundary, cancellation and pause stop execution',()=>{
 assert.equal(orderState(order,{now:1000,account:b}).eligible,true);
 assert.equal(orderState(order,{now:1001,account:b}).eligible,false);
 assert.equal(orderState(order,{now:900,account:b,paused:true}).eligible,false);
 assert.equal(orderState({...order,cancelled:true},{now:900,account:b}).eligible,false);
 assert.equal(orderState({...order,remainingExecutions:0n},{now:900,account:b}).eligible,false);
});
test('funding checks reject insufficient owner balance and allowance',()=>{
 assert.equal(orderState(order,{now:900,account:b,balance:99n,allowance:100n}).eligible,false);
 assert.equal(orderState(order,{now:900,account:b,balance:100n,allowance:99n}).eligible,false);
 assert.equal(orderState(order,{now:900,account:b,balance:100n,allowance:100n}).eligible,true);
});
test('runtime verification removes only the declared metadata trailer',()=>{
 assert.equal(stripSolidityMetadata('0x60016002aabb0002'),'0x60016002');
 assert.notEqual(keccak256(stripSolidityMetadata('0x60016002aabb0002')),keccak256(stripSolidityMetadata('0x60016003aabb0002')));
 for(const code of ['0x','0x600100ff','bad'])assert.throws(()=>stripSolidityMetadata(code));
});
test('published ABI and verification whitelist match compiled artifacts',()=>{
 assert.deepEqual(JSON.parse(fs.readFileSync('docs/contract.abi.json')),JSON.parse(fs.readFileSync('build/QKIDelegatedMultiHop.abi.json')));
 assert.deepEqual(JSON.parse(fs.readFileSync('docs/trusted-bytecode.json')),JSON.parse(fs.readFileSync('build/contract-verification.json')));
 const hashes=JSON.parse(fs.readFileSync('docs/trusted-bytecode.json')).runtimeHashes;
 assert(hashes.length>=1&&hashes.every(h=>/^0x[0-9a-f]{64}$/.test(h)));
});
console.log(`All ${passed} frontend boundary tests passed.`);
