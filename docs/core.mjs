export const CHAIN_ID = 20181205n;
export const ROUTER = '0x3c91FD5247B050A1536F24D012a17a618EEFbfCA';
export const UINT64_MAX = (1n << 64n) - 1n;
export const UINT256_MAX = (1n << 256n) - 1n;
export const ZERO = '0x0000000000000000000000000000000000000000';
export const RPCS = ['https://rpc1.qkirpc.org','https://rpc2.qkirpc.org','https://rpc3.qkirpc.org','https://rpc1.qkiscan.io','https://rpc2.qkiscan.io','https://rpc3.qkiscan.io','https://116.62.144.117','https://118.178.121.168','https://101.132.39.198','https://8.210.130.36','https://139.224.206.117'];

export function positiveInteger(value, max = UINT256_MAX) {
  const input = String(value).trim();
  if (!/^\d+$/.test(input)) throw new Error('请输入大于 0 的整数。');
  const result = BigInt(input);
  if (result <= 0n || result > max) throw new Error('整数超出允许范围。');
  return result;
}
export function parseTokenAmount(value, decimals) {
  const input = String(value).trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('代币精度无效。');
  if (!/^\d+(?:\.\d+)?$/.test(input)) throw new Error('请输入普通十进制数量，不支持科学计数法。');
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > decimals) throw new Error(`该代币最多支持 ${decimals} 位小数。`);
  const raw = BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (raw <= 0n || raw > UINT256_MAX) throw new Error('代币数量必须大于 0 且不能超出 uint256。');
  return raw;
}
export function parsePath(value) {
  const input = String(value).trim();
  let result;
  if (input.startsWith('[')) {
    try { result = JSON.parse(input); } catch { throw new Error('路径 JSON 格式错误，请使用双引号。'); }
  } else result = input.split(/[\s,;]+/).filter(Boolean);
  if (!Array.isArray(result) || result.length < 2 || result.length > 16) throw new Error('路径需要 2–16 个代币地址。');
  for (let i = 0; i < result.length; i++) {
    if (typeof result[i] !== 'string' || !/^0x[\da-fA-F]{40}$/.test(result[i]) || result[i].toLowerCase() === ZERO) throw new Error(`路径第 ${i + 1} 个代币地址无效。`);
    if (i && result[i].toLowerCase() === result[i - 1].toLowerCase()) throw new Error('相邻代币不能相同。');
  }
  return result;
}
export function budgetFor(amount, count) {
  if (amount <= 0n || count <= 0n || count > UINT64_MAX || amount > UINT256_MAX / count) throw new Error('订单预算超出合约允许范围。');
  return amount * count;
}
export function orderState(order, { now, paused = false, account, balance, allowance }) {
  if (order.cancelled) return { label: '已取消', eligible: false, reason: '订单已被持有人取消。' };
  if (paused) return { label: '已暂停', eligible: false, reason: '持有人暂停了自己的订单。' };
  if (BigInt(now) > BigInt(order.deadline)) return { label: '已过期', eligible: false, reason: '订单已超过截止时间。' };
  if (BigInt(order.remainingExecutions) === 0n) return { label: '已完成', eligible: false, reason: '订单成功执行次数已用尽。' };
  if (balance != null && balance < order.amountIn) return { label: '余额不足', eligible: false, reason: '持有人的输入代币余额不足。' };
  if (allowance != null && allowance < order.amountIn) return { label: '授权不足', eligible: false, reason: '持有人对代执行合约的授权不足。' };
  if (!account) return { label: '待执行', eligible: false, reason: '请连接执行钱包。' };
  const allowed = order.executor.toLowerCase() === ZERO || account.toLowerCase() === order.executor.toLowerCase() || account.toLowerCase() === order.owner.toLowerCase();
  if (!allowed) return { label: '指定地址执行', eligible: false, reason: '当前钱包不是指定执行者或持有人。' };
  return { label: '可执行', eligible: true, reason: '当前钱包可执行此订单，并支付 QKI Gas。' };
}
export function stripSolidityMetadata(code) {
  if (!/^0x(?:[\da-fA-F]{2})+$/.test(code) || code.length < 8) throw new Error('合约运行时代码无效。');
  const metadataBytes = parseInt(code.slice(-4), 16);
  const end = code.length - (metadataBytes + 2) * 2;
  if (metadataBytes < 1 || end <= 2) throw new Error('合约元数据格式无效。');
  return code.slice(0, end).toLowerCase();
}
export function shortAddress(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
