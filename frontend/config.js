// TimeLock addresses are deployment configuration. Set mainnet only after
// deploying and verifying the address on chain ID 56.
const APP_CONFIG = {
    defaultNetwork: "mainnet",
    networks: {
        mainnet: {
            key: "mainnet",
            name: "BSC 主网",
            chainId: 56,
            chainIdHex: "0x38",
            rpcUrls: ["https://bsc-dataseed.bnbchain.org"],
            nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
            contractAddress: "",
            explorerUrl: "https://bscscan.com",
            explorerName: "BscScan"
        },
        testnet: {
            key: "testnet",
            name: "BSC 测试网",
            chainId: 97,
            chainIdHex: "0x61",
            rpcUrls: ["https://data-seed-prebsc-1-s1.bnbchain.org:8545"],
            nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
            contractAddress: "0x8cB52aF8deC38D15F4B23C606D4637BE3a6Cd4af",
            explorerUrl: "https://testnet.bscscan.com",
            explorerName: "BscScan Testnet"
        },
        local: {
            key: "local",
            name: "本地 Anvil",
            chainId: 31337,
            chainIdHex: "0x7a69",
            rpcUrls: ["http://127.0.0.1:8545"],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            explorerUrl: "",
            explorerName: "本地链"
        }
    }
};
