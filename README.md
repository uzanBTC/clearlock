# Flap 税币固定锁仓合约

这是一个无管理员、不可升级的固定时间 ERC20 锁仓合约，面向 Flap 平台税币的自用锁仓和 OTC 受益人转移。

合约只处理锁定本金，不处理 Flap Dividend 分红，不支持线性释放，也不支持提前取出、管理员救援或升级。

## 功能

- `lock(token, amount, unlockTime, beneficiary)`：按合约余额实际增加量创建锁。
- `withdraw(lockId)`：到期后由当前受益人提取完整记录数量。
- `transferLock(lockId, newBeneficiary)`：当前受益人转让整个锁，适合 OTC。
- `locks(lockId)`、`locksCount()`、`totalLocked(token)`：查询锁信息。

锁的解锁时间在创建后固定，转让不会改变数量或解锁时间。合约没有 owner、admin、upgrade、rescue、sweep 或 selfdestruct。

部署 gas 以实际链上估算为准，无事件版本的测试网部署消耗 862,938 gas。

TimeLock 不声明或发送任何事件；查询使用 `locksCount()` / `locks()`。代币自身的 `Approval`、`Transfer` 等日志由代币合约决定。

## Flap 税币说明

Flap 税币的买卖税主要发生在 Bonding Curve 或 DEX 主池交易中。普通钱包之间的转账通常不会触发买卖税，因此锁仓合约与受益人之间的转账应足额到账。

合约仍然按余额前后差记录锁仓实际到账量。提现时还会检查受益人余额实际增加量必须等于记录量。如果某个代币对普通钱包转账也扣税，提现会回滚，不会从其他锁中补足。

Flap 税币是否有效由使用者链下核实；本合约不依赖 Flap Registry。Flap Dividend 分红不在本期范围内。

## 本地测试

安装 Foundry 并将 `forge` 加入 PATH 后，在仓库根目录运行：

```bash
forge build
forge test -vvv
forge coverage --report summary
```

## 本地部署

启动本地链：

```bash
anvil
```

另开终端并加载环境变量后执行：

```bash
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

部署脚本没有构造参数。

## BSC 测试网部署

先复制环境文件并填写私钥。私钥只保存在本地 `.env`，绝不提交：

```bash
copy .env.example .env
```

加载环境变量后：

```bash
forge script script/Deploy.s.sol --rpc-url $BSC_TESTNET_RPC --broadcast --verify
```

如果自动验证失败，可单独验证：

```bash
forge verify-contract <TimeLock地址> src/TimeLock.sol:TimeLock --chain bsc-testnet --watch
```

BscScan 手动验证参数：

- Compiler：Solidity `0.8.24`
- License：MIT
- Optimization：Yes，Runs `200`
- EVM Version：Compiler default
- Constructor Arguments：空
- Source Code：`src/TimeLock.sol` 单文件内容

部署后把地址、部署交易、验证结果和完整测试流程交易哈希写入 `deployments/testnet.md`。

## BscScan 操作手册

### 1. 授权

先打开代币合约的 **Write Contract**，调用：

```text
approve(TimeLock地址, 数量)
```

数量必须带代币精度。例如 18 位小数的 100 枚代币填写 `100000000000000000000`。

### 2. 创建锁

打开 TimeLock 合约的 **Write Contract**，调用：

```text
lock(token, amount, unlockTime, beneficiary)
```

- `token`：Flap 税币合约地址。
- `amount`：要授权和尝试转入的数量，带精度。
- `unlockTime`：Unix 秒级时间戳，必须晚于当前链上时间。
- `beneficiary`：到期后可以提取和转让该锁的地址。

常用时间戳可以在本地用 `date +%s` 或可信时间戳工具换算。建议比目标时间多留几分钟，避免区块时间和人工操作误差。

锁仓确认后，通过 `locksCount()` / `locks()` 查看实际记录的数量。税币若在转入时扣税，记录量以实际到账为准。使用本地页面时，页面会按你的钱包地址列出全部锁仓，无需记住 `lockId`。

### 3. OTC 转让

当前受益人调用：

```text
transferLock(lockId, 新受益人地址)
```

转让后旧地址立即失去权限，新受益人获得完整锁的提取权。数量和解锁时间不变，且可以连续转让。OTC 双方可通过页面按新所有者地址查询，核对锁仓数量与解锁时间。

### 4. 到期提取

到期后，当前受益人调用：

```text
withdraw(lockId)
```

提取要求区块时间大于等于 `unlockTime`。如果代币对普通转账扣税，合约会检测到受益人净到账不足并回滚。

### 5. 查询

在 **Read Contract** 查询：

- `locks(lockId)`：代币、受益人、实际锁定数量、解锁时间、是否已提取。
- `locksCount()`：锁总数。
- `totalLocked(token)`：该代币当前仍锁定的本金总量。

不要直接把代币转到 TimeLock 地址。直接转入没有对应 `lockId`，合约没有 rescue 或 sweep 函数，无法取回。

## BSC 主网

当前无事件版本已部署到 BSC 主网（chain ID `56`）：[0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA](https://bscscan.com/address/0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA)。链上字节码已与当前编译产物核对，源码已通过 Sourcify 匹配验证。部署交易、实际费用和验证详情见 [`deployments/mainnet.md`](deployments/mainnet.md)。使用下方本地页面即可连接此合约。

需要独立部署新实例时，使用主网 RPC：

```bash
forge script script/Deploy.s.sol --rpc-url $BSC_MAINNET_RPC --broadcast --verify
```

主网首次使用时，先用少量目标代币完成授权、锁仓、转让和提取，再锁正式数量。本次部署未操作真实代币。

## 本地操作页面

纯静态操作页面位于 [`frontend/`](frontend/)，使用本地打包的 ethers v6 和浏览器钱包调用 TimeLock。无需构建、域名或后端。顶部可选择 BSC 主网（56，默认）、BSC 测试网（97）和本地 Anvil（31337）。三个网络的地址均已配置在 [`frontend/config.js`](frontend/config.js)，主网为 `0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA`。页面不接受手填合约地址。

本地运行：

```bash
cd frontend
python3 -m http.server 8080
```

然后打开 <http://localhost:8080>。Windows 如果没有 `python3`，使用 `py -3 -m http.server 8080`。只需本机访问时，可以在命令末尾加 `--bind 127.0.0.1`。选择网络，连接 MetaMask、OKX Wallet 或其他 EIP-1193 钱包。Anvil 完整操作步骤见 [`frontend/TESTING.md`](frontend/TESTING.md)，测试网部署和交易哈希见 [`deployments/testnet.md`](deployments/testnet.md)。

页面创建的锁仓固定归当前钱包所有，创建表单不提供所有者地址输入。连接钱包后自动加载自己的全部锁仓；也可以直接按钱包地址查询，未连接钱包即可只读查看。需要 OTC 交割时，在对应锁仓点击“转移所有权”，输入新所有者后再次确认；到期后由当前所有者提取。

页面读取代币精度和余额，按上海时间换算解锁时间。授权不足时只申请本次所需数量；每笔交易先估算 gas，再请求钱包签名。交易记录保留哈希和浏览器链接，确认后重新读取合约状态，不依赖事件日志。解锁时间固定，合约没有延期接口。页面不读取或保存私钥，不写入 localStorage。

`frontend/abi.js` 来自 Foundry 编译产物。如果合约 ABI 发生变化，在仓库根目录重新生成：

```bash
forge build
python3 -c "import json,pathlib; p=pathlib.Path; abi=json.loads(p('out/TimeLock.sol/TimeLock.json').read_text(encoding='utf-8'))['abi']; p('frontend/abi.js').write_text('// Generated from out/TimeLock.sol/TimeLock.json. Do not edit by hand.'+chr(10)+'const TIMELOCK_ABI = '+json.dumps(abi,separators=(',',':'))+';'+chr(10),encoding='utf-8')"
```
