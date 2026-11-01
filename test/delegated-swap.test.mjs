import assert from 'node:assert/strict';
import fs from 'node:fs';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, keccak256 } from 'ethers';
import { ROUTER, stripSolidityMetadata } from '../docs/core.mjs';
import { compile } from '../scripts/compile.mjs';

const { output } = compile(true);
const rpc = ganache.provider({
  chain: { chainId: 20181205, hardfork: 'merge' },
  wallet: { totalAccounts: 5 }, logging: { quiet: true }
});
const provider = new BrowserProvider(rpc);
provider.pollingInterval = 10;
const [holder, keeper, outsider] = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
const [ownerAddress, keeperAddress, outsiderAddress] = await Promise.all(
  [holder, keeper, outsider].map(s => s.getAddress())
);
const unit = 10n ** 18n;
const tests = [];

async function deploy(file, name, args = [], signer = holder) {
  const artifact = output.contracts[file][name];
  const c = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
  await c.waitForDeployment();
  return c;
}
async function tx(promise) { return (await promise).wait(); }
async function reverts(promise, errorName, contract) {
  try { await promise; } catch (error) {
    if (!errorName) return;
    const data = error.data || error.info?.error?.data?.result;
    const decoded = data && contract.interface.parseError(data);
    assert.equal(decoded?.name, errorName, `${errorName}: ${error.shortMessage || error.message}`);
    return;
  }
  assert.fail(`Expected revert${errorName ? ': ' + errorName : ''}`);
}
async function test(name, fn) {
  await fn();
  tests.push(name);
  console.log(`PASS ${name}`);
}

const router = await deploy('test/contracts/Mocks.sol', 'MockRouter');
const swap = await deploy('contracts/QKIDelegatedMultiHop.sol', 'QKIDelegatedMultiHop', [router.target]);
const a = await deploy('test/contracts/Mocks.sol', 'MockToken', ['A']);
const b = await deploy('test/contracts/Mocks.sol', 'MockToken', ['B']);
const c = await deploy('test/contracts/Mocks.sol', 'MockToken', ['C']);
for (const token of [a, b, c]) {
  await tx(token.mint(ownerAddress, 100_000n * unit));
  await tx(token.mint(router.target, 1_000_000n * unit));
  await tx(token.approve(swap.target, 100_000n * unit));
}
const path = [a.target, b.target, c.target];
async function newOrder(overrides = {}, route = path, signer = holder) {
  const latest = await provider.getBlock('latest');
  const config = {
    amountIn: 100n * unit, minAmountOut: 390n * unit,
    deadline: latest.timestamp + 3600, maxExecutions: 1,
    executor: ZeroAddress, feeOnTransfer: false, ...overrides
  };
  const id = await swap.nextOrderId();
  await tx(swap.connect(signer).createOrder(config, route));
  return id;
}

await test('approval alone creates no executable authority', async () => {
  await reverts(swap.connect(outsider).executeOrder.staticCall(1), 'OrderNotFound', swap);
});
await test('any keeper executes multihop; all output reaches holder; router allowance cleared', async () => {
  const id = await newOrder();
  const beforeIn = await a.balanceOf(ownerAddress), beforeOut = await c.balanceOf(ownerAddress);
  const keeperBefore = await c.balanceOf(keeperAddress);
  assert.equal(await swap.connect(keeper).executeOrder.staticCall(id), 400n * unit);
  const receipt = await tx(swap.connect(keeper).executeOrder(id));
  assert.equal(beforeIn - await a.balanceOf(ownerAddress), 100n * unit);
  assert.equal(await c.balanceOf(ownerAddress) - beforeOut, 400n * unit);
  assert.equal(await c.balanceOf(keeperAddress), keeperBefore);
  assert.equal(await a.balanceOf(swap.target), 0n);
  assert.equal(await a.allowance(swap.target, router.target), 0n);
  const log = receipt.logs.map(l => { try { return swap.interface.parseLog(l); } catch { return null; } })
    .find(l => l?.name === 'OrderExecuted');
  assert.equal(log.args.executor, keeperAddress);
  assert.equal(log.args.actualAmountOut, 400n * unit);
  await reverts(swap.connect(outsider).executeOrder.staticCall(id), 'ExecutionsExhausted', swap);
});
await test('another wallet cannot register an order against holder balance', async () => {
  const id = await newOrder({}, path, outsider);
  assert.equal((await swap.orders(id)).owner, outsiderAddress);
  const before = await a.balanceOf(ownerAddress);
  await reverts(swap.connect(keeper).executeOrder.staticCall(id));
  assert.equal(await a.balanceOf(ownerAddress), before);
});
await test('designated executor enforced; holder retains execution rights', async () => {
  const id = await newOrder({ executor: keeperAddress, maxExecutions: 2 });
  await reverts(swap.connect(outsider).executeOrder.staticCall(id), 'ExecutorNotAllowed', swap);
  await tx(swap.executeOrder(id));
  await tx(swap.connect(keeper).executeOrder(id));
  assert.equal((await swap.orders(id)).remainingExecutions, 0n);
});
await test('only holder may cancel; cancelled orders cannot run', async () => {
  const id = await newOrder();
  await reverts(swap.connect(outsider).cancelOrder.staticCall(id), 'NotOrderOwner', swap);
  await tx(swap.cancelOrder(id));
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'OrderCancelled', swap);
});
await test('holder pause covers all their orders and can be resumed', async () => {
  const id = await newOrder();
  await tx(swap.setOwnerPaused(true));
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'OwnerPaused', swap);
  await tx(swap.connect(outsider).setOwnerPaused(false));
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'OwnerPaused', swap);
  await tx(swap.setOwnerPaused(false));
  await tx(swap.connect(keeper).executeOrder(id));
});
await test('insufficient actual receipt reverts transfers and execution count, even if router skips check', async () => {
  const id = await newOrder({ minAmountOut: 500n * unit });
  await tx(router.configure(2, 1, 10_000, true));
  const beforeIn = await a.balanceOf(ownerAddress), beforeOut = await c.balanceOf(ownerAddress);
  const beforeApproval = await a.allowance(ownerAddress, swap.target);
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'InsufficientActualOutput', swap);
  await assert.rejects(async () => tx(swap.connect(keeper).executeOrder(id, { gasLimit: 1_000_000 })));
  assert.equal(await a.balanceOf(ownerAddress), beforeIn);
  assert.equal(await c.balanceOf(ownerAddress), beforeOut);
  assert.equal(await a.allowance(ownerAddress, swap.target), beforeApproval);
  assert.equal((await swap.orders(id)).remainingExecutions, 1n);
  assert.equal(await a.allowance(swap.target, router.target), 0n);
  await tx(router.configure(2, 1, 10_000, false));
});
await test('cyclic route measures receipt after input pull, including gross profit floor', async () => {
  const id = await newOrder({ minAmountOut: 350n * unit }, [a.target, b.target, a.target]);
  const before = await a.balanceOf(ownerAddress);
  assert.equal(await swap.connect(keeper).executeOrder.staticCall(id), 400n * unit);
  await tx(swap.connect(keeper).executeOrder(id));
  assert.equal(await a.balanceOf(ownerAddress) - before, 300n * unit);
});
await test('input transfer tax uses actual receipt and accounts for both transfer legs', async () => {
  await tx(a.configure(1000, 0, false, false));
  const id = await newOrder({ minAmountOut: 320n * unit, feeOnTransfer: true });
  const beforeIn = await a.balanceOf(ownerAddress), beforeOut = await c.balanceOf(ownerAddress);
  assert.equal(await swap.connect(keeper).executeOrder.staticCall(id), 324n * unit);
  await tx(swap.connect(keeper).executeOrder(id));
  assert.equal(beforeIn - await a.balanceOf(ownerAddress), 100n * unit);
  assert.equal(await c.balanceOf(ownerAddress) - beforeOut, 324n * unit);
  assert.equal(await a.allowance(swap.target, router.target), 0n);
  await tx(a.configure(0, 0, false, false));
});
await test('standard mode rejects a taxed input instead of silently changing amount', async () => {
  await tx(a.configure(1000, 0, false, false));
  const id = await newOrder();
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'UnexpectedInputReceipt', swap);
  await tx(a.configure(0, 0, false, false));
});
await test('output transfer tax is checked against actual holder balance', async () => {
  await tx(c.configure(1000, 0, false, false));
  await tx(router.configure(2, 1, 10_000, true));
  const id = await newOrder({ minAmountOut: 370n * unit, feeOnTransfer: true });
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'InsufficientActualOutput', swap);
  const good = await newOrder({ minAmountOut: 350n * unit, feeOnTransfer: true });
  assert.equal(await swap.connect(keeper).executeOrder.staticCall(good), 360n * unit);
  await tx(swap.connect(keeper).executeOrder(good));
  await tx(c.configure(0, 0, false, false));
  await tx(router.configure(2, 1, 10_000, false));
});
await test('extra sender tax cannot exceed the fixed holder debit', async () => {
  await tx(a.configure(0, 100, false, false));
  const id = await newOrder({ feeOnTransfer: true });
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'UnexpectedHolderDebit', swap);
  await tx(a.configure(0, 0, false, false));
});
await test('router callback cannot execute a second order reentrantly', async () => {
  const first = await newOrder(), second = await newOrder();
  await tx(router.setReentry(swap.target, swap.interface.encodeFunctionData('executeOrder', [second])));
  await tx(swap.connect(keeper).executeOrder(first));
  assert.equal(await router.reentrySucceeded(), false);
  assert.equal((await swap.orders(second)).remainingExecutions, 1n);
  await tx(router.setReentry(ZeroAddress, '0x'));
});
await test('partial router consumption reverts rather than pooling holder funds', async () => {
  const id = await newOrder({ minAmountOut: 1 });
  await tx(router.configure(2, 1, 5000, false));
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'UnexpectedInputRemainder', swap);
  await tx(router.configure(2, 1, 10_000, false));
});
await test('historical token donations are never spent by another order', async () => {
  await tx(a.transfer(swap.target, 17n * unit));
  const id = await newOrder();
  await tx(swap.connect(keeper).executeOrder(id));
  assert.equal(await a.balanceOf(swap.target), 17n * unit);
});
await test('finite execution budget is enforced across different keepers', async () => {
  const id = await newOrder({ maxExecutions: 2 });
  const before = await a.balanceOf(ownerAddress);
  await tx(swap.connect(keeper).executeOrder(id));
  await tx(swap.connect(outsider).executeOrder(id));
  assert.equal(before - await a.balanceOf(ownerAddress), 200n * unit);
  await reverts(swap.executeOrder.staticCall(id), 'ExecutionsExhausted', swap);
});
await test('ERC20 approval revocation immediately blocks unfilled orders', async () => {
  const id = await newOrder();
  await tx(a.approve(swap.target, 0));
  await reverts(swap.connect(keeper).executeOrder.staticCall(id));
  assert.equal((await swap.orders(id)).remainingExecutions, 1n);
  await tx(a.approve(swap.target, 100_000n * unit));
});
await test('false-return ERC20 transfer is rejected', async () => {
  await tx(a.configure(0, 0, false, true));
  const id = await newOrder();
  await reverts(swap.connect(keeper).executeOrder.staticCall(id));
  await tx(a.configure(0, 0, false, false));
});
await test('no-return ERC20 and zero-first approvals are supported', async () => {
  const legacy = await deploy('test/contracts/Mocks.sol', 'NoReturnToken');
  await tx(legacy.mint(ownerAddress, 1000n * unit));
  await tx(legacy.approve(swap.target, 1000n * unit));
  const id = await newOrder({ maxExecutions: 2 }, [legacy.target, b.target, c.target]);
  await tx(swap.connect(keeper).executeOrder(id));
  await tx(swap.connect(keeper).executeOrder(id));
  assert.equal(await legacy.allowance(swap.target, router.target), 0n);
});
await test('invalid configurations and paths are rejected', async () => {
  for (const override of [{ amountIn: 0 }, { minAmountOut: 0 }, { maxExecutions: 0 }, { deadline: 1 }]) {
    const block = await provider.getBlock('latest');
    await reverts(swap.createOrder.staticCall({
      amountIn: unit, minAmountOut: unit, deadline: block.timestamp + 3600,
      maxExecutions: 1, executor: ZeroAddress, feeOnTransfer: false, ...override
    }, path), 'InvalidConfig', swap);
  }
  const config = { amountIn: unit, minAmountOut: unit, deadline: 10_000_000_000,
    maxExecutions: 1, executor: ZeroAddress, feeOnTransfer: false };
  for (const route of [[a.target], [a.target, a.target], [a.target, ZeroAddress], Array(17).fill(a.target)]) {
    await reverts(swap.createOrder.staticCall(config, route), 'InvalidPath', swap);
  }
});
await test('expired order rejects before spending tokens', async () => {
  const id = await newOrder();
  await rpc.request({ method: 'evm_increaseTime', params: [3601] });
  await rpc.request({ method: 'evm_mine', params: [] });
  await reverts(swap.connect(keeper).executeOrder.staticCall(id), 'OrderExpired', swap);
});
await test('native QKI transfers and non-contract routers are rejected', async () => {
  await reverts(keeper.sendTransaction({ to: swap.target, value: unit }));
  await reverts(deploy('contracts/QKIDelegatedMultiHop.sol', 'QKIDelegatedMultiHop', [outsiderAddress]));
});

await test('frontend runtime whitelist accepts the real constructor output with the fixed router', async () => {
  await rpc.request({method:'evm_setAccountCode',params:[ROUTER,await provider.getCode(router.target)]});
  const deployed=await deploy('contracts/QKIDelegatedMultiHop.sol','QKIDelegatedMultiHop',[ROUTER]);
  const runtime=await provider.getCode(deployed.target);
  const trust=JSON.parse(fs.readFileSync('build/contract-verification.json'));
  assert(trust.runtimeHashes.includes(keccak256(stripSolidityMetadata(runtime))));
});

fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/test-results.json', JSON.stringify({
  environment: 'Ganache local EVM, QKI chain ID, mock tokens/router; no live-chain fork',
  passed: tests.length, failed: 0, tests
}, null, 2));
console.log(`All ${tests.length} tests passed.`);
await rpc.disconnect();
