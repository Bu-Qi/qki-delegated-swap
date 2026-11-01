# QKI 多跳交易代执行合约

本合约让地址 A 持有代币并设定交易条件，由地址 B/C 提交交易和支付 Gas。输出直接发送给 A，执行者不能更改路径、数量、最低到账量或收款人。

支持指定执行者，也支持任何地址执行。不是抢跑、监听或自动扫描程序；链下程序/人仍需发起 `executeOrder(orderId)`。

## 在线前端

[打开 QKI 多跳代执行控制台](https://qki-delegated-swap-console.mofei1-9304.chatgpt.site/)

前端源码在 `docs/`，使用本地打包的 ethers，不依赖外部 CDN、不接收私钥。支持浏览器钱包连接与 QKI 网络切换、自动选择可用 RPC、订单查询、代执行、持有人授权与创建、取消/暂停/恢复，以及订单链接分享。

首次使用：

1. 在控制台展开“一键部署”，连接 QKI 钱包，点击“检查部署与费用”，核对账户和最高 Gas 费用，再在钱包确认部署。部署成功会自动填写新地址；也可按下方编译设置使用 Remix 部署。
2. 打开控制台，填写**新部署的代执行合约地址**，点击“核对合约”。当前未预填任何部署地址。
3. 持有人连接钱包，在“持有人管理”中粘贴路径、读取代币精度、填写数量和期限，授权预算并创建订单。
4. 点击“复制当前订单链接”，用另一个钱包打开。连接执行钱包后，点击“执行这个订单”。

每笔交易前，前端会校验链 ID、Router 和已编译源码的运行时代码指纹；不匹配会阻止代币授权和交易。忽略编译器 CBOR 元数据，接受本项目的多文件与展开单文件版本；编译器、优化设置或合约代码变更后，需要重新构建前端的校验文件。Gas Price 默认 500 Gwei，可在设置中修改。页面会显示实际资产持有人/收款人，执行者仅支付 Gas。

```bash
npm ci
npm run build:frontend
npm run test:frontend
```

将 `docs/` 作为静态站点目录部署即可；GitHub Pages 可使用 `main` 分支的 `/docs` 目录。不要直接双击 `index.html` 以 `file://` 打开，因为浏览器模块和资源读取需要 HTTP 服务。

前端边界校验测试覆盖精度、大整数、预算溢出、路径校验、执行地址、状态与期限、余额授权和代码指纹。合约测试还在本地 EVM 部署真实构造函数产物，核对其能通过前端代码白名单。实际钱包签名与真实 QKI 池子成交仍需在部署后测试。

一键部署使用本项目编译产物，固定 QKI chainId、固定 Router 和 `value=0`；预估 Gas 增加 20% 余量，页面显示该上限对应的最高 Gas 费用。部署审阅与当前账户、网络、Gas Price、字节码指纹绑定，5 分钟后须重新检查。部署交易哈希会保存在当前浏览器，刷新后可查询回执，避免重复部署。部署签名由你的钱包完成，页面不接收私钥。

## 文件与编译

- `QKIDelegatedMultiHop.sol`：包含 OpenZeppelin v5.0.2 依赖的单文件版本，可直接复制到 Remix。
- `contracts/QKIDelegatedMultiHop.sol`：便于维护的原始源码。
- `build/QKIDelegatedMultiHop.abi.json`：前端使用的 ABI。
- `build/standard-input.json`：原始多文件源码的验证输入。
- `build/flattened-standard-input.json`：单文件源码的验证输入。
- `test/`：权限、到账、扣税、重复执行等测试及模拟合约。

编译器：`0.8.24+commit.e11b9ed9`；Optimizer：启用，200 runs；EVM Version：`paris`；Via IR：关闭。
选用 Paris 避免要求较新的 EVM 指令，但仍需在目标链上核对执行兼容性。
单文件与多文件的源码元数据不同；部署哪种源码，就用对应的验证输入。不同编译设置也会影响验证结果。

```bash
npm ci
npm run compile
npm test
```

依赖版本已固定，`node_modules` 不包含在压缩包内。OpenZeppelin 代码保持其逻辑不变，展开时只移除了重复的 import、pragma 和 SPDX 指令；许可证保留在 `LICENSE` 和 `OPENZEPPELIN-LICENSE`。

## 部署参数

| 项目 | 值 |
| --- | --- |
| 网络 | QKI，chainId `20181205` |
| 合约 | `QKIDelegatedMultiHop` |
| 构造参数 `router_` | `0x3c91FD5247B050A1536F24D012a17a618EEFbfCA` |
| 对照网站 | https://qki-path-quote.mofei1-9304.chatgpt.site/ |

上面的 Router 来自本次读取的网站 HTML 配置。合约只检查当前链 ID 和 Router 地址存在代码，不能证明该 Router 的安全性或当前实现；实际部署前仍需核对链上代码。部署后 Router 不可修改。没有管理员、升级入口或任意调用入口。

源码、ABI 和本地测试不等于已部署。当前没有生成实际 QKI 合约地址，也没有替你签名或发送链上交易。

## 使用顺序

1. **A 授权代币**：到输入代币合约调用 `approve(新合约地址, 授权额度)`。授权对象是这个新合约，先前给 Router 的授权不能复用。建议按需要授权额度。USDT 类代币变更已有非零额度时，先授权 0。
2. **A 创建订单**：调用 `createOrder(config, path)`。`msg.sender` 自动成为代币持有人和收款人，别人不能替 A 登记订单。订单 ID 从 `OrderCreated` 事件读取，第一笔 ID 为 1。
3. **B/C 代执行**：调用 `executeOrder(orderId)`。只需订单 ID；没有路径、数量、收款地址等可篡改参数。执行交易的地址支付 Gas，合约不支付执行奖励，也不自动补偿执行者。
4. **A 停止授权**：调用 `cancelOrder(id)` 取消一单，或者 `setOwnerPaused(true)` 暂停自己的所有订单，或者在输入代币合约 `approve(新合约地址, 0)`。撤销在链上确认后生效，不能撤回先前已经成交的交易。

ERC20 的 `approve` 只授权额度，不表达交易条件，所以安全版本需要由 A 额外登记订单。ERC20 授权和订单共同限制执行权限。
创建订单不会提前锁定或托管资金；执行时必须仍有足够的真实余额和有效授权。多个未完成订单共享同一钱包的余额和 ERC20 授权，不各自预留资金。

## config 参数

按此顺序传入 tuple：

| 参数 | 含义 |
| --- | --- |
| `amountIn` / uint256 | 每次执行从 A 扣除的输入数量，代币最小单位整数，必须大于 0 |
| `minAmountOut` / uint256 | 每次 A 实际至少收到的输出数量，输出代币最小单位，必须大于 0 |
| `deadline` / uint64 | 绝对 UNIX 秒时间戳，必须晚于当前区块时间 |
| `maxExecutions` / uint64 | 最多成功执行次数，必须大于 0；一次性交易填 1 |
| `executor` / address | `0x0000000000000000000000000000000000000000` 表示任何地址；填 B 表示仅 B 或 A 可执行 |
| `feeOnTransfer` / bool | true 使用 Router 的转账扣税兼容函数，false 使用标准函数 |

`path`：直接使用报价网站生成的地址数组，例如 `[WQKI地址, TokenB地址, TokenC地址, WQKI地址]`。这里的名称只是占位说明，实际必须填写代币合约地址。支持 2–16 个代币地址（1–15 跳）；首尾可以相同；相邻地址不能相同。是否存在足够流动性、是否重复经过不支持的池子，由 Router 实际执行结果决定。

**数量示例，仅当输入和输出均为 18 位精度：**

- 每次输入 100：`amountIn = 100000000000000000000`。
- 循环路径最低到账 101：`minAmountOut = 101000000000000000000`。
- 最多 3 次：`maxExecutions = 3`，这个订单的最多累计输入为 300。
- 先给新合约授权 300，调用 `createOrder`；之后每次调用 `executeOrder` 最多扣 100。
- 时间戳在创建时生成，例如 JavaScript `Math.floor(Date.now()/1000) + 1200` 表示大约 20 分钟后过期。不要填相对秒数 `1200`。

不同代币精度可能不同，不能统一按 18 位计算。所有额度和次数都由 A 固定，执行者不能放宽。修改路径或价格条件时，先取消旧订单，再创建新订单；订单不会跟随网页输入自动更新。

## 循环路径与收益

`actualAmountOut` 是扣除这次输入之后，由此次兑换实际返回到 A 的数量。循环路径的代币毛收益为：

`actualAmountOut - amountIn`

如需循环套利，只在毛收益至少达到某数额时成交，由 A 将 `minAmountOut` 设为 `amountIn + 最低毛收益`。合约并不强制每个订单盈利；A 自己设置过低的最低到账值仍可能允许亏损成交。

Gas 由调用 `executeOrder` 的地址支付，不从到账余额中扣除。合约不把 QKI Gas 费用自动换算成其他代币，也不保证整体净收益。`getAmountsOut` 报价只作参考，不能在执行时用可被操纵的即时报价替代 A 预先设定的最低到账值。
新合约多了代币拉取、临时授权和余额校验，Gas 和转账税可能高于直接 Router 交易。网页原有的 Router 交易模拟和 Gas 估算，不能作为新合约交易的验证结果；应对 `executeOrder` 重新 `eth_call` 和 `eth_estimateGas`。

## 扣税代币和兼容范围

- `feeOnTransfer=true` 时，先测量 A → 新合约实际收到多少，再把实际收到的数量交给 Router；最终独立校验 A 的实际到账量。
- A → 新合约 → 首个交易池，多了一次转账。输入税可能在两次转账中分别收取。例如 10% 输入税、100 输入，则新合约收到 90，首池可能只收到 81。报价与最低到账要为真实税费留出空间。
- 标准模式对输入扣税会回滚；输出不足最低到账也会回滚。失败恢复代币变化和订单剩余次数，但已经提交的失败交易仍消耗调用者 Gas。
- `feeOnTransfer` 并不能绕过黑名单、暂停、只允许 EOA、禁止中间合约转账等代币规则。对发送者额外加收税而导致 A 实际扣款大于 `amountIn` 的代币会被主动拒绝。
- 不承诺支持 rebasing、reflection、伪造余额、恶意回调等任意特殊资产。普通扣税代币仍需在目标链以真实地址和真实金额验证。
- 原生 QKI 无法通过 ERC20 `approve` 委托消费，本合约不接收原生 QKI。先由 A 将 QKI 包装成 WQKI，再使用 WQKI 路径。本合约不负责包装和解包。

## 其他函数与资金边界

- `orders(id)`：查询持有人、执行人、固定数量、有效期、剩余次数和取消状态。
- `getOrderPath(id)`：查询固定路径。
- `quoteOrder(id)`：查询 Router 对原始输入数量的储备报价，不反映额外转账税，也不表示订单当前可执行。
- `ownerPaused(A)`：查询 A 是否暂停。
- `setOwnerPaused(false)`：由 A 恢复自己的订单；已取消、已过期、次数耗尽的订单不会恢复。

合约不提供通用转账、收款人修改、管理员提现或救援功能。**不要直接给合约转账或充值**；正常执行会在一个交易里拉取并花完本次输入，历史误转代币不会被其他订单使用，也无法由本合约取回。
Router 仅获得本次实际收到的输入额度，交易成功后清零。没有重试后自动降低最低到账、无限次数默认值、管理员扣款和执行者抽成。

## 验证范围与参考

本地测试使用 Ganache 和模拟 Router/代币，覆盖多跳与循环路径、任意/指定执行者、所有者控制、取消/暂停/到期、额度撤销、次数上限、输入与输出税、发送者额外税、重入、非标准 ERC20、余额和授权回滚、历史误转资金隔离。详细结果见 `build/test-results.json`。

已编译验证原始版本和单文件版本，目标 EVM 为 Paris。本地测试不包含实际 QKI 链分叉、真实流动性、真实代币黑名单或目标 Router 当前代码的端到端验证，也不是第三方审计。上线前应使用小额对实际部署合约测试。

参考：

- 网站当前路由配置：https://qki-path-quote.mofei1-9304.chatgpt.site/
- ERC20 授权标准：https://eips.ethereum.org/EIPS/eip-20
- OpenZeppelin SafeERC20：https://docs.openzeppelin.com/contracts/5.x/api/token/erc20
- V2 Router 接口与实现：https://github.com/Uniswap/v2-periphery/blob/master/contracts/UniswapV2Router02.sol
