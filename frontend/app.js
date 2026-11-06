/* global ethers, APP_CONFIG, TIMELOCK_ABI */

(function () {
    "use strict";

    const ERC20_ABI = [
        "function name() view returns (string)",
        "function symbol() view returns (string)",
        "function decimals() view returns (uint8)",
        "function balanceOf(address) view returns (uint256)",
        "function allowance(address,address) view returns (uint256)",
        "function approve(address,uint256) returns (bool)"
    ];
    const SHANGHAI_OFFSET_SECONDS = 8 * 60 * 60;
    const CHUNK_SIZE = 25;
    const appState = {
        selectedNetwork: APP_CONFIG.defaultNetwork,
        provider: null,
        signer: null,
        account: null,
        chainId: null,
        timeLock: null,
        readTimeLock: null,
        tokenMeta: new Map(),
        walletCandidates: [],
        walletProvider: null,
        currentBlockTimestamp: null,
        blockReadAt: 0,
        session: 0,
        previewRequest: 0,
        listRequest: 0,
        walletRequest: 0,
        busy: false,
        switching: false,
        cancelConfirmation: null,
        listAddress: null,
        listeners: null
    };

    const $ = (id) => document.getElementById(id);
    const selectedNetwork = () => APP_CONFIG.networks[appState.selectedNetwork];
    const configuredAddress = () => ethers.isAddress(selectedNetwork().contractAddress) && selectedNetwork().contractAddress !== ethers.ZeroAddress;
    const isConnected = () => Boolean(appState.account && appState.provider);
    const hasCorrectChain = () => Boolean(appState.chainId === selectedNetwork().chainId);
    const nowSeconds = () => Math.floor(Date.now() / 1000);
    const readProviders = new Map();

    function rpcProvider(network) {
        if (!readProviders.has(network.chainId)) {
            const request = new ethers.FetchRequest(network.rpcUrls[0]);
            request.timeout = 10000;
            readProviders.set(network.chainId, new ethers.JsonRpcProvider(request, network.chainId, { cacheTimeout: -1, batchMaxCount: 1 }));
        }
        return readProviders.get(network.chainId);
    }

    async function waitForReceipt(network, hash) {
        const rpc = rpcProvider(network);
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
            let receipt;
            try { receipt = await rpc.send("eth_getTransactionReceipt", [hash]); }
            catch (_) { /* Retry if a public RPC is temporarily unavailable. */ }
            if (receipt) return receipt;
            await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        throw Object.assign(new Error("等待回执超时。"), { code: "TIMEOUT" });
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function shortAddress(address) {
        if (!address) return "—";
        return `${address.slice(0, 6)}…${address.slice(-4)}`;
    }

    function explorerTx(hash, network = selectedNetwork()) {
        return network.explorerUrl ? `${network.explorerUrl}/tx/${hash}` : "";
    }

    function setNotice(message, type) {
        const element = $("globalNotice");
        element.textContent = message || "";
        element.className = `notice${type ? ` ${type}` : ""}${message ? "" : " hidden"}`;
    }

    function setNoticeHtml(message, type) {
        const element = $("globalNotice");
        element.innerHTML = message || "";
        element.className = `notice${type ? ` ${type}` : ""}${message ? "" : " hidden"}`;
    }

    function addActivity(label, status, hash, errorMessage) {
        $("activityEmpty").classList.add("hidden");
        const item = document.createElement("li");
        item.className = "activity-item";
        item.dataset.status = status;
        const statusText = { waiting: "等待签名", sent: "已发送", confirmed: "已确认", failed: "失败" }[status] || status;
        item.innerHTML = `<div class="activity-title"><strong>${escapeHtml(label)}</strong><span class="activity-status">${statusText}</span></div><div class="activity-detail"></div>`;
        $("activityList").prepend(item);
        updateActivity(item, status, hash, errorMessage);
        return item;
    }

    function updateActivity(item, status, hash, errorMessage) {
        item.dataset.status = status;
        const statusText = { waiting: "等待签名", sent: "已发送", confirmed: "已确认", failed: "失败" }[status] || status;
        const statusElement = item.querySelector(".activity-status");
        const detail = item.querySelector(".activity-detail");
        statusElement.textContent = statusText;
        statusElement.className = `activity-status ${status}`;
        if (hash) item.dataset.hash = hash;
        const txHash = item.dataset.hash;
        const link = txHash && item.dataset.explorer ? `${item.dataset.explorer}/tx/${txHash}` : "";
        const description = status === "failed" ? errorMessage || "交易失败" : status === "confirmed" ? `已确认${item.dataset.block ? `（区块 ${item.dataset.block}）` : ""}` : status === "waiting" ? "请在钱包中确认交易。" : "等待链上确认。";
        detail.innerHTML = `${escapeHtml(description)}${txHash ? `<br><span class="address">${escapeHtml(txHash)}</span>${link ? ` · <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">查看交易</a>` : ""}` : ""}`;
    }

    function setStaticUi() {
        const selected = selectedNetwork();
        $("chainValue").textContent = appState.chainId ? `${appState.chainId}${hasCorrectChain() ? "" : "（不匹配）"}` : "未检测";
        $("contractValue").textContent = configuredAddress() ? shortAddress(selected.contractAddress) : "未配置";
        $("contractValue").title = selected.contractAddress || "请在 config.js 中配置部署地址";
        if (!configuredAddress()) {
            setNotice(`${selected.name} 尚未在 frontend/config.js 配置 TimeLock 地址。请先部署并填入地址。`, "error");
        } else if (appState.chainId && !hasCorrectChain()) {
            setNotice(`当前钱包在 chainId ${appState.chainId}，页面目标是 ${selected.name}（chainId ${selected.chainId}）。请切换网络。`, "error");
        }
        syncControls();
    }

    function syncControls() {
        const ready = Boolean(isConnected() && hasCorrectChain() && appState.timeLock);
        $("lockSubmit").disabled = appState.busy || !ready;
        $("maxButton").disabled = appState.busy || !ready || !$("maxButton").dataset.balance;
        $("connectButton").disabled = appState.busy || appState.switching;
        $("networkSelect").disabled = appState.busy || appState.switching;
        $("walletSelect").disabled = appState.busy || appState.switching;
        $("showMineButton").disabled = !appState.account;
        $("creationOwner").textContent = appState.account || "连接钱包后自动确定";
        updateCountdowns();
    }

    function invalidateSession() {
        appState.session++;
        appState.previewRequest++;
        appState.listRequest++;
        appState.timeLock = null;
        appState.readTimeLock = null;
        appState.tokenMeta.clear();
        appState.currentBlockTimestamp = null;
        appState.listAddress = null;
        $("addressSearchInput").value = "";
        $("locksHeading").textContent = "我的锁仓";
        $("locksOwner").classList.add("hidden");
        clearTokenPreview();
        resetLocks("钱包状态已变化，正在刷新…");
        if (appState.cancelConfirmation) appState.cancelConfirmation(false);
        syncControls();
    }

    function captureContext() {
        return { session: appState.session, account: appState.account, network: selectedNetwork(), contract: appState.timeLock, wallet: appState.walletProvider };
    }

    async function assertContext(context) {
        const [accounts, chain] = await Promise.all([
            context.wallet.request({ method: "eth_accounts" }),
            context.wallet.request({ method: "eth_chainId" })
        ]);
        if (context.session !== appState.session || context.network !== selectedNetwork() ||
            accounts[0]?.toLowerCase() !== context.account?.toLowerCase() || Number(BigInt(chain)) !== context.network.chainId) {
            throw new Error("钱包账户或网络已变化，请重新核对并确认交易。");
        }
    }

    function formatLocalShanghai(timestamp) {
        const date = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(date.getTime())) return `Unix ${timestamp} 秒`;
        return new Intl.DateTimeFormat("zh-CN", {
            timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        }).format(date);
    }

    function formatUtc(timestamp) {
        const date = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(date.getTime())) return "超出可显示日期范围";
        return `${new Intl.DateTimeFormat("zh-CN", {
            timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
        }).format(date)} UTC`;
    }

    function toShanghaiInput(timestamp) {
        const date = new Date((Number(timestamp) + SHANGHAI_OFFSET_SECONDS) * 1000);
        const pad = (value) => String(value).padStart(2, "0");
        return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
    }

    function parseShanghaiInput(value) {
        if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
        const [datePart, timePart] = value.split("T");
        const [year, month, day] = datePart.split("-").map(Number);
        const [hour, minute] = timePart.split(":").map(Number);
        const timestamp = Math.floor((Date.UTC(year, month - 1, day, hour, minute) - SHANGHAI_OFFSET_SECONDS * 1000) / 1000);
        return Number.isFinite(timestamp) && toShanghaiInput(timestamp) === value ? timestamp : null;
    }

    function formatCountdown(timestamp) {
        const estimatedNow = appState.currentBlockTimestamp === null ? nowSeconds() : appState.currentBlockTimestamp + Math.floor((Date.now() - appState.blockReadAt) / 1000);
        const seconds = Number(timestamp) - estimatedNow;
        if (seconds <= 0) return "已到期";
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        return `${days ? `${days}天 ` : ""}${String(hours).padStart(2, "0")}时 ${String(minutes).padStart(2, "0")}分 ${String(secs).padStart(2, "0")}秒`;
    }

    function formatUnits(value, decimals) {
        try { return ethers.formatUnits(value, decimals); } catch (_) { return "格式化失败"; }
    }

    function getErrorMessage(error) {
        if (error?.code === 4001 || error?.code === "ACTION_REJECTED") return "你取消了钱包签名或网络切换。";
        if (error?.code === "INSUFFICIENT_FUNDS") return "原生币余额不足，无法支付 gas。";
        if (error?.code === "NUMERIC_FAULT" || error?.code === "INVALID_ARGUMENT") return "输入格式无效，请检查地址、数量及小数位数。";
        const candidates = [error?.reason, error?.shortMessage, error?.info?.error?.message, error?.info?.error?.data, error?.error?.reason, error?.error?.message, error?.message]
            .filter(Boolean).map(String);
        let raw = candidates.find((value) => /execution reverted:/i.test(value)) || candidates[0] || "未知错误";
        const data = error?.data || error?.error?.data || error?.info?.error?.data;
        if (typeof data === "string" && data.startsWith("0x08c379a0") && data.length >= 138) {
            try { raw = ethers.AbiCoder.defaultAbiCoder().decode(["string"], `0x${data.slice(10)}`)[0]; } catch (_) { /* keep raw */ }
        }
        raw = raw.replace(/^execution reverted(?::\s*)?/i, "").trim();
        const normalized = [raw, ...candidates].join(" ").toLowerCase();
        const translations = [
            ["user rejected", "你取消了钱包签名"], ["still locked", "尚未到解锁时间"], ["not beneficiary", "当前钱包不是该锁的受益人"],
            ["already withdrawn", "该锁已经提取"], ["lock not found", "锁不存在"], ["zero beneficiary", "受益人不能是零地址"],
            ["zero token", "代币地址不能是零地址"], ["zero amount", "锁仓数量必须大于零"], ["unlock time must be in future", "解锁时间必须晚于当前时间"],
            ["nothing received", "代币实际到账为零"], ["transfer failed", "代币转出失败"], ["transferfrom failed", "代币授权转入失败"],
            ["recipient received incorrect amount", "受益人净到账数量不等于锁定数量，提现已回滚"], ["beneficiary balance decreased", "受益人余额异常减少，提现已回滚"],
            ["insufficient allowance", "代币授权额度不足"], ["insufficient balance", "代币余额不足"], ["reentrant", "检测到重入调用，交易已回滚"],
            ["balance query failed", "无法查询代币余额，请核对代币合约地址"], ["balance decreased", "转入时合约余额异常减少，锁仓已回滚"]
        ];
        const found = translations.find(([needle]) => normalized.includes(needle));
        return found ? found[1] : raw || "交易失败";
    }

    function setButtonBusy(button, busy, text) {
        if (!button) return;
        if (busy) {
            appState.busy = true;
            button.dataset.originalText = button.textContent;
            button.disabled = true;
            if (text) button.textContent = text;
        } else {
            appState.busy = false;
            if (button.dataset.originalText) button.textContent = button.dataset.originalText;
        }
        syncControls();
    }

    function useWallet(wallet) {
        const previous = appState.walletProvider;
        if (previous && appState.listeners) {
            Object.entries(appState.listeners).forEach(([name, handler]) => previous.removeListener?.(name, handler));
        }
        invalidateSession();
        appState.walletProvider = wallet;
        appState.account = null;
        appState.chainId = null;
        appState.provider = new ethers.BrowserProvider(wallet, "any", { cacheTimeout: -1 });
        const changed = () => {
            if (appState.walletProvider !== wallet) return;
            invalidateSession();
            appState.signer = null;
            appState.provider = new ethers.BrowserProvider(wallet, "any", { cacheTimeout: -1 });
            refreshWalletState().catch((error) => setNotice(getErrorMessage(error), "error"));
        };
        const disconnected = () => {
            if (appState.walletProvider !== wallet) return;
            invalidateSession();
            appState.account = null;
            appState.signer = null;
            $("accountValue").textContent = "未连接";
            $("accountValue").title = "";
            $("nativeBalanceValue").textContent = "—";
            $("connectButton").textContent = "连接钱包";
            setNotice("钱包已断开，请重新连接。", "error");
            syncControls();
        };
        appState.listeners = { accountsChanged: changed, chainChanged: changed, disconnect: disconnected };
        Object.entries(appState.listeners).forEach(([name, handler]) => wallet.on?.(name, handler));
    }

    async function listWalletCandidates() {
        const candidates = [];
        const push = (provider, name) => { if (provider && !candidates.some((item) => item.provider === provider)) candidates.push({ provider, name }); };
        appState.walletCandidates.forEach(({ provider, name }) => push(provider, name));
        if (Array.isArray(window.ethereum?.providers)) window.ethereum.providers.forEach((provider) => push(provider, provider.isOkxWallet ? "OKX Wallet" : provider.isMetaMask ? "MetaMask" : "浏览器钱包"));
        else push(window.ethereum, window.ethereum?.isOkxWallet ? "OKX Wallet" : window.ethereum?.isMetaMask ? "MetaMask" : "浏览器钱包");
        if (window.okxwallet) push(window.okxwallet, "OKX Wallet");
        appState.walletCandidates = candidates;
        const picker = $("walletPicker");
        const select = $("walletSelect");
        const oldValue = select.value;
        select.innerHTML = candidates.map((item, index) => `<option value="${index}">${escapeHtml(item.name)}</option>`).join("");
        select.value = oldValue || "0";
        picker.classList.toggle("hidden", candidates.length <= 1);
        return candidates;
    }

    async function refreshWalletState() {
        const provider = appState.provider;
        if (!provider || !appState.walletProvider) return;
        const session = appState.session;
        const request = ++appState.walletRequest;
        const current = () => session === appState.session && request === appState.walletRequest;
        const [chain, accounts] = await Promise.all([
            appState.walletProvider.request({ method: "eth_chainId" }),
            appState.walletProvider.request({ method: "eth_accounts" })
        ]);
        if (!current()) return;
        appState.chainId = Number(BigInt(chain));
        appState.account = accounts[0] ? ethers.getAddress(accounts[0]) : null;
        const [signer, balance, code] = await Promise.all([
            appState.account ? provider.getSigner(appState.account) : null,
            appState.account ? provider.getBalance(appState.account) : null,
            configuredAddress() && hasCorrectChain() ? provider.getCode(selectedNetwork().contractAddress) : "0x"
        ]);
        if (!current()) return;
        appState.signer = signer;
        appState.readTimeLock = code !== "0x" && hasCorrectChain() ? new ethers.Contract(selectedNetwork().contractAddress, TIMELOCK_ABI, provider) : null;
        appState.timeLock = appState.signer && appState.readTimeLock ? appState.readTimeLock.connect(appState.signer) : null;
        $("accountValue").textContent = appState.account || "未连接";
        $("accountValue").title = appState.account || "";
        const symbol = Object.values(APP_CONFIG.networks).find((item) => item.chainId === appState.chainId)?.nativeCurrency.symbol || "原生币";
        $("nativeBalanceValue").textContent = balance !== null ? `${formatUnits(balance, 18)} ${symbol}` : "—";
        $("connectButton").textContent = appState.account ? shortAddress(appState.account) : "连接钱包";
        setStaticUi();
        if (configuredAddress() && hasCorrectChain() && code === "0x") setNotice("配置的 TimeLock 地址没有合约代码，请核对网络和部署地址。", "error");
        if (appState.account) {
            if (!appState.listAddress) $("addressSearchInput").value = appState.account;
            if (configuredAddress()) await refreshLocks(appState.listAddress || appState.account);
            else resetLocks("请先配置当前网络的 TimeLock 地址。");
        } else resetLocks("连接钱包自动加载，或输入地址查询。");
        if (current()) await loadTokenPreview();
    }

    async function connectWallet() {
        try {
            const candidates = await listWalletCandidates();
            const selected = candidates[Number($("walletSelect").value || 0)] || candidates[0];
            if (!selected) throw new Error("未检测到可用钱包。");
            if (appState.walletProvider !== selected.provider) useWallet(selected.provider);
            await appState.provider.send("eth_requestAccounts", []);
            await refreshWalletState();
            if (!hasCorrectChain()) await switchNetwork();
            if (hasCorrectChain() && appState.timeLock) setNotice("钱包已连接。", "success");
        } catch (error) { setNotice(getErrorMessage(error), "error"); }
    }

    async function switchNetwork() {
        const selected = selectedNetwork();
        const wallet = appState.walletProvider;
        if (!wallet || appState.switching) return;
        appState.switching = true;
        syncControls();
        try {
            try {
                await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: selected.chainIdHex }] });
            } catch (error) {
                const code = error?.data?.originalError?.code ?? error?.code;
                if (code !== 4902) throw error;
                await wallet.request({ method: "wallet_addEthereumChain", params: [{ chainId: selected.chainIdHex, chainName: selected.name, rpcUrls: selected.rpcUrls, nativeCurrency: selected.nativeCurrency, ...(selected.explorerUrl ? { blockExplorerUrls: [selected.explorerUrl] } : {}) }] });
                await wallet.request({ method: "wallet_switchEthereumChain", params: [{ chainId: selected.chainIdHex }] });
            }
            invalidateSession();
            appState.provider = new ethers.BrowserProvider(wallet, "any", { cacheTimeout: -1 });
            await refreshWalletState();
            if (hasCorrectChain() && appState.timeLock) setNotice(`已连接${selected.name}。`, "success");
        } catch (error) {
            setNotice(`切换网络失败：${getErrorMessage(error)} 请在钱包中切换后重新连接。`, "error");
        } finally {
            appState.switching = false;
            syncControls();
        }
    }

    async function ensureReady() {
        if (!isConnected()) await connectWallet();
        if (!isConnected()) throw new Error("请先连接钱包。");
        if (!hasCorrectChain()) await switchNetwork();
        if (!hasCorrectChain()) throw new Error(`请切换到${selectedNetwork().name}。`);
        if (!configuredAddress()) throw new Error("当前网络尚未配置 TimeLock 合约地址。");
        if (!appState.timeLock) await refreshWalletState();
        if (!appState.timeLock) throw new Error("无法连接 TimeLock 合约。");
        return appState.timeLock;
    }

    async function readTokenMeta(address, provider = appState.provider) {
        const key = `${appState.session}:${address.toLowerCase()}`;
        if (!provider || !ethers.isAddress(address)) throw new Error("代币地址格式无效。");
        if (!appState.tokenMeta.has(key)) {
            const token = new ethers.Contract(address, ERC20_ABI, provider);
            const request = Promise.all([token.name(), token.symbol(), token.decimals()]).then(([name, symbol, decimals]) => ({ address, name, symbol, decimals: Number(decimals), token }));
            appState.tokenMeta.set(key, request);
            request.catch(() => appState.tokenMeta.delete(key));
        }
        const meta = await appState.tokenMeta.get(key);
        return { ...meta, token: meta.token.connect(provider) };
    }

    function clearTokenPreview() {
        delete $("maxButton").dataset.balance;
        delete $("maxButton").dataset.decimals;
        $("maxButton").disabled = true;
        $("tokenMeta").textContent = "输入有效代币地址后自动读取。";
        $("amountHint").textContent = "";
    }

    async function loadTokenPreview() {
        const request = ++appState.previewRequest;
        const session = appState.session;
        const address = $("tokenAddress").value.trim();
        clearTokenPreview();
        if (!ethers.isAddress(address) || address === ethers.ZeroAddress) return;
        if (!isConnected() || !hasCorrectChain()) { $("tokenMeta").textContent = "请先连接钱包并切换到目标网络。"; return; }
        const account = appState.account;
        const current = () => request === appState.previewRequest && session === appState.session && address === $("tokenAddress").value.trim();
        try {
            const meta = await readTokenMeta(address);
            const balance = await meta.token.balanceOf(account);
            if (!current()) return;
            $("tokenMeta").innerHTML = `<strong>${escapeHtml(meta.name)} (${escapeHtml(meta.symbol)})</strong> · decimals ${meta.decimals} · 我的余额 ${escapeHtml(formatUnits(balance, meta.decimals))}`;
            $("amountHint").textContent = `本次将按 ${meta.decimals} 位小数换算。`;
            $("maxButton").dataset.balance = balance.toString();
            $("maxButton").dataset.decimals = String(meta.decimals);
            syncControls();
        } catch (error) { if (current()) $("tokenMeta").textContent = `读取代币失败：${getErrorMessage(error)}`; }
    }

    function updateUnlockPreview() {
        const unlockTime = parseShanghaiInput($("unlockInput").value);
        if (!unlockTime) { $("unlockPreview").textContent = ""; $("unlockWarning").classList.add("hidden"); return; }
        $("unlockPreview").textContent = `Unix 时间戳：${unlockTime} · UTC：${formatUtc(unlockTime)}`;
        const remaining = unlockTime - (appState.currentBlockTimestamp || nowSeconds());
        if (remaining < 600) {
            $("unlockWarning").textContent = remaining <= 0 ? "解锁时间已到或已过去，合约创建锁仓会回滚。" : "距离现在少于 10 分钟，建议留出区块时间和人工操作余量。";
            $("unlockWarning").classList.remove("hidden");
        } else $("unlockWarning").classList.add("hidden");
    }

    function confirmDialog(title, rows, okayText = "确认", addressPrompt = false) {
        return new Promise((resolve) => {
            const dialog = $("confirmDialog");
            const form = dialog.querySelector("form");
            $("confirmTitle").textContent = title;
            $("confirmBody").innerHTML = rows.map(([label, value]) => `<div class="summary-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
            $("confirmOkay").textContent = okayText;
            $("dialogField").classList.toggle("hidden", !addressPrompt);
            $("dialogAddress").value = "";
            $("dialogError").classList.add("hidden");
            let finished = false;
            const finish = (result) => {
                if (finished) return;
                finished = true;
                form.onsubmit = null;
                dialog.oncancel = null;
                appState.cancelConfirmation = null;
                dialog.close();
                resolve(result);
            };
            appState.cancelConfirmation = finish;
            form.onsubmit = (event) => {
                event.preventDefault();
                if (event.submitter === $("confirmCancel")) { finish(false); return; }
                if (addressPrompt) {
                    const value = $("dialogAddress").value.trim();
                    if (!ethers.isAddress(value) || value === ethers.ZeroAddress || value.toLowerCase() === appState.account?.toLowerCase()) { $("dialogError").textContent = "请输入有效且不同于当前钱包的新所有者地址。"; $("dialogError").classList.remove("hidden"); return; }
                    finish(value);
                } else finish(true);
            };
            dialog.oncancel = (event) => { event.preventDefault(); finish(false); };
            dialog.showModal();
        });
    }

    async function sendTracked(label, method, args, context) {
        await assertContext(context);
        // Estimate each operation before asking the wallet to sign it.
        let gas;
        try { gas = await method.estimateGas(...args); }
        catch (error) { throw new Error(`${label}预检失败：${getErrorMessage(error)}`); }
        await assertContext(context);
        const tx = await method.populateTransaction(...args);
        await assertContext(context);
        const item = addActivity(label, "waiting");
        item.dataset.explorer = context.network.explorerUrl;
        setNotice(`${label}：等待钱包签名…`);
        try {
            const hash = await context.wallet.request({ method: "eth_sendTransaction", params: [{
                from: context.account, to: tx.to, data: tx.data, chainId: context.network.chainIdHex,
                gas: ethers.toQuantity((gas * 120n + 99n) / 100n)
            }] });
            if (!ethers.isHexString(hash, 32)) throw new Error("钱包未返回有效交易哈希，请先核查钱包活动记录。");
            updateActivity(item, "sent", hash);
            setNoticeHtml(explorerTx(hash, context.network)
                ? `${escapeHtml(label)}：已发送 · <a href="${escapeHtml(explorerTx(hash, context.network))}" target="_blank" rel="noopener noreferrer">查看交易</a>`
                : `${escapeHtml(label)}：已发送。`, "success");
            // Confirmation stays on the sending chain even if the wallet changes networks.
            const receipt = await waitForReceipt(context.network, hash);
            if (Number(receipt.status) !== 1) throw new Error("链上交易执行失败。");
            item.dataset.block = String(Number(receipt.blockNumber));
            updateActivity(item, "confirmed");
            setNotice(`${label}：已确认（区块 ${item.dataset.block}）。`, "success");
            return receipt;
        } catch (error) {
            const message = getErrorMessage(error);
            if (error?.code === "TIMEOUT" || item.dataset.hash && error?.code === "NETWORK_ERROR") {
                updateActivity(item, "sent");
                throw new Error(`${label}已发送，暂时无法确认。请按交易哈希核查链上结果，避免重复发送。`);
            }
            updateActivity(item, "failed", null, message);
            throw new Error(`${label}失败：${message}`);
        }
    }

    async function createLock(event) {
        event.preventDefault();
        if (appState.busy) return;
        const submitButton = event.submitter || $("lockSubmit");
        setButtonBusy(submitButton, true, "准备中…");
        try {
            const contract = await ensureReady();
            const context = captureContext();
            const tokenAddress = $("tokenAddress").value.trim();
            if (!ethers.isAddress(tokenAddress) || tokenAddress === ethers.ZeroAddress) throw new Error("代币地址格式无效。");
            const meta = await readTokenMeta(tokenAddress);
            const amountInput = $("amountInput").value.trim();
            if (!/^\d+(\.\d+)?$/.test(amountInput)) throw new Error("数量请使用普通十进制数字，不要输入逗号或科学计数法。");
            const rawAmount = ethers.parseUnits(amountInput, meta.decimals);
            if (rawAmount <= 0n) throw new Error("锁仓数量必须大于零。");
            if (rawAmount > ethers.MaxUint256) throw new Error("数量超过合约支持范围。");
            if (rawAmount > await meta.token.balanceOf(context.account)) throw new Error("代币余额不足。");
            const unlockTime = parseShanghaiInput($("unlockInput").value);
            if (!unlockTime || unlockTime <= await readChainTimestamp()) throw new Error("解锁时间必须晚于当前链上时间。");
            const beneficiary = context.account;
            const rows = [["网络 / 合约", `${context.network.name}\n${context.network.contractAddress}`], ["代币", `${meta.name} (${meta.symbol})\n${tokenAddress}`], ["数量", `${amountInput} ${meta.symbol}（原始数量 ${rawAmount}）`], ["解锁时间", `${formatLocalShanghai(unlockTime)} Asia/Shanghai\n${formatUtc(unlockTime)}`], ["所有者（自己）", beneficiary]];
            if (unlockTime - appState.currentBlockTimestamp < 600) rows.push(["时间提醒", "距离现在少于 10 分钟，请确认操作时间充足。"]);
            rows.push(["实际锁定量", "以链上记录的净到账为准，确认后可在我的锁仓查看。若提取转账扣税，合约将回滚。"]);
            await assertContext(context);
            const confirmed = await confirmDialog("确认创建固定锁仓", rows, "确认并发送");
            if (!confirmed) return;
            await assertContext(context);
            const token = meta.token.connect(context.contract.runner);
            const allowance = await token.allowance(context.account, context.network.contractAddress);
            if (allowance < rawAmount) {
                await sendTracked("授权", token.approve, [context.network.contractAddress, rawAmount], context);
                await assertContext(context);
                if (await token.allowance(context.account, context.network.contractAddress) < rawAmount) throw new Error("授权交易已确认，但代币未设置足够额度，请检查代币规则。");
            }
            await sendTracked("创建锁仓", contract.lock, [tokenAddress, rawAmount, unlockTime, beneficiary], context);
            setNotice("锁仓已创建。实际锁定数量可在「我的锁仓」查看。", "success");
            if (context.session === appState.session) {
                appState.listAddress = context.account;
                $("addressSearchInput").value = context.account;
                await refreshWalletState();
            }
        } catch (error) { setNotice(getErrorMessage(error), "error"); }
        finally { setButtonBusy(submitButton, false); }
    }

    async function readChainTimestamp(provider = appState.provider) {
        if (!provider) throw new Error("无法读取目标链的区块时间。");
        const session = appState.session;
        const block = await provider.getBlock("latest");
        if (!block) throw new Error("无法读取目标链的区块时间。");
        if (session === appState.session && block.timestamp !== appState.currentBlockTimestamp) {
            appState.currentBlockTimestamp = block.timestamp;
            appState.blockReadAt = Date.now();
        }
        return block.timestamp;
    }

    async function loadLock(lockId, contract = appState.readTimeLock) {
        if (!contract) throw new Error("请连接正确网络并配置合约地址。");
        return { id: lockId.toString(), lock: await contract.locks(lockId) };
    }

    async function describeLock({ id, lock }, provider) {
        const meta = await readTokenMeta(lock.token, provider).catch(() => ({ name: "未知代币", symbol: "", decimals: null }));
        return { id, token: lock.token, beneficiary: lock.beneficiary, amount: lock.amount, unlockTime: Number(lock.unlockTime), withdrawn: lock.withdrawn, meta };
    }

    function lockQuantity(lock) {
        return lock.meta.decimals === null ? `${lock.amount}（原始单位）` : `${formatUnits(lock.amount, lock.meta.decimals)} ${lock.meta.symbol}`;
    }

    function rowStatus(lock) {
        if (lock.withdrawn) return { label: "已提取", className: "done" };
        if (lock.unlockTime <= (appState.currentBlockTimestamp || nowSeconds())) return { label: "可提取", className: "ready" };
        return { label: "锁定中", className: "pending" };
    }

    function lockActions(lock) {
        const mine = appState.timeLock && lock.beneficiary.toLowerCase() === appState.account.toLowerCase();
        if (!mine) return '<span class="field-hint">仅查看</span>';
        const canWithdraw = mine && !lock.withdrawn && lock.unlockTime <= (appState.currentBlockTimestamp || nowSeconds());
        return `<div class="row-actions"><button class="button outline" data-action="transfer" data-lock-id="${lock.id}" ${lock.withdrawn || appState.busy ? "disabled" : ""}>转移所有权</button><button class="button primary" data-action="withdraw" data-lock-id="${lock.id}" ${canWithdraw && !appState.busy ? "" : "disabled"}>提取</button></div>`;
    }

    function renderLockRow(lock) {
        const status = rowStatus(lock);
        return `<tr ${rowAttributes(lock)}><td data-label="编号"><strong>${lock.id}</strong></td><td data-label="代币"><strong>${escapeHtml(lock.meta.symbol || "未知代币")}</strong><span class="address" title="${lock.token}">${escapeHtml(shortAddress(lock.token))}</span></td><td data-label="数量">${escapeHtml(lockQuantity(lock))}</td><td data-label="解锁时间">${escapeHtml(formatLocalShanghai(lock.unlockTime))}<span class="field-hint">${escapeHtml(formatUtc(lock.unlockTime))}</span></td><td data-label="状态"><span class="status ${status.className}" data-status>${status.label}</span><span class="field-hint" data-countdown></span></td><td data-label="操作">${lockActions(lock)}</td></tr>`;
    }

    function rowAttributes(lock) {
        const mine = isConnected() && hasCorrectChain() && lock.beneficiary.toLowerCase() === appState.account.toLowerCase();
        return `data-lock-row data-unlock-time="${lock.unlockTime}" data-withdrawn="${lock.withdrawn}" data-mine="${mine}"`;
    }

    function resetLocks(message) {
        $("locksBody").innerHTML = "";
        $("locksTable").classList.add("hidden");
        $("locksEmpty").textContent = message;
        $("locksEmpty").classList.remove("hidden");
    }

    function lockReadProvider() {
        return hasCorrectChain() && appState.provider ? appState.provider : rpcProvider(selectedNetwork());
    }

    async function refreshLocks(address = appState.listAddress || appState.account) {
        const request = ++appState.listRequest;
        const { session } = appState;
        const current = () => appState.session === session && request === appState.listRequest;
        if (!address || !configuredAddress()) {
            resetLocks(address ? "请先配置当前网络的 TimeLock 地址。" : "连接钱包自动加载，或输入地址查询。");
            return;
        }
        appState.listAddress = address;
        const owner = address.toLowerCase();
        const mine = owner === appState.account?.toLowerCase();
        $("locksHeading").textContent = mine ? "我的锁仓" : "地址锁仓";
        $("locksOwner").textContent = address;
        $("locksOwner").classList.remove("hidden");
        resetLocks("正在查询锁仓…");
        const provider = lockReadProvider();
        const contract = appState.readTimeLock || new ethers.Contract(selectedNetwork().contractAddress, TIMELOCK_ABI, provider);
        try {
            await readChainTimestamp(provider);
            if (!current()) return;
            const count = await contract.locksCount();
            const locks = [];
            for (let start = 0n; start < count; start += BigInt(CHUNK_SIZE)) {
                if (!current()) return;
                const size = count - start > BigInt(CHUNK_SIZE) ? CHUNK_SIZE : Number(count - start);
                const chunk = await Promise.all(Array.from({ length: size }, (_, offset) => loadLock(start + BigInt(offset), contract)));
                const matches = chunk.filter(({ lock }) => lock.beneficiary.toLowerCase() === owner);
                if (!current()) return;
                locks.push(...await Promise.all(matches.map((lock) => describeLock(lock, provider))));
            }
            if (!current()) return;
            $("locksBody").innerHTML = locks.map(renderLockRow).join("");
            $("locksTable").classList.toggle("hidden", locks.length === 0);
            $("locksEmpty").textContent = locks.length ? "" : "该地址没有锁仓记录。";
            $("locksEmpty").classList.toggle("hidden", locks.length > 0);
            bindRowActions($("locksBody"));
            updateCountdowns();
        } catch (error) { if (current()) resetLocks(`读取锁仓失败：${getErrorMessage(error)}`); }
    }

    function updateCountdowns() {
        const current = appState.currentBlockTimestamp;
        document.querySelectorAll("[data-lock-row]").forEach((row) => {
            const unlockTime = Number(row.dataset.unlockTime);
            const withdrawn = row.dataset.withdrawn === "true";
            const mine = row.dataset.mine === "true";
            const unlocked = current !== null && unlockTime <= current;
            const countdown = row.querySelector("[data-countdown]");
            const status = row.querySelector("[data-status]");
            const withdrawButton = row.querySelector('[data-action="withdraw"]');
            if (countdown) countdown.textContent = withdrawn ? "" : unlocked ? "已到期" : formatCountdown(unlockTime) === "已到期" ? "等待链上到期" : formatCountdown(unlockTime);
            if (status && !withdrawn) { status.textContent = unlocked ? "可提取" : "锁定中"; status.className = `status ${unlocked ? "ready" : "pending"}`; }
            if (withdrawButton) withdrawButton.disabled = !(appState.timeLock && mine && unlocked && !withdrawn && !appState.busy);
            const transferButton = row.querySelector('[data-action="transfer"]');
            if (transferButton) transferButton.disabled = !(appState.timeLock && mine && !withdrawn && !appState.busy);
        });
    }

    function queryAddress(event) {
        event.preventDefault();
        const value = $("addressSearchInput").value.trim();
        if (!ethers.isAddress(value) || value === ethers.ZeroAddress) { setNotice("请输入有效的钱包地址。", "error"); return; }
        if (!configuredAddress()) { setStaticUi(); return; }
        const address = ethers.getAddress(value);
        $("addressSearchInput").value = address;
        refreshLocks(address);
    }

    function bindRowActions(container) {
        container.querySelectorAll("[data-action]").forEach((button) => { button.onclick = () => handleLockAction(button.dataset.action, button.dataset.lockId, button); });
    }

    async function handleLockAction(action, lockId, button) {
        if (appState.busy) return;
        setButtonBusy(button, true, "处理中…");
        try {
            const contract = await ensureReady();
            const context = captureContext();
            const lock = await describeLock(await loadLock(BigInt(lockId)), appState.provider);
            if (lock.withdrawn) throw new Error("该锁已经提取。");
            if (lock.beneficiary.toLowerCase() !== context.account.toLowerCase()) throw new Error("当前钱包不是该锁的受益人。");
            await assertContext(context);
            if (action === "withdraw") {
                if (lock.unlockTime > (await readChainTimestamp())) throw new Error("尚未到解锁时间。");
                const confirmed = await confirmDialog("确认提取", [["网络 / 合约", `${context.network.name}\n${context.network.contractAddress}`], ["lockId", lockId], ["数量", lockQuantity(lock)], ["受益人", context.account]], "确认提取");
                if (!confirmed) return;
                await sendTracked(`提取 lockId ${lockId}`, contract.withdraw, [BigInt(lockId)], context);
            } else if (action === "transfer") {
                const newBeneficiary = await confirmDialog("转移所有权", [["锁仓编号", lockId], ["数量", lockQuantity(lock)]], "核对转移信息", true);
                if (!newBeneficiary) return;
                await assertContext(context);
                const confirmed = await confirmDialog("再次确认转移所有权", [["网络 / 合约", `${context.network.name}\n${context.network.contractAddress}`], ["锁仓编号", lockId], ["数量", lockQuantity(lock)], ["解锁时间", `${formatLocalShanghai(lock.unlockTime)} Asia/Shanghai`], ["原所有者", context.account], ["新所有者", ethers.getAddress(newBeneficiary)], ["重要提示", "转移后自己将无法提取或再次转移该锁。页面不收取 OTC 价款，请核对交割安排。"]], "确认转移");
                if (!confirmed) return;
                await sendTracked(`转移锁仓 #${lockId} 的所有权`, contract.transferLock, [BigInt(lockId), newBeneficiary], context);
            }
            if (context.session === appState.session) await refreshWalletState();
        } catch (error) { setNotice(getErrorMessage(error), "error"); }
        finally { setButtonBusy(button, false); }
    }

    function setupEvents() {
        $("connectButton").onclick = connectWallet;
        $("networkSelect").value = appState.selectedNetwork;
        $("networkSelect").onchange = async (event) => {
            appState.selectedNetwork = event.target.value;
            invalidateSession();
            setNotice("");
            setStaticUi();
            if (isConnected()) await switchNetwork(); else resetLocks("连接钱包自动加载，或输入地址查询。");
        };
        $("walletSelect").onchange = () => {
            const candidate = appState.walletCandidates[Number($("walletSelect").value)];
            if (!candidate) return;
            useWallet(candidate.provider);
            refreshWalletState().catch((error) => setNotice(getErrorMessage(error), "error"));
        };
        let tokenTimer;
        $("tokenAddress").addEventListener("input", () => {
            appState.previewRequest++;
            clearTokenPreview();
            clearTimeout(tokenTimer);
            tokenTimer = setTimeout(loadTokenPreview, 350);
        });
        $("amountInput").addEventListener("input", () => {
            if (!$("maxButton").dataset.decimals) return;
            const decimals = Number($("maxButton").dataset.decimals);
            try { $("amountHint").textContent = `原始数量：${ethers.parseUnits($("amountInput").value || "0", decimals)}`; }
            catch (_) { $("amountHint").textContent = `请输入有效数量，最多 ${decimals} 位小数。`; }
        });
        $("maxButton").onclick = async () => {
            await loadTokenPreview();
            if ($("maxButton").dataset.balance) {
                $("amountInput").value = formatUnits($("maxButton").dataset.balance, Number($("maxButton").dataset.decimals));
                $("amountInput").dispatchEvent(new Event("input"));
            }
        };
        $("unlockInput").addEventListener("input", updateUnlockPreview);
        $("lockForm").addEventListener("submit", createLock);
        $("refreshButton").onclick = () => refreshLocks();
        $("addressSearchForm").onsubmit = queryAddress;
        $("showMineButton").onclick = () => {
            $("addressSearchInput").value = appState.account;
            refreshLocks(appState.account);
        };
        // EIP-6963 supports multiple installed wallets without assuming window.ethereum.
        window.addEventListener("eip6963:announceProvider", (event) => {
            const { provider, info } = event.detail || {};
            if (!provider?.request || appState.walletCandidates.some((item) => item.provider === provider)) return;
            appState.walletCandidates.push({ provider, name: info?.name || "浏览器钱包" });
            listWalletCandidates();
        });
        window.dispatchEvent(new Event("eip6963:requestProvider"));
        listWalletCandidates();
        window.setInterval(updateCountdowns, 1000);
        let polling = false;
        window.setInterval(async () => {
            if (polling || document.hidden || !configuredAddress() || !appState.listAddress) return;
            polling = true;
            try { await readChainTimestamp(lockReadProvider()); updateCountdowns(); updateUnlockPreview(); }
            catch (_) { /* explicit refresh reports RPC errors */ }
            finally { polling = false; }
        }, 5000);
        $("unlockInput").value = toShanghaiInput(nowSeconds() + 24 * 60 * 60);
        updateUnlockPreview();
        setStaticUi();
    }

    setupEvents();
})();
