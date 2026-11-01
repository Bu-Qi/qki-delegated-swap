import { CHAIN_ID, ZERO, UINT256_MAX } from './core.mjs';

export function buildDeploymentPlan({account,chainId,data,initCodeHash,gasPrice,estimatedGas,balance,blockGasLimit,now=Date.now()}) {
  if(BigInt(chainId)!==CHAIN_ID)throw new Error('部署只能在 QKI 主网进行。');
  if(!/^0x[0-9a-fA-F]{40}$/.test(account)||account.toLowerCase()===ZERO)throw new Error('部署钱包地址无效。');
  if(!/^0x(?:[0-9a-fA-F]{2})+$/.test(data)||!/^0x[0-9a-fA-F]{64}$/.test(initCodeHash))throw new Error('部署字节码或指纹无效。');
  if(gasPrice<=0n||estimatedGas<=0n)throw new Error('部署 Gas 参数无效。');
  const gasLimit=(estimatedGas*120n+99n)/100n;
  if(blockGasLimit!=null&&gasLimit>blockGasLimit)throw new Error('部署所需 Gas 超过当前区块上限。');
  if(gasLimit>UINT256_MAX/gasPrice)throw new Error('部署费用超出允许范围。');
  const maxGasCost=gasLimit*gasPrice;
  if(balance<maxGasCost)throw new Error('钱包 QKI 余额不足以覆盖部署的最高 Gas 费用。');
  return Object.freeze({account,chainId:CHAIN_ID,data,initCodeHash,gasPrice,gasLimit,estimatedGas,maxGasCost,createdAt:now,value:0n});
}

export function deploymentStillMatches(plan,{account,chainId,gasPrice,initCodeHash,now=Date.now()}) {
  return !!plan&&plan.account.toLowerCase()===String(account).toLowerCase()&&plan.chainId===BigInt(chainId)&&plan.gasPrice===gasPrice&&plan.initCodeHash===initCodeHash&&now>=plan.createdAt&&now-plan.createdAt<=300_000;
}
