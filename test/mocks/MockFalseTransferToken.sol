// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { MockERC20 } from "./MockERC20.sol";

contract MockFalseTransferToken is MockERC20 {
    constructor() MockERC20("Mock False Transfer", "MFLT", 18) { }

    function transfer(address, uint256) external pure override returns (bool) {
        return false;
    }
}
