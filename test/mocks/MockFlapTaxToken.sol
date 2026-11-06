// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { MockERC20 } from "./MockERC20.sol";

/// @notice Flap-style mock: buy/sell tax only applies when a transfer touches mainPool.
contract MockFlapTaxToken is MockERC20 {
    uint256 public immutable buyTaxBps;
    uint256 public immutable sellTaxBps;
    address public immutable mainPool;
    address public immutable taxRecipient;

    constructor(uint256 buyTaxBps_, uint256 sellTaxBps_, address mainPool_, address taxRecipient_)
        MockERC20("Mock Flap Tax Token", "MFLAP", 18)
    {
        require(buyTaxBps_ <= 10_000 && sellTaxBps_ <= 10_000, "tax too high");
        require(mainPool_ != address(0) && taxRecipient_ != address(0), "zero address");
        buyTaxBps = buyTaxBps_;
        sellTaxBps = sellTaxBps_;
        mainPool = mainPool_;
        taxRecipient = taxRecipient_;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(to != address(0), "zero recipient");
        require(balanceOf[from] >= amount, "insufficient balance");
        uint256 taxBps = from == mainPool ? buyTaxBps : (to == mainPool ? sellTaxBps : 0);
        uint256 tax = amount * taxBps / 10_000;
        uint256 net = amount - tax;
        balanceOf[from] -= amount;
        balanceOf[to] += net;
        balanceOf[taxRecipient] += tax;
        emit Transfer(from, to, net);
        if (tax != 0) emit Transfer(from, taxRecipient, tax);
    }
}
