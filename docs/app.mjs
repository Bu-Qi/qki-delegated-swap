import { CHAIN_ID, ROUTER, RPCS, ZERO, UINT64_MAX, positiveInteger, parseTokenAmount, parsePath, budgetFor, normalizeOrder, orderState, stripSolidityMetadata, shortAddress } from './core.mjs?v=2.0.1';
import { buildDeploymentPlan, deploymentStillMatches } from './deployment.mjs?v=2.0.1';

const $ = id => document.getElementById(id);
const NETWORK = { chainId: Number(CHAIN_ID), name: 'QKI' };
const TOKEN_ABI = ['function decimals() view returns(uint8)','function symbol() view returns(string)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256)'];
const state = { reader: null, wallet: null, ethereum: null, account: null, chain: null, busy: false, verified: null, verifiedVersion:null, loaded: null, tokens: null, revision: 0, rpcRevision: 0, deployment:null, pendingDeployment:null };
let ethers, ABI, ABI_V1, TRUST, DEPLOY, messageTimer;
const errorLabels = { OrderNotFound:'订单不存在，请核对合约地址和订单 ID。', NotOrderOwner:'只有订单持有人可以执行此操作。', ExecutorNotAllowed:'当前地址没有执行权限。', OrderCancelled:'订单已取消。', OrderExpired:'订单已过期。', ExecutionsExhausted:'订单的执行次数已经用尽。', OwnerPaused:'持有人暂停了订单。', UnexpectedHolderDebit:'代币对持有人额外扣费，本合约不支持这种发送者税。', UnexpectedInputReceipt:'收到的输入代币数量异常，请检查扣税模式。', UnexpectedInputRemainder:'Router 没有准确消耗本次输入，交易已回滚。', InsufficientActualOutput:'实际到账低于订单最低要求，交易将回滚。', InvalidPath:'交易路径不符合合约要求。', InvalidConfig:'订单金额、次数或有效期不符合合约要求。', SafeERC20FailedOperation:'代币转账失败，请检查余额、授权与代币限制。', ERC20InsufficientAllowance:'持有人的代币授权不足。', ERC20InsufficientBalance:'持有人的代币余额不足。' };

function message(text, error = false) {
  clearTimeout(messageTimer); $('message').textContent = text; $('message').className = `message${error ? ' error' : ''}`; $('message').hidden = false;
  messageTimer = setTimeout(() => { $('message').hidden = true; }, error ? 14000 : 7000);
}
function explain(error) {
  if (error?.code === 'ACTION_REJECTED' || error?.code === 4001) return '已取消钱包请求。';
  if (error?.code === 'INSUFFICIENT_FUNDS') return '执行钱包的 QKI 不足以支付 Gas。';
  const name = error?.revert?.name;
  const v2Errors={HolderDebitExceeded:'实际扣款（含税）超过持有人设定的上限，交易已回滚。修改上限须由持有人创建新订单。',InvalidHolderDebit:'输入代币的余额变化异常，本次交易已回滚。',RepeatedPair:'路径重复使用同一交易池，V2 不支持这种路径。',InvalidPair:'路径中存在未建立的交易池。',PairHasNoInput:'某一跳的交易池没有收到可兑换的输入。'};
  if(v2Errors[name])return v2Errors[name];
  if(name==='UnexpectedHolderDebit')return 'V1 检测到扣款与输入量不一致。发送者额外税需要部署 V2，并由持有人设定最大扣款。';
  if (errorLabels[name]) return errorLabels[name];
  for (const candidate of [error?.data, error?.info?.error?.data?.result, error?.info?.error?.data]) {
    if (typeof candidate !== 'string' || !candidate.startsWith('0x')) continue;
    for(const abi of [ABI,ABI_V1])try { const parsed = new ethers.Interface(abi).parseError(candidate);if(v2Errors[parsed?.name])return v2Errors[parsed.name];if(parsed?.name==='UnexpectedHolderDebit')return 'V1 检测到扣款与输入量不一致。发送者额外税需要部署 V2，并由持有人设定最大扣款。';if (errorLabels[parsed?.name]) return errorLabels[parsed.name]; } catch {}
  }
  return String(error?.reason || error?.shortMessage || error?.message || '操作失败，请稍后重试。').slice(0, 340);
}
function setBusy(value) {
  state.busy = value;
  for (const el of document.querySelectorAll('button:not(.tab), input, textarea, select')) el.disabled = value;
  if (!value) refreshButtons();
}
async function run(fn) {
  if (state.busy) return;
  setBusy(true);
  try { await fn(); } catch (error) { message(explain(error), true); }
  finally { setBusy(false); }
}
function currentAddress() {
  const value = $('contract-address').value.trim();
  if (!ethers.isAddress(value) || value.toLowerCase() === ZERO) throw new Error('请填写有效的代执行合约地址。');
  const result = ethers.getAddress(value);
  if (result.toLowerCase() === ROUTER.toLowerCase()) throw new Error('这是 Router 地址，请填写新部署的代执行合约地址。');
  return result;
}
function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function storageRemove(key) { try { localStorage.removeItem(key); } catch {} }
function reader() {
  if (state.reader) return state.reader;
  if (state.wallet && state.chain === CHAIN_ID) return state.wallet;
  throw new Error('尚无可用 QKI RPC，请重试节点检测，或连接并切换钱包至 QKI。');
}
async function rpcRequest(url, method, params = [], contentType = 'application/json') {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(url, { method:'POST', headers:{'Content-Type':contentType}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:controller.signal, credentials:'omit' });
    if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
    const json = await response.json();
    if (json.error) { const error = new Error(json.error.message || 'RPC 请求失败'); error.code = json.error.code; error.data = json.error.data; throw error; }
    if (!Object.hasOwn(json, 'result')) throw new Error('RPC 返回格式错误');
    return json.result;
  } finally { clearTimeout(timer); }
}
async function probeRpc(url) {
  for (const contentType of ['application/json', 'text/plain']) {
    const start = performance.now();
    try {
      if (BigInt(await rpcRequest(url, 'eth_chainId', [], contentType)) !== CHAIN_ID) throw new Error('非 QKI 节点');
      return {url, contentType, ms:Math.round(performance.now()-start)};
    } catch {}
  }
  throw new Error('节点连接失败');
}
async function chooseRpc() {
  const revision = ++state.rpcRevision; const value = $('rpc-select').value;
  $('rpc-state').textContent = '正在检测 RPC…';
  try {
    const result = await Promise.any((value === 'auto' ? RPCS : [value]).map(probeRpc));
    if (revision !== state.rpcRevision) return;
    state.reader = new ethers.BrowserProvider({ request:({method,params}) => rpcRequest(result.url, method, params || [], result.contentType) }, NETWORK);
    $('rpc-state').textContent = `${new URL(result.url).hostname} · ${result.ms} ms`;
    storageSet('qki-delegated-rpc', value);
  } catch {
    if (revision !== state.rpcRevision) return;
    state.reader = null; $('rpc-state').textContent = 'RPC 不可用 · 可连接 QKI 钱包查询';
  }
}
async function ensureContract(provider = reader()) {
  const address = currentAddress();
  if (BigInt(await provider.send('eth_chainId', [])) !== CHAIN_ID) throw new Error('当前网络不是 QKI，请先切换网络。');
  const code = await provider.getCode(address);
  if (code === '0x') throw new Error('此地址在 QKI 链上没有合约，请核对部署是否已完成。');
  let fingerprint;
  try { fingerprint = ethers.keccak256(stripSolidityMetadata(code)); } catch { throw new Error('合约代码无法识别，请核对部署地址。'); }
  if (!TRUST.runtimeHashes.includes(fingerprint)) {
    state.verified = null; $('contract-state').textContent = '代码不匹配'; $('contract-state').className = 'badge bad';
    throw new Error('此合约代码与提供的源码不匹配，已禁止授权和交易。请使用说明中的编译设置部署。');
  }
  const version=TRUST.v2RuntimeHashes.includes(fingerprint)?2:1;
  const contract = new ethers.Contract(address, version===2?ABI:ABI_V1, provider);
  const [chain, router] = await Promise.all([contract.QKI_CHAIN_ID(), contract.router()]);
  if (chain !== CHAIN_ID || router.toLowerCase() !== ROUTER.toLowerCase()) throw new Error('合约网络或 Router 配置不匹配。');
  state.verified = address;state.verifiedVersion=version;storageSet('qki-delegated-contract', address);
  $('contract-state').textContent = version===2?'V2 · 源码匹配':'V1 · 原版合约'; $('contract-state').className = 'badge good';
  $('contract-hint').textContent = version===2?`V2 支持持有人设置最大实际扣款 · Router ${shortAddress(router)} · 每笔交易前重新校验`:'这是 V1 合约：可继续查询和执行原有订单；发送者额外税需要部署 V2 并重新创建订单，旧合约不能升级。';
  updateVersionSettings();
  return contract;
}
function updateVersionSettings(){
  const v2=state.verifiedVersion!==1;
  $('sender-tax-setting').hidden=!v2;$('legacy-fee-setting').hidden=v2;
  $('compatibility-note').textContent=v2?'原生 QKI 需先包装成 WQKI。V2 将输入直接从持有人转入第一池，发送者税计入最大扣款；其他代币规则仍可能导致兑换回滚。':'V1 输入经过钱包、中转合约和交易池，可能发生两次转账税。发送者额外税需要使用 V2，旧合约无法升级。';
  updateBudget();
}
function walletStatus() {
  const connected = !!state.account;
  $('connect').textContent = connected ? shortAddress(state.account) : '连接钱包 ↗';
  $('wallet-summary').textContent = connected ? `${shortAddress(state.account)} · ${state.chain === CHAIN_ID ? 'QKI 网络已连接' : '当前不是 QKI 网络'}` : '尚未连接钱包 · 可先查询订单';
  $('wallet-dot').className = `status-dot${connected && state.chain === CHAIN_ID ? ' good' : ''}`;
  $('switch-network').hidden = !connected || state.chain === CHAIN_ID;
  $('deploy-account').textContent = state.account || '尚未连接';
  refreshButtons();
}
async function connectWallet() {
  const ethereum = window.ethereum;
  if (!ethereum?.request) throw new Error('未检测到浏览器钱包。请使用已安装 MetaMask / OKX 等扩展的钱包浏览器打开。');
  if (state.ethereum !== ethereum) {
    state.ethereum = ethereum;
    ethereum.on?.('accountsChanged', accounts => {
      state.account = accounts.length ? ethers.getAddress(accounts[0]) : null; ++state.revision;
      walletStatus();
    });
    ethereum.on?.('chainChanged', chainId => {
      state.chain = BigInt(chainId); state.wallet = new ethers.BrowserProvider(ethereum, 'any'); ++state.revision;
      walletStatus();
    });
  }
  const accounts = await ethereum.request({method:'eth_requestAccounts'});
  state.account = accounts.length ? ethers.getAddress(accounts[0]) : null;
  state.chain = BigInt(await ethereum.request({method:'eth_chainId'}));
  state.wallet = new ethers.BrowserProvider(ethereum, 'any'); ++state.revision;
  walletStatus();
  if (state.chain !== CHAIN_ID) message('钱包已连接，请点击“切换至 QKI”后再发起交易。');
}
async function switchNetwork() {
  if (!state.ethereum) throw new Error('请先连接钱包。');
  try { await state.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:ethers.toQuantity(CHAIN_ID)}]}); }
  catch (error) {
    if (error.code !== 4902 && error?.data?.originalError?.code !== 4902) throw error;
    await state.ethereum.request({method:'wallet_addEthereumChain',params:[{chainId:ethers.toQuantity(CHAIN_ID),chainName:'QKI',nativeCurrency:{name:'QKI',symbol:'QKI',decimals:18},rpcUrls:RPCS.slice(0,3),blockExplorerUrls:['https://scan.qki.dev']}]});
    await state.ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:ethers.toQuantity(CHAIN_ID)}]});
  }
  state.chain = BigInt(await state.ethereum.request({method:'eth_chainId'}));
  state.wallet = new ethers.BrowserProvider(state.ethereum, 'any'); walletStatus();
}
async function walletSigner() {
  if (!state.account || !state.ethereum) throw new Error('请先连接发起交易的钱包。');
  state.chain = BigInt(await state.ethereum.request({method:'eth_chainId'}));
  if (state.chain !== CHAIN_ID) { walletStatus(); throw new Error('钱包当前不是 QKI 网络，请先切换。'); }
  const signer = await state.wallet.getSigner(); const account = await signer.getAddress();
  if (account !== state.account) { state.account = account; walletStatus(); throw new Error('钱包账户发生变化，请核对新账户后重新操作。'); }
  return {signer, account};
}
async function signingContext() {
  const {signer,account}=await walletSigner();
  const contract = await ensureContract(state.wallet);
  return {signer, account, contract:contract.connect(signer)};
}
function deploymentMatchesWallet() {
  if(!state.deployment||!state.account||state.chain==null)return false;
  try{return deploymentStillMatches(state.deployment,{account:state.account,chainId:state.chain,gasPrice:gasOptions().gasPrice,initCodeHash:DEPLOY.initCodeHash});}catch{return false;}
}
async function prepareDeployment() {
  if(state.pendingDeployment){await checkDeployment();return;}
  state.deployment=null;
  if(!state.account)await connectWallet();
  const {account}=await walletSigner(); const gasPrice=gasOptions().gasPrice;
  const routerCode=await state.wallet.getCode(ROUTER);
  if(routerCode==='0x')throw new Error('固定 Router 在当前 QKI 网络上不存在，无法部署。');
  const transaction={from:account,data:DEPLOY.data,value:0n,gasPrice};
  const [estimatedGas,balance,block]=await Promise.all([state.wallet.estimateGas(transaction),state.wallet.getBalance(account),state.wallet.getBlock('latest')]);
  const plan=buildDeploymentPlan({account,chainId:CHAIN_ID,data:DEPLOY.data,initCodeHash:DEPLOY.initCodeHash,gasPrice,estimatedGas,balance,blockGasLimit:block.gasLimit});
  const simulatedRuntime=await state.wallet.call({...transaction,gasLimit:plan.gasLimit});
  if(!TRUST.runtimeHashes.includes(ethers.keccak256(stripSolidityMetadata(simulatedRuntime))))throw new Error('部署模拟返回的合约代码与源码不匹配，已停止。');
  if(state.account!==account||state.chain!==CHAIN_ID||gasOptions().gasPrice!==gasPrice)throw new Error('钱包或 Gas 参数已变化，请重新检查部署。');
  state.deployment=plan;
  $('deploy-account').textContent=account;
  $('deploy-gas').textContent=`${estimatedGas.toLocaleString()} / ${plan.gasLimit.toLocaleString()}`;
  $('deploy-gas-price').textContent=`${ethers.formatUnits(gasPrice,9)} Gwei`;
  $('deploy-cost').textContent=`${ethers.formatEther(plan.maxGasCost)} QKI`;
  $('deploy-status').textContent='部署模拟通过，合约代码匹配。请核对账户、网络和最高 Gas 费用，再在钱包确认。';
  message('部署检查通过，等待你的钱包签名确认。');
}
async function finishDeployment(receipt,pending) {
  if(receipt.status!==1){
    state.pendingDeployment=null;state.deployment=null;storageRemove('qki-delegated-pending-deploy');
    $('check-deployment').hidden=true;$('deploy-status').textContent='部署交易失败，可查看交易原因后重新检查。';
    throw new Error('部署交易失败，已消耗的 Gas 不会退回。');
  }
  if(receipt.to!=null||!receipt.contractAddress||receipt.from.toLowerCase()!==pending.from.toLowerCase()||receipt.contractAddress.toLowerCase()!==pending.address.toLowerCase())throw new Error('交易回执不是预期的合约部署，请核对链上记录。');
  $('contract-address').value=ethers.getAddress(receipt.contractAddress);state.loaded=null;
  const provider=state.wallet&&state.chain===CHAIN_ID?state.wallet:reader();
  await ensureContract(provider);
  state.pendingDeployment=null;state.deployment=null;storageRemove('qki-delegated-pending-deploy');
  $('check-deployment').hidden=true;$('deploy-status').textContent=`V${state.verifiedVersion} 部署已确认，运行时代码已核对，新合约地址已填入上方。`;
  $('transaction-status').textContent='合约部署成功';
  $('deployed-address').hidden=false;$('deployed-address').replaceChildren();
  const link=document.createElement('a');link.href=`https://scan.qki.dev/address/${receipt.contractAddress}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=receipt.contractAddress;
  $('deployed-address').append('已部署：',link);message('合约部署成功，已自动填写部署地址。');
}
async function checkDeployment() {
  const pending=state.pendingDeployment;if(!pending)throw new Error('当前没有待查询的部署交易。');
  const provider=state.wallet&&state.chain===CHAIN_ID?state.wallet:reader();
  $('transaction').hidden=false;$('transaction-label').textContent='部署合约';$('transaction-link').href=`https://scan.qki.dev/tx/${pending.hash}`;$('transaction-link').hidden=false;
  const receipt=await provider.getTransactionReceipt(pending.hash);
  if(!receipt){$('transaction-status').textContent='部署交易等待链上确认';$('deploy-status').textContent='已有部署交易待确认，请勿重复部署。可以稍后再次查询。';$('check-deployment').hidden=false;return;}
  await finishDeployment(receipt,pending);
}
async function deployContract() {
  if(state.pendingDeployment){await checkDeployment();return;}
  if(!deploymentMatchesWallet())throw new Error('部署账户、Gas 参数或估算有效期已变化，请重新点击“检查部署与费用”。');
  const plan=state.deployment; const {signer,account}=await walletSigner();
  if(account!==plan.account||!deploymentMatchesWallet())throw new Error('部署条件已变化，请重新检查。');
  const estimated=await state.wallet.estimateGas({from:account,data:plan.data,value:0n,gasPrice:plan.gasPrice});
  if(estimated>plan.gasLimit)throw new Error('最新 Gas 估算超过已显示的上限，请重新检查费用。');
  if(await state.wallet.getBalance(account)<plan.maxGasCost)throw new Error('钱包 QKI 不足以支付已显示的最高 Gas 费用。');
  $('transaction').hidden=false;$('transaction-label').textContent='部署合约';$('transaction-status').textContent='请在钱包中确认部署';$('transaction-link').hidden=true;
  const transaction=await signer.sendTransaction({data:plan.data,chainId:CHAIN_ID,value:0n,gasPrice:plan.gasPrice,gasLimit:plan.gasLimit});
  const pending={hash:transaction.hash,from:transaction.from,address:ethers.getCreateAddress({from:transaction.from,nonce:transaction.nonce}),chainId:CHAIN_ID.toString()};
  state.pendingDeployment=pending;storageSet('qki-delegated-pending-deploy',JSON.stringify(pending));
  $('check-deployment').hidden=false;$('transaction-status').textContent='部署已提交，等待链上确认…';$('transaction-link').href=`https://scan.qki.dev/tx/${transaction.hash}`;$('transaction-link').hidden=false;
  $('deploy-status').textContent='部署交易已提交。刷新页面后可继续查询，无需重复部署。';
  try{const receipt=await transaction.wait();await finishDeployment(receipt,pending);}
  catch(error){if(state.pendingDeployment)$('deploy-status').textContent='可点击“查询已提交的部署结果”核对回执，请勿重复部署。';throw error;}
}
async function tokenInfo(provider, address, required = false) {
  const token = new ethers.Contract(address, TOKEN_ABI, provider);
  const [decimals, symbol] = await Promise.allSettled([token.decimals(),token.symbol()]);
  if (required && decimals.status !== 'fulfilled') throw new Error(`无法读取 ${shortAddress(address)} 的代币精度，请核对路径。`);
  return { address, decimals:decimals.status === 'fulfilled' ? Number(decimals.value) : null, symbol:symbol.status === 'fulfilled' ? String(symbol.value).slice(0,24) : shortAddress(address) };
}
function amountText(value, token) { return token.decimals == null ? `${value} raw` : `${ethers.formatUnits(value,token.decimals)} ${token.symbol}`; }
function addressLink(element, address) {
  element.replaceChildren(); const a = document.createElement('a'); a.href = `https://scan.qki.dev/address/${address}`; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = shortAddress(address); a.title = address; element.append(a);
}
async function fetchOrder(provider, contract, id) {
  const version=contract.interface.getFunction('VERSION()')?2:1;
  const order = normalizeOrder(await contract.orders(id),version);
  if (order.owner.toLowerCase() === ZERO) throw new Error('订单不存在，请检查订单 ID。');
  const [path, paused, block] = await Promise.all([contract.getOrderPath(id),contract.ownerPaused(order.owner),provider.getBlock('latest')]);
  const token = new ethers.Contract(path[0],TOKEN_ABI,provider);
  const [balance, allowance, tokens] = await Promise.all([
    token.balanceOf(order.owner),token.allowance(order.owner,contract.target),
    Promise.all([...path].map(address => tokenInfo(provider,address)))
  ]);
  return {id, address:contract.target, version, order, path:[...path], paused, balance, allowance, tokens, timestamp:block.timestamp, fetchedAt:Date.now()};
}
function eligibility(loaded = state.loaded) {
  if (!loaded) return {eligible:false,reason:'请先查询订单。'};
  const snapshotMatches = loaded.address.toLowerCase() === $('contract-address').value.trim().toLowerCase() && loaded.id.toString() === $('order-id').value.trim();
  if (!snapshotMatches) return {eligible:false,reason:'输入已变化，请重新查询订单。'};
  const result = orderState(loaded.order,{now:loaded.timestamp + Math.floor((Date.now()-loaded.fetchedAt)/1000),paused:loaded.paused,account:state.account,balance:loaded.balance,allowance:loaded.allowance});
  if (state.account && state.chain !== CHAIN_ID) return {...result,eligible:false,reason:'请将执行钱包切换至 QKI 网络。'};
  return result;
}
function renderOrder() {
  const loaded = state.loaded; if (!loaded) return;
  const {order,tokens,path} = loaded;
  $('empty-order').hidden = true; $('order-detail').hidden = false;
  $('order-input').textContent = amountText(order.amountIn,tokens[0]); $('order-output').textContent = amountText(order.minAmountOut,tokens.at(-1));
  $('order-route').replaceChildren();
  tokens.forEach((token,i) => { if (i) {const arrow=document.createElement('b');arrow.textContent='→';$('order-route').append(arrow);} const span=document.createElement('span');span.textContent=token.symbol;span.title=token.address;$('order-route').append(span); });
  addressLink($('order-owner'),order.owner);
  if (order.executor.toLowerCase() === ZERO) $('order-executor').textContent = '任何地址'; else addressLink($('order-executor'),order.executor);
  $('order-count').textContent = `${order.remainingExecutions} 次`;
  $('order-max-debit').textContent=amountText(order.maxHolderDebit,tokens[0])+(loaded.version===1?' · V1 固定':'');
  const date = new Date(Number(order.deadline)*1000); $('order-deadline').textContent = Number.isNaN(date.getTime()) ? `${order.deadline} UNIX 秒` : date.toLocaleString();
  $('order-fee').textContent = loaded.version===2?'V2 · 实际入池及到账校验':order.feeOnTransfer ? 'V1 · 已开启' : 'V1 · 标准兑换';
  $('order-funding').textContent = `${loaded.balance >= order.maxHolderDebit ? '余额覆盖扣款上限' : '余额不足'} / ${loaded.allowance >= order.maxHolderDebit ? '授权覆盖扣款上限' : '授权不足'}`;
  $('order-gross').textContent = path[0].toLowerCase() === path.at(-1).toLowerCase() ? `按最大扣款计算，循环路径最低代币毛收益：${amountText(order.minAmountOut-order.maxHolderDebit,tokens[0])}。未扣执行者 Gas。` : '输入与输出为不同代币，不直接按数量计算盈亏。';
  refreshButtons();
}
async function loadOrder() {
  const id = positiveInteger($('order-id').value); const address = currentAddress(); const revision = ++state.revision;
  state.loaded = null; $('order-status').textContent='查询中'; $('order-status').className='badge muted'; $('empty-order').hidden=false; $('order-detail').hidden=true;
  const provider = reader(); const contract = await ensureContract(provider); const loaded = await fetchOrder(provider,contract,id);
  if (revision !== state.revision || address !== currentAddress()) return;
  state.loaded = loaded; renderOrder();
}
function ownerConfig() {
  const path = parsePath($('path').value).map(ethers.getAddress);
  if (!state.tokens || JSON.stringify(path) !== state.tokens.key) throw new Error('路径已变化，请先重新读取代币信息。');
  const amountIn = parseTokenAmount($('amount-in').value,state.tokens.input.decimals);
  const version=state.verifiedVersion||2;
  const maxHolderDebit=version===2?parseTokenAmount($('max-holder-debit').value.trim()||$('amount-in').value,state.tokens.input.decimals):amountIn;
  if(maxHolderDebit<amountIn)throw new Error('最大实际扣款不能小于每次输入数量。');
  const minAmountOut = parseTokenAmount($('minimum-out').value,state.tokens.output.decimals);
  const maxExecutions = positiveInteger($('max-executions').value,UINT64_MAX);
  const time = new Date($('deadline').value).getTime();
  if (!Number.isFinite(time) || time <= Date.now()) throw new Error('请设置晚于当前时间的订单截止时间。');
  const deadline = BigInt(Math.floor(time/1000)); if (deadline > UINT64_MAX) throw new Error('截止时间超出范围。');
  const executorText = $('executor-address').value.trim(); const executor = executorText ? ethers.getAddress(executorText) : ZERO;
  const config=version===2?{amountIn,maxHolderDebit,minAmountOut,maxExecutions,deadline,executor}:{amountIn,minAmountOut,maxExecutions,deadline,executor,feeOnTransfer:$('fee-mode').checked};
  return {path,config,version,maxHolderDebit,budget:budgetFor(maxHolderDebit,maxExecutions)};
}
function updateBudget() {
  try {
    const data = ownerConfig(); $('budget').textContent=amountText(data.budget,state.tokens.input);
    $('owner-warning').textContent = data.path[0] === data.path.at(-1) && data.config.minAmountOut <= data.maxHolderDebit ? '按最大扣款计算，当前循环订单未设置正毛收益门槛，按此条件成交可能亏损。' : `每次名义转出 ${amountText(data.config.amountIn,state.tokens.input)}，最多实际扣除 ${amountText(data.maxHolderDebit,state.tokens.input)}；剩余资金仍在持有人钱包。`;
  } catch { $('budget').textContent='读取代币并填写有效数量'; }
  refreshButtons();
}
function refreshButtons() {
  if (state.busy) return;
  const result = eligibility();
  $('execute-order').disabled = !result.eligible;
  $('execute-reason').textContent=result.reason;
  if (state.loaded) { $('order-status').textContent=result.label || '请重新查询'; $('order-status').className=`badge ${result.eligible?'good':'muted'}`; }
  const currentOrder=state.loaded&&state.loaded.address.toLowerCase()===$('contract-address').value.trim().toLowerCase()&&state.loaded.id.toString()===$('order-id').value.trim();
  $('share-order').disabled=!currentOrder;
  $('copy-order-conditions').disabled=!currentOrder;
  let canCreate=false;
  try { ownerConfig(); canCreate=!!state.account && state.chain===CHAIN_ID && !!state.verified && state.verified.toLowerCase()===$('contract-address').value.trim().toLowerCase(); } catch {}
  $('approve-budget').disabled=!canCreate; $('create-order').disabled=!canCreate;
  $('deploy-contract').disabled=!!state.pendingDeployment||!deploymentMatchesWallet();
  $('estimate-deploy').disabled=!!state.pendingDeployment;
  $('check-deployment').hidden=!state.pendingDeployment;
}
async function loadTokens() {
  const provider = reader(); const path = parsePath($('path').value).map(ethers.getAddress); const key=JSON.stringify(path);
  if ($('contract-address').value.trim()) await ensureContract(provider);
  const [input,output] = await Promise.all([tokenInfo(provider,path[0],true),tokenInfo(provider,path.at(-1),true)]);
  state.tokens={input,output,key}; $('input-symbol').textContent=`${input.symbol} · ${input.decimals} 位精度`;
  $('output-symbol').textContent=`${output.symbol} · ${output.decimals} 位精度`;
  $('token-state').textContent=`${input.symbol} → ${output.symbol} · 已读取精度`;
  $('sender-tax-hint').textContent=input.address.toLowerCase()==='0xc431158227578c42fcf7dfc2be82ebce00bf2ac8'?'QANB 示例：名义转出 100000，若接受额外 10% 税，可明确填写最大扣款 110000。税额超过上限会回滚。':'留空表示最大扣款与输入数量相同，不允许额外扣款。请按输入代币的真实税费自行设置。';
  updateBudget();
}
function gasOptions() { return {gasPrice:parseTokenAmount($('gas-price').value,9)}; }
async function sendTransaction(title, contract, method, args = []) {
  const options = gasOptions();
  const estimate = await contract[method].estimateGas(...args,options);
  // Bound eth_call as well: an omitted limit can trigger the node's 50M-gas balance check.
  const transactionOptions = {...options,gasLimit:(estimate*120n+99n)/100n};
  await contract[method].staticCall(...args,transactionOptions);
  $('transaction').hidden=false; $('transaction-label').textContent=title; $('transaction-status').textContent='请在钱包中确认'; $('transaction-link').hidden=true;
  const transaction = await contract[method](...args,transactionOptions);
  $('transaction-status').textContent='已提交，等待链上确认…'; $('transaction-link').href=`https://scan.qki.dev/tx/${transaction.hash}`; $('transaction-link').hidden=false;
  const receipt = await transaction.wait();
  if (!receipt || receipt.status !== 1) throw new Error('交易未成功确认，请查看链上交易状态。');
  $('transaction-status').textContent='交易已确认'; return receipt;
}
async function executeOrder() {
  if (!state.loaded) throw new Error('请先查询订单。');
  const id=positiveInteger($('order-id').value); const {contract}=await signingContext();
  const loaded=await fetchOrder(state.wallet,contract,id); state.loaded=loaded; renderOrder();
  const allowed=eligibility(loaded); if (!allowed.eligible) throw new Error(allowed.reason);
  await sendTransaction('代执行订单',contract,'executeOrder',[id]);
  state.loaded=await fetchOrder(state.wallet,contract,id); renderOrder(); message('订单执行成功，兑换资产已返回持有人。');
}
async function approveBudget() {
  const data=ownerConfig(); const {account,signer,contract}=await signingContext();
  const token=new ethers.Contract(data.path[0],TOKEN_ABI,signer);
  if (await token.balanceOf(account) < data.maxHolderDebit) throw new Error('当前钱包的输入代币余额不足以覆盖一次最大扣款。');
  const current=await token.allowance(account,contract.target);
  if (current>=data.budget) {message('现有授权额度已覆盖本订单预算，无需再次授权。');return;}
  if (current>0n) {
    await sendTransaction('清零原有代币授权',token,'approve',[contract.target,0]);
    const latest=await signingContext(); if(latest.account!==account) throw new Error('钱包账户已变化，请重新授权。');
  }
  await sendTransaction('授权订单输入预算',token,'approve',[contract.target,data.budget]);
  if(await token.allowance(account,contract.target)<data.budget) throw new Error('代币交易已确认，但授权额度没有生效，请检查代币限制。');
  message('输入预算已授权，可以创建订单。');
}
async function createOrder() {
  const data=ownerConfig(); const {account,signer,contract}=await signingContext();
  const token=new ethers.Contract(data.path[0],TOKEN_ABI,signer);
  if(await token.allowance(account,contract.target)<data.budget) throw new Error('请先授权本订单的输入预算。');
  const receipt=await sendTransaction('创建订单',contract,'createOrder',[data.config,data.path]);
  let id;
  for(const log of receipt.logs){if(log.address.toLowerCase()!==contract.target.toLowerCase())continue;try{const event=contract.interface.parseLog(log);if(event?.name==='OrderCreated')id=event.args.orderId;}catch{}}
  if(id==null) throw new Error('交易已确认，但未识别到订单创建事件，请在浏览器查看日志。');
  $('order-id').value=id.toString(); $('cancel-id').value=id.toString(); activateTab('execute');
  state.loaded=await fetchOrder(state.wallet,contract,id); renderOrder(); message(`订单 #${id} 创建成功，可复制链接分享给执行钱包。`);
}
async function cancelOrder() {
  const id=positiveInteger($('cancel-id').value); const {account,contract}=await signingContext(); const order=await contract.orders(id);
  if(order.owner.toLowerCase()!==account.toLowerCase()) throw new Error('当前钱包不是这个订单的持有人。');
  await sendTransaction('取消订单',contract,'cancelOrder',[id]);
  if(state.loaded?.id===id){state.loaded=await fetchOrder(state.wallet,contract,id);renderOrder();} message('订单已取消。');
}
async function pauseOrders(paused) {
  const {contract}=await signingContext(); await sendTransaction(paused?'暂停全部订单':'恢复我的订单',contract,'setOwnerPaused',[paused]);
  if(state.loaded){state.loaded=await fetchOrder(state.wallet,contract,state.loaded.id);renderOrder();}
  message(paused?'当前钱包名下的订单已暂停。':'当前钱包已恢复执行权限；已取消、过期或耗尽次数的订单不会恢复。');
}
function activateTab(tab) {
  for(const name of ['execute','owner']){$(`${name}-view`).hidden=name!==tab;$(`${name}-tab`).classList.toggle('active',name===tab);$(`${name}-tab`).setAttribute('aria-selected',String(name===tab));}
}
async function shareOrder() {
  if(!state.loaded) throw new Error('请先查询订单。');
  const url=new URL(location.href); url.search=''; url.hash=''; url.searchParams.set('contract',state.loaded.address);url.searchParams.set('order',state.loaded.id.toString());
  try { await navigator.clipboard.writeText(url.toString()); message('订单链接已复制。'); }
  catch { message(`当前浏览器不允许复制，订单 ID 为 ${state.loaded.id}，合约为 ${state.loaded.address}`); }
}
async function copyOrderConditions(){
  if(!state.loaded)throw new Error('请先查询要复制条件的订单。');
  const {order,path,tokens}=state.loaded;
  if(tokens[0].decimals==null||tokens.at(-1).decimals==null)throw new Error('无法读取代币精度，请先核对路径。');
  $('path').value=JSON.stringify(path);state.tokens={input:tokens[0],output:tokens.at(-1),key:JSON.stringify(path)};
  $('amount-in').value=ethers.formatUnits(order.amountIn,tokens[0].decimals);$('minimum-out').value=ethers.formatUnits(order.minAmountOut,tokens.at(-1).decimals);
  $('max-holder-debit').value=ethers.formatUnits(order.maxHolderDebit,tokens[0].decimals);$('max-executions').value=(order.remainingExecutions||1n).toString();
  $('executor-address').value=order.executor.toLowerCase()===ZERO?'':order.executor;
  $('fee-mode').checked=order.feeOnTransfer;
  $('token-state').textContent=`${tokens[0].symbol} → ${tokens.at(-1).symbol} · 已复制精度`;
  $('input-symbol').textContent=`${tokens[0].symbol} · ${tokens[0].decimals} 位精度`;$('output-symbol').textContent=`${tokens.at(-1).symbol} · ${tokens.at(-1).decimals} 位精度`;
  activateTab('owner');updateBudget();message('条件已复制。迁移到 V2 后请重新核对最大扣款、期限和授权预算；旧订单不会自动迁移。');
}
async function init() {
  const getJSON=async file=>{const r=await fetch(`${file}?v=2.0.1`,{cache:'no-store'});if(!r.ok)throw new Error(`${file} 加载失败`);return r.json();};
  const [abi,abiV1,trust,deploy] = await Promise.all([getJSON('contract.abi.json'),getJSON('contract-v1.abi.json'),getJSON('trusted-bytecode.json'),getJSON('deployment.json')]);
  ethers=window.ethers; if(!ethers)throw new Error('本地钱包签名库加载失败，请刷新页面。'); ABI=abi;ABI_V1=abiV1;TRUST=trust;DEPLOY=deploy;
  const deployment=await new ethers.ContractFactory(ABI,DEPLOY.bytecode).getDeployTransaction(ROUTER);
  if(DEPLOY.version!==2||BigInt(DEPLOY.chainId)!==CHAIN_ID||DEPLOY.router.toLowerCase()!==ROUTER.toLowerCase()||DEPLOY.value!=='0'||deployment.data!==DEPLOY.data||ethers.keccak256(DEPLOY.data)!==DEPLOY.initCodeHash)throw new Error('部署数据校验失败，请刷新页面。');
  const params=new URLSearchParams(location.search); const supplied=params.get('contract');
  if(params.has('deploy'))$('deploy-box').open=true;
  try{const pending=JSON.parse(storageGet('qki-delegated-pending-deploy')||'null');if(pending&&pending.chainId===CHAIN_ID.toString()&&/^0x[0-9a-fA-F]{64}$/.test(pending.hash)&&ethers.isAddress(pending.from)&&ethers.isAddress(pending.address)){state.pendingDeployment=pending;$('deploy-box').open=true;$('check-deployment').hidden=false;}}catch{}
  const remembered=storageGet('qki-delegated-contract'); if(supplied) $('contract-address').value=supplied;else if(remembered)$('contract-address').value=remembered;
  if(params.get('order'))$('order-id').value=params.get('order');
  for(const url of RPCS){const option=document.createElement('option');option.value=url;option.textContent=new URL(url).hostname;$('rpc-select').append(option);}
  const savedRpc=storageGet('qki-delegated-rpc');if(savedRpc==='auto'||RPCS.includes(savedRpc))$('rpc-select').value=savedRpc;
  const until=new Date(Date.now()+20*60*1000);until.setMinutes(until.getMinutes()-until.getTimezoneOffset());$('deadline').value=until.toISOString().slice(0,16);
  const actions={'connect':connectWallet,'switch-network':switchNetwork,'verify-contract':async()=>{await ensureContract();message(`V${state.verifiedVersion} 合约运行时代码与源码匹配。`);},'load-order':loadOrder,'execute-order':executeOrder,'load-tokens':loadTokens,'approve-budget':approveBudget,'create-order':createOrder,'cancel-order':cancelOrder,'pause-orders':()=>pauseOrders(true),'resume-orders':()=>pauseOrders(false),'share-order':shareOrder,'copy-order-conditions':copyOrderConditions,'estimate-deploy':prepareDeployment,'deploy-contract':deployContract,'check-deployment':checkDeployment};
  for(const[id,fn]of Object.entries(actions))$(id).addEventListener('click',()=>run(fn));
  $('execute-tab').addEventListener('click',()=>activateTab('execute'));$('owner-tab').addEventListener('click',()=>activateTab('owner'));
  $('contract-address').addEventListener('input',()=>{state.verified=null;state.verifiedVersion=null;state.loaded=null;++state.revision;$('empty-order').hidden=false;$('order-detail').hidden=true;$('contract-state').className='badge muted';$('contract-state').textContent='尚未核对';$('contract-hint').textContent='请填写并核对新部署的 V2 合约地址；不要填写 Router 地址。';updateVersionSettings();refreshButtons();});
  $('order-id').addEventListener('input',refreshButtons);
  for(const id of ['path','amount-in','max-holder-debit','minimum-out','max-executions','deadline','executor-address','fee-mode'])$(id).addEventListener('input',updateBudget);
  $('rpc-select').addEventListener('change',chooseRpc);$('retry-rpc').addEventListener('click',chooseRpc);
  $('gas-price').addEventListener('input',()=>{state.deployment=null;$('deploy-gas-price').textContent=`${$('gas-price').value} Gwei`;$('deploy-cost').textContent='参数变化，请重新估算';refreshButtons();});
  $('order-id').addEventListener('keydown',event=>{if(event.key==='Enter')run(loadOrder);});
  updateVersionSettings();walletStatus();await chooseRpc();
  if(state.pendingDeployment)await run(checkDeployment);
  if(supplied&&params.get('order'))await run(loadOrder);
  setInterval(()=>{if(!state.busy)refreshButtons();},1000);
}
init().catch(error=>message(error.message,true));
