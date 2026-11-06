# BSC 主网部署记录

2026-11-06 17:51:18（Asia/Shanghai，UTC 09:51:18）部署当前无事件版本的 TimeLock。

| 项目 | 结果 |
| --- | --- |
| 网络 | BSC 主网，chain ID `56` |
| TimeLock 地址 | [0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA](https://bscscan.com/address/0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA) |
| 部署交易 | [0xd36d2c46f2b212bbf31e6365c66763f89ba617604a1a8e74b12ac9a7df22b289](https://bscscan.com/tx/0xd36d2c46f2b212bbf31e6365c66763f89ba617604a1a8e74b12ac9a7df22b289) |
| 区块 | `131987823` |
| 部署地址 | `0x5d8Ec41D9FA23acFB47A870500d5a67d1EB9DD3e` |
| 部署源码提交 | `87a18f4c198d50cec04d591b86a66673faf0c97c` |
| 回执状态 | 成功（`status = 1`） |
| 实际 Gas | `862938` |
| 实际 Gas 单价 | `0.05 Gwei` |
| 实际手续费 | **`0.0000431469 BNB`** |
| 构造参数 / 转入 BNB | 无 / `0` |
| 部署回执日志数 | `0` |
| 部署区块的 `locksCount()` | `0` |

## 编译与核验

- Solidity `0.8.24+commit.e11b9ed9`，optimizer 开启，`200 runs`。
- EVM target：`cancun`；`metadata.bytecodeHash = none`。
- 部署前 `forge build`、`forge test -q` 通过。
- 部署交易创建字节码与 `out/TimeLock.sol/TimeLock.json` 一致。
- 通过 `eth_getCode` 核对，链上运行时字节码与同一编译产物逐字节一致。
- 创建字节码 Keccak-256：`0x60d8c82c18161d692fcfe8bf875159a7344c756406a0e45ee66c07525a9cb0a7`。
- 运行时字节码 Keccak-256：`0xc66c7ea34b467cf52cdcf32efaf5d4135bc8bef7d2b93a670bd6ad00cd5064db`。
- [Sourcify 验证结果](https://sourcify.dev/server/v2/contract/56/0xDa8C53c3b3E033cF6f3CDD63eaB0F533D2A80bEA)：`creationMatch = match`、`runtimeMatch = match`，验证时间 UTC `2026-11-06T09:52:02Z`。
- 未向 BscScan 提交源码验证；Sourcify 验证与 BscScan 验证是独立服务。

## 页面与使用范围

`frontend/config.js` 已将 `mainnet.contractAddress` 设置为上述地址，默认选择 BSC 主网。启动本地静态页面并连接 BSC 钱包即可调用。

本次主网只发送合约部署交易，未操作真实代币。锁仓、所有权转移和到期提取的完整流程已在 Anvil 与 BSC 测试网完成，见 `frontend/TESTING.md`、`deployments/testnet.md`。主网首次使用时，先由本人用少量目标代币验证完整流程。

专用部署钱包的加密文件留在本机 `%LOCALAPPDATA%/TimeLock/MainnetWallet/`，未进入仓库。部署地址不拥有管理员或合约所有权；部署余额扣除手续费后仍留在该地址。
