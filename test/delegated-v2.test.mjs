import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,Contract,ZeroAddress,keccak256} from 'ethers';
import {compile} from '../scripts/compile.mjs';
import {ROUTER,stripSolidityMetadata} from '../docs/core.mjs';

const {output}=compile(true);
const rpc=ganache.provider({chain:{chainId:20181205,hardfork:'merge'},wallet:{totalAccounts:4},logging:{quiet:true}});
const provider=new BrowserProvider(rpc);provider.pollingInterval=10;
const [holder,keeper,other]=await Promise.all([0,1,2].map(i=>provider.getSigner(i)));
const [owner,caller,outsider]=await Promise.all([holder,keeper,other].map(s=>s.getAddress()));
const unit=10n**18n;const passed=[];
const root='contracts/QKIDelegatedMultiHopV2.sol';
async function tx(p){return(await p).wait();}
async function deploy(file,name,args=[]){const a=output.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,holder).deploy(...args);await c.waitForDeployment();return c;}
async function reverts(p,name){try{await p;}catch(e){if(!name)return;const data=e.data||e.info?.error?.data?.result;const parsed=data&&swap.interface.parseError(data);assert.equal(parsed?.name,name,e.shortMessage||e.message);return;}assert.fail('Expected revert '+name);}
async function test(name,fn){await fn();passed.push(name);console.log('PASS '+name);}
const factory=await deploy('test/contracts/V2Mocks.sol','ConstantProductFactory');
const router=await deploy('test/contracts/V2Mocks.sol','ConstantProductQuoteRouter',[factory.target]);
const swap=await deploy(root,'QKIDelegatedMultiHopV2',[router.target]);
const a=await deploy('test/contracts/V2Mocks.sol','SenderTaxToken',['TAX']);
const b=await deploy('test/contracts/V2Mocks.sol','SenderTaxToken',['MID']);
const c=await deploy('test/contracts/V2Mocks.sol','SenderTaxToken',['OUT']);
for(const token of[a,b,c]){await tx(token.mint(owner,100_000n*unit));await tx(token.approve(swap.target,100_000n*unit));}
async function addPair(x,y,rx=1_000_000n*unit,ry=1_000_000n*unit){await tx(factory.createPair(x.target,y.target));const address=await factory.getPair(x.target,y.target);await tx(x.mint(address,rx));await tx(y.mint(address,ry));const pair=new Contract(address,output.contracts['test/contracts/V2Mocks.sol'].ConstantProductPair.abi,holder);await tx(pair.sync());return pair;}
const ab=await addPair(a,b),bc=await addPair(b,c),ca=await addPair(c,a);
const path=[a.target,b.target,c.target];
async function order(overrides={},route=path,signer=holder){const block=await provider.getBlock('latest');const config={amountIn:100n*unit,maxHolderDebit:110n*unit,minAmountOut:90n*unit,deadline:block.timestamp+3600,maxExecutions:1,executor:ZeroAddress,...overrides};const id=await swap.nextOrderId();await tx(swap.connect(signer).createOrder(config,route));return id;}

await test('explicit 10% sender-tax cap: holder pays 110, first pool receives 100, keeper receives no assets',async()=>{
 await tx(a.configure(1000,0,true));const id=await order();const before=await a.balanceOf(owner),out=await c.balanceOf(owner),pool=await a.balanceOf(ab.target);
 const receipt=await tx(swap.connect(keeper).executeOrder(id));
 assert.equal(before-await a.balanceOf(owner),110n*unit);assert.equal(await a.balanceOf(ab.target)-pool,100n*unit);
 assert(await c.balanceOf(owner)-out>=90n*unit);assert.equal(await a.balanceOf(swap.target),0n);assert.equal(await a.allowance(swap.target,router.target),0n);assert.equal(await c.balanceOf(caller),0n);
 const event=receipt.logs.map(l=>{try{return swap.interface.parseLog(l);}catch{return null;}}).find(l=>l?.name==='OrderExecuted');assert.equal(event.args.holderDebit,110n*unit);
});
await test('no extra-tax consent: cap 100 rejects a 110 debit and rolls back balances, allowance, pools and count',async()=>{
 const id=await order({maxHolderDebit:100n*unit});const before=await a.balanceOf(owner),approval=await a.allowance(owner,swap.target),pool=await a.balanceOf(ab.target);
 await reverts(swap.connect(keeper).executeOrder.staticCall(id),'HolderDebitExceeded');
 await assert.rejects(async()=>tx(swap.connect(keeper).executeOrder(id,{gasLimit:2_000_000})));
 assert.equal(await a.balanceOf(owner),before);assert.equal(await a.allowance(owner,swap.target),approval);assert.equal(await a.balanceOf(ab.target),pool);assert.equal((await swap.orders(id)).remainingExecutions,1n);
});
await test('tax increases above the holder cap fail before swapping',async()=>{
 const id=await order();await tx(a.configure(1100,0,true));await reverts(swap.connect(keeper).executeOrder.staticCall(id),'HolderDebitExceeded');await tx(a.configure(1000,0,true));
});
await test('actual output minimum remains enforced with sender tax',async()=>{
 const id=await order({minAmountOut:200n*unit});const before=await a.balanceOf(owner);
 await reverts(swap.connect(keeper).executeOrder.staticCall(id),'InsufficientActualOutput');assert.equal(await a.balanceOf(owner),before);assert.equal((await swap.orders(id)).remainingExecutions,1n);
});
await test('receiver-deducted input tax uses real pool input',async()=>{
 await tx(a.configure(0,1000,false));const id=await order({maxHolderDebit:100n*unit,minAmountOut:80n*unit});const before=await a.balanceOf(owner),pool=await a.balanceOf(ab.target);await tx(swap.connect(keeper).executeOrder(id));assert.equal(before-await a.balanceOf(owner),100n*unit);assert.equal(await a.balanceOf(ab.target)-pool,90n*unit);await tx(a.configure(1000,0,true));
});
await test('output tax is measured at the holder rather than the pool transfer amount',async()=>{
 await tx(c.configure(0,1000,false));const id=await order({minAmountOut:95n*unit});await reverts(swap.connect(keeper).executeOrder.staticCall(id),'InsufficientActualOutput');const good=await order({minAmountOut:80n*unit});await tx(swap.connect(keeper).executeOrder(good));await tx(c.configure(0,0,false));
});
await test('intermediate receiver-deducted tax is handled from actual next-pool input',async()=>{
 await tx(b.configure(0,1000,false));const tooHigh=await order({minAmountOut:95n*unit});await reverts(swap.connect(keeper).executeOrder.staticCall(tooHigh),'InsufficientActualOutput');
 const good=await order({minAmountOut:80n*unit});await tx(swap.connect(keeper).executeOrder(good));await tx(b.configure(0,0,false));
});
await test('intermediate sender tax that breaks the pool invariant rolls the complete swap back',async()=>{
 await tx(b.configure(1000,0,false));const id=await order({minAmountOut:1});const before=await a.balanceOf(owner),pool=await a.balanceOf(ab.target);
 await assert.rejects(swap.connect(keeper).executeOrder.staticCall(id),e=>e.reason==='K'||e.shortMessage?.includes('"K"'));
 await assert.rejects(async()=>tx(swap.connect(keeper).executeOrder(id,{gasLimit:2_000_000})));
 assert.equal(await a.balanceOf(owner),before);assert.equal(await a.balanceOf(ab.target),pool);assert.equal((await swap.orders(id)).remainingExecutions,1n);await tx(b.configure(0,0,false));
});
await test('funding never uses historical token donations in the helper',async()=>{
 await tx(a.mint(swap.target,17n*unit));const id=await order();await tx(swap.connect(keeper).executeOrder(id));assert.equal(await a.balanceOf(swap.target),17n*unit);
});
await test('designated executor and holder are allowed, other accounts are rejected',async()=>{
 const id=await order({executor:caller,maxExecutions:2});await reverts(swap.connect(other).executeOrder.staticCall(id),'ExecutorNotAllowed');await tx(swap.executeOrder(id));await tx(swap.connect(keeper).executeOrder(id));await reverts(swap.executeOrder.staticCall(id),'ExecutionsExhausted');
});
await test('only holder can cancel; pause is scoped to that holder',async()=>{
 const id=await order();await reverts(swap.connect(other).cancelOrder.staticCall(id),'NotOrderOwner');await tx(swap.setOwnerPaused(true));await reverts(swap.connect(keeper).executeOrder.staticCall(id),'OwnerPaused');await tx(swap.setOwnerPaused(false));await tx(swap.cancelOrder(id));await reverts(swap.connect(keeper).executeOrder.staticCall(id),'OrderCancelled');
});
await test('sender-tax token cannot reenter a second order',async()=>{
 const first=await order(),second=await order();await tx(a.setReentry(swap.target,swap.interface.encodeFunctionData('executeOrder',[second])));await tx(swap.connect(keeper).executeOrder(first));assert.equal(await a.reentrySucceeded(),false);assert.equal((await swap.orders(second)).remainingExecutions,1n);await tx(a.setReentry(ZeroAddress,'0x'));
});
await test('same-pool cycles are rejected; distinct-pool cycles remain valid',async()=>{
 const block=await provider.getBlock('latest');const cfg={amountIn:100n*unit,maxHolderDebit:110n*unit,minAmountOut:1,deadline:block.timestamp+3600,maxExecutions:1,executor:ZeroAddress};
 await reverts(swap.createOrder.staticCall(cfg,[a.target,b.target,a.target]),'RepeatedPair');
 await tx(a.configure(0,0,false));const id=await order({maxHolderDebit:100n*unit,minAmountOut:1},[a.target,b.target,c.target,a.target]);const before=await a.balanceOf(owner);const actual=await swap.connect(keeper).executeOrder.staticCall(id);await tx(swap.connect(keeper).executeOrder(id));assert.equal(await a.balanceOf(owner),before-100n*unit+actual);await tx(a.configure(1000,0,true));
});
await test('cap-based cumulative budget remains finite across different keepers',async()=>{
 const id=await order({maxExecutions:2});const before=await a.balanceOf(owner);await tx(swap.connect(keeper).executeOrder(id));await tx(swap.connect(other).executeOrder(id));assert.equal(before-await a.balanceOf(owner),220n*unit);await reverts(swap.executeOrder.staticCall(id),'ExecutionsExhausted');
});
await test('allowance must cover sender-paid tax and can be revoked',async()=>{
 const id=await order();await tx(a.approve(swap.target,100n*unit));await reverts(swap.connect(keeper).executeOrder.staticCall(id));await tx(a.approve(swap.target,110n*unit));await tx(swap.connect(keeper).executeOrder(id));await tx(a.approve(swap.target,0));const next=await order();await reverts(swap.executeOrder.staticCall(next));await tx(a.approve(swap.target,100_000n*unit));
});
await test('missing pools, invalid cap and overflowing total budget are rejected',async()=>{
 const block=await provider.getBlock('latest'),cfg={amountIn:unit,maxHolderDebit:unit,minAmountOut:1,deadline:block.timestamp+3600,maxExecutions:1,executor:ZeroAddress};
 await reverts(swap.createOrder.staticCall({...cfg,maxHolderDebit:unit-1n},path),'InvalidConfig');await reverts(swap.createOrder.staticCall({...cfg,maxHolderDebit:(1n<<256n)-1n,maxExecutions:2},path),'InvalidConfig');
 const missing=await deploy('test/contracts/V2Mocks.sol','SenderTaxToken',['MISSING']);await reverts(swap.createOrder.staticCall(cfg,[a.target,missing.target]),'InvalidPair');
});
await test('an expired order cannot consume holder tokens',async()=>{
 const id=await order();await rpc.request({method:'evm_increaseTime',params:[3601]});await rpc.request({method:'evm_mine',params:[]});await reverts(swap.connect(keeper).executeOrder.staticCall(id),'OrderExpired');
});
await test('V2 runtime with the real router immutable matches the frontend whitelist',async()=>{
 await rpc.request({method:'evm_setAccountCode',params:[ROUTER,await provider.getCode(router.target)]});const exact=await deploy(root,'QKIDelegatedMultiHopV2',[ROUTER]);const trust=JSON.parse(fs.readFileSync('build/contract-verification.json'));assert(trust.v2RuntimeHashes.includes(keccak256(stripSolidityMetadata(await provider.getCode(exact.target)))));
});
await test('no-return ERC20 input works without any helper-to-router approval',async()=>{
 const legacy=await deploy('test/contracts/Mocks.sol','NoReturnToken');await tx(legacy.mint(owner,1000n*unit));await tx(legacy.approve(swap.target,1000n*unit));await addPair(legacy,b);
 const id=await order({maxHolderDebit:100n*unit},[legacy.target,b.target,c.target]);const before=await legacy.balanceOf(owner);await tx(swap.connect(keeper).executeOrder(id));assert.equal(before-await legacy.balanceOf(owner),100n*unit);assert.equal(await legacy.allowance(swap.target,router.target),0n);
});
fs.writeFileSync('build/v2-test-results.json',JSON.stringify({environment:'Local QKI EVM and constant-product pools; no live transactions',passed:passed.length,failed:0,tests:passed},null,2)+'\n');
console.log(`All ${passed.length} V2 tests passed.`);await rpc.disconnect();
