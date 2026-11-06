// Optional developer check: npm install --prefix <temporary-folder> playwright
// Set PLAYWRIGHT_MODULE to that folder's node_modules/playwright directory.
// Uses unlocked Anvil test accounts only; no private keys enter the page.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const ethers = require("../frontend/vendor/ethers.umd.min.js");

(async () => {
    const root = path.join(__dirname, "..");
    const rpcUrl = process.env.ANVIL_RPC_URL || "http://127.0.0.1:8545";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    assert.equal((await provider.getNetwork()).chainId, 31337n);
    const accounts = await provider.send("eth_accounts", []);
    const artifact = JSON.parse(fs.readFileSync(path.join(root, "out/TimeLock.sol/TimeLock.json")));
    const tokenArtifact = JSON.parse(fs.readFileSync(path.join(root, "out/MockERC20.sol/MockERC20.json")));
    const lockAddress = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const tokenAddress = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
    const contract = new ethers.Contract(lockAddress, artifact.abi, provider);
    const token = new ethers.Contract(tokenAddress, tokenArtifact.abi, provider);
    if (await token.allowance(accounts[0], lockAddress) !== 0n) {
        await (await token.connect(await provider.getSigner(accounts[0])).approve(lockAddress, 0)).wait();
    }
    const lockId = (await contract.locksCount()).toString();
    const startingBalance = await token.balanceOf(accounts[1]);
    const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    try {
        const page = await browser.newPage({ timezoneId: "America/Los_Angeles" });
        const errors = [], requests = [], calls = [];
        if (rpcUrl !== "http://127.0.0.1:8545") await page.route("http://127.0.0.1:8545/**", async (route) => {
            const response = await route.fetch({ url: rpcUrl });
            await route.fulfill({ response });
        });
        page.setDefaultTimeout(15000);
        page.on("console", (message) => { if (message.type() === "error") console.error("Browser:", message.text()); });
        process.on("beforeExit", () => { if (process.exitCode) console.error("Last RPC methods:", calls.slice(-12).map((call) => call.method)); });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("request", (request) => requests.push(request.url()));
        await page.exposeFunction("recordRpc", (request) => calls.push(request));
        await page.addInitScript(({ accounts }) => {
            const listeners = new Map();
            let account = accounts[0], chain = "0x38", knownLocal = false;
            const emit = (name, value) => listeners.get(name)?.forEach((fn) => fn(value));
            window.testWallet = {
                changeAccount(value) { account = value; emit("accountsChanged", value ? [value] : []); },
                changeChain(value) { chain = value; emit("chainChanged", value); },
                rejectNext: false,
                failEstimate: false
            };
            window.ethereum = {
                isMetaMask: true,
                on(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
                removeListener(name, fn) { listeners.get(name)?.delete(fn); },
                async request({ method, params = [] }) {
                    await window.recordRpc({ method, params });
                    if (method === "eth_chainId") return chain;
                    if (method === "eth_accounts" || method === "eth_requestAccounts") return account ? [account] : [];
                    if (method === "wallet_addEthereumChain") { knownLocal = true; return null; }
                    if (method === "wallet_switchEthereumChain") {
                        if (params[0].chainId === "0x7a69" && !knownLocal) throw Object.assign(new Error("Unknown chain"), { code: 4902 });
                        chain = params[0].chainId; emit("chainChanged", chain); return null;
                    }
                    if (method === "eth_sendTransaction" && window.testWallet.rejectNext) {
                        window.testWallet.rejectNext = false;
                        throw Object.assign(new Error("User rejected"), { code: 4001 });
                    }
                    if (method === "eth_estimateGas" && window.testWallet.failEstimate) {
                        window.testWallet.failEstimate = false;
                        throw Object.assign(new Error("execution reverted: still locked"), { code: 3 });
                    }
                    const response = await fetch("http://127.0.0.1:8545/", {
                        method: "POST", headers: { "content-type": "application/json" },
                        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
                    });
                    const data = await response.json();
                    if (data.error) throw Object.assign(new Error(data.error.message), data.error);
                    return data.result;
                }
            };
        }, { accounts });
        await page.goto("http://127.0.0.1:8080/", { waitUntil: "networkidle" });
        assert.equal(await page.locator("#networkSelect").inputValue(), "mainnet");
        await page.locator("#networkSelect").selectOption("local");
        assert.equal(await page.locator("#beneficiaryInput").count(), 0);
        assert.equal(await page.locator("#lookupIdInput").count(), 0);
        // An address can be queried without granting wallet access.
        await page.locator("#addressSearchInput").fill(accounts[9]);
        await page.locator("#addressSearchButton").click();
        await page.waitForFunction(() => document.querySelector("#locksEmpty").textContent.includes("没有锁仓"));
        assert(!calls.some((call) => call.method === "eth_requestAccounts"));
        await page.locator("#connectButton").click();
        await page.waitForFunction(() => !document.querySelector("#lockSubmit").disabled);
        assert(calls.some((call) => call.method === "wallet_addEthereumChain"));
        assert.equal((await page.locator("#creationOwner").textContent()).toLowerCase(), accounts[0].toLowerCase());
        assert.equal((await page.locator("#addressSearchInput").inputValue()).toLowerCase(), accounts[0].toLowerCase());
        await page.locator("#tokenAddress").fill(tokenAddress);
        await page.waitForFunction(() => document.querySelector("#tokenMeta").textContent.includes("Local Test Token"));
        await page.locator("#maxButton").click();
        await page.waitForFunction(() => document.querySelector("#amountInput").value !== "");
        assert(BigInt(ethers.parseEther(await page.locator("#amountInput").inputValue())) > 0n);
        await page.locator("#tokenAddress").fill("invalid");
        assert(await page.locator("#maxButton").isDisabled());
        await page.locator("#tokenAddress").fill(tokenAddress);
        await page.waitForFunction(() => !document.querySelector("#maxButton").disabled);
        await page.locator("#amountInput").fill("100");
        // Refresh Anvil's timestamp after previous runs advanced its clock.
        await provider.send("evm_mine", []);
        const block = await provider.getBlock("latest");
        const unlock = Math.ceil((block.timestamp + 660) / 60) * 60;
        const dateInput = new Date((unlock + 28800) * 1000).toISOString().slice(0, 16);
        await page.locator("#unlockInput").fill(dateInput);
        await page.locator("#lockSubmit").click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        assert((await page.locator("#confirmBody").textContent()).includes("UTC"));
        await page.locator("#confirmOkay").click();
        const row = page.locator("#locksBody tr").filter({ has: page.locator(`[data-lock-id="${lockId}"]`) });
        try { await row.waitFor({ state: "visible", timeout: 30000 }); }
        catch (error) { console.error("UI:", await page.locator("#globalNotice").textContent(), await page.locator("#activityList").textContent(), await page.locator("#locksEmpty").textContent()); throw error; }
        assert(await row.locator('[data-action="withdraw"]').isDisabled());
        assert.equal((await contract.locks(lockId)).unlockTime, BigInt(unlock));
        assert.equal((await contract.locks(lockId)).beneficiary.toLowerCase(), accounts[0].toLowerCase());
        const approve = calls.filter((call) => call.method === "eth_sendTransaction").map((call) => call.params[0]).find((tx) => tx.data.startsWith("0x095ea7b3"));
        assert(approve);
        assert.equal(token.interface.parseTransaction(approve).args[1], ethers.parseEther("100"));
        assert.equal(await token.allowance(accounts[0], lockAddress), 0n);
        assert.equal(await row.locator('[data-action="transfer"]').textContent(), "转移所有权");
        await page.locator("#addressSearchInput").fill("bad address");
        await page.locator("#addressSearchButton").click();
        assert((await page.locator("#globalNotice").textContent()).includes("有效的钱包地址"));
        await page.locator("#showMineButton").click();
        await row.waitFor({ state: "visible" });
        await row.locator('[data-action="transfer"]').click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        await page.locator("#dialogAddress").fill("invalid");
        await page.locator("#confirmOkay").click();
        assert(await page.locator("#confirmDialog").isVisible());
        assert(await page.locator("#dialogError").isVisible());
        await page.locator("#dialogAddress").fill(accounts[1]);
        await page.locator("#confirmOkay").click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        await page.waitForFunction(() => document.querySelector("#confirmTitle").textContent.includes("再次确认") && document.querySelector("#confirmDialog").open);
        assert((await page.locator("#confirmBody").textContent()).includes("自己将无法提取"));
        await page.locator("#confirmOkay").click();
        await row.waitFor({ state: "detached", timeout: 30000 });
        assert.equal((await contract.locks(lockId)).beneficiary.toLowerCase(), accounts[1].toLowerCase());
        // Querying another owner exposes their locks with no transaction controls.
        await page.locator("#addressSearchInput").fill(accounts[1]);
        await page.locator("#addressSearchButton").click();
        await page.waitForFunction(() => document.querySelector("#locksBody").textContent.includes("仅查看"));
        assert.equal(await page.locator("#locksBody [data-action]").count(), 0);
        await page.locator("#showMineButton").click();
        await page.waitForFunction(() => document.querySelector("#locksHeading").textContent === "我的锁仓" && !document.querySelector("#locksEmpty").textContent.includes("正在查询"));
        assert.equal(await row.count(), 0);
        await page.evaluate((account) => window.testWallet.changeAccount(account), accounts[1]);
        await row.waitFor({ state: "visible", timeout: 15000 });
        assert.equal((await page.locator("#creationOwner").textContent()).toLowerCase(), accounts[1].toLowerCase());
        const latest = await provider.getBlock("latest");
        await provider.send("evm_increaseTime", [Math.max(1, unlock - latest.timestamp + 1)]);
        await provider.send("evm_mine", []);
        await page.waitForFunction((id) => !document.querySelector(`#locksBody [data-action="withdraw"][data-lock-id="${id}"]`).disabled, lockId, { timeout: 15000 });
        // A failed estimate must never reach eth_sendTransaction.
        const sends = calls.filter((call) => call.method === "eth_sendTransaction").length;
        await page.evaluate(() => { window.testWallet.failEstimate = true; });
        await row.locator('[data-action="withdraw"]').click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        await page.locator("#confirmOkay").click();
        await page.waitForFunction(() => document.querySelector("#globalNotice").textContent.includes("预检失败"));
        assert.equal(calls.filter((call) => call.method === "eth_sendTransaction").length, sends);
        assert((await page.locator("#globalNotice").textContent()).includes("尚未到解锁时间"), await page.locator("#globalNotice").textContent());
        await page.evaluate(() => { window.testWallet.rejectNext = true; });
        await row.locator('[data-action="withdraw"]').click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        await page.locator("#confirmOkay").click();
        await page.waitForFunction(() => document.querySelector("#globalNotice").textContent.includes("取消"));
        await row.locator('[data-action="withdraw"]').click();
        await page.locator("#confirmDialog").waitFor({ state: "visible" });
        await page.locator("#confirmOkay").click();
        await page.waitForFunction((id) => [...document.querySelectorAll("#locksBody tr")].some((row) => row.querySelector(`[data-lock-id="${id}"]`) && row.textContent.includes("已提取")), lockId, { timeout: 30000 });
        assert.equal(await token.balanceOf(accounts[1]), startingBalance + ethers.parseEther("100"));
        await page.locator("#addressSearchInput").fill(accounts[1]);
        await page.locator("#addressSearchButton").click();
        await page.waitForFunction(() => document.querySelector("#locksBody").textContent.includes("已提取"));
        assert.equal(await page.locator("#activityList .activity-item[data-status=confirmed]").count(), 4);
        assert.equal(await page.locator("#activityList .activity-item[data-status=failed]").count(), 1);
        assert.equal(await page.locator("#activityList .activity-item[data-status=confirmed] .address").count(), 4);
        await page.evaluate(() => window.testWallet.changeChain("0x38"));
        await page.waitForFunction(() => document.querySelector("#chainValue").textContent.includes("不匹配"));
        assert(await page.locator("#lockSubmit").isDisabled());
        await page.waitForFunction(() => document.querySelector("#locksBody").textContent.includes("仅查看"));
        assert.equal(await page.locator("#locksBody [data-action]").count(), 0);
        await page.evaluate(() => window.testWallet.changeChain("0x7a69"));
        await page.waitForFunction(() => !document.querySelector("#lockSubmit").disabled);
        await page.setViewportSize({ width: 390, height: 844 });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
        assert.deepEqual(errors, []);
        assert(requests.every((url) => url.startsWith("http://127.0.0.1:8080/") || url.startsWith("http://127.0.0.1:8545/")));
        const receipts = await page.locator("#activityList .activity-item[data-status=confirmed]").evaluateAll((items) => items.map((item) => item.dataset.hash).reverse());
        for (const hash of receipts) {
            const receipt = await provider.getTransactionReceipt(hash);
            assert(receipt.logs.every((log) => log.address.toLowerCase() !== lockAddress.toLowerCase()));
        }
        console.log(JSON.stringify({ passed: true, lockId, unlockTime: unlock, transactionHashes: receipts, pageErrors: errors, outsideRequests: 0, mobileWidth: 390, timeLockEvents: 0, checks: "self-owned creation, address lookup with and without wallet, transfer, view-only other owner, exact approve, account/chain events, invalid dialog, estimate rejection, wallet cancellation, time advance, withdrawal, hashes, mobile, UTC+8 on US timezone" }, null, 2));
    } finally { await browser.close(); provider.destroy(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
