// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { MockERC20 } from "./MockERC20.sol";

/// @notice Fee-on-every-transfer token used to prove safe failure on withdrawal.
contract MockTaxToken is MockERC20 {
    uint256 public immutable taxBps;
    address public immutable taxRecipient;

    constructor(uint256 taxBps_, address taxRecipient_) MockERC20("Mock Tax Token", "MTAX", 18) {
        require(taxBps_ <= 10_000, "tax too high");
        require(taxRecipient_ != address(0), "zero tax recipient");
        taxBps = taxBps_;
        taxRecipient = taxRecipient_;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(to != address(0), "zero recipient");
        require(balanceOf[from] >= amount, "insufficient balance");
        uint256 tax = amount * taxBps / 10_000;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[taxRecipient] += tax;
        emit Transfer(from, to, net);
        if (tax != 0) emit Transfer(from, taxRecipient, tax);
    }
}
