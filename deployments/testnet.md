# BSC 测试网部署与页面验收

## 当前版本：TimeLock 不发送事件

2026-11-06 移除 TimeLock 的全部事件后，重新部署并更新了 `frontend/config.js` 的测试网地址。旧合约不可升级，历史地址保留在后文。

- 当前 TimeLock：[0x8cB52aF8deC38D15F4B23C606D4637BE3a6Cd4af](https://testnet.bscscan.com/address/0x8cB52aF8deC38D15F4B23C606D4637BE3a6Cd4af)
- 测试代币沿用 TLT：`0x2a1a339f6D07FC5F507B2474f93f11ab9beFCCf9`。
- 部署、原所有者和新所有者仍使用下方记录的专用测试账户。

| 步骤 | 交易哈希 | 区块 |
| --- | --- | ---: |
| 部署无事件版本 | [0xb3e2df14be5ecb2ab4a5eda6befd07374c1d3359d3fa9f6bfd8c84ae35279c6c](https://testnet.bscscan.com/tx/0xb3e2df14be5ecb2ab4a5eda6befd07374c1d3359d3fa9f6bfd8c84ae35279c6c) | 141121988 |
| 页面授权 100 TLT | [0x48a795fd969c55d5a23ca13fcf7c7c778b20a5209c6ae947ab0b84deed90cf3a](https://testnet.bscscan.com/tx/0x48a795fd969c55d5a23ca13fcf7c7c778b20a5209c6ae947ab0b84deed90cf3a) | 141122149 |
| 页面为自己锁仓 100 TLT | [0x5fa4937ef505c12010e0fbc22030e11b7ebf5bb9a5a432a5d1507b794478c8f5](https://testnet.bscscan.com/tx/0x5fa4937ef505c12010e0fbc22030e11b7ebf5bb9a5a432a5d1507b794478c8f5) | 141122162 |
| 页面转移所有权 | [0xdcda2bc56596667fc84939600a8bb65de3bdc8db11ee9a7ccb4d2d45c580b056](https://testnet.bscscan.com/tx/0xdcda2bc56596667fc84939600a8bb65de3bdc8db11ee9a7ccb4d2d45c580b056) | 141122182 |
| 页面由新所有者到期提取 | [0xdf08922e4c6b42267c3db587730386fc5265691b7da9ef15c4fc59615938acb6](https://testnet.bscscan.com/tx/0xdf08922e4c6b42267c3db587730386fc5265691b7da9ef15c4fc59615938acb6) | 141122433 |

以上步骤全部成功，回执中 TimeLock 地址产生的日志数均为 **0**；代币自身的标准日志保留。新版 ABI 中没有事件项，页面只通过状态查询更新列表。新所有者于上海时间 17:06 到期后提取，净增 100 TLT，`withdrawn = true`、`totalLocked(TLT) = 0`。浏览器错误为 0，链上运行时字节码与当前 Foundry 产物一致。未提交 BscScan 源码验证。

## 历史版本：保留事件的初始验收

2026-11-06 在 BSC 测试网（chain ID 97）完成真实链上验收。用 Chromium 操作本地页面，浏览器通过 EIP-1193 测试适配器请求签名，由本机专用加密测试钱包在浏览器外签名。全部回执状态为成功。

| 项目 | 地址 |
| --- | --- |
| TimeLock | [0x36CF025d32A56e34bB4f7a96d598684f5fd9520a](https://testnet.bscscan.com/address/0x36CF025d32A56e34bB4f7a96d598684f5fd9520a) |
| MockERC20（TimeLock Test Token / TLT，18 位小数） | [0x2a1a339f6D07FC5F507B2474f93f11ab9beFCCf9](https://testnet.bscscan.com/address/0x2a1a339f6D07FC5F507B2474f93f11ab9beFCCf9) |
| 部署者和初始受益人 | `0xa84E42f37fAb9D5D6eb3277bE743D513E9982910` |
| 转让后的受益人 | `0xC795Bc227EBeDe9C6d0040F28eA83Af7B36EE886` |

| 步骤 | 交易哈希 | 区块 |
| --- | --- | ---: |
| 部署 TimeLock | [0x4fe6925ef71d4192498c17a5ab6c85f2288a92ca377aab91b5da76a450fd53ab](https://testnet.bscscan.com/tx/0x4fe6925ef71d4192498c17a5ab6c85f2288a92ca377aab91b5da76a450fd53ab) | 141112893 |
| 部署 MockERC20 | [0xfc310915921d245c3ae0090041aae7f18274fd5d2958d8e3d509b4c4aeb21970](https://testnet.bscscan.com/tx/0xfc310915921d245c3ae0090041aae7f18274fd5d2958d8e3d509b4c4aeb21970) | 141112914 |
| 铸造测试代币 | [0xe6e2bb5fcd1c71736d87e2ff009c178957955bb5b52b58aacc563d0226934fb1](https://testnet.bscscan.com/tx/0xe6e2bb5fcd1c71736d87e2ff009c178957955bb5b52b58aacc563d0226934fb1) | 141112923 |
| 给新受益人支付提取 gas 用的 tBNB | [0xf67388cd5a2d8b3488044622cf5d3cb70e2813fc31af529e8226273b18edc30f](https://testnet.bscscan.com/tx/0xf67388cd5a2d8b3488044622cf5d3cb70e2813fc31af529e8226273b18edc30f) | 141112944 |
| 页面：授权 100 TLT | [0xe04d8d98f33cdccc6e27055d5e2b3be4faab79382380e3cdf1e35faeb9e3b2c9](https://testnet.bscscan.com/tx/0xe04d8d98f33cdccc6e27055d5e2b3be4faab79382380e3cdf1e35faeb9e3b2c9) | 141113603 |
| 页面：创建 `lockId = 0`，锁入 100 TLT | [0x1c08bee52bd2f65cd23ba93127e740eabcff61b3dcfd227d1c6b2618a84a6964](https://testnet.bscscan.com/tx/0x1c08bee52bd2f65cd23ba93127e740eabcff61b3dcfd227d1c6b2618a84a6964) | 141113612 |
| 页面：转让给新受益人 | [0x09d690919eab495e89913908eeed6dcd8828deede3c0555891a35eb6e42242aa](https://testnet.bscscan.com/tx/0x09d690919eab495e89913908eeed6dcd8828deede3c0555891a35eb6e42242aa) | 141113644 |
| 页面：新受益人到期提取 | [0x5a67ba24e990fd90e869aea3ccdc3fd0a3fcb35bd74915eddceb2e88678a24a5](https://testnet.bscscan.com/tx/0x5a67ba24e990fd90e869aea3ccdc3fd0a3fcb35bd74915eddceb2e88678a24a5) | 141113913 |

锁的解锁时间为上海时间 2026-11-06 16:02:00（UTC 08:02:00，Unix `1793952120`）。转让后，旧地址尝试估算提取 gas 时返回 `not beneficiary`。到期后，新受益人实收 100 TLT，`withdrawn = true`，该代币的 `totalLocked = 0`。

初次验收时通过 `eth_getCode` 核对，链上运行时字节码与当时保留事件的 Solidity 0.8.24、optimizer 200 runs 产物一致。它与当前无事件版本不同。未提交 BscScan 源码验证。测试用的是 MockERC20；Flap 风格买卖税和普通转账扣税的行为由本地合约测试覆盖。
