// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { MockERC20 } from "./MockERC20.sol";

contract MockReentrantToken is MockERC20 {
    enum CallbackMode {
        None,
        Lock,
        Withdraw
    }

    address public target;
    CallbackMode public callbackMode;
    uint256 public callbackLockId;
    uint256 public callbackUnlockTime;
    address public callbackBeneficiary;

    constructor() MockERC20("Mock Reentrant Token", "MRE", 18) { }

    function configureLockCallback(address target_, uint256 unlockTime_, address beneficiary_)
        external
    {
        target = target_;
        callbackMode = CallbackMode.Lock;
        callbackUnlockTime = unlockTime_;
        callbackBeneficiary = beneficiary_;
    }

    function configureWithdrawCallback(address target_, uint256 lockId_) external {
        target = target_;
        callbackMode = CallbackMode.Withdraw;
        callbackLockId = lockId_;
    }

    function clearCallback() external {
        callbackMode = CallbackMode.None;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        super._transfer(from, to, amount);
        if (callbackMode == CallbackMode.Lock) {
            (bool ignored,) = target.call(
                abi.encodeWithSignature(
                    "lock(address,uint256,uint256,address)",
                    address(this),
                    1,
                    callbackUnlockTime,
                    callbackBeneficiary
                )
            );
            ignored;
        } else if (callbackMode == CallbackMode.Withdraw) {
            (bool ignored,) =
                target.call(abi.encodeWithSignature("withdraw(uint256)", callbackLockId));
            ignored;
        }
    }
}
