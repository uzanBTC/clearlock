// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {TimeLock} from "../src/TimeLock.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

interface VmLocalScript {
    function startBroadcast() external;

    function stopBroadcast() external;
}

contract DeployLocal {
    VmLocalScript private constant vm =
        VmLocalScript(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (TimeLock timeLock, MockERC20 token) {
        vm.startBroadcast();
        timeLock = new TimeLock();
        token = new MockERC20("Local Test Token", "LTT", 18);
        token.mint(msg.sender, 1_000_000 ether);
        vm.stopBroadcast();
    }
}
