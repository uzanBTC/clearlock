// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function recordLogs() external;

    function getRecordedLogs() external returns (Log[] memory);

    function prank(address sender) external;

    function startPrank(address sender) external;

    function stopPrank() external;

    function warp(uint256 timestamp) external;

    function expectRevert() external;

    function expectRevert(bytes calldata revertData) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool condition) internal pure {
        require(condition, "assertTrue failed");
    }

    function assertFalse(bool condition) internal pure {
        require(!condition, "assertFalse failed");
    }

    function assertEq(uint256 left, uint256 right) internal pure {
        require(left == right, "uint256 values differ");
    }

    function assertEq(address left, address right) internal pure {
        require(left == right, "address values differ");
    }

    function assertEq(bool left, bool right) internal pure {
        require(left == right, "bool values differ");
    }
}
