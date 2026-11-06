// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import { TimeLock } from "../src/TimeLock.sol";

interface VmScript {
    function startBroadcast() external;

    function stopBroadcast() external;
}

contract Deploy {
    VmScript private constant vm =
        VmScript(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (TimeLock deployed) {
        vm.startBroadcast();
        deployed = new TimeLock();
        vm.stopBroadcast();
    }
}
