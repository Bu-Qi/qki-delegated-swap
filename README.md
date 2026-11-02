# QKI 多跳代执行 V2

持有人设定固定交易条件，其他地址支付 QKI Gas 执行。兑换结果始终返回持有人。V2 增加每次最大实际扣款，用于持有人明确接受的发送者额外税。

[打开 GitHub Pages 前端](https://bu-qi.github.io/qki-delegated-swap/) · [备用前端 / V2 一键部署](https://qki-delegated-swap-console.mofei1-9304.chatgpt.site/?deploy=1&v=2)

新增 **[本地套利扫描程序](scanner/README.md)**：支持 USDT / 原生 QKI 循环扫描、含税模拟、Gas 净收益、钱包复核交易及成交后重算。Windows 解压后进入 `scanner`，双击 `start-windows.cmd`；需要 Node.js 20 或更新版本。

当前前端默认部署 **QKIDelegatedMultiHopV2**。代码和页面发布不等于合约已经上链；部署、授权、创建订单均由你的钱包签名。

## V2 的输入数量与扣款上限

| 参数 | 含义 |
| --- | --- |
| amountIn | 要向第一个池子名义转出的代币数量，不包含在数量之外额外扣除的发送者税 |
| maxHolderDebit | 每次允许从持有人实际扣除的总量上限，包含发送者税，必须不小于 amountIn |
| minAmountOut | 每次实际返回持有人钱包的最小输出数量，按输出币精度填写 |
| maxExecutions | 最多成功执行次数，1 表示只能成功执行一次 |
| deadline | 绝对 UNIX 秒时间戳，必须晚于当前区块时间 |
| executor | 零地址表示任何地址可执行；指定地址时仅该地址或持有人可执行 |

例如 QANB 名义转出 **100,000**，如果接受额外 **10%** 发送者税，持有人明确设置最大实际扣款 **110,000**。第一池收到 100,000，持有人最多付 110,000。税费超过上限、实际到账不足或任意一跳失败，整个交易回滚，包括代币余额、授权消耗、池子状态和执行次数；失败交易已消耗的 Gas 仍由执行者承担。

前端不会自动增加扣款上限。上限留空时等于名义输入，不允许超额扣款。多个订单共享钱包的真实余额和 ERC20 授权，不预留资金。

授权预算按 **maxHolderDebit × maxExecutions** 计算。前端数量以代币单位填写，自动读取精度；合约参数为最小单位整数。QANB 本次读取为 8 位精度，因此上述示例对应 amountIn=10000000000000、maxHolderDebit=11000000000000；不要把所有代币都当成 18 位。

## 交易怎样执行

1. 持有人先向 V2 合约授权输入代币，并调用 createOrder 登记路径、数量、扣款上限、最低到账、期限和次数。
2. 执行者只提交 executeOrder(orderId)，不能改变任何交易条件或收款人。
3. V2 将输入直接从持有人转入第一交易池，校验持有人的实际扣款没有超过上限。
4. 每一跳读取交易池实际收到的输入，使用固定 QKI Router 的 getAmountOut 计算输出，再调用对应 V2 Pair 的 swap。
5. 最后一跳直接发送给持有人，按持有人的实际余额差校验 minAmountOut。

V2 不把输入先托管到中转合约，也不向 Router 设置代币授权，减少一次可能收税的转账。没有管理员、升级入口、任意调用、执行者抽成或通用提现入口。不要直接给合约充值或误转资产，历史误转代币不会被订单消费，合约也不能提取它们。

## 从 V1 迁移

旧版 V1 合约不可升级，旧订单不会自动迁移，旧版代币授权也不能给新版合约使用。前端会根据运行时代码自动识别版本，使用对应 ABI，继续查询、取消和执行符合 V1 条件的订单。

1. 用持有人钱包查询旧订单，可点击“复制条件到创建表单”保留原路径、数量和最低到账。
2. 展开“部署 V2”，连接 QKI 钱包，检查费用并在钱包确认。成功后页面自动填入新合约地址。
3. 在持有人管理中重新核对路径、最低到账和有效期，并明确设置每次最大实际扣款。
4. 向 **新 V2 地址**授权预算，再创建新订单。新地址的订单 ID 从 1 开始。
5. 分享新订单链接给执行钱包。旧订单需另行取消，或在代币合约撤销对旧地址的授权。

前端同时支持 V1/V2 的代码核验、查询、授权、创建、取消、暂停、恢复、复制条件和订单链接分享。V1 中“扣税模式”只表示支持接收方扣税，不会允许持有人被额外扣款。V2 自动按实际入池和实际到账校验，不再使用这个切换选项。

## 部署与编译

| 项目 | 值 |
| --- | --- |
| 网络 | QKI，chainId 20181205 |
| 默认合约 | QKIDelegatedMultiHopV2 |
| 固定 Router 构造参数 | 0x3c91FD5247B050A1536F24D012a17a618EEFbfCA |
| Solidity | 0.8.24+commit.e11b9ed9 |
| Optimizer | 开启，200 runs |
| EVM Version | paris |
| Via IR | 关闭 |
| 前端默认 Gas Price | 500 Gwei，可自行修改 |

一键部署使用本项目的编译字节码，固定网络、Router 和 value=0。页面模拟部署、估算 Gas，增加 20% Gas 余量后显示最高费用；部署审阅与账户、网络、Gas Price 和字节码绑定，5 分钟后需要重新检查。交易哈希保存在当前浏览器，刷新后可查询部署结果，避免重复部署。

订单执行、授权和管理操作同样先估算 Gas，再使用含 20% 余量的同一 Gas 上限进行预模拟与钱包提交，避免节点按默认 5000 万 Gas 检查余额，导致余额足够支付实际交易费用的钱包被错误拦截。

每笔交易前，前端重新核对链 ID、Router 和对应版本的运行时代码指纹。编译器 CBOR 元数据不参与指纹，合约逻辑和 Router immutable 参与。若自行修改源码、编译器或优化设置，需要重新构建校验文件，不能直接绕过核验。

原生 QKI 不能通过 ERC20 approve 委托消费，需要持有人先包装成 WQKI。执行者的钱包仍需原生 QKI 支付 Gas。

## 源码与构建

- QKIDelegatedMultiHopV2.sol：可直接放入 Remix 的 V2 单文件源码，含固定版本 OpenZeppelin 依赖。
- contracts/QKIDelegatedMultiHopV2.sol：V2 维护源码。
- QKIDelegatedMultiHop.sol 与 contracts/QKIDelegatedMultiHop.sol：保留的 V1 源码。
- build/QKIDelegatedMultiHopV2.abi.json 与 .bin：V2 ABI 和部署字节码。
- build/standard-input-v2.json：V2 多文件源码验证输入。
- build/flattened-standard-input-v2.json：V2 单文件源码验证输入。
- build/contract-verification.json：前端接受的 V1/V2 运行时代码指纹。
- docs/：可直接静态托管的前端，所有签名代码来自本地打包的 ethers，不使用外部 CDN，也不接收私钥。
- test/：V1、V2、前端边界与部署测试。
- LICENSE、OPENZEPPELIN-LICENSE：MIT 许可证和依赖许可证。

```bash
npm ci
npm run build:frontend
npm test
npm run test:v2
npm run test:frontend
```

GitHub Pages 可发布 main 分支的 /docs。前端需通过 HTTP/HTTPS 使用，不要直接以 file:// 打开。网页只读 RPC 会从给定的 11 个 QKI 节点中选择最快可用节点，也支持手动切换；钱包实际签名和广播由你的钱包完成。

## 校验与适用范围

本地测试使用 QKI chainId 的 Ganache EVM、真实的 0.3% 恒定乘积池模型和模拟税币，覆盖：

- 发送者余额和 allowance 同时按 110% 扣除的输入税；超过持有人上限则完全回滚。
- 输入、输出及中间币从转账数量内扣税时，按实际池子输入及持有人实际到账计算。
- 扣款上限预算、权限、次数、取消、暂停、到期、重复池、重入和历史误转资金隔离。
- 保留 V1 的行为与代码指纹，前端正确区分两版订单字段。
- 新版部署字节码、固定 Router 参数、费用上限和本地部署后的代码指纹。

另外使用 QKI 历史区块 0x246ad6a 的 **eth_call 状态覆盖**测试完整 V2 编译产物：QANB → QAMPL → CCT → usdt → WQKI，名义输入 100000、最大扣款 110000、最低到账 40 WQKI。持有人或其他地址执行均通过，历史状态下返回约 41.26883148 WQKI；上限比实际扣款少一个最小单位时返回 HolderDebitExceeded。这是无链上写入的历史状态模拟，不是实际部署或成交保证。

仍可能因为黑名单、暂停、特殊转账限制、池子流动性不足、状态变化或实际到账低于上限而回滚。特别是某些中间/输出代币额外从池子扣除发送者税，会破坏池子的恒定乘积约束；V2 不绕过池子的 K 校验，也不保证支持任意税币。Rebasing/reflection 等特殊资产需按真实金额和地址重新验证。

循环路径应以 **minAmountOut - maxHolderDebit** 作为按授权上限计算的最低代币毛收益，Gas 另外计算。不同输入和输出代币不能直接按数量相减。minAmountOut 不会按执行时的可操纵即时报价自动降低。

参考：

- [原多跳报价工具](https://qki-path-quote.mofei1-9304.chatgpt.site/)
- [ERC20 标准](https://eips.ethereum.org/EIPS/eip-20)
- [OpenZeppelin SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20)
- [V2 Pair 与 Router 参考实现](https://github.com/Uniswap/v2-periphery)
