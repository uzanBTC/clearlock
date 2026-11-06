# 本地页面验收

本页面是纯静态文件，不需要 Node、构建工具或后端。下面的流程使用 Anvil、Foundry 和浏览器钱包完成锁仓、OTC 转让、时间快进和提取。

## 1. 启动 Anvil

在仓库根目录运行：

```powershell
anvil --chain-id 31337
```

Anvil 会打印测试账户和私钥。只在本地 Anvil 使用这些测试私钥，不要把它们放入仓库、网页或任何真实网络。

## 2. 部署本地合约和测试代币

另开终端，在仓库根目录运行：

```powershell
forge script script/DeployLocal.s.sol `
  --rpc-url http://127.0.0.1:8545 `
  --broadcast `
  --unlocked `
  --sender 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
```

从一条全新的 Anvil 链启动。默认第一账户会部署 `TimeLock` 和 `MockERC20`，并给部署账户铸造 1,000,000 枚 LTT。脚本输出中记录两个地址；TimeLock 默认地址已写入 `frontend/config.js` 的 `local` 配置。

本次本地验收使用的地址：

- TimeLock：`0x5FbDB2315678afecb367f032d93F642f64180aa3`
- MockERC20：`0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

如果更改部署账户或重复部署，请以脚本输出为准：更新 `config.js` 的 `local.contractAddress`，并在页面使用新部署的测试代币地址。

## 3. 启动静态页面

```powershell
cd frontend
python3 -m http.server 8080
```

Windows 没有 `python3` 命令时，可以使用：

```powershell
py -3 -m http.server 8080
```

打开 <http://localhost:8080>，在页面顶部选择“本地 Anvil”。

页面会请求钱包切换或添加本地链。如果插件不接受自动添加 HTTP 网络，可在钱包中手动添加：

- RPC：`http://127.0.0.1:8545`
- Chain ID：`31337`
- 货币符号：`ETH`

导入 Anvil 打印的第一、第二账户测试私钥，用它们分别创建锁仓和接收锁仓。只在本地测试钱包使用这两个公开的测试账户。

## 4. 页面操作流程

1. 点击“连接钱包”，确认页面显示本地账户和 ETH 余额。
2. 在代币地址输入框填入部署脚本输出的 `MockERC20` 地址，确认页面读取到 `Local Test Token (LTT)` 和余额。
3. 数量输入 `100`，解锁时间选择当前时间约 10 分钟之后（输入框按上海时间解释）。所有者固定为当前钱包，页面不提供创建时转给其他地址的输入。
4. 点击“检查并创建锁仓”，确认摘要；钱包会先弹出本次数量的 `approve`，确认后再弹出 `lock`。
5. 在“我的锁仓”中确认出现 `lockId = 0`，状态为锁定中。
6. 点击“转移所有权”，输入 Anvil 第二账户地址 `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`，在第二个确认框核对地址、数量和解锁时间。确认钱包交易后，第一账户的列表应移除该锁。输入第二账户地址查询，可看到该地址的全部锁仓，但第一账户只能查看，不能操作别人的锁仓。无需记住锁仓编号。
7. 在钱包切换到第二账户。该锁应自动出现在第二账户的“我的锁仓”中，到期前“提取”按钮禁用。
8. 另开终端执行时间快进（如锁得更久，请把 `900` 增大到足以越过解锁时间）：

```powershell
cast rpc evm_increaseTime 900 --rpc-url http://127.0.0.1:8545
cast rpc evm_mine --rpc-url http://127.0.0.1:8545
```

9. 等待页面读到新区块，或点击列表的“刷新”。状态变为“可提取”后点击“提取”，确认钱包交易。第二账户的 LTT 余额应增加 100，列表仍显示该锁并标注“已提取”。

## 5. 页面检查项

- 切换账户和网络后，页面自动刷新地址、余额和列表。
- 当前钱包不在页面选择的 chainId 时，页面提示并请求钱包切链；测试网不存在时会请求添加测试网。
- 锁仓会先估算 gas，估算失败不会发交易。
- 每笔交易显示等待签名、已发送、区块浏览器链接（本地链没有浏览器链接）和已确认/失败。
- 页面不写入 localStorage。除静态文件、钱包和所选链的 RPC 外，页面没有其他请求。区块浏览器只在主动点击链接时打开。

## 6. 自动化浏览器验收（可选）

`script/frontend-smoke.cjs` 使用 Chromium 和一个接入 Anvil 的 EIP-1193 测试适配器操作页面。适配器使用 Anvil 已解锁账户，测试交易真实上本地链。它还检查错误链、无效转让地址、预检失败不发送、拒签、手机宽度和浏览器请求范围。Playwright 只供测试使用，页面运行无需安装它。

在本地链已部署、页面已启动后，从仓库根目录执行：

```powershell
npm install --prefix "$env:TEMP\timelock-check" playwright
$env:PLAYWRIGHT_MODULE = "$env:TEMP\timelock-check\node_modules\playwright"
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
node script/frontend-smoke.cjs
```

BSC 测试网的实链验收见 [`deployments/testnet.md`](../deployments/testnet.md)。

## 7. 本次执行结果（2026-11-06）

- `forge build`：编译通过，无警告。
- `forge test -vvv`：18 项通过，包含锁仓、转移、提取均不产生 TimeLock 日志的断言；invariant 执行 512 次有效调用，0 次回滚，并检查未提取本金之和与 `totalLocked` 一致。
- `forge coverage --report summary`：`src/TimeLock.sol` 行 54/54、语句 50/50、分支 36/36、函数 10/10，均为 100%。
- JavaScript 语法检查通过；页面 ABI 与 `out/TimeLock.sol/TimeLock.json` 的 ABI 一致。
- 无事件版本在独立的 Anvil 链（RPC 端口 18545）部署，浏览器测试将本地 RPC 路由到该链以保留原 8545 链的状态。真实交易流程通过：精确授权 → 为自己创建 `lockId = 0` → OTC 两次确认转移所有权 → 切换所有者 → `evm_increaseTime` / `evm_mine` → 提取 100 LTT；提现后保留“已提取”记录。各步骤的回执中 TimeLock 地址发出的日志数均为 0。
- 同时验证了未连接钱包按地址查询、自动加载我的锁仓、其他地址只读查询、查看我的、无效地址校验、最大按钮、预检失败不发交易、拒签提示、账户/网络切换及交易哈希保留。浏览器时区设为美国洛杉矶时，输入仍正确按上海时间换算；390px 手机宽度下无页面横向溢出，浏览器错误为 0，静态文件和本地 RPC 以外的请求为 0。

本地验收交易（Anvil 重启后这些记录失效）：

| 操作 | 哈希 |
| --- | --- |
| approve | `0x8658e04c86dae27c8c3717d793d1224f5ab6bac0207311c892702005631f1421` |
| lock | `0x9d8aa9b179487f3011ec2ce84c6def72d6dcccfbd33504c39d83ab2be0f55ea8` |
| transferLock | `0x2801357efce1d58ac5a580ff7b5eb7db13009a65bc9e341f51e3e4ff97e5ca73` |
| withdraw | `0x26f42dbb28642ca8a82bbdb15141e2b8972d5798c3227ff71408d280c25bbe41` |
