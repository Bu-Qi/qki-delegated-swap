import assert from 'node:assert/strict';
import { parseTokenAmount, positiveInteger, parsePath, budgetFor, orderState, stripSolidityMetadata, UINT256_MAX, UINT64_MAX, ZERO } from '../docs/core.mjs';
import { keccak256 } from 'ethers';
import { AbiCoder, BrowserProvider } from 'ethers';
import ganache from 'ganache';
import { buildDeploymentPlan, deploymentStillMatches } from '../docs/deployment.mjs';
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
const deployment=JSON.parse(fs.readFileSync('docs/deployment.json'));
test('deployment data matches compiler bytecode and the fixed constructor argument',()=>{
 const bytecode='0x'+fs.readFileSync('build/QKIDelegatedMultiHop.bin','utf8').trim();
 assert.equal(deployment.bytecode,bytecode);
 assert.equal(deployment.data,bytecode+AbiCoder.defaultAbiCoder().encode(['address'],[deployment.router]).slice(2));
 assert.equal(deployment.initCodeHash,keccak256(deployment.data));
 assert.equal(deployment.chainId,20181205);
 assert.equal(deployment.value,'0');
});
const deploymentFixture={account:a,chainId:20181205n,data:deployment.data,initCodeHash:deployment.initCodeHash,gasPrice:500000000000n,estimatedGas:123n,balance:1000000000000000000n,blockGasLimit:30000000n,now:1000};
test('deployment review rounds up gas buffer and shows a fixed maximum fee',()=>{
 const plan=buildDeploymentPlan(deploymentFixture);
 assert.equal(plan.gasLimit,148n);
 assert.equal(plan.maxGasCost,148n*deploymentFixture.gasPrice);
 assert.equal(plan.value,0n);
});
test('deployment rejects wrong chain, zero sender, low balance and block gas overflow',()=>{
 for(const overrides of [{chainId:1n},{account:ZERO},{balance:0n},{blockGasLimit:100n},{gasPrice:0n}])assert.throws(()=>buildDeploymentPlan({...deploymentFixture,...overrides}));
});
test('deployment signature remains bound to account, chain, data hash, gas price and review expiry',()=>{
 const plan=buildDeploymentPlan(deploymentFixture);
 const context={account:a,chainId:20181205n,gasPrice:deploymentFixture.gasPrice,initCodeHash:deployment.initCodeHash,now:1001};
 assert.equal(deploymentStillMatches(plan,context),true);
 for(const overrides of [{account:b},{chainId:1n},{gasPrice:1n},{initCodeHash:'0x'+'11'.repeat(32)},{now:301001}])assert.equal(deploymentStillMatches(plan,{...context,...overrides}),false);
});

const local=ganache.provider({chain:{chainId:20181205,hardfork:'merge'},logging:{quiet:true}});
try{
 const provider=new BrowserProvider(local);provider.pollingInterval=10;
 await local.request({method:'evm_setAccountCode',params:[deployment.router,'0x60006000f3']});
 const signer=await provider.getSigner();const account=await signer.getAddress();
 const request={from:account,data:deployment.data,value:0n,gasPrice:500000000000n};
 const [estimate,balance,block]=await Promise.all([provider.estimateGas(request),provider.getBalance(account),provider.getBlock('latest')]);
 const plan=buildDeploymentPlan({account,chainId:20181205n,data:deployment.data,initCodeHash:deployment.initCodeHash,gasPrice:request.gasPrice,estimatedGas:estimate,balance,blockGasLimit:block.gasLimit});
 const hashes=JSON.parse(fs.readFileSync('docs/trusted-bytecode.json')).runtimeHashes;
 const simulated=await provider.call({...request,gasLimit:plan.gasLimit});
 assert(hashes.includes(keccak256(stripSolidityMetadata(simulated))));
 const transaction=await signer.sendTransaction({data:plan.data,value:0n,gasPrice:plan.gasPrice,gasLimit:plan.gasLimit,chainId:20181205n});
 const receipt=await transaction.wait();assert.equal(receipt.status,1);assert(receipt.contractAddress);
 assert(hashes.includes(keccak256(stripSolidityMetadata(await provider.getCode(receipt.contractAddress)))));
 ++passed;console.log('PASS shipped deployment payload estimates, simulates and deploys with matching runtime in local QKI EVM');
}finally{await local.disconnect();}
fs.writeFileSync('build/frontend-test-results.json',JSON.stringify({passed,failed:0,environment:'Node boundary tests and Ganache local QKI EVM; no live wallet deployment'},null,2)+'\n');
console.log(`All ${passed} frontend boundary tests passed.`);
