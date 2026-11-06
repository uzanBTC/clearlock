// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title TimeLock
 * @notice Fixed-time principal locker for ERC20 tokens.
 *
 * The contract has no owner, administrator, upgrade path, rescue function, or
 * selfdestruct path. A lock is independent from every other lock. The intended
 * production tokens are Flap tax tokens: their buy/sell tax is applied when a
 * trade touches the bonding curve or DEX pool, while a normal wallet-to-wallet
 * transfer is expected to deliver the requested amount. The balance-delta
 * accounting and withdrawal recipient-delta check also make that assumption
 * explicit and fail safely for tokens that tax ordinary transfers.
 *
 * Rebasing tokens are not supported. Dividend contracts associated with Flap
 * tax tokens are outside this contract's scope; only locked principal is handled.
 * TimeLock emits no logs; read lock state through the public getters.
 */

interface IERC20Minimal {
    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract TimeLock {
    struct Lock {
        address token;
        address beneficiary;
        uint256 amount;
        uint256 unlockTime;
        bool withdrawn;
    }

    Lock[] public locks;
    mapping(address => uint256) public totalLocked;

    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;

    modifier nonReentrant() {
        require(_status == _NOT_ENTERED, "reentrant");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier existingLock(uint256 lockId) {
        require(lockId < locks.length, "lock not found");
        _;
    }

    modifier onlyBeneficiary(uint256 lockId) {
        require(msg.sender == locks[lockId].beneficiary, "not beneficiary");
        _;
    }

    /**
     * @notice Pull tokens from the caller into a new fixed-time lock.
     * @dev The recorded amount is the balance increase actually observed by
     *      this contract. Approve this contract before calling.
     */
    function lock(address token, uint256 amount, uint256 unlockTime, address beneficiary)
        external
        nonReentrant
        returns (uint256 lockId)
    {
        require(token != address(0), "zero token");
        require(beneficiary != address(0), "zero beneficiary");
        require(amount > 0, "zero amount");
        require(unlockTime > block.timestamp, "unlock time must be in future");

        uint256 beforeBalance = _balanceOf(token, address(this));
        _safeTransferFrom(token, msg.sender, address(this), amount);
        uint256 afterBalance = _balanceOf(token, address(this));
        require(afterBalance >= beforeBalance, "balance decreased");
        uint256 received = afterBalance - beforeBalance;
        require(received > 0, "nothing received");

        lockId = locks.length;
        locks.push(
            Lock({
                token: token,
                beneficiary: beneficiary,
                amount: received,
                unlockTime: unlockTime,
                withdrawn: false
            })
        );
        totalLocked[token] += received;
    }

    /**
     * @notice Withdraw a lock's full recorded principal after its fixed expiry.
     * @dev The recipient balance must increase by the recorded amount. A token
     *      that taxes ordinary outbound transfers therefore reverts safely.
     */
    function withdraw(uint256 lockId)
        external
        nonReentrant
        existingLock(lockId)
        onlyBeneficiary(lockId)
    {
        Lock storage currentLock = locks[lockId];
        require(!currentLock.withdrawn, "already withdrawn");
        require(block.timestamp >= currentLock.unlockTime, "still locked");

        address beneficiary = currentLock.beneficiary;
        uint256 amount = currentLock.amount;
        uint256 beneficiaryBefore = _balanceOf(currentLock.token, beneficiary);

        currentLock.withdrawn = true;
        totalLocked[currentLock.token] -= amount;
        _safeTransfer(currentLock.token, beneficiary, amount);

        uint256 beneficiaryAfter = _balanceOf(currentLock.token, beneficiary);
        require(beneficiaryAfter >= beneficiaryBefore, "beneficiary balance decreased");
        require(
            beneficiaryAfter - beneficiaryBefore == amount, "recipient received incorrect amount"
        );
    }

    /**
     * @notice Transfer the whole lock to a new beneficiary for OTC settlement.
     * @dev The token amount and fixed unlock time remain unchanged.
     */
    function transferLock(uint256 lockId, address newBeneficiary)
        external
        existingLock(lockId)
        onlyBeneficiary(lockId)
    {
        require(newBeneficiary != address(0), "zero beneficiary");
        Lock storage currentLock = locks[lockId];
        require(!currentLock.withdrawn, "already withdrawn");

        currentLock.beneficiary = newBeneficiary;
    }

    /// @notice Return the number of locks. Lock IDs are zero-based array indexes.
    function locksCount() external view returns (uint256) {
        return locks.length;
    }

    function _balanceOf(address token, address account) private view returns (uint256 balance) {
        (bool ok, bytes memory data) =
            token.staticcall(abi.encodeWithSelector(IERC20Minimal.balanceOf.selector, account));
        require(ok && data.length == 32, "balance query failed");
        balance = abi.decode(data, (uint256));
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, to, amount));
        require(
            ok && (data.length == 0 || (data.length == 32 && abi.decode(data, (bool)))),
            "transfer failed"
        );
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        require(
            ok && (data.length == 0 || (data.length == 32 && abi.decode(data, (bool)))),
            "transferFrom failed"
        );
    }
}
